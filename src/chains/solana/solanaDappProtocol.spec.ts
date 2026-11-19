import { describe, expect, it } from 'vitest';
import {
  SolanaDappErrorCode,
  bytesFromWire,
  encodeSolanaPanelError,
  parseSolanaPanelError,
  solanaChainId,
  solanaDappError,
  toSolanaPageError,
} from './solanaDappProtocol';

const fallback = solanaDappError(SolanaDappErrorCode.Internal, 'failed');

describe('Solana panel errors', () => {
  it('round-trips the panel decline and nothing else', () => {
    const declined = encodeSolanaPanelError(SolanaDappErrorCode.UserRejected, 'User rejected the request.');
    expect(parseSolanaPanelError(new Error(declined), fallback)).toEqual(
      { type: 'SolanaWalletError', code: 4001, message: 'User rejected the request.' });
    expect(parseSolanaPanelError(new Error('wallet_changed_during_request'), fallback)).toBe(fallback);
    expect(parseSolanaPanelError(JSON.stringify({ type: 'SolanaWalletError', code: 1, message: 'x' }), fallback)).toBe(fallback);
  });
});

describe('toSolanaPageError', () => {
  it('gives the dApp an Error with the code', () => {
    const e = toSolanaPageError(solanaDappError(SolanaDappErrorCode.Unauthorized, 'Not connected')) as Error & { code: number };
    expect(e).toBeInstanceOf(Error);
    expect([e.code, e.message]).toEqual([4100, 'Not connected']);
    expect((toSolanaPageError({ code: -3, info: 'x' }) as Error & { code: number }).code).toBe(-32603);
  });
});

describe('solanaChainId', () => {
  it('maps the wallet network', () => {
    expect(solanaChainId('Mainnet')).toBe('solana:mainnet');
    expect(solanaChainId('Devnet')).toBe('solana:devnet');
  });
});

describe('bytesFromWire', () => {
  it('accepts byte arrays within the limit only', () => {
    expect(bytesFromWire([0, 255, 7], 3)).toEqual(new Uint8Array([0, 255, 7]));
    expect(bytesFromWire([1, 2, 3, 4], 3)).toBeNull();
    expect(bytesFromWire([256], 3)).toBeNull();
    expect(bytesFromWire([1.5], 3)).toBeNull();
    expect(bytesFromWire(['1'], 3)).toBeNull();
    expect(bytesFromWire('abc', 3)).toBeNull();
  });
});
