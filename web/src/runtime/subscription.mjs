import { flowProgress } from "./flow.mjs";
import { isAddress, ZeroAddress } from "ethers";
import {
  MONTH,
  SCALE,
  ceilDiv,
  minimumBalance,
  streamBalance,
  allowanceFor,
} from "../../../scripts/math.mjs";

export function subscriptionPlan(data, to, rate, months = 1, account = "") {
  if (!isAddress(to) || to === ZeroAddress || to.toLowerCase() === account.toLowerCase())
    throw Error("Choose another wallet as recipient");
  if (rate <= 0n || rate >= 2n ** 96n) throw Error("Choose a valid subscription rate");
  if (!data?.user) throw Error("Wait for your account balance");
  const current = data.subscriptions?.[to.toLowerCase()];
  const outgoing = data.user.outgoingRate - (current?.outgoing || 0n) + rate;
  const count = BigInt(Object.keys(data.subscriptions || {}).length + (current ? 0 : 1));
  const balance = streamBalance(data.user, data.timestamp);
  // Keep a margin for streaming during wallet confirmations and fluctuating gas.
  const reserve =
    minimumBalance(
      outgoing,
      data.user.incomeRate,
      count,
      ((data.baseFee || 20_000_000_000n) * 120n) / 100n,
    ) +
    outgoing * 300n;
  const net = outgoing > data.user.incomeRate ? outgoing - data.user.incomeRate : 0n;
  const initial = reserve > net * MONTH ? reserve : net * MONTH;
  const deposit = initial > balance ? ceilDiv(initial - balance, SCALE) : 0n;
  // months = total coverage budget (deposit already funds the first period).
  const coverage = allowanceFor(outgoing, data.user.incomeRate, months);
  const refill = coverage > deposit ? coverage - deposit : 0n;
  const target = deposit + refill;
  return {
    deposit,
    refill,
    target,
    reserve,
    balance,
    outgoing,
    needsApproval: data.allowance < target,
    enoughWallet: data.external >= deposit,
  };
}
export function subscriptionProgress(flow, rows) {
  return flowProgress(flow, rows, {
    completeStep: "stream-subscribe",
    empty: "ready",
    confirmed: "ready",
  });
}
export function subscriptionStep(flow, rows, data, account) {
  const progress = subscriptionProgress(flow, rows);
  if (["pending", "unknown", "success"].includes(progress.phase)) return { step: "wait" };
  const plan = subscriptionPlan(data, flow.to, BigInt(flow.rate), flow.months, account);
  const deposited = progress.rows.some(
    (r) => r.step === "stream-deposit" && r.status === "confirmed",
  );
  if (flow.stage !== "review") return { step: "allowance", plan };
  if (!deposited && plan.deposit > BigInt(flow.deposit))
    throw Error("Balances changed. Go back to review the deposit and allowance.");
  // After deposit, only the post-deposit remainder of the approved target must remain.
  const allowanceNeeded = deposited
    ? BigInt(flow.target) - BigInt(flow.deposit)
    : BigInt(flow.target);
  if (!deposited && BigInt(flow.deposit) > 0n) {
    if (data.external < BigInt(flow.deposit))
      throw Error(
        "Not enough USDC in your wallet for this deposit. Add wallet USDC, then continue.",
      );
    if (data.allowance < allowanceNeeded)
      throw Error("Allowance changed. Go back to review the spending permission.");
    return { step: "deposit", amount: BigInt(flow.deposit), plan };
  }
  if (plan.balance < plan.reserve)
    throw Error("The stream needs more reserve. Add funds in Controls, then continue.");
  if (data.allowance < allowanceNeeded)
    throw Error("Allowance changed. Review the spending permission in Controls, then continue.");
  return { step: "subscribe", plan };
}
export function restoreSubscription(storage, key) {
  try {
    const f = JSON.parse(storage?.getItem(key) || "null");
    if (
      !f ||
      typeof f.id !== "string" ||
      !isAddress(f.to) ||
      f.to === ZeroAddress ||
      !["creator", "scooter", "custom"].includes(f.kind) ||
      !["allowance", "review"].includes(f.stage) ||
      ![1, 3, 6, 12].includes(f.months)
    )
      return null;
    for (const field of ["rate", "deposit", "target"]) if (!/^\d+$/.test(f[field])) return null;
    if (BigInt(f.rate) <= 0n || BigInt(f.rate) >= 2n ** 96n) return null;
    return f;
  } catch {
    return null;
  }
}
