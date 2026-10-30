import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires: the background signs a Nexus-built Midnight transaction only
// after checking it against what the user asked for. The checks themselves are
// covered in midnightBuiltTxGuard.spec.ts; these pin that they run first.
const walletBg = readFileSync(join(__dirname, 'walletBg.ts'), 'utf8');
const background = readFileSync(join(__dirname, 'background.ts'), 'utf8');

const methodBody = (source: string, signature: string) => {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf('\n  async ', start + signature.length);
  return source.slice(start, next < 0 ? undefined : next);
};

describe('Nexus-built Midnight transactions are checked before signing', () => {
  it('an unshielded send is checked against the requested outputs before it is balanced and signed', () => {
    const body = methodBody(walletBg, 'async balanceAndSignMidnightUnshieldedTransfer(');
    const check = body.indexOf('assertMidnightTransferMatches(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf('balanceAndSignUnshieldedTransfer({'));
    expect(body).toContain("throw new Error('The requested outputs are required to check the transaction before signing')");
  });

  it('a native NIGHT DUST registration is checked against the chosen DUST address before its segment is signed', () => {
    const body = methodBody(walletBg, 'async signMidnightSegments(');
    const check = body.indexOf('assertMidnightDustRegistrationMatches(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf('keystore.signData('));
    expect(body).toContain('if (!unprovenTxHex || !dustReceiverAddressBech32)');
  });

  it('the background handlers pass what the user asked for through', () => {
    expect(background).toContain('signMidnightSegments(segments, password, prfBytes, unprovenTxHex, dustReceiverAddressBech32)');
    const handler = background.slice(background.indexOf('MessageTypes.BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX,'));
    expect(handler.slice(0, handler.indexOf('sendResponse({'))).toContain('intendedOutputs');
  });
});
