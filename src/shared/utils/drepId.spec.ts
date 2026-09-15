import { describe, it, expect } from 'vitest';
import { parseDRepId, toCip129, sameDRep, isDRepId } from '@/shared/utils/drepId';

// This is a real preprod DRep returned by GET /api/dreps (network=PREPROD).
// Its CIP-129 bech32 and its 28-byte credential hex, which must round-trip.
const CIP129 = 'drep1yfrr09kj5wtz8f2yr602k9v5ctfpl9kj54z0f8uzhsprhlcw09j6x';
const CREDENTIAL_HEX = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';

describe('parseDRepId', () => {
  it('parses a CIP-129 bech32 id to its 28-byte credential', () => {
    const parsed = parseDRepId(CIP129);
    expect(parsed).not.toBeNull();
    expect(parsed!.credentialHex).toBe(CREDENTIAL_HEX);
    expect(parsed!.credentialType).toBe('keyHash');
    expect(parsed!.form).toBe('cip129');
  });

  it('parses raw 56-char credential hex', () => {
    const parsed = parseDRepId(CREDENTIAL_HEX);
    expect(parsed!.credentialHex).toBe(CREDENTIAL_HEX);
    expect(parsed!.form).toBe('hex');
  });

  it('uppercase hex is accepted and normalized to lowercase', () => {
    expect(parseDRepId(CREDENTIAL_HEX.toUpperCase())!.credentialHex).toBe(CREDENTIAL_HEX);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parseDRepId(`  ${CIP129}  `)!.credentialHex).toBe(CREDENTIAL_HEX);
  });

  it('returns null for junk rather than throwing', () => {
    expect(parseDRepId('hello')).toBeNull();
    expect(parseDRepId('')).toBeNull();
    expect(parseDRepId(null)).toBeNull();
    expect(parseDRepId(undefined)).toBeNull();
  });

  it('returns null for a bech32 string with an unrelated HRP', () => {
    expect(parseDRepId('stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw')).toBeNull();
  });

  it('passes the two hardcoded keyword DReps straight through', () => {
    for (const kw of ['drep_always_abstain', 'drep_always_no_confidence']) {
      const parsed = parseDRepId(kw);
      expect(parsed!.form).toBe('keyword');
      expect(parsed!.credentialHex).toBe(kw);
    }
  });
});

describe('sameDRep', () => {
  it('matches a CIP-129 id against its raw credential hex', () => {
    expect(sameDRep(CIP129, CREDENTIAL_HEX)).toBe(true);
  });

  it('does not match two different DReps', () => {
    expect(sameDRep(CIP129, 'f'.repeat(56))).toBe(false);
  });

  it('is false when either side is unparseable', () => {
    expect(sameDRep(CIP129, 'junk')).toBe(false);
  });
});

describe('toCip129', () => {
  it('round-trips a credential hex back to the same bech32 id', () => {
    expect(toCip129(CREDENTIAL_HEX, 'keyHash')).toBe(CIP129);
  });
});

describe('isDRepId', () => {
  it('is a thin boolean over parseDRepId', () => {
    expect(isDRepId(CIP129)).toBe(true);
    expect(isDRepId('hello')).toBe(false);
  });
});
