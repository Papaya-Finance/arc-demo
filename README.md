# Papaya on Arc

Recurring and usage-based USDC payments on Arc, powered by a deployed Papaya contract.

**[Live demo](https://papaya.finance/arc-demo/)** · **[Verified contract](https://explorer.arc.io/address/0xd7AbBB80894f35c139570d2DdDB90F99D4Fc92C7)** · **[Papaya documentation](https://docs.papaya.finance)**

## Demo scenarios

- **Creator:** choose a monthly rate and allowance period, review the recipient, and start a recurring stream. If funding is needed, the deposit must confirm before the subscription is submitted.
- **Pay as you go:** start a scooter ride with one button when balance and allowance suffice; otherwise the shared setup flow prepares the account. Stop the ride to stop the stream. Wallet confirmation is still required.
- **Controls:** deposit, withdraw, change/revoke allowance, create a stream to another address, and inspect outgoing/incoming subscriptions and transaction history.

An allowance period sets a spending budget, not a subscription end date. Deposit consumes allowance. Automatic refills require wallet USDC, remaining allowance and an operating keeper. Closing the page does not stop an onchain subscription. Gas costs are separate from the small demonstration rates.

## Quick start

Use **Node 22**, npm and Python 3 (for keeper lock tests).

```sh
git clone --recurse-submodules https://github.com/Papaya-Finance/arc-demo.git
cd arc-demo
npm ci
npm run dev:fixture
```

Open `http://127.0.0.1:5176/arc-demo/`. This isolated UI fixture simulates the wallet and RPC without credentials or upstream requests. It includes account/network switching, rejected signatures and temporary RPC failures. Use `FRONTEND_FIXTURE_ZERO=true npm run dev:fixture` to start with zero Papaya balance and allowance.

For the existing LIVE deployment:

```sh
cp .env.example .env.local
# Set your VITE_REOWN_PROJECT_ID in .env.local.
npm run dev:live
```

Open `http://127.0.0.1:5174/arc-demo/`. This uses Arc Mainnet, chain ID **5042**. Wallet confirmations here send real transactions. No contract deployment is needed.

## Configuration

`.env.example` contains only blank placeholders and public defaults. Keep actual settings in ignored `.env.local`.

- `VITE_REOWN_PROJECT_ID`: required for the LIVE Reown/WalletConnect picker. Allow your local origin in your Reown project. Injected wallets such as MetaMask and Rabby are supported.
- `VITE_ARC_RPC_URL`: browser read RPC, including a provider endpoint of your choice.
- `VITE_ARC_RPC_FALLBACK_URL`: fallback read RPC; explicitly empty disables fallback.
- `VITE_PAPAYA_DOCS_URL`, `VITE_GITHUB_URL`: header links.
- `VITE_ENS_RPC_URL`: optional Ethereum RPC for name resolution.

All `VITE_*` values are **browser-visible**. A static frontend cannot hide an RPC credential. Configure provider-side origin restrictions and quotas; never commit real credentials. See [SECURITY.md](SECURITY.md).

## Structure and lifecycle

- `web/src/App.jsx`: application state and scenario routing.
- `web/src/ui/`: shared funding/withdrawal forms, subscription steps and scenario views.
- `web/src/runtime/`: wallet session, read RPC pool, transaction journal and flow planning.
- `liquidator/`: keeper, persistent receipt recovery and atomic checkpoints.
- `src/`, `test/`, `script/`: deployed contract source, Solidity tests and deployment script.
- `deployments/mainnet.json`: public deployment metadata; `wallets.json` contains public role addresses only.

Read failures preserve the last successful state. Optional event history cannot erase account balances. Submitted transaction hashes are persisted before receipt polling; transient RPC failures reconcile after recovery or reload. Shared flows wait for confirmed receipts before dependent writes. AppKit instances are reused and runtime-owned listeners are released on teardown.

USDC allowances/deposits use 6 decimals; Papaya balances/withdrawals and per-second rates use 18. Financial arithmetic uses `bigint`.

## Tests and builds

```sh
npm run format:check
npm run check
npm run check:publication
npm test
npm run build
npm run build:keeper

# Pinned Arc Foundry tools and public forge-std dependency:
npm run setup:tools
npm run build:contracts
npm run test:contracts
```

`npm test` runs frontend lifecycle, RPC/receipt recovery, flow planning, keeper state/locking and deployment metadata tests. Contract tests cover unit scenarios, fuzzing and invariants using local EVM state. These commands do not deploy or send mainnet transactions. The optional `npm run test:fork` requires archive RPC access and only executes against a local fork.

Frontend output is `web/dist/`; the keeper ESM bundle is `dist/liquidator.mjs` and uses installed runtime dependencies. Generated outputs are ignored. GitHub Actions runs validation and builds only; it has no production deployment job or signing credentials.

## Keeper

```sh
npm run liquidator:live:dry
```

This scans and simulates against the existing deployment without signing, with a local process lock and isolated state. `ARC_RPC_URL`, `RUN_ONCE` and `MAX_GAS_COST_USDC` configure it. The gas cap is a per-transaction guard, not a total spending budget.

The optional `npm run liquidator:live` broadcasts real transactions and requires `KEYSTORE_FILE` plus `KEYSTORE_PASSWORD_FILE` outside the repository. The password file must have restrictive permissions; the signer must match the configured keeper address. Never run a second keeper against the same production account/state. Contract source publication does not require running a keeper.

## License and scope

Contract source derives from Papaya `Subscriptions-Protocol-Dev` commit `f57b4f569db69324deace31dd19cf900d673194e`. The original [BUSL-1.1 license](LICENSE) and notices are retained; public availability does not change that license. Dependencies retain their respective licenses.

This is an experimental, keeper-dependent demo, not an independently audited financial product. Delayed liquidation can affect solvency. This repository contains a standalone public source snapshot; private operational tooling and deployment history are intentionally excluded.
