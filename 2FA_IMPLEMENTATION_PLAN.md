# Two-Factor Authentication (2FA) Implementation Plan

## Overview
Implement TOTP-based 2FA as a true second authentication factor that cryptographically enforces security, preventing bypass even with code-level access.

## Architecture Design

### Security Model
- **2FA is optional** - Can be enabled after wallet creation
- **Cryptographic enforcement** - 2FA cannot be bypassed with code access
- **Dual encryption** - RootKey encrypted with derived key from password + TOTP secret

### Encryption Scheme

#### Without 2FA (Current/Default)
```
encryptedRootKey = encrypt(rootKey, spendingPassword)
```

#### With 2FA Enabled
```
derivedKey = PBKDF2(spendingPassword || totpSecret)
encryptedRootKey = encrypt(rootKey, derivedKey)
encryptedTotpSecret = encrypt(totpSecret, spendingPassword)
```

### Authentication Flows

#### Wallet Unlock Flow
1. User enters unlock method (PIN/Pattern/Biometrics/Password)
2. **IF 2FA enabled**: Show 2FA verification dialog
3. User enters current TOTP code
4. Decrypt TOTP secret using spending password
5. Verify TOTP code matches
6. Derive decryption key: `PBKDF2(spendingPassword + totpSecret)`
7. Decrypt rootKey with derived key
8. Wallet unlocked

#### Transaction Signing Flow
1. User enters spending password
2. **IF 2FA enabled AND (mode='always' OR not verified this session)**:
   - Show 2FA verification dialog
   - Verify TOTP code
3. Decrypt TOTP secret (if 2FA enabled)
4. Derive signing key (if 2FA enabled) or use spending password directly
5. Sign transaction

## Database Schema Changes

### Wallet Config Table
```typescript
interface WalletConfig {
  // Existing fields...

  // 2FA Configuration
  twoFactorEnabled: boolean;                    // Whether 2FA is enabled
  encryptedTotpSecret?: string;                 // TOTP secret encrypted with spending password
  encryptedBackupCodes?: string[];              // Backup codes encrypted with spending password
  twoFactorMode?: 'always' | 'session';         // When to require 2FA
  twoFactorSessionVerified?: boolean;           // Session verification state (memory only)
}
```

## Component Changes

### 1. New Components

#### `/src/modules/dashboard/dialogs/TwoFactorVerificationDialog.vue`
**Purpose**: Reusable dialog for TOTP code verification

**Props**:
- `value: boolean` - Dialog open state
- `walletId: string` - Wallet to verify against

**Features**:
- 6-digit OTP input (use v-otp-input or NumericOtpInput)
- Verify code against stored TOTP secret
- Support backup codes
- Error tooltip for invalid codes
- Auto-submit on 6 digits entered

**Emits**:
- `input(boolean)` - Dialog state
- `verified(totpSecret: string)` - Successful verification with decrypted secret
- `error(message: string)` - Verification failed

#### `/src/modules/dashboard/dialogs/TwoFactorSetupDialog.vue` (Already exists - needs updates)
**Changes needed**:
- Remove spending password step (not needed during setup)
- After backup codes step, show success message
- Store encrypted TOTP secret immediately
- Emit success event to parent

### 2. Modified Components

#### `/src/modules/dashboard/dialogs/LockSettingsDialog.vue`
**Add**:
- 2FA setup toggle/button
- Show 2FA status (enabled/disabled)
- Configure 2FA mode (always vs session)
- Launch TwoFactorSetupDialog

#### `/src/modules/dashboard/dialogs/UnlockWalletDialog.vue`
**Changes**:
1. After successful unlock method verification
2. Check if 2FA is enabled for wallet
3. If enabled: Show TwoFactorVerificationDialog
4. Wait for 2FA verification
5. Use verified TOTP secret + spending password to derive decryption key
6. Decrypt rootKey with derived key

#### `/src/modules/wallet/components/dashboard/PasswordConfirmModal.vue`
**Changes**:
1. After spending password validation
2. Check if 2FA is enabled
3. Check twoFactorMode and session state
4. If verification needed: Show TwoFactorVerificationDialog
5. Use verified TOTP secret + spending password for signing

#### `/src/modules/dashboard/components/SecurityTab.vue`
**Changes**:
- Move 2FA setup to LockSettingsDialog
- Keep only status display
- Show warning if 2FA enabled but no backup codes saved

#### `/src/modules/dashboard/dialogs/ChangePasswordDialog.vue`
**Changes** (Critical for 2FA):
1. Verify current spending password
2. **If 2FA enabled**: Require 2FA verification
3. Decrypt TOTP secret with current password
4. Decrypt rootKey with `PBKDF2(currentPassword + totpSecret)`
5. Re-encrypt TOTP secret with new password
6. Re-encrypt rootKey with `PBKDF2(newPassword + totpSecret)`
7. Store updated encrypted data

## Background Script Changes

### `/src/chrome/walletBg.ts`

#### New Methods

```typescript
/**
 * Verify 2FA code and return decrypted TOTP secret
 */
async verify2FA(walletId: string, code: string, password: string): Promise<{
  success: boolean;
  totpSecret?: string;
  error?: string;
}> {
  // 1. Get wallet config
  // 2. Decrypt TOTP secret with password
  // 3. Verify code against secret
  // 4. Check backup codes if primary verification fails
  // 5. Return decrypted TOTP secret on success
}

/**
 * Enable 2FA for wallet
 */
async enable2FA(
  walletId: string,
  totpSecret: string,
  backupCodes: string[],
  password: string
): Promise<void> {
  // 1. Get current encrypted rootKey
  // 2. Decrypt rootKey with current password
  // 3. Encrypt TOTP secret with password
  // 4. Encrypt backup codes with password
  // 5. Re-encrypt rootKey with PBKDF2(password + totpSecret)
  // 6. Store all encrypted data
  // 7. Set twoFactorEnabled = true
}

/**
 * Disable 2FA for wallet
 */
async disable2FA(walletId: string, password: string, code: string): Promise<void> {
  // 1. Verify 2FA code (security check)
  // 2. Decrypt TOTP secret with password
  // 3. Decrypt rootKey with PBKDF2(password + totpSecret)
  // 4. Re-encrypt rootKey with password only
  // 5. Delete TOTP secret and backup codes
  // 6. Set twoFactorEnabled = false
}
```

#### Modified Methods

```typescript
/**
 * Decrypt rootKey - add 2FA support
 */
async decryptRootKey(
  walletId: string,
  password: string,
  totpSecret?: string
): Promise<RootKey> {
  // 1. Get wallet config
  // 2. If 2FA enabled:
  //    - Require totpSecret parameter
  //    - Derive key from PBKDF2(password + totpSecret)
  // 3. If 2FA not enabled:
  //    - Use password directly
  // 4. Decrypt and return rootKey
}

/**
 * Change spending password - handle 2FA re-encryption
 */
async changeSpendingPassword(
  walletId: string,
  currentPassword: string,
  newPassword: string,
  totpSecret?: string // Required if 2FA enabled
): Promise<void> {
  // 1. Check if 2FA enabled
  // 2. If enabled:
  //    - Decrypt TOTP secret with current password
  //    - Decrypt rootKey with PBKDF2(currentPassword + totpSecret)
  //    - Re-encrypt TOTP secret with new password
  //    - Re-encrypt rootKey with PBKDF2(newPassword + totpSecret)
  // 3. If not enabled:
  //    - Standard password change flow
  // 4. Store updated encrypted data
}
```

## Utility Functions

### `/src/shared/utils/security.ts`

#### New Functions

```typescript
/**
 * Derive encryption key from password and TOTP secret
 */
export function derive2FAKey(password: string, totpSecret: string): Buffer {
  const combined = password + totpSecret;
  return pbkdf2Sync(combined, SALT, ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Re-encrypt rootKey when enabling 2FA
 */
export async function reEncryptRootKeyFor2FA(
  encryptedRootKey: string,
  password: string,
  totpSecret: string
): Promise<string> {
  // 1. Decrypt with password only
  const rootKey = decryptWithPassword(password, encryptedRootKey);

  // 2. Derive new key from password + TOTP secret
  const derivedKey = derive2FAKey(password, totpSecret);

  // 3. Re-encrypt with derived key
  return encryptWithDerivedKey(rootKey, derivedKey);
}

/**
 * Re-encrypt rootKey when disabling 2FA
 */
export async function reEncryptRootKeyWithoutPassword(
  encryptedRootKey: string,
  password: string,
  totpSecret: string
): Promise<string> {
  // 1. Decrypt with derived key
  const derivedKey = derive2FAKey(password, totpSecret);
  const rootKey = decryptWithDerivedKey(derivedKey, encryptedRootKey);

  // 2. Re-encrypt with password only
  return encryptWithPassword(password, rootKey);
}
```

## Session State Management

### `/src/stores/walletStore.ts`

Add session tracking:

```typescript
interface WalletStore {
  // Existing fields...

  // 2FA Session State
  twoFactorVerifiedThisSession: boolean;
  twoFactorVerificationTimestamp?: number;
}

// Reset on wallet lock
function lockWallet() {
  // Existing lock logic...
  walletStore.twoFactorVerifiedThisSession = false;
  walletStore.twoFactorVerificationTimestamp = undefined;
}
```

## Message Types

### `/src/models/MessageTypes.ts`

Add new message types:

```typescript
export enum MessageTypes {
  // Existing types...

  // 2FA Messages
  VERIFY_2FA = 'VERIFY_2FA',
  ENABLE_2FA = 'ENABLE_2FA',
  DISABLE_2FA = 'DISABLE_2FA',
  GET_2FA_STATUS = 'GET_2FA_STATUS',
}
```

## Translation Keys

### `/src/plugins/i18n/us.ts`

Add translations:

```typescript
'security.2FAVerification': 'Two-Factor Authentication',
'security.enter2FACode': 'Enter the 6-digit code from your authenticator app',
'security.invalid2FACode': 'Invalid authentication code',
'security.2FARequired': 'Two-factor authentication is required',
'security.2FAVerified': 'Authentication successful',
'security.2FAMode': '2FA Verification Frequency',
'security.2FAModeAlways': 'Always (Most Secure)',
'security.2FAModeSession': 'Once per session',
'security.2FAModeDescription': 'Choose when to require 2FA verification',
'security.2FABackupCodeUsed': 'Backup code used. You have {count} codes remaining',
'security.enable2FAFirst': 'Please enable 2FA first',
```

## Edge Cases & Testing Scenarios

### 1. Wallet Creation
- ✅ Create wallet without 2FA (default flow)
- ✅ 2FA is optional during creation

### 2. Enabling 2FA
- ✅ Enable 2FA on existing wallet
- ✅ Verify QR code works in authenticator app
- ✅ Verify backup codes work
- ✅ RootKey re-encrypted with derived key
- ✅ Can still unlock wallet after enabling

### 3. Disabling 2FA
- ✅ Require 2FA verification to disable
- ✅ Require spending password
- ✅ RootKey re-encrypted with password only
- ✅ Can unlock wallet without 2FA after disabling

### 4. Changing Spending Password (2FA Enabled)
- ✅ Require current password
- ✅ Require 2FA verification
- ✅ TOTP secret re-encrypted with new password
- ✅ RootKey re-encrypted with new derived key
- ✅ Can unlock with new password after change
- ✅ Old password cannot decrypt anymore

### 5. Changing Spending Password (2FA Disabled)
- ✅ Standard password change flow works

### 6. Unlock Wallet (2FA Enabled)
- ✅ Unlock method → 2FA verification → Wallet unlocked
- ✅ Invalid 2FA code prevents unlock
- ✅ Backup code works for unlock

### 7. Transaction Signing (2FA Always Mode)
- ✅ Password → 2FA verification → Transaction signed
- ✅ 2FA required for every transaction

### 8. Transaction Signing (2FA Session Mode)
- ✅ First transaction: Password → 2FA → Signed
- ✅ Subsequent transactions: Password only (no 2FA)
- ✅ After wallet lock: 2FA required again

### 9. Backup Code Usage
- ✅ Backup code works when TOTP unavailable
- ✅ Backup code is consumed (deleted) after use
- ✅ Warning when backup codes running low
- ✅ Can regenerate backup codes

### 10. Lost Authenticator Device
- ✅ Can use backup codes to access wallet
- ✅ Can disable 2FA with backup code
- ✅ Can set up new 2FA with backup code access

### 11. Multiple Wallets
- ✅ Each wallet has independent 2FA configuration
- ✅ Switching wallets respects individual 2FA settings

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create TwoFactorVerificationDialog component
- [ ] Add derive2FAKey utility function
- [ ] Add 2FA database schema fields
- [ ] Add message types and handlers
- [ ] Add translation keys

### Phase 2: Enable/Disable Flow (Week 1-2)
- [ ] Update TwoFactorSetupDialog (remove password step)
- [ ] Implement enable2FA in walletBg.ts
- [ ] Implement disable2FA in walletBg.ts
- [ ] Add 2FA option to LockSettingsDialog
- [ ] Test enable/disable flows

### Phase 3: Unlock Integration (Week 2)
- [ ] Integrate 2FA verification into UnlockWalletDialog
- [ ] Update decryptRootKey to support derived keys
- [ ] Test unlock flow with 2FA
- [ ] Test backup code usage

### Phase 4: Transaction Signing (Week 2-3)
- [ ] Add session state tracking
- [ ] Integrate 2FA into PasswordConfirmModal
- [ ] Implement 'always' vs 'session' mode
- [ ] Test transaction signing flows

### Phase 5: Password Change (Week 3)
- [ ] Update ChangePasswordDialog for 2FA
- [ ] Implement re-encryption logic
- [ ] Test password change with 2FA enabled
- [ ] Test password change with 2FA disabled

### Phase 6: Polish & Edge Cases (Week 3-4)
- [ ] Add backup code regeneration
- [ ] Add low backup codes warning
- [ ] Handle lost authenticator scenarios
- [ ] Add comprehensive error messages
- [ ] Security audit

### Phase 7: Testing & QA (Week 4)
- [ ] Test all edge cases
- [ ] Cross-browser testing
- [ ] Mobile device testing
- [ ] Security review
- [ ] Documentation

## Security Considerations

### ✅ Cryptographic Enforcement
- 2FA cannot be bypassed with code access
- RootKey requires both password and TOTP secret

### ✅ Backup Codes
- Encrypted with spending password
- Single-use (consumed after verification)
- Regenerable with password + 2FA

### ✅ Session Security
- Session state cleared on wallet lock
- Session timeout configurable
- Re-verification required after timeout

### ✅ Migration Safety
- Existing wallets without 2FA unaffected
- Enabling 2FA re-encrypts rootKey securely
- Disabling 2FA reverts to password-only encryption

### ⚠️ Risks to Mitigate
- **Lost authenticator + lost backup codes** = permanent wallet loss
  - Mitigation: Prominent warning during setup
  - Mitigation: Force user to save backup codes
  - Mitigation: Test backup code before completing setup

- **Phishing attacks** - User enters 2FA code on fake site
  - Mitigation: Clear domain display
  - Mitigation: Education about not sharing codes

- **Time sync issues** - Device clock incorrect
  - Mitigation: Allow ±1 time window for codes
  - Mitigation: Show error message about time sync

## Future Enhancements

### Version 2.0
- [ ] Hardware key support (YubiKey, etc.)
- [ ] Biometric 2FA on mobile
- [ ] Recovery email/phone for backup codes
- [ ] Multiple TOTP devices
- [ ] 2FA setup QR code via mobile camera

### Version 3.0
- [ ] WebAuthn as primary 2FA method
- [ ] Push notifications for transaction approval
- [ ] Geolocation-based security policies
- [ ] Anomaly detection and adaptive 2FA

## Risk Assessment

### High Priority Risks
1. **User loses authenticator + backup codes**
   - Impact: Permanent wallet loss
   - Mitigation: Mandatory backup code storage, test before enabling

2. **Re-encryption bugs during password change**
   - Impact: Wallet corruption, data loss
   - Mitigation: Extensive testing, atomic transactions, backup before change

3. **Time synchronization issues**
   - Impact: Valid codes rejected
   - Mitigation: Lenient time window, clear error messages

### Medium Priority Risks
1. **Session state not cleared on lock**
   - Impact: 2FA bypass in session mode
   - Mitigation: Strict session lifecycle management

2. **Backup codes not properly consumed**
   - Impact: Code reuse attack
   - Mitigation: Atomic backup code deletion

## Success Metrics

- [ ] 2FA can be enabled/disabled without data loss
- [ ] Password changes work correctly with 2FA
- [ ] Wallet unlock requires 2FA verification
- [ ] Transactions respect 2FA mode settings
- [ ] Backup codes work as fallback
- [ ] No security bypasses possible
- [ ] User-friendly error messages
- [ ] Comprehensive documentation

## Documentation Requirements

- [ ] User guide for enabling 2FA
- [ ] User guide for backup codes
- [ ] Developer documentation for 2FA architecture
- [ ] Security audit report
- [ ] Migration guide for existing users

---

## Notes

- This is a complex feature requiring careful implementation
- Security is paramount - any bugs could lock users out permanently
- Extensive testing required before production release
- Consider feature flag for gradual rollout
- Monitor user feedback and support requests closely after launch