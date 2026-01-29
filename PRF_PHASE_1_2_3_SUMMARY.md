# PRF Implementation - Phases 1-3 Complete

## Overview
Successfully implemented the foundation for PRF (Pseudo-Random Function) encryption in Gero Wallet. This enables NEW wallets to use hardware-backed encryption for private keys and mnemonics, eliminating the need for stored encryption keys.

**Implementation Date**: 2026-01-09
**Database Version**: 13 → 14
**Backward Compatibility**: ✅ Full (existing wallets unaffected)

---

## Phase 1: Database Schema Update ✅

### Changes Made

**File: `src/db/schema.ts`**
- Updated `geroDBVersion` from 13 to 14
- Added indexed fields: `encryptionMethod`, `webAuthnCredentialId`
- Non-indexed fields (encrypted data): `prfEncryptedPrivateKey`, `prfEncryptedMnemonic`, `prfSpendingPassword`

**File: `src/db/gero-db.ts`**
- Added version 14 migration (no-op, all fields optional)
- Documented PRF encryption support

**File: `src/models/types.ts`**
- Updated `Wallet` interface with new optional fields:
  ```typescript
  encryptionMethod?: 'password' | 'prf'
  prfEncryptedPrivateKey?: string
  prfEncryptedMnemonic?: string
  webAuthnCredentialId?: string
  prfSpendingPassword?: string
  ```

### Impact
- **Existing wallets**: No impact, all new fields are optional
- **New wallets**: Can now use PRF encryption
- **Storage**: Backward compatible, password-encrypted wallets continue working

---

## Phase 2: Core PRF Encryption Functions ✅

### New Functions in `src/shared/utils/webauthn-prf.ts`

**Private Key Encryption** (296 lines added):
```typescript
encryptPrivateKeyWithPrf(privateKeyBytes, credentialId, walletId)
  → Promise<string>  // Hex-encoded encrypted private key

decryptPrivateKeyWithPrf(encryptedPrivateKey, credentialId, walletId)
  → Promise<Uint8Array>  // Decrypted private key bytes
```

**Mnemonic Encryption**:
```typescript
encryptMnemonicWithPrf(mnemonic, credentialId, walletId)
  → Promise<string>  // Hex-encoded encrypted mnemonic

decryptMnemonicWithPrf(encryptedMnemonic, credentialId, walletId)
  → Promise<string>  // Decrypted BIP39 mnemonic phrase
```

**Spending Password Hashing** (PBKDF2-HMAC-SHA512):
```typescript
hashSpendingPassword(password)
  → Promise<string>  // Hex-encoded salt + hash (128 chars)

verifySpendingPassword(password, hashedPassword)
  → Promise<boolean>  // Constant-time verification
```

### Security Properties
- **PRF Evaluation**: Requires user authentication (biometric/PIN)
- **Key Derivation**: HKDF with SHA-512 and domain-specific info parameters
- **Non-extractable Keys**: WebCrypto CryptoKey objects with `extractable: false`
- **Authenticated Encryption**: AES-GCM-256 with credential ID as AAD
- **Password Hashing**: PBKDF2-HMAC-SHA512, 310,000 iterations (OWASP 2023)

### Domain Separation (HKDF Info Parameters)
- Spending password: `gero-wallet-password-encryption-v1:{walletId}`
- Private key: `gero-wallet-privatekey-encryption-v1:{walletId}`
- Mnemonic: `gero-wallet-mnemonic-encryption-v1:{walletId}`

---

## Phase 3: Wallet Creation with PRF Support ✅

### Changes Made

**File: `src/db/gero-db.ts`**

Updated `createNewWallet()` function with optional PRF encryption:

```typescript
createNewWallet(
  name: string,
  icon: string,
  theme: string,
  mnemonic: string,
  password: string,
  chain: string,
  network: string,
  options?: {
    usePrf?: boolean                  // Enable PRF encryption
    credentialId?: string             // WebAuthn credential ID (required if usePrf)
    passwordUnlockEnabled?: boolean   // Hash spending password?
    backupMnemonic?: boolean          // Encrypt mnemonic for backup? (default: true)
  }
)
```

### Implementation Logic

**PRF Mode** (`options.usePrf = true`):
1. Pre-allocate wallet ID (Option A from decisions)
2. Encrypt private key with PRF (requires user authentication)
3. Optionally encrypt mnemonic with PRF (default: yes)
4. Optionally hash spending password (if `passwordUnlockEnabled`)
5. Insert wallet with `encryptionMethod: 'prf'`

**Password Mode** (`options.usePrf = false` or undefined):
1. Use existing password encryption (ChaCha20-Poly1305)
2. Insert wallet with `encryptionMethod: 'password'`

### Backward Compatibility
✅ Existing code calling `createNewWallet()` without options continues working
✅ All new fields are optional
✅ Database schema version 14 is backward compatible

---

## Implementation Status

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ Complete | Database schema updated to version 14 |
| **Phase 2** | ✅ Complete | Core PRF encryption functions implemented |
| **Phase 3** | ✅ Complete | Wallet creation with PRF support |
| Phase 4 | ⏳ Pending | Critical transaction signing (6 locations) |
| Phase 5 | ⏳ Pending | User-facing components (9 locations) |
| Phase 6 | ⏳ Pending | Supporting features (3 locations) |
| Phase 7 | ⏳ Pending | Testing & QA |

---

## Next Steps

### Phase 4: Critical Transaction Signing (6 locations)

The following files need updates to support PRF decryption:

1. **`src/chrome/walletBg.ts:929-930`** - `signTx()` decryption
2. **`src/chrome/walletBg.ts:839-840`** - `requestAccountKey()` decryption
3. **`src/chrome/walletBg.ts:890-898`** - `verifySpendingPassword()`
4. **`src/chrome/background.ts:1355-1385`** - `VERIFY_SPENDING_PASSWORD` handler
5. **`src/chrome/background.ts:1424-1474`** - `SIGN_TX` handler
6. **`src/shared/composables/useTransactionSigning.ts:87-137`** - `signTx()`

### Phase 3 (UI): Wallet Creation Dialog

Add UI for PRF wallet creation in wallet creation flow:
- Detect PRF support (`isPrfSupported()`)
- Offer PRF encryption option during wallet creation
- Register WebAuthn credential with PRF
- Handle mnemonic backup choice
- Handle spending password setup (aligned with LockSettings)

---

## Testing Checklist

### Unit Tests Needed
- [ ] Database migration from v13 to v14
- [ ] PRF encryption/decryption (private key)
- [ ] PRF encryption/decryption (mnemonic)
- [ ] Spending password hashing and verification
- [ ] Wallet creation with PRF options

### Integration Tests Needed
- [ ] Create PRF wallet with all options
- [ ] Create PRF wallet without mnemonic backup
- [ ] Create PRF wallet without spending password
- [ ] Verify backward compatibility (password wallets)
- [ ] Verify wallet ID pre-allocation

### Manual Testing Needed
- [ ] PRF support detection (Chrome, Edge, Firefox)
- [ ] WebAuthn credential registration with PRF
- [ ] PRF wallet creation flow
- [ ] Biometric authentication prompt
- [ ] Wallet database created correctly

---

## Security Audit Notes

### Strengths
✅ Hardware-backed key derivation (TPM/Secure Enclave)
✅ Non-extractable CryptoKeys (can't be read by JavaScript)
✅ Domain separation via HKDF info parameters
✅ Authenticated encryption (AES-GCM with AAD)
✅ Strong password hashing (PBKDF2-HMAC-SHA512, 310k iterations)
✅ Constant-time password verification

### Considerations
⚠️ PRF requires compatible browser (Chrome, Edge, Firefox)
⚠️ Hardware-bound (wallet recovery requires mnemonic backup)
⚠️ Biometric prompt on every transaction signing
⚠️ Spending password hash stored (if password unlock enabled)

---

## Files Modified

### Core Infrastructure
- `src/db/schema.ts` (3 lines)
- `src/db/gero-db.ts` (145 lines added/modified)
- `src/models/types.ts` (5 lines added)

### PRF Encryption
- `src/shared/utils/webauthn-prf.ts` (296 lines added)

### Total Changes
- **Files modified**: 4
- **Lines added**: ~449
- **New functions**: 6
- **Database version**: 13 → 14

---

## Browser Compatibility

| Browser | PRF Support | Status |
|---------|-------------|--------|
| Chrome/Edge | ✅ Full | Windows, macOS, Linux, Android |
| Firefox | ⚠️ Partial | Linux (full), Windows/macOS (in progress) |
| Safari | ❌ Not supported | Waiting for Apple implementation |

---

## Documentation References

- **Implementation Plan**: `PRF_IMPLEMENTATION_PLAN.md`
- **Final Decisions**: `PRF_IMPLEMENTATION_DECISIONS.md`
- **W3C PRF Spec**: https://github.com/w3c/webauthn/wiki/Explainer:-PRF-extension
- **OWASP Password Recommendations**: 310,000 iterations for PBKDF2-HMAC-SHA512

---

**Summary**: Phases 1-3 provide the complete foundation for PRF encryption in new wallets. The next phases will integrate PRF decryption into transaction signing and user-facing components.
