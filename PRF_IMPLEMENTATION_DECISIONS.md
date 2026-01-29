# PRF Implementation - Final Decisions

## Overview
Implement hardware-backed PRF encryption for **NEW wallets only** with full backward compatibility.

---

## Final Decisions

### 1. Overall Approach ✅
**Decision**: PRF encryption for new wallets only, NO migration of existing wallets

**Rationale**:
- Non-breaking change
- Users can try PRF with new wallets
- Existing wallets remain secure with current encryption
- Gradual adoption path

---

### 2. Wallet ID Allocation ✅
**Decision**: Option A - Pre-allocate wallet ID before encryption

**Implementation**:
```typescript
// Query max ID and pre-allocate
const maxId = await db.wallets.orderBy('id').last();
const newWalletId = (maxId?.id || 0) + 1;

// Use pre-allocated ID for PRF encryption
const prfEncryptedKey = await encryptPrivateKeyWithPrf(
  rootKey.bytes(),
  credentialId,
  newWalletId  // Known before insert
);

// Insert with known ID (IndexedDB allows this)
await db.wallets.add({
  id: newWalletId,
  // ... rest of wallet data
});
```

**Rationale**: Simplest and most reliable approach

---

### 3. Mnemonic Backup Strategy ✅
**Decision**: Option B - Optional backup (user's choice)

**Implementation**:
- Show warning during PRF wallet creation about device loss
- Allow user to skip backup (trust hardware only)
- Provide "Backup Mnemonic" option in settings later
- Recommend backup for disaster recovery

**User Flow**:
```
┌─────────────────────────────────────────┐
│  Create PRF Wallet                      │
├─────────────────────────────────────────┤
│                                         │
│  ⚠️  Important: Device Loss Recovery   │
│                                         │
│  Your wallet is protected by your      │
│  device's biometric authentication.    │
│                                         │
│  If you lose your device, you'll need  │
│  your mnemonic phrase to recover.      │
│                                         │
│  ☐ Save mnemonic phrase now            │
│  ☐ I'll save it later (risky)          │
│                                         │
│  [Cancel]  [Continue]                   │
└─────────────────────────────────────────┘
```

**Rationale**: User freedom while recommending best practice

---

### 4. Spending Password for PRF Wallets ✅
**Decision**: Option B - Optional spending password **ALIGNED WITH LOCK SETTINGS**

**Rules**:
1. **If "Password Unlock" method is enabled in LockSettings**:
   - Spending password is **REQUIRED**
   - Same password used for:
     - Wallet unlock (via password method)
     - Extra verification for sensitive operations
     - Fallback if biometric fails

2. **If ONLY "PassKey Unlock" method is enabled**:
   - Spending password is **OPTIONAL**
   - If not set, pure biometric mode
   - Can be set later if user enables password unlock

**Database Schema**:
```typescript
wallets {
  encryptionMethod: 'password' | 'prf',
  prfSpendingPassword?: string,  // NEW: Optional password hash (for PRF wallets)
  // ... other fields
}

wallet-{id}.config {
  passwordUnlockEnabled: boolean,  // Existing
  passkeyUnlockEnabled: boolean    // Existing
}
```

**Implementation Logic**:
```typescript
// During wallet unlock
if (wallet.encryptionMethod === 'prf') {
  const config = await getWalletConfig(wallet.id);

  if (config.passwordUnlockEnabled) {
    // Require spending password
    if (!wallet.prfSpendingPassword) {
      throw new Error('Spending password required for password unlock');
    }
    // Verify password hash
    const isValid = verifyPasswordHash(enteredPassword, wallet.prfSpendingPassword);
    if (!isValid) {
      throw new Error('Invalid spending password');
    }
  }

  if (config.passkeyUnlockEnabled) {
    // Use PRF for private key decryption
    const privateKey = await decryptPrivateKeyWithPrf(
      wallet.prfEncryptedPrivateKey,
      wallet.webAuthnCredentialId,
      wallet.id
    );
  }
}
```

**User Experience**:
- **Pure PRF Mode** (PassKey only):
  - No password to remember
  - Biometric for all operations
  - Simplest UX

- **Hybrid Mode** (PassKey + Password):
  - Password for unlock
  - Biometric for transaction signing
  - Extra security layer

**Rationale**:
- Consistency with existing LockSettings UI
- Flexibility for users who want password option
- Maintains security for sensitive operations

---

### 5. Transaction Signing Coverage ✅
**Decision**: Update all 18 identified locations

**Critical Locations** (6):
1. `src/chrome/walletBg.ts:929-930` - signTx() decryption
2. `src/chrome/walletBg.ts:839-840` - requestAccountKey() decryption
3. `src/chrome/walletBg.ts:890-898` - verifySpendingPassword()
4. `src/chrome/background.ts:1355-1385` - VERIFY_SPENDING_PASSWORD handler
5. `src/chrome/background.ts:1424-1474` - SIGN_TX handler
6. `src/shared/composables/useTransactionSigning.ts:87-137` - signTx()

**High Priority** (9):
7. SendDialog.vue - ADA/token transfers
8. DelegateDialog.vue - Stake delegation
9. UnstakeDialog.vue - Unstake operations
10. WithdrawalDialog.vue - Rewards withdrawal
11. DRepDelegateDialog.vue - Governance voting
12. MultisigTransaction.vue - Multisig signing
13. FundWallet.vue - Multisig funding
14. SignTx.vue (popup) - DApp transactions
15. DappSignData.vue (popup) - DApp message signing

**Medium Priority** (3):
16. ChangePasswordDialog.vue - Password change
17. UnlockWalletDialog.vue - Wallet unlock
18. ConfirmationPasswordModal.vue - Confirmations

**Implementation Strategy**:
- Update critical locations first (Phase 4)
- Then high priority user-facing components (Phase 5)
- Finally medium priority supporting features (Phase 6)

---

## Implementation Phases

### Phase 1: Database Schema Update ✅ READY TO START
- Add new fields to wallets table (version 14)
- Add optional spending password hash field
- Update TypeScript types
- Migration tests

### Phase 2: Core PRF Encryption Functions
- Implement `encryptPrivateKeyWithPrf()`
- Implement `decryptPrivateKeyWithPrf()`
- Implement `encryptMnemonicWithPrf()`
- Implement `decryptMnemonicWithPrf()`
- Handle optional spending password
- Unit tests

### Phase 3: Wallet Creation
- Update `createNewWallet()` with PRF option
- Add UI for encryption method selection
- Register passkey during creation
- Handle optional mnemonic backup
- Handle optional spending password (if password unlock enabled)
- Integration tests

### Phase 4: Critical Transaction Signing (6 locations)
- Update `walletBg.ts` methods
- Update background message handlers
- Update transaction signing composable
- Handle both password and PRF paths
- Integration tests

### Phase 5: User-Facing Components (9 locations)
- Update all dialogs and popups
- Consistent biometric UX
- Error handling
- Integration tests

### Phase 6: Supporting Features (3 locations)
- Password change dialog
- Unlock dialog
- Confirmation modals
- Integration tests

### Phase 7: Testing & QA
- Full regression testing
- Browser compatibility testing
- Performance testing
- Security audit

---

## Key Technical Details

### Spending Password Handling for PRF Wallets

**Password Hashing** (when password unlock is enabled):
```typescript
// During wallet creation or password set
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha2';

function hashSpendingPassword(password: string, salt: Uint8Array): string {
  const passwordBytes = Buffer.from(password, 'utf8');
  const hash = pbkdf2(sha512, passwordBytes, salt, {
    c: 310000,  // OWASP 2023 recommendation
    dkLen: 32
  });
  return Buffer.concat([salt, Buffer.from(hash)]).toString('hex');
}

function verifySpendingPassword(password: string, hashedPassword: string): boolean {
  const combined = Buffer.from(hashedPassword, 'hex');
  const salt = combined.subarray(0, 32);
  const storedHash = combined.subarray(32);

  const passwordBytes = Buffer.from(password, 'utf8');
  const computedHash = pbkdf2(sha512, passwordBytes, salt, {
    c: 310000,
    dkLen: 32
  });

  // Constant-time comparison
  return Buffer.compare(storedHash, Buffer.from(computedHash)) === 0;
}
```

**Usage**:
- PRF wallets with password unlock: Store `prfSpendingPassword` (hashed)
- PRF wallets without password unlock: `prfSpendingPassword` is null
- Password wallets: `encryptedPrivateKey` uses password for encryption (existing)

### Private Key Decryption Decision Tree

```typescript
async function getPrivateKey(wallet, password?) {
  if (wallet.encryptionMethod === 'prf') {
    // PRF Wallet

    // Step 1: Verify spending password (if required)
    const config = await getWalletConfig(wallet.id);
    if (config.passwordUnlockEnabled && wallet.prfSpendingPassword) {
      if (!password) {
        throw new Error('Spending password required');
      }
      const isValid = verifySpendingPassword(password, wallet.prfSpendingPassword);
      if (!isValid) {
        throw new Error('Invalid spending password');
      }
    }

    // Step 2: Decrypt with PRF (requires biometric)
    const keyBytes = await decryptPrivateKeyWithPrf(
      wallet.prfEncryptedPrivateKey,
      wallet.webAuthnCredentialId,
      wallet.id
    );

    return Bip32PrivateKey.fromBytes(keyBytes);

  } else {
    // Password Wallet (existing logic)
    const decrypted = decrypt(wallet.encryptedPrivateKey, password);
    const decodedHash = decryptWithPassword(password, JSON.parse(decrypted));
    return Bip32PrivateKey.fromBytes(decodedHash);
  }
}
```

---

## Security Properties

### PRF Wallets
✅ **Strengths**:
- Hardware-backed key derivation (TPM/Secure Enclave)
- 256-bit cryptographic keys (vs 6-32 char passwords)
- Biometric authentication required
- Keys never exposed to JavaScript
- Optional spending password for extra protection

⚠️ **Considerations**:
- Requires compatible browser/device
- Hardware-bound (migration requires mnemonic)
- Biometric prompt on every transaction
- Spending password hash stored (if password unlock enabled)

### Backward Compatibility
✅ **Existing password wallets**:
- No changes to existing encryption
- Continue working as before
- Can coexist with PRF wallets
- No forced migration

---

## Timeline Estimate

- **Phase 1**: 1 week (Database schema)
- **Phase 2**: 1 week (Core encryption)
- **Phase 3**: 1 week (Wallet creation)
- **Phase 4**: 1.5 weeks (Critical signing)
- **Phase 5**: 2 weeks (User-facing components)
- **Phase 6**: 1 week (Supporting features)
- **Phase 7**: 1.5 weeks (Testing & QA)

**Total**: 9 weeks (2.25 months)

---

## Next Steps

✅ **Phase 1 Ready**: Start database schema update
- Update `src/db/schema.ts`
- Add new fields to wallets table
- Create migration from version 13 to 14
- Update TypeScript types
- Write migration tests

**Approval Needed**: Please confirm to proceed with Phase 1 implementation.
