import { Contract, JsonRpcProvider, Wallet, isAddress } from "ethers";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { papayaAbi } from "../scripts/abi.mjs";
import { loadState, saveState, applyEvents } from "./state.mjs";
import { loadKeeperOptions } from "./config.mjs";
const log = (event, data = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...data }));

export async function cycle({
  provider,
  papaya,
  signer,
  state,
  stateFile,
  dryRun = true,
  maxGasCost = loadKeeperOptions().maxGasCost,
  explorer = null,
}) {
  if (state.pendingTransaction) {
    const pending = state.pendingTransaction;
    const receipt = await provider.waitForTransaction(pending.hash, 1, 60_000);
    if (!receipt) throw new Error(`Pending transaction unresolved: ${pending.hash}`);
    delete state.pendingTransaction;
    await saveState(stateFile, state);
    log("transaction.recovered", {
      hash: pending.hash,
      status: receipt.status,
    });
    if (receipt.status !== 1) throw new Error(`Recovered transaction reverted: ${pending.hash}`);
  }
  const head = await provider.getBlockNumber();
  if (state.lastBlock > head) throw new Error("Node is behind saved checkpoint");
  if (state.lastBlockHash) {
    const block = await provider.getBlock(state.lastBlock);
    if (block?.hash !== state.lastBlockHash)
      throw new Error("Checkpoint block hash changed; rescan using a new state file");
  }
  while (state.lastBlock < head) {
    const from = state.lastBlock + 1,
      to = Math.min(from + 1999, head);
    const [created, revoked] = await Promise.all([
      papaya.queryFilter(papaya.filters.StreamCreated(), from, to),
      papaya.queryFilter(papaya.filters.StreamRevoked(), from, to),
    ]);
    applyEvents(state.pairs, [...created, ...revoked]);
    state.lastBlock = to;
    state.lastBlockHash = (await provider.getBlock(to)).hash;
    await saveState(stateFile, state);
  }
  const keeper = await signer.getAddress();
  const candidates = [...new Set([...state.pairs].map((k) => k.split("|")[0]))];
  for (const account of candidates) {
    if (account === keeper.toLowerCase()) continue;
    const row = await papaya.users(account);
    if (row.outgoingRate <= row.incomeRate) continue;
    const p = papaya.connect(signer);
    try {
      await p.liquidate.staticCall(account);
    } catch (e) {
      const name = e.revert?.name;
      if (name === "NotLiquidatable") continue;
      // Reverts such as TopUpBalance are operational failures, never silently "not eligible".
      if (e.code === "CALL_EXCEPTION") {
        log("simulation.reverted", { account, reason: name || e.shortMessage });
        continue;
      }
      throw e;
    }
    const gas = ((await p.liquidate.estimateGas(account)) * 125n) / 100n;
    const fee = await provider.getFeeData();
    const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
    if (!maxFeePerGas || gas * maxFeePerGas > maxGasCost) {
      log("cost.limit", {
        account,
        maxGasCostWei: maxGasCost.toString(),
        estimatedMaxCostWei: (gas * (maxFeePerGas ?? 0n)).toString(),
      });
      continue;
    }
    if (dryRun) {
      log("dry-run.eligible", { account, gas: gas.toString() });
      continue;
    }
    if ((await provider.getBalance(keeper)) < gas * maxFeePerGas)
      throw new Error("Keeper needs native USDC for gas");
    const [latestNonce, pendingNonce] = await Promise.all([
      provider.getTransactionCount(keeper, "latest"),
      provider.getTransactionCount(keeper, "pending"),
    ]);
    if (pendingNonce !== latestNonce)
      throw new Error("Keeper wallet has an unresolved pending transaction; do not send another");
    // Serial receipt waits prevent overlapping cycles and nonce races.
    const tx = await p.liquidate(account, {
      gasLimit: gas,
      maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n,
    });
    state.pendingTransaction = { hash: tx.hash, account };
    await saveState(stateFile, state);
    log("transaction.sent", {
      account,
      hash: tx.hash,
      ...(explorer ? { url: `${explorer}/tx/${tx.hash}` } : {}),
    });
    const receipt = await tx.wait(1, 60_000);
    if (!receipt || receipt.status !== 1) throw new Error(`Transaction failed: ${tx.hash}`);
    delete state.pendingTransaction;
    await saveState(stateFile, state);
    log("transaction.confirmed", {
      account,
      hash: tx.hash,
      block: receipt.blockNumber,
    });
  }
}

async function main() {
  const { maxGasCost } = loadKeeperOptions();
  const config = JSON.parse(
    await readFile(process.env.DEPLOYMENT_FILE || "deployments/mainnet.json", "utf8"),
  );
  if (
    !["deployed", "local-fork"].includes(config.status) ||
    !isAddress(config.papaya) ||
    !Number.isSafeInteger(config.deploymentBlock)
  )
    throw new Error("Missing validated deployment artifact");
  const provider = new JsonRpcProvider(process.env.ARC_RPC_URL || config.rpcUrl, undefined, {
    cacheTimeout: -1,
  });
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(config.chainId))
      throw new Error("Wrong chain");
    if ((await provider.getCode(config.papaya)) === "0x") throw new Error("Papaya has no bytecode");
    const papaya = new Contract(config.papaya, papayaAbi, provider);
    if ((await papaya.TOKEN()).toLowerCase() !== config.usdc.toLowerCase())
      throw new Error("Wrong token");
    const dryRun = process.env.BROADCAST !== "true";
    let signer;
    if (dryRun) {
      if (!isAddress(process.env.KEEPER_ADDRESS))
        throw new Error("Set public KEEPER_ADDRESS for simulation");
      signer = {
        provider,
        getAddress: async () => process.env.KEEPER_ADDRESS,
        call: (tx) => provider.call({ ...tx, from: process.env.KEEPER_ADDRESS }),
        estimateGas: (tx) => provider.estimateGas({ ...tx, from: process.env.KEEPER_ADDRESS }),
      };
    } else {
      const file = process.env.KEYSTORE_FILE,
        passwordFile = process.env.KEYSTORE_PASSWORD_FILE;
      if (!file || !passwordFile)
        throw new Error(
          "Encrypted keystore and password file required; never put keys in environment/source",
        );
      if ((await stat(passwordFile)).mode & 0o077)
        throw new Error("Password file must be chmod 600");
      signer = (
        await Wallet.fromEncryptedJson(
          await readFile(file, "utf8"),
          (await readFile(passwordFile, "utf8")).trimEnd(),
        )
      ).connect(provider);
      if (
        !isAddress(process.env.KEEPER_ADDRESS) ||
        signer.address.toLowerCase() !== process.env.KEEPER_ADDRESS.toLowerCase()
      )
        throw new Error("Keeper keystore does not match configured public address");
    }
    const stateFile = process.env.STATE_FILE || `.state/${config.chainId}-${config.papaya}.json`;
    // The local launcher uses an OS advisory lock in scripts/with-lock.py.
    // Unlike a marker file, the kernel releases it even after SIGKILL/container failure.
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
    });
    process.on("SIGTERM", () => {
      stopping = true;
    });
    try {
      log("started", {
        chainId: config.chainId,
        papaya: config.papaya,
        keeper: await signer.getAddress(),
        dryRun,
        maxGasCostWei: maxGasCost.toString(),
      });
      const state = await loadState(stateFile, config);
      do {
        try {
          await cycle({
            provider,
            papaya,
            signer,
            state,
            stateFile,
            dryRun,
            maxGasCost,
            explorer: config.explorer,
          });
        } catch (e) {
          if (process.env.RUN_ONCE === "true") throw e;
          log("cycle.error", { reason: e.shortMessage || e.message });
        }
        if (process.env.RUN_ONCE === "true" || stopping) break;
        await new Promise((resolve) => setTimeout(resolve, 15000));
      } while (!stopping);
    } finally {
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
    }
  } finally {
    provider.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ event: "fatal", reason: e.shortMessage || e.message }));
    process.exitCode = 1;
  });
}
