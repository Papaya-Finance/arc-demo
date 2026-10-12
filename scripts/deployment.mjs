import { readFile } from "node:fs/promises";
const wallets = JSON.parse(
  await readFile(new URL("../deployments/wallets.json", import.meta.url), "utf8"),
);
export function validateDeployment(config) {
  if (
    config.status !== "deployed" ||
    config.verified !== true ||
    config.chainId !== 5042 ||
    config.usdc?.toLowerCase() !== "0x3600000000000000000000000000000000000000" ||
    config.projectId !== 0 ||
    !Number.isSafeInteger(config.deploymentBlock) ||
    config.deploymentBlock < 1 ||
    !/^0x[0-9a-fA-F]{40}$/.test(config.papaya || "") ||
    !/^0x[0-9a-fA-F]{64}$/.test(config.deploymentTransaction || "") ||
    config.projectOwner?.toLowerCase() !== wallets.deployer.toLowerCase() ||
    config.creator?.toLowerCase() !== wallets.creator.toLowerCase() ||
    config.scooter?.toLowerCase() !== wallets.scooter.toLowerCase()
  )
    throw Error("A verified mainnet deployment with the agreed wallet roles is required");
}
