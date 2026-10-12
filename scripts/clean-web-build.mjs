import { rm, readFile } from "node:fs/promises";
await rm("web/dist/deployment.local.json", { force: true });
const config = JSON.parse(await readFile("web/dist/deployment.json", "utf8"));
if (config.chainId !== 5042 || config.status === "local-fork")
  throw Error("Build must not ship local addresses");
