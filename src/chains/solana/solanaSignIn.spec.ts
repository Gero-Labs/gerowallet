import { describe, expect, it } from 'vitest';
import { checkSolanaSignIn, solanaSignInMessageText } from './solanaSignIn';
import { solanaSignMessageRefusal } from './solanaSignMessage';

const ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const ctx = { originHost: 'app.example.com', address: ADDRESS, chain: 'solana:devnet', now: Date.parse('2026-11-20T12:00:00Z') };

/** The reference parser's regex (@solana/wallet-standard-util signIn.ts), to prove the text round-trips. */
const MESSAGE = new RegExp('^(?<domain>[^\\n]+?) wants you to sign in with your Solana account:\\n(?<address>[^\\n]+)(?:\\n|$)'
  + '(?:\\n(?<statement>[\\S\\s]*?)(?:\\n|$))??(?:\\nURI: (?<uri>[^\\n]+))?(?:\\nVersion: (?<version>[^\\n]+))?'
  + '(?:\\nChain ID: (?<chainId>[^\\n]+))?(?:\\nNonce: (?<nonce>[^\\n]+))?(?:\\nIssued At: (?<issuedAt>[^\\n]+))?'
  + '(?:\\nExpiration Time: (?<expirationTime>[^\\n]+))?(?:\\nNot Before: (?<notBefore>[^\\n]+))?'
  + '(?:\\nRequest ID: (?<requestId>[^\\n]+))?(?:\\nResources:(?<resources>(?:\\n- [^\\n]+)*))?\\n*$');

describe('checkSolanaSignIn', () => {
  it('fills only the domain and address, and keeps every other field as the dApp sent it', () => {
    const result = checkSolanaSignIn({ statement: 'Sign in to Example', nonce: 'abc123' }, ctx);
    expect(result).toEqual({ ok: true, fields: { domain: 'app.example.com', address: ADDRESS, statement: 'Sign in to Example', nonce: 'abc123' } });
    expect(checkSolanaSignIn(undefined, ctx)).toEqual({ ok: true, fields: { domain: 'app.example.com', address: ADDRESS } });
  });

  it('refuses another site’s domain, another address and another chain', () => {
    expect(checkSolanaSignIn({ domain: 'evil.example' }, ctx)).toEqual({ ok: false, reason: 'DOMAIN_MISMATCH' });
    expect(checkSolanaSignIn({ address: 'So11111111111111111111111111111111111111112' }, ctx)).toEqual({ ok: false, reason: 'ADDRESS_MISMATCH' });
    expect(checkSolanaSignIn({ chainId: 'mainnet' }, ctx)).toEqual({ ok: false, reason: 'CHAIN_MISMATCH' });
    expect(checkSolanaSignIn({ chainId: 'devnet' }, ctx).ok).toBe(true);
    expect(checkSolanaSignIn({ chainId: 'solana:devnet' }, ctx).ok).toBe(true);
  });

  it('refuses a field that would forge a line, and malformed input', () => {
    expect(checkSolanaSignIn({ statement: 'hi\nURI: https://evil' }, ctx)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkSolanaSignIn({ nonce: 'a\u2028b' }, ctx)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkSolanaSignIn({ resources: ['ok', 'bad\nline'] }, ctx)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkSolanaSignIn({ nonce: '' }, ctx)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkSolanaSignIn({ nonce: 5 }, ctx)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkSolanaSignIn('x', ctx)).toEqual({ ok: false, reason: 'INVALID' });
    expect(checkSolanaSignIn({ issuedAt: 'yesterday-ish' }, ctx)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('refuses an expired request and one not valid yet', () => {
    expect(checkSolanaSignIn({ expirationTime: '2026-11-20T11:59:59Z' }, ctx)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(checkSolanaSignIn({ notBefore: '2026-11-20T12:00:01Z' }, ctx)).toEqual({ ok: false, reason: 'NOT_YET_VALID' });
    expect(checkSolanaSignIn({ expirationTime: '2026-11-20T13:00:00Z', notBefore: '2026-11-20T11:00:00Z' }, ctx).ok).toBe(true);
  });
});

describe('solanaSignInMessageText', () => {
  const full = {
    domain: 'app.example.com', address: ADDRESS, statement: 'Sign in to Example', uri: 'https://app.example.com/login',
    version: '1', chainId: 'devnet', nonce: 'abc123', issuedAt: '2026-11-20T12:00:00Z',
    expirationTime: '2026-11-20T13:00:00Z', notBefore: '2026-11-20T11:00:00Z', requestId: 'r1', resources: ['https://a', 'ipfs://b'],
  };

  it('writes the reference layout', () => {
    expect(solanaSignInMessageText({ domain: 'app.example.com', address: ADDRESS }))
      .toBe(`app.example.com wants you to sign in with your Solana account:\n${ADDRESS}`);
    expect(solanaSignInMessageText(full)).toBe([
      'app.example.com wants you to sign in with your Solana account:', ADDRESS, '', 'Sign in to Example', '',
      'URI: https://app.example.com/login', 'Version: 1', 'Chain ID: devnet', 'Nonce: abc123',
      'Issued At: 2026-11-20T12:00:00Z', 'Expiration Time: 2026-11-20T13:00:00Z', 'Not Before: 2026-11-20T11:00:00Z',
      'Request ID: r1', 'Resources:', '- https://a', '- ipfs://b',
    ].join('\n'));
  });

  it('parses back with the reference parser to exactly the fields signed', () => {
    const groups = MESSAGE.exec(solanaSignInMessageText(full))?.groups;
    expect(groups).toMatchObject({ domain: full.domain, address: ADDRESS, statement: full.statement, uri: full.uri, nonce: 'abc123', requestId: 'r1' });
    expect(groups?.['resources']?.split('\n- ').slice(1)).toEqual(full.resources);
  });

  it('is text the message guard lets through', () => {
    expect(solanaSignMessageRefusal(new TextEncoder().encode(solanaSignInMessageText(full)))).toBeNull();
  });
});
