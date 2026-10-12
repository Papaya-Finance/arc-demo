import { readFile, writeFile } from "node:fs/promises";
const config = JSON.parse(await readFile("deployments/mainnet.json", "utf8"));
if (config.status === "deployed" && config.verified !== true)
  throw Error("Record successful explorer source verification before publishing the live UI");
if (!["not-deployed", "deployed"].includes(config.status) || config.chainId !== 5042)
  throw Error("Refusing to package a local/fork configuration");
await writeFile("web/public/deployment.json", JSON.stringify(config, null, 2) + "\n");
