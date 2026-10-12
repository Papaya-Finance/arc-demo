import test from "node:test";
import assert from "node:assert/strict";
import { WalletSession } from "../web/src/runtime/wallet.mjs";
import { ReadState, createReadRpc, rpcUrls } from "../web/src/runtime/rpc.mjs";
import { Transactions } from "../web/src/runtime/transactions.mjs";
const A = "0x" + "11".repeat(20),
  B = "0x" + "22".repeat(20),
  hash = "0x" + "ab".repeat(32);
const config = {
  chainId: 5042,
  papaya: "0x" + "33".repeat(20),
  rpcUrl: "https://public.invalid",
  explorer: "https://explorer.arc.io",
};
const storage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key),
    setItem: (key, value) => map.set(key, value),
  };
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const noTimer = () => 0;
const flush = () => new Promise((resolve) => setImmediate(resolve));
function wallet() {
  const listeners = new Map(),
    calls = [];
  const raw = {
    accounts: [A],
    chain: "0x13b2",
    calls,
    on(event, fn) {
      const set = listeners.get(event) || new Set();
      set.add(fn);
      listeners.set(event, set);
    },
    removeListener(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, value) {
      for (const fn of listeners.get(event) || []) fn(value);
    },
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return this.accounts;
      if (method === "eth_chainId") return this.chain;
      if (method === "wallet_switchEthereumChain") {
        this.chain = params[0].chainId;
        return;
      }
      throw Error(method);
    },
  };
  return raw;
}
const providerFactory = () => {
  let index = 0;
  return (raw) => ({
    id: ++index,
    getSigner: async (account) => ({ account, raw, id: index }),
    destroy() {},
  });
};
test("wallet connects, disconnects, stays disconnected on reload, reconnects explicitly", async () => {
  const saved = storage(),
    raw = wallet(),
    makeProvider = providerFactory();
  const session = new WalletSession({ config, storage: saved, makeProvider });
  await session.attach(raw, { request: true });
  assert.equal(session.state.account, A);
  assert.equal(session.state.status, "connected");
  session.clear(true);
  assert.equal(session.state.account, "");
  assert.equal(session.state.signer, null);
  const reload = new WalletSession({ config, storage: saved, makeProvider });
  await reload.attach(raw, { restore: true });
  assert.equal(reload.state.account, "");
  await reload.attach(raw, { request: true });
  assert.equal(reload.state.account, A);
  reload.destroy();
});
test("reload restores a permitted wallet without requesting permission again", async () => {
  const raw = wallet(),
    saved = storage(),
    makeProvider = providerFactory();
  const first = new WalletSession({ config, storage: saved, makeProvider });
  await first.attach(raw, { request: true });
  first.destroy();
  raw.calls.length = 0;
  const next = new WalletSession({ config, storage: saved, makeProvider });
  await next.attach(raw, { restore: true });
  assert.equal(next.state.account, A);
  assert.equal(raw.calls.includes("eth_requestAccounts"), false);
  next.destroy();
});
test("accountsChanged replaces signer; chainChanged rebuilds it and recovers from a wrong chain", async () => {
  const raw = wallet(),
    session = new WalletSession({
      config,
      storage: storage(),
      makeProvider: providerFactory(),
    });
  await session.attach(raw, { request: true });
  const first = session.state.signer;
  raw.accounts = [B];
  raw.emit("accountsChanged", [B]);
  await flush();
  assert.equal(session.state.account, B);
  assert.notEqual(session.state.signer, first);
  raw.chain = "0x1";
  raw.emit("chainChanged", raw.chain);
  await flush();
  assert.equal(session.state.account, B);
  assert.equal(session.state.status, "wrong_chain");
  assert.equal(session.state.signer, null);
  raw.chain = "0x13b2";
  raw.emit("chainChanged", raw.chain);
  await flush();
  assert.equal(session.state.status, "connected");
  assert.equal(session.state.signer.account, B);
  raw.accounts = [];
  raw.emit("accountsChanged", []);
  await flush();
  assert.equal(session.state.account, "");
  session.destroy();
});
test("late wallet signer cannot restore an old account after disconnect", async () => {
  const gate = deferred(),
    raw = wallet();
  const session = new WalletSession({
    config,
    storage: storage(),
    makeProvider: () => ({ getSigner: () => gate.promise, destroy() {} }),
  });
  const started = session.attach(raw);
  await flush();
  session.clear(true);
  gate.resolve({ account: A });
  await started;
  assert.equal(session.state.account, "");
  assert.equal(session.state.signer, null);
});
test("temporary read failures retain last good data; recovery clears stale state", async () => {
  let fail = false,
    value = 7n;
  const reader = new ReadState({
    read: async () => {
      if (fail) throw Error("temporary");
      return { balance: value, block: 1 };
    },
    events: async () => [],
    schedule: noTimer,
  });
  await reader.refresh();
  assert.equal(reader.state.status, "loaded");
  fail = true;
  await reader.refresh();
  assert.equal(reader.state.data.balance, 7n);
  assert.equal(reader.state.status, "stale");
  fail = false;
  value = 9n;
  await reader.refresh();
  assert.equal(reader.state.data.balance, 9n);
  assert.equal(reader.state.status, "loaded");
  assert.equal(reader.state.error, null);
  reader.stop();
});
test("failed event history never erases successful balances or previous events", async () => {
  let fail = false,
    value = 1n;
  const reader = new ReadState({
    read: async () => ({ balance: value++, block: 1 }),
    events: async () => {
      if (fail) throw Error("getLogs failed");
      return [{ hash }];
    },
    schedule: noTimer,
  });
  await reader.refresh();
  fail = true;
  await reader.refresh();
  assert.equal(reader.state.data.balance, 2n);
  assert.equal(reader.state.status, "loaded");
  assert.deepEqual(reader.state.events, [{ hash }]);
  reader.stop();
});
test("refreshes never overlap and obsolete account reads cannot publish", async () => {
  const gate = deferred();
  let active = 0,
    maximum = 0,
    calls = 0;
  const reader = new ReadState({
    read: async (account) => {
      active++;
      maximum = Math.max(active, maximum);
      if (!calls++) await gate.promise;
      active--;
      return { account, block: 1 };
    },
    events: async () => [],
    schedule: noTimer,
  });
  const first = reader.setAccount(A);
  reader.refresh();
  reader.setAccount(B);
  gate.resolve();
  await first;
  await flush();
  assert.equal(maximum, 1);
  assert.equal(reader.state.data.account, B.toLowerCase());
  reader.stop();
});
test("RPC retries and falls back without using wallet RPC or accepting a wrong chain", async () => {
  const urls = [],
    delays = [];
  const pool = createReadRpc(
    config,
    { VITE_ARC_RPC_URL: "https://primary.invalid" },
    {
      factory: (url) => ({ url, send: async () => "0x13b2" }),
      wait: async (ms) => delays.push(ms),
    },
  );
  const value = await pool.run((p) => {
    urls.push(p.url);
    if (p.url.includes("primary"))
      throw Object.assign(Error("coalesce"), { code: "UNKNOWN_ERROR" });
    return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(urls, ["https://primary.invalid", config.rpcUrl]);
  pool.destroy();
  const wrong = createReadRpc(config, {}, { factory: () => ({ send: async () => "0x1" }) });
  await assert.rejects(
    wrong.run(() => 1),
    /wrong chain/,
  );
  wrong.destroy();
  assert.deepEqual(
    rpcUrls(
      { ...config, chainId: 31337, rpcUrl: "http://localhost:8545" },
      { VITE_ARC_RPC_URL: "https://primary.invalid" },
    ),
    ["http://localhost:8545"],
  );
});
function txManager(options = {}) {
  return new Transactions({
    config,
    account: A,
    storage: storage(),
    receipt: async () => null,
    schedule: noTimer,
    ...options,
  });
}
test("rejection before hash is terminal and does not poll receipts", async () => {
  let reads = 0;
  const manager = txManager({
    receipt: async () => {
      reads++;
    },
  });
  await assert.rejects(
    manager.submit("Deposit", async () => {
      throw Object.assign(Error("Rejected"), { code: 4001 });
    }),
  );
  assert.equal(manager.rows[0].status, "rejected");
  assert.equal(manager.rows[0].hash, null);
  await manager.reconcile();
  assert.equal(reads, 0);
});
test("hash → receipt RPC failure → recovery confirms without resending", async () => {
  const states = [];
  let sendCount = 0,
    fail = true,
    confirmed = 0;
  const manager = txManager({
    receipt: async () => {
      if (fail) throw Error("temporary RPC outage");
      return { status: 1, blockNumber: 99 };
    },
    onChange: (rows) => states.push(rows[0]?.status),
    onConfirmed: () => {
      confirmed++;
    },
  });
  await manager.submit("Deposit", async () => {
    sendCount++;
    return { hash };
  });
  await manager.running;
  assert.equal(manager.rows[0].status, "rpc_unknown");
  fail = false;
  await manager.reconcile();
  assert.equal(manager.rows[0].status, "confirmed");
  assert.equal(sendCount, 1);
  assert.equal(confirmed, 1);
  for (const status of [
    "awaiting_signature",
    "submitted",
    "confirming",
    "rpc_unknown",
    "recovering",
    "confirmed",
  ])
    assert.ok(states.includes(status), status);
});
test("hashless rpc_unknown rows finalize as failed on reload and are not recoverable", async () => {
  const saved = storage();
  const key = `papaya:transactions:${config.chainId}:${config.papaya.toLowerCase()}:${A.toLowerCase()}`;
  saved.setItem(
    key,
    JSON.stringify([
      {
        id: "dead-1",
        label: "Withdraw",
        status: "rpc_unknown",
        hash: null,
        detail: "No hash returned. Check your wallet before retrying.",
        createdAt: 1,
      },
      {
        id: "dead-2",
        label: "Start ride",
        status: "awaiting_signature",
        hash: null,
        createdAt: 2,
      },
    ]),
  );
  const manager = txManager({ storage: saved });
  await manager.start();
  assert.equal(manager.rows.length, 2);
  assert.ok(manager.rows.every((r) => r.status === "failed" && !r.hash));
  assert.match(manager.rows[1].detail, /Interrupted before a transaction hash/i);
  manager.stop();
});
test("pending transactions reconcile after reload; confirmed history persists and account namespaces isolate", async () => {
  const saved = storage(),
    first = txManager({ storage: saved });
  await first.submit("Deposit", async () => ({ hash }));
  await first.running;
  first.stop();
  const second = txManager({
    storage: saved,
    receipt: async () => ({ status: 1, blockNumber: 8 }),
  });
  await second.start();
  assert.equal(second.rows[0].status, "confirmed");
  second.stop();
  const third = txManager({ storage: saved });
  await third.start();
  assert.equal(third.rows[0].status, "confirmed");
  third.stop();
  assert.equal(txManager({ storage: saved, account: B }).rows.length, 0);
  assert.equal(txManager({ storage: saved, config: { ...config, papaya: B } }).rows.length, 0);
  assert.equal(txManager({ storage: saved, config: { ...config, chainId: 31337 } }).rows.length, 0);
});
test("reverted receipts are final, while optional refresh failure cannot downgrade confirmed", async () => {
  for (const status of [0, 1]) {
    const manager = txManager({
      receipt: async () => ({ status, blockNumber: 1 }),
      onConfirmed: async () => {
        throw Error("refresh unavailable");
      },
    });
    await manager.submit(
      "Deposit",
      async () => ({ hash }),
      async () => {
        throw Error("optional timer unavailable");
      },
    );
    await manager.running;
    assert.equal(manager.rows[0].status, status ? "confirmed" : "reverted");
    manager.stop();
  }
});

test("wallet journals raw send hash without a follow-up wallet transaction RPC", async () => {
  const raw = wallet(),
    original = raw.request.bind(raw);
  raw.request = async (args) => {
    if (args.method === "eth_sendTransaction") {
      raw.calls.push(args.method);
      assert.equal(args.params[0].chainId, 5042n);
      return hash;
    }
    return original(args);
  };
  const session = new WalletSession({
    config,
    storage: storage(),
    makeProvider: () => ({
      getSigner: async () => ({}),
      getRpcTransaction: (value) => value,
      destroy() {},
    }),
  });
  await session.attach(raw);
  const tx = await session.send({ to: config.papaya, data: "0x" }, A);
  assert.equal(tx.hash, hash);
  assert.equal(raw.calls.at(-1), "eth_sendTransaction");
  session.destroy();
});

test("Reown connector binds/restores EIP-1193, opens connect/account, and disconnects", async () => {
  const { createWalletConnector } = await import("../web/src/runtime/wallet.mjs");
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost:5174" } };
  const raw = wallet(),
    events = {},
    views = [],
    saved = storage();
  let options;
  const session = new WalletSession({
    config,
    storage: saved,
    makeProvider: providerFactory(),
  });
  const modal = {
    subscribeProviders: (fn) => {
      events.provider = fn;
      return () => {};
    },
    subscribeAccount: (fn) => {
      events.account = fn;
      return () => {};
    },
    getWalletProvider: () => raw,
    open: (value) => {
      views.push(value.view);
    },
    disconnect: async () => {
      events.provider({});
      events.account({ status: "disconnected" });
    },
  };
  try {
    const connector = await createWalletConnector(config, session, "test-project-id", async () => [
      {
        createAppKit: (value) => {
          options = value;
          return modal;
        },
      },
      { EthersAdapter: class {} },
    ]);
    assert.equal(session.state.account, A);
    assert.equal(options.enableReconnect, true);
    assert.equal(options.enableEIP6963, true);
    assert.equal(options.enableWalletConnect, true);
    await connector.open();
    assert.equal(views.at(-1), "Account");
    await connector.disconnect();
    assert.equal(session.state.account, "");
    await connector.open();
    assert.equal(views.at(-1), "Connect");
    events.provider({ eip155: raw });
    await flush();
    assert.equal(session.state.account, A);
    connector.destroy();
  } finally {
    globalThis.window = previous;
  }
});

test("single-endpoint transient errors back off and initial failure never invents balances", async () => {
  let attempts = 0;
  const delays = [];
  let clock = 0;
  const pool = createReadRpc(
    config,
    { VITE_ARC_RPC_FALLBACK_URL: "" },
    {
      factory: () => ({ send: async () => "0x13b2" }),
      now: () => clock,
      wait: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
    },
  );
  assert.equal(
    await pool.run(() => {
      if (attempts++ < 2) throw Error("temporary");
      return 7;
    }),
    7,
  );
  assert.deepEqual(delays, [1000, 2000]);
  pool.destroy();
  const reader = new ReadState({
    read: async () => {
      throw Error("offline");
    },
    events: async () => [],
    schedule: noTimer,
  });
  await reader.refresh();
  assert.equal(reader.state.status, "error");
  assert.equal(reader.state.data, null);
  reader.stop();
});
test("malformed local history is ignored without breaking wallet or reads", async () => {
  const broken = {
    getItem: () => "not JSON",
    setItem: () => {
      throw Error("storage disabled");
    },
  };
  const manager = txManager({ storage: broken });
  await manager.start();
  assert.deepEqual(manager.rows, []);
  manager.stop();
  const session = new WalletSession({
    config,
    storage: broken,
    makeProvider: providerFactory(),
  });
  await session.attach(wallet(), { restore: true });
  assert.equal(session.state.account, A);
  session.destroy();
});

test("post-confirmation refresh rejects a lagging block while retaining balances", async () => {
  let block = 10;
  const reader = new ReadState({
    read: async () => ({ block, balance: BigInt(block) }),
    events: async () => [],
    schedule: noTimer,
  });
  await reader.refresh();
  await reader.refreshAfter(11);
  assert.equal(reader.state.status, "stale");
  assert.equal(reader.state.data.balance, 10n);
  block = 11;
  await reader.refresh();
  assert.equal(reader.state.status, "loaded");
  assert.equal(reader.state.data.balance, 11n);
  reader.stop();
});

test("readableError decodes wallet-shaped custom errors and known revert names", async () => {
  const { readableError, decodeRevertName } = await import("../web/src/runtime/rpc.mjs");
  const topUp = "0xe9e3f12e";
  assert.equal(
    readableError({
      shortMessage: "execution reverted (unknown custom error)",
      info: { error: { data: topUp } },
    }),
    "Add a deposit: the stream needs a two-day reserve plus liquidation gas.",
  );
  assert.equal(decodeRevertName({ revert: { name: "TopUpBalance" } }), "TopUpBalance");
  assert.equal(
    readableError({ reason: "TopUpBalance()" }),
    "Add a deposit: the stream needs a two-day reserve plus liquidation gas.",
  );
  assert.equal(readableError({ code: "ACTION_REJECTED" }), "Transaction rejected in wallet");
});

test("preflight revert is stored as failed with decoded detail, not rpc_unknown", async () => {
  const manager = txManager({ receipt: async () => null });
  await assert.rejects(
    manager.submit("Start ride", async () => {
      throw Object.assign(Error("execution reverted"), {
        code: "CALL_EXCEPTION",
        shortMessage: "execution reverted (unknown custom error)",
        info: { error: { data: "0xe9e3f12e" } },
      });
    }),
  );
  assert.equal(manager.rows[0].status, "failed");
  assert.equal(manager.rows[0].hash, null);
  assert.match(manager.rows[0].detail, /two-day reserve/i);
});

test("activity list sorts by block number with pending rows first", async () => {
  const { sortActivity } = await import("../web/src/runtime/rpc.mjs");
  const rows = sortActivity([
    { label: "Start ride", status: "confirmed", blockNumber: 10, createdAt: 1 },
    { label: "Automatic refill", status: "confirmed", blockNumber: 11, logIndex: 0 },
    { label: "Stop ride", status: "confirmed", blockNumber: 12, createdAt: 3 },
    { label: "Pending", status: "submitted", createdAt: 99 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Pending", "Stop ride", "Automatic refill", "Start ride"],
  );
});

test("dated activity shows newest first even when an older failure has no block", async () => {
  const { sortActivity } = await import("../web/src/runtime/rpc.mjs");
  const rows = sortActivity([
    { label: "old rejection", status: "rejected", createdAt: 10 },
    { label: "new receipt", status: "confirmed", blockNumber: 22, createdAt: 30 },
    { label: "keeper", status: "confirmed", blockNumber: 21, createdAt: 20 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.label),
    ["new receipt", "keeper", "old rejection"],
  );
});

test("Reown explicit disconnect gates late SDK restore, persists across reload, and opens chooser for ten cycles", async () => {
  const { createWalletConnector } = await import("../web/src/runtime/wallet.mjs");
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost" } };
  const saved = storage(),
    raw = wallet();
  let callbacks = {},
    unsubscribed = 0,
    options,
    disconnects = 0;
  const views = [];
  const modal = {
    subscribeProviders: (fn) => {
      callbacks.provider = fn;
      return () => unsubscribed++;
    },
    subscribeAccount: (fn) => {
      callbacks.account = fn;
      return () => unsubscribed++;
    },
    getWalletProvider: () => raw,
    disconnect: async (namespace) => {
      assert.equal(namespace, "eip155");
      disconnects++;
      callbacks.provider({ eip155: raw });
    },
    open: async (args) => views.push(args.view),
  };
  const sdk = async () => [
    {
      createAppKit: (o) => {
        options = o;
        return modal;
      },
    },
    { EthersAdapter: class {} },
  ];
  let session = new WalletSession({ config, storage: saved, makeProvider: providerFactory() });
  try {
    let connector = await createWalletConnector(config, session, "id", sdk);
    for (let i = 0; i < 10; i++) {
      await connector.disconnect();
      assert.equal(session.state.account, "");
      assert.equal(session.raw, null);
      callbacks.provider({ eip155: raw });
      callbacks.account({ isConnected: true });
      await flush();
      assert.equal(session.state.account, "");
      await connector.open();
      assert.equal(views.at(-1), "Connect");
      assert.equal(session.state.account, "");
      callbacks.provider({ eip155: raw });
      await flush();
      assert.equal(session.state.account, A);
      assert.equal(session.listeners.length, 4);
    }
    await connector.disconnect();
    connector.destroy();
    assert.equal(unsubscribed, 2);
    assert.equal(session.listeners.length, 0);
    session = new WalletSession({ config, storage: saved, makeProvider: providerFactory() });
    connector = await createWalletConnector(config, session, "id", sdk);
    assert.equal(options.enableReconnect, false);
    assert.equal(session.state.account, "");
    callbacks.provider({ eip155: raw });
    await flush();
    assert.equal(session.state.account, "");
    await connector.open();
    assert.equal(views.at(-1), "Connect");
    callbacks.provider({ eip155: raw });
    await flush();
    assert.equal(session.state.account, A);
    connector.destroy();
    assert.equal(unsubscribed, 4);
    assert.ok(disconnects >= 11);
  } finally {
    globalThis.window = previous;
    session.destroy();
  }
});

test("Reown network and native balance use primary/shared RPC, never a second public provider", async () => {
  const { createWalletConnector } = await import("../web/src/runtime/wallet.mjs");
  const previous = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost" } };
  let options,
    reads = 0;
  const session = new WalletSession({
    config,
    storage: storage(),
    makeProvider: providerFactory(),
  });
  const modal = {
    subscribeProviders: () => () => {},
    subscribeAccount: () => () => {},
    getWalletProvider: () => null,
  };
  try {
    const connector = await createWalletConnector(
      config,
      session,
      "id",
      async () => [
        {
          createAppKit: (o) => {
            options = o;
            return modal;
          },
        },
        {
          EthersAdapter: class {
            getBalance() {
              throw Error("Bypassed shared pool");
            }
          },
        },
      ],
      {
        env: { VITE_ARC_RPC_URL: "https://primary.invalid/token" },
        rpc: {
          run: async (action) =>
            action({
              getBalance: async () => {
                reads++;
                return 2000000000000000000n;
              },
            }),
        },
      },
    );
    assert.equal(options.networks[0].rpcUrls.default.http[0], "https://primary.invalid/token");
    assert.deepEqual(await options.adapters[0].getBalance({ address: A, chainId: 5042 }), {
      balance: "2.0",
      symbol: "USDC",
    });
    assert.equal(reads, 1);
    connector.destroy();
  } finally {
    globalThis.window = previous;
    session.destroy();
  }
});

test("LIVE without Reown project ID fails explicitly instead of silently choosing injected-only mode", async () => {
  const { createWalletConnector } = await import("../web/src/runtime/wallet.mjs");
  const session = new WalletSession({
    config,
    storage: storage(),
    makeProvider: providerFactory(),
  });
  await assert.rejects(
    createWalletConnector(config, session, ""),
    /WalletConnect configuration is missing/,
  );
  assert.equal(session.state.account, "");
  session.destroy();
});
