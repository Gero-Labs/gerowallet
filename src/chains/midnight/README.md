# Midnight chain module

Working integration for Midnight Network (Cardano partner chain, Substrate-based,
NIGHT + DUST tokens). This module owns key derivation and BG-side transaction
building/signing; sync and orchestration live in `src/services/midnight-*.ts`.

## Files

| File | Role |
|---|---|
| `midnightConfig.ts` | Per-network endpoints (Nexus REST base, gero-sync WS, public Foundation indexer/RPC) + Nexus path composition. Networks: preview / preprod / mainnet. |
| `midnightTypes.ts` | Types + decimals (NIGHT=6, DUST=15), addresses, UTxOs, dust state, tx model. |
| `midnightKeyManager.ts` | HD derivation from BIP39 mnemonic: `m/44'/2400'/account'/role/index`. Roles (wallet-sdk-hd 3.x): NightExternal=0, Dust=2, Zswap=3, Metadata=4. Also derives the Cardano CIP-1852 material (same mnemonic) for DUST registration, and the indexer viewing key (`mn_shield-esk_…` — the encryption SECRET key). |
| `midnightTxBuilder.ts` | BG-side DUST-balance + NightExternal-sign of an unshielded NIGHT transfer pre-built by Nexus. Returns signed-but-unproven hex; sidecar `/tx/finalize` proves + submits. |
| `midnightShieldedBuilder.ts` | BG-side build + sign of a shielded transfer (wallet owns the full pre-prove pipeline). Sidecar `/tx/prove-and-submit` proves (in-process WASM) + submits, gated by user consent. |
| `midnightWalletStatePersistence.ts` | Persist/restore SDK `serializeState()` in `chrome.storage.local` (keyed network+kind+sha256(seed)) so sends resume from a cursor instead of cold-syncing from genesis. |

## SDK packages

Canonical npm scope is `@midnightntwrk/*` (see ADR 0007 in midnightntwrk/midnight-wallet).
Exception: `@midnight-ntwrk/ledger-v8` stays on the dashed scope (upstream package).
Pinned versions live in `package.json` — don't trust docs' version tables, they drift.

## Load-bearing facts (verified; see docs/midnight/ + the midnight skill)

- Unshielded signing: BIP-340 via `keystore.signData` per segment; segments may be
  0x-prefixed (walletBg strips before decoding).
- The dust fee tx returned by `dust.balanceTransactions` MUST be `.merge()`d into
  the transfer or the ledger rejects with "Invalid signature value".
- `waitForSyncedState()` hangs on an empty ledger in ALL SDK versions — both
  builders wrap it in a bounded `Promise.race` timeout.
- No hardware-wallet support by design: ZK proving needs cleartext keys.
- DApp connector (`window.midnight[uuid]`, spec v4) is NOT implemented yet — see
  `docs/midnight/2026-07-05-midnight-ecosystem-audit.md` §6 for the plan.
