import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createRefreshController } from "../../apps/web/core/components/home/dashboard-kpi/refresh-controller.ts";
import { hydrateReportContent, readChainSnapshot } from "../../apps/web/core/components/home/dashboard-kpi/snapshot.ts";
import {
  notifyDashboardUpdate,
  subscribeDashboardUpdates,
} from "../../apps/web/core/services/blockchain/dashboard-updates.ts";
import {
  buildTaskHierarchy,
  mergeAndDeduplicateReports,
  aggregateBranchKpi,
  calculateTaskProgress,
} from "../../apps/web/core/components/home/dashboard-kpi/kpi-calculator.ts";
import { resolveActivityRecords } from "../../apps/web/core/components/home/dashboard-kpi/activity-resolver.ts";

const hash = async (text) => "0x" + createHash("sha256").update(text).digest("hex");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tree = (records = []) =>
  buildTaskHierarchy(records, [
    { id: "root", name: "Root", state_group: "started" },
    { id: "middle", name: "Middle", parent_id: "root", state_group: "started" },
    { id: "leaf", name: "Leaf", parent_id: "middle", state_group: "started" },
    { id: "sibling", name: "Sibling", parent_id: "root", state_group: "unstarted" },
  ]);

test("updates arriving during a read coalesce without overlap or lost refresh", async () => {
  const gate = deferred();
  let reads = 0,
    concurrent = 0,
    maximum = 0;
  const controller = createRefreshController(async () => {
    reads++;
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    if (reads === 1) await gate.promise;
    concurrent--;
  });
  const first = controller.request();
  await controller.request();
  await controller.request();
  assert.equal(reads, 1);
  gate.resolve();
  await first;
  assert.equal(reads, 2);
  assert.equal(maximum, 1);
  controller.dispose();
});

test("disposed contexts cannot commit late results or run queued requests", async () => {
  const gate = deferred();
  let commits = 0,
    calls = 0;
  const controller = createRefreshController(async (current) => {
    calls++;
    await gate.promise;
    if (current()) commits++;
  });
  const read = controller.request();
  await controller.request();
  controller.dispose();
  gate.resolve();
  await read;
  await controller.request();
  assert.equal(commits, 0);
  assert.equal(calls, 1);
});

test("periodic polling skips a busy read instead of creating an endless refresh queue", async () => {
  const gate = deferred();
  let calls = 0;
  const controller = createRefreshController(async () => {
    calls++;
    await gate.promise;
  });
  const read = controller.request();
  await controller.request(false);
  gate.resolve();
  await read;
  assert.equal(calls, 1);
  controller.dispose();
});

test("successful save notification reaches the subscriber and unsubscribe cleans up", () => {
  const calls = [];
  const stop = subscribeDashboardUpdates((value) => calls.push(value));
  notifyDashboardUpdate({ workspaceSlug: "team", projectId: "p" });
  stop();
  notifyDashboardUpdate({ workspaceSlug: "team", projectId: "p" });
  assert.deepEqual(calls, [{ workspaceSlug: "team", projectId: "p" }]);
});

test("one broken UI subscriber cannot cause a successful save to be retried", () => {
  let called = false;
  const stop1 = subscribeDashboardUpdates(() => {
    throw Error("fixture listener error");
  });
  const stop2 = subscribeDashboardUpdates(() => {
    called = true;
  });
  assert.doesNotThrow(() => notifyDashboardUpdate({ workspaceSlug: "team", projectId: "p" }));
  assert.equal(called, true);
  stop1();
  stop2();
});

test("RPC failure is unknown, an explicit missing task is empty, and concurrency is bounded", async () => {
  let concurrent = 0,
    maximum = 0;
  const snapshot = await readChainSnapshot(
    Array.from({ length: 12 }, (_, i) => ({ id: String(i) })),
    {
      async details(id) {
        concurrent++;
        maximum = Math.max(maximum, concurrent);
        await new Promise(setImmediate);
        concurrent--;
        if (id === "0") throw Error("RPC unavailable");
        if (id === "1") throw Error("InvalidTask");
        return { taskId: Number(id), progress: 0 };
      },
      async reports(id) {
        if (id === "2") throw Error("partial reports RPC failure");
        return [];
      },
      missing: (error) => error.message === "InvalidTask",
    }
  );
  assert.equal(snapshot.reports["0"], undefined);
  assert.deepEqual(snapshot.reports["1"], []);
  assert.equal(snapshot.reports["2"], undefined);
  assert.equal(snapshot.details["2"].progress, 0);
  assert.deepEqual(snapshot.errors.sort(), ["0", "2"]);
  assert(maximum <= 4);
});

test("a disposed chain snapshot stops scheduling additional reads", async () => {
  const gate = deferred();
  let active = true,
    details = 0,
    reports = 0;
  const reading = readChainSnapshot(
    Array.from({ length: 20 }, (_, i) => ({ id: String(i) })),
    {
      details: async () => {
        details++;
        await gate.promise;
        return { taskId: 1 };
      },
      reports: async () => {
        reports++;
        return [];
      },
      missing: () => false,
      isCurrent: () => active,
    }
  );
  active = false;
  gate.resolve();
  await reading;
  assert.equal(details, 4);
  assert.equal(reports, 0);
});

test("only all three computed hashes hydrate canonical content; never reporter or transaction identity", async () => {
  const raw = [
    {
      issue_id: "leaf",
      event_type: "daily_report",
      work: "Exact work",
      difficulty: "Hard",
      evidence: "Proof",
      progress: 40,
      reporter_name: "Unverified name",
      transaction_hash: "unverified-tx",
    },
  ];
  const hydrated = await hydrateReportContent(raw, hash);
  const task = tree(hydrated).tasksById.get("leaf");
  const chain = [
    {
      taskId: 1,
      reportId: 0,
      reportedAt: 1700000000,
      progress: 40,
      workHash: await hash("Exact work"),
      difficultyHash: await hash("Hard"),
      evidenceHash: await hash("Proof"),
    },
  ];
  const summary = mergeAndDeduplicateReports(task, chain);
  assert.equal(summary.directCount, 1);
  assert.equal(summary.unreconciledReports.length, 1);
  assert.equal(summary.directReports[0].reconciliationStatus, "content_verified");
  assert.equal(summary.directReports[0].work, "Exact work");
  assert.equal(summary.directReports[0].reporterName, undefined);
  assert.equal(summary.directReports[0].transactionHash, undefined);
  for (const field of ["workHash", "difficultyHash", "evidenceHash"]) {
    const different = mergeAndDeduplicateReports(task, [{ ...chain[0], [field]: await hash("different") }]);
    assert.equal(different.directReports[0].reconciliationStatus, "confirmed_on_chain");
    assert.equal(different.directReports[0].work, "");
  }
  assert.equal(raw[0].dashboard_content_hashes, undefined, "read hydration does not persist or mutate records");
});

test("explicit branch scope includes parent reports and excludes siblings without mutating frozen nodes", () => {
  const hierarchy = tree(
    ["root", "middle", "leaf", "sibling"].map((id) => ({
      issue_id: id,
      report_id: id,
      event_type: "daily_report",
      progress: 50,
    }))
  );
  hierarchy.allTasks.forEach((task) => Object.freeze(task));
  const middle = hierarchy.tasksById.get("middle");
  const scope = [middle, ...middle.allDescendants];
  assert.equal(aggregateBranchKpi(scope, {}).totalReports, 2);
  assert.equal(aggregateBranchKpi(hierarchy.allTasks, {}).totalReports, 4);
  assert.equal(mergeAndDeduplicateReports(middle).branchCount, 2);
  assert.equal(aggregateBranchKpi(scope, {}).totalReports, 2, "selecting another scope does not change prior results");
});

test("missing progress stays null; newest local report is determined by time, not array position", () => {
  const empty = tree();
  assert.equal(aggregateBranchKpi(empty.allTasks, {}).averageProgress, null);
  assert.equal(aggregateBranchKpi(empty.allTasks, {}).onSchedule, 0);
  const task = tree([
    { issue_id: "leaf", event_type: "daily_report", progress: 80, recorded_at: "2026-11-02T10:00:00Z" },
    { issue_id: "leaf", event_type: "daily_report", progress: 20, recorded_at: "2026-11-01T10:00:00Z" },
  ]).tasksById.get("leaf");
  assert.equal(calculateTaskProgress(task, {}).value, 80);
  assert.equal(calculateTaskProgress(task, { leaf: 0 }).value, 0);
});

test("status is independent of progress and contract cancellation overrides stale local state", () => {
  const hierarchy = tree();
  const task = hierarchy.tasksById.get("leaf");
  assert.equal(aggregateBranchKpi([task], { leaf: 0 }).inProgress, 1);
  task.chainDetails = { status: 3, progress: 0 };
  const kpi = aggregateBranchKpi([task], { leaf: 0 });
  assert.equal(kpi.cancelled, 1);
  assert.equal(kpi.averageProgress, null);
});

test("an overdue task remains overdue even when progress is unavailable", () => {
  const task = tree().tasksById.get("leaf");
  task.issueDetail.target_date = "2020-01-01";
  const kpi = aggregateBranchKpi([task], {});
  assert.equal(kpi.overdue, 1);
  assert.equal(kpi.averageProgress, null);
});

test("schedule threshold uses contract integer division", () => {
  const task = tree().tasksById.get("leaf");
  const now = Math.floor(Date.now() / 1000);
  task.chainDetails = { status: 1, createdAt: now - 505, dueAt: now + 495 };
  const kpi = aggregateBranchKpi([task], { leaf: 50 });
  assert.equal(kpi.onSchedule, 1);
  assert.equal(kpi.delayed, 0);
});

test("a report with missing progress never acquires an invented zero", () => {
  const task = tree([{ issue_id: "leaf", event_type: "daily_report", work: "Saved text only" }]).tasksById.get("leaf");
  assert.equal(mergeAndDeduplicateReports(task).directReports[0].progress, null);
});

test("attachments use authorized original source; no fabricated bytes or API preview", () => {
  const record = {
    event_type: "task_content",
    content_kind: "evidence",
    content_reference: "asset_saved:proof.png:100:0",
  };
  const item = resolveActivityRecords(
    [record],
    [],
    [
      {
        id: "asset_saved",
        asset_url: "asset_saved",
        is_uploaded: true,
        attributes: { name: "proof.png", type: "image/png" },
      },
    ]
  )[0];
  assert.equal(item.metadata.assetSource, "asset_saved");
  assert.equal(item.metadata.previewUrl, undefined);
  const missing = resolveActivityRecords([record], [], [])[0];
  assert.equal(missing.metadata.assetSource, undefined);
});

// Execute the actual reader bodies. Only RPC dependencies are replaced; no duplicated reader implementation.
const require = createRequire(path.resolve("apps/web/package.json"));
const ts = require("typescript");
function reader(name, readContract) {
  const filename = "apps/web/core/services/blockchain/plane-task-chain.service.ts";
  const text = fs.readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const names =
    name === "getWalletKPI"
      ? ["findKpiValues", name]
      : name === "getIssueOnChainReports"
        ? ["normalizeContractBytes32", name]
        : [name];
  const source = names
    .map((key) => ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === key).getText(ast))
    .join("\n");
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    readContract,
    getIssueTaskId: async () => 1,
    readNumericResult: (n) => (typeof n === "number" ? n : null),
    isWalletAddress: (value) => /^0x[0-9a-f]{40}$/i.test(value),
  });
  return exports[name];
}

test("actual wallet KPI reader preserves contract values without substituting task-leaf averages", async () => {
  const values = [3, 1, 1, 1, 0, 1, 0, 0, 150, 50];
  const read = reader("getWalletKPI", async () => values);
  const result = await read("0x" + "a".repeat(40));
  assert.equal(result.kpi.total, 3);
  assert.equal(result.kpi.averageProgress, 50);
  assert.equal(result.kpi.progressSum, 150);
});

test("actual wallet KPI reader rejects negative, nonnumeric or out-of-range counters", async () => {
  for (const values of [
    [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 101],
    [1, "invalid", 0, 0, 0, 0, 0, 0, 0, 0],
  ]) {
    const read = reader("getWalletKPI", async () => values);
    await assert.rejects(read("0x" + "a".repeat(40)));
  }
});
test("actual strict reports reader propagates total and partial RPC failure; legacy callers retain their contract", async () => {
  const down = reader("getIssueOnChainReports", async () => {
    throw Error("RPC down");
  });
  await assert.rejects(down("leaf", { strict: true }), /RPC down/);
  assert.equal((await down("leaf")).length, 0);
  const partial = reader("getIssueOnChainReports", async (name, values) => {
    if (name === "getReportCount") return 2;
    if (values.reportId === 1) throw Error("RPC partial");
    return [1700000000, 30, "0x" + "1".repeat(64), "0x" + "2".repeat(64), "0x" + "3".repeat(64)];
  });
  await assert.rejects(partial("leaf", { strict: true }), /RPC partial/);
});
test("actual strict readers reject malformed successful responses instead of inventing zeros", async () => {
  for (const malformed of [null, {}, [], { progress: 0 }]) {
    const details = reader("getIssueOnChainTaskDetails", async () => malformed);
    await assert.rejects(details("leaf", { strict: true }));
  }
  const reports = reader("getIssueOnChainReports", async (name) => (name === "getReportCount" ? 1 : {}));
  await assert.rejects(reports("leaf", { strict: true }));
  const zero = reader("getIssueOnChainReports", async () => 0);
  assert.equal((await zero("leaf", { strict: true })).length, 0);
});

test("strict reader accepts FIAI SDK bytes32 without 0x and canonicalizes all three hashes", async () => {
  const hash = "18ac3e7343f016890c510e93f935261169d9e3f565436429830faf0934f4f8e4";
  const read = reader("getIssueOnChainReports", async (name) =>
    name === "getReportCount"
      ? 1
      : { reportedAt: "1792663564", progress: "71", workHash: hash, difficultyHash: hash, evidenceHash: hash }
  );
  const reports = await read("leaf", { strict: true });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].progress, 71);
  for (const key of ["workHash", "difficultyHash", "evidenceHash"]) assert.equal(reports[0][key], "0x" + hash);
});

test("a latest offline 100% report stays visible beside confirmed 0% without overwriting contract KPI", () => {
  const task = tree([
    {
      issue_id: "leaf",
      event_type: "daily_report",
      progress: 100,
      on_chain: false,
      recorded_at: "2026-11-03T00:00:00Z",
    },
  ]).tasksById.get("leaf");
  const progress = calculateTaskProgress(task, { leaf: 0 });
  assert.equal(progress.value, 0);
  assert.equal(progress.contractProgress, 0);
  assert.equal(progress.localProgress, 100);
  assert.equal(progress.hasPendingReport, true);
  assert.equal(aggregateBranchKpi([task], { leaf: 0 }).averageProgress, 0);
});

test("a failed read of a previously on-chain report is not relabeled as an offline save", () => {
  const task = tree([{ issue_id: "leaf", event_type: "daily_report", progress: 84, on_chain: true }]).tasksById.get(
    "leaf"
  );
  assert.equal(calculateTaskProgress(task, {}).hasPendingReport, false);
});
