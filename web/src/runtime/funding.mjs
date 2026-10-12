import { flowProgress } from "./flow.mjs";
// ERC-20 amounts are integer micro-USDC. deposit() calls transferFrom and
// consumes D from the current USDC allowance.
export function fundingPlan(deposit, allowance) {
  if (deposit <= 0n || allowance < 0n) throw Error("Enter an amount above 0");
  const needsApproval = allowance < deposit;
  return {
    deposit,
    target: deposit,
    needsApproval,
    remaining: (needsApproval ? deposit : allowance) - deposit,
  };
}
export function fundingProgress(flow, rows) {
  return flowProgress(flow, rows, { completeStep: "deposit" });
}
export function restoreFunding(storage, key) {
  try {
    const f = JSON.parse(storage?.getItem(key) || "null");
    if (!f || typeof f.id !== "string" || !/^\d+$/.test(f.deposit)) return null;
    fundingPlan(BigInt(f.deposit), 0n);
    return { id: f.id, deposit: f.deposit };
  } catch {
    return null;
  }
}
