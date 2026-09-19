# Transactions, signing and security invariants

This is a wallet. A defect here loses user funds. Read this before touching anything under `src/chrome/`, `src/shared/utils/{crypto,builder,resolver,ledger,keystone}.ts`, or any signing composable.

## Where transactions are actually built

**Most Cardano flows build server-side.** Send (side panel and dashboard), withdrawal, unstake, DRep delegation, collateral and card orders all POST to Nexus (`nexusTxApi.build*` -> `/api/tx/*`) and only deserialize the returned CBOR.

The local `@cardano-sdk` builder in `src/shared/utils/builder.ts` is the **minority** path: pool registration/retirement, voting, the agent StakingCard, Trezor, and the pre-Nexus fallback branches.

So changing coin selection or the fee margin in `builder.ts` and then testing a Send does nothing. **Check the caller first.**

Fee computation on the local path is `BrowserTxConstruction.minFee()` in `src/chrome/cardanoJsSdkCbor.ts`: it inserts N unique dummy vkey/signature pairs (N from `analyzeTransactionForSignatures()`), lets the SDK size the real CBOR, then adds a flat `80 * minFeeCoefficient` safety margin. CLAUDE.md's "witnessCount x 110 bytes" formula does not exist in the code.

Two local-builder invariants:

- Certificate-only, withdrawal-only and vote-only transactions are **forced to emit a change output** (min 1 ADA); without it the resolver returns `[]` and serialization throws on empty outputs.
- `votingProcedures` must be assigned at **two textually identical sites** in `builder.ts` (the coin-selection `buildTx` and the final txBody). Setting only one makes votes silently vanish with no error.

## Signing dispatch

`useTransactionSigning.handleSign()` branches on `WalletType`:

| Type | Where signing happens |
|---|---|
| Normal, Google | **Background** service worker (`MessageTypes.SIGN_TX` -> `walletBg.signTx`) |
| Trezor | Background by default; document context when `isTrezorWebUsbEnabled` |
| Ledger, Keystone | **Document (UI) context** - never through the background |
| Watch | No branch. Silently no-ops |

Software signing decrypts the root key in the background, derives `CIP1852/1815'/account'` then per-signer sub-paths, signs the tx id, and returns **only the witness-set CBOR**. The key never leaves.

**Two documented exceptions to "private keys never leave the background", which ARCHITECTURE.md states as an absolute:**

- **PRF / passkey wallets**: WebAuthn PRF needs a document, which a service worker does not have, so the root key is decrypted in the UI context and sent to the background as a plain `number[]` in the SIGN_TX payload.
- **Ledger and Keystone** sign entirely in document context.

MPC (Sign-in-with-Google) wallets do **not** put key bytes on the wire - the reconstructed root key lives in a background-only session cache.

## Refusals are duplicated on purpose

`refusalForProgrammableInputs()` (the CIP-113 preflight) is wired at **four** request entry points - CIP-30 `signTx`, the cross-device relay, the Trezor background handler, and WalletConnect `cardano_signTx` - and `WalletBg.signTx` re-checks a **fifth** time before decrypting the root key.

The reason is written into the code: the entry-point check runs before the approval UI so it covers every downstream signer, but it is not a signature-time check, and the hardware paths never pass through `WalletBg.signTx`. **If you add a new signing entry point, it needs its own preflight.**

## dApp boundary

- CIP-30 `signTx` refuses non-whitelisted origins **before anything else**, using only the relay-stamped `request.origin`. **Never trust `request.data.origin`** - the page controls it.
- The only writer of `request.origin` is the content-script proxy, which sets it from `window.origin` after rejecting any message where `e.source !== window`.
- `enable`, `isEnabled` and every sign method bypass the relay's whitelist pre-check on purpose (to keep the user gesture alive for `chrome.sidePanel.open()`), so the **background** enforces the whitelist for them. Any new handler on that fast path must re-check `WalletStore.isWhitelisted(request.origin)` itself.
- Every read handler re-checks the whitelist independently, as defence in depth. Match that.
- The `sender` string is forgeable by a content script; sensitive options-only methods are gated on the real `MessageSender` being an own extension page (`src/chrome/senderTrust.ts`).

## Crypto

Do not invent a scheme. Two exist:

| Data | Scheme |
|---|---|
| Root key at rest | PBKDF2-HMAC-SHA512 (c=19162, dkLen=32) -> ChaCha20-Poly1305, stored hex as `salt(32)\|nonce(12)\|tag(16)\|ciphertext` |
| Small UTF-8 secrets (mnemonic, MPC device share, 2FA) | `gpw1.<base64url>` = Argon2id (t=2, m=19456 KiB, p=1) -> XChaCha20-Poly1305, KDF params pinned in the versioned header |

The old crypto-ts/CryptoJS outer AES wrap (MD5, one iteration) was **removed** because it negated PBKDF2 under the same password. Legacy nested blobs are still readable and are migrated to the single strong layer on first password unlock, best-effort so a failed rewrite can never break signing. Do not reintroduce an outer wrap.

Import note: use `blake2b` as a direct dependency - `@noble/hashes/blake2` does not resolve here.

## Non-negotiables for any change in this area

- **Never log key material, mnemonics, addresses, or transaction contents.** Use `debugLog()`, which compiles out unless `VITE_DEBUG_STORES=true`. Strip ad-hoc `console.log` before committing. This is an open-source wallet; a stray log ships to production consoles.
- **Never widen a refusal.** If you add a signing path, add its preflight.
- **Validate at the boundary.** Escape data you serialize. The existing CSV export quotes naively and escapes nothing, and the rows carry attacker-influenced strings (asset names, ADA Handles, metadata) - do not copy that into a new exporter without fixing the formula-injection surface.
- **URL safety has one SSOT**: `parseSafeUrl()` in `src/shared/utils/externalLink.ts`. It parses with `new URL()`, allows only http/https, and matches brands on the parsed `hostname` exactly or as a subdomain. **Never** `url.includes('github.com')` - `https://evil.example/?github.com` satisfies it.
- **Keep key operations in the background** unless the documented exceptions above force otherwise, and say so explicitly in the PR if they do.
- **Never deregister a PassKey from a PRF wallet** - permanent lockout.

## Presentational privacy is not a security control

The `hideBalances` masking is shoulder-surfing and screen-share protection. The values stay in the store, in IndexedDB, in the background and in the DOM-adjacent state. Say so when you extend it, and never let it be described as a privacy guarantee.

Two practical consequences when you add a masked surface:

- A template-only `v-if` is not enough for anything drawn imperatively. `PortfolioChart.vue` masks by re-applying the chart's price formatter and toggling `labelVisible` in a watcher; a chart added without that leaves its crosshair label live.
- The control fails **open** if it does not reach every context. See the service-worker propagation note in `state-and-data.md`.

## What reviewers block on

The AI reviewer and the human ones look for: secrets or key material in logs or commits; XSS, injection or unsafe data handling; missing input validation at system boundaries; hardcoded strings that should be i18n; dead code, unused imports and duplicated logic; and testnet-only test evidence.

## Reporting a vulnerability

Never in a public issue, PR or discussion. Private advisory at
`https://github.com/Gero-Labs/gerowallet/security/advisories/new`, or `support@gerowallet.io`.
In scope per SECURITY.md: key handling/encryption/storage, transaction construction and signing, the CIP-30 connector, cross-context messaging and privilege boundaries, auth flows, supply chain. Backend, infra and third-party providers are out of scope.
