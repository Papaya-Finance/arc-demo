import { useStepTransition } from "./use-ui-lifecycle.jsx";
import React, { useEffect, useRef, useState } from "react";
import { Modal, amount, short } from "./primitives.jsx";
import { FlowStatus, FlowSuccess } from "./flow.jsx";
import { usePersistedFlow } from "../runtime/use-flow.jsx";
import { confirmationBlock } from "../runtime/flow.mjs";
import { MONTH, SCALE } from "../../../scripts/math.mjs";
import {
  subscriptionPlan,
  subscriptionProgress,
  subscriptionStep,
  restoreSubscription,
} from "../runtime/subscription.mjs";
import { scopeKey } from "../runtime/storage.mjs";
import { readableError } from "../runtime/rpc.mjs";

/** Monthly USDC from a per-second rate, rounded to 6 decimals without trailing dust. */
function monthlyUsdc(rate) {
  const micro = (BigInt(rate) * MONTH + SCALE / 2n) / SCALE;
  const text = amount(micro, 6);
  return text.includes(".") ? text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : text;
}

function usdc(micro) {
  const text = amount(micro ?? 0n, 6);
  return text.includes(".") ? text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : text;
}

export function SubscriptionWizard({ config, runtime, run, begin, to, rate, kind, onClose }) {
  const key = `papaya:subscription:${scopeKey(config, runtime.account)}:${kind}:${to.toLowerCase()}`;
  const { flow, save, mounted } = usePersistedFlow(
    key,
    restoreSubscription,
    subscriptionProgress,
    runtime.txs,
  );
  const [months, setMonths] = useState(flow?.months || 1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    armed = useRef(false);
  useEffect(
    () => () => {
      armed.current = false;
    },
    [],
  );
  const progress = subscriptionProgress(flow, runtime.txs);
  const actualRate = flow ? BigInt(flow.rate) : rate;
  const actualTo = flow?.to || to;
  let plan;
  try {
    plan = subscriptionPlan(runtime.data, actualTo, actualRate, months, runtime.account);
  } catch {}
  const review = flow?.stage === "review";
  const finished = progress.phase === "success";
  const { shownReview, stageRef, innerRef, stepFade, stageH, onTransitionEnd } =
    useStepTransition(review);
  const ready = !!runtime.signer && runtime.readStatus === "loaded";
  const locked = busy || !!runtime.pending || ["pending", "unknown"].includes(progress.phase);
  const minimumBlock = () => confirmationBlock(progress.rows);

  async function next() {
    if (lock.current || !ready || locked) return;
    lock.current = true;
    setBusy(true);
    setError("");
    armed.current = false;
    try {
      const data = await runtime.rpc.account(runtime.account, minimumBlock());
      if (!mounted.current) return;
      const p = subscriptionPlan(data, actualTo, actualRate, months, runtime.account);
      const f = {
        id: crypto.randomUUID(),
        kind,
        to: actualTo,
        rate: actualRate.toString(),
        months,
        deposit: p.deposit.toString(),
        target: p.target.toString(),
        stage: p.needsApproval ? "allowance" : "review",
      };
      save(f);
      if (p.needsApproval)
        await run(
          "Approve subscription allowance",
          (_, token) => token.approve(config.papaya, p.target),
          null,
          { flowId: f.id, step: "stream-approval" },
        );
    } catch (e) {
      if (mounted.current) setError(readableError(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function checkout() {
    if (lock.current || !ready || locked || !flow) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await runtime.rpc.account(runtime.account, minimumBlock());
      if (!mounted.current) return;
      const next = subscriptionStep(flow, runtime.txs, data, runtime.account);
      if (next.step === "deposit") {
        armed.current = true;
        const hash = await run("Fund subscription", (p) => p.deposit(next.amount, false), null, {
          flowId: flow.id,
          step: "stream-deposit",
        });
        if (!hash) armed.current = false;
      } else if (next.step === "subscribe") {
        armed.current = false;
        await begin(
          flow.to,
          BigInt(flow.rate),
          kind === "scooter" ? "Start ride" : "Start subscription",
          { flowId: flow.id, step: "stream-subscribe" },
        );
      }
    } catch (e) {
      armed.current = false;
      if (mounted.current) setError(readableError(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (
      flow?.stage === "allowance" &&
      progress.rows.some((r) => r.step === "stream-approval" && r.status === "confirmed")
    )
      save({ ...flow, stage: "review" });
    if (progress.phase === "retry") armed.current = false;
    if (
      armed.current &&
      progress.phase === "ready" &&
      progress.tx?.step === "stream-deposit" &&
      ready &&
      !locked
    ) {
      armed.current = false;
      void checkout();
    }
  }, [progress.phase, progress.tx?.id, flow?.stage, ready, locked]);
  function back() {
    armed.current = false;
    save(null);
    setError("");
  }
  const coverageMonths = flow?.months ?? months;
  const deposit = flow?.deposit != null ? BigInt(flow.deposit) : plan?.deposit;
  const rateLabel = `${monthlyUsdc(actualRate)} USDC / 30 days`;
  const stepTitle = finished
    ? kind === "scooter"
      ? "Ride started."
      : "Subscribed."
    : shownReview
      ? "Subscription"
      : "Allowance";
  const headerCenter = !finished ? (
    <div className="wizard-stepper-cluster">
      <div className="wizard-stepper" role="group" aria-label="Subscription steps">
        <span
          className={`wizard-stepper-segment${!shownReview ? " is-active" : ""}`}
          aria-hidden="true"
        />
        <span
          className={`wizard-stepper-segment${shownReview ? " is-active" : ""}`}
          aria-hidden="true"
        />
      </div>
      <span id="dialog-title" className={`wizard-step-label wizard-step-label-${stepFade}`}>
        {stepTitle}
      </span>
    </div>
  ) : null;

  return (
    <Modal
      className={`review-modal subscription-modal${finished ? "" : " subscription-modal-stepper"}`}
      title={finished ? stepTitle : ""}
      headerCenter={headerCenter}
      onClose={onClose}
    >
      <div className="wizard-page">
        {finished ? (
          <FlowSuccess onClose={onClose}>
            {kind === "scooter"
              ? "Your ride is now streaming. Stop it when you finish."
              : "Your recurring subscription is active. Stop it anytime in Controls."}
          </FlowSuccess>
        ) : (
          <div
            className={`subscription-stage${stageH != null ? " is-morphing" : ""}`}
            ref={stageRef}
            onTransitionEnd={onTransitionEnd}
            style={stageH != null ? { height: `${stageH}px` } : undefined}
          >
            <div className="subscription-stage-inner" ref={innerRef}>
              <div className={`subscription-step-body subscription-step-body-${stepFade}`}>
                {!shownReview ? (
                  <>
                    <p className="subscription-question">
                      For how many months can Papaya automatically top up from your wallet?
                    </p>
                    <div className="period-grid">
                      {[1, 3, 6, 12].map((n) => (
                        <button
                          key={n}
                          disabled={locked}
                          aria-pressed={months === n}
                          onClick={() => setMonths(n)}
                        >
                          {n} {n === 1 ? "month" : "months"}
                        </button>
                      ))}
                    </div>
                    <dl className="review-list subscription-facts">
                      <div>
                        <dt>Rate</dt>
                        <dd>{rateLabel}</dd>
                      </div>
                      {plan && plan.deposit > 0n && (
                        <div>
                          <dt>Deposit now</dt>
                          <dd>{usdc(plan.deposit)} USDC</dd>
                        </div>
                      )}
                      <div>
                        <dt>Allowance</dt>
                        <dd>
                          {plan
                            ? plan.needsApproval
                              ? `${usdc(plan.target)} USDC`
                              : "Already approved"
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <>
                    <dl className="review-list subscription-facts">
                      <div>
                        <dt>Recipient</dt>
                        <dd className="subscription-address" title={actualTo}>
                          {short(actualTo)}
                        </dd>
                      </div>
                      <div>
                        <dt>Rate</dt>
                        <dd>{rateLabel}</dd>
                      </div>
                      <div>
                        <dt>Coverage</dt>
                        <dd>
                          {coverageMonths} {coverageMonths === 1 ? "month" : "months"}
                        </dd>
                      </div>
                      {deposit != null && deposit > 0n && (
                        <div>
                          <dt>Deposit now</dt>
                          <dd>{usdc(deposit)} USDC</dd>
                        </div>
                      )}
                    </dl>
                  </>
                )}
              </div>
              {shownReview &&
                runtime.data &&
                deposit != null &&
                deposit > runtime.data.external &&
                !progress.rows.some(
                  (r) => r.step === "stream-deposit" && r.status === "confirmed",
                ) && (
                  <p className="error-text">
                    Not enough USDC in your wallet. Add wallet USDC, then continue here.
                  </p>
                )}
              {progress.rows.length > 0 && (
                <div className="subscription-transactions" aria-live="polite">
                  {[...progress.rows].reverse().map((tx) => (
                    <FlowStatus key={tx.id} tx={tx} explorer={config.explorer} showLabel />
                  ))}
                </div>
              )}
              {progress.phase === "unknown" && (
                <p role="alert" className="error-text">
                  Check your wallet and Activity before continuing: no transaction hash was
                  returned.
                </p>
              )}
              {(error || runtime.error) && (
                <p role="alert" className="error-text">
                  {error || runtime.error}
                </p>
              )}
              <div className="wizard-actions">
                {shownReview && (
                  <button
                    disabled={
                      locked ||
                      progress.rows.some(
                        (r) => r.step === "stream-deposit" && r.status === "confirmed",
                      )
                    }
                    onClick={back}
                  >
                    Back
                  </button>
                )}
                <button
                  className="primary wide"
                  disabled={locked || !ready || !plan}
                  onClick={review ? checkout : next}
                >
                  {busy
                    ? "Checking…"
                    : progress.phase === "pending"
                      ? "Waiting for confirmation"
                      : review
                        ? deposit != null &&
                          deposit > 0n &&
                          !progress.rows.some(
                            (r) => r.step === "stream-deposit" && r.status === "confirmed",
                          )
                          ? "Deposit & subscribe"
                          : "Confirm subscription"
                        : plan?.needsApproval
                          ? "Approve & continue"
                          : "Continue"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
