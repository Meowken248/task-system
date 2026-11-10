import { test } from "node:test";
import assert from "node:assert/strict";
import { isMissingTaskContractError } from "../../apps/web/core/services/blockchain/contract-errors.ts";

for (const [name, error] of [
  ["InvalidTask selector", { data: "0x0531bbb1" }],
  ["InvalidSubTask selector", { data: "0x10300f62" }],
  ["decoded task error", { errorName: "InvalidTask" }],
  ["nested RPC error", { info: { error: { data: "0x0531bbb1" } } }],
  ["explicit custom error message", new Error("execution reverted: InvalidTask()")],
  ["explicit RPC returned selector", new Error("execution reverted: 0x0531bbb1")],
])
  test(`${name} proves a missing record`, () => assert.equal(isMissingTaskContractError(error), true));

for (const [name, error] of [
  ["generic revert", new Error("execution reverted")],
  ["unknown contract selector", { data: "0x464522a9" }],
  ["permission revert", { code: "CALL_EXCEPTION", errorName: "Unauthorized" }],
  ["RPC timeout", new Error("RPC request timed out")],
  ["misleading metadata", new Error("invalid task signature")],
])
  test(`${name} remains unknown and must not trigger backfill`, () =>
    assert.equal(isMissingTaskContractError(error), false));

test("circular error objects terminate safely", () => {
  const error = {};
  error.cause = error;
  assert.equal(isMissingTaskContractError(error), false);
});
