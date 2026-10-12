import React, { useEffect, useState } from "react";
import { parseUnits } from "ethers";
import { MONTH, SCALE, ceilDiv } from "../../../scripts/math.mjs";
import { amount, short, ExternalLink } from "./primitives.jsx";
import { browserStorage, readStored, writeStored, scopeKey } from "../runtime/storage.mjs";
import { scanIncoming } from "../runtime/incoming.mjs";

function storedIncoming(scope, deploymentBlock) {
  const key = `papaya:incoming:v1:${scope}`;
  const saved = readStored(browserStorage(), key, null);
  const ok =
    saved &&
    Number.isInteger(saved.cursor) &&
    saved.cursor >= deploymentBlock &&
    saved.rows &&
    typeof saved.rows === "object";
  return { key, state: ok ? saved : { cursor: deploymentBlock, rows: {} } };
}

function rateFromMonthly(value) {
  try {
    // Parse as USDC (6 decimals) so the monthly amount round-trips cleanly through refillQuote.
    const monthlyMicro = parseUnits(value.trim(), 6);
    if (monthlyMicro <= 0n) return null;
    const rate = ceilDiv(monthlyMicro * SCALE, MONTH);
    if (rate <= 0n || rate >= 2n ** 96n) return null;
    return rate;
  } catch {
    return null;
  }
}

export function Subscriptions({ config, runtime, onSubscribe, onStop, hideTitle = false }) {
  const [direction, setDirection] = useState("out");
  const [recipient, setRecipient] = useState("");
  const [monthly, setMonthly] = useState("");
  const scope = runtime.account && config ? scopeKey(config, runtime.account) : "";
  const deploymentBlock = config?.deploymentBlock;
  const [incoming, setIncoming] = useState(() => {
    if (!scope || deploymentBlock == null) return { rows: {}, status: "loading" };
    return { ...storedIncoming(scope, deploymentBlock).state, scope, status: "loading" };
  });
  useEffect(() => {
    if (!scope || deploymentBlock == null) return;
    let stopped = false,
      timer,
      failures = 0;
    const { key, state: initial } = storedIncoming(scope, deploymentBlock);
    let state = initial;
    // Hydrate from localStorage before the first RPC page so a remount does not flash an empty table.
    setIncoming((prev) =>
      prev.scope === scope && Object.keys(prev.rows || {}).length
        ? { ...prev, status: prev.status === "loaded" ? prev.status : "loading" }
        : { ...state, scope, status: "loading" },
    );
    const account = runtime.account;
    const read = (from, to) => runtime.rpc.incoming(from, to, account);
    async function poll() {
      try {
        const head = (await runtime.rpc.getBlock("latest")).number;
        const next = await scanIncoming({
          read,
          from: state.cursor,
          head,
          rows: state.rows,
          stopped: () => stopped,
        });
        if (stopped || !next) return;
        state = { rows: next.rows, cursor: next.cursor };
        writeStored(browserStorage(), key, state);
        failures = 0;
        setIncoming({ ...state, scope, status: next.complete ? "loaded" : "loading" });
        timer = setTimeout(poll, next.complete ? 15000 : 500);
      } catch {
        if (stopped) return;
        setIncoming({ ...state, scope, status: "stale" });
        timer = setTimeout(poll, Math.min(2000 * 2 ** failures++, 30000));
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [scope, deploymentBlock, runtime.account]);
  const outgoing = Object.entries(runtime.data?.subscriptions || {});
  // Keep last rows visible if the wallet account blips to empty; only swap when scope actually changes.
  const incomingRows =
    incoming.scope === scope ? incoming.rows : !scope && incoming.rows ? incoming.rows : {};
  const entries = direction === "out" ? outgoing : Object.entries(incomingRows || {});
  const ready = !!runtime.signer && runtime.readStatus === "loaded" && !runtime.pending;
  const rate = rateFromMonthly(monthly);
  const emptyMessage = !scope
    ? "Connect your wallet to view subscriptions."
    : direction === "in"
      ? "No incoming subscriptions."
      : "No outgoing subscriptions.";
  return (
    <div className={`subscriptions${hideTitle ? " subscriptions-embedded" : ""}`}>
      {!hideTitle && <h3>Subscriptions</h3>}
      <form
        className="subscription-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!rate) return;
          onSubscribe(recipient.trim(), rate);
        }}
      >
        <label>
          Recipient address
          <input
            aria-label="Subscription recipient"
            placeholder="0x…"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Amount / 30 days
          <input
            aria-label="Monthly subscription amount"
            inputMode="decimal"
            placeholder="0.0"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          type="submit"
          className="controls-soft-btn"
          disabled={!ready || !recipient || !rate}
        >
          Create subscription
        </button>
      </form>
      <div
        className="view-toggle subscription-direction"
        role="group"
        aria-label="Subscription direction"
      >
        <button aria-pressed={direction === "out"} onClick={() => setDirection("out")}>
          Outgoing · {outgoing.length}
        </button>
        <button aria-pressed={direction === "in"} onClick={() => setDirection("in")}>
          Incoming · {Object.keys(incomingRows || {}).length}
        </button>
      </div>
      <div className="subscription-table-wrap">
        <table className="subscription-table">
          <thead>
            <tr>
              <th>{direction === "out" ? "Recipient" : "Sender"}</th>
              <th>USDC / 30 days</th>
              <th>Project</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([address, s]) => (
              <tr key={address}>
                <td>
                  <ExternalLink href={`${config.explorer}/address/${address}`}>
                    {short(address)}
                  </ExternalLink>
                </td>
                <td>
                  {amount(
                    ceilDiv(BigInt(direction === "out" ? s.outgoing : s.income) * MONTH, SCALE),
                    6,
                  )}
                </td>
                <td>{String(s.projectId)}</td>
                <td>
                  {direction === "out" ? (
                    <button disabled={!ready} onClick={() => onStop(address)}>
                      Unsubscribe
                    </button>
                  ) : (
                    <span className="caption">Sender controls</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="subscription-empty muted">{emptyMessage}</p>}
      </div>
    </div>
  );
}
