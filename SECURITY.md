# Security Policy

Gero Wallet is a **non-custodial** browser extension that manages real cryptocurrency and private keys. We take security seriously and appreciate the work of security researchers in keeping users safe.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue, pull request, or discussion for a security vulnerability.** Public disclosure before a fix puts users' funds at risk.

Report privately through GitHub's built-in security advisories:

- **[Report a vulnerability](https://github.com/Gero-Labs/gerowallet/security/advisories/new)** — this opens a private advisory visible only to you and the maintainers.

Please include:

- A clear description of the issue and its impact.
- Step-by-step reproduction (proof-of-concept, affected version, network, browser).
- Any relevant logs, transactions, or screenshots — **with private keys, mnemonics, and passwords redacted**.
- Your assessment of severity and, if you have one, a suggested fix.

The private advisory thread is end-to-end between you and the maintainers; you can share sensitive reproduction details there safely.

## Our Commitment

- **Acknowledgement** within **3 business days**.
- An initial assessment and severity rating within **10 business days**.
- Regular updates until the issue is resolved.
- **Coordinated disclosure:** we ask that you keep the report private until a fix is released. Our target is a fix within **90 days**; we will agree on a public disclosure date with you and credit you (if you wish) once users are protected.

## Scope

**In scope** — this repository (the Gero Wallet browser extension):

- Private-key handling, encryption, and storage.
- Transaction construction, signing, and the DApp connector (CIP-30 / `window.cardano`).
- Cross-context messaging (background ↔ content ↔ inject ↔ UI) and privilege boundaries.
- Authentication flows (spending password, PassKey/WebAuthn PRF, hardware wallet integration).
- Supply-chain / build-integrity issues in this repo's dependencies and tooling.

**Out of scope:**

- Gero's backend services / infrastructure (report those to the same address, but they are not in this repo).
- Third-party integrations and their providers (fiat on-ramps, hardware wallet vendors, etc.).
- Social engineering, phishing sites impersonating Gero, or physical attacks.
- Findings that require a compromised OS, a malicious browser extension already installed, or physical access to an unlocked device.
- Automated scanner output without a demonstrated, wallet-specific impact.
- Denial of service against public endpoints, spam, or best-practice suggestions with no exploitable impact.

## Testing Guidelines

- **Use the Preprod / Preview testnets.** Never test against mainnet with funds that are not yours.
- Only ever test with accounts and funds you control.
- Do not access, modify, or exfiltrate other users' data.
- Do not run attacks that degrade service for other users.

## Safe Harbor

We consider security research conducted in good faith and in accordance with this policy to be authorized. We will not pursue or support legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption;
- Only interact with accounts they own or have explicit permission to test;
- Report promptly and give us reasonable time to remediate before any public disclosure.

If in doubt about whether an action is authorized, ask us first by opening a [private security advisory](https://github.com/Gero-Labs/gerowallet/security/advisories/new).

## Supported Versions

Security fixes are provided for the latest released version. Please reproduce issues on the current release before reporting.

| Version | Supported |
|---------|-----------|
| 2.7.x   | ✅        |
| < 2.7   | ❌        |

## Security Model (at a glance)

- **Non-custodial:** users hold their own keys; Gero never has custody of funds.
- **Key encryption:** private keys are encrypted at rest with ChaCha20-Poly1305 (AEAD), keys derived via PBKDF2.
- **Context isolation:** private keys and signing are confined to the background service worker and never exposed to page or UI contexts.
- **Hardware & PassKey support:** Ledger, Trezor, Keystone, and hardware-backed WebAuthn PRF passkeys.

## Recognition

With your permission, we're happy to publicly credit researchers who responsibly disclose valid vulnerabilities. If we run a bug bounty at the time of your report, we'll share the scope and reward details with you directly.

---

_Thank you for helping keep Gero Wallet users safe._
