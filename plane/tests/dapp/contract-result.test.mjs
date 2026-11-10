import { test } from "node:test";
import assert from "node:assert/strict";
import { readContractString } from "../../apps/web/core/helpers/contract-result.ts";

test("workspace string reads accept decoded SDK envelopes and reject unrelated metadata", () => {
  for (const result of ["team", ["team"], { result: "team" }, { data: { output: ["team"] } }, { 0: "team" }]) {
    assert.equal(readContractString(result), "team");
  }
  for (const result of [null, 1, { error: "team" }, { transactionHash: "team" }, ["team", "other"]]) {
    assert.equal(readContractString(result), null);
  }
});
