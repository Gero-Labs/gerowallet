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

  it('rejects URL when normalized form exceeds length limit (unicode expansion)', () => {
    const v = validateSubmitApiInput(base({ url: `https://a.example/${'é'.repeat(400)}` }), 'Mainnet');
    expect(v.errors.url).toBe('urlTooLong');
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

  it('isValidHeaderValue rejects non-Latin-1 characters', () => {
    expect(isValidHeaderValue('key​')).toBe(false); // zero-width space
    expect(isValidHeaderValue('ключ')).toBe(false); // Cyrillic
  });

  it('validateSubmitApiInput rejects non-Latin-1 header values', () => {
    const v = validateSubmitApiInput(base({ headerName: 'project_id', headerValue: 'ключ' }), 'Mainnet');
    expect(v.errors.headerValue).toBe('headerValueInvalid');
    expect(v.normalized).toBeNull();
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
