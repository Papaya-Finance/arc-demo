import { readdir, readFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { walletVendor } from "./wallet-vendor.mjs";
// Self-host unchanged SDK modules as build assets. Rollup only compiles application code.
export async function walletVendorPlugin(command) {
  const entry = await walletVendor(),
    directory = dirname(entry);
  const prefix = `wallet-sdk/${basename(directory)}/`;
  return {
    name: "papaya-wallet-vendor",
    resolveId(source) {
      if (command === "build" && source.startsWith(`/arc-demo/${prefix}`))
        return { id: source, external: true };
    },
    config(userConfig) {
      // Vite `base` prefixes absolute module URLs; `/@fs...` 404s and must be `/arc-demo/@fs...`.
      const base = (userConfig.base ?? "/").replace(/\/$/, "");
      const moduleUrl = command === "build" ? `${base}/${prefix}wallet.mjs` : `${base}/@fs${entry}`;
      return {
        define: {
          __PAPAYA_WALLET_MODULE__: JSON.stringify(moduleUrl),
        },
      };
    },
    async generateBundle() {
      for (const file of await readdir(directory))
        this.emitFile({
          type: "asset",
          fileName: prefix + file,
          source: await readFile(`${directory}/${file}`),
        });
    },
  };
}
