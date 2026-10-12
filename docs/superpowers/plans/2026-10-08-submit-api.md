# Submit API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Cardano wallet send its signed transactions through a user-defined submit endpoint (Settings → Advanced → Submit API). Fallback to Gero is opt-in, and a wallet with nothing set behaves exactly as in 2.7.2.

**Architecture:** One background module, `submitRouter.ts`, sits behind every Cardano submit path (in-wallet `WalletBg.submitTx`, CIP-30, WalletConnect, CIP-45). It reads the wallet's `submitApi` config row at call time. With no row it runs the caller's existing call, passed in as `defaultSubmit`. With a row it POSTs raw CBOR to the user's endpoint and applies the fallback rules. The auth header value lives in a separate `submitApiAuth` row that `ConfigLoader` never loads, so it never reaches `walletStore`, broadcasts or `chrome.storage.local`. A small Vue dialog edits the setting through three extension-page-only background messages. Nexus gets an `application/cbor` variant of its submit endpoint, so every provider takes the same wire format.

**Tech Stack:** TypeScript, Vue 2.7 + Vuetify 2.7 (`<script setup>`), Dexie 4 (wallet `config` table), `@cardano-sdk/core` `Serialization`, vitest + happy-dom + fake-indexeddb, Chrome MV3 messaging. Nexus: Java 21, Spring Boot 3.5, JUnit 5, Mockito, MockMvc.

**Spec:** `docs/superpowers/specs/2026-10-08-submit-api-design.md` (commit `c10b398b`). Read it before starting a task.

### Refinements found while planning

These were settled in this plan and do not contradict the spec.

1. **Fallback-eligible statuses:** spec §6.3's list plus **408** (request timeout) and **415** (the endpoint refuses `application/cbor`). Both are endpoint problems, not transaction problems.
2. **A kept header value never follows the URL to another origin.** If the user changes the URL's origin and leaves the saved value in place, both save and test answer `headerValueReenter`. The same origin rule as SPO `tokenForUrl`.
3. **Endpoint response bodies are redacted:** every occurrence of the header value becomes `***` before the body reaches any message or log. An endpoint that echoes the key in a 401 cannot leak it into the UI.
4. **Router failures are localized in-wallet.** Three fixed English constants live in `@/chrome/config`, and `friendlyTxError` maps them to i18n keys. This is the same contract as `CIP113_SIGN_REFUSAL_MESSAGE`.
5. **The last-result entry stores an error *code*** (`timeout`, `unreachable`, `http`+status, …). The UI localizes it.
6. **`SubmitOutcome` success `body` is `unknown`:** the default branch passes the caller's value through untouched, so caller-side validation is byte-identical.
7. **The Settings row shows "Invalid"** when a stored row fails validation. The dialog's Reset still works on it.
8. **Inputs are trimmed** (URL, header name, header value) before validation.
9. **Requests carry `walletId`.** The background refuses one that is not the logged-in wallet (`walletMismatch`).

## Global Constraints

- Release: code ships in 2.7.3 behind feature flag `isSubmitApiEnabled`, **default `false`**. The flag gates the **UI only**; the router honours any saved config whatever the flag says.
- Chain scope: Cardano only (`Blockchain.CARDANO`). Bitcoin, Midnight and the Midnight cNIGHT registration submit (`walletBg.ts` ~L3108) stay unchanged.
- Wire format to custom endpoints: `POST`, `Content-Type: application/cbor`, raw CBOR bytes, `redirect: 'error'`, `credentials: 'omit'`. Timeouts: submit 30 s, test probe 10 s.
- Config rows (per-wallet `config` table, primary key `key`, no schema bump): `submitApi` = `{ version: 1, url, headerName, hasAuth, fallbackToDefault }`; `submitApiAuth` = header value string.
- **Every new i18n key goes in `src/plugins/i18n/us.ts`, `de.ts` and `es.ts` in the same commit** (`src/plugins/i18n.parity.spec.ts` enforces this). German uses formal "Sie" and "das Wallet". Spanish is neutral Latin American, "tú", "billetera". No em dashes in UI copy.
- **Design ratchet has zero headroom.** In `.vue/.scss/.css` add no hex colours (comments included: write `PR 1234`, never `#1234`), radii, font-sizes, z-index, `transition: all`, clickable `<div>`, `outline: none`, `!important` or `backdrop-filter`. Use `t-body-lg / t-body / t-caption`, `var(--g-s-*)`, `GButton`, `BaseDialog`.
- **Never `git commit --no-verify`.** The hook runs ESLint, the design ratchet and the contrast check.
- ESLint must be clean on every file you touch: `npx eslint <files>`. Repo-wide `npm run lint` / `npm run typecheck` are red at baseline, so never read them as a verdict.
- Logging: never log the header value, URL path or query. Background uses `debugLog()` with the endpoint **origin** only. Add **no** new `console.*` lines, and keep existing ones byte-identical.
- Messaging: UI uses `Messaging.sendToBackgroundFromOptions({ method, data })`. Background handlers are `app.addToOptions(...)` and reply `{ id, data: <result>, target: TARGET, sender: SENDER.extension }`.
- Vue: `@click="fn()"` (with parentheses) for handlers.
- Builds: **never** `npm run build` (OOMs). Use `npm run build:web -- --mode production` and `npm run build:background -- --mode production`, with a placeholder `.env.production` (Task 10).
- Product code that adds a protective measure carries a `// OX Agent: <guideline name> prevented` comment on or above that line. Never in tests or docs.
- Commits: stage files by explicit path (never `git add -A`). End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These inputs are implied by the spec but easy to miss. Each one is pinned by a test in the owning task.

1. **Saved API key plus an edited URL origin.** A user changes `https://a.example/...` to `https://b.example/...` and keeps the saved key. The key must not go to `b.example` on Test or on Save until it is re-entered (`headerValueReenter`). Tasks 7 and 8.
2. **Pasted values with surrounding whitespace or a trailing newline** (URL, header name, an API key copied from a terminal). These are trimmed and accepted. A newline *inside* the value is rejected. Task 1.
3. **Wallet switched while the dialog is open.** Save, Test or Reset must not touch the newly active wallet (`walletMismatch`). The row also closes the dialog on wallet change. Tasks 7 and 9.
4. **Endpoint returns the hash in an odd shape**: uppercase, with a trailing newline, JSON-quoted. It is accepted when it equals the local tx ID. Task 3.
5. **IPv6 and mDNS local hosts over http with an auth header.** `http://[::1]:8090`, `http://[fd12::1]` and `http://node.local` are allowed. Public IPv6 over http with auth (`http://[2001:db8::1]`) is rejected. Task 1.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/utils/submitApiConfig.ts` | create | Pure types, constants and validation shared by UI and background |
| `src/shared/utils/submitApiConfig.spec.ts` | create | Validation matrix |
| `src/chrome/submitApiStore.ts` | create | Read, write and clear the two config rows (background) |
| `src/chrome/submitApiStore.spec.ts` | create | Row semantics on fake-indexeddb |
| `src/db/loaders/walletLoader.ts` | modify | `PRIVATE_CONFIG_KEYS` + `configRowsToMap`; `ConfigLoader` uses it |
| `src/db/loaders/walletLoader.spec.ts` | modify | The secret row never reaches `WalletStore.setConfig` |
| `src/chrome/config.ts` | modify | Three fixed English router messages |
| `src/chrome/submitRouter.ts` | create | `submitCardanoTx`, adapters, failure description, test probe |
| `src/chrome/submitRouter.spec.ts` | create | Router behaviour with mocked `fetch` |
| `src/plugins/i18n/{us,de,es}.ts` | modify | `common.on` + `settings.submitApi.*` |
| `src/shared/utils/txErrors.ts` (+ spec) | modify | Localize router messages |
| `src/chrome/walletBg.ts` | modify | `submitTx` goes through the router |
| `src/chrome/background.ts` | modify | CIP-30 / WalletConnect / CIP-45 through the router; three new `addToOptions` handlers |
| `src/chrome/submitRouting.walletBg.spec.ts` | create | Real `WalletBg` end to end with a custom endpoint |
| `src/chrome/submitApiSettings.ts` (+ spec) | create | Save / test / reset logic behind the background handlers |
| `src/models/MessageTypes.ts` | modify | `SET_SUBMIT_API`, `TEST_SUBMIT_API`, `CLEAR_SUBMIT_API` |
| `src/stores/featureFlagsStore.ts` (+ spec) | modify | `isSubmitApiEnabled` |
| `src/shared/composables/useFeatureNotifications.ts` | modify | "New" badge for 2.7.3 |
| `src/modules/dashboard/composables/useSubmitApiForm.ts` (+ spec) | create | Form state, keep/replace/remove secret, payload |
| `src/modules/dashboard/dialogs/SubmitApiDialog.vue` | create | The dialog |
| `src/modules/dashboard/components/SubmitApiSettingsRow.vue` | create | Advanced-tab row: status, last result, opens dialog |
| `src/modules/dashboard/components/AdvancedSettingsTab.vue` | modify | Mount the row for Cardano wallets |
| `.github/workflows/dev-bundle-gate.yml` | modify | Run the new specs in CI |
| Nexus `CardanoTransactionsController.java`, `ValidationUtils.java` (+ tests) | modify | `application/cbor` submit variant |

---

### Task 1: Shared validation module

**Files:**
- Create: `src/shared/utils/submitApiConfig.ts`
- Test: `src/shared/utils/submitApiConfig.spec.ts`
- Modify: `.github/workflows/dev-bundle-gate.yml` (new CI step)

**Interfaces:**
- Consumes: nothing.
- Produces (exact names used by later tasks):
  - `SUBMIT_API_CONFIG_KEY = 'submitApi'`, `SUBMIT_API_AUTH_CONFIG_KEY = 'submitApiAuth'`
  - `interface SubmitApiConfig { version: 1; url: string; headerName: string | null; hasAuth: boolean; fallbackToDefault: boolean }`
  - `type SubmitApiField = 'url' | 'headerName' | 'headerValue'`
  - `type SubmitApiErrorCode` (12 codes listed in code)
  - `interface SubmitApiInput { url: unknown; headerName: unknown; headerValue?: unknown; keepsSavedValue: boolean; savedOrigin?: string | null }`
  - `interface SubmitApiNormalized { url: string; headerName: string | null; headerValue: string | null | undefined }`
  - `interface SubmitApiValidation { errors: Partial<Record<SubmitApiField, SubmitApiErrorCode>>; insecureWarning: boolean; normalized: SubmitApiNormalized | null }`
  - `validateSubmitApiInput(input: SubmitApiInput, walletNetwork: string): SubmitApiValidation`
  - `validateStoredSubmitApiConfig(value: unknown, walletNetwork: string): SubmitApiConfig | null`
  - `isValidHeaderValue(value: unknown): value is string`
  - `isLocalHost(hostname: string): boolean`, `nexusNetworkParam(walletNetwork: string): string`
  - `type SubmitVia = 'custom' | 'default'`
  - `type SubmitApiLastErrorCode = 'timeout' | 'unreachable' | 'http' | 'invalidConfig' | 'unexpectedResponse' | 'hashMismatch'`
  - `interface SubmitApiLastResult { at: number; via: SubmitVia; error?: { code: SubmitApiLastErrorCode; status?: number } }`
  - `submitApiLastResultKey(walletId: number): string`
  - `type SubmitApiTestKind = 'ok' | 'acceptedInvalid' | 'auth' | 'path' | 'server' | 'other' | 'unreachable'`, `interface SubmitApiTestResult { kind: SubmitApiTestKind; status?: number }`
  - `type SubmitApiSettingsError = SubmitApiErrorCode | 'walletMismatch' | 'unsupportedChain' | 'saveFailed'`
  - `type SubmitApiSettingsResult<T = undefined> = { success: true; result?: T } | { success: false; error: SubmitApiSettingsError; field?: SubmitApiField }`

- [ ] **Step 1: Write the failing test**

Create `src/shared/utils/submitApiConfig.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isLocalHost,
  isValidHeaderValue,
  nexusNetworkParam,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  validateSubmitApiInput,
  type SubmitApiInput,
} from './submitApiConfig';

const base = (overrides: Partial<SubmitApiInput> = {}): SubmitApiInput => ({
  url: 'https://node.example/api/submit/tx',
  headerName: '',
  headerValue: '',
  keepsSavedValue: false,
  ...overrides,
});

describe('validateSubmitApiInput: URL', () => {
  it('accepts an https submit URL and drops the fragment', () => {
    const v = validateSubmitApiInput(base({ url: 'https://node.example/api/submit/tx#frag' }), 'Mainnet');
    expect(v.errors).toEqual({});
    expect(v.normalized).toEqual({ url: 'https://node.example/api/submit/tx', headerName: null, headerValue: null });
  });

  it('trims pasted whitespace around the URL', () => {
    const v = validateSubmitApiInput(base({ url: '  https://node.example/api/submit/tx \n' }), 'Mainnet');
    expect(v.normalized?.url).toBe('https://node.example/api/submit/tx');
  });

  it.each([
    ['', 'urlInvalid'],
    ['not a url', 'urlInvalid'],
    ['ftp://node.example/submit', 'urlInvalid'],
    ['javascript:alert(1)', 'urlInvalid'],
    ['https://user:pass@node.example/submit', 'urlCredentials'],
    [`https://node.example/${'a'.repeat(2050)}`, 'urlTooLong'],
  ])('rejects %s with %s', (url, code) => {
    const v = validateSubmitApiInput(base({ url }), 'Mainnet');
    expect(v.errors.url).toBe(code);
    expect(v.normalized).toBeNull();
  });
});

describe('validateSubmitApiInput: Nexus network guard', () => {
  it.each([
    ['https://nexus.gerowallet.io/api/transactions/submit', 'nexusNetwork'],
    ['https://nexus.gerowallet.io/api/transactions/submit?network=cardano-preprod', 'nexusNetwork'],
    ['https://my-nexus.example/prefix/api/transactions/submit/', 'nexusNetwork'],
  ])('rejects %s on a mainnet wallet', (url, code) => {
    expect(validateSubmitApiInput(base({ url }), 'Mainnet').errors.url).toBe(code);
  });

  it.each([
    ['https://nexus.gerowallet.io/api/transactions/submit?network=cardano-mainnet', 'Mainnet'],
    ['https://my-nexus.example/prefix/api/transactions/submit?network=cardano-preview', 'Preview'],
  ])('accepts %s for a %s wallet', (url, network) => {
    expect(validateSubmitApiInput(base({ url }), network).errors).toEqual({});
  });

  it('builds the Nexus network value from the wallet network', () => {
    expect(nexusNetworkParam('Preprod')).toBe('cardano-preprod');
  });
});

describe('validateSubmitApiInput: header', () => {
  it('accepts a header name and value, trimming a trailing newline from a pasted key', () => {
    const v = validateSubmitApiInput(base({ headerName: ' X-Api-Key ', headerValue: 'abc123\n' }), 'Mainnet');
    expect(v.errors).toEqual({});
    expect(v.normalized).toMatchObject({ headerName: 'X-Api-Key', headerValue: 'abc123' });
  });

  it.each([
    [{ headerName: 'bad name', headerValue: 'v' }, 'headerName', 'headerNameInvalid'],
    [{ headerName: 'a'.repeat(65), headerValue: 'v' }, 'headerName', 'headerNameInvalid'],
    [{ headerName: 'Host', headerValue: 'v' }, 'headerName', 'headerNameForbidden'],
    [{ headerName: 'content-type', headerValue: 'v' }, 'headerName', 'headerNameForbidden'],
    [{ headerName: 'Sec-Fetch-Mode', headerValue: 'v' }, 'headerName', 'headerNameForbidden'],
    [{ headerName: 'Proxy-Authorization', headerValue: 'v' }, 'headerName', 'headerNameForbidden'],
    [{ headerName: '', headerValue: 'v' }, 'headerName', 'headerNameRequired'],
    [{ headerName: 'project_id', headerValue: '' }, 'headerValue', 'headerValueRequired'],
    [{ headerName: 'project_id', headerValue: 'a\r\nInjected: 1' }, 'headerValue', 'headerValueInvalid'],
    [{ headerName: 'project_id', headerValue: 'a'.repeat(4097) }, 'headerValue', 'headerValueTooLong'],
  ])('%o fails %s with %s', (overrides, field, code) => {
    const v = validateSubmitApiInput(base(overrides), 'Mainnet');
    expect(v.errors[field as 'headerName' | 'headerValue']).toBe(code);
    expect(v.normalized).toBeNull();
  });

  it('keeps a saved value when headerValue is undefined', () => {
    const v = validateSubmitApiInput(
      base({ headerName: 'project_id', headerValue: undefined, keepsSavedValue: true, savedOrigin: 'https://node.example' }),
      'Mainnet',
    );
    expect(v.errors).toEqual({});
    expect(v.normalized?.headerValue).toBeUndefined();
  });

  it('asks for the value again when the URL moves to another origin', () => {
    const v = validateSubmitApiInput(
      base({ url: 'https://other.example/api/submit/tx', headerName: 'project_id', headerValue: undefined, keepsSavedValue: true, savedOrigin: 'https://node.example' }),
      'Mainnet',
    );
    expect(v.errors.headerValue).toBe('headerValueReenter');
    expect(v.normalized).toBeNull();
  });
});

describe('validateSubmitApiInput: plain http', () => {
  it('warns, but allows, plain http to a public host without auth', () => {
    const v = validateSubmitApiInput(base({ url: 'http://node.example/api/submit/tx' }), 'Mainnet');
    expect(v.errors).toEqual({});
    expect(v.insecureWarning).toBe(true);
  });

  it('rejects a header value over plain http to a public host', () => {
    const v = validateSubmitApiInput(base({ url: 'http://node.example/submit', headerName: 'project_id', headerValue: 'k' }), 'Mainnet');
    expect(v.errors.url).toBe('insecureAuth');
  });

  it.each([
    'http://localhost:8090/api/submit/tx',
    'http://127.0.0.1:8090/api/submit/tx',
    'http://10.0.0.35:8090/api/submit/tx',
    'http://172.20.1.1/api/submit/tx',
    'http://192.168.1.10:8090/api/submit/tx',
    'http://169.254.10.10/api/submit/tx',
    'http://[::1]:8090/api/submit/tx',
    'http://[fd12::1]:8090/api/submit/tx',
    'http://[fe80::1]/api/submit/tx',
    'http://node.local:8090/api/submit/tx',
  ])('allows auth over http to local host %s', (url) => {
    const v = validateSubmitApiInput(base({ url, headerName: 'project_id', headerValue: 'k' }), 'Mainnet');
    expect(v.errors).toEqual({});
    expect(v.insecureWarning).toBe(false);
  });

  it.each(['http://172.32.0.1/submit', 'http://[2001:db8::1]/submit', 'http://8.8.8.8/submit'])(
    'treats %s as public',
    (url) => {
      expect(validateSubmitApiInput(base({ url, headerName: 'project_id', headerValue: 'k' }), 'Mainnet').errors.url).toBe('insecureAuth');
    },
  );
});

describe('helpers', () => {
  it('isLocalHost handles bracketed IPv6', () => {
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('[2001:db8::1]')).toBe(false);
  });

  it('isValidHeaderValue rejects CR, LF, NUL and empty', () => {
    expect(isValidHeaderValue('abc')).toBe(true);
    expect(isValidHeaderValue('')).toBe(false);
    expect(isValidHeaderValue('a\nb')).toBe(false);
    expect(isValidHeaderValue('a\u0000b')).toBe(false);
    expect(isValidHeaderValue(42)).toBe(false);
  });

  it('keys the last-result entry by wallet', () => {
    expect(submitApiLastResultKey(7)).toBe('submitApiLastResult:7');
  });
});

describe('validateStoredSubmitApiConfig', () => {
  const stored = { version: 1, url: 'https://node.example/api/submit/tx', headerName: 'project_id', hasAuth: true, fallbackToDefault: false };

  it('returns a valid stored row', () => {
    expect(validateStoredSubmitApiConfig(stored, 'Mainnet')).toEqual(stored);
  });

  it.each([
    null,
    'string',
    { ...stored, version: 2 },
    { ...stored, url: 'ftp://x' },
    { ...stored, headerName: null },
    { ...stored, hasAuth: false },
    { ...stored, fallbackToDefault: 'yes' },
    { ...stored, url: 'https://nexus.gerowallet.io/api/transactions/submit?network=cardano-preprod' },
  ])('rejects tampered row %o', (row) => {
    expect(validateStoredSubmitApiConfig(row, 'Mainnet')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/utils/submitApiConfig.spec.ts`
Expected: FAIL, `Failed to resolve import "./submitApiConfig"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/utils/submitApiConfig.ts`:

```ts
/**
 * Submit API: a per-wallet custom endpoint for Cardano transaction submission.
 *
 * Pure validation shared by the Settings dialog (inline errors) and the background
 * worker, which re-runs it as the authority on save, on test and before every
 * submit. Spec: docs/superpowers/specs/2026-10-08-submit-api-design.md.
 */

export const SUBMIT_API_CONFIG_KEY = 'submitApi';
/** The auth header value. ConfigLoader never loads it (PRIVATE_CONFIG_KEYS). */
export const SUBMIT_API_AUTH_CONFIG_KEY = 'submitApiAuth';

export const SUBMIT_API_MAX_URL_LENGTH = 2048;
export const SUBMIT_API_MAX_HEADER_NAME_LENGTH = 64;
export const SUBMIT_API_MAX_HEADER_VALUE_LENGTH = 4096;

export interface SubmitApiConfig {
  version: 1;
  url: string;
  headerName: string | null;
  hasAuth: boolean;
  fallbackToDefault: boolean;
}

export type SubmitApiField = 'url' | 'headerName' | 'headerValue';

export type SubmitApiErrorCode =
  | 'urlInvalid'
  | 'urlCredentials'
  | 'urlTooLong'
  | 'nexusNetwork'
  | 'insecureAuth'
  | 'headerNameRequired'
  | 'headerNameInvalid'
  | 'headerNameForbidden'
  | 'headerValueRequired'
  | 'headerValueReenter'
  | 'headerValueInvalid'
  | 'headerValueTooLong';

export interface SubmitApiInput {
  url: unknown;
  headerName: unknown;
  /** A newly typed value. Leave undefined to keep the saved one (see keepsSavedValue). */
  headerValue?: unknown;
  /** A saved header value exists and is kept, because headerValue is undefined. */
  keepsSavedValue: boolean;
  /** Origin of the saved URL. A kept value never follows the URL to another origin. */
  savedOrigin?: string | null;
}

export interface SubmitApiNormalized {
  url: string;
  headerName: string | null;
  /** undefined: keep the saved value. null: no header value. string: the new value. */
  headerValue: string | null | undefined;
}

export interface SubmitApiValidation {
  errors: Partial<Record<SubmitApiField, SubmitApiErrorCode>>;
  /** Plain http to a host outside the local network, without auth: allowed, but the UI warns. */
  insecureWarning: boolean;
  /** Only set when there are no errors. */
  normalized: SubmitApiNormalized | null;
}

export type SubmitVia = 'custom' | 'default';

export type SubmitApiLastErrorCode =
  | 'timeout'
  | 'unreachable'
  | 'http'
  | 'invalidConfig'
  | 'unexpectedResponse'
  | 'hashMismatch';

/** Written by the router to chrome.storage.session after each routed submit. */
export interface SubmitApiLastResult {
  at: number;
  via: SubmitVia;
  error?: { code: SubmitApiLastErrorCode; status?: number };
}

export function submitApiLastResultKey(walletId: number): string {
  return `submitApiLastResult:${walletId}`;
}

export type SubmitApiTestKind = 'ok' | 'acceptedInvalid' | 'auth' | 'path' | 'server' | 'other' | 'unreachable';

export interface SubmitApiTestResult {
  kind: SubmitApiTestKind;
  status?: number;
}

export type SubmitApiSettingsError = SubmitApiErrorCode | 'walletMismatch' | 'unsupportedChain' | 'saveFailed';

export type SubmitApiSettingsResult<T = undefined> =
  | { success: true; result?: T }
  | { success: false; error: SubmitApiSettingsError; field?: SubmitApiField };

// RFC 7230 token.
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Headers fetch refuses to set (it would drop them silently), plus Content-Type,
// which the router owns.
const FORBIDDEN_HEADER_NAMES = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'content-type', 'cookie', 'date', 'dnt', 'expect', 'host',
  'keep-alive', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

const NEXUS_SUBMIT_PATH = '/api/transactions/submit';

/** `cardano-mainnet` / `cardano-preprod` / `cardano-preview`, as Nexus names them. */
export function nexusNetworkParam(walletNetwork: string): string {
  return `cardano-${walletNetwork.toLowerCase()}`;
}

/** Loopback, RFC 1918, link-local, IPv6 ULA / link-local, `.local` and `.localhost` names. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  return false;
}

export function isForbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

export function isValidHeaderValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= SUBMIT_API_MAX_HEADER_VALUE_LENGTH
    && !value.includes('\r')
    && !value.includes('\n')
    && !value.includes('\u0000');
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url : null;
  } catch {
    return null;
  }
}

function isNexusSubmitPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '').endsWith(NEXUS_SUBMIT_PATH);
}

export function validateSubmitApiInput(input: SubmitApiInput, walletNetwork: string): SubmitApiValidation {
  const errors: SubmitApiValidation['errors'] = {};
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  const headerName = typeof input.headerName === 'string' && input.headerName.trim() ? input.headerName.trim() : null;
  const keepsSaved = input.keepsSavedValue && input.headerValue === undefined;
  const typed = typeof input.headerValue === 'string' ? input.headerValue.trim() : '';
  const newValue = !keepsSaved && typed ? typed : null;
  const hasValue = keepsSaved || newValue !== null;

  const parsed = rawUrl.length > SUBMIT_API_MAX_URL_LENGTH ? null : parseHttpUrl(rawUrl);
  if (rawUrl.length > SUBMIT_API_MAX_URL_LENGTH) errors.url = 'urlTooLong';
  else if (!parsed) errors.url = 'urlInvalid';
  else if (parsed.username || parsed.password) errors.url = 'urlCredentials';
  else if (isNexusSubmitPath(parsed.pathname) && parsed.searchParams.get('network') !== nexusNetworkParam(walletNetwork)) {
    errors.url = 'nexusNetwork';
  }

  const plainRemote = !!parsed && parsed.protocol === 'http:' && !isLocalHost(parsed.hostname);
  if (!errors.url && plainRemote && hasValue) errors.url = 'insecureAuth';

  if (headerName !== null) {
    if (headerName.length > SUBMIT_API_MAX_HEADER_NAME_LENGTH || !HEADER_TOKEN.test(headerName)) errors.headerName = 'headerNameInvalid';
    else if (isForbiddenHeaderName(headerName)) errors.headerName = 'headerNameForbidden';
  } else if (hasValue) {
    errors.headerName = 'headerNameRequired';
  }

  if (newValue !== null) {
    if (newValue.length > SUBMIT_API_MAX_HEADER_VALUE_LENGTH) errors.headerValue = 'headerValueTooLong';
    else if (!isValidHeaderValue(newValue)) errors.headerValue = 'headerValueInvalid';
  } else if (headerName !== null && !keepsSaved) {
    errors.headerValue = 'headerValueRequired';
  } else if (keepsSaved && parsed && input.savedOrigin && parsed.origin !== input.savedOrigin) {
    errors.headerValue = 'headerValueReenter';
  }

  if (parsed) parsed.hash = '';
  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    insecureWarning: !errors.url && plainRemote && !hasValue,
    normalized: valid && parsed
      ? { url: parsed.toString(), headerName, headerValue: keepsSaved ? undefined : newValue }
      : null,
  };
}

/**
 * A stored `submitApi` row, re-validated. Null for anything a tampered or corrupted
 * row could hold: the router fails closed on null rather than using Gero's path.
 */
export function validateStoredSubmitApiConfig(value: unknown, walletNetwork: string): SubmitApiConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const hasAuth = row['hasAuth'];
  const fallbackToDefault = row['fallbackToDefault'];
  const headerName = row['headerName'];
  if (row['version'] !== 1 || typeof hasAuth !== 'boolean' || typeof fallbackToDefault !== 'boolean') return null;
  if (headerName !== null && typeof headerName !== 'string') return null;
  const check = validateSubmitApiInput({ url: row['url'], headerName, keepsSavedValue: hasAuth }, walletNetwork);
  if (!check.normalized) return null;
  return { version: 1, url: check.normalized.url, headerName: check.normalized.headerName, hasAuth, fallbackToDefault };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/utils/submitApiConfig.spec.ts`
Expected: PASS, every test green.

- [ ] **Step 5: Wire the spec into CI**

In `.github/workflows/dev-bundle-gate.yml`, directly after the `Pending transaction visibility regressions` step, add:

```yaml
      - name: Submit API settings and routing
        run: npx vitest run src/shared/utils/submitApiConfig.spec.ts
```

Later tasks append their spec paths to this same `run:` line.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/utils/submitApiConfig.ts src/shared/utils/submitApiConfig.spec.ts
git add src/shared/utils/submitApiConfig.ts src/shared/utils/submitApiConfig.spec.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): shared validation for custom submit endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Config rows and the ConfigLoader secret filter

**Files:**
- Create: `src/chrome/submitApiStore.ts`
- Test: `src/chrome/submitApiStore.spec.ts`
- Modify: `src/db/loaders/walletLoader.ts:113-131` (`ConfigLoader`)
- Modify: `src/db/loaders/walletLoader.spec.ts` (append tests)
- Modify: `.github/workflows/dev-bundle-gate.yml`

**Interfaces:**
- Consumes: `SUBMIT_API_CONFIG_KEY`, `SUBMIT_API_AUTH_CONFIG_KEY`, `SubmitApiConfig` (Task 1); `getDb(id: number): Promise<Dexie | null>` from `@/db/wallet-db`.
- Produces:
  - `interface StoredSubmitApi { config: unknown; auth: unknown }`
  - `readSubmitApi(walletId: number): Promise<StoredSubmitApi>` (missing rows read as `null`)
  - `writeSubmitApi(walletId: number, config: SubmitApiConfig, headerValue: string | null | undefined): Promise<void>` (`undefined` = keep the auth row, `null` = delete it, string = replace it)
  - `clearSubmitApi(walletId: number): Promise<void>`
  - `PRIVATE_CONFIG_KEYS: ReadonlySet<string>`, `configRowsToMap(rows: Array<{ key: string; value: unknown }>): Record<string, unknown>` (from `walletLoader.ts`)

- [ ] **Step 1: Write the failing tests**

Create `src/chrome/submitApiStore.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/wallet-db';
import { clearSubmitApi, readSubmitApi, writeSubmitApi } from './submitApiStore';
import type { SubmitApiConfig } from '@/shared/utils/submitApiConfig';

const WALLET_ID = 880001;
const CONFIG: SubmitApiConfig = {
  version: 1,
  url: 'https://node.example/api/submit/tx',
  headerName: 'project_id',
  hasAuth: true,
  fallbackToDefault: false,
};

async function row(key: string): Promise<unknown> {
  const db = await getDb(WALLET_ID);
  return (await db!.table('config').get(key))?.value;
}

afterEach(async () => {
  await (await getDb(WALLET_ID))?.delete();
});

describe('submitApiStore', () => {
  it('reads null for a wallet without a Submit API', async () => {
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: null, auth: null });
  });

  it('writes the public row and the secret row separately', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    expect(await row('submitApi')).toEqual(CONFIG);
    expect(await row('submitApiAuth')).toBe('secret-key');
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: CONFIG, auth: 'secret-key' });
  });

  it('keeps the saved secret when headerValue is undefined', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    expect(await row('submitApiAuth')).toBe('secret-key');
    expect(await row('submitApi')).toMatchObject({ fallbackToDefault: true });
  });

  it('deletes the secret when headerValue is null', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    await writeSubmitApi(WALLET_ID, { ...CONFIG, headerName: null, hasAuth: false }, null);
    expect(await row('submitApiAuth')).toBeUndefined();
  });

  it('clears both rows', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    await clearSubmitApi(WALLET_ID);
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: null, auth: null });
  });
});
```

Append to `src/db/loaders/walletLoader.spec.ts`. Add the imports at the top of the file, next to the existing ones:

```ts
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { vi } from 'vitest';
import WalletStore from '@/stores/walletStore';
import { ConfigLoader, configRowsToMap, PRIVATE_CONFIG_KEYS } from './walletLoader';
```

(Merge `vi` into the existing `vitest` import line, and merge the named imports into the existing `./walletLoader` import line, rather than duplicating them.) Then append:

```ts
describe('configRowsToMap', () => {
  it('maps config rows by key', () => {
    expect(configRowsToMap([{ key: 'txAutoSubmit', value: true }])).toEqual({ txAutoSubmit: true });
  });

  it('never lets the Submit API secret into the store', () => {
    const map = configRowsToMap([
      { key: 'submitApi', value: { url: 'https://node.example' } },
      { key: 'submitApiAuth', value: 'secret-key' },
    ]);
    expect(map).toEqual({ submitApi: { url: 'https://node.example' } });
    expect(JSON.stringify(map)).not.toContain('secret-key');
    expect(PRIVATE_CONFIG_KEYS.has('submitApiAuth')).toBe(true);
  });
});

describe('ConfigLoader', () => {
  it('hands WalletStore.setConfig no secret row', async () => {
    const db = new Dexie('config-loader-spec');
    db.version(1).stores({ config: 'key, value' });
    await db.open();
    await db.table('config').bulkPut([
      { key: 'submitApi', value: { url: 'https://node.example' } },
      { key: 'submitApiAuth', value: 'secret-key' },
    ]);
    const setConfig = vi.spyOn(WalletStore, 'setConfig');
    const loader = new ConfigLoader(async () => db);
    await loader.load();
    expect(setConfig).toHaveBeenLastCalledWith({ submitApi: { url: 'https://node.example' } });
    loader.unsubscribe();
    setConfig.mockRestore();
    await db.delete();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/chrome/submitApiStore.spec.ts src/db/loaders/walletLoader.spec.ts`
Expected: FAIL. `./submitApiStore` does not resolve, and `configRowsToMap` / `PRIVATE_CONFIG_KEYS` are not exported.

- [ ] **Step 3: Write the implementation**

Create `src/chrome/submitApiStore.ts`:

```ts
import type Dexie from 'dexie';
import { getDb } from '@/db/wallet-db';
import {
  SUBMIT_API_AUTH_CONFIG_KEY,
  SUBMIT_API_CONFIG_KEY,
  type SubmitApiConfig,
} from '@/shared/utils/submitApiConfig';

/**
 * Background-only access to a wallet's Submit API rows. The secret row
 * (SUBMIT_API_AUTH_CONFIG_KEY) is read here and nowhere else: ConfigLoader skips
 * it, so it never reaches walletStore, broadcasts or chrome.storage.local.
 */
export interface StoredSubmitApi {
  config: unknown;
  auth: unknown;
}

async function walletDb(walletId: number): Promise<Dexie> {
  const db = await getDb(walletId);
  if (!db) throw new Error('Wallet database unavailable');
  return db;
}

export async function readSubmitApi(walletId: number): Promise<StoredSubmitApi> {
  const table = (await walletDb(walletId)).table('config');
  const [config, auth] = await Promise.all([table.get(SUBMIT_API_CONFIG_KEY), table.get(SUBMIT_API_AUTH_CONFIG_KEY)]);
  return { config: config?.value ?? null, auth: auth?.value ?? null };
}

/** headerValue: undefined keeps the stored secret, null deletes it, a string replaces it. */
export async function writeSubmitApi(
  walletId: number,
  config: SubmitApiConfig,
  headerValue: string | null | undefined,
): Promise<void> {
  const db = await walletDb(walletId);
  const table = db.table('config');
  await db.transaction('rw', table, async () => {
    await table.put({ key: SUBMIT_API_CONFIG_KEY, value: config });
    if (headerValue === null) await table.delete(SUBMIT_API_AUTH_CONFIG_KEY);
    // OX Agent: Sensitive Data Protection prevented - the secret is stored apart from the broadcast config row
    else if (typeof headerValue === 'string') await table.put({ key: SUBMIT_API_AUTH_CONFIG_KEY, value: headerValue });
  });
}

export async function clearSubmitApi(walletId: number): Promise<void> {
  const table = (await walletDb(walletId)).table('config');
  await table.bulkDelete([SUBMIT_API_CONFIG_KEY, SUBMIT_API_AUTH_CONFIG_KEY]);
}
```

In `src/db/loaders/walletLoader.ts`, add the import next to the others:

```ts
import { SUBMIT_API_AUTH_CONFIG_KEY } from '@/shared/utils/submitApiConfig';
```

Directly above `export class ConfigLoader`, add:

```ts
/**
 * Config rows that must never reach walletStore. Everything ConfigLoader loads is
 * broadcast to every extension context and persisted in chrome.storage.local, where
 * content-script storage listeners in every tab can see it. Readers of these rows
 * query the wallet DB directly in the background (src/chrome/submitApiStore.ts).
 */
export const PRIVATE_CONFIG_KEYS: ReadonlySet<string> = new Set([SUBMIT_API_AUTH_CONFIG_KEY]);

export function configRowsToMap(rows: Array<{ key: string; value: unknown }>): Record<string, unknown> {
  return rows.reduce<Record<string, unknown>>((map, row) => {
    // OX Agent: Sensitive Data Protection prevented - secret config rows are never broadcast
    if (!PRIVATE_CONFIG_KEYS.has(row.key)) map[row.key] = row.value;
    return map;
  }, {});
}
```

Replace the `ConfigLoader.load` body's `onNext` callback:

```ts
      (config) => {
        WalletStore.setConfig(configRowsToMap(config));
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/chrome/submitApiStore.spec.ts src/db/loaders/walletLoader.spec.ts`
Expected: PASS, including every pre-existing `TransactionsLoader` test.

- [ ] **Step 5: Wire into CI, lint, commit**

Append `src/chrome/submitApiStore.spec.ts src/db/loaders/walletLoader.spec.ts` to the `Submit API settings and routing` step's `run:` line.

```bash
npx eslint src/chrome/submitApiStore.ts src/chrome/submitApiStore.spec.ts src/db/loaders/walletLoader.ts src/db/loaders/walletLoader.spec.ts
git add src/chrome/submitApiStore.ts src/chrome/submitApiStore.spec.ts src/db/loaders/walletLoader.ts src/db/loaders/walletLoader.spec.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): store the endpoint per wallet, keep its secret out of walletStore

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Submit router

**Files:**
- Modify: `src/chrome/config.ts` (after `TX_SUBMIT_UNCONFIRMED_MESSAGE`, ~L23)
- Create: `src/chrome/submitRouter.ts`
- Test: `src/chrome/submitRouter.spec.ts`
- Modify: `.github/workflows/dev-bundle-gate.yml`

**Interfaces:**
- Consumes: Task 1 (`validateStoredSubmitApiConfig`, `isValidHeaderValue`, `submitApiLastResultKey`, `SubmitVia`, `SubmitApiLastResult`, `SubmitApiTestResult`); Task 2 (`readSubmitApi`, `writeSubmitApi` in tests); `describeSubmitFailure`, `describeUnexpectedSubmitResponse`, `dappSubmitError` from `@/chrome/submitErrors`; `TxSendError`, `TX_SUBMIT_UNCONFIRMED_MESSAGE` from `@/chrome/config`.
- Produces:
  - In `@/chrome/config`: `SUBMIT_API_ENDPOINT_PREFIX = 'Your submit endpoint: '`, `SUBMIT_API_INVALID_MESSAGE`, `SUBMIT_API_HASH_MISMATCH_MESSAGE`
  - `type SubmitFailureReason = 'endpointPrefix' | 'hashMismatch' | 'unexpectedResponse' | 'outcomeUnknown' | 'invalidConfig'`
  - `type SubmitOutcome = { ok: true; via: SubmitVia; body: unknown } | { ok: false; via: SubmitVia; status?: number; body?: unknown; reason?: SubmitFailureReason }`
  - `type SubmitFailure = Extract<SubmitOutcome, { ok: false }>`
  - `submitCardanoTx(input: { cbor: string; walletId: number | null | undefined; network: string; defaultSubmit: () => Promise<SubmitOutcome> }): Promise<SubmitOutcome>`
  - `fromAxiosSubmit(run: () => Promise<unknown>): () => Promise<SubmitOutcome>`
  - `fromFetchSubmit(run: () => Promise<Response>): () => Promise<SubmitOutcome>`
  - `describeRoutedFailure(failure: SubmitFailure): string`
  - `dappRoutedError(failure: SubmitFailure): unknown`
  - `routedSubmitError(failure: SubmitFailure): Error`, `isRoutedSubmitError(error: unknown): boolean`
  - `probeSubmitEndpoint(url: string, headerName: string | null, headerValue: string | null): Promise<SubmitApiTestResult>`
  - `isFallbackEligibleStatus(status: number): boolean`

- [ ] **Step 1: Add the fixed messages to `src/chrome/config.ts`**

Directly after the `TX_SUBMIT_UNCONFIRMED_MESSAGE` export, add:

```ts
/**
 * Submit API failures, thrown from the background as fixed English strings so that
 * friendlyTxError() can map them back to i18n keys (same contract as above).
 */
export const SUBMIT_API_ENDPOINT_PREFIX = 'Your submit endpoint: ';
export const SUBMIT_API_INVALID_MESSAGE = 'Your Submit API setting is invalid. Fix it in Settings > Advanced.';
export const SUBMIT_API_HASH_MISMATCH_MESSAGE =
  'Your submit endpoint returned a different transaction ID. The outcome is unknown, so check your transaction history before sending again.';
```

- [ ] **Step 2: Write the failing test**

Create `src/chrome/submitRouter.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { getDb } from '@/db/wallet-db';
import { writeSubmitApi } from './submitApiStore';
import {
  dappRoutedError,
  describeRoutedFailure,
  fromAxiosSubmit,
  fromFetchSubmit,
  probeSubmitEndpoint,
  submitCardanoTx,
  type SubmitOutcome,
} from './submitRouter';
import {
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  TX_SUBMIT_UNCONFIRMED_MESSAGE,
} from './config';
import { dappSubmitError, describeSubmitFailure } from './submitErrors';
import type { SubmitApiConfig } from '@/shared/utils/submitApiConfig';

const WALLET_ID = 880101;
const SECRET = 'super-secret-key';
const URL_ = 'https://node.example/api/submit/tx';
const CONFIG: SubmitApiConfig = { version: 1, url: URL_, headerName: 'project_id', hasAuth: true, fallbackToDefault: false };

const sessionSet = vi.fn();
const fetchMock = vi.fn();

function signedTx(): { cbor: string; id: string } {
  const address = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
    type: Cardano.CredentialType.KeyHash,
    hash: 'a'.repeat(56) as Cardano.Credential['hash'],
  }).toAddress().toBech32() as Cardano.PaymentAddress;
  const tx = Serialization.Transaction.fromCore({
    body: {
      inputs: [{ txId: Cardano.TransactionId('1'.repeat(64)), index: 0 }],
      outputs: [{ address, value: { coins: 2_000_000n } }],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
    isValid: true,
  } as Cardano.Tx);
  return { cbor: tx.toCbor(), id: tx.getId() };
}

function response(status: number, body: string): Response {
  return new Response(body, { status });
}

function defaultOk(): () => Promise<SubmitOutcome> {
  return vi.fn().mockResolvedValue({ ok: true, via: 'default', body: 'default-hash' });
}

beforeEach(() => {
  vi.stubGlobal('chrome', { storage: { session: { set: sessionSet } } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  sessionSet.mockReset();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  await (await getDb(WALLET_ID))?.delete();
});

describe('submitCardanoTx: default path', () => {
  it('runs defaultSubmit untouched when there is no wallet context', async () => {
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor: '00', walletId: undefined, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: true, via: 'default', body: 'default-hash' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs defaultSubmit untouched and records nothing when the wallet has no Submit API', async () => {
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor: '00', walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: true, via: 'default', body: 'default-hash' });
    expect(defaultSubmit).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });
});

describe('submitCardanoTx: custom endpoint', () => {
  beforeEach(async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, SECRET);
  });

  it('POSTs raw CBOR with the header, refusing redirects, and returns the local tx id', async () => {
    const { cbor, id } = signedTx();
    fetchMock.mockResolvedValue(response(202, `"${id}"`));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });

    expect(outcome).toEqual({ ok: true, via: 'custom', body: id });
    expect(defaultSubmit).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/cbor', project_id: SECRET },
    });
    expect(Buffer.from(init.body as Uint8Array).toString('hex')).toBe(cbor);
    expect(sessionSet).toHaveBeenCalledWith({
      [`submitApiLastResult:${WALLET_ID}`]: expect.objectContaining({ via: 'custom' }),
    });
  });

  it.each(['UPPER', 'newline', 'bare'])('accepts the hash in %s form', async (shape) => {
    const { cbor, id } = signedTx();
    const body = shape === 'UPPER' ? `"${id.toUpperCase()}"` : shape === 'newline' ? `${id}\n` : id;
    fetchMock.mockResolvedValue(response(200, body));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toEqual({ ok: true, via: 'custom', body: id });
  });

  it('refuses a hash that is not this transaction', async () => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(202, `"${'f'.repeat(64)}"`));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toEqual({ ok: false, via: 'custom', reason: 'hashMismatch' });
  });

  it('reports an unparseable 2xx body as an unexpected response', async () => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(200, 'maintenance'));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toMatchObject({ ok: false, via: 'custom', reason: 'unexpectedResponse', body: 'maintenance' });
  });

  it('never falls back on a 400 node rejection, even with fallback on', async () => {
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(400, 'BadInputsUTxO'));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: false, via: 'custom', status: 400, body: 'BadInputsUTxO', reason: 'endpointPrefix' });
    expect(defaultSubmit).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 405, 408, 415, 425, 429, 500, 503])('HTTP %i fails closed with fallback off', async (status) => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(status, 'nope'));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toMatchObject({ ok: false, via: 'custom', status, reason: 'endpointPrefix' });
    expect(defaultSubmit).not.toHaveBeenCalled();
    expect(sessionSet).toHaveBeenCalledWith({
      [`submitApiLastResult:${WALLET_ID}`]: expect.objectContaining({ via: 'custom', error: { code: 'http', status } }),
    });
  });

  it.each([401, 403, 404, 405, 408, 415, 425, 429, 500, 503])('HTTP %i falls back with fallback on', async (status) => {
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(status, 'nope'));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: true, via: 'default', body: 'default-hash' });
    expect(sessionSet).toHaveBeenCalledWith({
      [`submitApiLastResult:${WALLET_ID}`]: expect.objectContaining({ via: 'default', error: { code: 'http', status } }),
    });
  });

  it('treats a network error as unreachable, failing closed or falling back', async () => {
    const { cbor } = signedTx();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() }))
      .toEqual({ ok: false, via: 'custom', reason: 'endpointPrefix' });

    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    expect(await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() }))
      .toEqual({ ok: true, via: 'default', body: 'default-hash' });
  });

  it('calls a 400 from the fallback after a custom timeout "outcome unknown"', async () => {
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    const { cbor } = signedTx();
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const defaultSubmit = vi.fn().mockResolvedValue({ ok: false, via: 'default', status: 400, body: 'BadInputsUTxO' });
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: false, via: 'default', reason: 'outcomeUnknown' });
  });

  it('redacts the header value from an endpoint body that echoes it', async () => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(401, `invalid project_id ${SECRET}`));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
    expect(describeRoutedFailure(outcome as Extract<SubmitOutcome, { ok: false }>)).not.toContain(SECRET);
    expect(JSON.stringify(sessionSet.mock.calls)).not.toContain(SECRET);
  });

  it('never sends a body that is not hex CBOR', async () => {
    const outcome = await submitCardanoTx({ cbor: 'zz', walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toMatchObject({ ok: false, via: 'custom', status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the saved endpoint whatever the feature flag says (the flag gates UI only)', async () => {
    vi.stubGlobal('chrome', {
      storage: { session: { set: sessionSet }, local: { get: vi.fn().mockResolvedValue({ featureFlags: { isSubmitApiEnabled: false } }) } },
    });
    const { cbor, id } = signedTx();
    fetchMock.mockResolvedValue(response(202, id));
    expect(await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() }))
      .toEqual({ ok: true, via: 'custom', body: id });
  });
});

describe('submitCardanoTx: invalid saved config fails closed', () => {
  it.each([
    ['a non-http URL', { ...CONFIG, url: 'ftp://node.example' }, SECRET],
    ['hasAuth without a secret row', CONFIG, null],
    ['a secret with a line break', CONFIG, 'a\nb'],
  ])('%s', async (_label, config, secret) => {
    await writeSubmitApi(WALLET_ID, config as SubmitApiConfig, secret);
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor: signedTx().cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: false, via: 'custom', reason: 'invalidConfig' });
    expect(defaultSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('adapters', () => {
  it('fromAxiosSubmit passes the value through and maps error.response', async () => {
    expect(await fromAxiosSubmit(async () => 'abc')()).toEqual({ ok: true, via: 'default', body: 'abc' });
    const failure = await fromAxiosSubmit(async () => {
      throw { response: { status: 502, data: 'Bad Gateway' } };
    })();
    expect(failure).toEqual({ ok: false, via: 'default', status: 502, body: 'Bad Gateway' });
    expect(await fromAxiosSubmit(async () => { throw new Error('reset'); })())
      .toEqual({ ok: false, via: 'default', status: undefined, body: undefined });
  });

  it('fromFetchSubmit reads the body and lets a network error propagate as before', async () => {
    expect(await fromFetchSubmit(async () => response(200, 'abc'))()).toEqual({ ok: true, via: 'default', body: 'abc' });
    expect(await fromFetchSubmit(async () => response(400, 'bad'))()).toEqual({ ok: false, via: 'default', status: 400, body: 'bad' });
    await expect(fromFetchSubmit(async () => { throw new TypeError('offline'); })()).rejects.toThrow('offline');
  });
});

describe('describeRoutedFailure / dappRoutedError', () => {
  it('leaves default-path failures exactly as before', () => {
    const failure = { ok: false as const, via: 'default' as const, status: 400, body: 'rejected' };
    expect(describeRoutedFailure(failure)).toBe(describeSubmitFailure(400, 'rejected'));
    expect(dappRoutedError(failure)).toEqual(dappSubmitError(400, 'rejected'));
  });

  it('names the custom endpoint and keeps the fixed messages', () => {
    expect(describeRoutedFailure({ ok: false, via: 'custom', status: 503, body: 'x', reason: 'endpointPrefix' }))
      .toBe(`${SUBMIT_API_ENDPOINT_PREFIX}${describeSubmitFailure(503, 'x')}`);
    expect(describeRoutedFailure({ ok: false, via: 'custom', reason: 'invalidConfig' })).toBe(SUBMIT_API_INVALID_MESSAGE);
    expect(describeRoutedFailure({ ok: false, via: 'custom', reason: 'hashMismatch' })).toBe(SUBMIT_API_HASH_MISMATCH_MESSAGE);
    expect(describeRoutedFailure({ ok: false, via: 'default', reason: 'outcomeUnknown' })).toContain(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    expect(dappRoutedError({ ok: false, via: 'custom', reason: 'invalidConfig' }))
      .toMatchObject({ info: SUBMIT_API_INVALID_MESSAGE, message: SUBMIT_API_INVALID_MESSAGE });
  });
});

describe('probeSubmitEndpoint', () => {
  it.each([
    [400, { kind: 'ok', status: 400 }],
    [202, { kind: 'acceptedInvalid' }],
    [401, { kind: 'auth', status: 401 }],
    [403, { kind: 'auth', status: 403 }],
    [404, { kind: 'path', status: 404 }],
    [405, { kind: 'path', status: 405 }],
    [503, { kind: 'server', status: 503 }],
    [415, { kind: 'other', status: 415 }],
  ])('HTTP %i maps to %o', async (status, expected) => {
    fetchMock.mockResolvedValue(response(status, ''));
    expect(await probeSubmitEndpoint(URL_, 'project_id', SECRET)).toEqual(expected);
    const [, init] = fetchMock.mock.calls[0];
    expect(Array.from(init.body as Uint8Array)).toEqual([0]);
    expect(init.redirect).toBe('error');
  });

  it('reports a network failure as unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await probeSubmitEndpoint(URL_, null, null)).toEqual({ kind: 'unreachable' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/chrome/submitRouter.spec.ts`
Expected: FAIL, `Failed to resolve import "./submitRouter"`.

- [ ] **Step 4: Write the implementation**

Create `src/chrome/submitRouter.ts`:

```ts
/**
 * Submit router: the single place a Cardano transaction leaves the wallet.
 *
 * With no Submit API saved for the wallet, `defaultSubmit` (the caller's own 2.7.2
 * call, wrapped by an adapter below) runs untouched. With one saved, the signed
 * bytes go to the user's endpoint. Gero's path is used only when the user turned
 * fallback on and the endpoint itself failed. The feature flag is never read here:
 * a remote flip must not reroute a privacy user's transactions to Gero.
 * Spec: docs/superpowers/specs/2026-10-08-submit-api-design.md.
 */
import { Serialization } from '@cardano-sdk/core';
import {
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  TxSendError,
} from '@/chrome/config';
import { dappSubmitError, describeSubmitFailure, describeUnexpectedSubmitResponse } from '@/chrome/submitErrors';
import { readSubmitApi } from '@/chrome/submitApiStore';
import {
  isValidHeaderValue,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  type SubmitApiLastResult,
  type SubmitApiTestResult,
  type SubmitVia,
} from '@/shared/utils/submitApiConfig';
import { debugLog } from '@/utils/debug';

export type SubmitFailureReason = 'endpointPrefix' | 'hashMismatch' | 'unexpectedResponse' | 'outcomeUnknown' | 'invalidConfig';

export type SubmitOutcome =
  | { ok: true; via: SubmitVia; body: unknown }
  | { ok: false; via: SubmitVia; status?: number; body?: unknown; reason?: SubmitFailureReason };

export type SubmitFailure = Extract<SubmitOutcome, { ok: false }>;

export interface SubmitCardanoTxInput {
  /** Signed transaction, hex CBOR. */
  cbor: string;
  /** Null or undefined: no wallet context, so there is no setting to read. */
  walletId: number | null | undefined;
  /** The wallet's network, for the Nexus `?network=` guard. */
  network: string;
  /** The caller's existing submit call, wrapped by fromAxiosSubmit / fromFetchSubmit. */
  defaultSubmit: () => Promise<SubmitOutcome>;
}

const CUSTOM_SUBMIT_TIMEOUT_MS = 30_000;
const TEST_SUBMIT_TIMEOUT_MS = 10_000;
const INVALID_CBOR_BODY = 'Transaction is not valid hex CBOR';

/** Statuses that mean the endpoint is the problem, not the transaction. 400 is never one. */
const FALLBACK_STATUSES = new Set([401, 403, 404, 405, 408, 415, 425, 429]);

export function isFallbackEligibleStatus(status: number): boolean {
  return FALLBACK_STATUSES.has(status) || (status >= 500 && status < 600);
}

type EndpointResult =
  | { kind: 'accepted'; body: string }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'transport'; timedOut: boolean };

type EndpointFailure = Exclude<EndpointResult, { kind: 'accepted' }>;

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function localTxId(cbor: string): string | null {
  try {
    return Serialization.Transaction.fromCbor(Serialization.TxCBOR(cbor)).getId();
  } catch {
    return null;
  }
}

/** A JSON-quoted or bare 64-hex hash, lowercased. Null for anything else. */
function parseSubmittedTxHash(body: string): string | null {
  const trimmed = body.trim().replace(/^"|"$/g, '');
  return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function redact(text: string, secret: string | null): string {
  // OX Agent: Sensitive Data Protection prevented - an endpoint that echoes the key cannot leak it into messages
  return secret ? text.split(secret).join('***') : text;
}

async function postToEndpoint(
  url: string,
  headerName: string | null,
  headerValue: string | null,
  body: Uint8Array,
  timeoutMs: number,
): Promise<EndpointResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/cbor' };
  if (headerName && headerValue) headers[headerName] = headerValue;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      // OX Agent: Sensitive Data Protection prevented - fetch keeps custom auth headers across a cross-origin redirect, so none is followed
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { kind: 'transport', timedOut: (error as { name?: unknown } | null)?.name === 'TimeoutError' };
  }
  const text = redact(await response.text().catch(() => ''), headerValue);
  return response.ok ? { kind: 'accepted', body: text } : { kind: 'http', status: response.status, body: text };
}

function lastError(result: EndpointFailure): NonNullable<SubmitApiLastResult['error']> {
  if (result.kind === 'transport') return { code: result.timedOut ? 'timeout' : 'unreachable' };
  return { code: 'http', status: result.status };
}

async function recordLastResult(walletId: number, result: Omit<SubmitApiLastResult, 'at'>): Promise<void> {
  try {
    await chrome.storage.session.set({ [submitApiLastResultKey(walletId)]: { ...result, at: Date.now() } });
  } catch {
    // The Settings status line is the only reader; a failed write must not fail the submit.
  }
}

async function acceptCustom(walletId: number, cbor: string, body: string): Promise<SubmitOutcome> {
  const hash = parseSubmittedTxHash(body);
  if (!hash) {
    await recordLastResult(walletId, { via: 'custom', error: { code: 'unexpectedResponse' } });
    return { ok: false, via: 'custom', body, reason: 'unexpectedResponse' };
  }
  if (hash !== localTxId(cbor)) {
    await recordLastResult(walletId, { via: 'custom', error: { code: 'hashMismatch' } });
    return { ok: false, via: 'custom', reason: 'hashMismatch' };
  }
  await recordLastResult(walletId, { via: 'custom' });
  return { ok: true, via: 'custom', body: hash };
}

export async function submitCardanoTx(input: SubmitCardanoTxInput): Promise<SubmitOutcome> {
  const { cbor, walletId, network, defaultSubmit } = input;
  if (walletId === null || walletId === undefined) return defaultSubmit();

  const stored = await readSubmitApi(walletId);
  if (stored.config === null) return defaultSubmit();

  // OX Agent: SSRF prevented - the stored URL is re-validated (validateStoredSubmitApiConfig) before any request
  const config = validateStoredSubmitApiConfig(stored.config, network);
  const auth = config?.hasAuth && isValidHeaderValue(stored.auth) ? stored.auth : null;
  if (!config || (config.hasAuth && auth === null)) {
    await recordLastResult(walletId, { via: 'custom', error: { code: 'invalidConfig' } });
    return { ok: false, via: 'custom', reason: 'invalidConfig' };
  }

  const bytes = hexToBytes(cbor);
  if (!bytes) return { ok: false, via: 'custom', status: 400, body: INVALID_CBOR_BODY };

  // OX Agent: Log Injection prevented - only the parsed origin is logged (URL parsing strips CR/LF), never path, query or header
  debugLog(`Submit API: submitting via ${new URL(config.url).origin}`);
  const result = await postToEndpoint(config.url, config.headerName, auth, bytes, CUSTOM_SUBMIT_TIMEOUT_MS);
  if (result.kind === 'accepted') return acceptCustom(walletId, cbor, result.body);

  const eligible = result.kind === 'transport' || isFallbackEligibleStatus(result.status);
  if (!config.fallbackToDefault || !eligible) {
    await recordLastResult(walletId, { via: 'custom', error: lastError(result) });
    return result.kind === 'transport'
      ? { ok: false, via: 'custom', reason: 'endpointPrefix' }
      : { ok: false, via: 'custom', status: result.status, body: result.body, reason: 'endpointPrefix' };
  }

  await recordLastResult(walletId, { via: 'default', error: lastError(result) });
  const fallback = await defaultSubmit();
  if (!fallback.ok && result.kind === 'transport' && result.timedOut && fallback.status === 400) {
    // The endpoint may have accepted the tx before timing out, in which case Gero's
    // node now sees spent inputs. That 400 does not mean the tx was rejected.
    return { ok: false, via: 'default', reason: 'outcomeUnknown' };
  }
  return fallback;
}

/** Wraps an axios-style call (resolves the value, throws `{ response: { status, data } }`). */
export function fromAxiosSubmit(run: () => Promise<unknown>): () => Promise<SubmitOutcome> {
  return async () => {
    try {
      return { ok: true, via: 'default', body: await run() };
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
      return { ok: false, via: 'default', status: response?.status, body: response?.data };
    }
  };
}

/** Wraps a fetch call. A network error propagates exactly as it did before the router. */
export function fromFetchSubmit(run: () => Promise<Response>): () => Promise<SubmitOutcome> {
  return async () => {
    const response = await run();
    if (!response.ok) {
      return { ok: false, via: 'default', status: response.status, body: await response.text().catch(() => '') };
    }
    return { ok: true, via: 'default', body: await response.text() };
  };
}

/** The user-facing reason, English (the background has no i18n; friendlyTxError localizes). */
export function describeRoutedFailure(failure: SubmitFailure): string {
  switch (failure.reason) {
    case 'invalidConfig':
      return SUBMIT_API_INVALID_MESSAGE;
    case 'hashMismatch':
      return SUBMIT_API_HASH_MISMATCH_MESSAGE;
    case 'unexpectedResponse':
      return SUBMIT_API_ENDPOINT_PREFIX + describeUnexpectedSubmitResponse(failure.body);
    case 'outcomeUnknown':
      return describeSubmitFailure(undefined, undefined);
    case 'endpointPrefix':
      return SUBMIT_API_ENDPOINT_PREFIX + describeSubmitFailure(failure.status, failure.body);
    default:
      return describeSubmitFailure(failure.status, failure.body);
  }
}

/** CIP-30 error object. Default-path failures keep dappSubmitError's exact shape. */
export function dappRoutedError(failure: SubmitFailure): unknown {
  if (failure.reason === undefined) return dappSubmitError(failure.status, failure.body);
  const info = describeRoutedFailure(failure);
  return { ...TxSendError.Failure, info, message: info };
}

const ROUTED_SUBMIT_FAILURE = 'submitRoutedFailure';

/** An Error for WalletBg's catch to rethrow as-is (it already carries the final message). */
export function routedSubmitError(failure: SubmitFailure): Error {
  const error = new Error(describeRoutedFailure(failure));
  (error as Error & Record<string, unknown>)[ROUTED_SUBMIT_FAILURE] = true;
  return error;
}

export function isRoutedSubmitError(error: unknown): boolean {
  return Boolean((error as Record<string, unknown> | null)?.[ROUTED_SUBMIT_FAILURE]);
}

/** Settings "Test": posts one 0x00 byte. A real submit API answers 400 to it. */
export async function probeSubmitEndpoint(
  url: string,
  headerName: string | null,
  headerValue: string | null,
): Promise<SubmitApiTestResult> {
  const result = await postToEndpoint(url, headerName, headerValue, new Uint8Array([0]), TEST_SUBMIT_TIMEOUT_MS);
  if (result.kind === 'transport') return { kind: 'unreachable' };
  if (result.kind === 'accepted') return { kind: 'acceptedInvalid' };
  const { status } = result;
  if (status === 400) return { kind: 'ok', status };
  if (status === 401 || status === 403) return { kind: 'auth', status };
  if (status === 404 || status === 405) return { kind: 'path', status };
  if (status >= 500) return { kind: 'server', status };
  return { kind: 'other', status };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/chrome/submitRouter.spec.ts`
Expected: PASS. If `Buffer` is undefined in the spec, add `import { Buffer } from 'buffer';` at the top of the spec. The repo's `nodePolyfills` normally provides it.

- [ ] **Step 6: Typecheck the new files**

Run: `npx tsc --noEmit 2>&1 | grep -E "submitRouter|submitApiStore|submitApiConfig" || echo "no new TS errors"`
Expected: `no new TS errors`. Watch for TS4111: use bracket access on `Record<string, unknown>`.

- [ ] **Step 7: Wire into CI, lint, commit**

Append `src/chrome/submitRouter.spec.ts` to the `Submit API settings and routing` CI step.

```bash
npx eslint src/chrome/submitRouter.ts src/chrome/submitRouter.spec.ts src/chrome/config.ts
git add src/chrome/submitRouter.ts src/chrome/submitRouter.spec.ts src/chrome/config.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): background submit router with opt-in fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`, `src/plugins/i18n/es.ts`

**Interfaces:**
- Produces: `common.on`, every `settings.submitApi.*` key below. Tasks 5, 9 and 10 use these exact names.

- [ ] **Step 1: Add `common.on`**

Directly after the `'common.off'` line in each file:
- `us.ts`: `  'common.on': 'On',`
- `de.ts`: `  'common.on': 'An',`
- `es.ts`: `  'common.on': 'Activado',`

- [ ] **Step 2: Add the `settings.submitApi.*` block to `us.ts`**

Directly after the `'settings.reSyncWalletHelper'` line:

```ts
  'settings.submitApi.title': 'Submit API',
  'settings.submitApi.helper': "Send this wallet's transactions through your own endpoint.",
  'settings.submitApi.statusDefault': 'Default',
  'settings.submitApi.statusCustom': 'Custom',
  'settings.submitApi.statusInvalid': 'Invalid',
  'settings.submitApi.configure': 'Configure',
  'settings.submitApi.lastSubmitCustom': 'Last submit: sent via your endpoint, {time}',
  'settings.submitApi.lastSubmitFallback': 'Last submit: fell back to Gero, {time} ({reason})',
  'settings.submitApi.lastSubmitFailed': 'Last submit failed, {time} ({reason})',
  'settings.submitApi.dialogSubtitle': 'Choose where this wallet sends its signed transactions.',
  'settings.submitApi.urlLabel': 'Submit URL',
  'settings.submitApi.urlHint': 'Works with Nexus, cardano-submit-api, Blockfrost and Koios submit URLs.',
  'settings.submitApi.networkHint': 'Must point at Cardano {network}.',
  'settings.submitApi.headerNameLabel': 'Header name (optional)',
  'settings.submitApi.headerValueLabel': 'Header value (optional)',
  'settings.submitApi.headerValueSaved': 'Header value saved',
  'settings.submitApi.replace': 'Replace',
  'settings.submitApi.fallbackLabel': 'Fall back to Gero if my endpoint fails',
  'settings.submitApi.fallbackHelper': "If on, a failed submit is retried through Gero's servers. Leave off if your transactions must never reach Gero.",
  'settings.submitApi.httpWarning': 'Not encrypted: anyone on the network path can see your transactions.',
  'settings.submitApi.trustNote': 'Your endpoint sees every transaction it submits. If it does not forward one, the transaction stays pending until you remove it.',
  'settings.submitApi.test': 'Test',
  'settings.submitApi.reset': 'Reset to default',
  'settings.submitApi.resetConfirmTitle': 'Reset Submit API?',
  'settings.submitApi.resetConfirmMessage': 'This wallet will submit through Gero again, and the saved URL and header are deleted.',
  'settings.submitApi.saved': 'Submit API saved',
  'settings.submitApi.resetDone': 'Submit API reset to default',
  'settings.submitApi.testOk': 'Reachable, looks like a submit API.',
  'settings.submitApi.testAcceptedInvalid': 'The endpoint accepted invalid bytes, so it is probably not a submit API.',
  'settings.submitApi.testAuth': 'Authentication failed. Check the header name and value. A Nexus key also needs access to /api/transactions/submit.',
  'settings.submitApi.testPath': 'Wrong path (HTTP {status}). Check the URL.',
  'settings.submitApi.testServer': 'The endpoint answered with a server error (HTTP {status}).',
  'settings.submitApi.testOther': 'Unexpected answer from the endpoint (HTTP {status}).',
  'settings.submitApi.testUnreachable': 'Unreachable. Check the URL and that the endpoint is running.',
  'settings.submitApi.reasons.timeout': 'timeout',
  'settings.submitApi.reasons.unreachable': 'unreachable',
  'settings.submitApi.reasons.http': 'HTTP {status}',
  'settings.submitApi.reasons.invalidConfig': 'invalid setting',
  'settings.submitApi.reasons.unexpectedResponse': 'unexpected response',
  'settings.submitApi.reasons.hashMismatch': 'transaction ID mismatch',
  'settings.submitApi.errors.urlInvalid': 'Enter a valid http or https URL.',
  'settings.submitApi.errors.urlCredentials': 'Remove the username and password from the URL.',
  'settings.submitApi.errors.urlTooLong': 'This URL is too long.',
  'settings.submitApi.errors.nexusNetwork': 'Add ?network={network} to the URL.',
  'settings.submitApi.errors.insecureAuth': 'Use https to send a header value to a host outside your local network.',
  'settings.submitApi.errors.headerNameRequired': 'Enter the header name for this value.',
  'settings.submitApi.errors.headerNameInvalid': 'This is not a valid header name.',
  'settings.submitApi.errors.headerNameForbidden': 'This header cannot be set here.',
  'settings.submitApi.errors.headerValueRequired': 'Enter a value for this header.',
  'settings.submitApi.errors.headerValueReenter': 'The URL changed. Enter the header value again.',
  'settings.submitApi.errors.headerValueInvalid': 'The header value cannot contain line breaks.',
  'settings.submitApi.errors.headerValueTooLong': 'This header value is too long.',
  'settings.submitApi.errors.walletMismatch': 'The active wallet changed. Close this dialog and try again.',
  'settings.submitApi.errors.unsupportedChain': 'Submit API is available for Cardano wallets only.',
  'settings.submitApi.errors.saveFailed': 'Could not save the Submit API setting. Try again.',
  'settings.submitApi.errors.invalidSaved': 'Your Submit API setting is invalid. Fix it in Settings > Advanced.',
  'settings.submitApi.errors.hashMismatch': 'Your submit endpoint returned a different transaction ID. Check your transaction history before sending again.',
  'settings.submitApi.errors.endpointFailed': 'Your submit endpoint: {reason}',
```

- [ ] **Step 3: Add the same keys to `de.ts`**

Directly after the `'settings.reSyncWalletHelper'` line:

```ts
  'settings.submitApi.title': 'Submit-API',
  'settings.submitApi.helper': 'Transaktionen dieses Wallets über Ihren eigenen Endpunkt senden.',
  'settings.submitApi.statusDefault': 'Standard',
  'settings.submitApi.statusCustom': 'Eigener',
  'settings.submitApi.statusInvalid': 'Ungültig',
  'settings.submitApi.configure': 'Konfigurieren',
  'settings.submitApi.lastSubmitCustom': 'Letzte Übermittlung: über Ihren Endpunkt gesendet, {time}',
  'settings.submitApi.lastSubmitFallback': 'Letzte Übermittlung: über Gero gesendet, {time} ({reason})',
  'settings.submitApi.lastSubmitFailed': 'Letzte Übermittlung fehlgeschlagen, {time} ({reason})',
  'settings.submitApi.dialogSubtitle': 'Legen Sie fest, wohin dieses Wallet seine signierten Transaktionen sendet.',
  'settings.submitApi.urlLabel': 'Submit-URL',
  'settings.submitApi.urlHint': 'Funktioniert mit Submit-URLs von Nexus, cardano-submit-api, Blockfrost und Koios.',
  'settings.submitApi.networkHint': 'Muss auf Cardano {network} zeigen.',
  'settings.submitApi.headerNameLabel': 'Header-Name (optional)',
  'settings.submitApi.headerValueLabel': 'Header-Wert (optional)',
  'settings.submitApi.headerValueSaved': 'Header-Wert gespeichert',
  'settings.submitApi.replace': 'Ersetzen',
  'settings.submitApi.fallbackLabel': 'Auf Gero ausweichen, wenn mein Endpunkt ausfällt',
  'settings.submitApi.fallbackHelper': 'Wenn aktiviert, wird eine fehlgeschlagene Übermittlung über die Server von Gero wiederholt. Lassen Sie es deaktiviert, wenn Ihre Transaktionen Gero nie erreichen dürfen.',
  'settings.submitApi.httpWarning': 'Nicht verschlüsselt: Jeder auf dem Netzwerkpfad kann Ihre Transaktionen sehen.',
  'settings.submitApi.trustNote': 'Ihr Endpunkt sieht jede Transaktion, die er übermittelt. Leitet er eine nicht weiter, bleibt sie ausstehend, bis Sie sie entfernen.',
  'settings.submitApi.test': 'Testen',
  'settings.submitApi.reset': 'Auf Standard zurücksetzen',
  'settings.submitApi.resetConfirmTitle': 'Submit-API zurücksetzen?',
  'settings.submitApi.resetConfirmMessage': 'Dieses Wallet übermittelt wieder über Gero. Die gespeicherte URL und der Header werden gelöscht.',
  'settings.submitApi.saved': 'Submit-API gespeichert',
  'settings.submitApi.resetDone': 'Submit-API auf Standard zurückgesetzt',
  'settings.submitApi.testOk': 'Erreichbar, sieht nach einer Submit-API aus.',
  'settings.submitApi.testAcceptedInvalid': 'Der Endpunkt hat ungültige Bytes angenommen und ist daher vermutlich keine Submit-API.',
  'settings.submitApi.testAuth': 'Authentifizierung fehlgeschlagen. Prüfen Sie Header-Name und -Wert. Ein Nexus-Schlüssel braucht außerdem Zugriff auf /api/transactions/submit.',
  'settings.submitApi.testPath': 'Falscher Pfad (HTTP {status}). Prüfen Sie die URL.',
  'settings.submitApi.testServer': 'Der Endpunkt hat mit einem Serverfehler geantwortet (HTTP {status}).',
  'settings.submitApi.testOther': 'Unerwartete Antwort des Endpunkts (HTTP {status}).',
  'settings.submitApi.testUnreachable': 'Nicht erreichbar. Prüfen Sie die URL und ob der Endpunkt läuft.',
  'settings.submitApi.reasons.timeout': 'Zeitüberschreitung',
  'settings.submitApi.reasons.unreachable': 'nicht erreichbar',
  'settings.submitApi.reasons.http': 'HTTP {status}',
  'settings.submitApi.reasons.invalidConfig': 'ungültige Einstellung',
  'settings.submitApi.reasons.unexpectedResponse': 'unerwartete Antwort',
  'settings.submitApi.reasons.hashMismatch': 'abweichende Transaktions-ID',
  'settings.submitApi.errors.urlInvalid': 'Geben Sie eine gültige http- oder https-URL ein.',
  'settings.submitApi.errors.urlCredentials': 'Entfernen Sie Benutzername und Passwort aus der URL.',
  'settings.submitApi.errors.urlTooLong': 'Diese URL ist zu lang.',
  'settings.submitApi.errors.nexusNetwork': 'Fügen Sie ?network={network} zur URL hinzu.',
  'settings.submitApi.errors.insecureAuth': 'Verwenden Sie https, um einen Header-Wert an einen Host außerhalb Ihres lokalen Netzwerks zu senden.',
  'settings.submitApi.errors.headerNameRequired': 'Geben Sie den Header-Namen für diesen Wert ein.',
  'settings.submitApi.errors.headerNameInvalid': 'Das ist kein gültiger Header-Name.',
  'settings.submitApi.errors.headerNameForbidden': 'Dieser Header kann hier nicht gesetzt werden.',
  'settings.submitApi.errors.headerValueRequired': 'Geben Sie einen Wert für diesen Header ein.',
  'settings.submitApi.errors.headerValueReenter': 'Die URL hat sich geändert. Geben Sie den Header-Wert erneut ein.',
  'settings.submitApi.errors.headerValueInvalid': 'Der Header-Wert darf keine Zeilenumbrüche enthalten.',
  'settings.submitApi.errors.headerValueTooLong': 'Dieser Header-Wert ist zu lang.',
  'settings.submitApi.errors.walletMismatch': 'Das aktive Wallet hat sich geändert. Schließen Sie diesen Dialog und versuchen Sie es erneut.',
  'settings.submitApi.errors.unsupportedChain': 'Die Submit-API ist nur für Cardano-Wallets verfügbar.',
  'settings.submitApi.errors.saveFailed': 'Die Submit-API-Einstellung konnte nicht gespeichert werden. Versuchen Sie es erneut.',
  'settings.submitApi.errors.invalidSaved': 'Ihre Submit-API-Einstellung ist ungültig. Korrigieren Sie sie unter Einstellungen > Erweitert.',
  'settings.submitApi.errors.hashMismatch': 'Ihr Submit-Endpunkt hat eine andere Transaktions-ID zurückgegeben. Prüfen Sie Ihren Transaktionsverlauf, bevor Sie erneut senden.',
  'settings.submitApi.errors.endpointFailed': 'Ihr Submit-Endpunkt: {reason}',
```

- [ ] **Step 4: Add the same keys to `es.ts`**

Directly after the `'settings.reSyncWalletHelper'` line:

```ts
  'settings.submitApi.title': 'API de envío',
  'settings.submitApi.helper': 'Envía las transacciones de esta billetera a través de tu propio endpoint.',
  'settings.submitApi.statusDefault': 'Predeterminado',
  'settings.submitApi.statusCustom': 'Personalizado',
  'settings.submitApi.statusInvalid': 'No válido',
  'settings.submitApi.configure': 'Configurar',
  'settings.submitApi.lastSubmitCustom': 'Último envío: a través de tu endpoint, {time}',
  'settings.submitApi.lastSubmitFallback': 'Último envío: a través de Gero, {time} ({reason})',
  'settings.submitApi.lastSubmitFailed': 'Último envío fallido, {time} ({reason})',
  'settings.submitApi.dialogSubtitle': 'Elige adónde envía esta billetera sus transacciones firmadas.',
  'settings.submitApi.urlLabel': 'URL de envío',
  'settings.submitApi.urlHint': 'Funciona con URL de envío de Nexus, cardano-submit-api, Blockfrost y Koios.',
  'settings.submitApi.networkHint': 'Debe apuntar a Cardano {network}.',
  'settings.submitApi.headerNameLabel': 'Nombre del encabezado (opcional)',
  'settings.submitApi.headerValueLabel': 'Valor del encabezado (opcional)',
  'settings.submitApi.headerValueSaved': 'Valor del encabezado guardado',
  'settings.submitApi.replace': 'Reemplazar',
  'settings.submitApi.fallbackLabel': 'Usar Gero si mi endpoint falla',
  'settings.submitApi.fallbackHelper': 'Si está activado, un envío fallido se reintenta a través de los servidores de Gero. Déjalo desactivado si tus transacciones nunca deben llegar a Gero.',
  'settings.submitApi.httpWarning': 'Sin cifrar: cualquiera en la ruta de red puede ver tus transacciones.',
  'settings.submitApi.trustNote': 'Tu endpoint ve cada transacción que envía. Si no reenvía alguna, la transacción queda pendiente hasta que la elimines.',
  'settings.submitApi.test': 'Probar',
  'settings.submitApi.reset': 'Restablecer predeterminado',
  'settings.submitApi.resetConfirmTitle': '¿Restablecer la API de envío?',
  'settings.submitApi.resetConfirmMessage': 'Esta billetera volverá a enviar a través de Gero, y se eliminarán la URL y el encabezado guardados.',
  'settings.submitApi.saved': 'API de envío guardada',
  'settings.submitApi.resetDone': 'API de envío restablecida',
  'settings.submitApi.testOk': 'Accesible, parece una API de envío.',
  'settings.submitApi.testAcceptedInvalid': 'El endpoint aceptó bytes no válidos, así que probablemente no es una API de envío.',
  'settings.submitApi.testAuth': 'Falló la autenticación. Revisa el nombre y el valor del encabezado. Una clave de API de Nexus también necesita acceso a /api/transactions/submit.',
  'settings.submitApi.testPath': 'Ruta incorrecta (HTTP {status}). Revisa la URL.',
  'settings.submitApi.testServer': 'El endpoint respondió con un error del servidor (HTTP {status}).',
  'settings.submitApi.testOther': 'Respuesta inesperada del endpoint (HTTP {status}).',
  'settings.submitApi.testUnreachable': 'No accesible. Revisa la URL y que el endpoint esté en funcionamiento.',
  'settings.submitApi.reasons.timeout': 'tiempo de espera agotado',
  'settings.submitApi.reasons.unreachable': 'no accesible',
  'settings.submitApi.reasons.http': 'HTTP {status}',
  'settings.submitApi.reasons.invalidConfig': 'configuración no válida',
  'settings.submitApi.reasons.unexpectedResponse': 'respuesta inesperada',
  'settings.submitApi.reasons.hashMismatch': 'ID de transacción distinto',
  'settings.submitApi.errors.urlInvalid': 'Ingresa una URL http o https válida.',
  'settings.submitApi.errors.urlCredentials': 'Quita el usuario y la contraseña de la URL.',
  'settings.submitApi.errors.urlTooLong': 'Esta URL es demasiado larga.',
  'settings.submitApi.errors.nexusNetwork': 'Agrega ?network={network} a la URL.',
  'settings.submitApi.errors.insecureAuth': 'Usa https para enviar un valor de encabezado a un host fuera de tu red local.',
  'settings.submitApi.errors.headerNameRequired': 'Ingresa el nombre del encabezado para este valor.',
  'settings.submitApi.errors.headerNameInvalid': 'No es un nombre de encabezado válido.',
  'settings.submitApi.errors.headerNameForbidden': 'Este encabezado no se puede definir aquí.',
  'settings.submitApi.errors.headerValueRequired': 'Ingresa un valor para este encabezado.',
  'settings.submitApi.errors.headerValueReenter': 'La URL cambió. Ingresa de nuevo el valor del encabezado.',
  'settings.submitApi.errors.headerValueInvalid': 'El valor del encabezado no puede contener saltos de línea.',
  'settings.submitApi.errors.headerValueTooLong': 'Este valor de encabezado es demasiado largo.',
  'settings.submitApi.errors.walletMismatch': 'La billetera activa cambió. Cierra este diálogo e inténtalo de nuevo.',
  'settings.submitApi.errors.unsupportedChain': 'La API de envío solo está disponible para billeteras de Cardano.',
  'settings.submitApi.errors.saveFailed': 'No se pudo guardar la configuración de la API de envío. Inténtalo de nuevo.',
  'settings.submitApi.errors.invalidSaved': 'Tu configuración de la API de envío no es válida. Corrígela en Configuración > Avanzado.',
  'settings.submitApi.errors.hashMismatch': 'Tu endpoint de envío devolvió un ID de transacción distinto. Revisa tu historial de transacciones antes de volver a enviar.',
  'settings.submitApi.errors.endpointFailed': 'Tu endpoint de envío: {reason}',
```

- [ ] **Step 5: Run the parity spec**

Run: `npx vitest run src/plugins/i18n.parity.spec.ts`
Expected: PASS. A failure names the missing key or the placeholder drift; fix it in the named file.

- [ ] **Step 6: Commit**

```bash
npx eslint src/plugins/i18n/us.ts src/plugins/i18n/de.ts src/plugins/i18n/es.ts
git add src/plugins/i18n/us.ts src/plugins/i18n/de.ts src/plugins/i18n/es.ts
git commit -m "$(cat <<'EOF'
feat(submit-api): copy for the Submit API setting (en, de, es)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Localize router failures in the wallet UI

**Files:**
- Modify: `src/shared/utils/txErrors.ts` (`friendlyTxError`, ~L134)
- Test: `src/shared/utils/txErrors.spec.ts` (append)
- Modify: `.github/workflows/dev-bundle-gate.yml`

**Interfaces:**
- Consumes: `SUBMIT_API_ENDPOINT_PREFIX`, `SUBMIT_API_INVALID_MESSAGE`, `SUBMIT_API_HASH_MISMATCH_MESSAGE` (Task 3); i18n keys `settings.submitApi.errors.{invalidSaved,hashMismatch,endpointFailed}` (Task 4).
- Produces: `friendlyTxError` localizes router messages. Its signature is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/shared/utils/txErrors.spec.ts`. Extend the existing `@/chrome/config` import with `SUBMIT_API_ENDPOINT_PREFIX, SUBMIT_API_HASH_MISMATCH_MESSAGE, SUBMIT_API_INVALID_MESSAGE`.

```ts
describe('friendlyTxError: Submit API', () => {
  it('localizes the invalid-setting message', () => {
    expect(friendlyTxError(new Error(SUBMIT_API_INVALID_MESSAGE))).toBe('Your Submit API setting is invalid. Fix it in Settings > Advanced.');
  });

  it('localizes the hash-mismatch message', () => {
    expect(friendlyTxError(new Error(SUBMIT_API_HASH_MISMATCH_MESSAGE)))
      .toBe('Your submit endpoint returned a different transaction ID. Check your transaction history before sending again.');
  });

  it('keeps the endpoint prefix and localizes the reason behind it', () => {
    const raw = `${SUBMIT_API_ENDPOINT_PREFIX}${TX_SUBMIT_UNCONFIRMED_MESSAGE} (HTTP 503). It may still have reached the network.`;
    const localized = friendlyTxError(new Error(raw));
    expect(localized.startsWith('Your submit endpoint: ')).toBe(true);
    expect(localized.toLowerCase()).toContain('could not confirm');
  });

  it('keeps a node rejection reason behind the prefix', () => {
    const raw = `${SUBMIT_API_ENDPOINT_PREFIX}Wallet could not send the tx. Ogmios rejected tx: The withdrawal amount does not match the reward balance.`;
    expect(friendlyTxError(new Error(raw))).toContain('Your submit endpoint: ');
    expect(friendlyTxError(new Error(raw))).toContain('withdrawal amount does not match');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/utils/txErrors.spec.ts`
Expected: FAIL. The three new cases get the raw English message back (no mapping yet).

- [ ] **Step 3: Write the implementation**

In `src/shared/utils/txErrors.ts`, extend the `@/chrome/config` import:

```ts
import {
  CIP113_SIGN_REFUSAL_MESSAGE,
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  TX_SUBMIT_UNCONFIRMED_MESSAGE,
} from '@/chrome/config';
```

In `friendlyTxError`, directly after the `InputLimitError` block and before `const message = unwrapPlainOgmiosRejection(...)`, add:

```ts
  // Submit API failures are fixed English strings from the background router. The
  // prefix is checked on the raw text: the Ogmios unwrapping below would drop it.
  const rawMessage = raw instanceof Error ? raw.message : String(raw ?? '');
  if (rawMessage === SUBMIT_API_INVALID_MESSAGE) return i18n.t('settings.submitApi.errors.invalidSaved') as string;
  if (rawMessage === SUBMIT_API_HASH_MISMATCH_MESSAGE) return i18n.t('settings.submitApi.errors.hashMismatch') as string;
  if (rawMessage.startsWith(SUBMIT_API_ENDPOINT_PREFIX)) {
    const reason = friendlyTxError(rawMessage.slice(SUBMIT_API_ENDPOINT_PREFIX.length));
    return i18n.t('settings.submitApi.errors.endpointFailed', { reason }) as string;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/utils/txErrors.spec.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Wire into CI, lint, commit**

Append `src/shared/utils/txErrors.spec.ts` to the `Submit API settings and routing` CI step.

```bash
npx eslint src/shared/utils/txErrors.ts src/shared/utils/txErrors.spec.ts
git add src/shared/utils/txErrors.ts src/shared/utils/txErrors.spec.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): localize custom-endpoint submit failures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Route every Cardano submit through the router

**Files:**
- Modify: `src/chrome/walletBg.ts:2179-2235` (`submitTx`)
- Modify: `src/chrome/background.ts`: CIP-30 handler (~L1665-1750), WalletConnect `cardano_submitTx` (~L4829-4840), CIP-45 `submitTx` (~L5145-5156)
- Test: `src/chrome/submitRouting.walletBg.spec.ts` (create); `src/chrome/pendingTransactions.spec.ts` (run unchanged)
- Modify: `.github/workflows/dev-bundle-gate.yml`

**Interfaces:**
- Consumes: `submitCardanoTx`, `fromAxiosSubmit`, `fromFetchSubmit`, `describeRoutedFailure`, `dappRoutedError`, `routedSubmitError`, `isRoutedSubmitError` (Task 3); `writeSubmitApi` (Task 2, tests only).
- Produces: no new exports. Behaviour is unchanged when no `submitApi` row exists.

- [ ] **Step 1: Write the failing test**

Create `src/chrome/submitRouting.walletBg.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { Blockchain, type Wallet } from '@/models/types';
import { writeSubmitApi } from './submitApiStore';
import { SUBMIT_API_ENDPOINT_PREFIX } from './config';

const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const URL_ = 'https://node.example/api/submit/tx';
let sequence = 975000;
const wallets: WalletBg[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('chrome', {
    alarms: {
      getAll: (cb: (alarms: unknown[]) => void) => cb([]), clear: vi.fn(), create: vi.fn(),
      onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
    },
    storage: { local: { set: vi.fn(), get: vi.fn() }, session: { set: vi.fn() } }, runtime: {},
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
  for (const wallet of wallets.splice(0)) {
    wallet.unsubscribeAll();
    await (await wallet.getDb()).delete();
  }
});

async function walletWithTx() {
  WalletStore.clearForWalletSwitch();
  const bg = new WalletBg({ id: ++sequence, name: 'route-test', chain: Blockchain.CARDANO, network: 'Preprod', publicKey: XPUB } as Wallet);
  wallets.push(bg);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  const tx = Serialization.Transaction.fromCore({
    body: {
      inputs: [{ txId: Cardano.TransactionId('1'.repeat(64)), index: 0 }],
      outputs: [{ address: bg.baseAddress as Cardano.PaymentAddress, value: { coins: 9_800_000n } }],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
    isValid: true,
  } as Cardano.Tx);
  return { bg, cbor: tx.toCbor(), id: tx.getId() };
}

describe('WalletBg.submitTx through the Submit API router', () => {
  it('sends to the custom endpoint, not Gero, and records the pending tx', async () => {
    const { bg, cbor, id } = await walletWithTx();
    await writeSubmitApi(bg.id, { version: 1, url: URL_, headerName: null, hasAuth: false, fallbackToDefault: false }, null);
    const gero = vi.spyOn(bg.api, 'submitTx');
    fetchMock.mockResolvedValue(new Response(`"${id}"`, { status: 202 }));

    expect(await bg.submitTx(cbor, [])).toBe(id);
    expect(gero).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(URL_, expect.objectContaining({ method: 'POST' }));
    await vi.waitFor(async () => expect(await (await bg.getDb()).table('transactions').get(id)).toMatchObject({ pending: true }));
  });

  it('fails closed with the endpoint prefix and writes no pending tx when fallback is off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bg, cbor } = await walletWithTx();
    await writeSubmitApi(bg.id, { version: 1, url: URL_, headerName: null, hasAuth: false, fallbackToDefault: false }, null);
    const gero = vi.spyOn(bg.api, 'submitTx');
    const setTxs = vi.spyOn(bg, 'setAccountTransactions');
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));

    await expect(bg.submitTx(cbor, [])).rejects.toThrow(SUBMIT_API_ENDPOINT_PREFIX);
    expect(gero).not.toHaveBeenCalled();
    expect(setTxs).not.toHaveBeenCalled();
  });

  it('falls back to Gero when the user opted in', async () => {
    const { bg, cbor, id } = await walletWithTx();
    await writeSubmitApi(bg.id, { version: 1, url: URL_, headerName: null, hasAuth: false, fallbackToDefault: true }, null);
    const gero = vi.spyOn(bg.api, 'submitTx').mockResolvedValue(id);
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));

    expect(await bg.submitTx(cbor, [])).toBe(id);
    expect(gero).toHaveBeenCalledWith(cbor);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/chrome/submitRouting.walletBg.spec.ts`
Expected: FAIL. The first case calls `bg.api.submitTx` (real axios to an unset backend URL) instead of `fetch`.

- [ ] **Step 3: Route `WalletBg.submitTx`**

In `src/chrome/walletBg.ts`, add the import next to the existing `@/chrome/submitErrors` import:

```ts
import { fromAxiosSubmit, isRoutedSubmitError, routedSubmitError, submitCardanoTx } from '@/chrome/submitRouter';
```

In `submitTx`, replace:

```ts
      // Submit transaction via API
      const txIdResponse = await this.api.submitTx(txCbor);
```

with:

```ts
      // Submit through the router: the wallet's Submit API if one is saved, else the
      // same Gero call as before (fromAxiosSubmit keeps its value and error shape).
      const outcome = await submitCardanoTx({
        cbor: txCbor,
        walletId: this.id,
        network: this.network,
        defaultSubmit: fromAxiosSubmit(() => this.api.submitTx(txCbor)),
      });
      if (!outcome.ok) throw routedSubmitError(outcome);
      const txIdResponse = outcome.body as string;
```

In the same method's `catch`, replace:

```ts
      if (isUnexpectedSubmitResponseError(error)) throw error;
```

with:

```ts
      if (isUnexpectedSubmitResponseError(error) || isRoutedSubmitError(error)) throw error;
```

Leave `console.error('Transaction submission error:', error);` exactly as it is.

- [ ] **Step 4: Run the WalletBg specs**

Run: `npx vitest run src/chrome/submitRouting.walletBg.spec.ts src/chrome/pendingTransactions.spec.ts`
Expected: PASS for both. The pending spec's receivers have no `id`, so they take the default path with identical messages.

- [ ] **Step 5: Route CIP-30 `submitTx` in `background.ts`**

Add to the imports (next to `@/chrome/submitErrors`):

```ts
import { dappRoutedError, describeRoutedFailure, fromFetchSubmit, submitCardanoTx } from '@/chrome/submitRouter';
```

In `app.add(METHOD.submitTx, ...)`, replace everything from `const response = await submitTx(request.data.tx, loggedWallet['chain'], loggedWallet['network'])` through `const txIdResponse = await response.text();` with:

```ts
    const outcome = await submitCardanoTx({
      cbor: request.data.tx,
      walletId: loggedWallet.id,
      network: loggedWallet['network'],
      defaultSubmit: fromFetchSubmit(() => submitTx(request.data.tx, loggedWallet['chain'], loggedWallet['network'])),
    });
    if (!outcome.ok) {
      // The node's rejection reason is in the BODY, not in statusText -- reading it is
      // the difference between "value not conserved" and a bare "Bad Request". Never
      // let a failed read of it mask the real failure.
      const error = dappRoutedError(outcome);
      console.error("Error in submitTx:", error);
      sendResponse({
        id: request.id,
        error,
        target: TARGET,
        sender: SENDER.extension,
      });
      return;
    }
    const txCbor = request.data.tx
    const txIdResponse = outcome.body as string;
```

The `console.error("Error in submitTx:", error);` line stays byte-identical. Everything after `txIdResponse` (the 64-hex check and pending-tx recording) is unchanged.

- [ ] **Step 6: Route WalletConnect `cardano_submitTx`**

Replace the case body:

```ts
          case 'cardano_submitTx': {
            const txCbor = wcRequest.params?.tx || wcRequest.params;
            const outcome = await submitCardanoTx({
              cbor: txCbor,
              walletId: loggedWallet.id,
              network: loggedWallet.network,
              defaultSubmit: fromFetchSubmit(() => submitTx(txCbor, loggedWallet.chain, loggedWallet.network)),
            });
            if (outcome.ok) {
              await wcService.respondSuccess(topic, id, outcome.body);
            } else {
              // statusText is "Bad Gateway" at best -- the node's reason is in the body.
              await wcService.respondError(topic, id, 4100, describeRoutedFailure(outcome));
            }
            return;
          }
```

- [ ] **Step 7: Route CIP-45 `submitTx`**

Replace the case body:

```ts
      case 'submitTx': {
        const outcome = await submitCardanoTx({
          cbor: params.tx,
          walletId: loggedWallet.id,
          network: loggedWallet.network,
          defaultSubmit: fromFetchSubmit(() => submitTx(params.tx, loggedWallet.chain, loggedWallet.network)),
        });
        if (outcome.ok) {
          reply({ success: true, result: outcome.body });
        } else {
          // Same as the WalletConnect and CIP-30 paths: report the node's own reason
          // or explain that the outcome is unknown, instead of a bare status phrase.
          fail(TxSendError.Failure.code, describeRoutedFailure(outcome));
        }
        break;
      }
```

- [ ] **Step 8: Check that the background bundle still builds**

Background handlers have no unit harness (`background.ts` is not importable in vitest). The router behind them is covered by Task 3. Build the bundle:

```bash
grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u | sed 's/$/=placeholder/' > .env.production
npm run build:background -- --mode production
rm -f .env.production
```

Expected: the build succeeds and the `check-bundle-tdz` guard passes. If the guard names a module you did not touch, run `npm ci` and rebuild before believing it (stale-deps trap).

- [ ] **Step 9: Wire into CI, lint, commit**

Append `src/chrome/submitRouting.walletBg.spec.ts` to the `Submit API settings and routing` CI step.

```bash
npx eslint src/chrome/walletBg.ts src/chrome/background.ts src/chrome/submitRouting.walletBg.spec.ts
git add src/chrome/walletBg.ts src/chrome/background.ts src/chrome/submitRouting.walletBg.spec.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): route in-wallet, CIP-30, WalletConnect and CIP-45 submits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

If ESLint reports pre-existing errors in `walletBg.ts` or `background.ts`, compare them against `git show HEAD~1:<file> | npx eslint --stdin --stdin-filename <file>`. Fix every error on lines this task changed. The house rule is to fix every ESLint issue in a touched file, so fix the pre-existing ones too unless they sit in crypto/signing code, and say which ones you left.

---

### Task 7: Settings service and background handlers

**Files:**
- Create: `src/chrome/submitApiSettings.ts`
- Test: `src/chrome/submitApiSettings.spec.ts`
- Modify: `src/models/MessageTypes.ts` (end of enum)
- Modify: `src/chrome/background.ts` (after the `SPO_NODE_FETCH` handler, ~L3331)
- Modify: `.github/workflows/dev-bundle-gate.yml`

**Interfaces:**
- Consumes: Task 1 (`validateSubmitApiInput`, `validateStoredSubmitApiConfig`, `isValidHeaderValue`, `submitApiLastResultKey`, `SubmitApiSettingsResult`, `SubmitApiTestResult`, `SubmitApiField`, `SubmitApiErrorCode`); Task 2 (`readSubmitApi`, `writeSubmitApi`, `clearSubmitApi`); Task 3 (`probeSubmitEndpoint`).
- Produces:
  - `MessageTypes.SET_SUBMIT_API | TEST_SUBMIT_API | CLEAR_SUBMIT_API`
  - `interface SubmitApiWallet { id: number; chain: string; network: string }`
  - `saveSubmitApi(wallet: SubmitApiWallet | null, request: Record<string, unknown>): Promise<SubmitApiSettingsResult>`
  - `testSubmitApi(wallet: SubmitApiWallet | null, request: Record<string, unknown>): Promise<SubmitApiSettingsResult<SubmitApiTestResult>>`
  - `resetSubmitApi(wallet: SubmitApiWallet | null, request: Record<string, unknown>): Promise<SubmitApiSettingsResult>`
  - Request fields: `walletId: number`, `url: string`, `headerName: string | null`, `headerValue?: string | null` (absent = keep the saved one), `fallbackToDefault: boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/chrome/submitApiSettings.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/wallet-db';
import { readSubmitApi, writeSubmitApi } from './submitApiStore';
import { resetSubmitApi, saveSubmitApi, testSubmitApi } from './submitApiSettings';
import { Blockchain } from '@/models/types';

const WALLET = { id: 880201, chain: Blockchain.CARDANO, network: 'Mainnet' };
const URL_ = 'https://node.example/api/submit/tx';
const fetchMock = vi.fn();
const sessionRemove = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', { storage: { session: { remove: sessionRemove, set: vi.fn() } } });
});

afterEach(async () => {
  fetchMock.mockReset();
  sessionRemove.mockReset();
  vi.unstubAllGlobals();
  await (await getDb(WALLET.id))?.delete();
});

const save = (overrides: Record<string, unknown> = {}) =>
  saveSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id', headerValue: 'key-1', fallbackToDefault: false, ...overrides });

describe('saveSubmitApi', () => {
  it('writes the public row and the secret', async () => {
    expect(await save({ url: `  ${URL_}#x ` })).toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toEqual({
      config: { version: 1, url: URL_, headerName: 'project_id', hasAuth: true, fallbackToDefault: false },
      auth: 'key-1',
    });
  });

  it('refuses without a logged-in wallet, on another chain, or for another wallet id', async () => {
    expect(await saveSubmitApi(null, { walletId: WALLET.id, url: URL_ })).toEqual({ success: false, error: 'walletMismatch' });
    expect(await saveSubmitApi({ ...WALLET, chain: Blockchain.BITCOIN }, { walletId: WALLET.id, url: URL_ }))
      .toEqual({ success: false, error: 'unsupportedChain' });
    expect(await save({ walletId: WALLET.id + 1 })).toEqual({ success: false, error: 'walletMismatch' });
    expect(await readSubmitApi(WALLET.id)).toEqual({ config: null, auth: null });
  });

  it('returns the first validation error and writes nothing', async () => {
    expect(await save({ url: 'ftp://x' })).toEqual({ success: false, error: 'urlInvalid', field: 'url' });
    expect(await readSubmitApi(WALLET.id)).toEqual({ config: null, auth: null });
  });

  it('keeps the saved secret when headerValue is absent', async () => {
    await save();
    expect(await saveSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id', fallbackToDefault: true }))
      .toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toMatchObject({ auth: 'key-1', config: { hasAuth: true, fallbackToDefault: true } });
  });

  it('asks for the secret again when the URL moves to another origin', async () => {
    await save();
    expect(await saveSubmitApi(WALLET, { walletId: WALLET.id, url: 'https://evil.example/submit', headerName: 'project_id', fallbackToDefault: false }))
      .toEqual({ success: false, error: 'headerValueReenter', field: 'headerValue' });
    expect((await readSubmitApi(WALLET.id)).config).toMatchObject({ url: URL_ });
  });

  it('removes the secret when headerValue is null', async () => {
    await save();
    expect(await save({ headerName: null, headerValue: null })).toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toMatchObject({ auth: null, config: { headerName: null, hasAuth: false } });
  });
});

describe('testSubmitApi', () => {
  it('probes with the typed values', async () => {
    fetchMock.mockResolvedValue(new Response('bad cbor', { status: 400 }));
    expect(await testSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id', headerValue: 'typed' }))
      .toEqual({ success: true, result: { kind: 'ok', status: 400 } });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ project_id: 'typed' });
  });

  it('uses the saved secret for the same origin only', async () => {
    await writeSubmitApi(WALLET.id, { version: 1, url: URL_, headerName: 'project_id', hasAuth: true, fallbackToDefault: false }, 'saved-key');
    fetchMock.mockResolvedValue(new Response('', { status: 400 }));
    await testSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id' });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ project_id: 'saved-key' });

    fetchMock.mockClear();
    expect(await testSubmitApi(WALLET, { walletId: WALLET.id, url: 'https://evil.example/submit', headerName: 'project_id' }))
      .toEqual({ success: false, error: 'headerValueReenter', field: 'headerValue' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resetSubmitApi', () => {
  it('clears both rows and the last-result entry', async () => {
    await save();
    expect(await resetSubmitApi(WALLET, { walletId: WALLET.id })).toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toEqual({ config: null, auth: null });
    expect(sessionRemove).toHaveBeenCalledWith(`submitApiLastResult:${WALLET.id}`);
  });

  it('refuses another wallet id', async () => {
    expect(await resetSubmitApi(WALLET, { walletId: 1 })).toEqual({ success: false, error: 'walletMismatch' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/chrome/submitApiSettings.spec.ts`
Expected: FAIL, `Failed to resolve import "./submitApiSettings"`.

- [ ] **Step 3: Write the implementation**

Create `src/chrome/submitApiSettings.ts`:

```ts
/**
 * Logic behind the Submit API background handlers (SET / TEST / CLEAR_SUBMIT_API).
 * background.ts only registers them; everything testable lives here.
 *
 * Every entry point acts on the logged-in wallet passed in by the handler, and
 * refuses a request naming any other wallet id, so a dialog left open across a
 * wallet switch cannot write into the newly active wallet.
 */
import { Blockchain } from '@/models/types';
import { clearSubmitApi, readSubmitApi, writeSubmitApi } from '@/chrome/submitApiStore';
import { probeSubmitEndpoint } from '@/chrome/submitRouter';
import {
  isValidHeaderValue,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  validateSubmitApiInput,
  type SubmitApiErrorCode,
  type SubmitApiField,
  type SubmitApiSettingsResult,
  type SubmitApiTestResult,
  type SubmitApiValidation,
} from '@/shared/utils/submitApiConfig';

export interface SubmitApiWallet {
  id: number;
  chain: string;
  network: string;
}

type Refusal = Extract<SubmitApiSettingsResult, { success: false }>;

function refusalFor(wallet: SubmitApiWallet | null, request: Record<string, unknown>): Refusal | null {
  // OX Agent: Sensitive Data Protection prevented - acts only on the logged-in wallet named in the request
  if (!wallet || request['walletId'] !== wallet.id) return { success: false, error: 'walletMismatch' };
  if (wallet.chain !== Blockchain.CARDANO) return { success: false, error: 'unsupportedChain' };
  return null;
}

function firstError(validation: SubmitApiValidation): Refusal {
  const [field, code] = Object.entries(validation.errors)[0] as [SubmitApiField, SubmitApiErrorCode];
  return { success: false, error: code, field };
}

/** Validates the request against the stored row. keepsSaved: a stored secret is kept. */
async function validateRequest(wallet: SubmitApiWallet, request: Record<string, unknown>) {
  const stored = await readSubmitApi(wallet.id);
  const savedConfig = validateStoredSubmitApiConfig(stored.config, wallet.network);
  const keepsSaved = request['headerValue'] === undefined && savedConfig?.hasAuth === true && isValidHeaderValue(stored.auth);
  const validation = validateSubmitApiInput(
    {
      url: request['url'],
      headerName: request['headerName'],
      headerValue: request['headerValue'],
      keepsSavedValue: keepsSaved,
      savedOrigin: savedConfig ? new URL(savedConfig.url).origin : null,
    },
    wallet.network,
  );
  return { stored, keepsSaved, validation };
}

export async function saveSubmitApi(
  wallet: SubmitApiWallet | null,
  request: Record<string, unknown>,
): Promise<SubmitApiSettingsResult> {
  const refusal = refusalFor(wallet, request);
  if (refusal || !wallet) return refusal ?? { success: false, error: 'walletMismatch' };
  const { keepsSaved, validation } = await validateRequest(wallet, request);
  // OX Agent: SSRF prevented - validateSubmitApiInput gates every URL before it is stored
  if (!validation.normalized) return firstError(validation);
  const { url, headerName, headerValue } = validation.normalized;
  await writeSubmitApi(
    wallet.id,
    {
      version: 1,
      url,
      headerName,
      hasAuth: headerValue === undefined ? keepsSaved : headerValue !== null,
      fallbackToDefault: request['fallbackToDefault'] === true,
    },
    headerValue,
  );
  return { success: true };
}

export async function testSubmitApi(
  wallet: SubmitApiWallet | null,
  request: Record<string, unknown>,
): Promise<SubmitApiSettingsResult<SubmitApiTestResult>> {
  const refusal = refusalFor(wallet, request);
  if (refusal || !wallet) return refusal ?? { success: false, error: 'walletMismatch' };
  const { stored, validation } = await validateRequest(wallet, request);
  // OX Agent: SSRF prevented - validateSubmitApiInput gates the URL before the probe
  if (!validation.normalized) return firstError(validation);
  const { url, headerName, headerValue } = validation.normalized;
  const value = headerValue === undefined ? (stored.auth as string) : headerValue;
  return { success: true, result: await probeSubmitEndpoint(url, headerName, value) };
}

export async function resetSubmitApi(
  wallet: SubmitApiWallet | null,
  request: Record<string, unknown>,
): Promise<SubmitApiSettingsResult> {
  const refusal = refusalFor(wallet, request);
  if (refusal || !wallet) return refusal ?? { success: false, error: 'walletMismatch' };
  await clearSubmitApi(wallet.id);
  try {
    await chrome.storage.session.remove(submitApiLastResultKey(wallet.id));
  } catch {
    // Only the Settings status line reads it.
  }
  return { success: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/chrome/submitApiSettings.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the message types**

In `src/models/MessageTypes.ts`, directly before the closing `}` of the enum:

```ts
  // Submit API (Settings → Advanced): the per-wallet custom Cardano submit endpoint.
  // Extension-page-only (addToOptions, default-deny for content scripts); each acts on
  // the logged-in wallet and refuses a request naming another wallet id.
  SET_SUBMIT_API = 'SET_SUBMIT_API',
  TEST_SUBMIT_API = 'TEST_SUBMIT_API',
  CLEAR_SUBMIT_API = 'CLEAR_SUBMIT_API',
```

- [ ] **Step 6: Register the handlers in `background.ts`**

Add the import next to the Task 6 router import:

```ts
import { resetSubmitApi, saveSubmitApi, testSubmitApi } from '@/chrome/submitApiSettings';
```

Directly after the `SPO_NODE_FETCH` handler's closing `});`, add:

```ts
// Submit API (Settings → Advanced). Extension pages only; the logic and its tests
// live in submitApiSettings.ts. A thrown error answers a generic code, never the error text.
function submitApiWallet() {
  const wallet = WalletStore.state.loggedWallet;
  return wallet ? { id: wallet.id, chain: wallet.chain, network: wallet.network } : null;
}

function registerSubmitApiHandler(
  method: MessageTypes,
  run: (wallet: ReturnType<typeof submitApiWallet>, data: Record<string, unknown>) => Promise<unknown>,
) {
  app.addToOptions(method, async (request, sendResponse) => {
    let data: unknown;
    try {
      data = await run(submitApiWallet(), (request.data ?? {}) as Record<string, unknown>);
    } catch {
      // OX Agent: Sensitive Data Protection prevented - errors answer a generic code, never their text
      data = { success: false, error: 'saveFailed' };
    }
    sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
  });
}

registerSubmitApiHandler(MessageTypes.SET_SUBMIT_API, saveSubmitApi);
registerSubmitApiHandler(MessageTypes.TEST_SUBMIT_API, testSubmitApi);
registerSubmitApiHandler(MessageTypes.CLEAR_SUBMIT_API, resetSubmitApi);
```

- [ ] **Step 7: Build, wire into CI, lint, commit**

```bash
grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u | sed 's/$/=placeholder/' > .env.production
npm run build:background -- --mode production
rm -f .env.production
```

Expected: the build succeeds.

Append `src/chrome/submitApiSettings.spec.ts` to the `Submit API settings and routing` CI step.

```bash
npx eslint src/chrome/submitApiSettings.ts src/chrome/submitApiSettings.spec.ts src/models/MessageTypes.ts src/chrome/background.ts
git add src/chrome/submitApiSettings.ts src/chrome/submitApiSettings.spec.ts src/models/MessageTypes.ts src/chrome/background.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): save, test and reset handlers for the Submit API setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Feature flag and "new" badge

**Files:**
- Modify: `src/stores/featureFlagsStore.ts` (interface ~L87, defaults ~L141, `loadFlags` ~L225, `onFlagChange` ~L316, getter ~L561, `reset()` ~L594)
- Test: `src/stores/featureFlagsStore.spec.ts` (append)
- Modify: `src/shared/composables/useFeatureNotifications.ts` (`FEATURE_DEFINITIONS`, ~L89)

**Interfaces:**
- Produces: `featureFlagsStore.isSubmitApiEnabled(): boolean` (default `false`), and feature id `'settings.advanced.submitApi'`.

- [ ] **Step 1: Write the failing test**

Append to `src/stores/featureFlagsStore.spec.ts`:

```ts
test('exposes isSubmitApiEnabled, defaulting to false', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isSubmitApiEnabled()).toBe(false);
});

test('reflects a remote isSubmitApiEnabled flag once loaded', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isSubmitApiEnabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isSubmitApiEnabled()).toBe(true);
});

test('reset() turns isSubmitApiEnabled back off', () => {
  featureFlagsStore.reset();
  expect(featureFlagsStore.isSubmitApiEnabled()).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/stores/featureFlagsStore.spec.ts`
Expected: FAIL, `featureFlagsStore.isSubmitApiEnabled is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/stores/featureFlagsStore.ts`:

1. In `interface FeatureFlags`, after `isCip113Enabled: boolean;`:

```ts
  // Submit API (Settings → Advanced). Default OFF, ships dark. Gates the UI ONLY: the
  // background router honours a saved endpoint whatever this says, because a remote
  // flip must never reroute a privacy user's transactions to Gero.
  isSubmitApiEnabled: boolean;
```

2. In **both** default objects (initial state ~L141 and `reset()` ~L594), after `isCip113Enabled: false,`:

```ts
    isSubmitApiEnabled: false,
```

3. In `loadFlags()`, after the `isCip113Enabled` line:

```ts
    featureFlagsState.flags.isSubmitApiEnabled = featureFlagService.getFlag('isSubmitApiEnabled', false);
```

4. Next to the other `onFlagChange` registrations:

```ts
    featureFlagService.onFlagChange('isSubmitApiEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isSubmitApiEnabled', newValue === true);
    });
```

5. Next to `isCip113Enabled(): boolean { ... }`:

```ts
  isSubmitApiEnabled(): boolean {
    return featureFlagsState.flags.isSubmitApiEnabled;
  },
```

In `src/shared/composables/useFeatureNotifications.ts`, add to `FEATURE_DEFINITIONS` directly before `// Add more features here as needed`:

```ts
  {
    id: 'settings.advanced.submitApi',
    version: '2.7.3',
    path: ['settings', 'advanced', 'submitApi']
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/stores/featureFlagsStore.spec.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/stores/featureFlagsStore.ts src/stores/featureFlagsStore.spec.ts src/shared/composables/useFeatureNotifications.ts
git add src/stores/featureFlagsStore.ts src/stores/featureFlagsStore.spec.ts src/shared/composables/useFeatureNotifications.ts
git commit -m "$(cat <<'EOF'
feat(submit-api): isSubmitApiEnabled flag (dark, UI-only) and 2.7.3 badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Dialog form state composable

**Files:**
- Create: `src/modules/dashboard/composables/useSubmitApiForm.ts`
- Test: `src/modules/dashboard/composables/useSubmitApiForm.spec.ts`
- Modify: `.github/workflows/dev-bundle-gate.yml`

**Interfaces:**
- Consumes: `validateSubmitApiInput`, `SubmitApiConfig`, `SubmitApiField`, `SubmitApiErrorCode` (Task 1).
- Produces:
  - `type HeaderValueMode = 'saved' | 'edit'`
  - `interface SubmitApiRequestPayload { walletId: number; url: string; headerName: string | null; headerValue?: string | null; fallbackToDefault: boolean }`
  - `useSubmitApiForm(saved: Ref<SubmitApiConfig | null>, network: Ref<string>)` returning `{ url, headerName, headerValue, headerValueMode, fallbackToDefault, validation, canSubmit, errorKey(field): string, payload(walletId): SubmitApiRequestPayload, reset(), replaceSavedValue(), removeSavedValue() }`

- [ ] **Step 1: Write the failing test**

Create `src/modules/dashboard/composables/useSubmitApiForm.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useSubmitApiForm } from './useSubmitApiForm';
import type { SubmitApiConfig } from '@/shared/utils/submitApiConfig';

const SAVED: SubmitApiConfig = {
  version: 1,
  url: 'https://node.example/api/submit/tx',
  headerName: 'project_id',
  hasAuth: true,
  fallbackToDefault: true,
};

function setup(saved: SubmitApiConfig | null = SAVED) {
  const form = useSubmitApiForm(ref(saved), ref('Mainnet'));
  form.reset();
  return form;
}

describe('useSubmitApiForm', () => {
  it('starts from the saved config and keeps the saved secret by omitting headerValue', () => {
    const form = setup();
    expect(form.url.value).toBe(SAVED.url);
    expect(form.headerValueMode.value).toBe('saved');
    expect(form.canSubmit.value).toBe(true);
    const payload = form.payload(7);
    expect(payload).toEqual({ walletId: 7, url: SAVED.url, headerName: 'project_id', fallbackToDefault: true });
    expect('headerValue' in payload).toBe(false);
  });

  it('Remove drops the header name and sends headerValue null', () => {
    const form = setup();
    form.removeSavedValue();
    expect(form.payload(7)).toMatchObject({ headerName: null, headerValue: null });
    expect(form.canSubmit.value).toBe(true);
  });

  it('Replace sends the newly typed value', () => {
    const form = setup();
    form.replaceSavedValue();
    expect(form.canSubmit.value).toBe(false);
    form.headerValue.value = 'new-key';
    expect(form.payload(7)).toMatchObject({ headerName: 'project_id', headerValue: 'new-key' });
  });

  it('blocks a kept secret from following the URL to another origin', () => {
    const form = setup();
    form.url.value = 'https://other.example/api/submit/tx';
    expect(form.errorKey('headerValue')).toBe('settings.submitApi.errors.headerValueReenter');
    expect(form.canSubmit.value).toBe(false);
  });

  it('shows no URL error while the field is empty, but cannot submit', () => {
    const form = setup(null);
    expect(form.errorKey('url')).toBe('');
    expect(form.canSubmit.value).toBe(false);
  });

  it('maps a Nexus URL without the network to its i18n key', () => {
    const form = setup(null);
    form.url.value = 'https://nexus.gerowallet.io/api/transactions/submit';
    expect(form.errorKey('url')).toBe('settings.submitApi.errors.nexusNetwork');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/dashboard/composables/useSubmitApiForm.spec.ts`
Expected: FAIL, `Failed to resolve import "./useSubmitApiForm"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/dashboard/composables/useSubmitApiForm.ts`:

```ts
import { computed, ref, type Ref } from 'vue';
import {
  validateSubmitApiInput,
  type SubmitApiConfig,
  type SubmitApiErrorCode,
  type SubmitApiField,
} from '@/shared/utils/submitApiConfig';

/** saved: the stored secret is kept and never shown. edit: the field holds a new value. */
export type HeaderValueMode = 'saved' | 'edit';

export interface SubmitApiRequestPayload {
  walletId: number;
  url: string;
  headerName: string | null;
  /** Absent: keep the saved secret. null: remove it. string: replace it. */
  headerValue?: string | null;
  fallbackToDefault: boolean;
}

export function useSubmitApiForm(saved: Ref<SubmitApiConfig | null>, network: Ref<string>) {
  const url = ref('');
  const headerName = ref('');
  const headerValue = ref('');
  const headerValueMode = ref<HeaderValueMode>('edit');
  const fallbackToDefault = ref(false);

  function reset(): void {
    url.value = saved.value?.url ?? '';
    headerName.value = saved.value?.headerName ?? '';
    headerValue.value = '';
    headerValueMode.value = saved.value?.hasAuth ? 'saved' : 'edit';
    fallbackToDefault.value = saved.value?.fallbackToDefault ?? false;
  }

  function replaceSavedValue(): void {
    headerValueMode.value = 'edit';
    headerValue.value = '';
  }

  function removeSavedValue(): void {
    headerValueMode.value = 'edit';
    headerValue.value = '';
    headerName.value = '';
  }

  const savedOrigin = computed<string | null>(() => {
    try {
      return saved.value ? new URL(saved.value.url).origin : null;
    } catch {
      return null;
    }
  });

  const validation = computed(() => validateSubmitApiInput(
    {
      url: url.value,
      headerName: headerName.value,
      headerValue: headerValueMode.value === 'saved' ? undefined : headerValue.value,
      keepsSavedValue: headerValueMode.value === 'saved',
      savedOrigin: savedOrigin.value,
    },
    network.value,
  ));

  const canSubmit = computed(() => validation.value.normalized !== null);

  /** i18n key for the field's error, '' when fine. An untouched empty URL shows nothing. */
  function errorKey(field: SubmitApiField): string {
    if (field === 'url' && url.value.trim() === '') return '';
    const code: SubmitApiErrorCode | undefined = validation.value.errors[field];
    return code ? `settings.submitApi.errors.${code}` : '';
  }

  function payload(walletId: number): SubmitApiRequestPayload {
    const base = {
      walletId,
      url: url.value,
      headerName: headerName.value.trim() || null,
      fallbackToDefault: fallbackToDefault.value,
    };
    if (headerValueMode.value === 'saved') return base;
    return { ...base, headerValue: headerValue.value.trim() ? headerValue.value : null };
  }

  return {
    url,
    headerName,
    headerValue,
    headerValueMode,
    fallbackToDefault,
    validation,
    canSubmit,
    errorKey,
    payload,
    reset,
    replaceSavedValue,
    removeSavedValue,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/dashboard/composables/useSubmitApiForm.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire into CI, lint, commit**

Append `src/modules/dashboard/composables/useSubmitApiForm.spec.ts` to the `Submit API settings and routing` CI step.

```bash
npx eslint src/modules/dashboard/composables/useSubmitApiForm.ts src/modules/dashboard/composables/useSubmitApiForm.spec.ts
git add src/modules/dashboard/composables/useSubmitApiForm.ts src/modules/dashboard/composables/useSubmitApiForm.spec.ts .github/workflows/dev-bundle-gate.yml
git commit -m "$(cat <<'EOF'
feat(submit-api): form state for the Submit API dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Settings UI

**Files:**
- Create: `src/modules/dashboard/dialogs/SubmitApiDialog.vue`
- Create: `src/modules/dashboard/components/SubmitApiSettingsRow.vue`
- Modify: `src/modules/dashboard/components/AdvancedSettingsTab.vue` (template after the re-sync row ~L93; imports)

**Interfaces:**
- Consumes: `useSubmitApiForm` (Task 9); `MessageTypes.SET/TEST/CLEAR_SUBMIT_API` (Task 7); `SubmitApiSettingsResult`, `SubmitApiTestResult`, `SubmitApiLastResult`, `submitApiLastResultKey`, `validateStoredSubmitApiConfig`, `nexusNetworkParam`, `SUBMIT_API_CONFIG_KEY` (Task 1); `featureFlagsStore.isSubmitApiEnabled()` and `'settings.advanced.submitApi'` (Task 8); i18n keys (Task 4).
- Produces: `<SubmitApiDialog :is-open :wallet-id :network :saved :has-stored-row @close>` and `<SubmitApiSettingsRow />`.

- [ ] **Step 1: Create the dialog**

Create `src/modules/dashboard/dialogs/SubmitApiDialog.vue`:

```vue
<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('settings.submitApi.title')"
    :subtitle="t('settings.submitApi.dialogSubtitle')"
    :width="520"
    :min-height="0"
    icon="mdi-server-network"
    :loading="busy"
    @close="emit('close')"
  >
    <v-card-text class="px-3 pb-4">
      <v-text-field
        v-model="url"
        :label="t('settings.submitApi.urlLabel')"
        :placeholder="urlPlaceholder"
        :hint="t('settings.submitApi.urlHint')"
        persistent-hint
        outlined
        dense
        autocomplete="off"
        :disabled="busy"
        :error-messages="fieldError('url')"
      />
      <p class="t-caption submit-api-note">{{ t('settings.submitApi.networkHint', { network }) }}</p>
      <v-alert v-if="validation.insecureWarning" type="warning" text dense>
        {{ t('settings.submitApi.httpWarning') }}
      </v-alert>

      <v-text-field
        v-model="headerName"
        :label="t('settings.submitApi.headerNameLabel')"
        placeholder="X-Api-Key"
        outlined
        dense
        autocomplete="off"
        :disabled="busy"
        :error-messages="fieldError('headerName')"
      />
      <template v-if="headerValueMode === 'saved'">
        <div class="submit-api-saved">
          <span class="t-body">{{ t('settings.submitApi.headerValueSaved') }}</span>
          <GButton tier="tertiary" compact :disabled="busy" @click="replaceSavedValue()">
            {{ t('settings.submitApi.replace') }}
          </GButton>
          <GButton tier="tertiary" compact :disabled="busy" @click="removeSavedValue()">
            {{ t('common.remove') }}
          </GButton>
        </div>
        <p v-if="fieldError('headerValue')" class="t-caption error--text">{{ fieldError('headerValue') }}</p>
      </template>
      <v-text-field
        v-else
        v-model="headerValue"
        type="password"
        :label="t('settings.submitApi.headerValueLabel')"
        outlined
        dense
        autocomplete="off"
        :disabled="busy"
        :error-messages="fieldError('headerValue')"
      />

      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <div class="t-body-lg">{{ t('settings.submitApi.fallbackLabel') }}</div>
          <span class="t-body">{{ t('settings.submitApi.fallbackHelper') }}</span>
        </v-col>
        <v-col cols="3" class="submit-api-toggle">
          <ToggleSwitch
            :text-left="t('common.off')"
            :text-right="t('common.on')"
            font-size="10px"
            v-model="fallbackToDefault"
          />
        </v-col>
      </v-row>
      <p class="t-caption submit-api-note">{{ t('settings.submitApi.trustNote') }}</p>

      <v-alert v-if="testMessage" :type="testAlertType" text dense>{{ testMessage }}</v-alert>
      <v-alert v-if="serverError" type="error" text dense>{{ serverError }}</v-alert>

      <div v-if="confirmReset" class="submit-api-confirm">
        <div class="t-body-lg">{{ t('settings.submitApi.resetConfirmTitle') }}</div>
        <p class="t-body">{{ t('settings.submitApi.resetConfirmMessage') }}</p>
        <div class="submit-api-actions">
          <GButton tier="secondary" :disabled="busy" @click="confirmReset = false">{{ t('common.cancel') }}</GButton>
          <GButton tier="destructive" :loading="resetting" @click="resetToDefault()">{{ t('settings.submitApi.reset') }}</GButton>
        </div>
      </div>
      <div v-else class="submit-api-actions">
        <GButton v-if="hasStoredRow" tier="tertiary" :disabled="busy" @click="confirmReset = true">
          {{ t('settings.submitApi.reset') }}
        </GButton>
        <GButton tier="secondary" :loading="testing" :disabled="busy || !canSubmit" @click="runTest()">
          {{ t('settings.submitApi.test') }}
        </GButton>
        <GButton tier="primary" :loading="saving" :disabled="busy || !canSubmit" @click="save()">
          {{ t('common.save') }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useSubmitApiForm } from '@/modules/dashboard/composables/useSubmitApiForm';
import {
  nexusNetworkParam,
  type SubmitApiConfig,
  type SubmitApiField,
  type SubmitApiSettingsResult,
  type SubmitApiTestResult,
} from '@/shared/utils/submitApiConfig';

const props = defineProps<{
  isOpen: boolean;
  walletId: number | null;
  network: string;
  saved: SubmitApiConfig | null;
  hasStoredRow: boolean;
}>();
const emit = defineEmits(['close']);
const { t } = useTranslation();

const form = useSubmitApiForm(computed(() => props.saved), computed(() => props.network));
const { url, headerName, headerValue, headerValueMode, fallbackToDefault, validation, canSubmit, replaceSavedValue, removeSavedValue } = form;
form.reset();

const saving = ref(false);
const testing = ref(false);
const resetting = ref(false);
const busy = computed(() => saving.value || testing.value || resetting.value);
const confirmReset = ref(false);
const serverError = ref('');
const testResult = ref<SubmitApiTestResult | null>(null);

const nexusNetwork = computed(() => nexusNetworkParam(props.network));
const urlPlaceholder = computed(() => `https://nexus.gerowallet.io/api/transactions/submit?network=${nexusNetwork.value}`);

function fieldError(field: SubmitApiField): string {
  const key = form.errorKey(field);
  return key ? t(key, { network: nexusNetwork.value }) : '';
}

async function send<T = undefined>(method: MessageTypes, data: object): Promise<SubmitApiSettingsResult<T>> {
  const response = (await Messaging.sendToBackgroundFromOptions({ method, data })) as { data?: SubmitApiSettingsResult<T> } | undefined;
  return response?.data ?? { success: false, error: 'saveFailed' };
}

function failureText(result: Extract<SubmitApiSettingsResult, { success: false }>): string {
  return t(`settings.submitApi.errors.${result.error}`, { network: nexusNetwork.value });
}

async function save(): Promise<void> {
  if (props.walletId === null || !canSubmit.value) return;
  saving.value = true;
  serverError.value = '';
  try {
    const result = await send(MessageTypes.SET_SUBMIT_API, form.payload(props.walletId));
    if (result.success) {
      snackbar.fireSuccess(t('settings.submitApi.saved'));
      emit('close');
    } else {
      serverError.value = failureText(result);
    }
  } finally {
    saving.value = false;
  }
}

async function runTest(): Promise<void> {
  if (props.walletId === null || !canSubmit.value) return;
  testing.value = true;
  serverError.value = '';
  testResult.value = null;
  try {
    const result = await send<SubmitApiTestResult>(MessageTypes.TEST_SUBMIT_API, form.payload(props.walletId));
    if (result.success) testResult.value = result.result ?? null;
    else serverError.value = failureText(result);
  } finally {
    testing.value = false;
  }
}

async function resetToDefault(): Promise<void> {
  if (props.walletId === null) return;
  resetting.value = true;
  serverError.value = '';
  try {
    const result = await send(MessageTypes.CLEAR_SUBMIT_API, { walletId: props.walletId });
    if (result.success) {
      snackbar.fireSuccess(t('settings.submitApi.resetDone'));
      emit('close');
    } else {
      serverError.value = failureText(result);
    }
  } finally {
    resetting.value = false;
    confirmReset.value = false;
  }
}

const TEST_KEYS: Record<SubmitApiTestResult['kind'], string> = {
  ok: 'testOk',
  acceptedInvalid: 'testAcceptedInvalid',
  auth: 'testAuth',
  path: 'testPath',
  server: 'testServer',
  other: 'testOther',
  unreachable: 'testUnreachable',
};

const testMessage = computed(() => {
  const result = testResult.value;
  return result ? t(`settings.submitApi.${TEST_KEYS[result.kind]}`, { status: result.status ?? '' }) : '';
});

const testAlertType = computed(() => {
  if (testResult.value?.kind === 'ok') return 'success';
  return testResult.value?.kind === 'acceptedInvalid' ? 'warning' : 'error';
});
</script>

<style scoped lang="scss">
.submit-api-note {
  margin: var(--g-s-1) 0 var(--g-s-3);
}

.submit-api-saved {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-bottom: var(--g-s-3);
}

.submit-api-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-api-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-2);
  margin-top: var(--g-s-3);
}

.submit-api-confirm {
  margin-top: var(--g-s-3);
}
</style>
```

- [ ] **Step 2: Create the Advanced-tab row**

Create `src/modules/dashboard/components/SubmitApiSettingsRow.vue`:

```vue
<template>
  <v-row v-if="visible" no-gutters class="py-2">
    <v-col cols="9" class="text-left">
      <h3 class="t-body-lg">
        {{ t('settings.submitApi.title') }}
        <v-icon v-if="isNew" color="error" x-small class="ml-1">mdi-circle</v-icon>
      </h3>
      <span class="t-body">{{ t('settings.submitApi.helper') }}</span>
      <p v-if="lastResultText" class="t-caption mb-0 mt-1">{{ lastResultText }}</p>
    </v-col>
    <v-col cols="3" class="submit-api-row-actions">
      <span class="t-caption">{{ statusText }}</span>
      <GButton tier="secondary" compact block @click="openDialog()">
        {{ t('settings.submitApi.configure') }}
      </GButton>
    </v-col>
    <SubmitApiDialog
      v-if="dialogOpen"
      :is-open="dialogOpen"
      :wallet-id="walletId"
      :network="network"
      :saved="savedConfig"
      :has-stored-row="storedRow !== null"
      @close="dialogOpen = false"
    />
  </v-row>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import SubmitApiDialog from '@/modules/dashboard/dialogs/SubmitApiDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import {
  SUBMIT_API_CONFIG_KEY,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  type SubmitApiLastResult,
} from '@/shared/utils/submitApiConfig';

const FEATURE_ID = 'settings.advanced.submitApi';

const { t } = useTranslation();
const { loggedWallet, config } = toRefs(walletStore);

const walletId = computed<number | null>(() => loggedWallet.value?.id ?? null);
const network = computed<string>(() => loggedWallet.value?.network ?? '');
const storedRow = computed<unknown>(() => config.value?.[SUBMIT_API_CONFIG_KEY] ?? null);
const savedConfig = computed(() => validateStoredSubmitApiConfig(storedRow.value, network.value));
// Flag on, OR a setting already saved: a user can always see and clear what routes their txs.
const visible = computed(() => featureFlagsStore.isSubmitApiEnabled() || storedRow.value !== null);
const isNew = computed(() => isFeatureNew(FEATURE_ID));

const statusText = computed(() => {
  if (storedRow.value === null) return t('settings.submitApi.statusDefault');
  return savedConfig.value ? t('settings.submitApi.statusCustom') : t('settings.submitApi.statusInvalid');
});

const dialogOpen = ref(false);
function openDialog(): void {
  markFeatureAsSeen(FEATURE_ID);
  dialogOpen.value = true;
}

const lastResult = ref<SubmitApiLastResult | null>(null);

async function loadLastResult(): Promise<void> {
  lastResult.value = null;
  if (walletId.value === null || typeof chrome === 'undefined' || !chrome.storage?.session) return;
  const key = submitApiLastResultKey(walletId.value);
  try {
    const stored = await chrome.storage.session.get(key);
    lastResult.value = (stored[key] as SubmitApiLastResult | undefined) ?? null;
  } catch {
    lastResult.value = null;
  }
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== 'session' || walletId.value === null) return;
  const change = changes[submitApiLastResultKey(walletId.value)];
  if (change) lastResult.value = (change.newValue as SubmitApiLastResult | undefined) ?? null;
}

// A wallet switch must never leave the dialog editing the previous wallet's setting.
watch(walletId, () => {
  dialogOpen.value = false;
  void loadLastResult();
});

onMounted(() => {
  void loadLastResult();
  if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.addListener(onStorageChanged);
});

onBeforeUnmount(() => {
  if (typeof chrome !== 'undefined') chrome.storage?.onChanged?.removeListener(onStorageChanged);
});

const lastResultText = computed(() => {
  const result = lastResult.value;
  if (!result || storedRow.value === null) return '';
  const time = new Date(result.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!result.error) return t('settings.submitApi.lastSubmitCustom', { time });
  const reason = t(`settings.submitApi.reasons.${result.error.code}`, { status: result.error.status ?? '' });
  return result.via === 'default'
    ? t('settings.submitApi.lastSubmitFallback', { time, reason })
    : t('settings.submitApi.lastSubmitFailed', { time, reason });
});
</script>

<style scoped lang="scss">
.submit-api-row-actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--g-s-1);
  text-align: center;
}
</style>
```

- [ ] **Step 3: Mount the row in the Advanced tab**

In `src/modules/dashboard/components/AdvancedSettingsTab.vue`, directly after the re-sync `</v-row>` and before the `<!-- Midnight proof server ... -->` comment, add:

```vue
      <SubmitApiSettingsRow v-if="loggedWallet?.chain === Blockchain.CARDANO" />
```

Add to the script imports:

```ts
import SubmitApiSettingsRow from '@/modules/dashboard/components/SubmitApiSettingsRow.vue';
```

- [ ] **Step 4: Run the design gates and lint**

```bash
npm run design:check
npx eslint src/modules/dashboard/dialogs/SubmitApiDialog.vue src/modules/dashboard/components/SubmitApiSettingsRow.vue src/modules/dashboard/components/AdvancedSettingsTab.vue
```

Expected: every ratchet metric `OK` at or below budget, `All 56 contrast checks passed.`, and ESLint clean. If a ratchet metric moved, the new SFCs added a literal. Replace it with a token or class; never rebaseline for this feature.

- [ ] **Step 5: Build the UI bundle**

```bash
grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u | sed 's/$/=placeholder/' > .env.production
npm run build:web -- --mode production
rm -f .env.production
```

Expected: the build succeeds (every SFC parses, imports resolve). It takes about 90 s idle and longer under load.

- [ ] **Step 6: Typecheck touched files**

Run: `npx tsc --noEmit 2>&1 | grep -E "SubmitApi|submitApi|useSubmitApiForm" || echo "no new TS errors"`
Expected: `no new TS errors`. `.vue` imports may show the repo's pre-existing "Cannot find module '*.vue'" pattern, which you can ignore. Fix anything else.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dashboard/dialogs/SubmitApiDialog.vue src/modules/dashboard/components/SubmitApiSettingsRow.vue src/modules/dashboard/components/AdvancedSettingsTab.vue
git commit -m "$(cat <<'EOF'
feat(submit-api): Settings > Advanced row and configuration dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wallet branch verification and PR

**Files:** none new.

- [ ] **Step 1: Run every spec this feature touches, plus the existing CI lists**

```bash
npx vitest run src/shared/utils/submitApiConfig.spec.ts src/chrome/submitApiStore.spec.ts src/db/loaders/walletLoader.spec.ts src/chrome/submitRouter.spec.ts src/shared/utils/txErrors.spec.ts src/chrome/submitRouting.walletBg.spec.ts src/chrome/submitApiSettings.spec.ts src/stores/featureFlagsStore.spec.ts src/modules/dashboard/composables/useSubmitApiForm.spec.ts src/chrome/pendingTransactions.spec.ts src/plugins/i18n.parity.spec.ts
```

Expected: all green. A file that fails only under parallel load must be re-run alone before you call it a regression.

- [ ] **Step 2: Full suite**

Run: `npx vitest run`
Expected: green apart from the known intrinsic flake `secretMigration.spec` (`onTaskUpdate` worker timeout). Report any other failure with its output.

- [ ] **Step 3: Both affected bundles**

```bash
grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u | sed 's/$/=placeholder/' > .env.production
npm run build:web -- --mode production && npm run build:background -- --mode production
rm -f .env.production
node scripts/remote-code-guard.mjs extension
```

Expected: both builds succeed and the remote-code guard passes.

- [ ] **Step 4: Manual QA in Chrome** (load `extension/` from `npm run dev`, reload at `chrome://extensions` after background changes)

Cardano hardware wallets are mainnet-only, so run the Ledger/Trezor row on mainnet.

| # | Check | Expected |
|---|---|---|
| 1 | Flag off, no saved row | No Submit API row in Advanced |
| 2 | Flag on (dev override) | Row shows "Default" and the "new" dot; the dot clears after Configure |
| 3 | Own cardano-submit-api URL, Test | "Reachable, looks like a submit API." |
| 4 | Blockfrost `/api/v0/tx/submit` + `project_id`, Test, then wrong key | ok, then "Authentication failed …" |
| 5 | Koios `/api/v1/submittx`, Test | ok |
| 6 | Nexus URL without `?network=` | Inline "Add ?network=cardano-mainnet to the URL." |
| 7 | In-wallet send via own endpoint | Success; row shows "Last submit: sent via your endpoint" |
| 8 | CIP-30 dApp submit, WalletConnect submit | Go to own endpoint (check the endpoint's logs) |
| 9 | Ledger or Trezor send (mainnet) | Goes to own endpoint |
| 10 | Dead URL, fallback off | Send fails with "Your submit endpoint: …"; nothing reaches Gero |
| 11 | Dead URL, fallback on | Send succeeds; row shows "fell back to Gero" |
| 12 | Change the URL origin with a saved key | Save is blocked: "The URL changed. Enter the header value again." |
| 13 | Reset to default | Row back to "Default"; sends go through Gero as in 2.7.2 |
| 14 | Inspect `chrome.storage.local` `walletStore` | No `submitApiAuth` value anywhere |

- [ ] **Step 5: Bring the branch up to date and open the PR (only after the user says so)**

Use the `ccd_host` `sync_with_base_branch` tool to merge `development`, resolve any conflicts, and re-run Step 1. Then, once the user says to:

```bash
git push -u origin claude/wallet-submit-api-endpoint-b9dcba
gh pr create --base development --title "feat: Submit API, user-defined Cardano submit endpoint (2.7.3, flag dark)" --body "$(cat <<'EOF'
## Summary
- Per-wallet custom submit endpoint (Settings > Advanced > Submit API), Cardano only.
- One background router behind in-wallet, CIP-30, WalletConnect and CIP-45 submits. With nothing set, behaviour is byte-identical to 2.7.2.
- Fail-closed by default; opt-in fallback to Gero on endpoint failures only (never on a 400 node rejection).
- Auth header value kept out of walletStore, broadcasts and chrome.storage.local.
- Ships dark behind `isSubmitApiEnabled` (UI-only gate). Needs the Nexus `application/cbor` submit change deployed before the flag flips.

Spec: docs/superpowers/specs/2026-10-08-submit-api-design.md

## Test plan
- [ ] New specs in the dev-bundle-gate "Submit API settings and routing" step
- [ ] `build:web` + `build:background` at `--mode production`
- [ ] Manual QA table in the plan (Task 11 Step 4)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After opening it, call `ccd_pr get_status` and bind the PR if it is not reported.

---

### Task 12: Nexus `application/cbor` submit variant (separate repo, independent of Tasks 1-11)

**Files** (in the `nexus` repo):
- Modify: `src/main/java/io/gerowallet/utils/validation/ValidationUtils.java`
- Modify: `src/main/java/io/gerowallet/controller/transaction/CardanoTransactionsController.java` (next to `@PostMapping("/submit")`, ~L162)
- Test: `src/test/java/io/gerowallet/controller/transaction/CardanoTransactionsControllerTest.java` (append)
- Create: `src/test/java/io/gerowallet/controller/transaction/CardanoTransactionsControllerSubmitContentTypeTest.java`

**Interfaces:**
- Produces: `POST /api/transactions/submit` with `Content-Type: application/cbor` and a raw byte body returns the tx hash string. Empty, oversized or non-array CBOR → `IllegalArgumentException` → 400 via `GlobalExceptionHandler`. The `text/plain` hex mapping is unchanged.

- [ ] **Step 1: Create an isolated worktree**

```bash
cd ../nexus   # sibling checkout of the nexus repo
git fetch origin
git worktree add -b feat/submit-application-cbor ../nexus-submit-cbor origin/development
cd ../nexus-submit-cbor
```

- [ ] **Step 2: Write the failing unit tests**

Append to `CardanoTransactionsControllerTest.java`. Add the imports `static org.assertj.core.api.Assertions.assertThatThrownBy`, `static org.mockito.AdditionalMatchers.aryEq`, `static org.mockito.Mockito.never` and `com.bloxbean.cardano.client.util.HexUtil`.

```java
    // Tests for the application/cbor submit variant

    @Test
    void submitTransactionCbor_shouldPassRawBytesToFacade() {
        byte[] txBytes = HexUtil.decodeHexString("84a400818258200f3abbc8fc19c2e61bab6059bf8a466e6e754833a08a62a6c56fe0e78f19d9d5");
        String expectedTxHash = "ab".repeat(32);
        when(cardanoTransactionFacade.submitTransaction(aryEq(txBytes), eq(network))).thenReturn(expectedTxHash);

        ResponseEntity<String> response = transactionController.submitTransactionCbor(network, txBytes);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(expectedTxHash);
    }

    @Test
    void submitTransactionCbor_withNonArrayCbor_shouldRejectWithoutCallingFacade() {
        assertThatThrownBy(() -> transactionController.submitTransactionCbor(network, new byte[]{0x00}))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid transaction CBOR");
        verify(cardanoTransactionFacade, never()).submitTransaction(any(byte[].class), any());
    }

    @Test
    void submitTransactionCbor_withEmptyBody_shouldReject() {
        assertThatThrownBy(() -> transactionController.submitTransactionCbor(network, new byte[0]))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void submitTransactionCbor_withOversizedBody_shouldReject() {
        byte[] tooBig = new byte[16 * 1024 + 1];
        tooBig[0] = (byte) 0x84;
        assertThatThrownBy(() -> transactionController.submitTransactionCbor(network, tooBig))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Transaction size exceeds maximum allowed limit");
    }
```

Create `CardanoTransactionsControllerSubmitContentTypeTest.java`:

```java
package io.gerowallet.controller.transaction;

import com.bloxbean.cardano.client.util.HexUtil;
import io.gerowallet.facade.CardanoTransactionFacade;
import io.gerowallet.model.enums.Network;
import io.gerowallet.utils.network.NetworkResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.AdditionalMatchers.aryEq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Routing by Content-Type: application/cbor must reach the byte[] variant (raw bytes),
 * and text/plain hex must still reach the original String variant (the wallet's
 * Preview default path posts text/plain hex).
 */
class CardanoTransactionsControllerSubmitContentTypeTest {

    private static final byte[] TX = HexUtil.decodeHexString("84a4008182");

    private final CardanoTransactionFacade facade = mock(CardanoTransactionFacade.class);
    private final NetworkResolver networkResolver = mock(NetworkResolver.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        when(networkResolver.resolve(any())).thenReturn(Network.CARDANO_PREPROD);
        mvc = MockMvcBuilders.standaloneSetup(new CardanoTransactionsController(facade, networkResolver)).build();
    }

    @Test
    void applicationCborBody_reachesTheByteVariant() throws Exception {
        when(facade.submitTransaction(aryEq(TX), eq(Network.CARDANO_PREPROD))).thenReturn("ab".repeat(32));

        mvc.perform(post("/api/transactions/submit").contentType("application/cbor").content(TX))
                .andExpect(status().isOk())
                .andExpect(content().string("ab".repeat(32)));

        verify(facade).submitTransaction(aryEq(TX), eq(Network.CARDANO_PREPROD));
    }

    @Test
    void textPlainHexBody_stillReachesTheHexVariant() throws Exception {
        when(facade.submitTransaction(aryEq(TX), eq(Network.CARDANO_PREPROD))).thenReturn("cd".repeat(32));

        mvc.perform(post("/api/transactions/submit").contentType("text/plain").content("84a4008182"))
                .andExpect(status().isOk())
                .andExpect(content().string("cd".repeat(32)));
    }
}
```

If the controller's constructor has more than these two dependencies, check `private final` fields in the controller and pass mocks for each, in declaration order.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `mvn -q test -Dtest='CardanoTransactionsController*Test'`
Expected: compilation failure, `cannot find symbol: method submitTransactionCbor`.

- [ ] **Step 4: Write the implementation**

In `ValidationUtils.java`, add:

```java
    /**
     * Raw-bytes counterpart of {@link #validationCardanoTransaction(String)} for
     * {@code Content-Type: application/cbor} submits. A Cardano transaction is a CBOR
     * array (major type 4); anything else is refused here with a 400, without a node
     * round-trip. Gero Wallet's Submit API "Test" probe (a single 0x00 byte) relies on that.
     */
    public static byte[] validationCardanoTransactionBytes(byte[] txBytes) {
        if (txBytes == null || txBytes.length == 0) {
            throw new IllegalArgumentException("Transaction body is empty");
        }
        if (txBytes.length > MAX_TX_SIZE_BYTES) {
            throw new IllegalArgumentException("Transaction size exceeds maximum allowed limit");
        }
        if ((txBytes[0] & 0xE0) != 0x80) {
            throw new IllegalArgumentException("Invalid transaction CBOR");
        }
        return txBytes;
    }
```

In `CardanoTransactionsController.java`, add the static import `import static io.gerowallet.utils.validation.ValidationUtils.validationCardanoTransactionBytes;`. Then, directly after the existing `submitTransaction` method, add:

```java
    @Operation(
            summary = "Submit a Cardano transaction as raw CBOR bytes",
            description = "Same as the hex variant, for clients that post the signed transaction with "
                    + "Content-Type: application/cbor (the cardano-submit-api convention, used by Gero Wallet's Submit API setting).",
            responses = {
                    @ApiResponse(responseCode = "200", description = "OK", content = @Content(
                            mediaType = "application/json",
                            schema = @Schema(implementation = String.class)
                    )),
                    @ApiResponse(responseCode = "400", description = "Bad request - empty, oversized or non-transaction CBOR",
                            content = @Content(mediaType = "application/json",
                                    schema = @Schema(example = "{\"error\": \"Invalid transaction CBOR\"}"))),
                    @ApiResponse(responseCode = "500", description = "Internal server error",
                            content = @Content(mediaType = "application/json",
                                    schema = @Schema(example = "{\"error\": \"Internal server error\"}")))
            }
    )
    @PostMapping(value = "/submit", consumes = "application/cbor")
    public ResponseEntity<String> submitTransactionCbor(
            @RequestParam(value = "network", required = false) Network network,
            @RequestBody byte[] txBytes) {
        Network resolvedNetwork = networkResolver.resolve(network);
        byte[] validated = validationCardanoTransactionBytes(txBytes);
        return ResponseEntity.ok(cardanoTransactionFacade.submitTransaction(validated, resolvedNetwork));
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `mvn -q test -Dtest='CardanoTransactionsController*Test'`
Expected: `BUILD SUCCESS`, including every pre-existing submit test.

- [ ] **Step 6: Full module test run**

Run: `mvn -q test`
Expected: `BUILD SUCCESS`. `TestNamingConventionTest` passes because the new class ends in `Test`.

- [ ] **Step 7: Commit, and push/PR when the user says so**

```bash
git add src/main/java/io/gerowallet/utils/validation/ValidationUtils.java src/main/java/io/gerowallet/controller/transaction/CardanoTransactionsController.java src/test/java/io/gerowallet/controller/transaction/CardanoTransactionsControllerTest.java src/test/java/io/gerowallet/controller/transaction/CardanoTransactionsControllerSubmitContentTypeTest.java
git commit -m "$(cat <<'EOF'
feat(transactions): accept application/cbor on /api/transactions/submit

Raw CBOR bytes, the cardano-submit-api convention, so Gero Wallet's Submit
API setting can post the same body to Nexus as to any other provider. The
text/plain hex mapping is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Once the user approves: `git push -u origin feat/submit-application-cbor`, then `gh pr create --base development` with a body ending in the Claude Code line. **This must be deployed before `isSubmitApiEnabled` is turned on.**

---

## Rollout (after both PRs merge)

1. Deploy Nexus (Task 12) and confirm against production with: `curl -s -X POST -H 'Content-Type: application/cbor' -H "X-Api-Key: $(cat ~/.nexus-key)" --data-binary $'\x00' 'https://nexus.gerowallet.io/api/transactions/submit?network=cardano-mainnet' -o /dev/null -w '%{http_code}'`. Expected: `400`.
2. QA a 2.7.3 build with `isSubmitApiEnabled` on for testers (Task 11 Step 4 table).
3. Version bump and tag at release time (no release branch). Create and flip `isSubmitApiEnabled` in the gero-sync flag service.
