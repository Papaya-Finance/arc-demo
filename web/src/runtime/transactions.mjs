import { readStored, writeStored, scopeKey } from "./storage.mjs";
import { decodeRevertName, readableError } from "./rpc.mjs";
const terminal = new Set(["confirmed", "reverted", "rejected", "failed"]);
const statuses = new Set([
  "awaiting_signature",
  "submitted",
  "confirming",
  "confirmed",
  "reverted",
  "rejected",
  "failed",
  "rpc_unknown",
  "recovering",
]);
const validHash = (value) => /^0x[0-9a-fA-F]{64}$/.test(value || "");
function failurePatch(error) {
  const rejected =
    [4001, "ACTION_REJECTED"].includes(error?.code) || error?.info?.error?.code === 4001;
  if (rejected) return { status: "rejected", detail: readableError(error), hash: null };
  // Preflight/staticCall and wallet estimate reverts: show decoded reason, not rpc_unknown.
  if (
    decodeRevertName(error) ||
    error?.code === "CALL_EXCEPTION" ||
    error?.shortMessage?.includes("execution reverted")
  )
    return { status: "failed", detail: readableError(error), hash: null };
  // No hash means nothing is onchain to recover; keep as a terminal failure.
  return { status: "failed", detail: readableError(error), hash: null };
}
export class Transactions {
  constructor({
    config,
    account,
    storage,
    receipt,
    onChange = () => {},
    onConfirmed = () => {},
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    interval = 2500,
  }) {
    Object.assign(this, {
      config,
      account,
      storage,
      receipt,
      onChange,
      onConfirmed,
      schedule,
      cancel,
      interval,
    });
    this.key = `papaya:transactions:${scopeKey(config, account)}`;
    const saved = readStored(storage, this.key, []);
    this.rows = (Array.isArray(saved) ? saved : [])
      .filter(
        (r) =>
          r &&
          typeof r.id === "string" &&
          typeof r.label === "string" &&
          statuses.has(r.status) &&
          (!r.hash || validHash(r.hash)) &&
          (r.detail == null || typeof r.detail === "string"),
      )
      .map((r) => {
        // Hashless non-terminal rows cannot be reconciled: nothing was journaled
        // onchain. Finalize them so reload does not look like an active wallet wait.
        if (
          r.status === "awaiting_signature" ||
          (!r.hash && ["rpc_unknown", "recovering"].includes(r.status))
        )
          return {
            ...r,
            status: "failed",
            detail:
              r.detail ||
              (r.status === "awaiting_signature"
                ? "Interrupted before a transaction hash was returned"
                : "No hash returned. Check your wallet before retrying."),
          };
        return r;
      });
    this.callbacks = new Map();
    this.failures = 0;
  }
  emit() {
    writeStored(this.storage, this.key, this.rows);
    if (!this.stopped) this.onChange([...this.rows]);
  }
  patch(id, patch) {
    this.rows = this.rows.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r));
    this.emit();
  }
  start() {
    this.emit();
    return this.reconcile();
  }
  async submit(label, send, after, context = {}) {
    if (this.signing || this.rows.some((r) => r.hash && !terminal.has(r.status))) return;
    this.signing = true;
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    this.rows.unshift({
      id,
      label,
      status: "awaiting_signature",
      hash: null,
      detail: null,
      createdAt: Date.now(),
      ...(typeof context.flowId === "string" ? { flowId: context.flowId } : {}),
      ...(typeof context.step === "string" ? { step: context.step } : {}),
    });
    this.emit();
    try {
      const tx = await send();
      if (!validHash(tx?.hash)) throw Error("Wallet returned no transaction hash");
      // Journal before the first receipt request. Never re-send after a network failure.
      if (after) this.callbacks.set(id, after);
      this.patch(id, { hash: tx.hash, status: "submitted", detail: null });
      this.signing = false;
      void this.reconcile();
      return tx.hash;
    } catch (error) {
      this.patch(id, failurePatch(error));
      throw error;
    } finally {
      this.signing = false;
    }
  }
  reconcile() {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.cancel(this.timer);
    this.running = this.cycle().finally(() => {
      this.running = null;
      if (this.stopped) return;
      if (this.queued) {
        this.queued = false;
        void this.reconcile();
      } else if (this.rows.some((r) => r.hash && !terminal.has(r.status)))
        this.timer = this.schedule(
          () => this.reconcile(),
          Math.min(this.interval * 2 ** this.failures, 30000),
        );
    });
    return this.running;
  }
  async cycle() {
    let failed = false;
    for (const row of [...this.rows]) {
      if (this.stopped || !row.hash || terminal.has(row.status)) continue;
      this.patch(row.id, {
        status: ["rpc_unknown", "recovering"].includes(row.status) ? "recovering" : "confirming",
      });
      let receipt;
      try {
        receipt = await this.receipt(row.hash);
      } catch {
        failed = true;
        this.patch(row.id, { status: "rpc_unknown" });
        continue;
      }
      if (!receipt) {
        this.patch(row.id, { status: "confirming" });
        continue;
      }
      if (![0, 1, 0n, 1n, "0x0", "0x1"].includes(receipt.status)) {
        failed = true;
        this.patch(row.id, { status: "rpc_unknown" });
        continue;
      }
      const confirmed = BigInt(receipt.status) === 1n;
      this.patch(row.id, {
        status: confirmed ? "confirmed" : "reverted",
        blockNumber: receipt.blockNumber,
      });
      // Receipt finality is independent of optional timer/history refresh failures.
      if (confirmed && !this.stopped) {
        try {
          await this.onConfirmed(receipt, row);
        } catch {
          /* next read cycle retries */
        }
        try {
          await this.callbacks.get(row.id)?.(receipt);
        } catch {
          /* never downgrade confirmed */
        }
      }
      this.callbacks.delete(row.id);
    }
    this.failures = failed ? this.failures + 1 : 0;
  }
  stop() {
    this.stopped = true;
    this.cancel(this.timer);
  }
}
