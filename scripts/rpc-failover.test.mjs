import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createReadRpc, ReadState } from "../web/src/runtime/rpc.mjs";
const config = { chainId: 5042, rpcUrl: "https://fallback.invalid" };
function setup() {
  let clock = 0;
  const calls = { primary: 0, fallback: 0 },
    fail = { primary: false, fallback: false };
  const pool = createReadRpc(
    config,
    { VITE_ARC_RPC_URL: "https://primary.invalid" },
    {
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      factory: (url) => ({
        send: async (method) => {
          const role = url.includes("primary") ? "primary" : "fallback";
          calls[role]++;
          if (fail[role])
            throw Object.assign(Error("429 Too Many Requests"), {
              status: 429,
            });
          return method === "eth_chainId" ? "0x13b2" : "0x64";
        },
        destroy() {},
      }),
    },
  );
  return {
    pool,
    calls,
    fail,
    tick: (ms) => {
      clock += ms;
    },
    read: () => pool.run((p) => p.send("eth_blockNumber", [])),
  };
}
test("healthy primary never calls fallback; failover cools down and returns to recovered primary", async () => {
  const f = setup();
  for (let i = 0; i < 20; i++) assert.equal(await f.read(), "0x64");
  assert.equal(f.calls.fallback, 0);
  f.fail.primary = true;
  await f.read();
  assert.equal(f.pool.diagnostics().active, "fallback");
  const failedCalls = f.calls.primary;
  for (let i = 0; i < 20; i++) await f.read();
  assert.equal(f.calls.primary, failedCalls);
  f.fail.primary = false;
  f.tick(30000);
  await f.read();
  assert.equal(f.pool.diagnostics().active, "primary");
  f.fail.fallback = true;
  const before = f.calls.fallback;
  await f.read();
  assert.equal(f.calls.fallback, before);
  f.pool.destroy();
});
test("429 on both endpoints has shared exponential cooldown with no immediate retry hammer", async () => {
  const f = setup();
  f.fail.primary = f.fail.fallback = true;
  await assert.rejects(f.read());
  const count = { ...f.calls };
  for (let i = 0; i < 30; i++) await assert.rejects(f.read());
  assert.deepEqual(f.calls, count);
  assert.equal(f.pool.diagnostics().endpoints[0].cooldownMs, 30000);
  f.tick(30000);
  await assert.rejects(f.read());
  assert.equal(f.pool.diagnostics().endpoints[0].cooldownMs, 60000);
  f.pool.destroy();
});
test("concurrent chain verification and duplicate method reads are single-flight; diagnostics redact URLs", async () => {
  const f = setup();
  await Promise.all(Array.from({ length: 20 }, () => f.read()));
  assert.equal(f.calls.primary, 2);
  assert.equal(f.calls.fallback, 0);
  const log = JSON.stringify(f.pool.diagnostics());
  assert.ok(!log.includes("https") && !log.includes("invalid"));
  f.pool.destroy();
  await assert.rejects(f.read(), /stopped/);
});
test("single reader timer survives ten account cycles; stop cancels timer and ignores in-flight result", async () => {
  const timers = new Map();
  let seq = 0,
    reads = 0;
  const reader = new ReadState({
    read: async () => ({ block: ++reads }),
    events: async () => [],
    schedule: (fn, ms) => {
      timers.set(++seq, { fn, ms });
      return seq;
    },
    cancel: (id) => timers.delete(id),
  });
  for (let i = 0; i < 10; i++) {
    await reader.setAccount("0xaaa");
    await reader.setAccount("");
    assert.equal(timers.size, 1);
  }
  assert.equal([...timers.values()][0].ms, 15000);
  reader.stop();
  assert.equal(timers.size, 0);
  const before = reads;
  await reader.refresh();
  assert.equal(reads, before);
});
test("actual ethers HTTP 429 does not retry internally during cooldown", async () => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const pool = createReadRpc({ chainId: 5042, rpcUrl: url }, { VITE_ARC_RPC_FALLBACK_URL: "" });
  try {
    await assert.rejects(pool.run((p) => p.getBlockNumber()));
    await assert.rejects(pool.run((p) => p.getBlockNumber()));
    assert.equal(calls, 1);
    assert.ok(pool.diagnostics().endpoints[0].cooldownMs > 29000);
  } finally {
    pool.destroy();
    await new Promise((r) => server.close(r));
  }
});
