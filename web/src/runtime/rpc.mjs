import { Contract, Interface } from "ethers";
import { papayaAbi, tokenAbi } from "../../../scripts/abi.mjs";
import { decodeRates } from "../../../scripts/math.mjs";
import { createPool, retryable } from "./read-pool.mjs";
const errorMessages = {
  TopUpBalance: "Add a deposit: the stream needs a two-day reserve plus liquidation gas.",
  ReduceTheAmount:
    "Keep the required reserve while a stream is active. Stop the stream to withdraw more.",
  InsufficialBalance: "Your Papaya balance is too low.",
  NotLegal: "That action is not allowed for this account.",
  NotSubscribed: "No active stream to stop.",
  NotLiquidatable: "This account is not eligible for liquidation yet.",
  ExcessOfSubscriptions: "Subscription limit reached.",
};
const errorInterface = new Interface([...papayaAbi, ...tokenAbi]);
function revertData(value, depth = 0) {
  if (value == null || depth > 6) return null;
  if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) return value;
  if (typeof value !== "object") return null;
  for (const key of ["data", "data.data", "body"]) {
    const next =
      key === "data.data" ? value?.data?.data : key === "body" ? value?.body : value?.[key];
    const found = revertData(next, depth + 1);
    if (found) return found;
  }
  for (const nested of [value.info?.error, value.error, value.cause, value.info]) {
    const found = revertData(nested, depth + 1);
    if (found) return found;
  }
  return null;
}
export function decodeRevertName(error) {
  if (error?.revert?.name) return error.revert.name;
  const reason = error?.reason;
  if (typeof reason === "string") {
    const match = reason.match(/^([A-Za-z_][A-Za-z0-9_]*)\(/);
    if (match && errorMessages[match[1]]) return match[1];
    if (errorMessages[reason]) return reason;
  }
  const data = revertData(error);
  if (!data) return null;
  try {
    return errorInterface.parseError(data)?.name || null;
  } catch {
    return null;
  }
}
export function rpcUrls(config, env = {}) {
  // A localhost fork must never fall back to a mainnet endpoint.
  if (config.chainId !== 5042) return [config.rpcUrl];
  const primary = env.VITE_ARC_RPC_URL || config.readRpcUrl || config.rpcUrl;
  const fallback = env.VITE_ARC_RPC_FALLBACK_URL ?? config.rpcFallbackUrl ?? config.rpcUrl;
  return [...new Set([primary, fallback].filter(Boolean))];
}
export const transient = retryable;
export function readableError(error) {
  // Never expose an endpoint credential through nested provider errors.
  const name = decodeRevertName(error);
  if (name && errorMessages[name]) return errorMessages[name];
  if (
    error?.code === "ACTION_REJECTED" ||
    error?.code === 4001 ||
    error?.info?.error?.code === 4001
  )
    return "Transaction rejected in wallet";
  if ((error?.code === "UNKNOWN_ERROR" || error?.shortMessage?.includes("coalesce")) && !name)
    return "RPC temporarily unavailable; retrying";
  const message =
    error?.reason ||
    error?.shortMessage ||
    error?.message ||
    "RPC temporarily unavailable; retrying";
  return message.replace(/https?:\/\/[^\s"'<>),]+/g, "[RPC endpoint]").slice(0, 240);
}
/** Simulate a write on the dedicated read RPC before asking the wallet to sign. */
export async function simulateWrite(provider, address, abi, method, args, from) {
  const contract = new Contract(address, abi, provider);
  return contract[method].staticCall(...args, { from });
}
export function createReadRpc(config, env = {}, options = {}) {
  return createPool(rpcUrls(config, env), config.chainId, options);
}
const userRow = (r) => ({
  balance: r[0],
  incomeRate: r[1],
  outgoingRate: r[2],
  updated: r[3],
});
export async function readAccount(provider, config, account) {
  const p = new Contract(config.papaya, papayaAbi, provider),
    token = new Contract(config.usdc, tokenAbi, provider);
  const block = await provider.getBlock("latest");
  if (!block) throw Error("RPC block unavailable");
  const opts = { blockTag: block.number };
  const [creator, scooter, feeOwner, fee, creatorFee, scooterFee] = await Promise.all([
    p.users(config.creator, opts),
    p.users(config.scooter, opts),
    p.users(config.projectOwner, opts),
    p.defaultFeeSettings(config.projectId, opts),
    p.userFeeSettings(config.projectId, config.creator, opts),
    p.userFeeSettings(config.projectId, config.scooter, opts),
  ]);
  const next = {
    creator: userRow(creator),
    scooter: userRow(scooter),
    feeOwner: userRow(feeOwner),
    fee,
    creatorFee: creatorFee || fee,
    scooterFee: scooterFee || fee,
    timestamp: BigInt(block.timestamp),
    baseFee: block.baseFeePerGas,
    block: block.number,
  };
  if (account) {
    const [user, external, allowance, subs, quote] = await Promise.all([
      p.users(account, opts),
      token.balanceOf(account, opts),
      token.allowance(account, config.papaya, opts),
      p.allSubscriptions(account, opts),
      p.refillQuote(account, opts),
    ]);
    Object.assign(next, {
      user: userRow(user),
      external,
      allowance,
      quote,
      subscriptions: Object.fromEntries(
        subs[0].map((a, i) => [a.toLowerCase(), decodeRates(subs[1][i])]),
      ),
    });
  }
  return next;
}
const historyBlockTimes = new WeakMap();
export async function readKeeperEvents(provider, config, account, block) {
  if (!account) return [];
  const p = new Contract(config.papaya, papayaAbi, provider);
  const from = Math.max(config.deploymentBlock, block - 1999);
  const events = await Promise.all([
    p.queryFilter(p.filters.Refill(account), from, block),
    p.queryFilter(p.filters.Liquidated(account), from, block),
  ]);
  let cache = historyBlockTimes.get(provider);
  if (!cache) {
    cache = new Map();
    historyBlockTimes.set(provider, cache);
  }
  for (const number of new Set(events.flat().map((e) => e.blockNumber))) {
    if (!cache.has(number)) {
      try {
        const b = await provider.getBlock(number);
        if (b) cache.set(number, b.timestamp * 1000);
      } catch {
        /* Dates are optional; never discard logs. */
      }
    }
  }
  for (const number of cache.keys()) if (number < from) cache.delete(number);
  return events.flat().map((e) => ({
    hash: e.transactionHash,
    label: e.fragment.name === "Refill" ? "Automatic refill" : "Liquidation",
    status: "confirmed",
    blockNumber: e.blockNumber,
    logIndex: e.index,
    createdAt: cache.get(e.blockNumber) ?? null,
  }));
}
export function sortActivity(rows) {
  return [...rows].sort((a, b) => {
    const aBlock = a.blockNumber != null ? Number(a.blockNumber) : null;
    const bBlock = b.blockNumber != null ? Number(b.blockNumber) : null;
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (aBlock != null && bBlock != null) {
      if (bBlock !== aBlock) return bBlock - aBlock;
      return (Number(b.logIndex) || 0) - (Number(a.logIndex) || 0);
    }
    // Dated entries sort newest first across wallet transactions and keeper logs.
    // Legacy undated rows retain their previous block/pending fallback ordering.
    if (aBlock == null && bBlock == null) return (b.createdAt || 0) - (a.createdAt || 0);
    return aBlock == null ? -1 : 1;
  });
}
// One worker across account changes. A generation invalidates late responses;
// queued refresh requests run only after the existing worker finishes.
export class ReadState {
  constructor({
    read,
    events,
    onChange = () => {},
    interval = 15000,
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
  }) {
    Object.assign(this, { read, events, onChange, interval, schedule, cancel });
    this.account = "";
    this.generation = 0;
    this.cache = new Map();
    this.state = {
      account: "",
      status: "loading",
      data: null,
      events: [],
      error: null,
    };
    this.failures = 0;
  }
  emit(next) {
    this.state = { ...this.state, ...next };
    this.onChange(this.state);
  }
  setAccount(account) {
    if (this.account === account.toLowerCase()) return this.refresh();
    this.account = account.toLowerCase();
    this.generation++;
    this.failures = 0;
    this.emit({
      account: this.account,
      data: this.cache.get(this.account) || null,
      events: [],
      error: null,
      status: this.cache.has(this.account) ? "stale" : "loading",
    });
    return this.refresh();
  }
  refreshAfter(blockNumber) {
    this.minimumBlock = Math.max(this.minimumBlock || 0, Number(blockNumber));
    this.emit({ status: this.state.data ? "stale" : "loading" });
    return this.refresh();
  }
  refresh() {
    if (this.stopped) return Promise.resolve();
    this.cancel(this.timer);
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.cycle().finally(() => {
      this.running = null;
      if (this.stopped) return;
      if (this.queued) {
        this.queued = false;
        this.refresh();
      } else
        this.timer = this.schedule(
          () => this.refresh(),
          Math.min(this.interval * 2 ** this.failures, 30000),
        );
    });
    return this.running;
  }
  async cycle() {
    const generation = this.generation,
      account = this.account;
    try {
      const next = await this.read(account);
      if (next.block < (this.minimumBlock || 0))
        throw Error("RPC is catching up with the confirmed transaction");
      if (this.stopped || generation !== this.generation) return;
      this.cache.set(account, next);
      this.failures = 0;
      this.emit({ data: next, status: "loaded", error: null });
      // History is optional; publish balances BEFORE querying logs.
      try {
        const events = await this.events(account, next.block);
        if (!this.stopped && generation === this.generation)
          this.emit({ events, historyError: null });
      } catch (historyError) {
        if (!this.stopped && generation === this.generation) this.emit({ historyError });
      }
    } catch (error) {
      if (!this.stopped && generation === this.generation) {
        this.failures++;
        this.emit({ status: this.state.data ? "stale" : "error", error });
      }
    }
  }
  stop() {
    this.stopped = true;
    this.generation++;
    this.cancel(this.timer);
  }
}
