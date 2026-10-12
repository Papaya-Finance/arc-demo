# Security

Never include private keys, seed phrases, password files, real project credentials or authenticated RPC URLs in issues, screenshots or pull requests. Report a suspected exploitable issue privately to **info@papaya.finance** before publishing details. This repository is a demo and has not received an independent production security audit.

The frontend does not hold a server-side signer. Browser wallet confirmations authorize user transactions. Keeper signing uses an encrypted keystore and a separate password file outside this repository. Browser RPC configuration is public to visitors.

Run `npm audit --omit=dev` when changing runtime dependencies. Automated audits and repository scans do not prove the absence of vulnerabilities. Preserve transaction receipt recovery, wallet-scope checks, bounded retries and failure-reporting deployment gates.
