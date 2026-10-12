// Isolated browser reliability fixture. All wallet/RPC operations terminate here.
// Never serves LIVE deployment metadata and never forwards an RPC request.
import { createServer } from "vite";
import { walletVendorPlugin } from "./wallet-vendor-plugin.mjs";
import { Interface } from "ethers";
import { papayaAbi, tokenAbi } from "./abi.mjs";
const A = "0x" + "11".repeat(20),
  B = "0x" + "22".repeat(20),
  papaya = "0x" + "33".repeat(20),
  token = "0x" + "44".repeat(20);
const iface = new Interface([...papayaAbi, ...tokenAbi]);
const port = Number(process.env.FRONTEND_FIXTURE_PORT || 5176);
let readsFail = false,
  eventsFail = false,
  receiptsFail = false,
  sent = 0;
const timestamp = Math.floor(Date.now() / 1000);
const blockHash = "0x" + "88".repeat(32);
const transactions = new Map();
const streamEvents = [];
const accounts = new Map();
const applied = new Set();
function accountState(address) {
  const key = address.toLowerCase();
  if (!accounts.has(key))
    accounts.set(key, {
      balance:
        process.env.FRONTEND_FIXTURE_ZERO === "true"
          ? 0n
          : key === B
            ? 5n * 10n ** 18n
            : 3n * 10n ** 18n,
      external: 10_000_000n,
      allowance: process.env.FRONTEND_FIXTURE_ZERO === "true" ? 0n : 50_000n,
      subscriptions: new Map(),
    });
  return accounts.get(key);
}
function applyTransaction(tx) {
  const call = iface.parseTransaction({ data: tx.data });
  const state = accountState(tx.from);
  if (call.name === "approve") state.allowance = call.args[1];
  if (call.name === "deposit") {
    state.allowance -= call.args[0];
    state.external -= call.args[0];
    state.balance += call.args[0] * 10n ** 12n;
  }
  if (call.name === "withdraw") {
    state.balance -= call.args[0];
    state.external += call.args[0] / 10n ** 12n;
  }
  if (call.name === "subscribe" || call.name === "unsubscribe") {
    const to = call.args[0].toLowerCase(),
      rate = call.name === "subscribe" ? call.args[1] : state.subscriptions.get(to) || 0n;
    const encoded = ((rate * 99n) / 100n) | (rate << 96n);
    const event = iface.encodeEventLog(
      iface.getEvent(call.name === "subscribe" ? "StreamCreated" : "StreamRevoked"),
      [tx.from, to, encoded],
    );
    streamEvents.push({
      ...event,
      address: papaya,
      blockNumber: "0x64",
      blockHash,
      transactionHash: "0x" + sent.toString(16).padStart(64, "0"),
      transactionIndex: "0x0",
      logIndex: "0x" + streamEvents.length.toString(16),
      removed: false,
    });
    if (call.name === "subscribe") state.subscriptions.set(to, rate);
  }
  if (call.name === "unsubscribe") state.subscriptions.delete(call.args[0].toLowerCase());
}
const config = {
  status: "local-fork",
  chainId: 31337,
  papaya,
  usdc: token,
  rpcUrl: `http://127.0.0.1:${port}/__fixture/rpc`,
  projectId: 0,
  projectOwner: "0x" + "55".repeat(20),
  creator: "0x" + "66".repeat(20),
  scooter: "0x" + "77".repeat(20),
  deploymentBlock: 1,
  explorer: null,
};
function rpc(method, params) {
  if (method === "eth_chainId") return "0x7a69";
  if (method === "eth_sendTransaction") {
    const hash = "0x" + (++sent).toString(16).padStart(64, "0");
    transactions.set(hash, params[0]);
    return hash;
  }
  if (method === "eth_getTransactionReceipt") {
    if (receiptsFail) throw Error("receipt temporarily unavailable");
    const tx = transactions.get(params[0]);
    if (!tx) return null;
    if (!applied.has(params[0])) {
      applyTransaction(tx);
      applied.add(params[0]);
    }
    return {
      transactionHash: params[0],
      transactionIndex: "0x0",
      blockHash,
      blockNumber: "0x64",
      from: tx.from,
      to: tx.to,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x4a817c800",
      contractAddress: null,
      logs: [],
      logsBloom: "0x" + "00".repeat(256),
      status: "0x1",
      type: "0x2",
    };
  }
  if (method === "eth_estimateGas") return "0x186a0";
  if (method === "eth_blockNumber") return "0x64";
  if (method === "eth_getLogs") {
    if (eventsFail) throw Error("event history unavailable");
    const filter = params[0];
    return streamEvents.filter(
      (e) =>
        Number(e.blockNumber) >= Number(filter.fromBlock || 0) &&
        Number(e.blockNumber) <= Number(filter.toBlock || 100) &&
        filter.topics.every(
          (topic, i) => !topic || topic.toLowerCase() === e.topics[i].toLowerCase(),
        ),
    );
  }
  if (readsFail) throw Error("temporary read outage");
  if (method === "eth_getBlockByNumber")
    return {
      number: "0x64",
      hash: blockHash,
      parentHash: blockHash,
      timestamp: "0x" + timestamp.toString(16),
      nonce: "0x0000000000000000",
      difficulty: "0x0",
      gasLimit: "0x1c9c380",
      gasUsed: "0x0",
      miner: A,
      extraData: "0x",
      transactions: [],
      baseFeePerGas: "0x4a817c800",
    };
  if (method === "eth_call") {
    const call = iface.parseTransaction({ data: params[0].data });
    let values;
    const state = accountState(params[0].from || A);
    if (call.name === "users") {
      const user = accountState(call.args[0]);
      values = [
        user.balance,
        0,
        [...user.subscriptions.values()].reduce((a, b) => a + b, 0n),
        timestamp,
      ];
    } else if (call.name === "balanceOf") values = [accountState(call.args[0]).external];
    else if (call.name === "allowance") values = [accountState(call.args[0]).allowance];
    else if (call.name === "defaultFeeSettings") values = [100];
    else if (call.name === "userFeeSettings" || call.name === "refillQuote") values = [0];
    else if (call.name === "allSubscriptions") {
      const entries = [...accountState(call.args[0]).subscriptions];
      values = [
        entries.map(([to]) => to),
        entries.map(([, rate]) => ((rate * 99n) / 100n) | (rate << 96n)),
      ];
    } else if (call.name === "approve") values = [true];
    else if (["deposit", "withdraw", "subscribe", "unsubscribe"].includes(call.name)) {
      if (call.name === "deposit" && state.allowance < call.args[0])
        throw Error("Insufficient fixture allowance");
      values = [];
    } else throw Error("Unexpected fixture call");
    return iface.encodeFunctionResult(call.fragment, values);
  }
  throw Error(`Unsupported fixture RPC: ${method}`);
}
const fixtureScript = `
const listeners = new Map();
let chain = '0x7a69', current = '${A}', rejected = false;
const emit = (event, value) => { for (const callback of listeners.get(event) || []) callback(value); };
window.ethereum = {
 on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
 removeListener(event, callback) { listeners.get(event)?.delete(callback); },
 async request({method, params = []}) {
  if (method === 'eth_accounts') return localStorage.getItem('fixture.allowed') ? [current] : [];
  if (method === 'eth_requestAccounts') { localStorage.setItem('fixture.allowed','yes'); return [current]; }
  if (method === 'eth_chainId') return chain;
  if (method === 'wallet_switchEthereumChain') { chain=params[0].chainId; emit('chainChanged',chain); return null; }
  if (method === 'eth_sendTransaction' && rejected) { rejected=false; throw Object.assign(Error('Rejected'),{code:4001}); }
  const response = await fetch('/__fixture/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0', id:1, method, params})});
  const body=await response.json(); if(body.error) throw Object.assign(Error(body.error.message),{code:body.error.code}); return body.result;
 }
};
window.addEventListener('DOMContentLoaded', () => {
 const bar = document.createElement('aside'); bar.id='fixture-controls';
 for (const action of ['Account B','Account A','Chain 1','Chain Arc','Fail reads','Recover reads','Fail events','Recover events','Reject next tx','Delay receipts','Confirm receipts']) {
  const button=document.createElement('button'); button.textContent='TEST '+action;
  button.onclick=async()=>{
   if(action==='Account B'||action==='Account A'){current=action==='Account B'?'${B}':'${A}';emit('accountsChanged',[current]);}
   else if(action==='Chain 1'||action==='Chain Arc'){chain=action==='Chain 1'?'0x1':'0x7a69';emit('chainChanged',chain);}
   else if(action==='Reject next tx') rejected=true;
   else await fetch('/__fixture/action',{method:'POST',body:action});
  }; bar.append(button);
 } document.body.append(bar); bar.style.cssText="padding:20px;display:flex;gap:6px;flex-wrap:wrap;margin-bottom:180px;border-top:1px dashed #ccc";
});`;
const server = await createServer({
  configFile: false,
  root: "web",
  base: "/arc-demo/",
  envFile: false,
  define: {
    "import.meta.env.VITE_REOWN_PROJECT_ID": '""',
    "import.meta.env.VITE_ARC_LIVE_ONLY": '"false"',
    "import.meta.env.VITE_ARC_RPC_URL": '""',
    "import.meta.env.VITE_ARC_RPC_FALLBACK_URL": '""',
    "import.meta.env.VITE_ENS_RPC_URL": '"disabled"',
  },
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [
    await walletVendorPlugin("serve"),
    {
      name: "isolated-reliability-fixture",
      transformIndexHtml() {
        return [{ tag: "script", children: fixtureScript, injectTo: "head-prepend" }];
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.endsWith("deployment.json")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(config));
            return;
          }
          if (!req.url?.startsWith("/__fixture/")) return next();
          let body = "";
          for await (const chunk of req) body += chunk;
          if (req.url === "/__fixture/action") {
            if (body === "Fail reads") readsFail = true;
            if (body === "Recover reads") readsFail = false;
            if (body === "Fail events") eventsFail = true;
            if (body === "Recover events") eventsFail = false;
            if (body === "Delay receipts") receiptsFail = true;
            if (body === "Confirm receipts") receiptsFail = false;
            res.end("ok");
            return;
          }
          res.setHeader("Content-Type", "application/json");
          const payload = JSON.parse(body);
          if (Array.isArray(payload)) {
            res.statusCode = 400;
            res.end('{"error":"Fixture rejects batching"}');
            return;
          }
          try {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: payload.id,
                result: rpc(payload.method, payload.params || []),
              }),
            );
          } catch (error) {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: payload.id,
                error: { code: -32005, message: error.message },
              }),
            );
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `ISOLATED fixture http://127.0.0.1:${port}/arc-demo/ — no upstream RPC, no real signing`,
);
