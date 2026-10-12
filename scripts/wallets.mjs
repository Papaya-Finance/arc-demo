import { readFile } from "node:fs/promises";
import { getAddress } from "ethers";
export const wallets = JSON.parse(
  await readFile(new URL("../deployments/wallets.json", import.meta.url), "utf8"),
);
for (const value of Object.values(wallets)) getAddress(value);
if (wallets.deployer !== wallets.demoUser || wallets.keeper !== wallets.scooter)
  throw Error("Unexpected demo wallet role mapping");
