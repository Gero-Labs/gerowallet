// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { balanceAndSignLedger9Transfer } from './midnightLedger9';
import { getMidnightEndpoints } from './midnightConfig';

const mocks = vi.hoisted(() => ({ reconstruct: vi.fn(), balance: vi.fn(), transport: vi.fn(), identity: vi.fn(), recheck: vi.fn() }));
vi.mock('./midnightDustLightSync', () => ({ reconstructDustState: mocks.reconstruct }));
vi.mock('./midnightDustLightLedger9', () => ({ dustLedger9: {}, balanceLightDust9: mocks.balance }));
vi.mock('./midnightDustLightTransport', () => ({ createDustLightTransport: mocks.transport }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: mocks.identity, assertMidnightChainIdentityUnchanged: mocks.recheck }));

function args() {
  const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: '01'.repeat(32) });
  const ttl = new Date(Date.now() + 300000);
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([
    { value: 10n, owner: key, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
  ], [{ value: 10n, owner: ledger.addressFromKey(key), type: '00'.repeat(32) }], []);
  return { sdkNetworkId: 'stagenet', endpoints: getMidnightEndpoints('Stagenet')!,
    unshieldedSecretKey: new Uint8Array(32).fill(1), dustSecretSeed: new Uint8Array(32).fill(2), ttl,
    unprovenTxHex: Buffer.from(ledger.Transaction.fromParts('stagenet', undefined, undefined, intent).serialize()).toString('hex') };
}

describe('Stagenet compact DUST balancing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ network: 'midnight-stagenet', chain_generation: 1, genesis_hash: `0x${'11'.repeat(32)}` });
    mocks.recheck.mockResolvedValue(undefined);
    mocks.transport.mockReturnValue({});
    mocks.reconstruct.mockResolvedValue({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params' } });
    mocks.balance.mockReturnValue(ledger.Transaction.fromParts('stagenet'));
  });

  it('signs the transfer after compact state verification and fee preparation', async () => {
    const signed = await balanceAndSignLedger9Transfer(args());
    const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(signed, 'hex'));
    expect(tx.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures).toHaveLength(1);
    expect(mocks.reconstruct).toHaveBeenCalledOnce();
    expect(mocks.recheck).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls[0][1].aborted).toBe(true);
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  it('refuses to sign an unverified snapshot', async () => {
    mocks.reconstruct.mockRejectedValue(new Error('DUST root mismatch'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('root mismatch');
    expect(mocks.balance).not.toHaveBeenCalled();
  });

  it('rejects a reset detected after fee balancing', async () => {
    mocks.recheck.mockRejectedValue(new Error('Chain changed'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('Chain changed');
  });

  it('rejects mismatched endpoints before any synchronization', async () => {
    await expect(balanceAndSignLedger9Transfer({ ...args(), endpoints: getMidnightEndpoints('Preprod')! })).rejects.toThrow('endpoint network mismatch');
    expect(mocks.reconstruct).not.toHaveBeenCalled();
  });
});
