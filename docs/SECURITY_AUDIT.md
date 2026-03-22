# GeroWallet Security Audit for Open Source Release

**Date:** December 2025
**Purpose:** Identify and document sensitive data that must be removed before public release

---

## Executive Summary

This audit identified several categories of sensitive data in the GeroWallet codebase:

| Category                 | Status             | Action Required                                 |
|--------------------------|--------------------|-------------------------------------------------|
| Environment files (.env) | Already gitignored | Delete from git history if previously committed |
| Hardcoded API keys       | **CRITICAL**       | Must be moved to environment variables          |
| Hardcoded service URLs   | Medium             | Should be configurable                          |
| Private key handling     | OK                 | Properly encrypted                              |

---

## CRITICAL: Issues Fixed

### 1. Hardcoded API Key in Source Code - FIXED

**Files fixed:**

#### `src/api/zkFoldApi.ts` - FIXED
```typescript
// Now uses environment variable with fallback (bracket notation for TypeScript)
baseURL: import.meta.env['VITE_ZKFOLD_API_URL'] || 'https://wallet-api.zkfold.io',
...(import.meta.env['VITE_ZKFOLD_API_KEY'] ? { 'api-key': import.meta.env['VITE_ZKFOLD_API_KEY'] } : {}),
```

#### `src/chrome/background.ts` - FIXED
```typescript
// Now uses environment variables (bracket notation for TypeScript)
const zkFoldUrl = import.meta.env['VITE_ZKFOLD_API_URL'] || 'https://wallet-api.zkfold.io';
const zkFoldApiKey = import.meta.env['VITE_ZKFOLD_API_KEY'] || null;
const backend = new Backend(zkFoldUrl, zkFoldApiKey);
```

#### `src/services/zkFold/prover.ts` - FIXED
```typescript
// Now uses environment variable (bracket notation for TypeScript)
const proverUrl = import.meta.env['VITE_ZKFOLD_PROVER_URL'] || 'https://wallet-prover.zkfold.io';
```

#### `src/services/kaiserEx.service.ts` - FIXED
```typescript
// Now uses environment variable
const backendUrl = import.meta.env['VITE_KAISEREX_OAUTH_URL'] || 'https://oauth-sa.kaiserex.com';
```

### 2. Environment Files Contain Production Secrets

The following `.env` files contain real API keys and must NEVER be committed to a public repository:

| File               | Contains                                               | Risk Level   |
|--------------------|--------------------------------------------------------|--------------|
| `.env.production`  | LIVE MoonPay API key, Ably key, Google Client ID       | **CRITICAL** |
| `.env.beta`        | Beta keys (slightly less critical but still sensitive) | **HIGH**     |
| `.env.development` | Test/sandbox keys                                      | Medium       |

**Secrets found in .env.production:**
- `VITE_MOONPAY_API_KEY=pk_live_...` - Production MoonPay API key
- `VITE_GUARDARIAN_API_KEY=...` - Guardarian API key
- `VITE_ABLY_API_KEY=...` - Ably realtime messaging key
- `GOOGLE_CLIENT_ID=...` - Google OAuth client ID
- `MANIFEST_KEY=...` - Chrome extension signing key
- `VITE_LD_CLIENT_SIDE_ID=...` - LaunchDarkly client ID
- `VITE_CASHBACK_IDENTIFIER=...` - Cashback service identifier

**Action required:**
1. Delete all `.env*` files from the repository
2. Ensure `.env*` is in `.gitignore` (already done)
3. Create `.env.example` as a template (without real values)
4. If `.env` files were ever committed, purge from git history

---

## MEDIUM: Hardcoded Service URLs - ALL FIXED

All hardcoded URLs have been converted to use environment variables:

### `src/api/zkFoldApi.ts` - FIXED
```typescript
baseURL: import.meta.env['VITE_ZKFOLD_API_URL'] || 'https://wallet-api.zkfold.io'
```

### `src/services/zkFold/prover.ts` - FIXED
```typescript
const proverUrl = import.meta.env['VITE_ZKFOLD_PROVER_URL'] || 'https://wallet-prover.zkfold.io';
```

### `src/services/kaiserEx.service.ts` - FIXED
```typescript
const backendUrl = import.meta.env['VITE_KAISEREX_OAUTH_URL'] || 'https://oauth-sa.kaiserex.com';
```

### `src/api/strike-finance.api.ts` - Already OK
```typescript
baseURL: import.meta.env.VITE_BACKEND_URL || 'https://dev.gerowallet.io'
// The fallback is acceptable for open source
```

---

## LOW: Items Already Handled Correctly

### Private Key Security
- Private keys are encrypted using ChaCha20-Poly1305 (EMIP3 compatible)
- Encryption/decryption happens in background script (isolated context)
- Keys never exposed to content scripts or web pages
- Password-based key derivation with PBKDF2-HMAC-SHA512

### OAuth Token Handling
- OAuth tokens fetched from cookies/storage at runtime
- Client IDs come from manifest.json or environment variables
- Proper PKCE flow implementation for KaiserEx

### API Key Externalization
- MoonPay, Guardarian, Ably keys use environment variables
- LaunchDarkly client ID uses environment variable
- Backend URL uses environment variable

---

## Recommended Actions

### Before Open Source Release

1. **Delete .env files from repository** (keep only .env.example)
   ```bash
   git rm --cached .env .env.production .env.development .env.beta
   ```

2. **Fix hardcoded API key in zkFoldApi.ts**
   - Replace `'api-key': '123456'` with environment variable

3. **Fix hardcoded API key in background.ts**
   - Replace hardcoded Backend constructor call

4. **Create .env.example template**
   - Include all required variables with placeholder values

5. **Update README/CONTRIBUTING docs**
   - Document required environment variables
   - Explain how to obtain API keys for development

### If .env Files Were Previously Committed

If `.env` files with real secrets were ever committed to git history:

```bash
# Install BFG Repo-Cleaner
# Then run:
bfg --delete-files .env
bfg --delete-files .env.production
bfg --delete-files .env.development
bfg --delete-files .env.beta
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

**WARNING:** This rewrites git history. Coordinate with team before running.

---

## Files Modified (Completed)

| File                               | Change Made                       | Status   |
|------------------------------------|-----------------------------------|----------|
| `src/api/zkFoldApi.ts`             | Moved API key and URL to env vars | **DONE** |
| `src/chrome/background.ts`         | Moved zkFold config to env vars   | **DONE** |
| `src/services/zkFold/prover.ts`    | Made URL configurable             | **DONE** |
| `src/services/kaiserEx.service.ts` | Made URL configurable             | **DONE** |
| `.env.example`                     | Created template file             | **DONE** |

---

## New Environment Variables to Add

Add these to `.env.example`:

```env
# zkFold API (for Google Wallet feature)
VITE_ZKFOLD_API_URL=https://wallet-api.zkfold.io
VITE_ZKFOLD_API_KEY=your_zkfold_api_key_here

# KaiserEx OAuth (for Gero Card)
VITE_KAISEREX_OAUTH_URL=https://oauth-sa.kaiserex.com
```

---

## Verification Checklist

Before release, verify:

- [ ] No `.env` files in repository (only `.env.example`)
- [ ] No hardcoded API keys in source code
- [ ] All sensitive URLs use environment variables
- [ ] Git history cleaned if secrets were previously committed
- [ ] README documents required environment variables
- [ ] All API keys in production are rotated (assume compromised)

---

## Third-Party Services Reference

These services require API keys for full functionality:

| Service      | Purpose                      | Key Type          |
|--------------|------------------------------|-------------------|
| MoonPay      | Fiat on-ramp                 | Public key (pk_*) |
| Guardarian   | Fiat on-ramp                 | API key           |
| Ably         | Real-time blockchain updates | API key with auth |
| Google       | OAuth for Google Wallet      | Client ID         |
| LaunchDarkly | Feature flags                | Client-side ID    |
| zkFold       | Google Wallet ZK proofs      | API key           |
| KaiserEx     | Gero Card services           | OAuth flow        |
| Blockfrost   | Cardano blockchain data      | Project ID        |
| TapTools     | Portfolio analytics          | Public API        |
| DexHunter    | DEX aggregation              | Public API        |

---

## Comprehensive Security Assessment (December 2024)

A thorough code assessment was performed to detect security flaws. Below are the findings:

### Critical Issues Fixed

#### Password Logging Vulnerabilities - FIXED

Three console.log statements were logging entire request objects that contained passwords:

| File | Handler | Issue | Status |
|------|---------|-------|--------|
| `src/chrome/background.ts` | `VERIFY_SPENDING_PASSWORD` | Logged request with password | **FIXED** |
| `src/chrome/background.ts` | `SIGN_DATA` | Logged request with password | **FIXED** |
| `src/chrome/background.ts` | `SIGN_TX` | Logged request with password | **FIXED** |

**Fix applied:** Replaced `console.log` with comment `// Note: Never log request - contains password`

---

### Security Strengths

#### Cryptographic Implementation - EXCELLENT

The codebase implements industry-standard cryptographic practices:

| Practice                      | Implementation                                       | Status     |
|-------------------------------|------------------------------------------------------|------------|
| Private Key Encryption        | ChaCha20-Poly1305 AEAD with PBKDF2-HMAC-SHA512       | **Secure** |
| Key Derivation                | PBKDF2 with 100,000 iterations for PIN/patterns      | **Secure** |
| Key Derivation (private keys) | PBKDF2 with 19,162 iterations (CSL/EMIP3 compatible) | **Secure** |
| Random Generation             | `crypto.getRandomValues()` for salts/nonces          | **Secure** |
| PIN Verification              | Constant-time comparison (timing attack resistant)   | **Secure** |
| WebAuthn/PassKey              | Platform authenticator with device-bound keys        | **Secure** |

**Files:** `src/shared/utils/crypto.ts`, `src/shared/utils/security.ts`

#### Origin Validation - GOOD

DApp connection requests validate origin before allowing access:
- Whitelist checking via `isWhitelisted(origin)`
- URL encoding for popup parameters
- Tab ID verification for message routing

**Files:** `src/chrome/background.ts`

#### Private Key Isolation - GOOD

- Private keys only accessible in background script context
- Never exposed to content scripts or web pages
- Password required for all signing operations

---

### Medium Issues (Informational)

#### innerHTML Usage - SAFE

innerHTML is used in several places but all are safe:
- Clearing QR code containers with empty string (`element.innerHTML = ''`)
- No user input is ever rendered via innerHTML

**Files:** `SendDialog.vue`, `ReceiveDialog.vue`, `PairHardwareWallet.vue`, etc.

#### v-html Usage - SAFE

v-html is used only for trusted i18n translation strings:
- `$t('navigation.betaVersionNotice')` - translated string
- Loading text from application state

**Files:** `ContentLayout.vue`, `WelcomeDialog.vue`, `App.vue`

#### Access-Control-Allow-Origin Headers - NOT A SECURITY ISSUE

Client-side code sets `'Access-Control-Allow-Origin': '*'` in request headers.
This is ineffective (CORS is server-side) and doesn't pose a security risk.
The headers are simply ignored by browsers.

---

### Low Issues

#### HTTP Link in Privacy Policy

No HTTP links found. The inline privacy policy dialog has been removed in favor of linking to `https://gerowallet.io/legal/privacy/`.

---

### Input Validation Summary

| Category | Status | Notes |
|----------|--------|-------|
| Cardano Addresses | **OK** | Validated via SDK's `Address.fromBech32()` |
| DApp Origins | **OK** | Checked against whitelist |
| Transaction Data | **OK** | Deserialized via Cardano SDK |
| User Passwords | **OK** | Never stored in plaintext |
| PIN Codes | **OK** | Validated format (4-6 digits) |

---

### Deserialization Analysis

JSON.parse is used safely throughout:
- No `eval()` or `new Function()` found
- Custom deserializer for BigInt handling in zkFold service
- Transaction CBOR deserialization via Cardano SDK

**Files:** `src/services/zkFold/utils/json.utils.ts`, `src/chrome/cardanoJsSdkCbor.ts`

---

### Updated Verification Checklist

Before release, verify:

- [x] No `.env` files in repository (only `.env.example`)
- [x] No hardcoded API keys in source code
- [x] All sensitive URLs use environment variables
- [x] No password logging in production code
- [x] Private keys properly encrypted (ChaCha20-Poly1305)
- [x] Origin validation for DApp connections
- [x] Safe innerHTML/v-html usage
- [ ] Git history cleaned if secrets were previously committed
- [ ] README documents required environment variables
- [ ] All API keys in production are rotated (assume compromised)

---

## Conclusion

The codebase demonstrates strong security practices:

1. **Cryptography**: Industry-standard ChaCha20-Poly1305 AEAD encryption with proper PBKDF2 key derivation
2. **Key Management**: Private keys isolated in background script, never exposed to web content
3. **Authentication**: Multi-factor support (password, PIN, pattern, PassKey)
4. **Input Validation**: Proper validation at system boundaries

**Critical fixes applied:**
- Removed password logging from 3 message handlers
- Externalized hardcoded API keys to environment variables

**Recommendations for maintainers:**
- Continue using `debugLog()` for development logging
- Never log request objects that may contain passwords
- Keep private key operations in background script
- Rotate all production API keys before public release
