// Gero's own SOL send in the worker (chrome/solanaSend.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ state: { solana: { lamports: '2000000000' as string | null } } }));
vi.mock('@/stores/walletStore', () => ({ default: store }));
vi.mock('@/api/solana-api', () => ({ SolanaApi: class {} }));

import {
  clearSolanaHardwareSends,
  prepareSolanaHardwareSend,
  quoteSolanaSend,
  sendSolana,
  SOLANA_HARDWARE_SEND_TTL_MS,
  solanaSendErrorCode,
  SolanaSendError,
  submitSolanaHardwareSend,
  type SolanaSendWallet,
} from './solanaSend';
import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import { buildSignedSolTransfer, buildSolTransferMessage, signSolanaBytes } from '@/chains/solana/solanaTransaction';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const TO = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

function wallet(chain = 'Solana'): SolanaSendWallet & { signSolanaTransfer: ReturnType<typeof vi.fn> } {
  return {
    chain,
    network: 'Devnet',
    publicKey: FROM,
    signSolanaTransfer: vi.fn(async (params) => {
      const keypair = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0);
      return buildSignedSolTransfer({ ...params, from: keypair.address }, keypair.secretKey);
    }),
  };
}

function api(overrides: Record<string, unknown> = {}) {
  return {
    getFees: vi.fn(async () => ({ baseFeeLamportsPerSignature: 5000, slotsSampled: 150,
      prioritizationFeeMicroLamports: { min: 0, median: 1000, p75: 20000, p90: 50000, max: 1e6 } })),
    getBalance: vi.fn(async () => ({ address: TO, lamports: 10n, slot: 1 })),
    getChainTip: vi.fn(async () => ({ slot: 1, blockHeight: 1, blockhash: BLOCKHASH })),
    submit: vi.fn(async () => 'sig-from-nexus'),
    ...overrides,
  };
}

const request = { recipientAddress: TO, lamports: '1000000000', feeLevel: 'fast', password: 'pw' };

describe('SOL send in the worker', () => {
  beforeEach(() => {
    store.state.solana.lamports = '2000000000';
  });

  it('quotes both levels from Nexus, and says when the sample was unreadable', async () => {
    const quote = await quoteSolanaSend(wallet(), api());
    expect(quote).toEqual({ fees: { standard: '5001', fast: '5012' }, prices: { standard: '1000', fast: '20000' }, live: true });
    const offline = await quoteSolanaSend(wallet(), api({ getFees: vi.fn(async () => { throw new Error('down'); }) }));
    expect(offline).toEqual({ fees: { standard: '5000', fast: '5000' }, prices: { standard: '0', fast: '0' }, live: false });
  });

  it('signs at the fee level the worker reads and submits the signed bytes', async () => {
    const w = wallet();
    const a = api();
    await expect(sendSolana(w, request, a)).resolves.toEqual({ signature: 'sig-from-nexus' });
    expect(w.signSolanaTransfer).toHaveBeenCalledWith(
      { to: TO, lamports: 1_000_000_000n, recentBlockhash: BLOCKHASH, computeUnitPriceMicroLamports: 20000n }, 'pw', undefined);
    expect(a.submit).toHaveBeenCalledWith(expect.any(String));
  });

  it('refuses before signing: wrong chain, bad request, rules', async () => {
    await expect(sendSolana(wallet('Bitcoin'), request, api())).rejects.toMatchObject({ code: 'NOT_SOLANA' });
    await expect(sendSolana(wallet(), { ...request, lamports: 1 }, api())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(sendSolana(wallet(), { ...request, lamports: '-1' }, api())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(sendSolana(wallet(), { ...request, feeLevel: 'ludicrous' }, api())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(sendSolana(wallet(), { ...request, recipientAddress: FROM }, api())).rejects.toMatchObject({ code: 'SAME_ADDRESS' });
    await expect(sendSolana(wallet(), { ...request, lamports: '3000000000' }, api())).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    store.state.solana.lamports = null;
    const w = wallet();
    await expect(sendSolana(w, request, api())).rejects.toMatchObject({ code: 'BALANCE_UNKNOWN' });
    expect(w.signSolanaTransfer).not.toHaveBeenCalled();
  });

  it('refuses opening an empty recipient with less than rent', async () => {
    const a = api({ getBalance: vi.fn(async () => ({ address: TO, lamports: 0n, slot: 1 })) });
    await expect(sendSolana(wallet(), { ...request, lamports: '1000' }, a)).rejects.toMatchObject({ code: 'RECIPIENT_BELOW_RENT' });
  });

  it('an unreadable recipient: below rent is refused as unverified, rent or more still goes', async () => {
    const unreadable = () => api({ getBalance: vi.fn(async () => { throw new Error('nexus down'); }) });
    const w = wallet();
    await expect(sendSolana(w, { ...request, lamports: '1000' }, unreadable())).rejects.toMatchObject({ code: 'RECIPIENT_UNVERIFIED' });
    expect(w.signSolanaTransfer).not.toHaveBeenCalled();
    await expect(sendSolana(wallet(), request, unreadable())).resolves.toEqual({ signature: 'sig-from-nexus' });
  });

  it('wipes the PassKey secret whether signing succeeds or throws', async () => {
    const seen: Uint8Array[] = [];
    const ok = wallet();
    ok.signSolanaTransfer.mockImplementationOnce(async (_p: unknown, _pw: unknown, secret: Uint8Array) => {
      seen.push(secret);
      return { signature: 's', base64: 'AA==' };
    });
    const okBytes = [1, 2, 3];
    await sendSolana(ok, { ...request, password: undefined, privateKeyBytes: okBytes }, api());

    const failing = wallet();
    failing.signSolanaTransfer.mockImplementationOnce(async (_p: unknown, _pw: unknown, secret: Uint8Array) => {
      seen.push(secret);
      throw new Error('PassKey refused');
    });
    const failBytes = [4, 5, 6];
    await expect(sendSolana(failing, { ...request, password: undefined, privateKeyBytes: failBytes }, api()))
      .rejects.toMatchObject({ code: 'BUILD_FAILED' });

    expect(seen.map((s) => Array.from(s))).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect([okBytes, failBytes]).toEqual([[0, 0, 0], [0, 0, 0]]);
  });

  it('reports a signing failure and a submit failure apart, never raw text', async () => {
    const w = wallet();
    w.signSolanaTransfer.mockRejectedValueOnce(new Error('wrong password: secret details'));
    const signErr = await sendSolana(w, request, api()).catch((e) => e);
    expect(solanaSendErrorCode(signErr)).toBe('BUILD_FAILED');
    const submitErr = await sendSolana(wallet(), request, api({ submit: vi.fn(async () => { throw new Error('rpc'); }) })).catch((e) => e);
    expect(solanaSendErrorCode(submitErr)).toBe('SUBMIT_FAILED');
    expect(solanaSendErrorCode(new Error('anything'))).toBe('BUILD_FAILED');
    expect(new SolanaSendError('SAME_ADDRESS').message).toBe('SAME_ADDRESS');
  });
});

describe('SOL send from a hardware wallet', () => {
  const keypair = () => deriveSolanaKeypairFromMnemonic(MNEMONIC, 0);
  const signWith = (message: number[], secret = keypair().secretKey) => Array.from(signSolanaBytes(Uint8Array.from(message), secret));

  beforeEach(() => {
    store.state.solana.lamports = '2000000000';
    clearSolanaHardwareSends();
  });

  it('builds the message the worker checked, and submits it with the device signature', async () => {
    const w = wallet();
    const { message } = await prepareSolanaHardwareSend(w, request, api());
    expect(Uint8Array.from(message)).toEqual(buildSolTransferMessage({
      from: FROM, to: TO, lamports: 1_000_000_000n, recentBlockhash: BLOCKHASH, computeUnitPriceMicroLamports: 20000n,
    }));
    const a = api();
    await expect(submitSolanaHardwareSend(w, { signature: signWith(message) }, a)).resolves.toEqual({ signature: 'sig-from-nexus' });
    const sent = Uint8Array.from(atob((a.submit.mock.calls as unknown as string[][])[0][0]), (c) => c.charCodeAt(0));
    expect(sent[0]).toBe(1);
    expect(Array.from(sent.subarray(1, 65))).toEqual(signWith(message));
    expect(Array.from(sent.subarray(65))).toEqual(message);
    expect(w.signSolanaTransfer).not.toHaveBeenCalled();
    // Used up: the same signature is not sent twice.
    await expect(submitSolanaHardwareSend(w, { signature: signWith(message) }, api())).rejects.toMatchObject({ code: 'SEND_EXPIRED' });
  });

  it('runs the same checks before building anything', async () => {
    await expect(prepareSolanaHardwareSend(wallet(), { ...request, recipientAddress: FROM }, api())).rejects.toMatchObject({ code: 'SAME_ADDRESS' });
    await expect(prepareSolanaHardwareSend(wallet('Bitcoin'), request, api())).rejects.toMatchObject({ code: 'NOT_SOLANA' });
    await expect(submitSolanaHardwareSend(wallet(), { signature: new Array(64).fill(0) }, api())).rejects.toMatchObject({ code: 'SEND_EXPIRED' });
  });

  it('refuses a signature that is not the account’s over that message, and keeps the send for a retry', async () => {
    const w = wallet();
    const { message } = await prepareSolanaHardwareSend(w, request, api());
    const other = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).secretKey;
    const a = api();
    await expect(submitSolanaHardwareSend(w, { signature: signWith(message, other) }, a)).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    await expect(submitSolanaHardwareSend(w, { signature: signWith([...message, 0]) }, a)).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    await expect(submitSolanaHardwareSend(w, { signature: [1, 2, 3] }, a)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(submitSolanaHardwareSend(w, { signature: 'ab'.repeat(64) }, a)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(a.submit).not.toHaveBeenCalled();
    await expect(submitSolanaHardwareSend(w, { signature: signWith(message) }, a)).resolves.toEqual({ signature: 'sig-from-nexus' });
  });

  it('lets a prepared send expire', async () => {
    const w = wallet();
    const { message } = await prepareSolanaHardwareSend(w, request, api(), 1_000);
    await expect(submitSolanaHardwareSend(w, { signature: signWith(message) }, api(), 1_000 + SOLANA_HARDWARE_SEND_TTL_MS))
      .rejects.toMatchObject({ code: 'SEND_EXPIRED' });
  });
});
