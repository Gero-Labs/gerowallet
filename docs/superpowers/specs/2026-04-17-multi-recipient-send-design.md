# Multi-Recipient Send — Design Spec

**Date:** 2026-04-17  
**Status:** Approved  
**Trigger:** Need to fund Nexus collateral hot wallet with 20 × 5 tADA UTxOs in one transaction; general feature for all users.

---

## Goal

Extend the Send Dialog to support multiple recipients in a single Cardano transaction. Each recipient has a full independent asset selection (ADA + tokens + NFTs). The experience stays simple for beginners — the default single-recipient flow is visually identical to the current one.

---

## Scope

- Cardano wallets only (ADA + native tokens + NFTs)
- ADA handle resolution on **Cardano Mainnet only**
- Full multi-asset support per recipient
- Fees handled transparently — never shown during recipient entry, only in Summary
- "Set Max" works correctly across multiple recipients
- Duplicate recipient card for bulk identical outputs (e.g. 20 × 5 ADA to same address)

**Out of scope:**
- Bitcoin or other non-Cardano chains
- Saved recipient templates / address book batch import
- CSV import of recipients

---

## Data Model

### `SendRecipient` (new type in `send-flow.types.ts`)

```typescript
export interface SendRecipient {
  id: string                                          // uuid — stable v-for key
  address: string                                     // raw input (address or $handle)
  resolvedAddress: string | null                      // handle-resolved address; null if plain address or unresolved
  selectedTokens: SendToken[]                         // first entry is always ADA (locked, cannot remove)
  selectedCollectibles: Record<string, Collectible & { unit: string }>
  minAda: number                                      // min ADA for this output (recalculated when assets change)
  adaShortage: number                                 // > 0 means insufficient ADA on this card
}
```

### Updated `sendData`

```typescript
{
  recipients: SendRecipient[]   // replaces recipientAddress + selectedTokens + selectedCollectibles
  selectedWallet: Wallet
}
```

`recipients` always contains at least one entry. Dialog initialises with one empty recipient.

---

## Component Architecture

```
SendDialog.vue                         ← orchestrator; owns recipients[]; builds tx
  ├── SendRecipientCard.vue            ← NEW; one instance per recipient
  │     ├── address field              ← handle resolution (mainnet Cardano only)
  │     ├── contact lookup / QR scan   ← unchanged behaviour
  │     ├── duplicate button           ← copies raw address/handle + all assets to new card below
  │     ├── delete button              ← hidden when only 1 card
  │     └── AssetsToSendStep.vue       ← reused inline; receives per-card props (see below)
  ├── "+ Add another recipient" link   ← always at bottom of recipient list, after all cards
  └── SummaryStep.vue                  ← extended; lists all recipients; single fee line
```

### Files changed

| File | Change |
|------|--------|
| `src/models/send-flow.types.ts` | Add `SendRecipient` interface; update `sendData` type |
| `src/modules/dashboard/dialogs/SendDialog.vue` | Stepper 3→2 steps; own `recipients[]`; aggregate outputs; updated build watch |
| `src/modules/dashboard/components/SendRecipientCard.vue` | **New** — address field + inline AssetsToSendStep + duplicate/delete |
| `src/modules/dashboard/components/AssetsToSendStep.vue` | Accept per-card props instead of global sendData |
| `src/modules/dashboard/components/SummaryStep.vue` | Loop over recipients; single fee line |
| `src/plugins/i18n/us.ts` | Add new keys |
| `src/plugins/i18n/de.ts` | Add German translations |

### Files NOT changed

- `src/shared/utils/builder.ts` — already accepts `outputs: Cardano.TxOut[]`
- `src/shared/composables/useTransactionSigning.ts`
- All hardware wallet flows (Ledger, Trezor, Keystone)
- `src/modules/dashboard/components/SendRecipientDetailsStep.vue` — kept for any other consumers; not deleted

---

## Stepper

| Step | Label | Content |
|------|-------|---------|
| 1 | Recipients | All `SendRecipientCard` instances + "+ Add another recipient" link |
| 2 | Summary | Per-recipient output list + single network fee line + auth |

Previous Step 2 (Assets) is absorbed into each recipient card. Previous Step 3 (Summary) becomes Step 2.

---

## Recipient Card States

| State | Behaviour |
|-------|-----------|
| Empty | Address field shown; assets section hidden |
| Address typed — invalid | Inline validation error; assets section stays hidden |
| Address valid (first card) | Assets section expands inline |
| Address valid (2+ cards) | Same; delete button visible on all cards |
| Collapsed | Displays truncated address + total value chip + edit icon; clicking re-expands this card and collapses all others |
| Duplicate | Copies raw `address` field (preserves `$handle` string, not resolved address) + all assets to a new card inserted immediately below; new card starts expanded; current card collapses |

### Card collapse rule

A card auto-collapses when **both** conditions are met:
1. Its address is valid (or handle is resolved)
2. The user interacts with a different card (clicks its address field or clicks "+ Add another recipient")

Only one card is expanded at a time when 2+ cards exist. Clicking a collapsed card re-expands it and collapses all others. When navigating **back** from Summary to Recipients, all cards are restored exactly as left — no re-validation triggered, no cards force-collapsed.

---

## ADA Handle Resolution

- Enabled **only** when `loggedWallet.chain === 'Cardano'` AND `loggedWallet.network === 'mainnet'`
- On Preprod, testnet, or non-Cardano chains: handle hint text and `$` prefix resolution are hidden; plain address input only
- Each card resolves its own handle independently
- `resolvedAddress` is set on successful resolution; `address` retains the raw `$handle` input

---

## Transaction Building

### Aggregation

```typescript
const outputs: Cardano.TxOut[] = recipients
  .filter(r => r.resolvedAddress || isValidAddress(r.address))
  .map(r => buildTxOut(
    r.resolvedAddress ?? r.address,
    r.selectedTokens,
    r.selectedCollectibles
  ))
```

`buildCardanoTransaction(outputs)` is called once with all outputs — no changes to `builder.ts`.

### Build watch

- Deep-watches `recipients` array (addresses + tokens + collectibles)
- Debounced 300ms
- Fires only when every card has a valid address — skips partial builds
- Single fee returned; stored in existing `fee` ref; shown only in Summary

### Set Max

- "Set Max" on recipient N: locks all other recipients' ADA amounts + estimated fee, assigns remainder to recipient N's ADA field
- If remainder ≤ 0: field shows 0; balance error surfaces on that card
- Existing binary-search algorithm in `AssetsToSendStep.vue` is reused; it receives the locked amount as an `otherRecipientsAda` prop
- Only one card can be in "Set Max" mode at a time — triggering Set Max on a second card is independent and does not reset the first

### `AssetsToSendStep.vue` props (updated)

| Prop | Type | Description |
|------|------|-------------|
| `selectedTokens` | `SendToken[]` | This card's token list (was from global `sendData`) |
| `selectedCollectibles` | `Record<string, Collectible>` | This card's collectibles (was from global `sendData`) |
| `otherRecipientsAda` | `bigint` | Sum of ADA committed by all other cards; used by Set Max binary search |
| `excludedAssets` | `Set<string>` | Unit IDs already fully committed by other cards; greyed out or capped in picker |
| `wallet` | `Wallet` | Source wallet (unchanged) |
| `fiatRates` | `object` | Price data (unchanged) |

`excludedAssets` prevents double-spending of NFTs and fully-allocated fungible tokens across cards. A token is excluded when another card has already allocated its entire wallet balance. Partially allocated tokens are not excluded — they show a reduced available quantity.

### Tx size guard

When `builder.ts` throws a size/weight error, surface as:

> *"Too many recipients or assets for one transaction. Remove a recipient or reduce assets."*

i18n key: `wallet.tooManyRecipients`

---

## Validation Gate (Step 1 → Step 2)

"Continue" is disabled until ALL of:
- Every card has a valid resolved address
- Every card has at least one token with `quantity > 0`
- No card has `adaShortage > 0`
- Total ADA across all recipients ≤ wallet balance (fee included)

---

## Fee Display

- Fee is **never shown** during recipient entry (Step 1)
- Fee appears once in Summary (Step 2): "Network fee: X ADA"
- Total from wallet = sum of all recipients' ADA + fee

---

## i18n Keys

| Key | English | German |
|-----|---------|--------|
| `wallet.recipients` | Recipients | Empfänger |
| `wallet.addAnotherRecipient` | + Add another recipient | + Weiteren Empfänger hinzufügen |
| `wallet.recipient` | Recipient | Empfänger |
| `wallet.duplicateRecipient` | Duplicate recipient | Empfänger duplizieren |
| `wallet.removeRecipient` | Remove recipient | Empfänger entfernen |
| `wallet.tooManyRecipients` | Too many recipients or assets for one transaction. Remove a recipient or reduce assets. | Zu viele Empfänger oder Assets für eine Transaktion. Bitte Empfänger oder Assets reduzieren. |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Invalid address on any card | Inline error on that card; Continue disabled |
| Handle not found (mainnet only) | Inline error on that card; Continue disabled |
| Card ADA shortage | Red warning on that card; Continue disabled |
| Total exceeds balance | Balance error shown below recipient list; Continue disabled |
| Tx size exceeded | Builder error surfaced as `wallet.tooManyRecipients` toast/alert |
| Nexus / network error during build | Existing error handling in `SendDialog.vue` unchanged |

---

## Sidepanel variant (`SendSheet.vue`)

Out of scope for this iteration. `SendSheet.vue` remains single-recipient.
