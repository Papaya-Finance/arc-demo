/** Shared journal projection. Receipt reconciliation remains owned by Transactions. */
export function flowProgress(
  flow,
  rows,
  { completeStep, empty = "review", confirmed = "continue" },
) {
  if (!flow) return { phase: "draft", rows: [] };
  const own = rows.filter((row) => row.flowId === flow.id);
  const completed = own.find((row) => row.step === completeStep && row.status === "confirmed");
  if (completed) return { phase: "success", tx: completed, rows: own };
  const tx = own[0];
  if (!tx) return { phase: empty, rows: own };
  if (["rejected", "failed", "reverted"].includes(tx.status))
    return { phase: "retry", tx, rows: own };
  if (tx.status === "rpc_unknown" && !tx.hash) return { phase: "unknown", tx, rows: own };
  return { phase: tx.status === "confirmed" ? confirmed : "pending", tx, rows: own };
}
export const confirmationBlock = (rows) =>
  Math.max(
    0,
    ...rows.filter((row) => row.status === "confirmed").map((row) => row.blockNumber || 0),
  );
