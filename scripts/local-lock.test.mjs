import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Mac/Linux keeper lock survives exec, excludes second writer and releases after SIGKILL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-lock-"));
  const env = { ...process.env, STATE_FILE: join(dir, "keeper.json") };
  let child;
  try {
    child = spawn(
      "python3",
      [
        "scripts/with-lock.py",
        process.execPath,
        "-e",
        "console.log('locked'); setInterval(() => {}, 1000)",
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw Error("First lock holder failed to start");
      }),
      once(child, "error").then(([error]) => {
        throw error;
      }),
    ]);
    const args = ["scripts/with-lock.py", process.execPath, "-e", "process.exit(0)"];
    const blocked = spawnSync("python3", args, { env, encoding: "utf8" });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Another local keeper/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const recovered = spawnSync("python3", args, { env, encoding: "utf8" });
    assert.equal(recovered.status, 0, recovered.stderr);
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
