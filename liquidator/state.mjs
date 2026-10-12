import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export function applyEvents(pairs, events) {
  for (const event of [...events].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
  )) {
    const key = `${event.args.user.toLowerCase()}|${event.args.author.toLowerCase()}`;
    if (event.fragment.name === "StreamCreated") pairs.add(key);
    else pairs.delete(key);
  }
}
export async function loadState(file, config) {
  try {
    const state = JSON.parse(await readFile(file, "utf8"));
    if (
      state.chainId !== config.chainId ||
      state.papaya.toLowerCase() !== config.papaya.toLowerCase()
    )
      throw new Error("State belongs to a different chain/contract");
    return { ...state, pairs: new Set(state.pairs) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return {
      chainId: config.chainId,
      papaya: config.papaya,
      lastBlock: config.deploymentBlock - 1,
      pairs: new Set(),
    };
  }
}
export async function saveState(file, state) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + ".tmp", JSON.stringify({ ...state, pairs: [...state.pairs] }, null, 2));
  await rename(file + ".tmp", file);
}
