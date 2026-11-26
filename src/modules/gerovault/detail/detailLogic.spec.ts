// The vault screen's pure parts: the balance with locked UTxOs left out of the totals, the facts
// read from the scripts, what this device recorded per cosigner, and the funding gate.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildVaultFromParticipants, numberVerification, providerResolution, vaultId, type VaultScripts } from '@/shared/gerovault';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { assetNameText, isLockedByUnknownDatum, lockedLovelace, summarizeVaultUtxos } from './balance';
import { chunk, ownKeyPath, vaultFacts, vaultName } from './vaultFacts';
import { cosignerCheck, cosignerChecks, currentVerificationDigest, fundingState } from './verification';
import { utxo, vaultFixture, withManifest, type VaultFixture } from './__fixtures__/vaultFixtures';

let f: VaultFixture;
const DATUM = 'd'.repeat(64);

beforeAll(async () => {
  f = await vaultFixture();
});

describe('summarizeVaultUtxos', () => {
  it('totals ADA and native assets across UTxOs', () => {
    const b = summarizeVaultUtxos([
      utxo(f.address, 1, 5_000_000n, { assets: { HOSKY: 100n } }),
      utxo(f.address, 2, 2_500_000n, { assets: { HOSKY: 50n, ZETA: 1n } }),
    ]);
    expect(b.lovelace).toBe(7_500_000n);
    expect(b.utxoCount).toBe(2);
    expect(b.assets.map(a => [assetNameText(a.assetName), a.quantity])).toEqual([['HOSKY', 150n], ['ZETA', 1n]]);
    expect(b.locked).toEqual([]);
  });

  it('shows a UTxO locked by an unknown datum as locked and leaves it out of every total', () => {
    const b = summarizeVaultUtxos([
      utxo(f.address, 1, 5_000_000n, { assets: { HOSKY: 100n } }),
      utxo(f.address, 2, 9_000_000n, { assets: { HOSKY: 7n }, datumHash: DATUM }),
    ]);
    expect(b.lovelace).toBe(5_000_000n);
    expect(b.utxoCount).toBe(1);
    expect(b.assets.map(a => a.quantity)).toEqual([100n]);
    expect(b.locked).toHaveLength(1);
    expect(b.locked[0]).toMatchObject({ index: 0, lovelace: 9_000_000n, datumHash: DATUM });
    expect(lockedLovelace(b)).toBe(9_000_000n);
  });

  it('counts an inline datum, whose value the wallet knows', () => {
    expect(isLockedByUnknownDatum({ datumHash: undefined, datum: undefined })).toBe(false);
    expect(isLockedByUnknownDatum({ datumHash: DATUM as never, datum: undefined })).toBe(true);
    expect(isLockedByUnknownDatum({ datumHash: DATUM as never, datum: 1n as never })).toBe(false);
  });

  it('answers zero for no UTxOs', () => {
    expect(summarizeVaultUtxos([])).toEqual({ lovelace: 0n, assets: [], utxoCount: 0, locked: [] });
  });

  it('reads printable asset names and keeps any other as hex', () => {
    expect(assetNameText(Buffer.from('Gero').toString('hex'))).toBe('Gero');
    expect(assetNameText('00ff10')).toBe('00ff10');
    expect(assetNameText('')).toBe('');
  });
});

describe('vaultFacts', () => {
  it('reads the address, the threshold and the participants in script order from the record', () => {
    const facts = vaultFacts(f.record);
    expect(facts).toBeDefined();
    expect(facts?.addresses.base).toBe(f.address);
    expect(facts?.payment.hash).toBe(f.vault.payment.hash);
    expect(facts?.template).toEqual({ kind: 'standard', threshold: 2, ownerCount: 3 });
    expect(facts?.self?.label).toBe('Alice');
    const order = f.vault.owners.map(o => o.payment);
    expect(facts?.participants.map(p => p.credential)).toEqual(order);
  });

  it('reads a dated backup path with its time', async () => {
    const backup: VaultScripts = await buildVaultFromParticipants({
      template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
      owners: f.people.slice(0, 2).map(p => ({ vaultKeys: p.vaultKeys })),
      backups: [{ vaultKeys: f.people[3].vaultKeys }],
    });
    const record: VaultRecord = {
      ...f.record,
      vaultId: vaultId(backup, 'preprod'),
      paymentScriptCbor: backup.payment.cbor,
      stakeScriptCbor: backup.stake.cbor,
    };
    const facts = vaultFacts(record);
    expect(facts?.template.kind).toBe('backup');
    expect(facts?.template.backup).toEqual({ threshold: 1, holderCount: 1, afterSlot: 200_000_000, opensAtMs: Date.UTC(2028, 9, 20, 19, 33, 20) });
  });

  it('reports a record whose scripts do not read as a vault as unreadable', () => {
    expect(vaultFacts({ ...f.record, paymentScriptCbor: '00' })).toBeUndefined();
  });

  it('chunks identifiers, names the own key path and reads the name', () => {
    expect(chunk('abcdefghij')).toEqual(['abcd', 'efgh', 'ij']);
    expect(ownKeyPath({ ownIndex: 3 })).toBe('m/1854\'/1815\'/0\'/0/3');
    expect(vaultName({ name: '' })).toBeUndefined();
    expect(vaultName({ name: 'Ops' })).toBe('Ops');
  });
});

describe('cosigner checks', () => {
  it('says checked only for a record of the current verification set', () => {
    const record = withManifest(f.record, f.manifest);
    const digest = currentVerificationDigest(record);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const bob = f.people[1];
    const current = numberVerification(f.manifest, bob.credential, 1_800_000_000);
    expect(cosignerCheck(bob.credential, [current], digest)).toEqual({ credential: bob.credential, state: 'checked', method: 'number', at: 1_800_000_000 });
    const old = { ...current, verificationDigest: 'e'.repeat(64) };
    expect(cosignerCheck(bob.credential, [old], digest).state).toBe('stale');
    expect(cosignerCheck(bob.credential, [old], undefined).state).toBe('recorded');
  });

  it('never counts a provider answer, and leaves this wallet out', () => {
    const bob = f.people[1];
    const provider = providerResolution(bob.credential, 'adaHandle', 1_800_000_000);
    expect(cosignerCheck(bob.credential, [provider], undefined).state).toBe('providerOnly');
    const checks = cosignerChecks(f.record, vaultFacts(f.record)?.participants ?? []);
    expect(checks).toHaveLength(2);
    expect(checks.every(c => c.state === 'unchecked')).toBe(true);
    expect(checks.map(c => c.credential)).not.toContain(f.people[0].credential);
  });
});

describe('fundingState', () => {
  it('blocks a candidate, a vault with no manifest, and one the verifier does not clear', async () => {
    expect(await fundingState({ ...f.record, status: 'candidate' })).toEqual({ verified: false, reason: 'CANDIDATE' });
    expect(await fundingState(f.record)).toEqual({ verified: false, reason: 'NO_MANIFEST' });
    const withM = withManifest(f.record, f.manifest);
    expect(await fundingState(withM)).toEqual({ verified: false, reason: 'NOT_VERIFIED' });
    expect(await fundingState(withM, async () => { throw new Error('boom'); })).toEqual({ verified: false, reason: 'NOT_VERIFIED' });
  });

  it('opens only on the verifier\'s own answer', async () => {
    const withM = withManifest(f.record, f.manifest);
    expect(await fundingState(withM, async () => true)).toEqual({ verified: true });
    expect(await fundingState({ ...withM, status: 'candidate' }, async () => true)).toEqual({ verified: false, reason: 'CANDIDATE' });
  });
});
