export const SCALE = 10n ** 12n;
export const DAY = 86400n;
export const MONTH = 30n * DAY;
export const RATES = [4_000_000_000n, 8_000_000_000n, 12_000_000_000n];
/** Distinct from creator RATES so the two demos don't share a rate by accident. */
export const SCOOTER_RATE = 5_000_000_000n;
export const ceilDiv = (x, y) => (x + y - 1n) / y;
export const refillQuote = (netRate) => (netRate > 0n ? ceilDiv(netRate * MONTH, SCALE) : 0n);
// Round EACH monthly transfer, not the whole multi-month total. No unlimited approval.
export function allowanceFor(outgoing, income, months, depositMicro = 0n) {
  if (![1, 3, 6, 12].includes(months)) throw new Error("Invalid allowance period");
  const net = outgoing > income ? outgoing - income : 0n;
  return depositMicro + refillQuote(net) * BigInt(months);
}
export function decodeRates(encoded) {
  const mask = (1n << 96n) - 1n;
  return {
    income: encoded & mask,
    outgoing: (encoded >> 96n) & mask,
    projectId: encoded >> 192n,
  };
}
export function streamBalance(user, timestamp) {
  const elapsed = timestamp > user.updated ? timestamp - user.updated : 0n;
  return user.balance + (user.incomeRate - user.outgoingRate) * elapsed;
}
export function minimumBalance(outgoing, incoming, subscriptions, baseFee) {
  if (outgoing <= incoming) return 0n;
  return outgoing * DAY * 2n + baseFee * (160_000n + 10_000n * subscriptions);
}
