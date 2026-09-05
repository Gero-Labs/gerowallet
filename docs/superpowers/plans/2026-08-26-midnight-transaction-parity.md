# Midnight Transaction Parity (P3+) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring Midnight's transaction page and dashboard widget to Cardano-like quality — correct per-token amounts, a UTxO inputs/outputs view, and search/filter/sort.

**Architecture:** Midnight is a UTxO chain like Cardano, so the same shapes apply — but Cardano's `UtxosTable`/`UtxoDetail` take `Cardano.Utxo` tuples and format lovelace/ADA, so they are **not** reusable. We mirror their structure in the Midnight components instead. All work stays behind the existing chain branch at `Transactions.vue:7`.

**Base:** `feat/midnight-tokens` @ `3a7655c2`.

---

## Verified facts (2026-08-26)

| Fact | Evidence |
|---|---|
| Tx rows hardcode the token | `midnight-sync.service.ts` `buildTransaction` → `token: 'NIGHT'` |
| Amount counts NIGHT only | `sumOutputsForOwner` filters to native |
| Fee is always zero | `fee: 0n` — gero-sync does not forward the DUST fee |
| `isShielded` always false | hardcoded; per-address sub is unshielded-only |
| Counterparty blank on receives | a per-address subscription cannot see the sender |
| **Tx UTxOs are fetchable** | `GET {nexus}/api/midnight/midnight-mainnet/transactions/{hash}/utxos` → **401** (route exists, needs the wallet's device token), via `midnightApi.getTransactionUtxos()` |
| Cardano UTxO components unusable | `UtxosTable.vue:97,105` (`lovelace`, `Cardano.Utxo`), `UtxoDetail.vue:119,147` |
| Token metadata available | `midnightTokenMeta(color)` → `{name, symbol, decimals}` |

**Out of scope — blocked upstream:** the fee column. `fee: 0n` cannot be made honest without gero-sync forwarding the DUST fee. Do not invent one; render `—`.

---

### Task 1: Per-token transaction rows

Fixes a USDM receive displaying as `+0.00 NIGHT` — the wallet currently states something false about money.

**Files:** `src/chains/midnight/midnightTypes.ts`, `src/services/midnight-sync.service.ts`, `src/modules/dashboard/components/MidnightTransactionsCard.vue`, `src/modules/transactions/components/MidnightTransactionsList.vue`, test.

- [ ] **Step 1: Widen the type**

In `midnightTypes.ts`, `MidnightTransaction.token` becomes the token identity rather than a closed union:

```ts
  /**
   * What moved. Native NIGHT and DUST keep their names; anything else is the
   * 32-byte token color, resolved for display through midnightTokenMeta().
   */
  token: 'NIGHT' | 'DUST' | (string & {});
```

- [ ] **Step 2: Write the failing test**

Create `src/services/__tests__/midnightTxPerToken.test.ts`. It must drive the real `buildTransaction` path, not restate the filter — assert that a transaction whose created outputs carry ONLY the USDM color produces a row with `token` equal to that color and `amount` equal to the USDM value, and that a NIGHT-only transaction is unchanged. If `buildTransaction` is private, exercise it through the public sync entry point rather than making it public.

- [ ] **Step 3: Run it, confirm it FAILS** with the token coming back as `'NIGHT'` and amount `0n`.

- [ ] **Step 4: Emit one row per color**

In `buildTransaction`: replace the single NIGHT-only net-amount computation with a per-color one. For each color moved for our address, emit a row carrying that color and its net amount. Keep the existing send/receive classification and the `register_dust` special case. Remove the NIGHT-only filters in `sumOutputsForOwner` and in counterparty selection — counterparty should be chosen from outputs of the SAME color as the row.

- [ ] **Step 5: Display the symbol**

`MidnightTransactionsCard.vue`'s `currencySymbol()` widens: `NIGHT`/`DUST` keep their labels; any other value resolves via `midnightTokenMeta(color)?.symbol`, falling back to a head+tail truncation `${c.slice(0,8)}…${c.slice(-6)}`. Amounts divide by `midnightTokenMeta(color)?.decimals` when known; when unknown, show raw base units labelled as such — never guess an exponent. Apply the same in `MidnightTransactionsList.vue`.

- [ ] **Step 6: Verify** — `npx vitest run`, `npm run typecheck`, `npx eslint` on touched files, `node scripts/design/audit.mjs`, `node scripts/design/contrast.mjs`. Commit without `--no-verify`.

---

### Task 2: UTxO inputs/outputs detail

The "both are UTxOs" piece. Also fixes counterparty-on-receive, which the per-address subscription cannot supply but `spentOutputs` can.

**Files:** new `src/modules/transactions/components/MidnightTxUtxos.vue`, `MidnightTransactionsList.vue`, `src/api/midnight-api.ts` (already has `getTransactionUtxos`).

- [ ] **Step 1:** Expanding a row calls `midnightApi.getTransactionUtxos(hash)` **once**, cached per hash for the session. Loading and error states both render — an error must not collapse the row silently.
- [ ] **Step 2:** Render two columns, inputs (`spentOutputs`) and outputs (`createdOutputs`), mirroring `UtxosTable`'s visual structure. Per entry: owner (truncated head+tail), amount with symbol via `midnightTokenMeta`, and `intentHash:outputIndex`. Mark entries owned by this wallet.
- [ ] **Step 3:** Derive the counterparty for receives from `spentOutputs` owners that are not ours, and use it where the row currently shows nothing.
- [ ] **Step 4:** Verify and commit as Task 1.

**Constraint:** do not import `UtxosTable`/`UtxoDetail` — they are Cardano-typed (see facts table). Mirror the layout, not the code.

---

### Task 3: Search, filters, sort

**Files:** `MidnightTransactionsList.vue`, i18n.

- [ ] **Step 1:** Debounced search over tx hash, counterparty, and token symbol/color — follow the `debouncedUpdateSearch` pattern at `TransactionsCard.vue:568`.
- [ ] **Step 2:** Filter menu: date from/to, transaction type, token. Show an active-filter count, as `TransactionsCard.vue:632` does.
- [ ] **Step 3:** Sortable by time, amount, block height. Default newest-first, matching today's behaviour.
- [ ] **Step 4:** Every new user-facing string goes in BOTH `us.ts` and `de.ts` as flat dotted keys. Reuse existing keys where the text already exists — `common.clearFilters` exists.
- [ ] **Step 5:** Verify and commit.

---

## Definition of done

- [ ] A USDM receive reads `+10.00 USDM`, not `+0.00 NIGHT`.
- [ ] Expanding a transaction shows its inputs and outputs with per-token amounts.
- [ ] Receives show a counterparty.
- [ ] Search, filters and sort work on the Midnight list.
- [ ] Fee renders `—` everywhere; no fabricated fee.
- [ ] Every i18n key exists in both language files.
- [ ] Ratchet at or below budget; contrast 56/56; typecheck introduces no new errors.

## Manual verification

Tx `192c6cc53673737d1e066d6bd8889f0d618dea637f22ebcc5c302711064069d2` (block 2306712) — a 10 USDM receive to `mn_addr1aps70m4…z8j3za`. It must read as USDM, expand to show one created output of color `8c2c22bc…64e94b` value `10000000`, and name a counterparty.
