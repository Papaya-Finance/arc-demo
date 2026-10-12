import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Never print matched values: paths/line numbers are enough to locate a problem.
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bglpat-[\w-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /https:\/\/[^\s/"']+:[^\s/"']+@/,
  /(?:PRIVATE_KEY|privateKey)\s*[:=]\s*["'](?:0x)?[a-fA-F0-9]{64}["']/,
  /https:\/\/[^\s/"']*chainstack[^\s/"']*\/[a-zA-Z0-9_-]{20,}/i,
  /["'](?:mnemonic|seedPhrase)["']?\s*[:=]\s*["'][a-z]+(?: [a-z]+){11,23}["']/i,
  /["']ciphertext["']\s*:/i,
  /https?:\/\/[^\s/"']*(?:infura\.io\/v3|alchemy\.com\/v2)\/[A-Za-z0-9_-]{20,}/i,
  /(?:PASSWORD|API_TOKEN|ACCESS_TOKEN|CLIENT_SECRET)\s*=\s*[^\s#<][^\s#]{11,}/,
  /VITE_REOWN_PROJECT_ID\s*=\s*[a-f0-9]{32}\b/i,
];
const forbiddenPath =
  /(?:^|\/)(?:node_modules|\.tools|\.state|dist|out|cache|broadcast|keystores?|secrets?|test-results|screenshots)(?:\/|$)|(?:^|\/)\.env(?:$|\.(?!example$))|(?:^|\/)UTC--|\.(?:pem|key|p12|pfx|keystore|password|log|tmp|bak)$|^deploy\/|^\.gitlab-ci\.yml$|^docs\/(?:DEPLOYMENT|GITLAB_DEPLOYMENT|INFRASTRUCTURE|LOCAL_LIVE_WORKFLOW|RELEASE_HANDOFF|REVIEW|VALIDATION)\.md$|^docs\/contract-hardening\.diff$|^web\/public\/deployment(?:\.local)?\.json$/i;
let failures = 0;
for (const file of files) {
  if (
    forbiddenPath.test(file) ||
    (file.startsWith("deployments/") &&
      !["deployments/mainnet.json", "deployments/wallets.json"].includes(file))
  ) {
    console.error(`${file}: private, generated or operational file must not be published`);
    failures++;
    continue;
  }
  const body = await readFile(file).catch((e) => {
    if (e.code !== "ENOENT" && e.code !== "EISDIR") throw e;
    return null;
  });
  if (!body || body.includes(0)) continue;
  body
    .toString("utf8")
    .split("\n")
    .forEach((line, i) => {
      if (patterns.some((pattern) => pattern.test(line))) {
        console.error(`${file}:${i + 1}: possible credential; review before publication`);
        failures++;
      }
    });
}
if (failures) process.exitCode = 1;
else
  console.log(`Publication guard passed (${files.length} files; common credential patterns only).`);
