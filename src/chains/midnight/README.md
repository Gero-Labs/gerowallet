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
| `midnightLedger.ts` / `midnightChainLedger.ts` | Which ledger a chain runs, from the protocol version its indexer reports (`>= 2000000` is ledger 9), never from the network's name. Fails closed (`MIDNIGHT_LEDGER_UNKNOWN`) until read. |
| `midnightTxBuilder.ts` | Selects the ledger-specific DUST balancing and public-input signing path for a Nexus-built transaction. `midnightLedger9.ts` also exports fee balancing for private-token sends. |
| `midnightShieldedBuilder.ts` | Selects the ledger-specific private-token builder. On ledger 9 it synchronizes notes, builds a custom-token transfer, and balances DUST through `midnightShieldedLedger9.ts`. |
| `midnightShieldSwapBuilder.ts` | Compatibility entry point that refuses invalid native NIGHT privacy conversion before using credentials or a prover. |
| `midnightPrivateSync.ts` | Local note sync on a ledger 9 chain, with transient unlocked keys, private-token balances, and history: wallet SDK 2's fork-aware wallet on a chain that crossed the upgrade (mainnet, preprod), the ledger 9 variant alone on one born on ledger 9. |
| `midnightChainIdentity.ts` | Verifies Nexus generation against indexer genesis and isolates checkpoints across resets. |
| `midnightDustLightSync.ts` | Rebuilds verified DUST state from compact Nexus projections, following only owned spend chains. Ledger-specific adapters handle SDK fee balancing. |
| `midnightWalletStatePersistence.ts` | Legacy SDK checkpoint storage. Compact DUST sends do not restore these checkpoints. |

## SDK packages

Canonical npm scope is `@midnightntwrk/*` (see ADR 0007 in midnightntwrk/midnight-wallet).
Pinned versions live in `package.json` — don't trust docs' version tables, they drift.

- Ledger 9 runs on `@midnightntwrk/ledger-v9` (exact pin) and wallet SDK 2.0.0,
  installed under the `midnight-v9-*` aliases so they sit beside the wallet SDK
  1.x packages the ledger 8 modules still import (`midnight-v9-dust-wallet` is
  `wallet-sdk-dust-wallet` 5.0.0, `-shielded` and `-unshielded-wallet` 4.0.0,
  `-address-format` 4.0.0, `-abstractions` 3.0.0, all exact).
- In SDK 2 each wallet package has two variants: `…/v1` runs ledger 8
  (`@midnightntwrk/ledger-v8`) and `…/v2` runs ledger 9. Ledger 9 modules import
  `…/v2` only. `tsconfig.json` maps each `/v2` subpath, because the repository's
  legacy resolver does not read package exports.
- SDK 2 hands transactions back as `WalletTransaction` handles stamped with their
  protocol version. Read their bytes with `handle.serialize()` and this module's
  ledger (`midnightShieldedWallet9.ts`): each SDK package installs its own copy of
  the abstractions package, and a copy refuses a handle another copy sealed.
- SDK 2 rejects ledger 8 objects from the old dashed `@midnight-ntwrk/ledger-v8`;
  its ledger 8 side needs `@midnightntwrk/ledger-v8`. The ledger 8 modules here
  still use the dashed package with SDK 1.x, which is a separate stack.

## Transaction requirements

Keep these boundaries when changing transaction code.

- Unshielded signing: BIP-340 via `keystore.signData` per segment; segments may be
  0x-prefixed (walletBg strips before decoding). On ledger 9 keys and signatures
  are tagged `{ tag: 'schnorr', value }` inside the transaction
  (`signLedger9Transaction` adds `SignatureEnabled` per input it owns); what
  crosses to Nexus stays plain hex (`schnorrHex`). Wallet SDK 2's signer
  callbacks are async (`signDataAsync`); the wallet's own signer walks the
  intents itself and uses the synchronous `signData`.
- `fixtures/nexus-ledger-signing.json` is the contract with Nexus's builder:
  ledger 9 transfers and DUST registrations for mainnet, preprod, Preview and
  Stagenet, plus the earlier ledger 8 transfers for a chain below the fork.
- The dust fee tx returned by `dust.balanceTransactions` MUST be `.merge()`d into
  the transfer or the ledger rejects with "Invalid signature value".
- DUST preparation uses compact projections with a two-minute request deadline.
  It does not start the SDK's background ledger replay.
- No hardware-wallet support by design: ZK proving needs cleartext keys.
- The DApp connector exposes connected-wallet reads, public transfers,
  submission, and unshielded message signing. Unsupported request types fail
  before prompting for approval. Every connector path follows the chain's
  ledger: `balanceUnsealedTransaction` balances with `midnightDappBalancer.ts`
  (ledger 8) or `midnightDappBalancer9.ts` (ledger 9, wallet SDK 2's pure `/v2`
  capabilities over the wallet's synced UTxOs); `submitTransaction` judges
  "sealed" with the chain's ledger and names a transaction of the other ledger
  instead of sending it to be proven. `makeIntent` builds with
  `midnightIntentBuilder.ts` (ledger 8) or `midnightIntentBuilder9.ts`
  (ledger 9, SDK 2's `/v2` `Transacting.initSwap` over the synced UTxOs the
  signing key's address owns, refused until the wallet has synced); the checks
  both share are in `midnightConnectorIntent.ts`.
- Connector fees on ledger 9 (`balanceUnsealedTransaction`, and `makeIntent`
  with `payFees`, since a counterparty may fill it with a contract call) are
  paid with two DUST spends when the wallet has two coins: ledger 9 can reject
  a contract call paid with exactly one (`OutsideTimeToDismiss`,
  midnight-ledger#838). `balanceLightDust9(…,
  { minimumSpends: 2 })` re-pays the SDK's one-spend fee from two coins, priced
  with the SDK's own `dryRunFee`.

## Compact DUST synchronization

Deploy Nexus with `POST /api/midnight/{network}/dust/light-sync` before releasing
this wallet. Each network uses the ledger its chain reports (see "Ledger selection"). The endpoint
accepts three operations: `snapshot` with a public DUST address, `spends` with a
pinned block hash and nullifier prefixes, and `commitments` with a pinned block
hash and inclusive tree ranges. These synchronization requests contain only
public data; key derivation and fee construction run in the wallet.

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
shielded synchronization modules, and proving follows the selected proving path
(see "Proving" below). Public-only synchronization does not make remote proving
local.

The server limits each request to 60 seconds, shares the caller's existing
Midnight connection budget, and caps concurrent projections per sidecar. Tests
compare compact reconstruction with real ledger replay, including descendants,
foreign ranges, and decay after the backing NIGHT is spent. A successful local
test or empty-wallet live probe does not establish funded on-chain send latency.

DUST state resets once, at the ledger 9 crossing, so every coin a ledger 9
snapshot lists was created on ledger 9. On a chain that crossed (mainnet,
preprod) the spend pages also return the history from before it: spend
transactions and events whose protocol version is not on the snapshot's ledger
are skipped, never decoded, so ledger 8 history cannot fail a ledger 9 rebuild.
An unreadable spend of the snapshot's own ledger still fails. No DUST tree
index is cached between sends (each send rebuilds from the snapshot), so there
is none to drop at the crossing; the SDK checkpoints are invalidated by the
mainnet and preprod schema version 3 (`midnightWalletStatePersistence.ts`). A
preprod registration the upgrade cleared shows up as a snapshot with no
generations: no DUST, and no spend history is asked for.

Spend queries use bounded height pages and retain only owned matches locally.
Large restored spend histories can still reach the two-minute deadline. The
current providers have a prefix-bound bug for prefixes ending in `ff`. For a
one-byte `ff` prefix, Nexus uses a fixed 765-prefix cover that keeps almost the
entire original anonymity set; it never narrows to the wallet's next byte. The
cover excludes nullifiers beginning with four `ff` bytes. Such a nullifier fails
explicitly until the provider supports it, rather than being treated as unspent.

## Private notes across the upgrade

Mainnet and preprod crossed the ledger 9 upgrade, so a wallet's notes and
history start on ledger 8. Wallet SDK 2's fork-aware `ShieldedWallet` reads
them: ledger 8 (`@midnightntwrk/ledger-v8`, pinned) below protocol version
2000000, ledger 9 from it, handing over at the crossing. The private sync and
the private send use it on a chain that crossed (`forkingShieldedWallet`,
started with both ledgers' keys from one seed), and the ledger 9 variant alone
on a chain born on ledger 9 (Stagenet, the relaunched Preview). A send refuses
while the fork-aware wallet is still on the ledger 8 side (its transaction
handle carries the version that built it). `privateSyncStatus` stays the gate
for what the views trust.

## Ledger selection

A network can change ledger without changing its name: preprod moved to ledger 9
in place. So no code path picks a ledger, a proof-server tag or a proving
profile from the network name.

- `resolveMidnightChain(network)` asks the indexer the wallet syncs from for the
  protocol version of its tip and of its first block, in one query, and keeps the
  answer for a minute. `>= 2000000` (wallet SDK 2's `V9NativeForkVersion`) is
  ledger 9. The sync session reads it at start and every five minutes.
- Every path that builds, signs, balances or proves resolves it first. Before a
  read, `midnightLedgerVersion` throws `MidnightLedgerUnknownError`
  (`MIDNIGHT_LEDGER_UNKNOWN`): nothing is prepared on a guess.
- The DUST light-sync snapshot carries the block's protocol version too. A
  snapshot on the other ledger stops the send with `MIDNIGHT_LEDGER_CHANGED`
  and records what the chain said, so the retry takes the right path.
- Keys, addresses and Schnorr signatures are the same on both ledgers; key
  derivation and message signing use ledger 9 for every network and read nothing.
- The extension pages show the ledger the background last read (mirrored in
  `midnightStore.chainLedgers`), else the newest one, for the proof-server
  command and port. That is display only.
- Guards name the wallet's own network and ledger ("not supported on Midnight
  Preprod (ledger 9)").
- Private notes on a chain that crossed the upgrade need ledger 8 history and
  ledger 9 events: wallet SDK 2's fork-aware shielded wallet (see "Private
  notes across the upgrade").

## Proving

A proof preimage carries the circuit's private inputs. Verified against
`midnightntwrk/midnight-ledger` at `ledger-8.1.2` (unchanged in ledger 9): a DUST
spend carries the wallet's `DustSecretKey`, and a Zswap spend (and sign) carries
the raw `CoinSecretKey`. Both are seed-derived and wallet-wide; the coin secret
key cannot be rotated, only abandoned by moving funds to a new seed. Whoever
proves a transaction can therefore spend what it reveals.

| Mode | Public send (DUST fee) | Private send (Zswap + DUST) |
|---|---|---|
| Gero Cloud (`remote`, default) | this device | Gero Cloud `/tx/prove-and-submit`, consent-gated; this device with `isMidnightShieldedDeviceProvingEnabled` |
| local | the user's loopback proof server | same |
| zkPaaS | Arkhia, consent-gated | same |

- **This device** (`midnightDeviceProver.ts`): zkir-v2 2.2.0 (which fixes
  in-process DUST proofs being rejected, midnight-ledger#832) in a Worker inside
  an offscreen document, reached over one dedicated port. Chains on ledger 9
  only: the pinned keys are ledger 9.1.0.1's generation 10 DUST spend keys
  (`midnightZkKeys.ts`, pinned to the ledger source's SHA-256 and checked by
  `node scripts/midnight-zk-keys.mjs --verify` against `srs.midnight.network`).
  A chain still on ledger 8 keeps the proof-server paths. The DUST set ships in
  the package (`src/assets/midnight-zk`, 3.75 MB), the Zswap set (~29 MB,
  unchanged by ledger 9) is fetched from `VITE_MIDNIGHT_ZK_KEYS_URL` and is
  needed only by the shielded flag; that host must serve the released files
  (`--verify --host <url>` checks it). The worker exists only in built pages,
  not under the Vite dev server.
- **Local proof server**: `midnightntwrk/proof-server:9.0.0` for ledger 9 on
  `127.0.0.1:6301`, the ledger 8 server (8.1.0) on 6300. Ledger 9 keeps 6301
  on every network so a ledger 8 server still running on 6300 never gets
  ledger 9 jobs; the default URL follows the chain's ledger
  (`defaultLocalProofServerUrl`). Cross-device proving serves the ledger 9
  server and advertises `9.0.0`.
- A proven transaction goes to `/tx/submit-proven`, which carries no witness.
  `/tx/submit` (Gero Cloud proves) is left for the one-off fallback on Stagenet
  and for an unsealed transaction a dapp submits itself.
- Submits wait 110 s; a lost reply is settled by looking the transaction up by
  its ledger identifiers (`midnightSubmitRecovery.ts`). Identifiers are fixed at
  build time and survive proving and binding.
- Measured (Apple M-series, Node/V8, ledger 9 and zkir 2.2.0): DUST spend
  6-7 s, Zswap spend 37 s. `MIDNIGHT_PROVE=1 npx vitest run
  src/chains/midnight/midnightZkKeyMaterial.spec.ts` reproduces them.
