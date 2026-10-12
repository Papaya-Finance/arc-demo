import { FetchRequest, JsonRpcProvider } from "ethers";

export const RPC_POLICY = Object.freeze({
  timeout: 10000,
  transientCooldown: 1000,
  rateLimitCooldown: 30000,
  maxCooldown: 120000,
});
export function rateLimited(error) {
  return (
    [
      error?.status,
      error?.statusCode,
      error?.response?.statusCode,
      error?.info?.responseStatus,
      error?.code,
      error?.error?.code,
      error?.info?.error?.code,
    ].some((v) => Number(v) === 429 || Number(v) === -32005) ||
    /\b429\b|too many requests|rate limit/i.test(error?.message || "")
  );
}
export function retryable(error) {
  return ![
    "CALL_EXCEPTION",
    "INVALID_ARGUMENT",
    "ACTION_REJECTED",
    "WRONG_CHAIN",
    4001,
    -32602,
    -32601,
  ].includes(error?.code);
}
const stoppedError = () => Object.assign(Error("Read RPC stopped"), { code: "RPC_STOPPED" });
const coolingError = () =>
  Object.assign(Error("RPC cooling down; preserving last successful state"), {
    code: "RPC_COOLDOWN",
  });

// One health policy for account reads, receipts and the SDK balance adapter.
export function createPool(urls, chainId, { factory, wait, now = Date.now } = {}) {
  let stopped = false,
    active = "primary";
  const operations = new Map(),
    pauses = new Map();
  const delayWait =
    wait ||
    ((ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          pauses.delete(timer);
          resolve();
        }, ms);
        pauses.set(timer, resolve);
      }));
  const endpoints = urls.map((url, index) => {
    const request = new FetchRequest(url);
    request.timeout = RPC_POLICY.timeout;
    // Ethers otherwise retries 429 internally, outside our shared circuit breaker.
    request.retryFunc = async () => false;
    const provider = factory
      ? factory(url)
      : new JsonRpcProvider(request, chainId, {
          batchMaxCount: 1,
          cacheTimeout: 250,
          staticNetwork: true,
        });
    const state = {
      provider,
      role: index ? "fallback" : "primary",
      failures: 0,
      until: 0,
      verified: false,
      verifying: null,
      requests: 0,
      flights: new Map(),
    };
    const send = provider.send.bind(provider);
    provider.send = (method, params) => {
      if (stopped) return Promise.reject(stoppedError());
      const key = JSON.stringify([method, params]);
      if (state.flights.has(key)) return state.flights.get(key);
      if (now() < state.until) return Promise.reject(coolingError());
      state.requests++;
      const flight = Promise.resolve()
        .then(() => send(method, params))
        .finally(() => state.flights.delete(key));
      state.flights.set(key, flight);
      return flight;
    };
    return state;
  });
  async function run(operation, { retries = 2 } = {}) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (stopped) throw stoppedError();
      for (const state of endpoints) {
        if (now() < state.until) continue;
        try {
          if (!state.verified) {
            state.verifying ||= state.provider
              .send("eth_chainId", [])
              .then((chain) => {
                if (BigInt(chain) !== BigInt(chainId))
                  throw Object.assign(Error("Read RPC is on the wrong chain"), {
                    code: "WRONG_CHAIN",
                  });
                state.verified = true;
              })
              .finally(() => {
                state.verifying = null;
              });
            await state.verifying;
          }
          if (stopped) throw stoppedError();
          const result = await operation(state.provider);
          if (stopped) throw stoppedError();
          // Do not erase a cooldown established by another concurrent operation.
          if (state.until <= now()) state.failures = 0;
          active = state.role;
          return result;
        } catch (error) {
          if (stopped) throw stoppedError();
          if (!retryable(error)) throw error;
          last = error;
          if (state.until <= now()) {
            state.failures++;
            state.until =
              now() +
              Math.min(
                (rateLimited(error) ? RPC_POLICY.rateLimitCooldown : RPC_POLICY.transientCooldown) *
                  2 ** (state.failures - 1),
                RPC_POLICY.maxCooldown,
              );
          }
        }
      }
      const delay = Math.max(0, Math.min(...endpoints.map((s) => s.until)) - now());
      // Long rate-limit waits belong to the single reader/receipt timer, not nested retry loops.
      if (attempt === retries || delay > 2000) break;
      await delayWait(Math.max(delay, 500));
    }
    throw last || coolingError();
  }
  return {
    run(operation, options = {}) {
      if (!options.key) return run(operation, options);
      if (operations.has(options.key)) return operations.get(options.key);
      const task = run(operation, options).finally(() => operations.delete(options.key));
      operations.set(options.key, task);
      return task;
    },
    diagnostics: () => ({
      active,
      stopped,
      endpoints: endpoints.map((s) => ({
        role: s.role,
        requests: s.requests,
        cooldownMs: Math.max(0, s.until - now()),
        failures: s.failures,
      })),
    }),
    destroy() {
      stopped = true;
      for (const [timer, resolve] of pauses) {
        clearTimeout(timer);
        resolve();
      }
      pauses.clear();
      operations.clear();
      endpoints.forEach((s) => {
        s.flights.clear();
        s.provider.destroy?.();
      });
    },
  };
}
