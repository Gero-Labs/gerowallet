# PRF-Based Encryption Implementation Plan (New Wallets Only)

## Executive Summary

Implement hardware-backed PRF encryption for **NEW wallets only**, while maintaining full backward compatibility with existing password-encrypted wallets.

---

## Current Encryption Architecture (Normal Wallets)

### Two-Layer Encryption for Private Keys:

```
User Spending Password
    ↓
Layer 1: ChaCha20-Poly1305 AEAD
    - PBKDF2-HMAC-SHA512 (19,162 iterations)
    - 32-byte random salt
    - Output: encrypted root key bytes
    ↓
Layer 2: AES (CryptoTS)
    - Built-in PBKDF2 (unknown iterations)
    - Output: double-encrypted string
    ↓
Stored in: wallets.encryptedPrivateKey (GeroWalletDatabase)
```

### Mnemonic Phrase:
```
User Spending Password
    ↓
AES (CryptoTS)
    - Built-in PBKDF2
    ↓
Stored in: wallets.encryptedMnemonic (GeroWalletDatabase)
```

### Database Schema:
```typescript
// GeroWalletDatabase.wallets table (version 13)
{
  id: number (primary key),
  name: string,
  icon: string,
  type: WalletType (Normal/Ledger/Trezor/etc),
  theme: string,
  order: number,
  encryptedPrivateKey: string,  // Double-encrypted
  encryptedMnemonic: string,    // AES-encrypted (optional)
  publicKey: string,            // xpub (plaintext)
  passwordLastUpdate: Date,
  chain: string,
  network: string,
  userId: number
}
```

---

## Proposed Architecture (New PRF Wallets)

### PRF-Based Encryption:

```
WebAuthn PRF Extension
    ↓ (evaluatePrfForWallet with salt="gero-wallet-prf-key-v1:{walletId}")
256-bit PRF Output (hardware-derived)
    ↓
HKDF Key Derivation (SHA-512)
    - Info: "gero-wallet-private-key-encryption-v1:{walletId}"
    - Output: Non-extractable AES-GCM-256 key
    ↓
Encrypt with AES-GCM
    - IV: 12 random bytes
    - AAD: credentialId (binds ciphertext to passkey)
    - Output: encrypted private key bytes
    ↓
Stored in: wallets.prfEncryptedPrivateKey (new field)
```

### Key Differences:
1. **NO password-based encryption** - PRF output replaces spending password
2. **Single-layer encryption** - Direct AES-GCM (no double encryption)
3. **Hardware-bound** - Keys derived from TPM/Secure Enclave
4. **Biometric-protected** - User verification required for each decryption

---

## Database Schema Changes

### New Fields in `wallets` Table:

```typescript
// Add to GeroWalletDatabase.wallets (version 14)
{
  // ... existing fields ...
  encryptionMethod?: 'password' | 'prf',  // NEW: Wallet encryption type
  prfEncryptedPrivateKey?: string,       // NEW: PRF-encrypted private key
  prfEncryptedMnemonic?: string,         // NEW: PRF-encrypted mnemonic
  webAuthnCredentialId?: string,         // NEW: Associated passkey credential
}
```

### Migration Strategy:
- **Version 13 → 14**: Add new optional fields
- **NO data migration** - existing wallets remain untouched
- **Default**: `encryptionMethod: 'password'` for all existing wallets
- **New wallets**: User chooses between password or PRF encryption at creation

---

## Implementation Changes Required

### 1. Wallet Creation (`src/db/gero-db.ts`)

**Current**:
```typescript
export async function createNewWallet(
  name, icon, theme, mnemonic: string, password, chain, network
) {
  const encryptedMnemonic: string = encrypt(mnemonic, password);
  const rootKey: Bip32PrivateKey = resolvePrivateKey(mnemonic);
  const encryptedPrivateKey: string = encryptPrivateKey(rootKey, password);
  // ... store in database
}
```

**Proposed**:
```typescript
export async function createNewWallet(
  name, icon, theme, mnemonic: string, password, chain, network,
  usePrf: boolean = false,  // NEW parameter
  credentialId?: string     // NEW parameter (if usePrf)
) {
  const rootKey: Bip32PrivateKey = resolvePrivateKey(mnemonic);
  let walletData;

  if (usePrf && credentialId) {
    // PRF-based encryption (NEW PATH)
    const prfEncryptedPrivateKey = await encryptPrivateKeyWithPrf(
      rootKey.bytes(),
      credentialId,
      tempWalletId  // Need to pre-allocate wallet ID
    );

    const prfEncryptedMnemonic = await encryptMnemonicWithPrf(
      mnemonic,
      credentialId,
      tempWalletId
    );

    walletData = {
      encryptionMethod: 'prf',
      prfEncryptedPrivateKey,
      prfEncryptedMnemonic,
      webAuthnCredentialId: credentialId,
      encryptedPrivateKey: null,  // Not used
      encryptedMnemonic: null     // Not used
    };
  } else {
    // Password-based encryption (EXISTING PATH)
    const encryptedMnemonic: string = encrypt(mnemonic, password);
    const encryptedPrivateKey: string = encryptPrivateKey(rootKey, password);

    walletData = {
      encryptionMethod: 'password',
      encryptedPrivateKey,
      encryptedMnemonic,
      prfEncryptedPrivateKey: null,  // Not used
      prfEncryptedMnemonic: null     // Not used
    };
  }

  // Store wallet with appropriate encryption
  const walletId = await db['wallets'].add({
    name, icon, type: WalletType.Normal, theme, order,
    publicKey,
    passwordLastUpdate: new Date(),
    chain, network,
    ...walletData
  });

  return walletId;
}
```

### 2. Private Key Decryption (`src/chrome/walletBg.ts`)

**Current**:
```typescript
async signTx(txInput, partialSign, password, accountIndex, utxos, addresses) {
  // Step 1: Decrypt AES layer
  const decrypted = decrypt(this.encryptedPrivateKey, password);

  // Step 2: Decrypt ChaCha20-Poly1305 layer
  const decodedHash = decryptWithPassword(password, JSON.parse(decrypted));

  // Step 3: Reconstruct root key
  const rootPrivateKey: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash);

  // ... continue with signing
}
```

**Proposed**:
```typescript
async signTx(txInput, partialSign, password, accountIndex, utxos, addresses) {
  let rootPrivateKey: Bip32PrivateKey;

  if (this.wallet.encryptionMethod === 'prf') {
    // PRF-based decryption (NEW PATH)
    const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
    const keyBytes = await decryptPrivateKeyWithPrf(
      this.wallet.prfEncryptedPrivateKey,
      this.wallet.webAuthnCredentialId,
      this.wallet.id
    );
    rootPrivateKey = Bip32PrivateKey.fromBytes(keyBytes);

  } else {
    // Password-based decryption (EXISTING PATH)
    const decrypted = decrypt(this.encryptedPrivateKey, password);
    const decodedHash = decryptWithPassword(password, JSON.parse(decrypted));
    rootPrivateKey = Bip32PrivateKey.fromBytes(decodedHash);
  }

  // ... continue with signing (same for both paths)
}
```

### 3. Password Verification (`src/chrome/walletBg.ts`)

**Current**:
```typescript
verifySpendingPassword(password: string) {
  try {
    const decrypted = decrypt(this.encryptedPrivateKey, password);
    decryptWithPassword(password, JSON.parse(decrypted));
    return true;
  } catch (e) {
    return false;
  }
}
```

**Proposed**:
```typescript
async verifySpendingPassword(password: string) {
  if (this.wallet.encryptionMethod === 'prf') {
    // PRF wallets don't use spending password for encryption
    // Instead, verify passkey availability
    const { isCredentialPrfEnabled } = await import('@/shared/utils/webauthn-prf');
    return await isCredentialPrfEnabled(this.wallet.webAuthnCredentialId);

  } else {
    // Password-based verification (EXISTING PATH)
    try {
      const decrypted = decrypt(this.encryptedPrivateKey, password);
      decryptWithPassword(password, JSON.parse(decrypted));
      return true;
    } catch (e) {
      return false;
    }
  }
}
```

### 4. New PRF Encryption Functions (`src/shared/utils/webauthn-prf.ts`)

```typescript
/**
 * Encrypt private key bytes with PRF-derived key
 */
export async function encryptPrivateKeyWithPrf(
  privateKeyBytes: Uint8Array,
  credentialId: string,
  walletId: string
): Promise<string> {
  // Step 1: Evaluate PRF for wallet-specific salt
  const prfOutput = await evaluatePrfForWallet(credentialId, walletId);

  // Step 2: Derive encryption key with different info than password encryption
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-private-key-encryption-v1:${walletId}`)
    },
    await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Step 3: Encrypt with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(credentialId)
    },
    encryptionKey,
    privateKeyBytes
  );

  // Format: iv (12B) + ciphertext
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(result).toString('hex');
}

/**
 * Decrypt private key bytes with PRF-derived key
 */
export async function decryptPrivateKeyWithPrf(
  encryptedPrivateKey: string,
  credentialId: string,
  walletId: string
): Promise<Uint8Array> {
  const encryptedBytes = Buffer.from(encryptedPrivateKey, 'hex');
  const iv = encryptedBytes.subarray(0, 12);
  const ciphertext = encryptedBytes.subarray(12);

  // Step 1: Evaluate PRF
  const prfOutput = await evaluatePrfForWallet(credentialId, walletId);

  // Step 2: Derive encryption key (same derivation as encryption)
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-wallet-private-key-encryption-v1:${walletId}`)
    },
    await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Step 3: Decrypt
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(credentialId)
    },
    encryptionKey,
    ciphertext
  );

  return new Uint8Array(decrypted);
}

/**
 * Encrypt mnemonic phrase with PRF-derived key
 */
export async function encryptMnemonicWithPrf(
  mnemonic: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  const mnemonicBytes = new TextEncoder().encode(mnemonic);
  const encryptedBytes = await encryptPrivateKeyWithPrf(
    mnemonicBytes,
    credentialId,
    walletId
  );
  return encryptedBytes;  // Already hex-encoded
}

/**
 * Decrypt mnemonic phrase with PRF-derived key
 */
export async function decryptMnemonicWithPrf(
  encryptedMnemonic: string,
  credentialId: string,
  walletId: string
): Promise<string> {
  const decryptedBytes = await decryptPrivateKeyWithPrf(
    encryptedMnemonic,
    credentialId,
    walletId
  );
  return new TextDecoder().decode(decryptedBytes);
}
```

---

## UI/UX Changes

### 1. Wallet Creation Dialog

**Add Option During Wallet Creation**:
```
┌─────────────────────────────────────┐
│  Create New Wallet                  │
├─────────────────────────────────────┤
│                                     │
│  Wallet Name: [_______________]     │
│                                     │
│  Security Method:                   │
│  ○ Password Protection (Standard)   │
│  ● PassKey Protection (Maximum)     │
│    ✓ Hardware-backed encryption     │
│    ✓ Biometric authentication       │
│    ⚠ Requires supported browser     │
│                                     │
│  [ Requires Chrome/Edge/Brave ]     │
│                                     │
│  [Cancel]  [Create Wallet]          │
└─────────────────────────────────────┘
```

### 2. Transaction Signing (PRF Wallets)

**No Password Prompt** - Direct biometric authentication:
```
┌─────────────────────────────────────┐
│  Approve Transaction                │
├─────────────────────────────────────┤
│                                     │
│  Sending: 100 ADA                   │
│  To: addr1...xyz                    │
│  Fee: 0.17 ADA                      │
│                                     │
│  🔐 Authenticate with PassKey       │
│  [Touch ID / Face ID / PIN]         │
│                                     │
│  [Cancel]  [Approve]                │
└─────────────────────────────────────┘
```

### 3. Settings - Security Tab

**Show Encryption Method**:
```
Wallet Security: PRF Hardware-Backed ✓
Last Updated: Dec 15, 2024
Passkey Device: MacBook Pro TouchID

[View Mnemonic Phrase]  (requires biometric)
[Export Private Key]    (requires biometric)
[Delete Passkey]        (converts to password-based)
```

---

## Testing Strategy

### Unit Tests:
1. PRF key derivation with different wallet IDs
2. Private key encryption/decryption round-trip
3. Mnemonic encryption/decryption round-trip
4. Error handling for cancelled authentication
5. Backward compatibility with password-encrypted wallets

### Integration Tests:
1. Create new PRF wallet flow
2. Sign transaction with PRF wallet
3. View mnemonic phrase (PRF wallet)
4. Export private key (PRF wallet)
5. Mixed wallet environment (password + PRF wallets)

### Manual Testing:
1. Create password-based wallet (existing flow)
2. Create PRF-based wallet (new flow)
3. Switch between wallets
4. Sign transactions from both wallet types
5. Test on multiple browsers (Chrome, Firefox, Safari)

---

## Rollout Plan

### Phase 1: Database Schema Update (Week 1)
- Add new fields to `wallets` table (version 13 → 14)
- Update TypeScript types
- Add database migration tests

### Phase 2: Core Encryption Functions (Week 2)
- Implement `encryptPrivateKeyWithPrf()`
- Implement `decryptPrivateKeyWithPrf()`
- Implement `encryptMnemonicWithPrf()`
- Implement `decryptMnemonicWithPrf()`
- Unit tests for new functions

### Phase 3: Wallet Creation (Week 3)
- Update `createNewWallet()` with PRF option
- Add UI for encryption method selection
- Register passkey during PRF wallet creation
- Integration tests

### Phase 4: Transaction Signing (Week 4)
- Update `signTx()` to handle PRF wallets
- Update `verifySpendingPassword()` for PRF wallets
- Update all transaction signing flows
- Integration tests

### Phase 5: Wallet Management (Week 5)
- Update wallet info displays
- Add mnemonic/private key export for PRF wallets
- Add conversion from PRF to password (if needed)
- Update password change dialog (N/A for PRF wallets)

### Phase 6: Testing & QA (Week 6)
- Full regression testing
- Browser compatibility testing
- Performance testing
- Security audit

---

## Security Considerations

### PRF Wallets:
✅ **Strengths**:
- Hardware-backed key derivation (TPM/Secure Enclave)
- 256-bit cryptographic keys (vs 6-32 char passwords)
- Biometric authentication for every access
- Keys never exposed to JavaScript
- Resistant to offline brute-force attacks

⚠️ **Trade-offs**:
- Requires specific browser support
- Biometric required for each transaction (could be seen as inconvenience)
- Hardware-bound (can't easily move to new device)
- No "forgot password" recovery (need backup mnemonic)

### Backward Compatibility:
✅ **Existing wallets remain secure**:
- No changes to existing encryption
- Users can continue using password-based wallets
- Mixed wallet environment supported

---

## Open Questions for Discussion

1. **Wallet ID Allocation**:
   - PRF encryption requires wallet ID for key derivation
   - Database auto-generates ID after insert
   - **Solution**: Pre-allocate ID or use temporary UUID?

2. **Mnemonic Backup**:
   - PRF wallets still need mnemonic backup for disaster recovery
   - Should we require mnemonic backup at creation?
   - Or allow "hardware-only" mode (no backup)?

3. **Device Loss/Migration**:
   - User loses device with passkey
   - How do they recover?
   - **Solution**: Force mnemonic backup + password setup as fallback?

4. **Performance**:
   - PRF evaluation requires biometric prompt
   - Could be slower than password entry
   - **Mitigation**: Cache decrypted key in memory for session?

5. **Multi-Account Support**:
   - Current: One private key derives all accounts
   - PRF: Same approach or per-account PRF?
   - **Recommendation**: Same private key (maintain compatibility)

6. **Password Change for PRF Wallets**:
   - PRF wallets don't use spending password for encryption
   - Should they still have a spending password for UI consistency?
   - **Recommendation**: Optional spending password for non-critical operations

---

## Recommendation

**Proceed with PRF-based encryption for NEW wallets only**:

✅ **Benefits**:
- Dramatically improves security for users who choose it
- No risk to existing wallets (backward compatible)
- Future-proofs the application
- Competitive advantage (few wallets offer this)

✅ **Implementation Path**:
- Non-breaking database migration
- Clear user choice during wallet creation
- Gradual adoption (users can try PRF for new wallets)
- Maintain password option for users who prefer it

✅ **Timeline**: 6-8 weeks for complete implementation and testing
