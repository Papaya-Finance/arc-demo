import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const guard = resolve("scripts/publication-check.mjs");
test("publication guard permits public defaults and rejects private paths and credential literals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "papaya-publication-"));
  const run = () => spawnSync(process.execPath, [guard], { cwd: dir, encoding: "utf8" });
  const put = async (file, body) => {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), body);
  };
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await put(
      ".env.example",
      "VITE_REOWN_PROJECT_ID=\nVITE_ARC_RPC_URL=https://rpc.mainnet.arc.io\n",
    );
    assert.equal(run().status, 0);
    for (const file of [
      ".env.local",
      "deploy/stack.yml",
      ".state/checkpoint.json",
      "wallet.keystore",
      "web/public/deployment.json",
    ]) {
      await put(file, "{}\n");
      const result = run();
      assert.notEqual(result.status, 0, file);
      assert.match(result.stderr, /must not be published/);
      await rm(join(dir, file));
    }
    const token = "ghp_" + "Ab3x".repeat(10);
    await put("credential.txt", token);
    const result = run();
    assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes(token), "secret values must not be logged");
    await rm(join(dir, "credential.txt"));
    assert.equal(run().status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
