import { flowProgress } from "./flow.mjs";
// User-facing withdraw amounts are micro-USDC (6 decimals). The Papaya
// contract stores balances at 18 decimals (micro * SCALE).
export function withdrawProgress(flow, rows) {
  return flowProgress(flow, rows, { completeStep: "withdraw" });
}

export function restoreWithdraw(storage, key) {
  try {
    const f = JSON.parse(storage?.getItem(key) || "null");
    if (!f || typeof f.id !== "string" || !/^\d+$/.test(f.amount)) return null;
    if (BigInt(f.amount) <= 0n) return null;
    return { id: f.id, amount: f.amount };
  } catch {
    return null;
  }
}
