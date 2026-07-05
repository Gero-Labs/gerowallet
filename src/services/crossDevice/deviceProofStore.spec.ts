import { describe, it, expect } from 'vitest';
import { loadDeviceRegisterProof, saveDeviceRegisterProof, type ProofStorage } from './deviceProofStore';
import type { DeviceRegisterProof } from './protocol';

function memStorage(seed: Record<string, unknown> = {}): ProofStorage {
  const store: Record<string, unknown> = { ...seed };
  return { get: async (k) => store[k], set: async (k, v) => { store[k] = v; } };
}

const PROOF: DeviceRegisterProof = { coseSign1: '84', coseKey: 'a5', stakeAddress: 'stake1uabc' };
const ID = 'aaaa1111';
const STAKE = 'stake1uabc';

describe('deviceProofStore', () => {
  it('loads a proof after saving it (same identity + wallet)', async () => {
    const s = memStorage();
    await saveDeviceRegisterProof(ID, STAKE, PROOF, s);
    expect(await loadDeviceRegisterProof(ID, STAKE, s)).toEqual(PROOF);
  });

  it('returns null when the relay identity has rotated (reinstall)', async () => {
    const s = memStorage();
    await saveDeviceRegisterProof(ID, STAKE, PROOF, s);
    expect(await loadDeviceRegisterProof('different-id', STAKE, s)).toBeNull();
  });

  it('returns null for a different wallet (proof is per reward address)', async () => {
    const s = memStorage();
    await saveDeviceRegisterProof(ID, STAKE, PROOF, s);
    expect(await loadDeviceRegisterProof(ID, 'stake1uother', s)).toBeNull();
  });

  it('keeps proofs for multiple wallets independently', async () => {
    const s = memStorage();
    const p2: DeviceRegisterProof = { coseSign1: '85', coseKey: 'a6', stakeAddress: 'stake1uother' };
    await saveDeviceRegisterProof(ID, STAKE, PROOF, s);
    await saveDeviceRegisterProof(ID, 'stake1uother', p2, s);
    expect(await loadDeviceRegisterProof(ID, STAKE, s)).toEqual(PROOF);
    expect(await loadDeviceRegisterProof(ID, 'stake1uother', s)).toEqual(p2);
  });

  it('returns null / fails closed on empty or malformed input', async () => {
    const s = memStorage({ crossDeviceProofs: { [STAKE]: { identityDeviceId: ID, proof: { coseSign1: 1 } } } });
    expect(await loadDeviceRegisterProof('', STAKE, s)).toBeNull();
    expect(await loadDeviceRegisterProof(ID, STAKE, s)).toBeNull(); // malformed proof
  });
});
