import { build } from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, access, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Dependency-only cache: never includes VITE config, addresses or credentials.
export async function walletVendor() {
  const fingerprint = createHash("sha256")
    .update(await readFile(join(root, "package-lock.json")))
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex");
  const directory = join(root, "node_modules/.cache/papaya-wallet", fingerprint);
  const entry = join(directory, "wallet.mjs");
  try {
    await access(entry);
    console.log("[timing] wallet dependency prebundle cache-hit");
    return entry;
  } catch {}
  const temp = directory + "-" + randomUUID(),
    started = performance.now();
  await mkdir(temp, { recursive: true });
  try {
    await build({
      stdin: {
        contents:
          'export {createAppKit} from "@reown/appkit"; export {EthersAdapter} from "@reown/appkit-adapter-ethers";',
        resolveDir: root,
        sourcefile: "wallet.mjs",
      },
      outdir: temp,
      entryNames: "wallet",
      outExtension: { ".js": ".mjs" },
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      legalComments: "eof",
      logLevel: "error",
    });
    try {
      await rename(temp, directory);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  console.log(
    `[timing] wallet dependency prebundle seconds=${((performance.now() - started) / 1000).toFixed(2)}`,
  );
  return entry;
}
