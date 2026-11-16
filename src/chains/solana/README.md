# Solana

Solana support, gated by the `isSolanaEnabled` feature flag (default off).

This folder is the chain core. It has no UI and no wallet wiring yet. Onboarding, the background worker, Gero Sync and the screens are follow-ups.

| File | What it does |
|---|---|
| `solanaPaths.ts` | `m/44'/501'/n'/0'`, the path Phantom, Solflare and Ledger Live use, so a restored phrase shows the same addresses. No dependencies, so hardware modules can import it. |
| `solanaKeyManager.ts` | SLIP-0010 ed25519 derivation from a BIP-39 phrase, address validation (`isValidSolanaAddress` accepts off-curve program addresses; `isOnCurveSolanaAddress` tells keys apart from them). Built on `@noble` only, so it runs in the background worker. |
| `solanaBase58.ts` | Base58 for addresses, blockhashes and signatures. |
| `solanaAmount.ts` | Lamports and SPL raw units as `bigint` (a u64 can exceed `Number.MAX_SAFE_INTEGER`); `formatSol`/`parseSol`. |
| `solanaTransaction.ts` | Native SOL transfer: hand-encoded legacy message (SystemProgram transfer, optional ComputeBudget limit and price), ed25519 signing, fee estimate. |
| `solanaWireSync.ts` | Gero Sync `SOLANA` messages → transactions, balance, tokens, cursor. Contract: gero-sync `docs/solana-wire.md`. |

`src/api/solana-api.ts` is the Nexus `/api/sol` client. It calls Nexus directly with the device JWT, as the Midnight client does; device tokens carry `SOLANA_READ`/`SOLANA_WRITE`. Realtime updates come from Gero Sync, and this client covers on-demand reads, fees and submit.

## Rules

- Never persist or log a `secretKey`. Derive it from the phrase when signing, then wipe it.
- An unknown balance is `undefined`, never `0`. Gero Sync omits a field when Nexus failed.
- The Gero Sync cursor (`lastSyncedBlock`) is a slot. Only a `SYNC` that delivered transactions moves it; the `block` on `CATCH_UP_COMPLETE` / `SYNC_CHECK_OK` is the tip, for display.
- Networks are `Mainnet` and `Devnet` (Nexus `solana-mainnet` / `solana-devnet`). Gero Sync and Nexus serve no others.

## Tests

`npx vitest run src/chains/solana` runs the unit tests. The key derivation is pinned to `solana-keygen` output.

`solanaTransaction.localnet.spec.ts` submits real transfers to a validator and checks the fee and balances. It is skipped unless you point it at one:

```bash
solana-test-validator --reset
VITE_SOLANA_LOCALNET_RPC=http://127.0.0.1:8899 npx vitest run src/chains/solana/solanaTransaction.localnet.spec.ts
```
