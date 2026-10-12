import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import { Check, X, ArrowRight, Radio, Clock3 } from "./icons.mjs";
import { Modal, short } from "./primitives.jsx";
import { browserStorage, readStored, writeStored, scopeKey } from "../runtime/storage.mjs";
import { sortActivity } from "../runtime/rpc.mjs";
export const statusLabels = {
  awaiting_signature: "Confirm in wallet",
  submitted: "Transaction submitted",
  confirming: "Confirming on Arc",
  confirmed: "Confirmed",
  reverted: "Reverted on Arc",
  rejected: "Rejected in wallet",
  failed: "Failed before submission",
  rpc_unknown: "Recovering transaction status",
  recovering: "Recovering transaction status",
};
const failure = new Set(["failed", "reverted", "rejected"]);
const terminal = new Set(["confirmed", ...failure]);
export const activityId = (r) => r.id || `keeper:${r.hash}:${r.logIndex ?? r.label}`;
export const activityVersion = (r) => `${r.status}:${r.detail || ""}`;
export function useActivity(config, account, txs, events, open) {
  const key = config && account ? `papaya:activity-read:${scopeKey(config, account)}` : "";
  const rows = sortActivity([...txs, ...events]);
  const [read, setRead] = useState({ key: "", seen: {} });
  const versions = JSON.stringify(rows.map((r) => [activityId(r), activityVersion(r)]));
  useEffect(() => {
    setRead({ key, seen: readStored(browserStorage(), key, {}) });
  }, [key]);
  useEffect(() => {
    if (!open || !key) return;
    const seen = Object.fromEntries(JSON.parse(versions));
    writeStored(browserStorage(), key, seen);
    setRead({ key, seen });
  }, [open, key, versions]);
  return {
    rows,
    unread: rows.filter((r) => read.key !== key || read.seen[activityId(r)] !== activityVersion(r))
      .length,
  };
}
/** One column: empty → 1 → 2 → 3 → 3 → 2 → 1 → empty. Three cols, offset by 1. */
const COL_PHASES = [
  [0, 0, 0], // empty  [bottom, mid, top]
  [1, 0, 0], // 1
  [1, 1, 0], // 2
  [0, 1, 1], // 3
  [0, 1, 1], // 3
  [1, 1, 0], // 2
  [1, 0, 0], // 1
];
export function StatusWave() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((f) => (f + 1) % COL_PHASES.length), 140);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="status-wave" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const col = i % 3;
        const fromBottom = 2 - Math.floor(i / 3);
        const phase = COL_PHASES[(t - col + COL_PHASES.length) % COL_PHASES.length];
        return <i key={i} className={phase[fromBottom] ? "on" : undefined} />;
      })}
    </span>
  );
}
export function StateIcon({ status }) {
  return status === "confirmed" ? (
    <Check size={18} />
  ) : failure.has(status) ? (
    <X size={18} />
  ) : (
    <StatusWave />
  );
}
export const isFundingTx = (r) => r?.step === "approval" || r?.step === "deposit";
export const isWithdrawTx = (r) => r?.step === "withdraw";
export const isInFlight = (r) => !!r && !terminal.has(r.status);
export function ActivityDrawer({ rows, config, onClose, onSelectFunding, onSelectWithdraw }) {
  return (
    <Modal title="Your activity" drawer onClose={onClose}>
      <div className="activity-list">
        {!rows.length && (
          <div className="empty-state">
            <Clock3 size={32} />
            <h3>A fresh start.</h3>
            <p>Your transactions will appear here.</p>
          </div>
        )}
        {rows.map((r) => {
          const inFlight = isInFlight(r);
          const funding = inFlight && isFundingTx(r) && onSelectFunding;
          const withdraw = inFlight && isWithdrawTx(r) && onSelectWithdraw;
          const resumable = funding || withdraw;
          const href =
            !resumable && r.hash && config.explorer ? `${config.explorer}/tx/${r.hash}` : null;
          const Tag = resumable ? "button" : href ? "a" : "article";
          const linkProps = funding
            ? { type: "button", onClick: () => onSelectFunding(r) }
            : withdraw
              ? { type: "button", onClick: () => onSelectWithdraw(r) }
              : href
                ? { href, target: "_blank", rel: "noreferrer" }
                : {};
          return (
            <Tag
              className={`activity-row${failure.has(r.status) ? " has-error" : ""}${resumable || href ? " is-link" : ""}`}
              key={activityId(r)}
              {...linkProps}
            >
              <div className={`state-icon ${r.status}`}>
                <StateIcon status={r.status} />
              </div>
              <div className="activity-body">
                <div className="activity-main">
                  <strong>{r.label}</strong>
                  <span className="status-caption">{statusLabels[r.status] || r.status}</span>
                  {r.detail && <p className="failure-detail">{r.detail}</p>}
                  {!r.id && (
                    <small>
                      <Radio size={12} /> Keeper event · block {r.blockNumber}
                    </small>
                  )}
                </div>
                <div className="activity-meta">
                  <time
                    dateTime={r.createdAt ? new Date(r.createdAt).toISOString() : undefined}
                    title={
                      r.createdAt
                        ? new Date(r.createdAt).toLocaleString()
                        : "Date unavailable for this older entry"
                    }
                  >
                    {r.createdAt
                      ? new Intl.DateTimeFormat(undefined, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(r.createdAt))
                      : "—"}
                  </time>
                  {r.hash ? (
                    config.explorer ? (
                      <span className="tx-link">
                        {short(r.hash)} <ArrowRight size={12} />
                      </span>
                    ) : (
                      <code>{short(r.hash)} · local</code>
                    )
                  ) : null}
                </div>
              </div>
            </Tag>
          );
        })}
      </div>
    </Modal>
  );
}
export function TransactionToast({ txs, account, onSelect, overlayKey }) {
  const [container, setContainer] = useState(null);
  useEffect(() => {
    setContainer(document.querySelector("dialog[open]") || document.body);
  }, [overlayKey]);
  const [dismissed, setDismissed] = useState("");
  // Terminal rows restored from the journal must not toast on reload; only
  // celebrate when a row becomes terminal during this browser session.
  const [freshTerminal, setFreshTerminal] = useState("");
  const prevStatus = useRef(new Map());
  useEffect(() => {
    prevStatus.current = new Map();
    setFreshTerminal("");
    setDismissed("");
  }, [account]);
  useEffect(() => {
    const next = new Map();
    for (const row of txs) {
      const was = prevStatus.current.get(row.id);
      next.set(row.id, row.status);
      if (was && !terminal.has(was) && terminal.has(row.status))
        setFreshTerminal(`${account}:${row.id}:${row.status}`);
    }
    prevStatus.current = next;
  }, [txs, account]);
  // Only live wallet waits / hashed in-flight rows. Hashless rpc_unknown is not onchain.
  const active = txs.find(
    (r) => r.status === "awaiting_signature" || (r.hash && !terminal.has(r.status)),
  );
  const celebrated =
    freshTerminal && txs.find((r) => `${account}:${r.id}:${r.status}` === freshTerminal);
  const tx = active || celebrated || null;
  const signature = tx ? `${account}:${tx.id}:${tx.status}` : "";
  if (!container || !tx || dismissed === signature) return null;
  return createPortal(
    <aside
      className={`tx-toast ${failure.has(tx.status) ? "has-error" : ""}`}
      role="status"
      aria-live="polite"
      key={signature}
    >
      <div className={`toast-icon ${tx.status}`}>
        <StateIcon status={tx.status} />
      </div>
      <button className="toast-body" onClick={() => onSelect?.(tx)}>
        <strong>{statusLabels[tx.status]}</strong>
        <span>{tx.label}</span>
        {tx.detail && <small>{tx.detail}</small>}
        {tx.status === "rpc_unknown" && !tx.hash && (
          <small>No hash returned; check wallet before retrying.</small>
        )}
      </button>
      <button
        className="icon-button"
        aria-label="Dismiss transaction notification"
        onClick={() => setDismissed(signature)}
      >
        <X size={16} />
      </button>
    </aside>,
    container,
  );
}
