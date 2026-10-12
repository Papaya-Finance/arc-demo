import test from "node:test";
import assert from "node:assert/strict";
import { fundingPlan, fundingProgress, restoreFunding } from "../web/src/runtime/funding.mjs";
import { Transactions } from "../web/src/runtime/transactions.mjs";
import { scopeKey } from "../web/src/runtime/storage.mjs";
const hash = "0x" + "a".repeat(64);
test("funding permission covers the deposit amount", () => {
  const p = fundingPlan(20_000n, 0n);
  assert.equal(p.target, 20_000n);
  assert.equal(p.remaining, 0n);
  assert.equal(p.needsApproval, true);
});
test("an allowance below the deposit still requires approval", () => {
  assert.equal(fundingPlan(20_000n, 19_999n).needsApproval, true);
});
test("exact and excess existing allowance skip approval", () => {
  for (const current of [20_000n, 100_000n, 2n ** 256n - 1n]) {
    const p = fundingPlan(20_000n, current);
    assert.equal(p.needsApproval, false);
    assert.equal(p.remaining, current - 20_000n);
  }
});
test("invalid deposits cannot reach funding submission", () => {
  for (const d of [-1n, 0n]) assert.throws(() => fundingPlan(d, 0n));
  assert.throws(() => fundingPlan(1n, -1n));
  assert.equal(fundingPlan(100_000n, 0n).remaining, 0n);
  assert.equal(fundingPlan(1_000_000n, 0n).target, 1_000_000n);
});
test("flow reconciles approval → continue, deposit → success, and isolates unrelated transactions", () => {
  const f = { id: "flow" };
  const a = { flowId: "flow", step: "approval", status: "confirmed", hash };
  assert.equal(fundingProgress(f, [a]).phase, "continue");
  assert.equal(
    fundingProgress(f, [{ ...a, step: "deposit", status: "confirming" }, a]).phase,
    "pending",
  );
  assert.equal(fundingProgress(f, [{ ...a, step: "deposit" }, a]).phase, "success");
  assert.equal(fundingProgress(f, [{ ...a, flowId: "another", step: "deposit" }]).phase, "review");
  for (const status of ["rejected", "failed", "reverted"])
    assert.equal(fundingProgress(f, [{ ...a, status }]).phase, "retry");
  assert.equal(fundingProgress(f, [{ ...a, status: "rpc_unknown", hash: null }]).phase, "unknown");
  assert.equal(fundingProgress(f, [{ ...a, status: "rpc_unknown" }]).phase, "pending");
});
test("funding recovery validates persisted amounts and isolates chain, contract and account", () => {
  const f = { id: "flow", deposit: "20000" };
  const storage = { getItem: () => JSON.stringify(f) };
  assert.deepEqual(restoreFunding(storage, "key"), f);
  for (const patch of [{ deposit: "-1" }, { deposit: "garbage" }])
    assert.equal(
      restoreFunding({ getItem: () => JSON.stringify({ ...f, ...patch }) }, "key"),
      null,
    );
  assert.equal(
    restoreFunding(
      {
        getItem: () => JSON.stringify({ id: "flow", deposit: "20000", refill: "41472", months: 1 }),
      },
      "key",
    ).deposit,
    "20000",
  );
  assert.notEqual(
    scopeKey({ chainId: 5042, papaya: "0x123" }, "0xA"),
    scopeKey({ chainId: 5042, papaya: "0x123" }, "0xB"),
  );
});
test("funding journal metadata survives receipt failure and reload without replaying sends", async () => {
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
    "Approve USDC",
    async () => {
      sends++;
      return { hash };
    },
    null,
    { flowId: "flow", step: "approval" },
  );
  await t.reconcile();
  t.stop();
  const restored = new Transactions(args);
  assert.equal(fundingProgress({ id: "flow" }, restored.rows).phase, "pending");
  fail = false;
  await restored.start();
  assert.equal(fundingProgress({ id: "flow" }, restored.rows).phase, "continue");
  assert.equal(sends, 1);
  restored.stop();
});
