// JS/JSX syntax checks. This repository has no TypeScript sources or tsconfig.
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { transform } from "esbuild";
async function check(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const file = `${path}/${item.name}`;
    if (item.isDirectory()) {
      if (!["node_modules", "dist"].includes(item.name)) await check(file);
    } else if (/\.(mjs|js)$/.test(file)) {
      if (spawnSync(process.execPath, ["--check", file], { stdio: "inherit" }).status !== 0)
        process.exit(1);
    } else if (/\.jsx$/.test(file))
      await transform(await readFile(file, "utf8"), { loader: "jsx", sourcefile: file });
  }
}
for (const path of ["web/src", "liquidator", "scripts"]) await check(path);
console.log("JS/JSX syntax passed; TypeScript checks not applicable.");
