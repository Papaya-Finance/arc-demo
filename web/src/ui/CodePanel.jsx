import React, { useState } from "react";
import { Terminal, Code2 } from "./icons.mjs";
import { CopyButton, amount } from "./primitives.jsx";
import { MONTH, RATES, SCOOTER_RATE } from "../../../scripts/math.mjs";

function Highlight({ code }) {
  return code
    .split(/(\/\/[^\n]*|"[^"\n]*"|\b(?:await|const|false|true)\b|\b\d+n?\b)/g)
    .map((s, i) => (
      <span
        key={i}
        className={
          s.startsWith("//")
            ? "syntax-comment"
            : s.startsWith('"')
              ? "syntax-string"
              : /^(await|const|false|true)$/.test(s)
                ? "syntax-keyword"
                : /^\d/.test(s)
                  ? "syntax-number"
                  : ""
        }
      >
        {s}
      </span>
    ));
}

export function CodePanel({ scenario, config, rate, account, feeBps }) {
  const [tab, setTab] = useState("calls");
  const creator = config?.creator || "0x…";
  const scooter = config?.scooter || "0x…";
  const projectId = config?.projectId ?? 0;
  const fee = feeBps ?? 100n;
  const creatorRate = rate ?? RATES[1];
  const isCreator = scenario === "creator";

  const calls = isCreator
    ? [
        "// creator: pick a monthly rate → per-second uint96",
        `const rates = [${RATES.map((r) => `${r}n`).join(", ")}];`,
        `// ${RATES.map((r) => `${amount(r * MONTH)} / 30d`).join(" | ")}`,
        `const rate = ${creatorRate}n; // ${amount(creatorRate * MONTH)} USDC / 30 days`,
        "",
        "const deposit = /* micro-USDC amount */;",
        "",
        "// 1. deposit into Papaya",
        "await USDC.approve(papaya, deposit); // if allowance < deposit",
        "await Papaya.deposit(deposit, false);",
        "",
        "// 2. start — or change rate later (same call)",
        "await Papaya.subscribe(",
        `  "${creator}",`,
        "  rate,",
        `  ${projectId}`,
        ");",
        "",
        "// 3. stop subscription",
        `await Papaya.unsubscribe("${creator}");`,
      ].join("\n")
    : [
        "// scooter: fixed pay-as-you-go rate",
        `const rate = ${SCOOTER_RATE}n; // ${amount(SCOOTER_RATE * 60n)} USDC / min`,
        "const deposit = /* micro-USDC amount */;",
        "",
        "// 1. deposit into Papaya",
        "await USDC.approve(papaya, deposit); // if allowance < deposit",
        "await Papaya.deposit(deposit, false);",
        "",
        "// 2. start ride",
        "await Papaya.subscribe(",
        `  "${scooter}",`,
        "  rate,",
        `  ${projectId}`,
        ");",
        "",
        "// 3. stop ride",
        `await Papaya.unsubscribe("${scooter}");`,
      ].join("\n");

  const addresses = isCreator
    ? [
        `const kind = "subscription";`,
        `const unit = "USDC / 30 days";`,
        `const chainId = ${config?.chainId || 5042};`,
        `const papaya = "${config?.papaya || "0x…"}";`,
        `const USDC = "${config?.usdc || "0x…"}";`,
        `const user = "${account || "0x…"}";`,
        `const recipient = "${creator}";`,
        `const rates = [${RATES.map((r) => `${r}n`).join(", ")}];`,
        `const rate = ${creatorRate}n;`,
        `const projectId = ${projectId};`,
        `const feeBps = ${fee}n; // creator project fee`,
        "",
        "// write path: staticCall → estimateGas → send → receipt",
      ].join("\n")
    : [
        `const kind = "pay-as-you-go";`,
        `const unit = "USDC / min";`,
        `const chainId = ${config?.chainId || 5042};`,
        `const papaya = "${config?.papaya || "0x…"}";`,
        `const USDC = "${config?.usdc || "0x…"}";`,
        `const user = "${account || "0x…"}";`,
        `const recipient = "${scooter}";`,
        `const rate = ${SCOOTER_RATE}n; // fixed`,
        `const projectId = ${projectId};`,
        `const feeBps = ${fee}n; // scooter project fee`,
        "",
        "// write path: staticCall → estimateGas → send → receipt",
      ].join("\n");

  const code = tab === "calls" ? calls : addresses;
  const copy = isCreator
    ? {
        primary: "Set a monthly amount once.",
        secondary: "Papaya turns it into a continuous USDC stream to the creator.",
      }
    : {
        primary: "Pay only while the service is active.",
        secondary: "Papaya streams USDC from the moment you start until you stop.",
      };

  return (
    <section className="how-it-works">
      <div className="code-intro">
        <h2 className="code-intro-lede">
          <span className="code-intro-primary">{copy.primary}</span>
          <span className="code-intro-secondary">{copy.secondary}</span>
        </h2>
      </div>
      <div className="code-panel">
        <div className="code-tabs" role="tablist" aria-label="Code examples">
          <button role="tab" aria-selected={tab === "calls"} onClick={() => setTab("calls")}>
            <Code2 size={15} /> Calls
          </button>
          <button
            role="tab"
            aria-selected={tab === "addresses"}
            onClick={() => setTab("addresses")}
          >
            <Terminal size={15} /> Parameters
          </button>
          <CopyButton value={code} label="Copy code" />
        </div>
        <div className="code-file">
          {scenario}.js <span>ethers / Arc</span>
        </div>
        <pre
          tabIndex={0}
          role="tabpanel"
          aria-label={tab === "calls" ? "Contract calls" : "Current parameters"}
        >
          <code>
            <Highlight code={code} />
          </code>
        </pre>
      </div>
    </section>
  );
}
