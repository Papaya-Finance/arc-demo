import React, { useEffect, useRef, useState } from "react";
import { parseUnits } from "ethers";
import { Wallet } from "./icons.mjs";
import { Modal, amount } from "./primitives.jsx";
import { FlowStatus, FlowSuccess, AmountField } from "./flow.jsx";
import { usePersistedFlow } from "../runtime/use-flow.jsx";
import { scopeKey } from "../runtime/storage.mjs";
import { fundingPlan, fundingProgress, restoreFunding } from "../runtime/funding.mjs";
import { withdrawProgress, restoreWithdraw } from "../runtime/withdraw.mjs";
import { confirmationBlock } from "../runtime/flow.mjs";
import { readableError } from "../runtime/rpc.mjs";
import { SCALE } from "../../../scripts/math.mjs";

/** One amount form and persisted lifecycle; only the onchain operations differ. */
export function BalanceWizard({ kind, config, runtime, run, onClose, balance }) {
  const funding = kind === "funding";
  const project = funding ? fundingProgress : withdrawProgress;
  const restore = funding ? restoreFunding : restoreWithdraw;
  const field = funding ? "deposit" : "amount";
  const key = `papaya:${kind}:${scopeKey(config, runtime.account)}`;
  const { flow, save, mounted } = usePersistedFlow(key, restore, project, runtime.txs);
  const [value, setValue] = useState(flow ? amount(BigInt(flow[field]), 6) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false),
    armed = useRef(false);
  const allowSuccess = useRef(
    ["pending", "continue", "unknown", "retry"].includes(project(flow, runtime.txs).phase),
  );
  useEffect(
    () => () => {
      armed.current = false;
    },
    [],
  );
  let micro = 0n;
  try {
    if (value) micro = parseUnits(value, 6);
  } catch {
    /* keep incomplete decimal input editable */
  }
  const available = funding
    ? runtime.data?.external
    : balance == null
      ? null
      : balance > 0n
        ? balance / SCALE
        : 0n;
  const enough = micro > 0n && available != null && available >= micro;
  const progress = project(flow, runtime.txs);
  const ready = !!runtime.signer && runtime.readStatus === "loaded" && !!runtime.data?.user;
  const locked = ["pending", "unknown", "success"].includes(progress.phase) || busy;
  const setMax = () => {
    if (available > 0n) setValue(amount(available, 6));
  };
  const onAmount = (e) => {
    const next = e.target.value.trim();
    if (/^(?:\d+|\d*\.\d*)?$/.test(next)) setValue(next);
  };
  async function advance() {
    if (busyRef.current || !ready || runtime.pending) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let f = flow;
      if (!f) {
        if (!enough)
          throw Error(`Check the amount and your ${funding ? "wallet" : "Papaya"} balance`);
        f = { id: crypto.randomUUID(), [field]: micro.toString() };
        save(f);
      }
      const state = project(f, runtime.txs);
      if (["pending", "unknown", "success"].includes(state.phase)) return;
      allowSuccess.current = true;
      if (funding) {
        const current = await runtime.rpc.allowance(runtime.account, confirmationBlock(state.rows));
        if (!mounted.current) return;
        const next = fundingPlan(BigInt(f.deposit), current);
        if (next.needsApproval) {
          if (state.rows.some((r) => r.step === "approval" && r.status === "confirmed"))
            throw Error(
              "Allowance changed after confirmation. Close this flow and review the remaining allowance in Papaya controls before continuing.",
            );
          armed.current = true;
          const hash = await run(
            "Approve USDC",
            (_, token) => token.approve(config.papaya, next.target),
            null,
            { flowId: f.id, step: "approval" },
          );
          if (!hash) armed.current = false;
        } else {
          armed.current = false;
          await run("Add funds", (papaya) => papaya.deposit(next.deposit, false), null, {
            flowId: f.id,
            step: "deposit",
          });
        }
      } else {
        await run("Withdraw funds", (papaya) => papaya.withdraw(BigInt(f.amount) * SCALE), null, {
          flowId: f.id,
          step: "withdraw",
        });
      }
    } catch (e) {
      if (mounted.current) setError(readableError(e));
      armed.current = false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (progress.phase === "retry") armed.current = false;
    if (progress.phase === "continue" && armed.current && ready && !runtime.pending && !busy) {
      armed.current = false;
      void advance();
    }
  }, [progress.phase, progress.tx?.id, ready, runtime.pending, busy]);
  useEffect(() => {
    if (["pending", "continue", "unknown", "retry"].includes(progress.phase))
      allowSuccess.current = true;
    if (progress.phase === "success" && !allowSuccess.current) restart();
  }, [progress.phase]);
  function restart() {
    save(null);
    setValue("");
    setError("");
    armed.current = false;
    allowSuccess.current = false;
  }
  function dismiss() {
    if (progress.phase === "success") save(null);
    onClose();
  }
  const success = progress.phase === "success";
  return (
    <Modal
      className="funding-modal"
      title={
        funding ? (success ? "You're funded." : "Add funds") : success ? "Withdrawn." : "Withdraw"
      }
      onClose={dismiss}
    >
      <div className="wizard-page" key={success ? "success" : "form"}>
        {success ? (
          <FlowSuccess
            onClose={dismiss}
            onRestart={restart}
            restartLabel={funding ? "Add more funds" : "Withdraw more"}
          >
            <strong>{amount(BigInt(flow[field]), 6)} USDC</strong>
            {funding ? " added to Papaya." : " sent to your wallet."}
          </FlowSuccess>
        ) : (
          <>
            <AmountField
              label={funding ? "Amount to add" : "Amount to withdraw"}
              value={value}
              onChange={onAmount}
              disabled={!!flow || locked}
            />
            <div className="field-meta">
              <span>
                {funding && <Wallet size={14} />} {funding ? "Wallet" : "Papaya"}:{" "}
                {available == null ? "—" : amount(available, 6)}
              </span>
              <button
                type="button"
                className="funding-max"
                disabled={available == null || available <= 0n || !!flow || locked}
                onClick={setMax}
              >
                MAX
              </button>
            </div>
            {micro > 0n && !enough && (
              <p className="error-text">
                Not enough USDC in your {funding ? "wallet" : "Papaya balance"}.
              </p>
            )}
            <FlowStatus tx={progress.tx} />
            {progress.phase === "unknown" && (
              <p className="error-text">
                No hash was returned. Check your wallet and Activity before starting another{" "}
                {funding ? "deposit" : "withdrawal"}.
              </p>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button
              className="primary wide"
              disabled={locked || !ready || !!runtime.pending || !enough}
              onClick={advance}
            >
              {busy
                ? "Checking…"
                : progress.phase === "pending"
                  ? "Waiting for confirmation"
                  : progress.phase === "continue"
                    ? "Continue funding"
                    : progress.phase === "retry"
                      ? "Try again"
                      : "Confirm"}
            </button>
            {flow && ["review", "retry"].includes(progress.phase) && (
              <button className="quiet wide" onClick={restart}>
                Edit amount
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
