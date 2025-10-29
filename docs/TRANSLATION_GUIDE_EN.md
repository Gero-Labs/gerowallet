# 🌍 Gero Wallet Translation Guide

Thank you for helping localize Gero Wallet! This simple guide will help you fill in translations correctly.

## 📁 Where are the translations?

```
src/plugins/i18n/
├── en/    - English (reference version)
├── ru/    - Русский
├── es/    - Español
├── fr/    - Français
├── de/    - Deutsch
├── cn/    - 中国人
... and other languages
```

## 📄 Which files to translate?

Each language folder has 18 files:

**Start with these (most important):**
- `common.ts` - buttons, errors, common phrases
- `wallet.ts` - wallet functions
- `dashboard.ts` - main screen
- `card.ts` - Gero Card
- `settings.ts` - settings

**Other files:**
- `transactions.ts`, `staking.ts`, `swap.ts`, `governance.ts`
- `assets.ts`, `cashback.ts`, `multisig.ts`, `welcome.ts`
- `navigation.ts`, `blog.ts`, `perpetuals.ts`, `emptyState.ts`

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

### 2. Preserve special characters

```typescript
// %s - placeholder for value (don't remove!)
balance: 'Balance: %s ADA'

// {0}, {1} - also don't remove
greeting: 'Hello, {0}!'

// \n - line break
message: 'Line 1\nLine 2'

// \' - apostrophe (escape it)
warning: 'Don\'t forget'
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

### Simple text
```typescript
// English
welcome: 'Welcome to Gero Wallet'

// Spanish
welcome: 'Bienvenido a Gero Wallet'
```

### With variables
```typescript
// English
balance: 'Your balance is %s ADA'

// Spanish
balance: 'Tu saldo es %s ADA'
```

### With apostrophes
```typescript
// English
message: 'Don\'t forget your password'

// Spanish (no apostrophe needed)
message: 'No olvides tu contraseña'
```

## 🚀 How to submit translation?

### Option 1: Via GitHub (if you know how)
1. Fork the repository
2. Create a branch: `git checkout -b translation/es-card`
3. Make changes
4. Create a Pull Request

### Option 2: Via community
1. Download the file
2. Fill in translations
3. Send to Gero Discord/Telegram community

## ✅ Checklist before submission

- [ ] All strings are filled (no empty `''`)
- [ ] Keys are unchanged
- [ ] Special characters preserved (`%s`, `{0}`, `\n`)
- [ ] Technical terms NOT translated (ADA, KYC, CVV)
- [ ] Translation sounds natural
- [ ] Consistent terminology used

## 💬 Need help?

- Gero Discord community
- Gero Telegram channel
- GitHub Issues with `i18n` tag

---

**Thank you for your help! 🙏**

Together we're making Gero Wallet accessible to the whole world! 🌍

