import test from "node:test";
import assert from "node:assert/strict";
import { withdrawProgress, restoreWithdraw } from "../web/src/runtime/withdraw.mjs";
import { Transactions } from "../web/src/runtime/transactions.mjs";
const hash = "0x" + "b".repeat(64);
test("withdraw flow pending → success and retry", () => {
  const f = { id: "flow" };
  assert.equal(withdrawProgress(null, []).phase, "draft");
  assert.equal(withdrawProgress(f, []).phase, "review");
  const w = { flowId: "flow", step: "withdraw", status: "confirming", hash };
  assert.equal(withdrawProgress(f, [w]).phase, "pending");
  assert.equal(withdrawProgress(f, [{ ...w, status: "confirmed" }]).phase, "success");
  for (const status of ["rejected", "failed", "reverted"])
    assert.equal(withdrawProgress(f, [{ ...w, status }]).phase, "retry");
  assert.equal(withdrawProgress(f, [{ ...w, status: "rpc_unknown", hash: null }]).phase, "unknown");
  assert.equal(withdrawProgress(f, [{ ...w, status: "rpc_unknown" }]).phase, "pending");
  assert.equal(
    withdrawProgress(f, [{ ...w, flowId: "other", status: "confirmed" }]).phase,
    "review",
  );
});
test("withdraw recovery validates persisted amounts", () => {
  const f = { id: "flow", amount: "20000" };
  assert.deepEqual(restoreWithdraw({ getItem: () => JSON.stringify(f) }, "key"), f);
  for (const patch of [
    { amount: "-1" },
    { amount: "0" },
    { amount: "garbage" },
    { amount: undefined },
  ])
    assert.equal(
      restoreWithdraw({ getItem: () => JSON.stringify({ id: "flow", ...patch }) }, "key"),
      null,
    );
});
test("withdraw journal metadata survives receipt failure without replaying sends", async () => {
  const map = new Map(),
    storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
  let fail = true,
    sends = 0;
  const args = {
    config: { chainId: 5042, papaya: "0x123" },
    account: "0xA",
    storage,
    schedule: () => 0,
    cancel: () => {},
    receipt: async () => {
      if (fail) throw Error("offline");
      return { status: 1, blockNumber: 42 };
    },
  };
  const t = new Transactions(args);
  await t.submit(
    "Withdraw funds",
    async () => {
      sends++;
      return { hash };
    },
    null,
    { flowId: "flow", step: "withdraw" },
  );
  await t.reconcile();
  t.stop();
  const restored = new Transactions(args);
  assert.equal(withdrawProgress({ id: "flow" }, restored.rows).phase, "pending");
  fail = false;
  await restored.start();
  assert.equal(withdrawProgress({ id: "flow" }, restored.rows).phase, "success");
  assert.equal(sends, 1);
  restored.stop();
});
