# Scope: route Bitcoin sync through gero-sync (client-side)

Branch: `feat/btc-via-gero-sync` (worktree `../gerowallet-btc-sync`, off `development`).
Scope = **client (extension) only.** gero-sync/nexus backend work tracked separately (see "Backend dependencies").

## Thesis
Today BTC bypasses gero-sync entirely and polls public Esplora/mempool APIs directly every 60s.
Target: BTC rides the **same gero-sync WebSocket push path Cardano uses** — one client sync model, no direct 3rd-party calls from the extension, and the foundation for adding EVM the same way.

Good news from the code: this is mostly **reuse**, not new build.
- Wire block type `WsSyncBlock` (`src/services/websocket.service.ts:5-16`) is **already BTC-aware** — `slot`/`epoch`/`epoch_slot` optional, comment explicitly says BTC omits/zeros them.
- Cardano subscribe **already sends an HD credential array** with server-driven expand-on-demand (`walletBg.ts:823-865`) — the natural analog for BTC HD (xpub/descriptor + gap limit).

---

## Current state (two paths)

**BTC (direct polling — to be replaced):**
- `sync.service.ts:48,126` — `sync()` / `syncViaRest()` early-return for BTC.
- `walletManager.service.ts:368` — WS `connect()` gated to non-BTC ("Skipping WebSocket for Bitcoin").
- `api/bitcoin-api.ts:80-91` — hardcoded hosts (`mempool.space`, `blockstream.info`); `getUtxos`/`getBalance`/`getTransactions`/`getTip`.
- `walletBg.ts:1034-1210` — `fetchBitcoinUtxos` (HD walk, gap limit 20), `syncBitcoin*`, `startBitcoinPeriodicSync` (`setInterval` 60s, `BITCOIN_SYNC_INTERVAL_MS`).

**Cardano (gero-sync push — the target model):**
- Transport `websocket.service.ts` — `wss://sync.gerowallet.io/ws/sync`; `SUBSCRIBE {chain,network,address,lastSyncedBlock,credentials,platform}` (`:123-131`); handles `SYNC`, `CATCH_UP_COMPLETE`, `ROLLBACK`, `SYNC_CHECK_OK`, `FORCE_RESYNC`; 25s `SYNC_CHECK` keep-alive (`:77`).
- Apply `sync.service.ts:298-353` `setSync()` — account/assets/rewards/txs/utxos/addresses/tip.
- Handlers wired in `walletManager.service.ts:368-458`.

---

## Change surface (client)

### A. Rewire — sync path
| File:line | Now | Change |
|---|---|---|
| `sync.service.ts:48` | `sync()` returns early for BTC | remove BTC early-return; let BTC use WS push |
| `sync.service.ts:126` | `syncViaRest()` returns early for BTC | route BTC manual-refresh to WS resubscribe/refresh |
| `walletManager.service.ts:235` | skip `getLastSyncInfo` for BTC | BTC gets a real checkpoint (block height) |
| `walletManager.service.ts:310` | BTC init → `syncBitcoinWallet()`+`syncBitcoinTransactions()` | replace with WS `connect()` path |
| `walletManager.service.ts:368` | WS `connect()` gated to non-BTC | **remove the gate** — BTC connects too (core switch) |
| `walletManager.service.ts:470` | `startBitcoinPeriodicSync()` | delete (push replaces poll) |
| `walletManager.service.ts:559` | `stopBitcoinPeriodicSync()` on logout | delete |
| `walletBg.ts:343` | BTC no-op in `setUtxosAndAddresses` | feed BTC utxos/addresses from server payload |
| `background.ts:2075` | `SYNC_BITCOIN` manual refresh → `syncBitcoinWalletComplete()` | re-point to WS resubscribe/refresh |

### B. Delete / dead-code after cutover
- `walletBg.ts` `startBitcoinPeriodicSync`/`stopBitcoinPeriodicSync` (`:1180-1210`), `BITCOIN_SYNC_INTERVAL_MS` (`:1174`).
- `api/bitcoin-api.ts` read methods `getUtxos`/`getBalance`/`getTransactions`/`getTip` become unused for sync. **Keep** `broadcastTransaction`/`getFeeEstimates`/`getTransaction` (send-side still needs them) — do NOT delete the file.
- `fetchBitcoinUtxos` HD walk (`walletBg.ts:1034`) — logic moves server-side; client keeps derivation for *subscription identity* only (see D).

### C. Type-widen — BTC tip has no epoch/slot
BTC tip = height + blockhash + time only. Cardano-shaped types force epoch/slot:
- `models/types.ts:257-269` — `Tip` mandates `slot`/`epoch`/`epoch_slot`/`slot_leader`. **Make BTC-relevant fields optional or add a chain-neutral tip variant.**
- `stores/networkStore.ts:11-15,124` — `tip: Cardano.Tip & {epoch;time;epoch_slot}`, `setTip(...)`. Widen so BTC can set `{height, hash, time}` without fake epoch/slot.
- `sync.service.ts:342-351` — `setSync` passes slot/epoch/epoch_slot to `setTip`; guard for BTC.
- Wire type `websocket.service.ts:5-16` already optional — only the store/model types lag.

### D. Subscription identity — single stake addr → BTC HD
- Cardano sends `address = stakeAddress` **+ `credentials`** array (`websocket.service.ts:123-131`), with `expandCredentialsIfNeeded`/`resubscribe` for gap growth (`walletBg.ts:838-865`, `sync.service.ts:324-331`).
- BTC has **no stake address** (`walletBg.ts:131` sets `stakeAddress=''`). Options for `SUBSCRIBE` identity:
  - send **xpub/descriptor** (server derives + gap-scans), or
  - send **pre-derived address set** (external+change up to gap limit) reusing the `credentials` slot.
- Reuse the existing `credentialRange`/`derivePaymentCredentials`/`expandCredentialsIfNeeded` trio as the BTC analog; wire server-returned addresses via `syncKeys()` (`sync.service.ts:559`).
- **Decision needed with backend** (see below): xpub vs address-set. xpub is cleaner + lets server own gap-limit; address-set leaks less but pushes gap logic to client.

### E. Leave alone (verified unrelated)
- All send/sign/dApp BTC branches in `background.ts` (sign PSBT, SEND_BITCOIN, Babylon stake, Trezor init, Unisat/WC connect).
- dApp `getBalance`/`getUtxos` (`background.ts:2913,2932`) already read `WalletStore` → **no change** once the store is fed by gero-sync. This is the payoff: consumers untouched.
- `walletBg.ts:1794` `isEnterpriseAddress` (Cardano concept).

---

## Backend reality (read from `../gero-sync` — Spring Boot 3.5 / Java 21)
gero-sync is **already multichain** and BTC is **half-built** behind `bitcoin.enabled=false`. This resolves the 4 decisions — see below.
- Seam exists: `ChainSyncProvider` interface + `ChainSyncProviderFactory` (bean-per-chain), `ChainType.BITCOIN` enum, `chain` carried subscribe→index→emit.
- BTC package present but thin: `chain/bitcoin/{BitcoinSyncProvider,BitcoinDataService,BitcoinBlockPoller}.java` + config + tests. Esplora REST client (`mempool.space`), forward-only tip poller.
- **Never run end-to-end** — `BitcoinBlockPoller.java:58-68` has a key-parse bug (passes `"mainnet:<addr>"` to Esplora). Proves scaffold, not shipped.
- Wire DTO `SyncPayload` is chain-agnostic *by contract*, Cardano-shaped *by field* (`BlockInfo{height,hash,slot,epoch,epoch_slot,time}`, `TxData{cbor,absoluteSlot,epochNo}`). BTC already sends `slot/epoch=0`, `cbor=null`. `utxos` is free-form `List<Map>` — BTC can define its own shape.

## Decisions — RESOLVED by backend architecture
1. **Subscribe identity → CLIENT-derived address-set (client owns gap-limit).**
   Server has **no xpub/descriptor derivation and no gap-limit scanner anywhere** (`CardanoDataService.buildAddressesFromCredentials:388-423` only *materializes* addresses from the exact credential list the client sends — it does not scan). Cardano's "one stake key fans out to all payment addrs" trick has **no BTC analogue** (no on-chain stake grouping). So either the client sends its derived address-set (or credential list) — the contained path — or someone builds a **net-new server-side xpub+gap subsystem** (the bulk of the effort). **Take the client-owns-gap path** — mirrors today's Cardano credential flow, keeps `fetchBitcoinUtxos` gap-walk logic (`walletBg.ts:1034-1091`) as the *subscription* input instead of the *poll* driver.
2. **Reorg → must be built, height-based.** ROLLBACK today is slot-based from YACI (`CardanoChainSync.java:307`). BTC over Esplora gets **no reorg signal** — `BitcoinBlockPoller` is forward-only. Backend must add reorg detection (prev-hash compare / height regression) and emit `ROLLBACK {rollbackToHeight, rollbackToHash}`. Client needs a BTC rollback branch filtering txs by **height**, not slot (`sync.service.ts:260-292`).
3. **Tip → widen shared `Tip` / add BTC branch (DTO already tolerant).** Backend `BlockInfo` is height-tolerant; BTC emits height-only. But server has **no `BitcoinTipCache`** — `CatchUpService.currentChainTip:104-111` returns null for BTC, so no tip stamped. Client-side: widen `models/types.ts:257` + `networkStore.ts:11-15` so BTC sets `{height,hash,time}` without fake epoch/slot. Backend adds `BitcoinTipCache`.
4. **Gap limit → CLIENT.** Confirmed by #1 — nothing server-side to extend.

## Backend dependencies (gero-sync — NOT this scope; blocks client dual-run)
Client can't meaningfully dual-run until gero-sync BTC is real:
- Fix `BitcoinBlockPoller` key-parse bug (`:58-68`).
- Implement `BitcoinSyncProvider.getUtxos` (Esplora `/address/{a}/utxo`) — currently returns empty, so SYNC carries no UTxOs.
- Add `BitcoinTipCache` + wire into `currentChainTip`.
- Add reorg detection + height-based ROLLBACK.
- Fix catch-up `since>0` branch (`CatchUpService:144-163`) which assumes UTxOs exist — BTC reconnect currently gets nothing.
- BTC UTxO wire shape (suggest straight Esplora: `{txid,vout,value,address,status:{confirmed,block_height}}`). Client needs a parallel `convertBtcUtxos()` — `sync.service.ts:333-337` `convertNexusUtxos()` is Cardano-only.

## Phased plan (client)
1. **Types:** widen tip (C) — unblocks everything, no behavior change.
2. **Subscribe:** BTC `SUBSCRIBE` identity + credential analog (D), behind a flag; connect BTC WS without removing the poller yet (dual-run to compare). ✅ DONE (b366bb84, flag `isBitcoinGeroSyncEnabled` default OFF).
   - Phase-2 follow-up A: the inert connect subscribes with only the wallet's **stored xpub** (segwit default) — the full 3-type union (legacy `44'` + taproot `86'`) needs their own account xpubs, which require the mnemonic at unlock. `deriveBitcoinAddressSet(mnemonic,…)` (full union) exists; wire it by capturing/storing all 3 account xpubs at unlock. Until then subscription misses legacy/taproot funds.
   - Phase-2 follow-up B (backend dep): client now SENDS `addresses[]` in SUBSCRIBE, but gero-sync `SubscribeMessage` has no `addresses` field yet — that's backend #3 (multi-address subscription). Client is ahead; harmless while flag OFF.
3. **Apply:** ✅ DONE (82365cb5) `convertBtcUtxos` + BTC branch in `setSync`; feed `WalletStore` from server payload.
   - Phase-1 follow-up: `networkStore.getCurrentBlockHeight()` currently returns `null` for a BTC tip (guarded to preserve no-behavior-change). BTC has a height — make it return `tip.height` when `isBitcoinTip(tip)`.
4. **Rollback:** BTC reorg branch in `handleRollback`.
5. **Cutover:** remove BTC gates (A), delete poller (B), verify dApp consumers unchanged.
6. **Verify:** parity vs old poll (balance/utxos/tx history), reorg, gap-limit growth, catch-up, MV3 keep-alive (<30s), lock/unlock.

## Risks
- **Parity regressions** — dual-run phase 2 mitigates; compare WS result vs Esplora poll before cutover.
- **Gap-limit / missing funds** — if server gap scan < client's old 20, users see missing UTxOs. Match or exceed, test with sparse wallets.
- **Reorg correctness** — wrong rollback = phantom/duplicate txs. Needs explicit BTC branch + test.
- **MV3 service worker** — keep the 25s SYNC_CHECK keep-alive; BTC must not reintroduce a >30s idle gap.
- **CI has no full bundle build** — run `npm run dev` before merge (tsc+ci can pass while vite bundle fails).
- **Background rebuild** — `walletBg.ts`/`background.ts` changes need `npm run dev:background`.
- **Concurrent repo agents** — isolated here in worktree; keep it that way.

## Out of scope
- gero-sync/nexus backend (indexer, adapter, WS server BTC support).
- EVM/Base (follows this pattern once BTC lands).
- BTC send/sign/dApp paths (untouched).
