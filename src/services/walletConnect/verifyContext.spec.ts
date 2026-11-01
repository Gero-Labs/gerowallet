import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessWcVerification,
  readWcVerification,
  wcRiskUrl,
  wcScanTargets,
  wcVerificationQuery,
} from './verifyContext';

const ctx = (verified: Record<string, unknown>) => ({ verified: { verifyUrl: 'https://verify.walletconnect.org', ...verified } });

describe('assessWcVerification', () => {
  it('maps the Verify API verdicts', () => {
    expect(assessWcVerification(ctx({ origin: 'https://app.minswap.org', validation: 'VALID' }))).toEqual({ state: 'verified', origin: 'https://app.minswap.org' });
    expect(assessWcVerification(ctx({ origin: 'https://minswap-airdrop.example', validation: 'INVALID' }))).toEqual({ state: 'mismatch', origin: 'https://minswap-airdrop.example' });
    expect(assessWcVerification(ctx({ origin: 'https://app.minswap.org', validation: 'UNKNOWN' }))).toEqual({ state: 'unverified', origin: 'https://app.minswap.org' });
  });

  it('treats a scam flag as a scam whatever the validation says', () => {
    expect(assessWcVerification(ctx({ origin: 'https://evil.example', validation: 'VALID', isScam: true })).state).toBe('scam');
  });

  it('reads anything missing or malformed as unverified', () => {
    for (const odd of [undefined, null, {}, { verified: null }, { verified: { validation: 'MAYBE' } }, 'VALID']) {
      expect(assessWcVerification(odd)).toEqual({ state: 'unverified' });
    }
  });

  it('keeps only an http(s) origin, normalised', () => {
    expect(assessWcVerification(ctx({ origin: 'https://app.minswap.org/path?q=1', validation: 'VALID' })).origin).toBe('https://app.minswap.org');
    expect(assessWcVerification(ctx({ origin: 'javascript:alert(1)', validation: 'VALID' }))).toEqual({ state: 'verified' });
  });
});

describe('readWcVerification', () => {
  it('accepts only a known state', () => {
    expect(readWcVerification({ state: 'mismatch', origin: 'https://evil.example' })).toEqual({ state: 'mismatch', origin: 'https://evil.example' });
    expect(readWcVerification({ state: 'verified' })).toEqual({ state: 'verified' });
    expect(readWcVerification({ state: 'trusted' })).toBeNull();
    expect(readWcVerification(undefined)).toBeNull();
    expect(readWcVerification('verified')).toBeNull();
  });
});

describe('scan and display helpers', () => {
  it('scans the attested origin too when it differs from the claim', () => {
    expect(wcScanTargets('https://app.minswap.org', { state: 'mismatch', origin: 'https://evil.example' })).toEqual(['https://app.minswap.org', 'https://evil.example']);
    expect(wcScanTargets('https://app.minswap.org', { state: 'verified', origin: 'https://app.minswap.org' })).toEqual(['https://app.minswap.org']);
    expect(wcScanTargets('', { state: 'unverified' })).toEqual([]);
  });

  it('rates the attested origin when there is one', () => {
    expect(wcRiskUrl('https://app.minswap.org', { state: 'mismatch', origin: 'https://evil.example' })).toBe('https://evil.example');
    expect(wcRiskUrl('https://app.minswap.org', null)).toBe('https://app.minswap.org');
  });

  it('round-trips through the popup query', () => {
    const v = { state: 'mismatch' as const, origin: 'https://evil.example' };
    const q = new URLSearchParams(wcVerificationQuery(v));
    expect(readWcVerification({ state: q.get('wc'), origin: q.get('wcOrigin') })).toEqual(v);
    expect(wcVerificationQuery({ state: 'unverified' })).toEqual({ wc: 'unverified' });
  });
});

describe('background wiring (source tripwire)', () => {
  const source = readFileSync(join(__dirname, '../../chrome/background.ts'), 'utf8');
  const proposal = source.slice(source.indexOf('wcService.onSessionProposal = async'), source.indexOf('async function routeWcSigningRequest('));
  const request = source.slice(source.indexOf('wcService.onSessionRequest = async'), source.indexOf('// Unknown method', source.indexOf('wcService.onSessionRequest = async')));

  it('a proposal is assessed, scams rejected before any prompt, and the verdict shown', () => {
    expect(proposal).toContain('assessWcVerification(proposal.verifyContext)');
    expect(proposal.indexOf("wcVerify.state === 'scam'")).toBeLessThan(proposal.indexOf('sendToMiniGero('));
    expect(proposal).toContain('wcScanTargets(peerUrl, wcVerify)');
    expect(proposal).toMatch(/sendToMiniGero\('wcSessionProposal', \{[^}]*wcVerify \}/);
    expect(proposal).toContain('wcVerificationQuery(wcVerify)');
  });

  it('every request is assessed, scams refused first, and each signing route carries the verdict', () => {
    expect(request).toContain('assessWcVerification(event.verifyContext)');
    expect(request.indexOf("wcVerify.state === 'scam'")).toBeLessThan(request.indexOf("case 'cardano_getBalance'"));
    const routes = request.match(/routeWcSigningRequest\([\s\S]*?\);/g) ?? [];
    expect(routes.length).toBe(4);
    for (const route of routes) expect(route).toMatch(/chainId, wcVerify,\s*\);$/);
  });
});
