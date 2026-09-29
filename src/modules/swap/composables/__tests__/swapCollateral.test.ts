import { describe, it, expect, vi, beforeEach } from 'vitest';

const lend = vi.fn();
const cosign = vi.fn();
const sendToBackgroundFromOptions = vi.fn(async () => ({}));
vi.mock('@/api/nexus-collateral-api', () => ({
  nexusCollateralApi: { lend: (...a: unknown[]) => lend(...a), cosign: (...a: unknown[]) => cosign(...a) },
  lendRef: (l: { txHash: string; outputIndex: number }) => `${l.txHash}#${l.outputIndex}`,
}));
vi.mock('@/api/nexus-tx-api', () => ({ toNexusNetwork: (n?: string) => (n === 'Mainnet' ? 'cardano-mainnet' : 'cardano-preprod') }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: (...a: unknown[]) => sendToBackgroundFromOptions(...a) } }));
vi.mock('@/models/MessageTypes', () => ({ MessageTypes: { MARK_NEXUS_LENT: 'MARK_NEXUS_LENT' } }));
vi.mock('@/chrome/serialization', () => ({ buildNexusUtxoCbor: (l: { txHash: string }) => `utxo-cbor-${l.txHash.slice(0, 4)}` }));

import { Serialization } from '@cardano-sdk/core';
import { cosignLentCollateral, isLentHere, lendPoolCollateral } from '../swapCollateral';

const VKEY_A = 'a'.repeat(64);
const VKEY_B = 'b'.repeat(64);
const SIG = 'c'.repeat(128);
const witnessWith = (vkey: string) => Serialization.TransactionWitnessSet.fromCore({
  signatures: new Map([[vkey, SIG]]),
} as never).toCbor();
const vkeysOf = (cbor: string) => [...(Serialization.TransactionWitnessSet.fromCbor(cbor as never).toCore().signatures?.keys() ?? [])];

describe('swapCollateral: the Nexus pool as the widget\'s collateral', () => {
  beforeEach(() => { lend.mockReset(); cosign.mockReset(); sendToBackgroundFromOptions.mockClear(); });

  it('lends a pool UTxO for the wallet\'s network, remembers the ref, and tells the worker', async () => {
    lend.mockResolvedValueOnce({ txHash: 'f'.repeat(64), outputIndex: 3, address: 'addr1pool', lovelace: '5000000' });
    const cbor = await lendPoolCollateral('Mainnet');
    expect(cbor).toBe('utxo-cbor-ffff');
    expect(lend).toHaveBeenCalledWith('cardano-mainnet');
    expect(isLentHere(`${'f'.repeat(64)}#3`)).toBe(true);
    expect(isLentHere(`${'f'.repeat(64)}#4`)).toBe(false);
    expect(sendToBackgroundFromOptions).toHaveBeenCalledWith({ method: 'MARK_NEXUS_LENT', data: { utxoRef: `${'f'.repeat(64)}#3` } });
  });

  it('an empty pool surfaces as an error (the caller falls back to "no collateral")', async () => {
    lend.mockRejectedValueOnce(new Error('Collateral pool empty'));
    await expect(lendPoolCollateral('Mainnet')).rejects.toThrow('Collateral pool empty');
  });

  it('co-signs only the collateral inputs this page borrowed and merges the pool witness', async () => {
    lend.mockResolvedValueOnce({ txHash: 'e'.repeat(64), outputIndex: 0, address: 'addr1pool', lovelace: '5000000' });
    await lendPoolCollateral('Mainnet');
    cosign.mockResolvedValueOnce({ witness: witnessWith(VKEY_B) });
    const merged = await cosignLentCollateral('00', witnessWith(VKEY_A), 'Mainnet', [`${'e'.repeat(64)}#0`, `${'d'.repeat(64)}#1`]);
    expect(cosign).toHaveBeenCalledTimes(1);
    expect(cosign).toHaveBeenCalledWith('00', `${'e'.repeat(64)}#0`, 'cardano-mainnet');
    expect(vkeysOf(merged).sort()).toEqual([VKEY_A, VKEY_B]);
  });

  it('leaves the witness set alone when no collateral input was borrowed', async () => {
    const user = witnessWith(VKEY_A);
    expect(await cosignLentCollateral('00', user, 'Mainnet', [`${'d'.repeat(64)}#1`])).toBe(user);
    expect(cosign).not.toHaveBeenCalled();
  });

  it('a failed co-signature for a borrowed ref throws rather than returning an under-signed set', async () => {
    lend.mockResolvedValueOnce({ txHash: '9'.repeat(64), outputIndex: 2, address: 'addr1pool', lovelace: '5000000' });
    await lendPoolCollateral('Mainnet');
    cosign.mockRejectedValueOnce(new Error('cosign 503'));
    await expect(cosignLentCollateral('00', witnessWith(VKEY_A), 'Mainnet', [`${'9'.repeat(64)}#2`])).rejects.toThrow('cosign 503');
  });
});
