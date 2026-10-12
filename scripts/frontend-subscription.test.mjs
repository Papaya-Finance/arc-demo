import test from "node:test";
import assert from "node:assert/strict";
import {
  subscriptionPlan,
  subscriptionStep,
  subscriptionProgress,
  restoreSubscription,
} from "../web/src/runtime/subscription.mjs";
import { applyIncoming, scanIncoming } from "../web/src/runtime/incoming.mjs";
import { Transactions } from "../web/src/runtime/transactions.mjs";
import { MONTH, SCALE, RATES } from "./math.mjs";
const account = "0x" + "1".repeat(40),
  to = "0x" + "2".repeat(40),
  rate = RATES[1];
const data = (patch = {}) => ({
  user: { balance: 0n, outgoingRate: 0n, incomeRate: 0n, updated: 100n },
  timestamp: 100n,
  baseFee: 20_000_000_000n,
  external: 1_000_000n,
  allowance: 0n,
  subscriptions: {},
  ...patch,
});
const plan = subscriptionPlan(data(), to, rate, 3, account);
const flow = {
  id: "flow",
  kind: "creator",
  stage: "review",
  to,
  rate: rate.toString(),
  months: 3,
  deposit: plan.deposit.toString(),
  target: plan.target.toString(),
};
const row = (step, status = "confirmed") => ({
  id: step,
  flowId: "flow",
  step: `stream-${step}`,
  status,
  hash: "0x" + "a".repeat(64),
  blockNumber: 42,
});
test("zero Papaya and wallet balances: selected months are total coverage, deposit counts toward them", () => {
  const p = subscriptionPlan(data({ external: 0n }), to, rate, 3, account);
  const month = (rate * MONTH) / SCALE;
  assert.equal(p.deposit, month);
  assert.equal(p.refill, 2n * month);
  assert.equal(p.target, 3n * month);
  assert.equal(p.enoughWallet, false);
  assert.equal(p.needsApproval, true);
  const one = subscriptionPlan(data({ external: 0n }), to, rate, 1, account);
  assert.equal(one.deposit, month);
  assert.equal(one.refill, 0n);
  assert.equal(one.target, month);
  assert.throws(
    () => subscriptionStep(flow, [], data({ allowance: p.target, external: 0n }), account),
    /Not enough/,
  );
});
test("existing allowance is kept; funded subscriber skips approval and deposit", () => {
  const d = data({ user: { ...data().user, balance: 1n * 10n ** 18n }, allowance: 1_000_000n });
  const p = subscriptionPlan(d, to, rate, 1, account);
  assert.equal(p.deposit, 0n);
  assert.equal(p.needsApproval, false);
  assert.equal(
    subscriptionStep({ ...flow, months: 1, deposit: "0" }, [], d, account).step,
    "subscribe",
  );
});
test("rate updates replace an existing rate and do not add an extra subscription", () => {
  const d = data({
    user: { ...data().user, outgoingRate: rate },
    subscriptions: { [to]: { outgoing: rate } },
  });
  assert.equal(subscriptionPlan(d, to, rate * 2n, 1, account).outgoing, rate * 2n);
  for (const bad of [account, "0x" + "0".repeat(40), "invalid"])
    assert.throws(() => subscriptionPlan(d, bad, rate, 1, account));
});
test("deposit confirmation gates subscribe; pending/recovering never re-send and rejection retries only the failed step", () => {
  const d = data({ allowance: plan.target });
  assert.equal(subscriptionStep(flow, [row("approval")], d, account).step, "deposit");
  for (const status of [
    "awaiting_signature",
    "submitted",
    "confirming",
    "rpc_unknown",
    "recovering",
  ])
    assert.equal(
      subscriptionStep(flow, [row("deposit", status), row("approval")], d, account).step,
      "wait",
    );
  assert.equal(
    subscriptionStep(flow, [row("deposit", "rejected"), row("approval")], d, account).step,
    "deposit",
  );
  const funded = data({
    user: { ...d.user, balance: plan.deposit * SCALE },
    allowance: plan.refill,
  });
  assert.equal(
    subscriptionStep(flow, [row("subscribe", "rejected"), row("deposit")], funded, account).step,
    "subscribe",
  );
  assert.equal(
    subscriptionStep(flow, [row("subscribe"), row("deposit")], funded, account).step,
    "wait",
  );
  assert.equal(subscriptionProgress(flow, [row("subscribe")]).phase, "success");
  assert.throws(() => subscriptionStep(flow, [row("deposit")], d, account), /more reserve/);
  assert.throws(() => subscriptionStep(flow, [], data(), account), /Allowance changed/);
});
test("flow reload validates scope data and waits for unknown hashless transactions", () => {
  assert.deepEqual(restoreSubscription({ getItem: () => JSON.stringify(flow) }, "scope"), flow);
  for (const patch of [
    { rate: "0" },
    { deposit: "-1" },
    { months: 2 },
    { to: "oops" },
    { stage: "send" },
  ])
    assert.equal(
      restoreSubscription({ getItem: () => JSON.stringify({ ...flow, ...patch }) }, "scope"),
      null,
    );
  assert.equal(
    subscriptionProgress(flow, [{ ...row("deposit", "rpc_unknown"), hash: null }]).phase,
    "unknown",
  );
  assert.equal(
    subscriptionProgress(flow, [{ ...row("subscribe"), flowId: "another" }]).phase,
    "ready",
  );
});
test("approval/deposit/subscribe receipts and flow metadata survive RPC failure and reload without repeated deposits", async () => {
  const map = new Map(),
    storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
  let fail = false,
    sends = 0;
  const args = {
    config: { chainId: 5042, papaya: to },
    account,
    storage,
    schedule: () => 0,
    cancel: () => {},
    receipt: async () => {
      if (fail) throw Error("offline");
      return { status: 1, blockNumber: 42 };
    },
  };
  const tx = new Transactions(args);
  const send = async (step) => {
    await tx.submit(
      step,
      async () => ({ hash: "0x" + (++sends).toString(16).padStart(64, "0") }),
      null,
      { flowId: "flow", step: `stream-${step}` },
    );
    await tx.reconcile();
  };
  await send("approval");
  fail = true;
  await send("deposit");
  assert.equal(subscriptionStep(flow, tx.rows, data(), account).step, "wait");
  tx.stop();
  const restored = new Transactions(args);
  fail = false;
  await restored.start();
  const funded = data({
    user: { ...data().user, balance: plan.deposit * SCALE },
    allowance: plan.refill,
  });
  assert.equal(subscriptionStep(flow, restored.rows, funded, account).step, "subscribe");
  await restored.submit(
    "Subscribe",
    async () => ({ hash: "0x" + (++sends).toString(16).padStart(64, "0") }),
    null,
    { flowId: "flow", step: "stream-subscribe" },
  );
  await restored.reconcile();
  assert.equal(subscriptionProgress(flow, restored.rows).phase, "success");
  assert.equal(sends, 3);
  restored.stop();
});
const event = (name, block, index, from = account) => ({
  fragment: { name },
  blockNumber: block,
  index,
  args: { user: from, encodedRates: (7n << 96n) | 6n },
});
test("incoming table follows create/update/revoke events, including liquidations, in chain order", () => {
  const rows = applyIncoming({}, [
    event("StreamRevoked", 3, 0),
    event("StreamCreated", 2, 0),
    event("StreamCreated", 3, 1),
  ]);
  assert.equal(rows[account].income, "6");
  assert.equal(rows[account].outgoing, "7");
  assert.deepEqual(applyIncoming(rows, [event("StreamRevoked", 4, 0)]), {});
});
test("incoming pagination advances only after successful query and preserves rows on failure", async () => {
  const previous = { [account]: { income: "6", outgoing: "7", projectId: "0" } };
  let pages = 0;
  const result = await scanIncoming({
    from: 10,
    head: 100,
    rows: previous,
    pageSize: 20,
    read: async (a, b) => {
      assert.equal(a, 10);
      assert.equal(b, 29);
      return [];
    },
    onPage: () => pages++,
  });
  assert.equal(result.cursor, 30);
  assert.equal(result.complete, false);
  assert.equal(pages, 1);
  await assert.rejects(
    scanIncoming({
      from: 30,
      head: 100,
      rows: previous,
      read: async () => {
        throw Error("RPC");
      },
      onPage: () => pages++,
    }),
  );
  assert.equal(pages, 1);
  assert.equal(previous[account].income, "6");
  assert.equal(
    await scanIncoming({ from: 30, head: 100, read: async () => [], stopped: () => true }),
    null,
  );
});
