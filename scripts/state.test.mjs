import test from "node:test";
import assert from "node:assert/strict";
import { applyEvents, loadState, saveState } from "../liquidator/state.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
const event = (name, blockNumber, index) => ({
  fragment: { name },
  blockNumber,
  index,
  args: { user: "0xAA", author: "0xBB" },
});
test("scanner replays same-block rate changes in log order", () => {
  const pairs = new Set();
  applyEvents(pairs, [
    event("StreamCreated", 1, 0),
    event("StreamCreated", 2, 2),
    event("StreamRevoked", 2, 1),
  ]);
  assert.equal(pairs.size, 1);
  applyEvents(pairs, [event("StreamRevoked", 3, 0)]);
  assert.equal(pairs.size, 0);
});
test("checkpoint is atomic and bound to deployment", async () => {
  const dir = await mkdtemp(`${tmpdir()}/papaya-test-`),
    file = `${dir}/state.json`;
  try {
    const config = { chainId: 5042, papaya: "0x123", deploymentBlock: 100 };
    const state = await loadState(file, config);
    assert.equal(state.lastBlock, 99);
    state.pairs.add("a|b");
    await saveState(file, state);
    assert.deepEqual([...(await loadState(file, config)).pairs], ["a|b"]);
    await assert.rejects(loadState(file, { ...config, chainId: 31337 }), /different chain/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
