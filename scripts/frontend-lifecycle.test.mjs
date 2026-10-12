import test from "node:test";
import assert from "node:assert/strict";
import { WalletSession, createWalletConnector } from "../web/src/runtime/wallet.mjs";
const config = {
  chainId: 5042,
  papaya: "0x" + "3".repeat(40),
  rpcUrl: "https://rpc.example.invalid",
  explorer: "https://explorer.arc.io",
};
const account = "0x" + "1".repeat(40);
const storage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
};
function provider() {
  const listeners = new Map();
  return {
    listeners,
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    removeListener: (event, fn) => listeners.get(event)?.delete(fn),
    request: async ({ method }) => (method === "eth_chainId" ? "0x13b2" : [account]),
  };
}
const count = (raw) => [...raw.listeners.values()].reduce((n, set) => n + set.size, 0);
const session = (raw, store = storage()) =>
  new WalletSession({
    config,
    storage: store,
    makeProvider: () => ({ getSigner: async () => ({ address: account }), destroy() {} }),
  });
test("thirty mount/disconnect/remount cycles reuse AppKit and remove all owned listeners", async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost" } };
  const raw = provider(),
    callbacks = { providers: new Set(), accounts: new Set() };
  let instances = 0,
    adapters = 0;
  const modal = {
    getWalletProvider: () => raw,
    open: async () => {},
    disconnect: async () => {},
    subscribeProviders: (fn) => {
      callbacks.providers.add(fn);
      return () => callbacks.providers.delete(fn);
    },
    subscribeAccount: (fn) => {
      callbacks.accounts.add(fn);
      return () => callbacks.accounts.delete(fn);
    },
  };
  const factory = () => {
    instances++;
    return modal;
  };
  const sdk = async () => [
    { createAppKit: factory },
    {
      EthersAdapter: class {
        constructor() {
          adapters++;
        }
      },
    },
  ];
  try {
    for (let i = 0; i < 30; i++) {
      const wallet = session(raw),
        connector = await createWalletConnector(config, wallet, "fixture", sdk);
      assert.equal(count(raw), 4);
      assert.equal(callbacks.providers.size, 1);
      assert.equal(callbacks.accounts.size, 1);
      await connector.open();
      await connector.disconnect();
      connector.destroy();
      connector.destroy();
      assert.equal(count(raw), 0);
      assert.equal(callbacks.providers.size, 0);
      assert.equal(callbacks.accounts.size, 0);
    }
    assert.equal(instances, 1);
    assert.equal(adapters, 1);
  } finally {
    globalThis.window = previous;
  }
});
test("aborted SDK initialization never creates adapters or attaches wallet listeners", async () => {
  const controller = new AbortController(),
    raw = provider(),
    wallet = session(raw);
  let resolve,
    created = 0;
  const sdk = new Promise((r) => (resolve = r));
  const loading = createWalletConnector(config, wallet, "fixture", () => sdk, {
    signal: controller.signal,
  });
  controller.abort();
  wallet.destroy();
  resolve([
    {
      createAppKit: () => {
        created++;
      },
    },
    { EthersAdapter: class {} },
  ]);
  await assert.rejects(loading, { name: "AbortError" });
  assert.equal(created, 0);
  assert.equal(count(raw), 0);
  await wallet.attach(raw);
  assert.equal(count(raw), 0);
});
test("new runtime detaches old SDK subscriptions instead of doubling provider listeners", async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost" } };
  const raw = provider();
  let observers = 0;
  const factory = () => ({
    getWalletProvider: () => raw,
    subscribeProviders: () => {
      observers++;
      return () => observers--;
    },
    subscribeAccount: () => {
      observers++;
      return () => observers--;
    },
  });
  const sdk = async () => [{ createAppKit: factory }, { EthersAdapter: class {} }];
  try {
    const first = await createWalletConnector(config, session(raw), "fixture", sdk);
    const second = await createWalletConnector(config, session(raw), "fixture", sdk);
    assert.equal(count(raw), 4);
    assert.equal(observers, 2);
    first.destroy();
    assert.equal(observers, 2);
    second.destroy();
    assert.equal(count(raw), 0);
    assert.equal(observers, 0);
  } finally {
    globalThis.window = previous;
  }
});
test("overlapping initialization has one listener owner while signer restoration is pending", async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost" } };
  const raw = provider();
  let observers = 0,
    finish,
    started;
  const signerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const slowSigner = new Promise((resolve) => {
    finish = resolve;
  });
  const factory = () => ({
    getWalletProvider: () => raw,
    subscribeProviders: () => {
      observers++;
      return () => observers--;
    },
    subscribeAccount: () => {
      observers++;
      return () => observers--;
    },
  });
  const sdk = async () => [{ createAppKit: factory }, { EthersAdapter: class {} }];
  const slow = new WalletSession({
    config,
    storage: storage(),
    makeProvider: () => ({
      getSigner: () => {
        started();
        return slowSigner;
      },
      destroy() {},
    }),
  });
  try {
    const pending = createWalletConnector(config, slow, "fixture", sdk);
    await signerStarted;
    const second = await createWalletConnector(config, session(raw), "fixture", sdk);
    assert.equal(observers, 2);
    assert.equal(count(raw), 4);
    finish({ address: account });
    const first = await pending;
    first.destroy();
    assert.equal(observers, 2);
    second.destroy();
    assert.equal(observers, 0);
    assert.equal(count(raw), 0);
  } finally {
    finish?.({ address: account });
    globalThis.window = previous;
  }
});
