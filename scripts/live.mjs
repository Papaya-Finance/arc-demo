// Local-only launchers. keeper-live explicitly enables real keeper transactions.
import { readFile, writeFile, access, stat } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { validateDeployment } from "./deployment.mjs";
import { wallets } from "./wallets.mjs";
import { ARC } from "./network.mjs";
const mode = process.argv[2];
if (!["frontend", "keeper-dry", "keeper-live"].includes(mode))
  throw Error("Choose frontend, keeper-dry or keeper-live");
if (mode !== "frontend") {
  try {
    loadEnvFile(resolve(".env.local"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const file = resolve("deployments/mainnet.json");
const config = JSON.parse(await readFile(file, "utf8"));
validateDeployment(config); // Never accept pending or LOCAL/FORK metadata.
if (config.rpcUrl !== ARC.rpcUrl || config.explorer !== ARC.explorer)
  throw Error("Unexpected mainnet RPC/explorer in deployment artifact");
const env = { ...process.env };
let command, args;
if (mode === "frontend") {
  await writeFile("web/public/deployment.json", JSON.stringify(config, null, 2) + "\n");
  env.VITE_ARC_LIVE_ONLY = "true";
  command = process.execPath;
  args = [
    "node_modules/vite/bin/vite.js",
    "web",
    "--host",
    "127.0.0.1",
    "--port",
    "5174",
    "--strictPort",
  ];
  console.log(
    "LIVE Arc frontend: http://127.0.0.1:5174/arc-demo/ — real wallet transactions require user confirmation",
  );
} else {
  const broadcast = mode === "keeper-live";
  if (broadcast) {
    for (const key of ["KEYSTORE_FILE", "KEYSTORE_PASSWORD_FILE"]) {
      if (!env[key]) throw Error(`Set ${key} in .env.local`);
      try {
        await access(env[key]);
      } catch {
        throw Error(`${key} points to a missing or unreadable local file`);
      }
    }
    if ((await stat(env.KEYSTORE_PASSWORD_FILE)).mode & 0o077)
      throw Error("KEYSTORE_PASSWORD_FILE must have permissions 600 or 400");
  }
  Object.assign(env, {
    BROADCAST: broadcast ? "true" : "false",
    DEPLOYMENT_FILE: file,
    STATE_FILE: resolve(`.state/live-5042-${config.papaya.toLowerCase()}/keeper.json`),
    ARC_RPC_URL: process.env.ARC_RPC_URL || ARC.rpcUrl,
    KEEPER_ADDRESS: wallets.keeper,
    RUN_ONCE: process.env.RUN_ONCE || "true",
  });
  if (!broadcast) {
    delete env.KEYSTORE_FILE;
    delete env.KEYSTORE_PASSWORD_FILE;
  }
  command = "python3";
  args = ["scripts/with-lock.py", process.execPath, "liquidator/index.mjs"];
  console.log(
    broadcast
      ? `LIVE Arc keeper; BROADCAST=true; RUN_ONCE=${env.RUN_ONCE}; gas cap ${env.MAX_GAS_COST_USDC || "0.01"} USDC/transaction`
      : "LIVE Arc keeper simulation only; BROADCAST=false; isolated persistent checkpoint",
  );
}
const child = spawn(command, args, { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
