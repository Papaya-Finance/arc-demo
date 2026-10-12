import { useCopyFeedback } from "./use-ui-lifecycle.jsx";
import React from "react";
import { AddressAvatar } from "./AddressAvatar.jsx";
import { Check, LogOut, Minus, Plus } from "./icons.mjs";
import { amount, short } from "./primitives.jsx";

export function WalletPanel({
  account,
  name,
  walletBalance,
  papayaBalance,
  assetBase,
  ready,
  canAdd,
  canWithdraw,
  onAdd,
  onWithdraw,
  onDisconnect,
}) {
  const { copied, copy } = useCopyFeedback();

  return (
    <div className="wallet-panel">
      <div className="wallet-section wallet-balance-card">
        <span className="wallet-section-label">Wallet Balance</span>
        <span className="wallet-section-value">
          {walletBalance == null ? "—" : amount(walletBalance, 6)}
        </span>
      </div>

      <div className="wallet-papaya-row">
        <div className="wallet-section wallet-balance-card">
          <span className="wallet-section-label">Papaya Balance</span>
          <span className="wallet-section-value">
            {papayaBalance == null ? "—" : amount(papayaBalance)}
          </span>
        </div>
        <div className="wallet-papaya-actions">
          <button
            type="button"
            className="controls-icon-btn wallet-icon-btn"
            disabled={!(canAdd ?? ready)}
            onClick={onAdd}
            aria-label="Add funds"
            title="Add funds"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="controls-icon-btn wallet-icon-btn"
            disabled={!(canWithdraw ?? ready)}
            onClick={onWithdraw}
            aria-label="Withdraw"
            title="Withdraw"
          >
            <Minus size={16} />
          </button>
        </div>
      </div>

      <div className="wallet-network-row" role="group" aria-label="Network and token">
        <div className="wallet-section wallet-network-tile wallet-network-arc" title="Network: Arc">
          <img
            className="wallet-network-icon"
            src={`${assetBase}arc-logo.svg`}
            alt="Arc"
            width={32}
            height={32}
          />
        </div>
        <div className="wallet-section wallet-network-tile wallet-network-usdc" title="Token: USDC">
          <img
            className="wallet-network-icon"
            src={`${assetBase}usdc.svg`}
            alt="USDC"
            width={32}
            height={32}
          />
        </div>
      </div>

      <div className="wallet-footer">
        <button
          type="button"
          className={`wallet-identity${name ? "" : " wallet-identity-solo"}`}
          onClick={() => copy(account)}
          aria-label={copied ? "Address copied" : "Copy wallet address"}
          title={copied ? "Copied" : "Copy address"}
        >
          <AddressAvatar address={account} size={40} />
          <span className="wallet-identity-text">
            {name ? (
              <>
                <span className="wallet-ens">{name}</span>
                <span className="wallet-addr">{copied ? "Copied" : short(account)}</span>
              </>
            ) : (
              <span className="wallet-addr">{copied ? "Copied" : short(account)}</span>
            )}
          </span>
          {copied && <Check className="wallet-copy-check" size={16} aria-hidden />}
        </button>
        <button type="button" className="primary wallet-disconnect" onClick={onDisconnect}>
          <LogOut size={16} /> Disconnect
        </button>
      </div>
    </div>
  );
}
