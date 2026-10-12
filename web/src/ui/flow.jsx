import React from "react";
import { Check } from "./icons.mjs";
import { StateIcon, statusLabels } from "./activity.jsx";
import { ExternalLink } from "./primitives.jsx";

export function FlowStatus({ tx, explorer, showLabel = false }) {
  if (!tx) return null;
  const failed = ["failed", "reverted", "rejected"].includes(tx.status);
  return (
    <div className={`flow-status ${failed ? "has-error" : ""}`}>
      <div className={`state-icon ${tx.status}`}>
        <StateIcon status={tx.status} />
      </div>
      <div>
        <strong>
          {showLabel ? `${tx.label} · ${statusLabels[tx.status]}` : statusLabels[tx.status]}
        </strong>
        <span>{showLabel ? tx.detail : tx.detail || tx.label}</span>
        {showLabel && tx.hash && (
          <ExternalLink href={`${explorer}/tx/${tx.hash}`}>View transaction</ExternalLink>
        )}
      </div>
    </div>
  );
}
export function FlowSuccess({ children, onClose, onRestart, restartLabel }) {
  return (
    <div className="success-state">
      <div className="success-symbol">
        <Check size={32} />
      </div>
      <p>{children}</p>
      <button className="primary wide" onClick={onClose}>
        Done
      </button>
      {onRestart && (
        <button className="quiet wide" onClick={onRestart}>
          {restartLabel}
        </button>
      )}
    </div>
  );
}
export function AmountField({ label, value, onChange, disabled = false }) {
  return (
    <label className="amount-field funding-amount">
      <div className="funding-amount-row">
        <input
          aria-label={label}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0"
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="funding-amount-unit">USDC</span>
      </div>
    </label>
  );
}
