import { parseUnits } from "ethers";

export function loadKeeperOptions(env = process.env) {
  const cap = env.MAX_GAS_COST_USDC ?? "0.01";
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(cap))
    throw new Error("MAX_GAS_COST_USDC must be a positive decimal USDC amount (up to 18 decimals)");
  const maxGasCost = parseUnits(cap, 18);
  if (maxGasCost <= 0n) throw new Error("MAX_GAS_COST_USDC must be greater than zero");
  return { maxGasCost };
}
