import { defineConfig } from "vite";
import { walletVendorPlugin } from "../scripts/wallet-vendor-plugin.mjs";

// Phase timings make runner CPU/memory regressions distinguishable from registry/network waits.
function buildTimings() {
  let started, transformed, rendering;
  return {
    name: "papaya-build-timings",
    apply: "build",
    buildStart() {
      started = performance.now();
    },
    buildEnd() {
      transformed = performance.now();
      console.log(`[timing] module-graph seconds=${((transformed - started) / 1000).toFixed(2)}`);
    },
    renderStart() {
      rendering = performance.now();
    },
    generateBundle() {
      console.log(
        `[timing] render seconds=${((performance.now() - rendering) / 1000).toFixed(2)} rssMiB=${Math.round(process.memoryUsage().rss / 1024 / 1024)}`,
      );
    },
  };
}
export default defineConfig(async ({ command }) => ({
  base: "/arc-demo/",
  envDir: "..",
  plugins: [await walletVendorPlugin(command), buildTimings()],
  build: {
    reportCompressedSize: false,
    // The SDK is prebundled separately; Rollup tree-shaking this dependency graph
    // adds over a minute on the same checkout. Keep the measured fast release path.
    rollupOptions: { treeshake: false },
  },
}));
