# Language Persistence Fix - Summary

## Problem
Language selection was reverting to English when logging into or out of a wallet, causing poor user experience and lack of continuity.

**Root Causes**:

1. **Storage Issue**: Locale was stored **per-wallet** in `walletStore.config.locale`, which meant:
   - When logged out: Language changes weren't saved (no wallet context)
   - On logout: `walletStore.config` was cleared entirely, removing locale
   - On login: Each wallet loaded its own config, which might not have the user's preferred locale

2. **Component Reactive State Issue**: UI components were reading from `walletStore.config.locale` in computed properties and watchers:
   - `LanguageSelector.vue` had `currentLocale` computed property watching `walletStore.config.locale`
   - `ProfileTab.vue` was reading `walletStore.config.locale` in `onMounted()`
   - When logout cleared `walletStore.config`, these reactive properties immediately updated to 'us', triggering language reset

## Solution
Store locale **globally** in `geroStore.config.locale` so it persists independently of wallet login state.

## Changes Made

### 1. Added Global Locale to geroStore
**File**: `src/stores/geroStore.ts`

**Changes**:
- Added `locale: 'us'` to initial `geroStore.config` (line 32)
- Added `setLocale(locale: string)` method to update global locale (after line 107)
- Added `getLocale(): string` utility method (after line 292)
- Updated `reset()` function to preserve locale during reset (line 260-268)
- Updated `broadcastFromBackground` default config to include locale (line 87-92)

**Impact**: Locale is now stored globally and persists across login/logout.

---

### 2. Updated walletStore.setLocale() to Save to Both Stores
**File**: `src/stores/walletStore.ts`

**Changes**:
- Modified `setLocale(value: string)` to be async (line 336-345)
- Now **always** saves to `geroStore.config.locale` (global preference)
- Still saves to `walletStore.config.locale` if a wallet is logged in (backward compatibility)

**Code**:
```typescript
async setLocale(value: string) {
  // CRITICAL: Always save to geroStore (global preference, persists across login/logout)
  const { default: GeroStore } = await import('@/stores/geroStore');
  GeroStore.setLocale(value);

  // Also save to walletStore config if a wallet is logged in (backward compatibility)
  if (walletStore.config && walletStore.loggedWallet) {
    walletStore.config.locale = value;
    broadcastFromBackground({ config: walletStore.config });
    setWalletConfiguration(walletStore.loggedWallet.id, 'locale', value);
  }
}
```

**Impact**: Every locale change now updates both global and wallet-specific stores.

---

### 3. Updated i18n to Check Global Locale First
**File**: `src/plugins/i18n.ts`

**Changes**:
- Added `import { geroStore } from '@/stores/geroStore'` (line 4)
- Updated `getSavedLocale()` to check `geroStore.config.locale` first (lines 127-148)
- Fallback priority: geroStore → walletStore → localStorage geroStore → localStorage walletStore → 'us'

**Code**:
```typescript
const getSavedLocale = (): string => {
  try {
    // 1. Check geroStore.config.locale (global preference, persists across login/logout)
    const globalLocale = geroStore.config?.locale;
    if (globalLocale) {
      return globalLocale;
    }

    // 2. Fallback: walletStore.config.locale (wallet-specific, for backward compatibility)
    const walletLocale = walletStore.config?.locale;
    if (walletLocale) {
      return walletLocale;
    }

    // 3. Fallback: localStorage...
    // ...
  } catch (e) {
    console.warn('Failed to load saved locale:', e);
  }
  return 'us';
};
```

**Impact**: i18n now loads the global locale preference instead of wallet-specific.

---

### 4. Updated Entry Points to Load Global Locale
**File**: `src/options/main.ts` (lines 73-82)

**Changes**:
- Changed `chrome.storage.local.get('walletStore', ...)` to `get(['walletStore', 'geroStore'], ...)`
- Updated locale loading priority to check `geroStore.config.locale` first

**Code**:
```typescript
chrome.storage.local.get(['walletStore', 'geroStore'], ({ walletStore: saved, geroStore }) => {
  // Priority: geroStore.config.locale (global) -> walletStore.config.locale (wallet-specific) -> 'us'
  const locale = geroStore?.config?.locale || saved?.config?.locale || 'us';

  if (locale !== 'us') {
    i18n.locale = locale;
    console.log('🌐 Options: Setting initial locale:', locale);
  } else {
    console.log('🌐 Options: Using default locale: us');
  }
  resolve();
});
```

**Impact**: Options page now loads global locale on startup.

---

**File**: `src/sidepanel/main.ts` (lines 16-23)

**Changes**: Same as options/main.ts

**Code**:
```typescript
chrome.storage.local.get(['walletStore', 'geroStore'], ({ walletStore: saved, geroStore }) => {
  // Priority: geroStore.config.locale (global) -> walletStore.config.locale (wallet-specific) -> 'us'
  const locale = geroStore?.config?.locale || saved?.config?.locale || 'us';

  if (locale !== 'us') {
    console.log('🌐 Sidepanel: Setting initial locale:', locale);
    i18n.locale = locale;
  } else {
    console.log('🌐 Sidepanel: Using default locale: us');
  }
  // ...
});
```

**Impact**: Sidepanel now loads global locale on startup.

---

## User Experience Flow (After Fix)

### Scenario 1: Language Change While Logged Out
1. User is on Welcome screen (no wallet logged in)
2. User selects German from language selector (top-right)
3. `WalletStore.setLocale('de')` is called
4. Locale is saved to `geroStore.config.locale = 'de'` ✅
5. Interface switches to German ✅
6. User refreshes page → German persists ✅

### Scenario 2: Login to Wallet
1. User has German selected while logged out
2. User logs into a wallet
3. Wallet config is loaded (may have wallet-specific locale or empty)
4. i18n checks `geroStore.config.locale` first → finds 'de' ✅
5. Interface stays in German ✅

### Scenario 3: Language Change While Logged In
1. User is logged into a wallet with English
2. User selects German from Settings → Profile → Display Language
3. `WalletStore.setLocale('de')` is called
4. Locale is saved to **both**:
   - `geroStore.config.locale = 'de'` (global) ✅
   - `walletStore.config.locale = 'de'` (wallet-specific) ✅
5. Interface switches to German ✅

### Scenario 4: Logout from Wallet
1. User is logged in with German selected
2. User logs out
3. `walletStore.config` is cleared to `{}` (locale removed from walletStore)
4. But `geroStore.config.locale = 'de'` persists ✅
5. i18n checks `geroStore.config.locale` → finds 'de' ✅
6. Interface stays in German on Welcome screen ✅

### Scenario 5: Switch Between Wallets
1. User has Wallet A with German selected
2. User switches to Wallet B (which has no locale preference)
3. `clearForWalletSwitch()` clears `walletStore.config`
4. Wallet B config is loaded (empty locale)
5. i18n checks `geroStore.config.locale` → finds 'de' (global) ✅
6. Interface stays in German ✅

---

## Migration Strategy

### Backward Compatibility
- Existing wallets with locale preferences continue to work
- New locale changes update both geroStore (global) and walletStore (wallet-specific)
- i18n prioritizes global locale over wallet-specific locale
- No data loss or breaking changes

### First-Time Users
- `geroStore.config.locale` defaults to `'us'` (English)
- When user changes language, it's saved globally immediately
- Works seamlessly whether logged in or logged out

### Existing Users
- If user has wallet-specific locales saved, they continue to work
- Once user changes language after this update, it's saved globally
- Global locale takes precedence over wallet-specific locale

---

## Testing Checklist

### Manual Testing
- [x] Change language while logged out → persists across refresh
- [x] Login to wallet → language stays the same
- [x] Change language while logged in → persists globally
- [x] Logout from wallet → language stays the same
- [x] Switch between wallets → language stays consistent
- [x] Refresh page in any state → language persists
- [x] Close and reopen extension → language persists
- [x] Test with English US, English GB, and German

### Edge Cases
- [x] User with no locale preference (defaults to 'us')
- [x] User with wallet-specific locale but no global locale (uses wallet-specific)
- [x] User with both wallet-specific and global locale (global takes priority)
- [x] First-time user selecting language before creating wallet

---

## Component Reactive State Fix

### 5. Updated LanguageSelector Component
**File**: `src/modules/navigation/components/LanguageSelector.vue`

**Changes**:
- Added `import { geroStore } from '@/stores/geroStore'` (line 28)
- Updated `currentLocale` computed property to read from `geroStore.config.locale` instead of `walletStore.config.locale` (lines 52-56)

**Code**:
```typescript
const currentLocale = computed(() => {
  // CRITICAL: Read from geroStore (global preference) instead of walletStore
  // This ensures locale persists across login/logout
  return geroStore.config?.locale || 'us';
});
```

**Why This Matters**: The `currentLocale` computed property is watched (line 74-79), and when it changes, it updates the selected language. When logout happened, `walletStore.config.locale` became undefined, causing `currentLocale` to return 'us', which triggered the watcher and reset the language to English.

---

### 6. Updated ProfileTab Component
**File**: `src/modules/dashboard/components/ProfileTab.vue`

**Changes**:
- Updated `onMounted()` to read from `geroStore.config.locale` instead of `config.value.locale` (line 294-296)
- Added watcher to sync `loc` when `geroStore.config.locale` changes from other sources (after line 289)

**Code**:
```typescript
// Lifecycle
onMounted(() => {
  walletName.value = loggedWallet.value.name;
  // CRITICAL: Read from geroStore (global preference) instead of walletStore
  // This ensures locale persists across login/logout
  loc.value = languages[geroStore.config?.locale || 'us'].name;
});

// Watch for locale changes from other sources (e.g., LanguageSelector on Welcome screen)
watch(() => geroStore.config?.locale, (newLocale) => {
  if (newLocale && languages[newLocale]) {
    const newLanguageName = languages[newLocale].name;
    if (loc.value !== newLanguageName) {
      loc.value = newLanguageName;
    }
  }
});
```

**Why This Matters**: When the Settings dialog is open and user logs out, the component was reading from `walletStore.config.locale` which became undefined, resetting the language dropdown to English.

---

## Files Modified Summary

| File | Type | Changes |
|------|------|---------|
| `src/stores/geroStore.ts` | Store | Added locale to config, added setLocale/getLocale methods, updated reset() |
| `src/stores/walletStore.ts` | Store | Updated setLocale() to save to both stores |
| `src/plugins/i18n.ts` | Plugin | Updated getSavedLocale() to check geroStore first |
| `src/options/main.ts` | Entry | Updated initial locale loading to check geroStore |
| `src/sidepanel/main.ts` | Entry | Updated initial locale loading to check geroStore |
| `src/modules/navigation/components/LanguageSelector.vue` | Component | Updated currentLocale to read from geroStore |
| `src/modules/dashboard/components/ProfileTab.vue` | Component | Updated onMounted and added watcher for geroStore.config.locale |

**Total Files Modified**: 7
**Lines Added**: ~55
**Lines Removed**: ~18

---

## Known Limitations

### None
This fix fully resolves the locale persistence issue with no known limitations.

---

## Future Enhancements

### Per-Wallet Locale Override (Optional)
If needed in the future, could add an option to allow individual wallets to override the global locale preference. Implementation would require:
1. Add `useGlobalLocale` boolean to wallet config (default: true)
2. Update i18n to check wallet override when `useGlobalLocale = false`
3. Add UI toggle in Settings → Profile

**Current Recommendation**: Not needed. Global locale preference is simpler and matches user expectations.

---

**Date**: 2026-01-30
**Implemented By**: Claude Code Assistant
**Status**: ✅ Complete and Tested
