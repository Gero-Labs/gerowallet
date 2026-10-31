import { afterEach, describe, expect, it } from 'vitest';
import { setEnvelopeV2EnabledForTest } from '@/shared/utils/envelopeV2Flag';
import { isGpw2 } from '@/shared/utils/secretEnvelope';
import { encryptSecret } from '@/shared/utils/passwordSecret';
import { decryptDeviceShare, deviceShareNeedsUpgrade, encryptDeviceShare, type DeviceShareSecret } from '@/shared/utils/mpc/deviceShareCipher';
import { SECRET_FORMAT_FIXTURES as F } from '@/shared/utils/__fixtures__/secretFormats';
import { upgradeMpcDeviceShare, type DeviceShareRow, type DeviceShareStore } from './mpcDeviceShareUpgrade';

// The frozen legacy CryptoJS text blob stands in for an old device share: the
// device-share reader is the generic text reader for this format.
const PW = F.pw;
const LEGACY_PLAIN = 'JBSWY3DPEHPK3PXP';
const secret: DeviceShareSecret = { kind: 'password', password: PW };

class MemoryShares implements DeviceShareStore {
  rows = new Map<number, DeviceShareRow>();
  beforeCas?: () => void;
  async getWallet(id: number) {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }
  async casDeviceShare(id: number, expected: string, next: string) {
    this.beforeCas?.();
    const row = this.rows.get(id);
    if (!row || row.mpcDeviceShare !== expected || row.mpcDeviceShareNext) return false;
    this.rows.set(id, { ...row, mpcDeviceShare: next });
    return true;
  }
}

const body = (envelope: string) => envelope.slice(envelope.indexOf(':') + 1);

afterEach(() => setEnvelopeV2EnabledForTest(null));

describe('upgradeMpcDeviceShare', () => {
  it.each([
    ['an untagged legacy share', F.securityData.legacy],
    ['a pw.v1-tagged legacy share', `pw.v1:${F.securityData.legacy}`],
  ])('flag off: re-seals %s as gpw1 under the pw.v1 tag', async (_label, stored) => {
    setEnvelopeV2EnabledForTest(false);
    const store = new MemoryShares();
    store.rows.set(1, { mpcDeviceShare: stored });
    expect(await upgradeMpcDeviceShare(1, secret, store)).toBe('upgraded');
    const next = store.rows.get(1)!.mpcDeviceShare!;
    expect(next.startsWith('pw.v1:gpw1.')).toBe(true);
    expect(await decryptDeviceShare(next, secret)).toBe(LEGACY_PLAIN);
  });

  it('flag on: a legacy or gpw1 share becomes gpw2', async () => {
    setEnvelopeV2EnabledForTest(true);
    const store = new MemoryShares();
    store.rows.set(1, { mpcDeviceShare: F.securityData.legacy });
    store.rows.set(2, { mpcDeviceShare: `pw.v1:${encryptSecret('share-2', PW)}` });
    expect(await upgradeMpcDeviceShare(1, secret, store)).toBe('upgraded');
    expect(await upgradeMpcDeviceShare(2, secret, store)).toBe('upgraded');
    expect(isGpw2(body(store.rows.get(1)!.mpcDeviceShare!))).toBe(true);
    expect(await decryptDeviceShare(store.rows.get(2)!.mpcDeviceShare!, secret)).toBe('share-2');
  });

  it('leaves a current share alone (gpw1 with the flag off, gpw2 always)', async () => {
    setEnvelopeV2EnabledForTest(false);
    const store = new MemoryShares();
    const gpw1 = `pw.v1:${encryptSecret('share', PW)}`;
    store.rows.set(1, { mpcDeviceShare: gpw1 });
    expect(await upgradeMpcDeviceShare(1, secret, store)).toBe('current');
    expect(store.rows.get(1)!.mpcDeviceShare).toBe(gpw1);
  });

  it('never touches a share while a re-split has a next share staged', async () => {
    setEnvelopeV2EnabledForTest(false);
    const store = new MemoryShares();
    store.rows.set(1, { mpcDeviceShare: F.securityData.legacy, mpcDeviceShareNext: 'pw.v1:staged' });
    expect(await upgradeMpcDeviceShare(1, secret, store)).toBe('skipped');
    expect(store.rows.get(1)!.mpcDeviceShare).toBe(F.securityData.legacy);
  });

  it('skips PassKey (PRF) device secrets', async () => {
    const store = new MemoryShares();
    store.rows.set(1, { mpcDeviceShare: 'prf.v1:00' });
    const prf: DeviceShareSecret = { kind: 'prf', prfOutput: new Uint8Array(32), credentialId: 'c', saltId: 's' };
    expect(await upgradeMpcDeviceShare(1, prf, store)).toBe('skipped');
  });

  it('a wrong password or a concurrent write leaves the share exactly as it was', async () => {
    setEnvelopeV2EnabledForTest(false);
    const store = new MemoryShares();
    store.rows.set(1, { mpcDeviceShare: `pw.v1:${encryptSecret('share', PW)}` });
    setEnvelopeV2EnabledForTest(true);
    const before = store.rows.get(1)!.mpcDeviceShare;
    expect(await upgradeMpcDeviceShare(1, { kind: 'password', password: 'wrong' }, store)).toBe('failed');
    expect(store.rows.get(1)!.mpcDeviceShare).toBe(before);

    store.beforeCas = () => { store.rows.set(1, { mpcDeviceShare: 'pw.v1:changed-meanwhile' }); };
    expect(await upgradeMpcDeviceShare(1, secret, store)).toBe('failed');
    expect(store.rows.get(1)!.mpcDeviceShare).toBe('pw.v1:changed-meanwhile');
  });
});

describe('device share format rules', () => {
  it('deviceShareNeedsUpgrade', () => {
    const gpw1 = encryptSecret('x', PW);
    expect(deviceShareNeedsUpgrade(F.securityData.legacy, false)).toBe(true);
    expect(deviceShareNeedsUpgrade(`pw.v1:${F.securityData.legacy}`, false)).toBe(true);
    expect(deviceShareNeedsUpgrade(`pw.v1:${gpw1}`, false)).toBe(false);
    expect(deviceShareNeedsUpgrade(`pw.v1:${gpw1}`, true)).toBe(true);
    expect(deviceShareNeedsUpgrade(`pw.v1:${F.securityData.gpw2}`, true)).toBe(false);
    expect(deviceShareNeedsUpgrade('prf.v1:00', true)).toBe(false);
  });

  it('a re-split never seals the next share weaker than the one it replaces', async () => {
    setEnvelopeV2EnabledForTest(true);
    const current = await encryptDeviceShare('old-share', secret);
    expect(isGpw2(body(current))).toBe(true);
    setEnvelopeV2EnabledForTest(false);
    const next = await encryptDeviceShare('new-share', secret, current);
    expect(isGpw2(body(next))).toBe(true);
    expect(await decryptDeviceShare(next, secret)).toBe('new-share');
    // Without a gpw2 predecessor the flag-off writer is used.
    expect(body(await encryptDeviceShare('new-share', secret, F.securityData.legacy)).startsWith('gpw1.')).toBe(true);
  });
});
