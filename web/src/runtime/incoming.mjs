import { decodeRates } from "../../../scripts/math.mjs";
// Replay indexed events in chain order. This includes arbitrary recipients and
// liquidations, whose StreamRevoked events remove the original subscriptions.
export function applyIncoming(previous, events) {
  const next = { ...previous };
  for (const event of [...events].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
  )) {
    const from = event.args.user.toLowerCase();
    if (event.fragment.name === "StreamRevoked") delete next[from];
    else {
      const rates = decodeRates(BigInt(event.args.encodedRates));
      next[from] = {
        income: rates.income.toString(),
        outgoing: rates.outgoing.toString(),
        projectId: rates.projectId.toString(),
      };
    }
  }
  return next;
}
export async function scanIncoming({
  read,
  from,
  head,
  rows = {},
  pageSize = 2000,
  onPage = () => {},
  stopped = () => false,
}) {
  let next = { ...rows },
    cursor = from;
  // One bounded page per call: UI can yield and retry from the last successful page.
  const end = Math.min(head, cursor + pageSize - 1);
  if (cursor <= head) {
    const events = await read(cursor, end);
    if (stopped()) return null;
    next = applyIncoming(next, events);
    cursor = end + 1;
    onPage({ rows: next, cursor });
  }
  return { rows: next, cursor, complete: cursor > head };
}
