import { useEffect, useRef, useState } from "react";
import {
  createReadRpc,
  readAccount,
  readKeeperEvents,
  ReadState,
  readableError,
  simulateWrite,
} from "./rpc.mjs";
import { WalletSession, createWalletConnector } from "./wallet.mjs";
import { browserStorage } from "./storage.mjs";
import { Transactions } from "./transactions.mjs";
import { Contract } from "ethers";
import { papayaAbi, tokenAbi } from "../../../scripts/abi.mjs";
const emptyWallet = {
  account: "",
  signer: null,
  status: "disconnected",
  revision: 0,
};
export function useRuntime(config) {
  const [wallet, setWallet] = useState(emptyWallet);
  const [read, setRead] = useState({
    status: "loading",
    account: "",
    data: null,
    events: [],
  });
  const [txState, setTxState] = useState({ account: "", rows: [] }),
    [error, setError] = useState("");
  const services = useRef({});
  useEffect(() => {
    if (!config?.papaya) return;
    let stopped = false;
    const initialization = new AbortController();
    const pool = createReadRpc(config, import.meta.env);
    const diagnostics = () => pool.diagnostics();
    window.__PAPAYA_RPC_DIAGNOSTICS__ = diagnostics;
    const reader = new ReadState({
      read: (account) =>
        pool.run((p) => readAccount(p, config, account), {
          key: `account:${account}`,
        }),
      events: (account, block) =>
        pool.run((p) => readKeeperEvents(p, config, account, block), {
          retries: 0,
          key: `events:${account}:${block}`,
        }),
      onChange: (state) => {
        if (!stopped) setRead(state);
      },
    });
    const session = new WalletSession({
      config,
      storage: browserStorage(),
      onChange: (next) => {
        if (!stopped) setWallet(next);
      },
      onError: (e) => {
        if (!stopped) setError(readableError(e));
      },
    });
    services.current = { pool, reader, session, managers: new Map() };
    reader.refresh();
    createWalletConnector(config, session, import.meta.env.VITE_REOWN_PROJECT_ID, undefined, {
      rpc: pool,
      env: import.meta.env,
      signal: initialization.signal,
    })
      .then((connector) => {
        if (stopped) connector.destroy();
        else services.current.connector = connector;
      })
      .catch((e) => {
        if (!stopped) {
          services.current.connectorError = e;
          setError(readableError(e));
        }
      });
    return () => {
      stopped = true;
      initialization.abort();
      services.current.connector?.destroy();
      for (const manager of services.current.managers.values()) manager.stop();
      services.current.managers.clear();
      session.destroy();
      reader.stop();
      pool.destroy();
      if (window.__PAPAYA_RPC_DIAGNOSTICS__ === diagnostics)
        delete window.__PAPAYA_RPC_DIAGNOSTICS__;
    };
  }, [config]);
  useEffect(() => {
    if (wallet.status !== "connecting") services.current.reader?.setAccount(wallet.account);
  }, [wallet.account, wallet.chainId, wallet.status]);
  useEffect(() => {
    setError("");
  }, [wallet.account]);
  useEffect(() => {
    if (!wallet.account || !config?.papaya || !services.current.pool) {
      setTxState({ account: "", rows: [] });
      return;
    }
    const scope = wallet.account.toLowerCase();
    const { pool, reader, managers, session } = services.current;
    let manager = managers.get(scope);
    if (!manager) {
      manager = new Transactions({
        config,
        account: wallet.account,
        storage: browserStorage(),
        receipt: (hash) =>
          pool.run((p) => p.getTransactionReceipt(hash), {
            retries: 0,
            key: `receipt:${hash}`,
          }),
        onChange: (rows) => {
          if (session.state.account.toLowerCase() === scope) setTxState({ account: scope, rows });
        },
        onConfirmed: (receipt) => reader.refreshAfter(receipt.blockNumber),
      });
      managers.set(scope, manager);
    }
    // Keep hash reconciliation alive across disconnect/account changes. Each account
    // has one journal; delayed wallet replies cannot overwrite a replacement journal.
    services.current.transactions = manager;
    setTxState({ account: scope, rows: [...manager.rows] });
    manager.start();
    return () => {
      if (services.current.transactions === manager) services.current.transactions = null;
    };
  }, [wallet.account, config]);
  const txs = txState.account === wallet.account.toLowerCase() ? txState.rows : [];
  const active = txs.find(
    (r) =>
      ["awaiting_signature", "submitted", "confirming", "recovering"].includes(r.status) ||
      (r.hash && r.status === "rpc_unknown"),
  );
  return {
    rpcDiagnostics: () => services.current.pool?.diagnostics(),
    account: wallet.account,
    signer: wallet.signer,
    walletStatus: wallet.status,
    data: read.account === wallet.account.toLowerCase() ? read.data : null,
    readStatus: read.status,
    keeperEvents: read.account === wallet.account.toLowerCase() ? read.events : [],
    txs,
    pending: active
      ? `${active.label} · ${active.status === "awaiting_signature" ? "confirm in wallet" : "waiting for confirmation"}`
      : "",
    error: error || (read.error ? `RPC read failed: ${readableError(read.error)}` : ""),
    setError,
    async disconnect() {
      try {
        await services.current.connector?.disconnect();
      } catch (e) {
        setError(readableError(e));
      }
    },
    async connect() {
      setError("");
      try {
        if (wallet.status === "wrong_chain") {
          await services.current.session.switchChain();
          await services.current.session.sync();
        } else if (services.current.connector) await services.current.connector.open();
        else
          throw (
            services.current.connectorError ||
            Error("Wallet connection is loading. Please try again.")
          );
      } catch (e) {
        setError(readableError(e));
      }
    },
    async transact(label, action, after, context) {
      setError("");
      const { session, transactions, pool } = services.current;
      if (services.current.signing) return;
      services.current.signing = true;
      try {
        if (
          !wallet.signer ||
          !wallet.account ||
          !transactions ||
          !pool ||
          transactions.account.toLowerCase() !== wallet.account.toLowerCase()
        )
          throw Error("Connect your wallet first");
        const account = wallet.account;
        return await transactions.submit(
          label,
          async () => {
            await session.assertCurrent(account);
            return action(
              wallet.signer,
              (request) => session.send(request, account),
              (address, abi, method, args) =>
                pool.run((provider) =>
                  simulateWrite(provider, address, abi, method, args, account),
                ),
            );
          },
          (receipt) => {
            if (session.state.account.toLowerCase() === account.toLowerCase())
              return after?.(receipt);
          },
          context,
        );
      } catch (e) {
        if (session?.state.account.toLowerCase() === wallet.account.toLowerCase())
          setError(readableError(e));
      } finally {
        services.current.signing = false;
      }
    },
    rpc: {
      account: (account, minimumBlock = 0) =>
        services.current.pool.run(async (p) => {
          await services.current.session.assertCurrent(account);
          const data = await readAccount(p, config, account);
          if (data.block < minimumBlock)
            throw Error("RPC is catching up with the confirmed transaction");
          await services.current.session.assertCurrent(account);
          return data;
        }),
      incoming: (from, to, account = wallet.account) =>
        services.current.pool.run(
          async (provider) => {
            const author = account || services.current.session?.state?.account;
            if (!author) return [];
            const papaya = new Contract(config.papaya, papayaAbi, provider);
            const events = await Promise.all([
              papaya.queryFilter(papaya.filters.StreamCreated(null, author), from, to),
              papaya.queryFilter(papaya.filters.StreamRevoked(null, author), from, to),
            ]);
            return events.flat();
          },
          { retries: 0 },
        ),
      allowance: (account, minimumBlock = 0) =>
        services.current.pool.run(async (p) => {
          await services.current.session.assertCurrent(account);
          const block = await p.getBlock("latest");
          if (!block || block.number < minimumBlock)
            throw Error("RPC is catching up with the confirmed transaction");
          return new Contract(config.usdc, tokenAbi, p).allowance(account, config.papaya, {
            blockTag: block.number,
          });
        }),
      getBlock: (number) => services.current.pool.run((p) => p.getBlock(number)),
    },
  };
}
