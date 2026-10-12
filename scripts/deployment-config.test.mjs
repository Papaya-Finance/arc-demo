import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDeployment } from "./deployment.mjs";
import { wallets } from "./wallets.mjs";
test("deployment validation rejects pending artifacts, another chain and wrong wallet roles", async () => {
  const pending = JSON.parse(await readFile("deployments/mainnet.json", "utf8"));
  if (pending.status === "not-deployed") assert.throws(() => validateDeployment(pending));
  const fixture = {
    status: "deployed",
    verified: true,
    chainId: 5042,
    usdc: "0x3600000000000000000000000000000000000000",
    projectId: 0,
    deploymentBlock: 1,
    papaya: "0x" + "11".repeat(20),
    deploymentTransaction: "0x" + "22".repeat(32),
    projectOwner: wallets.deployer,
    creator: wallets.creator,
    scooter: wallets.scooter,
  };
  assert.doesNotThrow(() => validateDeployment(fixture));
  for (const change of [
    { verified: false },
    { chainId: 31337 },
    { projectOwner: wallets.keeper },
    { creator: wallets.scooter },
    { scooter: wallets.creator },
  ])
    assert.throws(() => validateDeployment({ ...fixture, ...change }));
});
