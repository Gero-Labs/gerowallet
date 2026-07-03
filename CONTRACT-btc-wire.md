# BTC ⇄ gero-sync WebSocket wire contract (v1)

Shared contract for **client** (`gerowallet` extension) and **server** (`gero-sync` `chain/bitcoin/*`).
Goal: Bitcoin rides the **same WS state machine as Cardano**. Only wallet-identity (stake-addr → address-set) and tip/rollback unit (slot → height) change.

Copy this file into `../gero-sync/docs/` too — both sides build against it; changes are a contract change (bump version).

## Conventions
- Endpoint: `wss://sync.gerowallet.io/ws/sync` (unchanged).
- All payload fields **snake_case** (matches server `SyncPayload @JsonNaming(SnakeCaseStrategy)`).
- Every message carries `chain: "BITCOIN"` and `network: "MAINNET" | "TESTNET"`.
- Cardano-only fields (`slot`, `epoch`, `epoch_slot`, `cbor`, `absolute_slot`, `epoch_no`) are **omitted** for BTC (not sent as 0). Client must treat them optional.
- BTC unit of progress/rollback is **block height** (`u32`). No slot, no epoch.
- Amounts in **satoshis** (`u64`, integer — never float).

---

## Wallet identity — the one real swap
Cardano subscribes with one `stake address` (server fans out to all payment addrs).
Bitcoin has no stake grouping → subscribe with the **explicit derived address set**.

- `address` — **anchor**: segwit (BIP84) external index 0. Stable per wallet. Session / SYNC_CHECK key (the Cardano `address` slot).
- `addresses` — **watched set**: the **union of all 3 address types** × {external, change} × gap-limit. Server registers the session against every entry.
- Growth: client detects use near gap edge → derives more → **resubscribe** with a larger `addresses` (anchor unchanged). This is Cardano `expandCredentialsIfNeeded`, addresses instead of key-hashes.

### Address types — ALL three (decision #1)
Same seed derives 3 independent trees (`bitcoinSigner.ts:37-44`). Watch all so funds are never missed regardless of type:
| Type | BIP purpose | Prefix (mainnet) |
|---|---|---|
| legacy | `44'` | `1...` |
| segwit (native) | `84'` | `bc1q...` |
| taproot | `86'` | `bc1p...` |
Path: `m/purpose'/coin'/account'/chain/index`, chain 0=external / 1=change, coin 0=mainnet / 1=testnet.
Initial set = 3 types × 2 chains × gap-limit (20) = **120 addresses**. Client derives the union and sends it in `addresses`.

---

## Messages

### → SUBSCRIBE (client → server)
```json
{
  "type": "SUBSCRIBE",
  "chain": "BITCOIN",
  "network": "MAINNET",
  "address": "bc1qexternal0anchor...",        // anchor = external idx 0, session key
  "addresses": [                               // full watched set (external + change, ≤ gap limit)
    "bc1qexternal0...", "bc1qexternal1...",
    "bc1qchange0...",   "bc1qchange1..."
  ],
  "last_synced_block": 848000,                 // height to resume from; 0 = full history
  "platform": "extension"
}
```
Server: `ChainType.BITCOIN` → `BitcoinSyncProvider`; register session under each of `addresses`; kick catch-up.
(Cardano's `credentials` field is unused for BTC — send `addresses` instead.)

### ← SYNC (server → client) — catch-up batch AND realtime
```json
{
  "type": "SYNC",
  "chain": "BITCOIN",
  "block": { "height": 848001, "hash": "0000...", "time": 1720051200 },
  "transactions": [ /* BtcTx[] */ ],
  "utxos": [ /* BtcUtxo[] */ ],                // full current UTxO set for the wallet
  "account": { /* BtcAccount */ },
  "catch_up_total": 1200,                      // catch-up progress (omit/0 in realtime)
  "catch_up_sent": 300,
  "success": true
}
```
Client `setSync()`: apply `transactions`, `utxos` (via new `convertBtcUtxos`), `account`, `block`→tip(height). Feeds `WalletStore` exactly like Cardano → dApp `getBalance`/`getUtxos` consumers unchanged.

### ← CATCH_UP_COMPLETE (server → client)
```json
{
  "type": "CATCH_UP_COMPLETE",
  "chain": "BITCOIN",
  "total_transactions": 1200,
  "block": { "height": 848001, "hash": "0000...", "time": 1720051200 },
  "utxos": [ /* BtcUtxo[] */ ],
  "addresses": [ /* strings the server actually saw activity on */ ],
  "account": { /* BtcAccount */ }
}
```
Resolves the client's `waitForSync()`. `addresses` lets the client map server-seen addrs back to derivation paths and decide gap-expansion.

### → SYNC_CHECK (client → server) — 25s keep-alive (also MV3 SW keep-alive, must be <30s)
```json
{ "type": "SYNC_CHECK", "chain": "BITCOIN", "address": "bc1qexternal0anchor...", "last_synced_block": 848001 }
```
### ← SYNC_CHECK_OK (server → client)
```json
{ "type": "SYNC_CHECK_OK", "chain": "BITCOIN",
  "utxos": [ /* BtcUtxo[] */ ], "account": { /* BtcAccount */ },
  "block": { "height": 848005, "hash": "0000...", "time": 1720051500 } }  // block optional if tip cache cold
```

### ← ROLLBACK (server → client) — reorg (height-based; BTC-specific)
```json
{ "type": "ROLLBACK", "chain": "BITCOIN", "rollback_to_height": 847999, "rollback_to_hash": "0000..." }
```
Client: delete/unconfirm txs with `block_height > rollback_to_height`; reset checkpoint to `rollback_to_height`. (Cardano branch keys on slot; BTC branch keys on **height** — new branch in `handleRollback`.)
Server: **must build reorg detection** (Esplora gives no native signal) — compare stored tip hash vs polled tip; on prev-hash mismatch / height regression, walk back and emit this.

### ← FORCE_RESYNC (server → client) — optional, same as Cardano
```json
{ "type": "FORCE_RESYNC", "chain": "BITCOIN" }
```
Client resets `last_synced_block=0`, resubscribes.

---

## Object shapes

### BtcUtxo  (straight from Esplora `/address/{a}/utxo`, server adds `address`)
```json
{
  "txid": "abcd...",
  "vout": 0,
  "value": 1500000,                 // satoshis
  "address": "bc1qchange0...",      // server adds so client maps to derivation path
  "status": { "confirmed": true, "block_height": 847990, "block_hash": "0000...", "block_time": 1720050000 }
}
```
Unconfirmed: `status.confirmed=false`, no `block_height`. Client derives confirmations = `tip.height - block_height + 1`.

### BtcTx
```json
{
  "txid": "abcd...",
  "block_height": 847990,           // absent if in mempool (pending)
  "block_time": 1720050000,
  "confirmed": true,
  "fee": 3200,                      // satoshis
  "vin":  [ { "txid": "...", "vout": 2, "address": "bc1q...", "value": 1800000 } ],
  "vout": [ { "vout": 0, "address": "bc1q...", "value": 1500000 },
            { "vout": 1, "address": "bc1qchange...", "value": 296800 } ],
  "net":  200000,                   // REQUIRED: net effect on wallet (+recv / -spent), server-computed (satoshis, signed)
  "direction": "in"                 // REQUIRED: "in" | "out" | "self", server-computed
}
```
No `cbor` (Cardano-only). Send/detail views use `vin`/`vout` directly.

### BtcAccount
```json
{ "balance": 1796800,               // confirmed spendable, satoshis
  "unconfirmed_balance": 0,         // mempool delta
  "tx_count": 42 }
```
Cardano `AccountInfo` fields (rewards/delegation/stake) are omitted/null for BTC.

### BtcBlock (tip)
```json
{ "height": 848001, "hash": "0000...", "time": 1720051200 }
```
No slot/epoch. Client tip type widened to accept height-only (`models/types.ts:257`, `networkStore.ts:11-15`).

---

## Pending / confirmation semantics
- Mempool txs sent in `transactions` with `confirmed:false`, no `block_height` → wallet shows **pending**.
- On confirmation, a later SYNC re-sends the tx with `block_height` set → client upgrades pending→confirmed by `txid`.
- Confirmations computed client-side: `tip.height - block_height + 1`. UI threshold (e.g. 1/3/6) is client policy, not wire.

## Gap-limit / expand flow (client-owned)
1. Client derives external+change to gap limit (default 20), sends as `addresses`.
2. Server reports (via `addresses` in CATCH_UP_COMPLETE / SYNC) which it saw used.
3. If the highest used index is within `gap_limit` of the client's max derived → client derives another window, **resubscribe** with larger `addresses`.
4. Mirrors `expandCredentialsIfNeeded` / `resubscribe(0, expanded)`.

## Field diff vs Cardano (quick ref)
| Field | Cardano | Bitcoin |
|---|---|---|
| subscribe id | `address`=stakeAddr + `credentials` | `address`=anchor + `addresses[]` |
| progress unit | slot/epoch | `height` |
| rollback | `rollback_to_slot` | `rollback_to_height` |
| tx body | `cbor`, `absolute_slot`, `epoch_no` | `vin`/`vout`, `block_height` |
| utxo | Nexus/YACI map (`unit`/`quantity`) | `{txid,vout,value,address,status}` |
| account | rewards/delegation | `balance`/`unconfirmed_balance`/`tx_count` |

## Resolved decisions
1. **Address types → ALL 3** (legacy/segwit/taproot). Client sends the union (see "Address types" above). Anchor = segwit external idx 0.
2. **`net`/`direction` → server-computed.** Server knows the wallet's address set from SUBSCRIBE, so it stamps `net` (satoshis, signed) and `direction` (`in`/`out`/`self`) on each `BtcTx`. Client renders directly, no vin/vout math.
3. **Reorg depth → server keeps last 100 tip hashes.** Detect via prev-hash mismatch / height regression against that window; emit `ROLLBACK`. Deeper than 100 (practically never) → `FORCE_RESYNC`. Wallet treats <6 confs as unconfirmed, so shallow reorgs are invisible to users.
4. **Registry multi-key → yes.** Session registered against the full `addresses` union; grows on resubscribe. Backend uses the secondary-index path (not N primary keys) — `AddressRegistry` change.
5. **ROLLBACK casing → snake_case.** `rollback_to_height` / `rollback_to_hash`. New BTC client rollback branch adopts snake_case (Cardano's camelCase `rollbackToSlot` untouched).
6. **Fee feed → out of this wire; served by Gero cluster.** Send-side fee rate comes from Gero's own cluster/backend (not on the sync WS, not from mempool.space). Separate cleanup: migrate `mempool-api.ts` fee fetch → the cluster fee endpoint. Tracked outside this contract.
