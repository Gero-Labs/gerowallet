import { describe, expect, it } from 'vitest';
import { classifySubmitFailure } from './submitFailure';

describe('classifySubmitFailure', () => {
  it('maps a rejected tx (400) to a tx failure', () => {
    expect(classifySubmitFailure(400)).toBe('failure');
  });

  it('maps rate limiting (429) to refused', () => {
    expect(classifySubmitFailure(429)).toBe('refused');
  });

  it('maps a full mempool (425) to mempoolFull', () => {
    expect(classifySubmitFailure(425)).toBe('mempoolFull');
  });

  // gero-backend answers 502 when Ogmios is unreachable and 504 on upstream timeouts, and the
  // ingress answers 502/504 too. These used to fall through to "invalid request".
  it.each([500, 502, 503, 504, 599])('maps server error %i to internal', (status) => {
    expect(classifySubmitFailure(status)).toBe('internal');
  });

  it.each([401, 403, 404, 600, 0, undefined])('maps anything else (%s) to invalidRequest', (status) => {
    expect(classifySubmitFailure(status)).toBe('invalidRequest');
  });
});
