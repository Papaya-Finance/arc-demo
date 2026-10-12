import test from "node:test";
import assert from "node:assert/strict";
import { loadKeeperOptions } from "../liquidator/config.mjs";

test("keeper gas cost default and explicit caps use exact native-USDC units", () => {
  assert.equal(loadKeeperOptions({}).maxGasCost, 10n ** 16n);
  assert.equal(loadKeeperOptions({ MAX_GAS_COST_USDC: "0.025" }).maxGasCost, 25n * 10n ** 15n);
  assert.equal(loadKeeperOptions({ MAX_GAS_COST_USDC: "0.000000000000000001" }).maxGasCost, 1n);
});
test("keeper rejects invalid or zero caps before starting", () => {
  for (const value of ["", "0", "-1", "1e-2", "NaN", " 0.01", "0.0000000000000000001"])
    assert.throws(() => loadKeeperOptions({ MAX_GAS_COST_USDC: value }), /MAX_GAS_COST_USDC/);
});
