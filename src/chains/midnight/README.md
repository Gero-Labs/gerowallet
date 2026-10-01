# Midnight chain module

Working integration for Midnight Network (Cardano partner chain, Substrate-based,
NIGHT + DUST tokens). This module owns key derivation and BG-side transaction
building/signing; sync and orchestration live in `src/services/midnight-*.ts`.

## Files

| File | Role |
|---|---|
| `midnightConfig.ts` | Per-network endpoints (Nexus REST base, gero-sync WS, public indexer/RPC) + Nexus path composition. Networks: stagenet / preprod / mainnet. |
| `midnightTypes.ts` | Types + decimals (NIGHT=6, DUST=15), addresses, UTxOs, dust state, tx model. |
| `midnightKeyManager.ts` | HD derivation from BIP39 mnemonic: `m/44'/2400'/account'/role/index`. Roles (wallet-sdk-hd 3.x): NightExternal=0, Dust=2, Zswap=3, Metadata=4. Also derives the Cardano CIP-1852 material (same mnemonic) for DUST registration, and the indexer viewing key (`mn_shield-esk_…` — the encryption SECRET key). |
| `midnightTxBuilder.ts` | Selects the ledger-specific DUST balancing and public-input signing path for a Nexus-built transaction. `midnightLedger9.ts` also exports fee balancing for private-token sends. |
| `midnightShieldedBuilder.ts` | Selects the ledger-specific private-token builder. Stagenet synchronizes notes, builds a custom-token transfer, and balances DUST through `midnightShieldedLedger9.ts`. |
| `midnightShieldSwapBuilder.ts` | Compatibility entry point that refuses invalid native NIGHT privacy conversion before using credentials or a prover. |
| `midnightPrivateSync.ts` | Local Stagenet note sync with transient unlocked keys, private-token balances, and history. |
| `midnightChainIdentity.ts` | Verifies Nexus generation against indexer genesis and isolates checkpoints across resets. |
| `midnightDustLightSync.ts` | Rebuilds verified DUST state from compact Nexus projections, following only owned spend chains. Ledger-specific adapters handle SDK fee balancing. |
| `midnightWalletStatePersistence.ts` | Legacy SDK checkpoint storage. Compact DUST sends do not restore these checkpoints. |

## SDK packages

Canonical npm scope is `@midnightntwrk/*` (see ADR 0007 in midnightntwrk/midnight-wallet).
Exception: `@midnight-ntwrk/ledger-v8` stays on the dashed scope (upstream package).
Pinned versions live in `package.json` — don't trust docs' version tables, they drift.

## Transaction requirements

Keep these boundaries when changing transaction code.

- Unshielded signing: BIP-340 via `keystore.signData` per segment; segments may be
  0x-prefixed (walletBg strips before decoding).
- The dust fee tx returned by `dust.balanceTransactions` MUST be `.merge()`d into
  the transfer or the ledger rejects with "Invalid signature value".
- DUST preparation uses compact projections with a two-minute request deadline.
  It does not start the SDK's background ledger replay.
- No hardware-wallet support by design: ZK proving needs cleartext keys.
- The DApp connector exposes connected-wallet reads, public transfers,
  submission, and unshielded message signing. Unsupported request types fail
  before prompting for approval.

## Compact DUST synchronization

Deploy Nexus with `POST /api/midnight/{network}/dust/light-sync` before releasing
this wallet. Mainnet and Preprod use ledger 8; Stagenet uses ledger 9. The endpoint
accepts three operations: `snapshot` with a public DUST address, `spends` with a
pinned block hash and nullifier prefixes, and `commitments` with a pinned block
hash and inclusive tree ranges. No spending key or seed leaves the wallet.

Nexus retrieves owned generation records, historical decay updates, and compact
hashes for foreign tree ranges. The wallet derives nullifiers locally, follows
its own spent-output successors, and verifies both Merkle roots against the
snapshot block before using the canonical SDK fee algorithm. Chain identity is
checked before and after preparation. Older Preprod indexers use bounded retries
around a stable generation tree; modern indexers pin generations by block hash.

A send no longer depends on wallet creation time, a generic checkpoint, or
replaying the network's DUST event history. An unavailable or inconsistent
projection fails with a retryable error; there is no silent full-replay fallback.
This change covers DUST fee preparation. Private-note discovery remains in the
shielded synchronization modules, and proving follows the selected proving path.

The server limits each request to 60 seconds, shares the caller's existing
Midnight connection budget, and caps concurrent projections per sidecar. Tests
compare compact reconstruction with real ledger replay, including descendants,
foreign ranges, and decay after the backing NIGHT is spent. A successful local
test or empty-wallet live probe does not establish funded on-chain send latency.

Spend queries use bounded height pages and retain only owned matches locally.
Large restored spend histories can still reach the two-minute deadline. The
current providers have a prefix-bound bug for prefixes ending in `ff`. For a
one-byte `ff` prefix, Nexus uses a fixed 765-prefix cover that keeps almost the
entire original anonymity set; it never narrows to the wallet's next byte. The
cover excludes nullifiers beginning with four `ff` bytes. Such a nullifier fails
explicitly until the provider supports it, rather than being treated as unspent.
