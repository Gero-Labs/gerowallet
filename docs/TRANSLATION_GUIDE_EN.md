# 🌍 Gero Wallet Translation Guide

Thank you for helping localize Gero Wallet! This simple guide will help you fill in translations correctly.

## 📁 Where are the translations?

**NEW STRUCTURE (January 2025):**

```
src/plugins/i18n/
├── us.ts      - English (US) - REFERENCE VERSION ✅
├── gb.ts      - English (UK) - needs translation
├── ru.ts      - Русский - needs translation
├── es.ts      - Español - needs translation
├── fr.ts      - Français - needs translation
├── de.ts      - Deutsch - needs translation
├── cn.ts      - 中文 - needs translation
... and 15 more languages (22 total)
```

**⚠️ IMPORTANT CHANGE:**
- Old structure: Multiple files per language (`en/common.ts`, `en/wallet.ts`, etc.) ❌
- New structure: One file per language (`us.ts`, `ru.ts`, etc.) ✅
- All 1,673 translation keys are in ONE file per language

## 📄 What to translate?

Each language file (`us.ts`, `ru.ts`, etc.) contains **1,673 keys** organized by modules:

**Key prefixes (modules):**
- `common.*` - buttons, errors, common phrases (most important!)
- `wallet.*` - wallet functions
- `dashboard.*` - main screen
- `card.*` - Gero Card
- `settings.*` - settings
- `transactions.*`, `staking.*`, `swap.*`, `governance.*`
- `assets.*`, `cashback.*`, `multisig.*`, `welcome.*`
- `navigation.*`, `blog.*`, `perpetuals.*`, `emptyState.*`

**Reference file:** `src/plugins/i18n/us.ts` (100% complete)

## ✅ Main rules

### 1. DON'T change keys, only translate values

```typescript
// ❌ WRONG
export default {
  obtenerTarjeta: 'Get your card',
}

// ✅ CORRECT
export default {
  getYourCard: 'Get your card',
}
```

### 2. Preserve placeholders (variables)

**IMPORTANT:** We use `{paramName}` format for variables (NOT `%s`!)

```typescript
// ✅ CORRECT - named parameters
'wallet.balance': 'Balance: {amount} ADA'
'dashboard.welcome': 'Welcome, {name}!'
'card.fee': 'Fee: {amount} {currency}'

// ❌ WRONG - old format (don't use)
'wallet.balance': 'Balance: %s ADA'
'dashboard.welcome': 'Welcome, %s!'

// \n - line break (keep as is)
'common.message': 'Line 1\nLine 2'

// \' - apostrophe (escape it)
'common.warning': 'Don\'t forget'
```

### 3. DON'T translate technical terms

**Keep AS IS:**
- ADA (cryptocurrency name)
- Cardano (blockchain name)
- Gero Card (product name)
- KYC (acronym)
- CVV, PIN (terms)
- Mastercard, Visa (brands)
- EUR, USD (currency codes)

```typescript
// ✅ CORRECT
topUpWithAda: 'Top up with ADA'
completeKYC: 'Complete KYC'

// ❌ WRONG
topUpWithAda: 'Top up with Ada'
completeKYC: 'Complete CSC'
```

### 4. Be consistent

Use the same translation for the same words:

```typescript
// ✅ CORRECT
cancel: 'Cancel'
cancelButton: 'Cancel'

// ❌ WRONG
cancel: 'Cancel'
cancelButton: 'Abort'
```

## 📝 Examples

### File structure (us.ts)
```typescript
/**
 * US English translations - Flat structure
 * All modules combined into one file
 */

export default {
  'common.send': 'Send',
  'common.receive': 'Receive',
  'wallet.myWallet': 'My Wallet',
  'wallet.balance': 'Balance: {amount} ADA',
  'dashboard.welcome': 'Welcome to Gero Wallet',
  'card.getYourCard': 'Get Your Gero Card',
  // ... 1,673 total keys
}
```

### Simple translations
```typescript
// English (us.ts)
'common.send': 'Send',
'common.receive': 'Receive',
'wallet.myWallet': 'My Wallet',

// Spanish (es.ts)
'common.send': 'Enviar',
'common.receive': 'Recibir',
'wallet.myWallet': 'Mi Billetera',
```

### With variables
```typescript
// English (us.ts)
'wallet.balance': 'Your balance is {amount} ADA'
'dashboard.welcome': 'Welcome, {name}!'

// Spanish (es.ts)
'wallet.balance': 'Tu saldo es {amount} ADA'
'dashboard.welcome': '¡Bienvenido, {name}!'
```

### With apostrophes
```typescript
// English (us.ts)
'common.dontForget': 'Don\'t forget your password'

// Spanish (es.ts) - no apostrophe needed in Spanish
'common.dontForget': 'No olvides tu contraseña'

// French (fr.ts) - French uses l'apostrophe
'common.dontForget': 'N\'oubliez pas votre mot de passe'
```

## 🚀 How to submit translation?

### Option 1: Via GitHub (recommended)
1. Fork the repository
2. Create a branch: `git checkout -b translation/es`
3. Open `src/plugins/i18n/es.ts` (or your language)
4. Replace empty strings `''` with translations
5. Test locally: `npm run dev`
6. Create a Pull Request

### Option 2: Via community
1. Download your language file (e.g., `es.ts`)
2. Fill in translations (replace `''` with translated text)
3. Send to Gero Discord/Telegram community

### Option 3: Use translation platform (coming soon)
- Crowdin integration planned
- Automated sync with GitHub
- Translation memory and suggestions

## 🧪 How to test translations?

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Change language in UI:**
   - Click language selector (top right)
   - Select your language
   - Check if translations appear

4. **Check browser console:**
   - Look for warnings: `[vue-i18n] Value of key '...' is not a string`
   - These indicate empty translations

## ✅ Checklist before submission

- [ ] File name correct (`es.ts`, not `spanish.ts`)
- [ ] All or most strings filled (at least 50%+)
- [ ] Keys unchanged (e.g., `'common.send'` stays `'common.send'`)
- [ ] Placeholders preserved (`{amount}`, `{name}`, etc.)
- [ ] Technical terms NOT translated (ADA, KYC, CVV, Cardano)
- [ ] Translation sounds natural and native
- [ ] Consistent terminology throughout file
- [ ] Tested in development server
- [ ] No TypeScript/linter errors

## 📊 Translation Progress

**Current status (January 2025):**

| Language | Code | Keys Filled | % Complete | Status |
|----------|------|-------------|------------|--------|
| English (US) | `us` | 1,673 | 100% | ✅ Complete |
| English (UK) | `gb` | 12 | 0.7% | ⚠️ Needs work |
| Russian | `ru` | 12 | 0.7% | ⚠️ Needs work |
| German | `de` | 12 | 0.7% | ⚠️ Needs work |
| Spanish | `es` | 12 | 0.7% | ⚠️ Needs work |
| French | `fr` | 12 | 0.7% | ⚠️ Needs work |
| ... (17 more) | ... | 12 | 0.7% | ⚠️ Needs work |

**Priority languages** (most requested by community):
1. Russian (`ru`)
2. Spanish (`es`)
3. German (`de`)
4. French (`fr`)
5. Portuguese (`pt`)

## ⚠️ Current Issues

**Empty translations:** Almost all non-English languages have 99.3% empty translations. When a user selects a non-English language, they will see:
- English text (fallback)
- Or empty strings if fallback fails

**Help needed!** We urgently need translators for all languages.

## 🎯 Quick Start (5 minutes)

Want to contribute but don't have much time? Start with these **20 most common keys**:

```typescript
// Top 20 keys (appear on almost every screen)
'common.send': '',           // Fill this
'common.receive': '',        // Fill this
'common.cancel': '',         // Fill this
'common.confirm': '',        // Fill this
'common.back': '',           // Fill this
'common.next': '',           // Fill this
'common.save': '',           // Fill this
'common.delete': '',         // Fill this
'common.edit': '',           // Fill this
'common.close': '',          // Fill this
'common.loading': '',        // Fill this
'common.success': '',        // Fill this
'common.error': '',          // Fill this
'common.balance': '',        // Fill this
'common.amount': '',         // Fill this
'wallet.myWallet': '',       // Fill this
'wallet.send': '',           // Fill this
'wallet.receive': '',        // Fill this
'dashboard.dashboard': '',   // Fill this
'settings.settings': '',     // Fill this
```

Even translating just these 20 keys will make a HUGE difference! 🙏

## 💬 Need help?

- **Discord:** [Gero Community Discord](https://discord.gg/gero)
- **Telegram:** [Gero Telegram Channel](https://t.me/gero)
- **GitHub:** Create an issue with `i18n` or `translation` label
- **Email:** translations@gerowallet.io

## 📚 Additional Resources

- **Style Guide:** Check `us.ts` for writing style and tone
- **Technical Glossary:** See `docs/GLOSSARY.md` (if available)
- **Translation Memory:** We'll add Crowdin integration soon

---

**Thank you for your help! 🙏**

Every translation helps thousands of users access Gero Wallet in their native language!

Together we're making Gero Wallet truly global! 🌍 🚀

