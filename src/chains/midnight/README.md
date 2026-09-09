# Midnight chain module

Working integration for Midnight Network (Cardano partner chain, Substrate-based,
NIGHT + DUST tokens). This module owns key derivation and BG-side transaction
building/signing; sync and orchestration live in `src/services/midnight-*.ts`.

## Files

| File | Role |
|---|---|
| `midnightConfig.ts` | Per-network endpoints (Nexus REST base, gero-sync WS, public Foundation indexer/RPC) + Nexus path composition. Networks: stagenet / preprod / mainnet. |
| `midnightTypes.ts` | Types + decimals (NIGHT=6, DUST=15), addresses, UTxOs, dust state, tx model. |
| `midnightKeyManager.ts` | HD derivation from BIP39 mnemonic: `m/44'/2400'/account'/role/index`. Roles (wallet-sdk-hd 3.x): NightExternal=0, Dust=2, Zswap=3, Metadata=4. Also derives the Cardano CIP-1852 material (same mnemonic) for DUST registration, and the indexer viewing key (`mn_shield-esk_…` — the encryption SECRET key). |
| `midnightTxBuilder.ts` | Selects the ledger-specific DUST balancing and public-input signing path for a Nexus-built transaction. `midnightLedger9.ts` also exports fee balancing for private-token sends. |
| `midnightShieldedBuilder.ts` | Selects the ledger-specific private-token builder. Stagenet synchronizes notes, builds a custom-token transfer, and balances DUST through `midnightShieldedLedger9.ts`. |
| `midnightShieldSwapBuilder.ts` | Compatibility entry point that refuses invalid native NIGHT privacy conversion before using credentials or a prover. |
| `midnightPrivateSync.ts` | Local Stagenet note sync with transient unlocked keys, private-token balances, and history. |
| `midnightChainIdentity.ts` | Verifies Nexus generation against indexer genesis and isolates checkpoints across resets. |
| `midnightWalletStatePersistence.ts` | Persist/restore SDK `serializeState()` in `chrome.storage.local` (keyed network+kind+sha256(seed)) so sends resume from a cursor instead of cold-syncing from genesis. |

## SDK packages

Canonical npm scope is `@midnightntwrk/*` (see ADR 0007 in midnightntwrk/midnight-wallet).
Exception: `@midnight-ntwrk/ledger-v8` stays on the dashed scope (upstream package).
Pinned versions live in `package.json` — don't trust docs' version tables, they drift.

## Transaction requirements

Keep these boundaries when changing transaction code. See the
[Stagenet guide](../../../docs/midnight-ledger9.md) for rollout and live testing.

- Unshielded signing: BIP-340 via `keystore.signData` per segment; segments may be
  0x-prefixed (walletBg strips before decoding).
- The dust fee tx returned by `dust.balanceTransactions` MUST be `.merge()`d into
  the transfer or the ledger rejects with "Invalid signature value".
- `waitForSyncedState()` hangs on an empty ledger in ALL SDK versions — both
  builders wrap it in a bounded `Promise.race` timeout.
- No hardware-wallet support by design: ZK proving needs cleartext keys.
- The DApp connector exposes connected-wallet reads, public transfers,
  submission, and unshielded message signing. Unsupported request types fail
  before prompting for approval.
