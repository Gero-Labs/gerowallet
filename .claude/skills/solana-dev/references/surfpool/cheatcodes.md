---
title: Surfpool Cheatcodes
description: Full reference for all surfnet_* RPC methods to manipulate time, accounts, and programs in a local Surfpool network during testing.
---

# Surfpool Cheatcodes Reference

All 28 `surfnet_*` JSON-RPC methods available on the surfnet RPC endpoint (default `http://127.0.0.1:8899`), as of Surfpool v1.6.1. v1.6.0 added the two confidential-balance methods; nothing was removed or renamed since v1.5.0.

In TypeScript, call these through `client.cheatcodes` from the Kit plugin instead of hand-rolling JSON-RPC — method names drop the `surfnet_` prefix and responses arrive unwrapped. See [kit-plugin.md](kit-plugin.md#typed-cheatcodes). The schemas below are the wire format, shared by both paths.

## Account Manipulation

| Method | Description |
|---|---|
| `surfnet_setAccount` | Set or update an account's lamports, data, owner, and executable status directly without transactions. |
| `surfnet_setTokenAccount` | Set or update an SPL token account's balance, delegate, state, and close authority for any mint. Since v1.6.0 it can also set confidential-transfer state on Token-2022 accounts. |
| `surfnet_resetAccount` | Reset an account to its original state from the remote datasource. Optionally cascades to owned accounts. |
| `surfnet_streamAccount` | Register an account for live streaming — re-fetches from remote datasource on every access instead of caching. |
| `surfnet_streamAccounts` | Register multiple accounts for live streaming in a single call. |
| `surfnet_getStreamedAccounts` | List all accounts currently registered for streaming. |
| `surfnet_offlineAccount` | Pin an account as local-only — it is never re-fetched from the remote datasource. |

## Confidential Balances (v1.6.0+)

| Method | Description |
|---|---|
| [`surfnet_deriveConfidentialKeys`](#surfnet_deriveconfidentialkeys) | Derive an owner's confidential-transfer keys from the owner's signature. Returns base58 `elgamalPubkey` (for `surfnet_setTokenAccount`), `elgamalSecretKey` (for `surfnet_getConfidentialBalance`), and `aesKey` (for both), so a test needs no client-side ZK crypto. |
| [`surfnet_getConfidentialBalance`](#surfnet_getconfidentialbalance) | Decrypt a Token-2022 confidential account's `available` and `pending` balances with the supplied `aesKey` / `elgamalSecretKey`. Also returns `pendingBalanceCreditCounter`; non-zero means an `ApplyPendingBalance` is still needed. |

## Program Management

| Method | Description |
|---|---|
| `surfnet_cloneProgramAccount` | Clone a program and its program data account from one address to another. Useful for forking programs. |
| `surfnet_setProgramAuthority` | Change or remove the upgrade authority on a program's ProgramData account. |
| `surfnet_writeProgram` | Deploy program data in chunks at a byte offset, bypassing transaction size limits (up to 5MB RPC limit). |
| `surfnet_registerIdl` | Register an Anchor IDL for a program in memory, enabling parsed account data in responses. |
| `surfnet_getActiveIdl` | Retrieve the registered IDL for a program at a given slot. Returns null if none registered. |

## Time Control

| Method | Description |
|---|---|
| `surfnet_timeTravel` | Jump the network clock to a specific UNIX timestamp, slot, or epoch. Useful for testing time-dependent logic. |
| `surfnet_pauseClock` | Freeze slot advancement and block production. Network stays at current slot until resumed. |
| `surfnet_resumeClock` | Resume slot advancement and block production after a pause. |

## Transaction Profiling

| Method | Description |
|---|---|
| `surfnet_profileTransaction` | Dry-run a transaction and return CU estimates, logs, errors, and before/after account state snapshots. |
| `surfnet_getTransactionProfile` | Retrieve a stored transaction profile by signature or UUID. |
| `surfnet_getProfileResultsByTag` | Retrieve all profiling results grouped under a tag. Useful for benchmarking test suites. |

## Network State

| Method | Description |
|---|---|
| `surfnet_setSupply` | Override what `getSupply` returns — total, circulating, and non-circulating amounts. |
| `surfnet_resetNetwork` | Reset the entire network to its initial state. All accounts revert to their original remote state. |
| `surfnet_getLocalSignatures` | Get recent transaction signatures with logs and errors. Defaults to last 50. |
| `surfnet_getSurfnetInfo` | Get network info including runbook execution status and configuration. |
| `surfnet_exportSnapshot` | Export account state as JSON — the whole network, or the **pre-execution state of a specific transaction** (for deterministic offline LiteSVM/Mollusk fixtures). Reload with `surfpool start --snapshot ./export.json`. See [full parameters below](#surfnet_exportsnapshot). |

## Scenarios

| Method | Description |
|---|---|
| `surfnet_registerScenario` | Register a scenario with timed account overrides using templates (e.g. Pyth price feeds, Raydium pools). |

## Meta / Control

| Method | Description |
|---|---|
| `surfnet_enableCheatcode` | Re-enable previously disabled cheatcodes. Takes a list of method entries, e.g. `[["surfnet_setAccount", ...]]`. |
| `surfnet_disableCheatcode` | Disable specific cheatcodes at runtime. Same parameter shape. A lockout mechanism prevents re-enabling once locked. |

---

## Parameter Examples

Verified JSON-RPC shapes for the most common cheatcodes.

### surfnet_setAccount

`["<pubkey>", {"lamports"?, "data"? (base58 string or byte array), "owner"?, "executable"?, "rent_epoch"?}]`

```bash
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_setAccount","params":["<PUBKEY>",{"lamports":10000000000,"owner":"11111111111111111111111111111111"}]}'
```

### surfnet_setTokenAccount

`["<owner>", "<mint>", {"amount"?, "delegate"?, "state"?, "delegatedAmount"?, "closeAuthority"?, "confidential"?}, token_program?]`

Field names are camelCase; snake_case keys are ignored. `delegate` and `closeAuthority` take a base58 pubkey, or the string `"null"` to clear it.

`confidential` (Token-2022 only, v1.6.0+) fabricates a configured — and optionally funded — `ConfidentialTransferAccount` extension, skipping the configure / deposit / apply-pending-balance instruction flow:

| Field | Required | Default | Meaning |
|---|---|---|---|
| `elgamalPubkey` | yes | — | Owner's ElGamal public key, base58 or base64, 32 bytes. The balance is encrypted to it |
| `aesKey` | yes | — | Owner's AES key, base58 or base64, 16 bytes. Produces `decryptable_available_balance`; needed even for a zero-balance account |
| `amount` | no | `0` | Confidential available balance |
| `approved` | no | `true` | Account approved for confidential transfers |
| `allowConfidentialCredits` | no | `true` | Accepts incoming confidential credits |
| `allowNonConfidentialCredits` | no | `true` | Accepts incoming non-confidential credits |
| `maximumPendingBalanceCreditCounter` | no | `65536` | Pending-balance credit counter cap |

```bash
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_setTokenAccount","params":["<OWNER>","<MINT>",{"amount":1000000000,"state":"initialized"}]}'
```

### surfnet_deriveConfidentialKeys

`["<signature>"]` — the owner's 64-byte signature, base58 or base64, over `"solana-conf-bal/v1"` followed by the seed bytes. The seed is normally the token account address, which scopes the keys to that account. Only the signature crosses the wire, never the signing key, so hardware signers work. Keys come from the same HKDF-SHA512 derivation as `solana_zk_sdk::encryption::derivation::derive_confidential_keys`.

Returns `{elgamalPubkey, elgamalSecretKey, aesKey}`, all base58.

### surfnet_getConfidentialBalance

`["<token_account>", {"aesKey"?, "elgamalSecretKey"?}]` — at least one key is required. `aesKey` (16 bytes) decrypts `available`; `elgamalSecretKey` (32 bytes, the *secret* key, not the account's public key) decrypts `pending`. Both accept base58 or base64.

Returns `{available, pending, pendingBalanceCreditCounter}`. A balance is `null` when its key was not supplied, and a non-zero counter means an `ApplyPendingBalance` is still needed.

**Round trip** (Token-2022 mint with the confidential-transfer extension). `surfnet_setTokenAccount` writes the owner's associated token account for the given token program, so `<TOKEN_ACCOUNT>` is that ATA. Use its address as the seed when you sign locally, then derive, fund, and read back:

```bash
# 1. Derive keys from the owner's signature over "solana-conf-bal/v1" || <TOKEN_ACCOUNT> bytes
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_deriveConfidentialKeys","params":["<SIGNATURE>"]}'

# 2. Create the token account with 1000 confidential tokens, using elgamalPubkey + aesKey from step 1
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_setTokenAccount","params":["<OWNER>","<MINT>",{"confidential":{"elgamalPubkey":"<ELGAMAL_PUBKEY>","aesKey":"<AES_KEY>","amount":1000}},"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]}'

# 3. Decrypt it, using aesKey + elgamalSecretKey from step 1
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getConfidentialBalance","params":["<TOKEN_ACCOUNT>",{"aesKey":"<AES_KEY>","elgamalSecretKey":"<ELGAMAL_SECRET_KEY>"}]}'
# → {"available":1000,"pending":0,"pendingBalanceCreditCounter":0}
```

In TypeScript the same calls are `client.cheatcodes.deriveConfidentialKeys(...)`, `client.cheatcodes.setTokenAccount(...)`, and `client.cheatcodes.getConfidentialBalance(...)`.

### surfnet_timeTravel

`[{"absoluteTimestamp": u64} | {"absoluteSlot": u64} | {"absoluteEpoch": u64}]` — returns the resulting `EpochInfo`.

```bash
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_timeTravel","params":[{"absoluteSlot":250000000}]}'
```

### surfnet_profileTransaction

`[base64 VersionedTransaction, tag?, config?]` — simulates without committing; returns CU consumption plus pre/post account snapshots.

```bash
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_profileTransaction","params":["<BASE64_TX>","my-benchmark-tag"]}'
```

### surfnet_exportSnapshot

One of the most useful cheatcodes. `[config?]` — returns a map of base58 pubkey → account snapshot.

```ts
{
  includeParsedAccounts?: boolean,      // include parsed account data
  scope?: "network"                     // default: every account in the surfnet
        | { preTransaction: "<signature>" },  // pre-execution state of an executed tx
  filter?: {
    includeProgramAccounts?: boolean,
    includeAccounts?: string[],         // always included (bypasses exclusions)
    excludeAccounts?: string[],         // takes precedence
    excludeSysvars?: boolean,           // omit sysvar-owned accounts (v1.4.0+)
    excludeFeatureGates?: boolean,      // omit known agave feature-gate accounts (v1.4.0+)
  },
}
```

**Whole-network snapshot** — export, then reload on next start:

```bash
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_exportSnapshot","params":[{"filter":{"excludeSysvars":true,"excludeFeatureGates":true}}]}' \
  > snapshot.json
surfpool start --snapshot ./snapshot.json
```

**Pre-execution state of a transaction** — after a transaction has executed on the surfnet, pass its signature with the `preTransaction` scope to get the state of every account it touched *as it was before execution* (writable accounts from the pre-execution capture, plus readonly account states):

```bash
curl -X POST http://127.0.0.1:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_exportSnapshot","params":[{"scope":{"preTransaction":"<TX_SIGNATURE>"}}]}' \
  > fixtures/swap-pre-state.json
```

This turns any real transaction (including one against forked mainnet state) into a **deterministic, offline fixture**: load the exported accounts into LiteSVM (`svm.setAccount(...)` / `set_account(...)`) or Mollusk account tuples and replay the instruction in a unit test — no network, no fork, byte-identical inputs on every run.

Other shapes at a glance:

- `surfnet_cloneProgramAccount`: `[source_program_id, destination_program_id]`
- `surfnet_writeProgram`: `[program_id, data_chunk, offset, authority?]`
- `surfnet_streamAccount`: `["<pubkey>", {"includeOwnedAccounts": true}?]`
- `surfnet_pauseClock` / `surfnet_resumeClock`: `[]`
- `surfnet_registerScenario`: `[Scenario{id, name, description, overrides: [{id, templateId, values, scenarioRelativeSlot, label, enabled, fetchBeforeUse, account: {pubkey|pda}}], tags}, baseSlot?]` — e.g. `templateId: "pyth_btcusd"`, `values: {"price_message.price_value": 67500}`; use `scenarioRelativeSlot` to schedule oracle overrides on a slot timeline and `fetchBeforeUse` to refresh live oracle data before applying overrides

---

## Surfpool MCP Server

For MCP server setup, available tools, resources, and agent workflows, see the [MCP Integration section in overview.md](overview.md#mcp-integration).
