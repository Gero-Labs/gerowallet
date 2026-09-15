import { describe, it, expect } from 'vitest';
import { parseGovActionId, toApiGovActionId, toDisplayGovActionId } from '@/shared/utils/govActionId';

// A real mainnet governance action, returned by GET /api/dreps as votes[].proposal_id
// alongside its proposal_tx_hash (verified against the live API 2026-08-21).
const BECH32 = 'gov_action1js2s9v92zpxg2rge0y3jt9zy626he2m67x9kx9phw4r942kvsn6sqfym0d7';
const TX_HASH = '941502b0aa104c850d197923259444d2b57cab7af18b63143775465aaacc84f5';

describe('parseGovActionId', () => {
  it('parses the txHash#index form', () => {
    const parsed = parseGovActionId(`${TX_HASH}#0`);
    expect(parsed).toEqual({ txHash: TX_HASH, index: 0 });
  });

  it('parses a non-zero index', () => {
    expect(parseGovActionId(`${TX_HASH}#3`)).toEqual({ txHash: TX_HASH, index: 3 });
  });

  it('parses the bech32 form', () => {
    expect(parseGovActionId(BECH32)).toEqual({ txHash: TX_HASH, index: 0 });
  });

  it('accepts a percent-encoded hash from a URL', () => {
    expect(parseGovActionId(`${TX_HASH}%230`)).toEqual({ txHash: TX_HASH, index: 0 });
  });

  it('tolerates whitespace and uppercase', () => {
    expect(parseGovActionId(`  ${TX_HASH.toUpperCase()}#0  `)).toEqual({ txHash: TX_HASH, index: 0 });
  });

  it('returns null for junk rather than throwing', () => {
    expect(parseGovActionId('hello')).toBeNull();
    expect(parseGovActionId('')).toBeNull();
    expect(parseGovActionId(null)).toBeNull();
  });

  it('rejects a tx hash of the wrong length', () => {
    expect(parseGovActionId('abc#0')).toBeNull();
  });

  it('rejects a negative or non-numeric index', () => {
    expect(parseGovActionId(`${TX_HASH}#-1`)).toBeNull();
    expect(parseGovActionId(`${TX_HASH}#x`)).toBeNull();
  });
});

describe('toApiGovActionId', () => {
  it('percent-encodes the # for the Nexus path segment', () => {
    expect(toApiGovActionId({ txHash: TX_HASH, index: 0 })).toBe(`${TX_HASH}%230`);
  });
});

describe('toDisplayGovActionId', () => {
  it('renders the human/cli form', () => {
    expect(toDisplayGovActionId({ txHash: TX_HASH, index: 0 })).toBe(`${TX_HASH}#0`);
  });
});
