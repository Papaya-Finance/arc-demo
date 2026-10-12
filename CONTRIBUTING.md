# Contributing

Use Node 22, npm and Python 3. Start with `npm ci` and `npm run dev:fixture`; the fixture requires no credentials and cannot send mainnet transactions. See the README for LIVE configuration and optional contract tooling.

Before submitting, run `npm run format`, `npm run check`, `npm run check:publication`, `npm test`, `npm run build` and `npm run build:keeper`. For contract changes also run `npm run build:contracts` and `npm run test:contracts` after installing the pinned tools.

Preserve UI copy/layout unless the change explicitly concerns design. Reuse `BalanceWizard`, `SubscriptionWizard`, shared flow views and `flowProgress`. Wallet writes belong to `WalletSession`/`Transactions`: persist returned hashes, reconcile receipts, and never automatically resend an uncertain transaction. Keep wallet/chain/contract scopes separate and retain last successful reads on RPC failure.

Effects must release every listener, timer, animation frame and observer they acquire. AppKit is shared per configuration; a runtime owns its subscriptions. Do not suppress listener warnings with higher emitter limits. Use the shared UI lifecycle hooks. Keep amount arithmetic in `bigint` and distinguish 6-decimal token units from 18-decimal internal units.

Do not commit local env, keystores, password files, real project IDs, authenticated RPC URLs, generated outputs or local state. `check:publication` rejects internal file categories and common credential patterns; it is not an exhaustive security audit. All `VITE_*` values are visible in browsers. Never introduce a deploy or production signer into contribution checks.

Retain the BUSL-1.1 license and upstream notices.
