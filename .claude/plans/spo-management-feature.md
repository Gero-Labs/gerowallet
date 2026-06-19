# Staking Pool Operator (SPO) Management Feature

## Context

The user is a Cardano SPO currently managing their pool via guild-operators/cntools CLI. This feature brings pool management directly into Gero Wallet — a first-of-its-kind capability for a browser extension wallet. It covers the full pool lifecycle: registration, parameter updates, retirement, dashboard monitoring, and KES key rotation.

## SDK Types Confirmed

All required types exist in `@cardano-sdk/core` v0.46.11:

- **`Cardano.PoolRegistrationCertificate`** — `{ __typename: CertificateType.PoolRegistration, poolParameters: PoolParameters }`
- **`Cardano.PoolRetirementCertificate`** — `{ __typename: CertificateType.PoolRetirement, poolId, epoch }`
- **`Cardano.PoolParameters`** — `{ id, rewardAccount, pledge, cost, margin, metadataJson?, relays, owners, vrf }`
- **`Cardano.Relay`** — `RelayByAddress | RelayByName | RelayByNameMultihost`
- **Ledger** — `TransactionSigningMode.POOL_REGISTRATION_AS_OPERATOR` and `POOL_REGISTRATION_AS_OWNER` both supported

---

## Phase 1: Module Skeleton + Cold Key Management

### 1.1 New Module Structure

```
src/modules/pool-operator/
  PoolOperator.vue                     # Top-level view with tab navigation
  components/
    ColdKeySetup.vue                   # Import cold key or connect Ledger
    ColdKeySelector.vue                # Choose cold key source for signing
    PoolRegistrationForm.vue           # Pool params form
    PoolRetirementForm.vue             # Retirement epoch picker
    PoolDashboard.vue                  # Pool stats overview
    KesRotation.vue                    # KES key rotation workflow
    RelayEditor.vue                    # Add/edit/remove relay entries
    MetadataEditor.vue                 # Metadata URL + hash calculator
  dialogs/
    PoolConfirmDialog.vue              # Review & sign (reuses TransactionAuthSection)
    ImportColdKeyDialog.vue            # File import + encryption
    KesOutputDialog.vue                # Download KES files + op cert
```

### 1.2 Files to Modify

| File | Change |
|------|--------|
| `src/modules/navigation/router.ts` | Add `/pool-operator` route |
| `src/modules/navigation/components/NavigationDrawer.vue` | Add nav item (Cardano-only, `mdi-server-network` icon) |
| `src/plugins/i18n/us.ts` + `de.ts` | Add `poolOperator.*` translation keys |
| `src/shared/composables/useFeatureNotifications.ts` | Add `navigation.poolOperator` feature |

### 1.3 Cold Key Management

**Software cold key (imported `cold.skey` file):**
- Parse Cardano CLI TextEnvelope JSON: `{ type: "StakePoolSigningKey_ed25519", cborHex: "5820..." }`
- Extract 32-byte Ed25519 private key from CBOR
- Encrypt with `encryptWithPassword()` from `src/shared/utils/crypto.ts` (ChaCha20-Poly1305, same as wallet keys)
- Store in wallet's IndexedDB config table: `{ key: 'spo_encryptedColdKey', value: hexEncrypted }`
- Derive cold verification key hash → this IS the Pool ID
- Also store: `spo_coldKeyHash`, `spo_coldKeySource: 'imported'`

**Ledger cold key:**
- Path: `m/1853'/1815'/0'/0'` (CIP-1853)
- Retrieve extended public key via Ledger API during setup
- Derive Pool ID from public key hash
- Store: `spo_coldKeyHash`, `spo_coldKeySource: 'ledger'`, `spo_ledgerKeyPath`
- Signing uses `TransactionSigningMode.POOL_REGISTRATION_AS_OPERATOR`

**VRF key (imported from node):**
- User imports `vrf.vkey` file (TextEnvelope with VRF verification key)
- Extract VRF vkey hash (`VrfVkHex`)
- Store: `spo_vrfKeyHash` in config table
- This is a public key — no encryption needed

### 1.4 Store

New file: `src/stores/poolOperatorStore.ts` (Vue Observable, follows existing pattern)

```typescript
interface PoolOperatorState {
  coldKeySource: 'none' | 'imported' | 'ledger';
  coldKeyHash: string | null;        // Ed25519KeyHash — also the Pool ID
  vrfKeyHash: string | null;         // VrfVkHex from node
  poolId: string | null;             // Bech32 pool ID
  isRegistered: boolean;
  isRetiring: boolean;
  retirementEpoch: number | null;
  registeredParams: PoolParameters | null;  // Current on-chain params
  kesCounter: number;
  kesExpiry: number | null;
  loading: boolean;
  error: string | null;
}
```

No DB schema migration needed — reuse existing `config` table with `spo_*` prefixed keys.

---

## Phase 2: Pool Registration + Certificate Building

### 2.1 New Composable: `src/shared/composables/usePoolRegistration.ts`

Pattern follows `useDelegation.ts`:

```typescript
export function usePoolRegistration() {
  // Build PoolRegistrationCertificate from form params
  // Certificate: { __typename: CertificateType.PoolRegistration, poolParameters: { ... } }
  //
  // For NEW pool: implicitCoin.deposit = epochParams.stakePoolDeposit (500 ADA)
  // For UPDATE:   implicitCoin.deposit = 0n (no additional deposit)
  //
  // Calls buildCardanoTransaction() with certificate
  // Returns: tx, fee, buildTx(), isUpdate flag
}
```

**PoolParameters construction:**
- `id` — `Cardano.PoolId(bech32PoolId)` derived from cold key hash
- `rewardAccount` — wallet's reward/stake address
- `pledge` — user input (lovelace), validated >= 0
- `cost` — user input (lovelace), validated >= `epochParams.minPoolCost` (170 ADA)
- `margin` — user input as percentage, converted to `Fraction { numerator, denominator }`
- `relays` — array of `Relay` from RelayEditor
- `owners` — array of `RewardAccount` (at minimum: the wallet's stake address)
- `vrf` — `VrfVkHex` from imported VRF key
- `metadataJson` — `{ url: string, hash: Hash32ByteBase16 }` computed from metadata URL

### 2.2 New Composable: `src/shared/composables/usePoolRetirement.ts`

```typescript
// Certificate: { __typename: CertificateType.PoolRetirement, poolId, epoch }
// epoch validated: currentEpoch + 1 <= epoch <= currentEpoch + eMax
// implicitCoin.deposit = -epochParams.stakePoolDeposit (500 ADA returned)
```

### 2.3 Extend Signature Analysis

In `src/shared/utils/resolver.ts` — `analyzeTransactionForSignatures()`:

Add cases for `CertificateType.PoolRegistration` and `CertificateType.PoolRetirement`:
- PoolRegistration → requires: payment key (fee), owner stake keys, cold key (separate)
- PoolRetirement → requires: payment key (fee), cold key (separate)

Cold key signature is NOT added to the standard `requiredSigners` array (it's outside the wallet's HD derivation tree). Instead, flag it as `requiresColdKeySignature: true` in the return.

---

## Phase 3: Multi-Witness Signing (Cold Key + Wallet Keys)

### 3.1 New Background Handler

Add `MessageTypes.SIGN_TX_WITH_POOL_KEYS` to `src/models/MessageTypes.ts`.

New handler in `background.ts`:

```typescript
app.addToOptions(MessageTypes.SIGN_TX_WITH_POOL_KEYS, async (request, sendResponse) => {
  // 1. Sign with wallet keys (payment + stake) via existing signTx()
  // 2. Decrypt cold key from config table using spending password
  // 3. Sign tx hash with cold key (Ed25519)
  // 4. Merge cold key witness into witness set
  // 5. Return combined witnesses
});
```

### 3.2 Ledger Pool Signing

For Ledger cold keys, the existing `ledgerUtils.ts` needs extension:
- Use `TransactionSigningMode.POOL_REGISTRATION_AS_OPERATOR`
- Pass pool registration params to Ledger device
- Ledger signs with cold key at `m/1853'/1815'/0'/0'`
- May need two Ledger interactions: one for cold key, one for payment/stake keys
- The `@cardano-foundation/ledgerjs-hw-app-cardano` library handles this natively

### 3.3 New Composable: `src/shared/composables/usePoolSigning.ts`

Wraps `useTransactionSigning` with additional cold key witness logic:
- For software cold key: calls `SIGN_TX_WITH_POOL_KEYS` message
- For Ledger: uses Ledger pool signing mode
- Handles the combined witness merging

---

## Phase 4: Pool Dashboard

### 4.1 PoolDashboard.vue

Displays for a registered pool:
- Pool ID, ticker, name, description
- Current params: pledge, cost, margin
- Live pledge vs declared pledge (pledge met?)
- Live stake, active stake, saturation %
- Delegator count
- Block production history (epoch chart)
- KES key period + expiry countdown
- Retirement status/countdown if retiring
- Reward history per epoch

### 4.2 API

Existing `blockchain-api.ts` already has `getPoolById()` — use this for pool info.

May need additional backend endpoints for:
- Pool epoch history (blocks produced per epoch)
- Pool reward history

These can be deferred — start with what Blockfrost/Koios provides directly.

---

## Phase 5: KES Key Rotation (Offline)

### 5.1 Workflow

No on-chain transaction — purely cryptographic:

1. User provides current KES period (from node) and confirms counter
2. Wallet generates new Ed25519 KES keypair
3. Wallet builds operational certificate payload:
   - KES verification key
   - Cold key verification key
   - Counter (incremented)
   - KES period
4. Signs op cert with cold key

**Software cold key**: Decrypt, sign, clear from memory
**Ledger cold key**: Ledger Cardano app does NOT support op cert signing (only tx signing). Show instructions to sign with `cardano-cli` on the air-gapped machine. Provide: the unsigned op cert payload + instructions.

5. Output downloadable files: `kes.skey`, `kes.vkey`, `node.cert`

### 5.2 Key Generation

Use `@noble/ed25519` (already available via `@noble/hashes`) for KES keypair generation. The KES key is a standard Ed25519 key — Cardano's KES scheme at the wallet level is just about rotating which key the op cert binds to.

---

## Phase 6: UI Components

### PoolOperator.vue (top-level)

Tab-based layout:
- **Dashboard** — pool status (or "Setup" if no cold key)
- **Register/Update** — registration form (switches label based on `isRegistered`)
- **Retire** — retirement form (only if registered)
- **KES Rotation** — KES key management

### PoolRegistrationForm.vue

Form fields:
- Pledge amount (ADA input, validated >= 0)
- Fixed cost (ADA input, validated >= 170 ADA / `minPoolCost`)
- Margin % (0-100, step 0.01)
- Reward account (auto-filled from wallet, editable)
- Owners (list, wallet's stake addr auto-added, can add more)
- VRF key hash (imported from file or pasted)
- Relays (via RelayEditor sub-component)
- Metadata URL + computed hash (via MetadataEditor sub-component)

### RelayEditor.vue

Add/remove relay entries. Each entry has a type selector:
- **DNS** — hostname + port
- **IPv4** — IP address + port
- **IPv6** — IP address + port
- **SRV** — DNS name only

### MetadataEditor.vue

- URL input (max 64 chars)
- "Fetch & Hash" button — fetches JSON from URL, computes Blake2b-256 hash
- Or: paste JSON directly for offline hash computation
- Displays computed hash
- Validates JSON format (name, ticker, description, homepage; <= 512 bytes)

### ColdKeySetup.vue

First-time setup flow:
1. Choose: Import software key OR Connect Ledger
2. **Import**: file picker for `cold.skey`, enter spending password to encrypt
3. **Ledger**: connect device, retrieve public key at `m/1853'/1815'/0'/0'`
4. Also import VRF key (`vrf.vkey` file)
5. Derive and display Pool ID

### PoolConfirmDialog.vue

Reuses `TransactionAuthSection` component pattern:
- Shows transaction summary (certificate type, params, fee, deposit)
- Password input / PRF auth / Ledger signing
- Submit button

---

## Implementation Order

| Step | What | Key Files |
|------|------|-----------|
| 1 | Module skeleton + route + nav item | `src/modules/pool-operator/`, `router.ts`, `NavigationDrawer.vue` |
| 2 | Pool operator store + DB config keys | `src/stores/poolOperatorStore.ts` |
| 3 | Cold key import + encryption + VRF import | `ColdKeySetup.vue`, `ImportColdKeyDialog.vue` |
| 4 | Pool registration composable + certificate building | `usePoolRegistration.ts` |
| 5 | Extend `analyzeTransactionForSignatures()` | `src/shared/utils/resolver.ts` |
| 6 | Multi-witness signing (cold key + wallet keys) | `background.ts`, `walletBg.ts`, `usePoolSigning.ts` |
| 7 | Registration form UI + confirm dialog | `PoolRegistrationForm.vue`, `PoolConfirmDialog.vue` |
| 8 | Pool update (same form, pre-populated, no deposit) | `usePoolRegistration.ts` update mode |
| 9 | Pool retirement composable + UI | `usePoolRetirement.ts`, `PoolRetirementForm.vue` |
| 10 | Pool dashboard | `PoolDashboard.vue`, `blockchain-api.ts` |
| 11 | Ledger pool signing integration | `ledger.ts` extension |
| 12 | KES rotation (offline crypto) | `KesRotation.vue`, `useKesRotation.ts` |
| 13 | i18n (us.ts + de.ts) + feature notifications | `us.ts`, `de.ts`, `useFeatureNotifications.ts` |

---

## Verification

1. **Cold key import**: Import a test `cold.skey`, verify encryption/decryption roundtrip, verify derived Pool ID matches `cardano-cli`
2. **Pool registration**: Build registration tx on Preprod testnet, verify CBOR matches expected format, submit and confirm on-chain
3. **Pool update**: Modify params, verify no additional deposit charged, confirm on-chain
4. **Pool retirement**: Set retirement epoch, verify constraints (epoch range), submit on-chain
5. **Dashboard**: Verify pool stats match Cardanoscan/PoolTool for the registered pool
6. **KES rotation**: Generate KES keys + op cert, verify op cert is valid using `cardano-cli node key-gen-KES` comparison
7. **Ledger**: Test pool registration signing with Ledger on Preprod, verify both signing modes work
8. **Hardware wallet**: Test that KES rotation correctly shows Ledger limitation message
