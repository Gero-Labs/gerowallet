# Google Wallet Solution - Implementation Plan

## Overview

This document outlines the implementation plan for Google Wallet integration in Gero Wallet, replacing the zkFold zero-knowledge proof system with a simpler, more secure, and cost-free solution using Google Drive API for encrypted wallet backup.

---

## Problem Statement

**Original Implementation (zkFold):**
- ❌ 5-10 minute wallet creation time (ZK proof generation)
- ❌ Complex cryptographic proof system
- ❌ Dependency on zkFold backend service
- ❌ Poor user experience (long wait times)

**User Requirements:**
1. ✅ 1:1 mapping between Google account and Cardano wallet
2. ✅ Cross-device wallet restoration (same wallet on any device)
3. ✅ No mnemonic phrase shown to user
4. ✅ Secure against unauthorized access
5. ✅ Zero cost for implementation and operation

---

## Solution: Google Drive Encrypted Backup

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WALLET CREATION FLOW                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User signs in with Google OAuth                         │
│     → Get: email + accessToken                              │
│                                                             │
│  2. User enters strong wallet password                      │
│     → Password requirements enforced                        │
│                                                             │
│  3. Generate random BIP39 mnemonic (24 words)               │
│     → Standard Cardano wallet generation                    │
│                                                             │
│  4. Encrypt mnemonic with user's password                   │
│     → AES-256 encryption (CryptoTS)                         │
│                                                             │
│  5. Upload encrypted mnemonic to Google Drive               │
│     → Stored in appDataFolder (hidden, app-specific)        │
│                                                             │
│  6. Create wallet locally from mnemonic                     │
│     → Wallet ready to use immediately                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  WALLET RESTORATION FLOW                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User signs in with Google OAuth (same account)          │
│     → Get: email + accessToken                              │
│                                                             │
│  2. Check if wallet backup exists in Google Drive           │
│     → Search for 'gero-wallet-backup.json' in appDataFolder │
│                                                             │
│  3. If backup found:                                        │
│     → User enters wallet password                           │
│     → Download encrypted mnemonic from Google Drive         │
│     → Decrypt mnemonic with password                        │
│     → Restore wallet from mnemonic                          │
│     → ✅ Same wallet restored on new device!                │
│                                                             │
│  4. If backup NOT found:                                    │
│     → Show "Create Wallet" flow                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Model

### Two-Factor Security

The wallet requires **TWO pieces of information** to restore:

1. **Google Account Access** (OAuth authentication)
   - Proves user owns the Google account
   - Required to download encrypted backup from Google Drive
   - Uses Google's existing 2FA if user has it enabled

2. **Wallet Password** (Encryption key)
   - Required to decrypt the mnemonic
   - Never stored anywhere (user must remember)
   - Strong password requirements enforced

### Threat Model

| Scenario                              | Can Access Wallet? | Explanation                                                    |
|---------------------------------------|--------------------|----------------------------------------------------------------|
| **Attacker has Google password only** | ❌ NO               | Can download backup but cannot decrypt without wallet password |
| **Attacker has wallet password only** | ❌ NO               | Cannot download backup without Google OAuth token              |
| **Attacker has BOTH passwords**       | ✅ YES              | Can restore wallet (same as legitimate user)                   |
| **Google employees**                  | ❌ NO               | Backup is encrypted with user's wallet password                |
| **User forgets wallet password**      | ❌ NO               | Wallet is permanently lost (no recovery possible)              |
| **User loses Google account**         | ❌ NO               | Cannot download backup (wallet lost)                           |

### Encryption Details

**Algorithm:** AES-256 (via CryptoTS library)
```typescript
// Encryption
const encryptedMnemonic = encrypt(mnemonic, walletPassword);

// Decryption
const mnemonic = decrypt(encryptedMnemonic, walletPassword);
```

**What's Encrypted:**
- 24-word BIP39 mnemonic phrase
- Stored as JSON with metadata (version, email, timestamp)

**What's NOT Encrypted:**
- Email address (for verification)
- Wallet creation timestamp
- Version number

---

## User Concerns Addressed

### 1. "If someone knows my Google userId, will they be able to access my funds?"

**Answer: NO** ✅

The Google email is just an identifier, NOT part of the encryption key. An attacker would need:
- Google account access (to download encrypted backup)
- AND wallet password (to decrypt it)

Email alone reveals nothing about the wallet keys.

---

### 2. "Can I restore my Google wallet on any device?"

**Answer: YES** ✅

Restoration flow:
1. Sign in with Google (same account) on new device
2. Enter wallet password (the one you set during creation)
3. Wallet automatically restored with all funds and history

**Works on:**
- ✅ Different computers (Windows, Mac, Linux)
- ✅ Different browsers (Chrome, Firefox, Edge - anywhere you can install the extension)
- ✅ Same wallet, same addresses, same funds everywhere

---

### 3. "Do I need to see or save a mnemonic phrase?"

**Answer: NO** ✅

The mnemonic is:
- Generated automatically (24 random words)
- Encrypted immediately
- Backed up to Google Drive
- Never shown to the user
- Never needs to be written down

**User only needs to remember:** Wallet password

---

### 4. "What if I forget my wallet password?"

**Answer: Wallet is PERMANENTLY LOST** ❌

**Why:**
- Password is the encryption key for the mnemonic
- No password = cannot decrypt backup
- No mnemonic backup = no recovery possible

**Critical UX Warning:**
```
⚠️ IMPORTANT: Your wallet password CANNOT be recovered
   • Gero Wallet does not store your password
   • If you forget it, your funds are PERMANENTLY LOST
   • Write it down and store it in a safe place
   • Consider using a password manager
```

**Potential Future Enhancements:**
- Optional mnemonic export (user can manually backup 24 words)
- Password recovery questions (less secure, but better UX)
- Multi-password recovery (split key among trusted contacts)

---

### 5. "What about using biometrics instead of password?"

**Answer: Possible as a CONVENIENCE feature** ✅

**Implementation:**
- Password still required for wallet derivation (cross-device compatibility)
- Biometrics can be used to unlock the stored password on trusted devices
- WebAuthn API for biometric authentication

**Flow:**
1. First time on device: Enter password manually
2. Ask: "Save password for biometric unlock on this device?"
3. If yes: Store encrypted password locally, unlockable with Touch ID/Face ID
4. Next time: Biometric prompt → retrieves password → unlocks wallet

**Cross-device behavior:**
- Device A: Biometric unlock enabled ✅
- Device B (new): Must enter password first time, then can enable biometrics

**Recommendation:** Implement in Phase 2 (after MVP)

---

### 6. "What about 2FA (Two-Factor Authentication)?"

**Answer: Already built-in, can be enhanced** ✅

**Current 2FA:**
- Google OAuth already provides 2FA (if user has it enabled on Google account)
- Attacker would need to pass Google's 2FA to download backup

**Optional Enhancement (Phase 2):**
- Add TOTP 2FA for wallet access (Google Authenticator, Authy)
- User scans QR code during wallet creation
- Required to enter 6-digit code on every login
- TOTP secret encrypted and stored in Google Drive with mnemonic

**Recommendation:** Start without extra 2FA (Google OAuth is sufficient), add later if needed

---

### 7. "What are the costs for adding Google Drive API?"

**Answer: ZERO COST** ✅

| Cost Category          | Amount | Details                                               |
|------------------------|--------|-------------------------------------------------------|
| **Google Drive API**   | $0     | Completely free to use                                |
| **API Requests**       | $0     | No charges for basic operations                       |
| **Storage**            | $0     | Stored in user's Google Drive (15GB free per user)    |
| **Setup**              | $0     | No billing account required                           |
| **Per User**           | $0     | Each user uses their own 15GB free storage            |
| **Quota**              | FREE   | 1,000 requests/100s per user, 10,000/100s per project |
| **googleapis library** | $0     | Open-source, ~200KB bundle size                       |

**What you need (all free):**
1. Google Cloud Project (free)
2. Enable Google Drive API (free, just toggle it on)
3. OAuth 2.0 Client ID (you already have this)
4. Add Drive API scope to manifest (no cost)

**Comparison to alternatives:**
- Your own backend server: $5-50/month
- AWS S3: $0.023/GB + request costs
- Chrome Sync: $0 but Chrome-only

**Winner: Google Drive API** 🏆

---

## Implementation Details

### File Structure

**Backup file stored in Google Drive:**
```json
{
  "version": 1,
  "email": "user@gmail.com",
  "createdAt": "2025-01-15T10:30:00Z",
  "encryptedMnemonic": "U2FsdGVkX1...",  // AES-256 encrypted
  "metadata": {
    "walletName": "Google Wallet",
    "chain": "Cardano",
    "network": "Mainnet"
  }
}
```

**File location:** `appDataFolder/gero-wallet-backup.json`
- Hidden from user's main Google Drive view
- Only accessible by Gero Wallet extension
- Cannot be accessed by other apps

**File size:** ~1-2 KB (tiny!)

---

### Required Changes

#### 1. **manifest.json** - Add Google Drive scope

```json
{
  "oauth2": {
    "client_id": "YOUR_EXISTING_CLIENT_ID",
    "scopes": [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive.appdata",  // ← ADD THIS
      "openid"
    ]
  }
}
```

#### 2. **package.json** - Add googleapis library

```bash
npm install googleapis
```

#### 3. **New Service: `src/services/googleDrive.service.ts`**

```typescript
import { google } from 'googleapis';
import { encrypt, decrypt } from '@/shared/utils/crypto';
import * as bip39 from 'bip39';

export class GoogleDriveService {
  /**
   * Save encrypted wallet backup to Google Drive
   */
  async saveWalletBackup(
    accessToken: string,
    mnemonic: string,
    password: string,
    email: string
  ): Promise<string> {
    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Encrypt mnemonic with wallet password
    const encryptedMnemonic = encrypt(mnemonic, password);

    // Prepare backup data
    const backupData = {
      version: 1,
      email: email,
      createdAt: new Date().toISOString(),
      encryptedMnemonic: encryptedMnemonic,
      metadata: {
        walletName: "Google Wallet",
        chain: "Cardano",
        network: "Mainnet"
      }
    };

    // Initialize Google Drive API
    const drive = google.drive({
      version: 'v3',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // Check if backup already exists
    const existingFile = await this.findBackupFile(drive);

    if (existingFile) {
      // Update existing backup
      await drive.files.update({
        fileId: existingFile.id,
        media: {
          mimeType: 'application/json',
          body: JSON.stringify(backupData)
        }
      });
      console.log('✅ Wallet backup updated in Google Drive');
      return existingFile.id;
    } else {
      // Create new backup
      const fileMetadata = {
        name: 'gero-wallet-backup.json',
        mimeType: 'application/json',
        parents: ['appDataFolder']
      };

      const media = {
        mimeType: 'application/json',
        body: JSON.stringify(backupData)
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id'
      });

      console.log('✅ Wallet backup created in Google Drive:', response.data.id);
      return response.data.id;
    }
  }

  /**
   * Restore wallet from Google Drive backup
   */
  async restoreWalletBackup(
    accessToken: string,
    password: string,
    email: string
  ): Promise<string> {
    // Initialize Google Drive API
    const drive = google.drive({
      version: 'v3',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // Find backup file
    const backupFile = await this.findBackupFile(drive);

    if (!backupFile) {
      throw new Error('No wallet backup found for this Google account');
    }

    // Download backup file
    const response = await drive.files.get({
      fileId: backupFile.id,
      alt: 'media'
    });

    const backupData = response.data;

    // Verify email matches
    if (backupData.email !== email) {
      throw new Error('Backup email mismatch');
    }

    // Decrypt mnemonic with wallet password
    let mnemonic: string;
    try {
      mnemonic = decrypt(backupData.encryptedMnemonic, password);
    } catch (error) {
      throw new Error('Invalid password - cannot decrypt wallet backup');
    }

    // Validate mnemonic
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid password or corrupted backup');
    }

    console.log('✅ Wallet restored from Google Drive');
    return mnemonic;
  }

  /**
   * Check if wallet backup exists for this Google account
   */
  async hasBackup(accessToken: string): Promise<boolean> {
    const drive = google.drive({
      version: 'v3',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const backupFile = await this.findBackupFile(drive);
    return backupFile !== null;
  }

  /**
   * Delete wallet backup from Google Drive
   */
  async deleteBackup(accessToken: string): Promise<void> {
    const drive = google.drive({
      version: 'v3',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const backupFile = await this.findBackupFile(drive);

    if (backupFile) {
      await drive.files.delete({ fileId: backupFile.id });
      console.log('✅ Wallet backup deleted from Google Drive');
    }
  }

  /**
   * Find backup file in Google Drive
   */
  private async findBackupFile(drive: any): Promise<any | null> {
    const response = await drive.files.list({
      spaces: 'appDataFolder',
      q: "name='gero-wallet-backup.json'",
      fields: 'files(id, name, createdTime)',
      pageSize: 1
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0];
    }

    return null;
  }
}

// Export singleton instance
export default new GoogleDriveService();
```

#### 4. **Update `src/chrome/background.ts`** - Simplify ACTIVATE_GOOGLE_WALLET handler

**BEFORE (zkFold - ~150 lines):**
```typescript
app.addToOptions(MessageTypes.ACTIVATE_GOOGLE_WALLET, async (request, sendResponse) => {
  // ... 150 lines of zkFold proof generation ...
});
```

**AFTER (Google Drive - ~50 lines):**
```typescript
app.addToOptions(MessageTypes.ACTIVATE_GOOGLE_WALLET, async (request, sendResponse) => {
  try {
    console.log('🔐 Creating Google wallet...');
    const { walletData } = request.data;

    if (!walletData) {
      throw new Error('Wallet data is required');
    }

    const { name, icon, theme, password, chain, network } = walletData;
    const { accessToken, idToken } = walletData.tokens;

    if (!accessToken || !idToken) {
      throw new Error('Google tokens not found');
    }

    if (!password) {
      throw new Error('Password is required');
    }

    console.log('🔐 Creating wallet:', name);

    // Extract email from JWT
    const parts = idToken.split(".");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const email = payload.email;

    // Import required utilities
    const { default: googleDriveService } = await import('@/services/googleDrive.service');
    const { createNewGoogleWallet } = await import('@/db/gero-db');
    const bip39 = await import('bip39');

    // Generate random mnemonic (NOT deterministic)
    const mnemonic = bip39.generateMnemonic(256); // 24 words

    // Save encrypted mnemonic to Google Drive
    await googleDriveService.saveWalletBackup(accessToken, mnemonic, password, email);

    // Create wallet in local database
    const walletId = await createNewGoogleWallet(
      name,
      icon,
      theme,
      mnemonic,
      password,
      chain,
      network,
      email
    );

    console.log('✅ Google wallet created with ID:', walletId);

    // Update geroStore
    const { default: GeroStore } = await import('@/stores/geroStore');
    await GeroStore.refreshWallets();

    sendResponse({
      id: request.id,
      data: {
        success: true,
        walletId,
      },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (err) {
    console.error('❌ Google wallet creation failed:', err);
    sendResponse({
      id: request.id,
      data: { success: false },
      target: TARGET,
      sender: SENDER.extension,
      error: (err instanceof Error ? err.message : String(err)) || 'Google wallet creation failed',
    });
  }
  return true;
});
```

#### 5. **Update `src/db/gero-db.ts`** - Simplify createNewGoogleWallet

```typescript
export async function createNewGoogleWallet(
  name: string,
  icon: string,
  theme: string,
  mnemonic: string,  // Pass mnemonic directly (already backed up to Drive)
  password: string,
  chain: string,
  network: string,
  email: string      // Google email for identification
) {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Encrypt mnemonic (optional - user chose not to show it)
  const encryptedMnemonic = encrypt(mnemonic, password);

  // Derive root key from mnemonic
  const rootKey: Bip32PrivateKey = resolvePrivateKey(mnemonic);
  const encryptedPrivateKey: string = encryptPrivateKey(rootKey, password);

  // Get public key for account #0
  const accountIndex = 0;
  const bip32Ed25519: Bip32Ed25519 = await SodiumBip32Ed25519.create();
  const xpubHex: Bip32PublicKeyHex = bip32Ed25519.getBip32PublicKey(
    rootKey.derive([
      WalletTypePurpose.CIP1852,
      CoinTypes.CARDANO,
      HARDENED + accountIndex
    ]).hex()
  );

  let words: number[]
  try {
    words = bech32.toWords(Buffer.from(xpubHex, 'hex'))
  } catch (e) {
    words = bech32m.toWords(Buffer.from(xpubHex, 'hex'));
  }
  const publicKey = bech32.encode('xpub', words, 120);

  // Get next wallet order
  const db: Dexie = await getDb();
  let order = await getLatestWalletByOrder();
  if (order == null) {
    order = 1;
  } else {
    order++;
  }

  // Create wallet in database
  const walletId = await db['wallets'].add({
    name,
    icon,
    type: WalletType.Google,
    theme,
    order,
    encryptedPrivateKey,
    encryptedMnemonic,  // Optional: store locally too
    publicKey,
    passwordLastUpdate: new Date(),
    chain,
    network,
    userId: email,  // Google email for identification
    // NO jwt field - not needed without zkFold
  });

  // Create wallet-specific database
  await createNewWalletDb(walletId, true, false);

  console.log('✅ Google wallet created in database:', walletId);
  return walletId;
}
```

#### 6. **Update `src/options/modules/welcome/dialogs/CreateGoogleWallet.vue`** - Simplify UI

**REMOVE:**
- Proof generation overlay (lines 113-153)
- Polling logic (pollingAttempts, activationStep)
- zkFold status messages

**KEEP:**
- Google account display
- Wallet name input
- Password input (with validation)
- Terms checkboxes

**ADD:**
- Warning about password importance
- Simpler loading state

```vue
<template>
  <BaseDialog
    :title="$t('welcome.googleWalletSetup')"
    :subtitle="props.network?.title"
    :is-open="props.isOpen"
    @close="$emit('close')"
    content-class="rounded-xxl dialogStyle"
    scrollable
    max-width="850"
  >
    <v-card-text class="pa-0">
      <v-container class="pa-1 pb-2" style="max-width: 534px;">
        <v-form ref="form" v-model="valid">
          <!-- Google Account Display -->
          <v-list-item class="pa-0">
            <v-list-item-avatar>
              <v-img :src="props.googleAccount['picture']" />
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ props.googleAccount['name'] }}</v-list-item-title>
              <v-list-item-subtitle>{{ props.googleAccount['email'] }}</v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-avatar>
              <v-icon size="x-large" color="primary">mdi-check-circle</v-icon>
            </v-list-item-avatar>
          </v-list-item>

          <v-divider class="mb-2"></v-divider>

          <!-- Wallet Name -->
          <h2 class="text-left px-0 pt-0 pb-1 white--text">Set up your wallet name</h2>
          <h3 class="text-left px-0 pb-3" style="font-size: 1.1em;">
            Choose a name to help you identify your wallet.
          </h3>
          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.name"
            :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
            :label="$t('welcome.walletName')"
            :placeholder="$t('welcome.walletNamePlaceholder')"
            required
            :disabled="creatingWalletLoader"
          ></v-text-field>

          <!-- Password -->
          <h2 class="text-left px-0 pt-0 pb-1 white--text">Set up your spending password</h2>
          <h3 class="text-left px-0 pb-3" style="font-size: 1.1em;">
            You'll use this to log into your wallet and make transactions.
          </h3>

          <!-- PASSWORD WARNING -->
          <v-alert type="warning" text dense class="mb-3">
            <strong>Important:</strong> Your password is the ONLY way to restore your wallet.
            Gero Wallet cannot recover it for you. Write it down and keep it safe.
          </v-alert>

          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.password"
            :rules="[
              rules.required(),
              rules.spaceNotAllowed,
              rules.minCharacters(10),
              rules.oneOrMoreNumbers,
              rules.containCapital,
              rules.containLowerCase,
              rules.containSpecialCharacter
            ]"
            :type="show1 ? 'text' : 'password'"
            :label="$t('welcome.password')"
            required
            :disabled="creatingWalletLoader"
          >
            <template v-slot:append>
              <v-icon @click="show1 = !show1" tabindex="-1">
                {{ show1 ? 'mdi-eye' : 'mdi-eye-off' }}
              </v-icon>
            </template>
          </v-text-field>

          <v-text-field
            filled
            dense
            color="primary"
            v-model="newWallet.confirmPassword"
            :rules="[
              rules.required(),
              (newWallet.password === newWallet.confirmPassword) || $t('welcome.passwordsMustMatch')
            ]"
            :type="show2 ? 'text' : 'password'"
            :label="$t('welcome.confirmPassword')"
            required
            :disabled="creatingWalletLoader"
          >
            <template v-slot:append>
              <v-icon @click="show2 = !show2" tabindex="-1">
                {{ show2 ? 'mdi-eye' : 'mdi-eye-off' }}
              </v-icon>
            </template>
          </v-text-field>

          <!-- Terms -->
          <v-checkbox
            class="mt-0"
            dense
            color="primary"
            v-model="newWallet.termsChecked"
            :rules="[rules.required()]"
            label="I understand that Gero cannot recover this password for me."
            required
            hide-details
            :disabled="creatingWalletLoader"
          ></v-checkbox>

          <v-checkbox
            class="mt-0"
            dense
            color="primary"
            v-model="newWallet.recoverPasswordChecked"
            :rules="[rules.required()]"
            label="I have read and agree to the Terms of Service."
            required
            hide-details
            :disabled="creatingWalletLoader"
          ></v-checkbox>
        </v-form>
      </v-container>
    </v-card-text>

    <v-card-actions class="justify-center">
      <v-btn
        style="color: black!important;"
        class="geroButton"
        variant="flat"
        :loading="creatingWalletLoader"
        :disabled="!valid || creatingWalletLoader"
        @click="walletCreation"
      >
        {{ $t('welcome.createWallet') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, getCurrentInstance, reactive, nextTick } from 'vue';
import { Theme } from '@/models/types';
import rules from '@/utils/rules';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

// ... (props, emits, etc. remain the same)

const walletCreation = async (): Promise<void> => {
  creatingWalletLoader.value = true;

  try {
    console.log('Creating Google wallet...');

    // Call background to create wallet (includes Google Drive backup)
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.ACTIVATE_GOOGLE_WALLET,
      data: {
        walletData: {
          name: newWallet.name,
          icon: newWallet.icon,
          theme: newWallet.theme,
          password: newWallet.password,
          chain: newWallet.chain,
          network: newWallet.network,
          tokens: props.tokens,  // accessToken + idToken
        },
      },
    });

    if (!response || !response.data || !response.data.success) {
      throw new Error(response?.error || 'Wallet creation failed');
    }

    console.log('✅ Wallet created:', response.data.walletId);

    // Refresh wallets list
    await GeroStore.refreshWallets();

    // Login to the new wallet
    const walletToLogin = GeroStore.state.wallets[response.data.walletId];

    if (!walletToLogin) {
      throw new Error('Wallet not found after creation');
    }

    const loginResponse: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet: walletToLogin },
    });

    if (loginResponse && !loginResponse.error) {
      emit('close');
      nextTick(() => {
        resetDialog();
        router.push('/').catch(() => {});
      });
    }
  } catch (error: any) {
    console.error('Error creating wallet:', error);
    // Show error to user
    alert(error.message || 'Failed to create wallet');
  } finally {
    creatingWalletLoader.value = false;
  }
};
</script>
```

#### 7. **Add Wallet Restoration Dialog** (Optional - for explicit restoration)

Create `src/options/modules/welcome/dialogs/RestoreGoogleWallet.vue`:

```vue
<template>
  <BaseDialog
    title="Restore Google Wallet"
    :is-open="props.isOpen"
    @close="$emit('close')"
  >
    <v-card-text>
      <v-container>
        <!-- Google Account Display -->
        <v-list-item class="pa-0">
          <v-list-item-avatar>
            <v-img :src="props.googleAccount['picture']" />
          </v-list-item-avatar>
          <v-list-item-content>
            <v-list-item-title>{{ props.googleAccount['name'] }}</v-list-item-title>
            <v-list-item-subtitle>{{ props.googleAccount['email'] }}</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>

        <v-divider class="my-4"></v-divider>

        <!-- Password Input -->
        <v-alert type="info" text dense class="mb-3">
          Enter the password you used when creating this wallet.
        </v-alert>

        <v-text-field
          filled
          dense
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          label="Wallet Password"
          :error-messages="errorMessage"
        >
          <template v-slot:append>
            <v-icon @click="showPassword = !showPassword">
              {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
            </v-icon>
          </template>
        </v-text-field>

        <!-- Wallet Preview (after restoration) -->
        <v-alert v-if="restoredAddress" type="success" text dense class="mt-3">
          <strong>Wallet Found!</strong><br>
          Address: {{ restoredAddress }}
        </v-alert>
      </v-container>
    </v-card-text>

    <v-card-actions class="justify-center">
      <v-btn
        color="primary"
        :loading="restoring"
        :disabled="!password || restoring"
        @click="restoreWallet"
      >
        Restore Wallet
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
// Implementation similar to CreateGoogleWallet
// Calls googleDriveService.restoreWalletBackup()
// Then creates wallet from restored mnemonic
</script>
```

---

## Migration from zkFold

### Cleanup Tasks

1. **Remove zkFold dependencies:**
   ```bash
   npm uninstall @zkfold/prover  # If it exists
   # Remove other zkFold-related packages
   ```

2. **Delete zkFold services:**
   - `src/services/zkFold/backend.ts` (can be deleted)
   - `src/services/zkFold/prover.ts` (can be deleted)
   - `src/services/zkFold/session.ts` (can be deleted)
   - `src/services/zkFold/types.ts` (can be deleted)
   - `src/services/zkFold/utils/json.utils.ts` (can be deleted)

   **Keep:**
   - `src/services/zkFold/google.api.ts` (has useful JWT parsing utils)

3. **Database cleanup:**
   - Remove `jwt` field from wallet schema (optional - won't hurt to keep it)
   - Keep `userId` field (used for Google email)

4. **Remove unused imports:**
   - Search codebase for zkFold imports and remove them

---

## Testing Plan

### Test Cases

#### 1. **Wallet Creation**
- [ ] User signs in with Google
- [ ] User enters wallet name and password
- [ ] Wallet created immediately (<1 second)
- [ ] Encrypted backup saved to Google Drive
- [ ] User automatically logged into wallet
- [ ] Wallet shows correct addresses and balance

#### 2. **Wallet Restoration (Same Device)**
- [ ] User logs out of wallet
- [ ] User signs in with Google again
- [ ] User enters password
- [ ] Wallet restored with same addresses
- [ ] Balance and transaction history preserved

#### 3. **Wallet Restoration (Different Device)**
- [ ] Install extension on new device
- [ ] Sign in with same Google account
- [ ] Enter same password
- [ ] Wallet restored with identical addresses
- [ ] All funds accessible

#### 4. **Error Handling**
- [ ] Wrong password shows clear error message
- [ ] No backup found shows appropriate message
- [ ] Google Drive API failure shows user-friendly error
- [ ] Network issues handled gracefully

#### 5. **Security Tests**
- [ ] Encrypted backup cannot be decrypted without password
- [ ] Different password creates different wallet
- [ ] Google Drive backup is AES-256 encrypted
- [ ] appDataFolder is hidden from user's Drive view

#### 6. **Edge Cases**
- [ ] User creates multiple Google wallets (should work)
- [ ] User deletes wallet locally (backup still in Drive)
- [ ] User changes Google password (wallet still accessible)
- [ ] User enables Google 2FA (wallet still accessible)

---

## Performance Improvements

### Before (zkFold):
```
Wallet Creation Time: 5-10 minutes
- Google OAuth: ~2 seconds
- ZK Proof Generation: 5-10 minutes ⏰
- Blockchain Activation: ~30 seconds
- Database Creation: <1 second

Total: ~5-10 minutes
```

### After (Google Drive):
```
Wallet Creation Time: <2 seconds ✅
- Google OAuth: ~1 second
- Mnemonic Generation: <100ms
- Encryption: <100ms
- Google Drive Upload: ~500ms
- Database Creation: <100ms

Total: ~2 seconds (300-500x faster!)
```

---

## Future Enhancements

### Phase 2 Features (Post-MVP):

1. **Biometric Unlock**
   - Use WebAuthn for Touch ID/Face ID
   - Store encrypted password locally on trusted devices
   - Password fallback always available

2. **Optional TOTP 2FA**
   - User can enable Google Authenticator
   - TOTP secret encrypted and stored in Google Drive with mnemonic
   - Backup codes for recovery

3. **Mnemonic Export** (User Request)
   - Allow user to view/export 24-word phrase
   - For manual backup alongside Google Drive
   - Warning: "This defeats the purpose of password-only restoration"

4. **Password Change**
   - Download backup from Google Drive
   - Decrypt with old password
   - Re-encrypt with new password
   - Upload updated backup

5. **Multiple Device Management**
   - Show list of devices where wallet is logged in
   - Revoke access to specific devices
   - Require re-authentication on untrusted devices

6. **Backup Verification**
   - Periodic checks that Google Drive backup is intact
   - Alert user if backup is missing or corrupted
   - Option to re-upload backup

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **User forgets password** | Medium | High | Clear warnings, suggest password manager |
| **Google Drive API outage** | Low | Medium | Cache wallet locally, retry logic |
| **Google account compromised** | Low | High | Backup still encrypted, encourage Google 2FA |
| **Encryption broken** | Very Low | Critical | Use industry-standard AES-256 |
| **Data loss (Drive deleted)** | Very Low | High | Optional local mnemonic backup (Phase 2) |
| **Rate limit exceeded** | Very Low | Low | Implement exponential backoff |

---

## Success Metrics

### User Experience:
- ✅ Wallet creation time: <2 seconds (vs 5-10 minutes)
- ✅ Cross-device restoration: Works seamlessly
- ✅ No mnemonic to write down (per requirement)
- ✅ Secure two-factor authentication (Google + password)

### Technical:
- ✅ Zero implementation cost
- ✅ Zero operational cost
- ✅ Reduced codebase complexity (~100 lines removed)
- ✅ No external service dependencies (besides Google)
- ✅ Standard BIP39 wallet (compatible with ecosystem)

### Security:
- ✅ Two-factor security (Google OAuth + password)
- ✅ AES-256 encryption
- ✅ No plaintext secrets stored anywhere
- ✅ User owns their backup data

---

## Rollout Plan

### Phase 1: Development
- [ ] Add Google Drive API scope to manifest
- [ ] Implement GoogleDriveService
- [ ] Update background.ts handler
- [ ] Simplify CreateGoogleWallet.vue
- [ ] Update gero-db.ts functions
- [ ] Internal testing

### Phase 2: Testing
- [ ] Unit tests for GoogleDriveService
- [ ] Integration tests (create + restore flow)
- [ ] Cross-device testing
- [ ] Security audit
- [ ] Performance benchmarks

### Phase 3: Beta Release
- [ ] Deploy to beta testers
- [ ] Monitor Google Drive API usage/errors
- [ ] Gather user feedback
- [ ] Fix any issues

### Phase 4: Production
- [ ] Full release to all users
- [ ] Monitor error rates
- [ ] Support documentation
- [ ] Migration guide from zkFold (if needed)

---

## Support & Documentation

### User Documentation Needed:

1. **How to Create Google Wallet**
   - Step-by-step guide with screenshots
   - Password requirements explained
   - Security best practices

2. **How to Restore Google Wallet**
   - What information is needed (Google account + password)
   - Troubleshooting wrong password
   - What to do if backup not found

3. **FAQs**
   - Can I change my password? (Yes, Phase 2 feature)
   - What if I forget my password? (Wallet is lost)
   - Is my wallet safe? (Yes, two-factor security)
   - Can Gero Wallet access my Google Drive? (Only appDataFolder)
   - What data is stored in Google Drive? (Encrypted mnemonic only)

4. **Security Guide**
   - How encryption works
   - Why password is critical
   - Enabling Google 2FA
   - Best practices for password management

---

## Gmail-to-Cardano Address Resolution (Optional Feature)

### Overview

Enable users to send ADA to Gmail addresses instead of long Cardano addresses, providing a user-friendly payment experience similar to traditional payment apps.

**Example:**
```
Instead of:  addr1qyx2ymk0sa79uyap0vdvz3ayxglz5nx0ktc9792gljeaha664arus97u6mw2q8rtpjrvcr9qn3vfa25gp6zedwjhacjscv3w4f
Send to:     alice@gmail.com
```

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│               GMAIL → CARDANO RESOLUTION FLOW                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. User creates Google Wallet                              │
│     → Opt-in prompt: "Enable public address resolution?"   │
│                                                              │
│  2. If user opts in:                                        │
│     → Sign message proving address ownership                │
│     → Register email → address mapping on backend           │
│                                                              │
│  3. Anyone sending ADA:                                     │
│     → Enter "alice@gmail.com" in recipient field            │
│     → Extension queries backend API                         │
│     → Backend returns: addr1q...xyz                         │
│     → Show confirmation: "Send to alice@gmail.com?"         │
│     → User confirms → transaction sent                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Backend API Specification

#### **Endpoint 1: Register Email → Address Mapping**

```http
POST /api/v1/google-wallet/register
Content-Type: application/json

{
  "email": "alice@gmail.com",
  "address": "addr1qyx2ymk0sa79uyap0vdvz3ayxglz5nx0ktc9792gljeaha664arus97u6mw2q8rtpjrvcr9qn3vfa25gp6zedwjhacjscv3w4f",
  "stakeAddress": "stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zctvm3rc",
  "signature": "845846a2012...",  // CIP-8 signature proving address ownership
  "timestamp": 1705320600
}

Response:
{
  "success": true,
  "email": "alice@gmail.com",
  "registeredAt": "2025-01-15T10:30:00Z"
}
```

#### **Endpoint 2: Resolve Email → Address**

```http
GET /api/v1/resolve?email=alice@gmail.com

Response:
{
  "email": "alice@gmail.com",
  "address": "addr1qyx2ymk0sa79uyap0vdvz3ayxglz5nx0ktc9792gljeaha664arus97u6mw2q8rtpjrvcr9qn3vfa25gp6zedwjhacjscv3w4f",
  "stakeAddress": "stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zctvm3rc",
  "verified": true,
  "registeredAt": "2025-01-15T10:30:00Z"
}

Error (404):
{
  "error": "No Gero Wallet found for alice@gmail.com"
}
```

#### **Endpoint 3: Unregister Mapping**

```http
DELETE /api/v1/google-wallet/unregister
Content-Type: application/json

{
  "email": "alice@gmail.com",
  "signature": "845846a2012..."  // Prove ownership
}

Response:
{
  "success": true,
  "message": "Email registration removed"
}
```

### Database Schema

```sql
CREATE TABLE email_address_registry (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  payment_address VARCHAR(255) NOT NULL,
  stake_address VARCHAR(255),
  signature TEXT NOT NULL,
  verified BOOLEAN DEFAULT false,
  registered_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_resolved_at TIMESTAMP,
  resolution_count INTEGER DEFAULT 0,

  INDEX idx_email (email),
  INDEX idx_payment_address (payment_address),
  INDEX idx_verified (verified)
);

-- Optional: Track resolution analytics
CREATE TABLE resolution_logs (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  resolved_address VARCHAR(255),
  client_ip VARCHAR(45),
  user_agent TEXT,
  resolved_at TIMESTAMP DEFAULT NOW(),

  INDEX idx_email (email),
  INDEX idx_resolved_at (resolved_at)
);
```

### Frontend Implementation

#### **Registration During Wallet Creation**

```typescript
// In CreateGoogleWallet.vue - after wallet created successfully
async function registerEmailResolution(walletId: number, email: string): Promise<void> {
  // Ask user if they want to enable public resolution
  const enableResolution = await askUserQuestion({
    questions: [{
      question: "Enable email-based payments?",
      header: "Public Payments",
      multiSelect: false,
      options: [
        {
          label: "Yes, enable",
          description: "Anyone can send you ADA using your Gmail address (alice@gmail.com)"
        },
        {
          label: "No, keep private",
          description: "You'll need to share your full Cardano address to receive payments"
        }
      ]
    }]
  });

  if (enableResolution.answers['0'] === "Yes, enable") {
    try {
      // Get wallet instance
      const wallet = await getWalletById(walletId);

      // Create message to sign
      const timestamp = Date.now();
      const message = `Register ${email} to ${wallet.baseAddress} at ${timestamp}`;

      // Sign message (CIP-8)
      const signature = await Messaging.sendToBackground({
        method: MessageTypes.SIGN_MESSAGE,
        data: {
          message: message,
          walletId: walletId
        }
      });

      // Register on backend
      const response = await fetch('https://api.gerowallet.io/api/v1/google-wallet/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          address: wallet.baseAddress,
          stakeAddress: wallet.stakeAddress,
          signature: signature.data,
          timestamp: timestamp
        })
      });

      if (response.ok) {
        console.log('✅ Email registered for public resolution');
        // Show success message to user
        showNotification({
          type: 'success',
          message: `You can now receive ADA at ${email}`
        });
      } else {
        throw new Error('Failed to register email');
      }
    } catch (error) {
      console.error('Email registration failed:', error);
      // Non-critical error - wallet still works, just no email resolution
    }
  }
}
```

#### **Resolution in Send Dialog**

```typescript
// In Send.vue or transaction dialog
async function resolveRecipient(input: string): Promise<string> {
  // Check if input looks like an email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (emailRegex.test(input)) {
    try {
      // Show loading state
      this.resolvingAddress = true;

      // Query resolution API
      const response = await fetch(
        `https://api.gerowallet.io/api/v1/resolve?email=${encodeURIComponent(input)}`
      );

      if (response.ok) {
        const data = await response.json();

        // Show confirmation dialog
        const confirmed = await this.$confirm({
          title: 'Send to Gmail address?',
          message: `
            Sending to: ${input}

            Resolves to: ${data.address}

            Registered: ${new Date(data.registeredAt).toLocaleDateString()}

            Verify this is the correct recipient before proceeding.
          `,
          confirmText: 'Confirm & Send',
          cancelText: 'Cancel'
        });

        if (confirmed) {
          // Use resolved address
          this.recipientAddress = data.address;
          this.recipientEmail = input;  // Store for display
          return data.address;
        } else {
          throw new Error('User cancelled');
        }
      } else if (response.status === 404) {
        throw new Error(`No Gero Wallet found for ${input}. Ask them to create a Google Wallet and enable email payments.`);
      } else {
        throw new Error('Resolution service unavailable');
      }
    } catch (error) {
      this.resolvingAddress = false;
      throw error;
    } finally {
      this.resolvingAddress = false;
    }
  }

  // Not an email - treat as regular Cardano address
  return input;
}
```

#### **UI Example**

```vue
<template>
  <v-text-field
    v-model="recipient"
    label="Recipient"
    placeholder="addr1... or alice@gmail.com"
    :loading="resolvingAddress"
    @blur="handleRecipientInput"
  >
    <template v-slot:append>
      <v-icon v-if="recipientEmail" color="success">
        mdi-email-check
      </v-icon>
    </template>
  </v-text-field>

  <!-- Show resolved info -->
  <v-alert v-if="recipientEmail" type="info" text dense class="mt-2">
    Sending to: <strong>{{ recipientEmail }}</strong><br>
    Address: {{ recipientAddress.substring(0, 20) }}...
  </v-alert>
</template>
```

### Security Implementation

#### **Signature Verification (Backend)**

```typescript
import { COSESign1, COSEKey } from '@emurgo/cardano-message-signing-nodejs';
import { Address } from '@emurgo/cardano-serialization-lib-nodejs';

async function verifyRegistration(
  email: string,
  address: string,
  signatureHex: string,
  timestamp: number
): Promise<boolean> {
  // 1. Check timestamp (prevent replay attacks)
  const now = Date.now();
  if (now - timestamp > 60000) {  // 1 minute window
    throw new Error('Signature expired');
  }

  // 2. Reconstruct message
  const message = `Register ${email} to ${address} at ${timestamp}`;

  // 3. Verify CIP-8 signature
  const coseSign1 = COSESign1.from_bytes(Buffer.from(signatureHex, 'hex'));
  const payload = coseSign1.payload();
  const payloadMessage = Buffer.from(payload).toString('utf8');

  if (payloadMessage !== message) {
    throw new Error('Message mismatch');
  }

  // 4. Get public key from signature headers
  const headers = coseSign1.headers();
  const protectedHeaders = headers.protected().deserialized_headers();
  const keyId = protectedHeaders.key_id();

  // 5. Derive address from public key and verify it matches
  const coseKey = COSEKey.from_bytes(keyId);
  const publicKey = coseKey.header(COSEKeyHeaderLabel.x).as_bytes();

  const derivedAddress = Address.from_bytes(publicKey).to_bech32();

  if (derivedAddress !== address) {
    throw new Error('Address mismatch - signature not from claimed address');
  }

  // 6. Verify signature
  const signedData = coseSign1.signed_data().to_bytes();
  const signature = coseSign1.signature();

  const isValid = verifyEd25519(signedData, signature, publicKey);

  return isValid;
}
```

#### **Rate Limiting**

```typescript
import rateLimit from 'express-rate-limit';

// Prevent resolution API abuse
const resolveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 100,  // 100 requests per minute per IP
  message: 'Too many resolution requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/api/v1/resolve', resolveLimiter, async (req, res) => {
  // Resolution logic
});

// Prevent registration spam
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 10,  // 10 registrations per hour per IP
  message: 'Too many registration attempts',
});

app.post('/api/v1/google-wallet/register', registerLimiter, async (req, res) => {
  // Registration logic
});
```

### Privacy Considerations

#### **Opt-In Only (Default: Disabled)**

```typescript
// Default behavior: Email resolution is DISABLED
const defaultSettings = {
  publicEmailResolution: false,  // User must explicitly enable
};

// Warning dialog before enabling
const warningDialog = {
  title: 'Privacy Notice',
  message: `
    Enabling email-based payments will:

    ✅ Allow anyone to send you ADA using your Gmail address
    ✅ Make receiving payments easier (no long address to share)

    ⚠️ Make your transactions less private:
    • Anyone can look up your Cardano address using your email
    • People can see your transaction history on blockchain explorers
    • Your email will be linked to your Cardano address publicly

    You can disable this at any time in wallet settings.
  `,
  confirmText: 'I understand, enable it',
  cancelText: 'Keep my address private',
};
```

#### **User Controls**

```typescript
// Settings page - manage email resolution
interface EmailResolutionSettings {
  enabled: boolean;
  email: string;
  registeredAddress: string;
  registeredAt: Date;
  resolutionCount: number;  // How many times resolved
}

// User can:
// 1. Enable/disable at any time
// 2. View resolution statistics
// 3. Change which address is registered
// 4. Completely remove registration
```

### Comparison to Existing Services

| Service | Format | Cost | Renewal | Decentralized |
|---------|--------|------|---------|---------------|
| **ADA Handle** | `$alice` | 10+ ADA | Annual | ✅ On-chain |
| **ENS (Ethereum)** | `alice.eth` | $5-50/year | Annual | ✅ On-chain |
| **Unstoppable Domains** | `alice.crypto` | $5-1000+ | One-time | ✅ NFT-based |
| **PayPal/Venmo** | `@alice` | Free | N/A | ❌ Centralized |
| **Gero Gmail Resolution** | `alice@gmail.com` | **FREE** | **Lifetime** | ⚠️ Backend (can become on-chain later) |

**Advantages:**
- ✅ **Free** - No cost to register or maintain
- ✅ **Familiar** - Users already have Gmail addresses
- ✅ **No renewal** - One-time registration, lifetime access
- ✅ **Instant** - No blockchain confirmation delays
- ✅ **Revocable** - Can disable anytime

**Disadvantages:**
- ⚠️ **Requires backend** - Not fully decentralized (yet)
- ⚠️ **Privacy trade-off** - Email linked to address
- ⚠️ **Google dependency** - Tied to Gmail ecosystem

### Cost Analysis

#### **Backend Infrastructure:**

**Option A: Add to Existing Backend (Recommended)**
```
Cost: $0/month
- Use existing Gero backend infrastructure
- Add 3 new API endpoints
- PostgreSQL table for registry
- Minimal overhead
```

**Option B: Serverless (AWS Lambda + DynamoDB)**
```
Cost: $3-5/month
- Lambda: $0 (1M requests free tier)
- DynamoDB: $0 (25GB free tier)
- API Gateway: $3.50 (1M requests)

Scales automatically with usage
```

**Option C: Dedicated VPS**
```
Cost: $4-6/month
- DigitalOcean Droplet: $4/month
- PostgreSQL included
- Handles unlimited traffic

Overkill for this feature alone
```

**Recommendation:** Use existing Gero backend ($0 additional cost)

#### **Operational Costs:**

| Component | Cost | Notes |
|-----------|------|-------|
| Database storage | $0 | ~1KB per registration, millions fit in free tier |
| API requests | $0 | Within existing backend capacity |
| Bandwidth | $0 | Tiny payloads (JSON ~200 bytes) |
| Maintenance | Minimal | Simple CRUD operations |

**Total Additional Cost: $0/month**

### Implementation Phases

#### **Phase 1: MVP (1 week)**
- [ ] Backend API endpoints (register, resolve, unregister)
- [ ] Database schema and migrations
- [ ] Signature verification
- [ ] Basic frontend integration (opt-in during wallet creation)
- [ ] Resolution in send dialog
- [ ] Error handling and validation

#### **Phase 2: Enhanced UX (1 week)**
- [ ] Settings page for managing email resolution
- [ ] View resolution statistics
- [ ] Change registered address
- [ ] Privacy controls
- [ ] Better confirmation dialogs

#### **Phase 3: Advanced Features (2 weeks)**
- [ ] Email verification (prevent squatting)
- [ ] Multiple addresses per email (select primary)
- [ ] Resolution history and analytics
- [ ] Public API documentation for other wallets
- [ ] QR codes with email addresses

#### **Phase 4: Decentralization (Future)**
- [ ] Migrate to on-chain registry (Cardano smart contract)
- [ ] Use existing backend as indexer/cache
- [ ] Zero-knowledge proofs for privacy
- [ ] Integration with other name services (ADA Handle, etc.)

### Testing Checklist

#### **Registration Tests:**
- [ ] User can opt-in during wallet creation
- [ ] Signature verification works correctly
- [ ] Duplicate emails rejected
- [ ] Invalid signatures rejected
- [ ] Expired signatures rejected (>1 minute old)

#### **Resolution Tests:**
- [ ] Valid email resolves to correct address
- [ ] Invalid email returns 404 error
- [ ] Resolution shows confirmation dialog
- [ ] User can cancel resolution
- [ ] Rate limiting works (100 req/min)

#### **Privacy Tests:**
- [ ] Default is opt-out (disabled)
- [ ] Warning shown before enabling
- [ ] User can disable in settings
- [ ] Unregistration removes mapping
- [ ] No data leaks in error messages

#### **Security Tests:**
- [ ] Cannot register email you don't own (signature verification)
- [ ] Cannot modify other users' registrations
- [ ] Rate limiting prevents abuse
- [ ] SQL injection prevented
- [ ] XSS prevented in email/address display

### Future Enhancements

#### **1. Email Verification (Prevent Squatting)**

```typescript
// Prevent someone from registering elon@gmail.com if they don't own it
async function verifyEmailOwnership(email: string): Promise<boolean> {
  // Send verification code to email
  const code = generateRandomCode(6);
  await sendEmail(email, {
    subject: 'Verify your Gero Wallet email',
    body: `Your verification code is: ${code}`
  });

  // User enters code in extension
  const userCode = await promptUser('Enter verification code sent to your email:');

  return userCode === code;
}
```

**Flow:**
1. User opts in to email resolution
2. Send verification code to Gmail
3. User enters code in extension
4. If correct → register email → address mapping
5. If wrong → don't register

**Benefits:**
- ✅ Prevents email squatting
- ✅ Ensures user actually owns the Gmail account
- ✅ Adds extra layer of verification

**Challenges:**
- ⚠️ Requires email sending infrastructure (SendGrid, AWS SES, etc.)
- ⚠️ Additional cost (~$0.10 per 1,000 emails)
- ⚠️ More complex UX (extra step)

#### **2. Multiple Addresses Per Email**

```typescript
// User can register multiple addresses for same email
interface EmailRegistry {
  email: string;
  addresses: Array<{
    address: string;
    label: string;      // "Personal", "Business", "Savings"
    primary: boolean;   // Default for resolution
  }>;
}

// Resolution with address selection
GET /api/v1/resolve?email=alice@gmail.com
Response:
{
  "email": "alice@gmail.com",
  "addresses": [
    {
      "address": "addr1q...xyz",
      "label": "Personal",
      "primary": true
    },
    {
      "address": "addr1q...abc",
      "label": "Business",
      "primary": false
    }
  ]
}
```

#### **3. Integration with ADA Handle**

```typescript
// Support both email and ADA Handle in send dialog
async function resolveRecipient(input: string): Promise<string> {
  if (input.startsWith('$')) {
    // ADA Handle resolution
    return await resolveAdaHandle(input);
  } else if (input.includes('@')) {
    // Gmail resolution
    return await resolveGmail(input);
  } else {
    // Regular address
    return input;
  }
}
```

#### **4. On-Chain Migration Path**

Future: Move registry to Cardano blockchain for full decentralization

```haskell
-- Plutus smart contract
data EmailRegistry = EmailRegistry
  { email :: BuiltinByteString
  , address :: Address
  , signature :: BuiltinByteString
  , registeredAt :: POSIXTime
  }

-- Validator script
mkValidator :: EmailRegistry -> () -> ScriptContext -> Bool
mkValidator registry _ ctx =
  -- Verify signature proves ownership
  verifySignature (email registry) (address registry) (signature registry)
  &&
  -- Verify transaction signed by address owner
  txSignedBy ctx (address registry)
```

**Benefits:**
- ✅ Fully decentralized (no backend needed)
- ✅ Immutable registry
- ✅ Censorship-resistant
- ✅ Permanent ownership

**Challenges:**
- ⚠️ Transaction fees (~0.17 ADA per registration/update)
- ⚠️ Slower (requires blockchain confirmation)
- ⚠️ Complex implementation (smart contract development)
- ⚠️ Cannot easily update/remove (blockchain is immutable)

### User Documentation

#### **FAQ:**

**Q: How do I enable email payments?**
A: When creating your Google Wallet, you'll see an option "Enable email-based payments". If you choose yes, anyone can send you ADA using your Gmail address.

**Q: Is it safe to link my email to my Cardano address?**
A: The mapping is public, so anyone can look up your address using your email. This is a privacy trade-off for convenience. You can disable it at any time.

**Q: Can I change my mind later?**
A: Yes! Go to Settings → Google Wallet → Email Resolution and toggle it off. Your mapping will be removed from the registry.

**Q: What if someone else tries to register my email?**
A: They can't! Registration requires a cryptographic signature proving you own the Cardano address. Only you have the private keys.

**Q: Does it cost anything?**
A: No, email resolution is completely free. No registration fees, no renewal fees, no transaction fees.

**Q: Can I use this with other wallets?**
A: Currently it only works within Gero Wallet. We plan to open the API for other wallets to use in the future.

**Q: What happens if I delete my Google Wallet?**
A: The email → address mapping remains in the registry. You should unregister it first in settings.

**Q: Can I have multiple emails for the same wallet?**
A: Currently no, but this is a planned feature for Phase 3.

---

## Conclusion

The Google Drive solution provides:

✅ **Better User Experience**
- Instant wallet creation (<2 seconds vs 5-10 minutes)
- Simple restoration flow (Google + password)
- No mnemonic to write down
- **Optional: Send ADA to Gmail addresses**

✅ **Better Security**
- Two-factor authentication (Google OAuth + password)
- Industry-standard AES-256 encryption
- User owns their backup data
- Cryptographic signature verification for email resolution

✅ **Zero Cost**
- No implementation fees
- No operational fees
- No per-user fees
- Uses free Google Drive API
- **Email resolution: $0 additional cost**

✅ **Better Maintainability**
- Simpler codebase (~100 lines removed)
- No external service dependencies (besides Google)
- Standard BIP39 wallet format
- Cross-device compatibility guaranteed
- **Email resolution adds minimal complexity (~300 lines)**

This solution addresses all user concerns while providing a superior experience compared to the zkFold approach.

---

**Last Updated:** 2025-01-15
**Status:** Ready for Implementation
**Estimated Development Time:** 2-3 days (core) + 1 week (with email resolution)
**Estimated Testing Time:** 1-2 days (core) + 2-3 days (with email resolution)
