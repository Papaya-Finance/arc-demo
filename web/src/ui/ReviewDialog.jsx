import React, { useState } from "react";
import { FlowStatus, FlowSuccess } from "./flow.jsx";
import { Modal } from "./primitives.jsx";
export function ReviewDialog({
  title,
  description,
  details,
  warning,
  children,
  onClose,
  submit,
  runtime,
  valid = true,
  successTitle,
  successMessage,
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const tx = runtime.txs.find((r) => r.flowId === id);
  const success = tx?.status === "confirmed";
  const pending = tx && !["confirmed", "rejected", "failed", "reverted"].includes(tx.status);
  const doneTitle = successTitle || "Done.";
  const doneMessage = successMessage || "Your action is confirmed onchain.";
  return (
    <Modal className="review-modal" title={success ? doneTitle : title} onClose={onClose}>
      <div className="wizard-page">
        {success ? (
          <FlowSuccess onClose={onClose}>{doneMessage}</FlowSuccess>
        ) : (
          <>
            {description && <p className="muted">{description}</p>}
            {children}
            {!!details?.length && (
              <dl className="review-list">
                {details.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {warning && <p className="inline-warning">{warning}</p>}
            <FlowStatus tx={tx} />
            {runtime.error && (
              <p role="alert" className="error-text">
                {runtime.error}
              </p>
            )}
            <div className="wizard-actions">
              <button type="button" onClick={onClose}>
                {pending ? "Close" : "Cancel"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  !valid ||
                  busy ||
                  !!pending ||
                  !!runtime.pending ||
                  !runtime.signer ||
                  runtime.readStatus !== "loaded"
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    await submit({ flowId: id });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {pending ? "Waiting for confirmation" : "Confirm"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
