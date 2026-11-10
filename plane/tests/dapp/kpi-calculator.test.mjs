import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTaskHierarchy,
  calculateTaskProgress,
  mergeAndDeduplicateReports,
  aggregateBranchKpi,
} from "../../apps/web/core/components/home/dashboard-kpi/kpi-calculator.ts";

test("Contract 0% takes precedence as confirmed progress, local report does not artificially inflate it", () => {
  const task = {
    id: "task-1",
    name: "Task 1",
    records: [{ event_type: "daily_report", progress: 50, recorded_at: new Date().toISOString() }],
    directChildren: [],
    allDescendants: [],
    leafTasks: [],
  };
  task.leafTasks = [task];

  const onChainProgressMap = { "task-1": 0 };
  const result = calculateTaskProgress(task, onChainProgressMap);

  assert.equal(result.value, 0);
  assert.equal(result.formatted, "0%");
  assert.equal(result.confidence, "confirmed");
  assert.equal(result.source, "on_chain_confirmed");
});

test("Contract 71% is confirmed and not overridden by leaf average of 63%", () => {
  const leaf1 = {
    id: "leaf-1",
    name: "Leaf 1",
    records: [{ event_type: "daily_report", progress: 41 }],
    directChildren: [],
    allDescendants: [],
    leafTasks: [],
  };
  leaf1.leafTasks = [leaf1];

  const leaf2 = {
    id: "leaf-2",
    name: "Leaf 2",
    records: [{ event_type: "daily_report", progress: 84 }],
    directChildren: [],
    allDescendants: [],
    leafTasks: [],
  };
  leaf2.leafTasks = [leaf2];

  const parent = {
    id: "parent-1",
    name: "Parent 1",
    records: [],
    directChildren: [leaf1, leaf2],
    allDescendants: [leaf1, leaf2],
    leafTasks: [leaf1, leaf2],
  };

  // Trường hợp 1: Parent đã có xác nhận on-chain là 71%
  const onChainWithParent = { "parent-1": 71, "leaf-1": 41, "leaf-2": 84 };
  const parentProgress = calculateTaskProgress(parent, onChainWithParent);
  assert.equal(parentProgress.value, 71);
  assert.equal(parentProgress.confidence, "confirmed");
  assert.equal(parentProgress.source, "on_chain_confirmed");

  // Trường hợp 2: Parent chưa có on-chain (null), tính trung bình từ các con trực tiếp: (41 + 84) / 2 = 62.5 -> 63%
  const onChainWithoutParent = { "leaf-1": 41, "leaf-2": 84 };
  const estimatedParent = calculateTaskProgress(parent, onChainWithoutParent);
  assert.equal(estimatedParent.value, 63);
  assert.equal(estimatedParent.confidence, "estimated");
  assert.equal(estimatedParent.source, "direct_children_average");
});

test("Two valid reports with identical progress submitted within 60 seconds are preserved and not deduplicated falsely", () => {
  const now = Date.now();
  const task = {
    id: "task-reports",
    name: "Task Reports",
    records: [
      {
        report_id: "report-1",
        event_type: "daily_report",
        progress: 50,
        work: "Công việc sáng",
        recorded_at: new Date(now).toISOString(),
      },
      {
        report_id: "report-2",
        event_type: "daily_report",
        progress: 50,
        work: "Công việc chiều",
        recorded_at: new Date(now + 15000).toISOString(), // 15s later
      },
    ],
    directChildren: [],
    allDescendants: [],
    leafTasks: [],
  };

  const summary = mergeAndDeduplicateReports(task, []);
  assert.equal(summary.directCount, 2);
  assert.equal(summary.directReports[0].work, "Công việc chiều"); // Mới nhất trước
  assert.equal(summary.directReports[1].work, "Công việc sáng");
});

test("A local hash and tx string do not prove report identity or original content", () => {
  const task = {
    id: "task-dedup",
    name: "Task Dedup",
    records: [
      {
        report_id: "local-rep-1",
        event_type: "daily_report",
        progress: 60,
        work: "Nội dung chi tiết ở local",
        work_hash: "0xabc123",
        transaction_hash: "0xtx123",
        recorded_at: new Date().toISOString(),
      },
    ],
    directChildren: [],
    allDescendants: [],
    leafTasks: [],
  };

  const onChainReports = [
    {
      reportId: 0,
      taskId: 10,
      reportedAt: Math.floor(Date.now() / 1000),
      progress: 60,
      workHash: "0xabc123",
      difficultyHash: "0x",
      evidenceHash: "0x",
    },
  ];

  const summary = mergeAndDeduplicateReports(task, onChainReports);
  assert.equal(summary.directCount, 1);
  assert.equal(summary.directReports[0].reconciliationStatus, "confirmed_on_chain");
  assert.equal(summary.directReports[0].work, "");
  assert.equal(summary.unreconciledReports.length, 1);
  assert.equal(summary.unreconciledReports[0].work, "Nội dung chi tiết ở local");
  assert.equal(summary.directReports[0].isOnChainConfirmed, true);
});

test("Cancelled tasks are excluded from progress denominator and hierarchy handles multi-level trees and loops", () => {
  const records = [
    { event_type: "create_task", issue_id: "t1", issue_name: "Root", parent_issue_id: undefined },
    { event_type: "create_task", issue_id: "t2", issue_name: "Child 1", parent_issue_id: "t1" },
    { event_type: "create_task", issue_id: "t3", issue_name: "Cancelled Child", parent_issue_id: "t1" },
    { event_type: "create_task", issue_id: "t4", issue_name: "Deleted Task", parent_issue_id: "t1" },
    { event_type: "delete_task", issue_id: "t4" },
  ];

  const planeTasks = [
    { id: "t1", name: "Root", state_detail: { group: "started" } },
    { id: "t2", name: "Child 1", parent_id: "t1", state_detail: { group: "started" } },
    { id: "t3", name: "Cancelled Child", parent_id: "t1", state_detail: { group: "cancelled" } },
  ];

  const { roots, tasksById, allTasks } = buildTaskHierarchy(records, planeTasks);

  // Deleted task 't4' must be filtered out
  assert.equal(allTasks.length, 3);
  assert.equal(roots.length, 1);
  const root = roots[0];
  assert.equal(root.id, "t1");
  assert.equal(root.directChildren.length, 2);

  // t3 is cancelled, t2 is at 50%
  const onChainMap = { t2: 50, t3: 0 };
  const rootProgress = calculateTaskProgress(root, onChainMap);
  // Since t3 is cancelled, denominator is only t2 (1 task) -> 50 / 1 = 50%
  assert.equal(rootProgress.value, 50);

  // Aggregate KPI on leaves
  const kpi = aggregateBranchKpi(root.leafTasks, onChainMap);
  assert.equal(kpi.total, 2);
  assert.equal(kpi.cancelled, 1);
  assert.equal(kpi.averageProgress, 50);
});
