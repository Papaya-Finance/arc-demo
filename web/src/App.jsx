import { writes } from "./runtime/writes.mjs";
import { CreatorScene, ScooterScene } from "./ui/DemoScenes.jsx";
import React, { useState, useEffect, useRef } from "react";
import { isAddress, parseUnits } from "ethers";
import {
  Bell,
  LogOut,
  Eye,
  Terminal,
  Heart,
  SlidersHorizontal,
  Bike,
  Radio,
  Info,
} from "./ui/icons.mjs";
import { ControlsPanel } from "./ui/ControlsPanel.jsx";
import { AddressAvatar } from "./ui/AddressAvatar.jsx";
import { papayaAbi, tokenAbi } from "../../scripts/abi.mjs";
import { RATES, SCOOTER_RATE, MONTH, streamBalance } from "../../scripts/math.mjs";
import { browserStorage, readStored, writeStored } from "./runtime/storage.mjs";
import { useRuntime } from "./runtime/use-runtime.jsx";
import { Logo } from "./ui/Logo.jsx";
import { Money, amount, short, ExternalLink, Modal } from "./ui/primitives.jsx";
import { FundingWizard } from "./ui/FundingWizard.jsx";
import { SubscriptionWizard } from "./ui/SubscriptionWizard.jsx";
import { subscriptionPlan } from "./runtime/subscription.mjs";
import { WithdrawWizard } from "./ui/WithdrawWizard.jsx";
import { ReviewDialog } from "./ui/ReviewDialog.jsx";
import {
  ActivityDrawer,
  TransactionToast,
  useActivity,
  isFundingTx,
  isWithdrawTx,
  isInFlight,
} from "./ui/activity.jsx";
import { CodePanel } from "./ui/CodePanel.jsx";
import { WalletPanel } from "./ui/WalletPanel.jsx";
import { useEns } from "./ui/use-ens.jsx";
export function App() {
  const [config, setConfig] = useState(null);
  const runtime = useRuntime(config);
  const {
    account,
    signer,
    data,
    readStatus,
    error,
    setError,
    pending,
    txs,
    keeperEvents,
    connect,
  } = runtime;
  const [tab, setTab] = useState(() => {
    const saved = readStored(browserStorage(), "papaya:ui-tab", null);
    return ["creator", "scooter", "controls"].includes(saved) ? saved : "creator";
  });
  const [mode, setMode] = useState(() => {
    const saved = readStored(browserStorage(), "papaya:ui-mode", null);
    return saved === "code" ? "code" : "demo";
  });
  const [modal, setModal] = useState(null),
    [activityOpen, setActivityOpen] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [rate, setRate] = useState(RATES[1]),
    [budgetValue, setBudgetValue] = useState("");
  const [clock, setClock] = useState(0n),
    [session, setSession] = useState({});
  const rideLock = useRef(false);
  const [rideChecking, setRideChecking] = useState(false);
  const name = useEns(account);
  useEffect(() => {
    const dock = document.querySelector(".account-dock");
    if (!dock) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--dock-height",
        `${Math.round(dock.getBoundingClientRect().height)}px`,
      ),
    );
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);
  const configured = !!config?.papaya && ["deployed", "local-fork"].includes(config?.status);
  const local = config?.status === "local-fork";
  useEffect(() => {
    fetch(
      import.meta.env.DEV &&
        import.meta.env.VITE_ARC_LIVE_ONLY !== "true" &&
        new URLSearchParams(location.search).get("local") === "1"
        ? `${import.meta.env.BASE_URL}deployment.local.json`
        : `${import.meta.env.BASE_URL}deployment.json`,
    )
      .then((r) => {
        if (!r.ok) throw Error("Deployment configuration unavailable");
        return r.json();
      })
      .then((c) => {
        if (
          import.meta.env.VITE_ARC_LIVE_ONLY === "true" &&
          (c.status !== "deployed" || c.verified !== true || c.chainId !== 5042)
        )
          throw Error("Verified LIVE Arc deployment required");
        if (![5042, 31337].includes(c.chainId)) throw Error("Unsupported deployment chain");
        if (
          c.papaya &&
          (![c.papaya, c.creator, c.scooter, c.usdc].every(isAddress) || c.creator === c.scooter)
        )
          throw Error("Invalid deployment addresses");
        if (
          c.status === "deployed" &&
          (c.chainId !== 5042 || c.explorer !== "https://explorer.arc.io")
        )
          throw Error("Invalid mainnet configuration");
        setConfig(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (data) setClock(data.timestamp);
  }, [data]);
  useEffect(() => {
    if (readStatus !== "loaded") return;
    const timer = setInterval(() => setClock((c) => c + 1n), 1000);
    return () => clearInterval(timer);
  }, [readStatus]);
  const activeCreator = data?.subscriptions?.[config?.creator?.toLowerCase()],
    activeScooter = data?.subscriptions?.[config?.scooter?.toLowerCase()];
  const subscriptions = Object.entries(data?.subscriptions || {}),
    anyActive = subscriptions.length > 0;
  useEffect(() => {
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (anyActive) window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyActive]);
  useEffect(() => {
    setModal(null);
    setActivityOpen(false);
    setSession(
      account && config
        ? readStored(browserStorage(), `papaya:${config.chainId}:${config.papaya}:${account}`, {})
        : {},
    );
  }, [account, config]);
  function saveSession(value) {
    setSession(value);
    writeStored(browserStorage(), `papaya:${config.chainId}:${config.papaya}:${account}`, value);
  }
  function run(label, action, after, context) {
    return runtime.transact(
      label,
      (s, send, simulate) =>
        action(
          writes(config.papaya, papayaAbi, s, send, simulate),
          writes(config.usdc, tokenAbi, s, send, simulate),
        ),
      after,
      context,
    );
  }
  const row = data?.user || { balance: 0n, incomeRate: 0n, outgoingRate: 0n, updated: clock };
  const balance = streamBalance(row, clock);
  let allowance = null;
  try {
    allowance = parseUnits(budgetValue, 6);
    if (allowance < 0n) allowance = null;
  } catch {}
  const accountReady = !!account && !!signer && !!data?.user && readStatus === "loaded";
  const ready = accountReady && !pending;
  const readableBalance = account && data?.user ? balance : null;
  const openFunding = () => {
    setActivityOpen(false);
    open("funding");
  };
  const openWithdraw = () => {
    setActivityOpen(false);
    open("withdraw");
  };
  const openFromActivity = (tx) => {
    if (isInFlight(tx) && isFundingTx(tx)) openFunding();
    else if (isInFlight(tx) && isWithdrawTx(tx)) openWithdraw();
    else {
      setModal(null);
      setActivityOpen(true);
    }
  };
  const ride = session[config?.scooter?.toLowerCase()];
  const rideSeconds =
    activeScooter && ride && clock > BigInt(ride.start) ? clock - BigInt(ride.start) : 0n;
  const activity = useActivity(config, account, txs, keeperEvents, activityOpen);
  const totalRate = subscriptions.reduce((total, [, s]) => total + s.outgoing, 0n);
  const switchTab = (id) => {
    setTab(id);
    writeStored(browserStorage(), "papaya:ui-tab", id);
    // Controls has no How it works view — drop back to demo there only.
    if (id === "controls" && mode === "code") {
      setMode("demo");
      writeStored(browserStorage(), "papaya:ui-mode", "demo");
    }
  };
  const switchMode = (next) => {
    setMode(next);
    writeStored(browserStorage(), "papaya:ui-mode", next);
  };
  function open(name) {
    setError("");
    if (name === "budget") setBudgetValue(amount(data?.allowance || 0n, 6));
    setModal(name);
  }
  const begin = (to, r, label, context) =>
    run(
      label,
      (p) => p.subscribe(to, r, config.projectId),
      async (receipt) => {
        const block = await runtime.rpc.getBlock(receipt.blockNumber);
        saveSession({
          ...session,
          [to.toLowerCase()]: { start: block.timestamp, rate: r.toString() },
        });
      },
      context,
    );
  const stop = (to, label, context) =>
    run(
      label,
      (p) => p.unsubscribe(to),
      () => {
        const next = { ...session };
        delete next[to.toLowerCase()];
        saveSession(next);
      },
      context,
    );
  async function startRide() {
    if (rideLock.current || !ready) return;
    rideLock.current = true;
    setRideChecking(true);
    setError("");
    try {
      const current = await runtime.rpc.account(account);
      const plan = subscriptionPlan(current, config.scooter, SCOOTER_RATE, 1, account);
      if (plan.balance >= plan.reserve && current.allowance >= plan.refill) {
        await begin(config.scooter, SCOOTER_RATE, "Start ride", {
          flowId: crypto.randomUUID(),
          step: "stream-subscribe",
        });
      } else open("scooter-start");
    } catch (e) {
      setError(e.message);
    } finally {
      rideLock.current = false;
      setRideChecking(false);
    }
  }
  function customSubscribe(to, r) {
    try {
      subscriptionPlan(data, to, r, 1, account);
      open({ type: "subscribe", to, rate: r });
    } catch (e) {
      setError(e.message);
    }
  }
  const subscriptionModal =
    modal === "creator-start"
      ? { to: config?.creator, rate, kind: "creator" }
      : modal === "scooter-start"
        ? { to: config?.scooter, rate: SCOOTER_RATE, kind: "scooter" }
        : modal?.type === "subscribe"
          ? { ...modal, kind: "custom" }
          : null;
  const connectedAction = !account ? (
    <button className="primary" disabled={!configured} onClick={connect}>
      Connect wallet
    </button>
  ) : null;
  const stopModal = modal?.type === "stop" ? modal : null;
  const stopTarget = stopModal
    ? stopModal.to
    : modal === "creator-stop"
      ? config?.creator
      : modal === "scooter-stop"
        ? config?.scooter
        : null;
  const stopAddr = stopTarget?.toLowerCase?.() || "";
  const stopSub = stopAddr ? data?.subscriptions?.[stopAddr] : null;
  const stopName =
    stopAddr === config?.creator?.toLowerCase()
      ? "Creator"
      : stopAddr === config?.scooter?.toLowerCase()
        ? "Pay as you go"
        : stopTarget
          ? short(stopTarget)
          : "";
  const stopRate = stopSub
    ? stopAddr === config?.scooter?.toLowerCase()
      ? `${amount(stopSub.outgoing * 60n)} USDC / min`
      : `${amount(stopSub.outgoing * MONTH)} USDC / 30 days`
    : "—";
  const isStopModal =
    modal === "creator-stop" || modal === "scooter-stop" || stopModal?.type === "stop";
  const reviewDetails =
    modal === "budget"
      ? [
          ["New limit", `${amount(allowance ?? 0n, 6)} USDC`],
          ["Current limit", `${amount(data?.allowance || 0n, 6)} USDC`],
        ]
      : modal === "revoke"
        ? [
            ["Current allowance", `${amount(data?.allowance || 0n, 6)} USDC`],
            ["New limit", "0 USDC"],
          ]
        : isStopModal
          ? [
              ["Subscription", stopName],
              ["Recipient", short(stopTarget)],
              ["Rate", stopRate],
            ]
          : [];
  const reviewTitle =
    modal === "budget"
      ? "Change refill budget"
      : modal === "revoke"
        ? "Revoke allowance"
        : modal === "creator-stop" || (stopModal && stopAddr === config?.creator?.toLowerCase())
          ? "Stop subscription"
          : modal === "scooter-stop" || (stopModal && stopAddr === config?.scooter?.toLowerCase())
            ? "Stop ride"
            : isStopModal
              ? "Stop stream"
              : "";
  const reviewSuccessTitle =
    modal === "budget"
      ? "Budget updated."
      : modal === "revoke"
        ? "Allowance revoked."
        : modal === "creator-stop" || (stopModal && stopAddr === config?.creator?.toLowerCase())
          ? "Canceled."
          : modal === "scooter-stop" || (stopModal && stopAddr === config?.scooter?.toLowerCase())
            ? "Ride stopped."
            : isStopModal
              ? "Canceled."
              : "Done.";
  const reviewSuccessMessage =
    modal === "budget"
      ? "Refill cap updated."
      : modal === "revoke"
        ? "Spending permission set to 0."
        : isStopModal
          ? stopName
            ? `Unsubscribed from ${stopName}.`
            : "Unsubscribed."
          : "Confirmed.";
  return (
    <main data-read-status={readStatus}>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="https://papaya.finance" aria-label="Papaya">
            <Logo height={19} />
          </a>
          <nav className="header-actions" aria-label="Account and resources">
            <div className="resource-links">
              <ExternalLink
                href={import.meta.env.VITE_PAPAYA_DOCS_URL || "https://docs.papaya.finance"}
              >
                Docs
              </ExternalLink>
              <ExternalLink href={import.meta.env.VITE_GITHUB_URL}>GitHub</ExternalLink>
            </div>
            {account && (
              <button
                className="icon-button activity-trigger"
                aria-label={`Activity${activity.unread ? `, ${activity.unread} unread` : ""}`}
                onClick={() => setActivityOpen(true)}
              >
                <Bell size={18} />
                {activity.unread > 0 && (
                  <span className="unread-badge">
                    {activity.unread > 99 ? "99+" : activity.unread}
                  </span>
                )}
              </button>
            )}
            {account ? (
              <div className="wallet-control">
                <button
                  type="button"
                  className="wallet-chip-btn wallet-avatar-btn"
                  aria-label="Your wallet"
                  title={name || account}
                  onClick={() => open("wallet")}
                >
                  <AddressAvatar address={account} size={28} />
                  <span className="wallet-chip-addr">{name || short(account)}</span>
                </button>
                <button
                  type="button"
                  className="wallet-chip-btn"
                  aria-label="Disconnect wallet"
                  title="Disconnect"
                  onClick={() => runtime.disconnect()}
                >
                  <LogOut size={15} />
                </button>
              </div>
            ) : (
              <button className="primary header-cta" disabled={!configured} onClick={connect}>
                Connect wallet
              </button>
            )}
          </nav>
        </div>
      </header>
      <div className="page-container">
        <section className="hero" aria-labelledby="hero-heading">
          <h1 id="hero-heading">
            <span className="hero-primary">Recurring and usage-based</span>
            <br />
            <span className="hero-secondary">payments on Arc</span>
          </h1>
        </section>
        {!configured && (
          <p className="inline-warning">Waiting for a verified deployment configuration.</p>
        )}
        {local && (
          <p className="fixture-note">Local testing · simulated transactions, no mainnet writes</p>
        )}
        <section
          className={`account-dock ${expanded ? "expanded" : ""}`}
          aria-label="Papaya account"
        >
          <div className="dock-details">
            <div>
              {anyActive ? (
                subscriptions.map(([address, s]) => {
                  const isCreator = address === config.creator.toLowerCase();
                  const isScooter = address === config.scooter.toLowerCase();
                  const StreamIcon = isCreator ? Heart : isScooter ? Bike : Radio;
                  return (
                    <button
                      className="stream-chip"
                      key={address}
                      onClick={() =>
                        switchTab(isCreator ? "creator" : isScooter ? "scooter" : "controls")
                      }
                    >
                      <StreamIcon size={17} />
                      <span className="stream-chip-name">
                        {isCreator ? "Creator" : isScooter ? "Scooter" : short(address)}
                      </span>
                      <span className="stream-chip-rate">· {amount(s.outgoing * 60n)} / min</span>
                    </button>
                  );
                })
              ) : (
                <span className="dock-empty">No subscriptions yet</span>
              )}
            </div>
          </div>
          <div className="dock-main">
            <button
              type="button"
              className="dock-face"
              onClick={() => (account ? open("wallet") : connect())}
              disabled={!account && !configured}
              aria-label="Your wallet"
              title={account || "Connect wallet"}
            >
              <AddressAvatar address={account || "papaya"} size={40} />
              <span className="dock-face-addr">{account ? name || short(account) : "Connect"}</span>
            </button>
            <button
              type="button"
              className="dock-balance"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse account details" : "Expand account details"}
              aria-expanded={expanded}
              title="Papaya balance"
            >
              <span className="dock-assets" aria-hidden>
                <img
                  className="dock-token-icon"
                  src={`${import.meta.env.BASE_URL}arc-logo.svg`}
                  alt=""
                />
                <img
                  className="dock-token-icon"
                  src={`${import.meta.env.BASE_URL}usdc.svg`}
                  alt=""
                />
              </span>
              <strong className="dock-amount">
                <Money value={readableBalance} />
              </strong>
            </button>
          </div>
        </section>
        {runtime.walletStatus === "wrong_chain" && (
          <div className="read-banner">
            <Info size={16} />
            Switch your wallet to Arc to continue.<button onClick={connect}>Switch network</button>
          </div>
        )}
        <div className="workspace" id="demo">
          <div className="workspace-toolbar">
            <div className="main-tabs" role="tablist" aria-label="Demo scenarios">
              {[
                ["creator", "Creator", Heart],
                ["scooter", "Pay as you go", Bike],
                ["controls", "Papaya controls", SlidersHorizontal],
              ].map(([id, label, Icon]) => (
                <button
                  key={id}
                  id={`tab-${id}`}
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls="scenario-panel"
                  onClick={() => switchTab(id)}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            {tab !== "controls" && (
              <div className="view-toggle" role="group" aria-label="Scenario view">
                <button aria-pressed={mode === "demo"} onClick={() => switchMode("demo")}>
                  <Eye size={17} />
                  <span>Demo</span>
                </button>
                <button aria-pressed={mode === "code"} onClick={() => switchMode("code")}>
                  <Terminal size={17} />
                  <span>How it works</span>
                </button>
              </div>
            )}
          </div>
          <section
            id="scenario-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="scenario-panel"
            key={`${tab}-${mode}`}
          >
            {tab !== "controls" && mode === "code" ? (
              <CodePanel
                scenario={tab}
                config={config}
                rate={tab === "creator" ? rate : SCOOTER_RATE}
                account={account}
                feeBps={tab === "creator" ? data?.creatorFee : data?.scooterFee}
              />
            ) : tab === "creator" ? (
              <CreatorScene
                config={config}
                account={account}
                activeCreator={activeCreator}
                rate={rate}
                setRate={setRate}
                ready={ready}
                open={open}
                connectedAction={connectedAction}
              />
            ) : tab === "scooter" ? (
              <ScooterScene
                config={config}
                account={account}
                activeScooter={activeScooter}
                ready={ready}
                open={open}
                connectedAction={connectedAction}
                ride={ride}
                rideSeconds={rideSeconds}
                rideChecking={rideChecking}
                startRide={startRide}
              />
            ) : (
              <ControlsPanel
                config={config}
                runtime={runtime}
                readableBalance={readableBalance}
                accountReady={accountReady}
                ready={ready}
                onFund={openFunding}
                onWithdraw={openWithdraw}
                onBudget={() => open("budget")}
                onRevoke={() => open("revoke")}
                onSubscribe={customSubscribe}
                onStop={(to) => open({ type: "stop", to })}
              />
            )}
          </section>
        </div>
      </div>
      {error && !modal && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {subscriptionModal && account && (
        <SubscriptionWizard
          key={`${account}:${subscriptionModal.kind}:${subscriptionModal.to}`}
          {...subscriptionModal}
          config={config}
          runtime={runtime}
          run={run}
          begin={begin}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "funding" && account && (
        <FundingWizard
          key={account}
          config={config}
          runtime={runtime}
          run={run}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "withdraw" && account && (
        <WithdrawWizard
          key={account}
          config={config}
          runtime={runtime}
          run={run}
          balance={balance}
          onClose={() => setModal(null)}
        />
      )}
      {modal &&
        !subscriptionModal &&
        modal !== "funding" &&
        modal !== "withdraw" &&
        modal !== "wallet" && (
          <ReviewDialog
            key={typeof modal === "string" ? modal : modal.to}
            title={reviewTitle}
            details={reviewDetails}
            successTitle={reviewSuccessTitle}
            successMessage={reviewSuccessMessage}
            runtime={runtime}
            valid={modal !== "budget" || allowance !== null}
            onClose={() => setModal(null)}
            submit={(context) =>
              modal === "budget"
                ? run(
                    "Change refill budget",
                    (_, t) => t.approve(config.papaya, allowance),
                    null,
                    context,
                  )
                : modal === "revoke"
                  ? run("Revoke allowance", (_, t) => t.approve(config.papaya, 0), null, context)
                  : stop(
                      stopTarget ||
                        (typeof modal === "object"
                          ? modal.to
                          : modal === "creator-stop"
                            ? config.creator
                            : config.scooter),
                      reviewTitle,
                      context,
                    )
            }
          >
            {modal === "budget" && (
              <label className="allowance-field">
                Allowance · USDC
                <input
                  aria-label="Allowance amount"
                  inputMode="decimal"
                  value={budgetValue}
                  onChange={(e) => {
                    if (/^(?:\d*(?:\.\d*)?)$/.test(e.target.value)) setBudgetValue(e.target.value);
                  }}
                />
              </label>
            )}
          </ReviewDialog>
        )}
      {modal === "wallet" && account && (
        <Modal className="wallet-modal" title="Your wallet" onClose={() => setModal(null)}>
          <WalletPanel
            account={account}
            name={name}
            walletBalance={data?.external ?? null}
            papayaBalance={readableBalance}
            assetBase={import.meta.env.BASE_URL}
            ready={ready}
            canAdd={accountReady}
            canWithdraw={accountReady}
            onAdd={openFunding}
            onWithdraw={openWithdraw}
            onDisconnect={() => {
              runtime.disconnect();
              setModal(null);
            }}
          />
        </Modal>
      )}
      {activityOpen && (
        <ActivityDrawer
          rows={activity.rows}
          config={config}
          onClose={() => setActivityOpen(false)}
          onSelectFunding={openFunding}
          onSelectWithdraw={openWithdraw}
        />
      )}
      <TransactionToast
        overlayKey={`${!!modal}:${activityOpen}`}
        txs={txs}
        account={account}
        onSelect={openFromActivity}
      />
    </main>
  );
}
