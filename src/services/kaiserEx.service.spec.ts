import { describe, expect, it } from 'vitest';
import { isOAuthCodeMessage, readTokenResponse, trustedOAuthOrigins } from './kaiserEx.service';

const popup = {} as Window;
const message = (origin: string, source: unknown, data: unknown) =>
  ({ origin, source, data }) as unknown as MessageEvent;

describe('trustedOAuthOrigins', () => {
  it('normalises the OAuth URL to its origin', () => {
    expect(trustedOAuthOrigins('https://oauth.zione.com/', false)).toEqual(['https://oauth.zione.com']);
  });

  it('trusts the local backend only in dev builds', () => {
    expect(trustedOAuthOrigins('https://oauth.zione.com', true)).toContain('http://localhost:8081');
    expect(trustedOAuthOrigins('https://oauth.zione.com', false)).not.toContain('http://localhost:8081');
  });
});

describe('isOAuthCodeMessage', () => {
  const trusted = ['https://oauth.zione.com'];
  const code = { type: 'OAUTH_CODE', code: 'abc' };

  it('accepts an OAUTH_CODE from the sign-in popup on a trusted origin', () => {
    expect(isOAuthCodeMessage(message('https://oauth.zione.com', popup, code), trusted, popup)).toBe(true);
  });

  it('rejects the same message from any other window', () => {
    expect(isOAuthCodeMessage(message('https://oauth.zione.com', {} as Window, code), trusted, popup)).toBe(false);
  });

  it('rejects an untrusted origin', () => {
    expect(isOAuthCodeMessage(message('https://oauth-sa.kaiserex.com', popup, code), trusted, popup)).toBe(false);
  });

  it('rejects other message types, empty codes, and a missing popup', () => {
    expect(isOAuthCodeMessage(message('https://oauth.zione.com', popup, { type: 'OTHER' }), trusted, popup)).toBe(false);
    expect(isOAuthCodeMessage(message('https://oauth.zione.com', popup, { type: 'OAUTH_CODE', code: '' }), trusted, popup)).toBe(false);
    expect(isOAuthCodeMessage(message('https://oauth.zione.com', popup, code), trusted, null)).toBe(false);
  });
});

describe('readTokenResponse', () => {
  const response = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body });

  it('returns the token body on success', async () => {
    await expect(readTokenResponse(response(true, 200, { access_token: 'a', expires_in: 604799 })))
      .resolves.toMatchObject({ access_token: 'a' });
  });

  it('throws on an HTTP error instead of returning the error body as a token', async () => {
    await expect(readTokenResponse(response(false, 500, { message: 'Server Error' }))).rejects.toThrow('HTTP 500');
  });

  it('throws when a 200 carries no access token', async () => {
    await expect(readTokenResponse(response(true, 200, {}))).rejects.toThrow('HTTP 200');
  });
});
