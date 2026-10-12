import React from "react";
import { Heart, Bike, Radio, Square } from "./icons.mjs";
import { AddressAvatar } from "./AddressAvatar.jsx";
import { SectionLabel } from "./SectionLabel.jsx";
import { RateSelect } from "./RateSelect.jsx";
import { Logo } from "./Logo.jsx";
import { amount, Money } from "./primitives.jsx";
import { RATES, MONTH, DAY, SCOOTER_RATE } from "../../../scripts/math.mjs";

export function CreatorScene({
  config,
  account,
  activeCreator,
  rate,
  setRate,
  ready,
  open,
  connectedAction,
}) {
  return (
    <article className="scenario creator-scenario">
      <div className="scenario-content">
        <SectionLabel path={["Demo", "Subscriptions"]} />
        <h2 className="demo-section-lede">Stream recurring USDC payments.</h2>
        <div className="creator-profile">
          <AddressAvatar address={config?.creator} size={40} className="creator-avatar" />
          <div>
            <strong>Papaya creator</strong>
          </div>
          <span className={`status-pill ${activeCreator ? "active" : ""}`}>
            {activeCreator ? (
              <>
                <span className="live-dot" /> Streaming
              </>
            ) : (
              "Not subscribed"
            )}
          </span>
        </div>
        <RateSelect
          label="Monthly rate"
          aria-label="Monthly rate"
          value={rate.toString()}
          onChange={(v) => setRate(BigInt(v))}
          options={RATES.map((r) => ({
            value: r.toString(),
            label: `${amount(r * MONTH)} USDC / 30 days`,
          }))}
        />
        <div className="rate-summary">
          <span>
            <b>{amount(rate * DAY)}</b> USDC / day
          </span>
        </div>
        {activeCreator && (
          <div className="active-summary">
            <Radio size={16} /> Now streaming {amount(activeCreator.outgoing * MONTH)} USDC / 30
            days
          </div>
        )}
        <div className="scenario-actions">
          {account ? (
            <>
              <button
                className="primary"
                disabled={
                  !ready ||
                  account.toLowerCase() === config?.creator?.toLowerCase() ||
                  activeCreator?.outgoing === rate
                }
                onClick={() => open("creator-start")}
              >
                {activeCreator ? "Update rate" : "Start subscription"}
              </button>
              {activeCreator && (
                <button
                  className="secondary"
                  disabled={!ready}
                  onClick={() => open("creator-stop")}
                >
                  <Square size={13} /> Stop subscription
                </button>
              )}
            </>
          ) : (
            connectedAction
          )}
        </div>
      </div>
      <div className="scenario-visual creator-visual" aria-hidden="true">
        <div className="visual-caption">
          A SMALL STREAM.
          <br />A LASTING CONNECTION.
        </div>
        <div className="visual-hero-icon" aria-hidden="true">
          <Heart size={40} />
        </div>
        <div className="payment-card">
          <span className="payment-icon">
            <Heart size={21} />
          </span>
          <div>
            <small>Support that keeps flowing</small>
            <strong>
              {amount(rate * 60n)} <span>USDC / min</span>
            </strong>
          </div>
        </div>
        <div className="visual-footer">
          <span>You</span>
          <span className="stream-track">
            <span className="stream-track-rail" aria-hidden="true">
              <i className="stream-pulse" />
            </span>
            <Logo height={15} className="stream-track-mark" />
          </span>
          <span>Creator</span>
        </div>
      </div>
    </article>
  );
}

export function ScooterScene({
  config,
  account,
  activeScooter,
  ready,
  open,
  connectedAction,
  ride,
  rideSeconds,
  rideChecking,
  startRide,
}) {
  return (
    <article className="scenario scooter-scenario">
      <div className="scenario-content">
        <SectionLabel path={["Demo", "Pay as you go"]} />
        <h2 className="demo-section-lede">Pay for services as you use them.</h2>
        <div className="scooter-heading">
          <span className={`status-pill ${activeScooter ? "active" : ""}`}>
            {activeScooter ? (
              <>
                <span className="live-dot" /> Ride in progress
              </>
            ) : (
              "Ready to ride"
            )}
          </span>
          <span className="caption">Electric scooter</span>
        </div>
        <div className="ride-rate">
          <strong>{amount(SCOOTER_RATE * 60n)}</strong>
          <span>USDC / minute</span>
        </div>
        <div className="ride-meters">
          <div>
            <small>Ride time</small>
            <strong>
              {activeScooter && !ride ? "—" : `${rideSeconds / 60n}m ${rideSeconds % 60n}s`}
            </strong>
          </div>
          <div>
            <small>Streamed</small>
            <strong>
              <Money
                value={
                  activeScooter && !ride
                    ? null
                    : rideSeconds * (activeScooter?.outgoing || SCOOTER_RATE)
                }
                precision={10}
              />
            </strong>
          </div>
        </div>
        <div className="scenario-actions">
          {account ? (
            activeScooter ? (
              <button
                className="secondary"
                disabled={!ready || rideChecking}
                onClick={() => open("scooter-stop")}
              >
                <Square size={13} /> Stop ride
              </button>
            ) : (
              <button
                className="primary"
                disabled={
                  !ready || rideChecking || account.toLowerCase() === config?.scooter?.toLowerCase()
                }
                onClick={startRide}
              >
                Start ride
              </button>
            )
          ) : (
            connectedAction
          )}
        </div>
      </div>
      <div className="scenario-visual scooter-visual" aria-hidden="true">
        <div className="visual-caption">
          YOUR PACE.
          <br />
          YOUR PAYMENT.
        </div>
        <div className="visual-hero-icon" aria-hidden="true">
          <Bike size={40} />
        </div>
        <div className="ride-ticket">
          <Bike size={19} />
          <span>Every second counts.</span>
          <span className="live-dot" />
        </div>
        <div className="visual-footer">
          <span>Start</span>
          <span className="stream-track">
            <span className="stream-track-rail" aria-hidden="true">
              <i className="stream-pulse" />
            </span>
            <span className="stream-track-label">Ride</span>
          </span>
          <span>Stop</span>
        </div>
      </div>
    </article>
  );
}
