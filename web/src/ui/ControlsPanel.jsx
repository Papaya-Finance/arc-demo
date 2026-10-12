import { useDismiss, useCopyFeedback } from "./use-ui-lifecycle.jsx";
import React, { useId, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Info, Minus, Plus } from "./icons.mjs";
import { Money } from "./primitives.jsx";
import { Subscriptions } from "./Subscriptions.jsx";

function FactTip({ label, text }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useDismiss(open, root, () => setOpen(false));
  return (
    <span className={`controls-fact-tip${open ? " is-open" : ""}`} ref={root}>
      <button
        type="button"
        className="controls-fact-tip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={14} aria-hidden />
      </button>
      <span id={id} role="tooltip" className="controls-fact-tip-bubble" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

function ProtocolRow({ label, value, explorer }) {
  const { copied, copy } = useCopyFeedback();
  const href = explorer && value ? `${explorer}/address/${value}` : null;
  return (
    <div className="controls-protocol-row">
      <div className="controls-protocol-text">
        <span className="controls-copy-label">{label}</span>
        <span className="controls-copy-value">{value || "—"}</span>
      </div>
      <span className="controls-protocol-meta">
        <button
          type="button"
          className="controls-icon-btn"
          onClick={() => copy(value)}
          disabled={!value}
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          title={copied ? "Copied" : `Copy ${label}`}
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        </button>
        {href ? (
          <a
            className="controls-icon-btn"
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${label} in explorer`}
            title="Open in explorer"
          >
            <ArrowRight size={15} aria-hidden />
          </a>
        ) : null}
      </span>
    </div>
  );
}

function ControlsRow({ title, lede, surfaceClassName = "", children }) {
  return (
    <div className="controls-row">
      <div className="controls-copy">
        <h2>{title}</h2>
        {lede && <p className="muted">{lede}</p>}
      </div>
      <div className={`controls-surface${surfaceClassName ? ` ${surfaceClassName}` : ""}`}>
        {children}
      </div>
    </div>
  );
}

export function ControlsPanel({
  config,
  runtime,
  readableBalance,
  accountReady,
  ready,
  onFund,
  onWithdraw,
  onBudget,
  onRevoke,
  onSubscribe,
  onStop,
}) {
  const owner = config?.projectOwner || config?.owner || "";
  const allowance = runtime.data?.allowance;
  const walletBalance = runtime.data?.external ?? null;

  return (
    <section className="controls-panel">
      <ControlsRow
        title="Balance & permission"
        lede="Fund streams and set how much the keeper may refill from your wallet."
      >
        <div className="controls-balance-head">
          <div>
            <span className="controls-fact-label">Papaya balance</span>
            <strong className="controls-balance-value">
              <Money value={readableBalance} />
              <small> USDC</small>
            </strong>
          </div>
          <div className="controls-balance-actions">
            <button
              type="button"
              className="controls-icon-btn"
              disabled={!accountReady}
              onClick={onFund}
              aria-label="Add funds"
              title="Add funds"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              className="controls-icon-btn"
              disabled={!accountReady}
              onClick={onWithdraw}
              aria-label="Withdraw"
              title="Withdraw"
            >
              <Minus size={16} />
            </button>
          </div>
        </div>
        <dl className="controls-facts">
          <div>
            <dt>Wallet balance</dt>
            <dd>
              <Money value={walletBalance} decimals={6} /> USDC
            </dd>
          </div>
          <div>
            <dt>
              <FactTip
                label="Refill allowance"
                text="Maximum amount Papaya can automatically add from your wallet when your balance gets low. You can change or disable it anytime."
              />
              <span>Refill allowance</span>
            </dt>
            <dd>
              <Money value={allowance} decimals={6} /> USDC
            </dd>
          </div>
        </dl>
        <div className="button-row">
          <button type="button" className="controls-soft-btn" disabled={!ready} onClick={onBudget}>
            Change refill budget
          </button>
          <button
            type="button"
            className="controls-soft-btn"
            disabled={!ready || !allowance}
            onClick={onRevoke}
          >
            Revoke allowance
          </button>
        </div>
      </ControlsRow>

      <ControlsRow
        title="Subscriptions"
        lede="Create arbitrary streams or review outgoing and incoming payments."
      >
        <Subscriptions
          key={runtime.account?.toLowerCase()}
          config={config}
          runtime={runtime}
          onSubscribe={onSubscribe}
          onStop={onStop}
          hideTitle
        />
      </ControlsRow>

      <ControlsRow title="Protocol information" surfaceClassName="controls-protocol-surface">
        <div className="controls-protocol-rows">
          <ProtocolRow label="Papaya protocol" value={config?.papaya} explorer={config?.explorer} />
          <ProtocolRow label="USDC" value={config?.usdc} explorer={config?.explorer} />
          <ProtocolRow label="Owner" value={owner} explorer={config?.explorer} />
        </div>
      </ControlsRow>
    </section>
  );
}
