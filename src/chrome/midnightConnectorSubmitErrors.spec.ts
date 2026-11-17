import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwire: a DApp's submitTransaction that fails because of the server
// or the network (a 501 for a paused network, a changed ledger, no answer) is
// answered with InternalError and the readable reason. InvalidRequest is kept
// for a request the dapp got wrong. The classification itself is unit-tested in
// src/api/midnightApiError.spec.ts (isMidnightServerSideFailure).
const background = readFileSync(join(__dirname, 'background.ts'), 'utf8');

describe('DApp submitTransaction errors', () => {
  it('answers a server-side failure with InternalError and the readable reason', () => {
    const start = background.indexOf('app.add(MIDNIGHT_METHOD.submitTransaction,');
    expect(start).toBeGreaterThan(-1);
    const handler = background.slice(start, background.indexOf('\napp.add', start + 10));
    const catchBlock = handler.slice(handler.lastIndexOf('} catch (error) {'));
    expect(catchBlock).toContain('isMidnightServerSideFailure(error) ? MidnightErrorCode.InternalError : MidnightErrorCode.InvalidRequest');
    expect(catchBlock).toContain('midnightApiError(code, getErrorMessage(error))');
  });
});
