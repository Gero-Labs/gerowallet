# Three chains, three code paths

Gero is multi-chain by a runtime data table plus explicit per-chain branches, **not** by a polymorphic abstraction. A change verified on Cardano is not verified.

## The table

`src/utils/networks.ts` (there is no `src/config/networks*`) holds 10 entries keyed by `(blockchain, network)`: Cardano Mainnet/Preprod/Preview, Apex Prime Mainnet, Apex Vector Mainnet, Bitcoin Mainnet/Testnet4, Midnight Stagenet/Preprod/Mainnet. Each carries a flat boolean capability matrix, protocol params, currency metadata and a default provider, read through 28 `resolve*(chain, network)` helpers, 17 of them boolean capability gates (`resolveStakingSupport`, `resolveSwapSupport`, ...).

`resolveNetwork(chain, network)` returns `undefined` for an unknown pair, and every caller must handle that.

## Two type traps

**`Blockchain` and `Network` are const objects of display strings, not enums.** `CARDANO = 'Cardano'`, `APEX_PRIME = 'Apex Fusion Prime'`, `APEX_VECTOR = 'Apex Fusion Vector'`, `BITCOIN = 'Bitcoin'`, `MIDNIGHT = 'Midnight'`. Consequences:

- `switch (chain)` is **never exhaustiveness-checked**. A new chain silently falls into whatever `default:` the switch happens to have, with no compile error. Most default to Cardano; two do not - `getExplorerUrl()` in `src/shared/utils/explorer.ts` returns `''` (which is why Midnight explorer links render empty) and `getDefaultAddressType()` in `src/db/gero-db.ts` returns `'unknown'`. Grep every `switch` on a chain when adding one.
- Comparing against literals is a live bug source. `'Apex Prime'` is not a value; the real one is `'Apex Fusion Prime'`. Always compare against `Blockchain.APEX_PRIME`.
- **The wire protocol does not use these strings.** Every backend and WebSocket call reverse-looks-up the uppercase enum key: `Object.keys(Blockchain).find(k => Blockchain[k] === chain)` -> `'CARDANO'`/`'BITCOIN'`/`'MIDNIGHT'`. Sending the display string gives a backend 4xx or a gero-sync close.

**The networks array ends `] as NetworkInfo[]`**, and that type assertion disables both excess-property and missing-property checking. A typo'd capability field compiles and sits dead forever (`zkFoldSupport` is doing exactly that today), and a new field you forget on one entry is `undefined`, not a compile error. Add the field to the interface, set it on all ten entries, add the resolver, then grep to confirm.

## Where the three diverge

| | Cardano / Apex | Bitcoin | Midnight |
|---|---|---|---|
| Code location | `src/chrome/serialization.ts`, `cardanoJsSdkCbor.ts`, `src/services/sync.service.ts`, `src/api/` - **there is no `src/chains/cardano`** | `src/chains/bitcoin/` | `src/chains/midnight/` |
| Derivation | CIP-1852, one path shared by Cardano and both Apex chains | BIP44/84/86 by `addressType` (segwit default), coinType 0 / 1 | `m/44'/2400'/account'/role/index`, 5 roles, three bech32m addresses stored as JSON in `wallet.publicKey` |
| Sync | `SyncService` + gero-sync Cardano SUBSCRIBE | gero-sync WS (address-set SUBSCRIBE) with an Esplora poller fallback | `midnightSyncService` over the same socket, with `midnight-<network>` slugs |
| Tx build | Mostly **server-side via Nexus**; local `@cardano-sdk` builder is the minority path | PSBT via bitcoinjs-lib, four coin-selection strategies | Nexus builds the unproven tx; the wallet proves and balances |
| Signing key | Decrypts `encryptedPrivateKey` | Decrypts the **mnemonic** and re-derives every time | Decrypts the **mnemonic** and re-derives every time |
| Hardware | Ledger / Trezor / Keystone | None - the background handler is a stub returning `{ success: false }` | None by design (ZK proving needs the key in cleartext) |
| State | `walletStore`, `networkStore` | Shares `walletStore.utxos`; `networkStore.tip` via a `BitcoinTip` union arm | **`src/stores/midnightStore.ts`** - a completely parallel store for tip, balances, transactions, utxos, dust |

Two consequences that catch people:

- **Looking for a Midnight wallet's transactions in `walletStore` gives empty arrays.** They are in `midnightStore`. `NavigationDrawer` already branches on this.
- **Bitcoin and Midnight wallets created with `backupMnemonic: false` can unlock and show balances but can never sign** - "Wallet has no encrypted mnemonic". The encrypted mnemonic is load-bearing for them, not merely a backup.

## Feature gating per chain

- **`isBitcoinEnabled`** (default **false**) is the master visibility gate for Bitcoin, enforced in exactly three kinds of place: the onboarding family tile, six router guards, and the matching NavigationDrawer items. It is ANDed with the per-network capability in the six router guards and the six NavigationDrawer items. The onboarding family tile is the exception - `NetworkSelector.vue` checks the flag against the chain name alone.
- **`isBitcoinGeroSyncEnabled`** defaults to **true** and is a kill-switch, not an enablement flag: false switches to the 60s Esplora poller.
- **There is no `isMidnightEnabled`.** Midnight Mainnet is already selectable by ordinary users. Only Bitcoin is release-gated.
- **CIP-113 has three gates**, not the two CLAUDE.md describes: `CIP113_ALLOWED_NETWORKS` (Preview only, checked first), the per-network script-hash list, and the runtime `isCip113Enabled` flag.

## Adding chain-specific behaviour to an existing screen

Three coordinated places, or you ship a half-gate:

1. the capability field + resolver in `src/utils/networks.ts`
2. the `routeNetworkGuards` entry in `src/modules/navigation/router.ts`
3. the matching `enabled:` on the `NavigationDrawer.vue` item, **textually identical** to (2)

Per-chain visual assets are switched by a literal `switch (loggedWallet.chain)` in at least three more places (dashboard background, side-panel background, nav logo), each with a Cardano `default:`.

## Adding a Midnight network

Four places at once, or you get a runtime throw rather than a graceful degrade:

`src/utils/networks.ts`, `MIDNIGHT_NETWORK_ENDPOINTS`, `midnightLedgerVersion()`'s switch, and `midnightKeyManager`'s `midnightNetworkId` switch - plus `toGeroSyncMidnightNetwork` if it needs live push.

Midnight runs **two incompatible ledger generations selected purely by network**: Mainnet/Preprod use ledger 8, Stagenet uses ledger 9, reached through different npm packages via package.json aliases. `midnightLedgerVersion(network)` is the single dispatcher and throws on anything else.

## Not everything is proxied

CLAUDE.md says all blockchain data is brokered server-side. That holds for Cardano. `BitcoinApi` calls public Esplora endpoints **directly**, including transaction broadcast; Midnight's config carries direct Foundation indexer/RPC URLs and an Arkhia proving URL; `src/api/spo-api.ts` calls Koios directly. Know which you are extending before copying a client shape.

## Useful specs

```bash
npx vitest run test/sidepanel/useChainContext.test.ts
npx vitest run src/utils/networks.spec.ts
npx vitest run src/chains/midnight/
npx vitest run src/chrome/cip113Partition.spec.ts src/chrome/serialization.ownership.spec.ts
```
