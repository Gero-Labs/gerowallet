import { describe, expect, it } from 'vitest';
import { compareVersions, isForThisInstall, wireNetwork } from './announcementAudience';
import { check, type AnnouncementDocument } from './announcementRules';
import { at, bytes, editorial, NOW, type Doc } from './__fixtures__/docs';

function doc(change: (d: Doc) => void = () => undefined): AnnouncementDocument {
  const d = editorial();
  change(d);
  const r = check(bytes(d), 'editorial', NOW);
  if (r.ok === false) throw new Error(r.refusal);
  return r.document;
}

describe('compareVersions', () => {
  it('compares part by part, numerically', () => {
    expect(compareVersions('2.9.0', '2.9.0')).toBe(0);
    expect(compareVersions('2.9', '2.9.0')).toBe(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.8.9', '2.9.0')).toBeLessThan(0);
    expect(compareVersions('3', '2.99.99')).toBeGreaterThan(0);
  });
});

describe('wireNetwork', () => {
  it('names Cardano networks only', () => {
    expect(wireNetwork('Cardano', 'Mainnet')).toBe('cardano-mainnet');
    expect(wireNetwork('Cardano', 'Preprod')).toBe('cardano-preprod');
    expect(wireNetwork('Bitcoin', 'Mainnet')).toBeNull();
    expect(wireNetwork('Cardano', 'Sanchonet')).toBeNull();
  });
});

describe('isForThisInstall', () => {
  const install = { version: '2.9.0', networks: ['cardano-mainnet'] };

  it('accepts a document for this platform, version and network', () => {
    expect(isForThisInstall(doc(), install)).toBe(true);
  });

  it('ignores a document signed for other platforms', () => {
    expect(isForThisInstall(doc((d) => { at(d, 'audience')['platforms'] = ['ios', 'android']; }), install)).toBe(false);
  });

  it('ignores a document that needs a newer version', () => {
    expect(isForThisInstall(doc(), { ...install, version: '2.8.5' })).toBe(false);
    expect(isForThisInstall(doc(), { ...install, version: '2.10.0' })).toBe(true);
    // A minimum named for another platform says nothing about this one.
    expect(isForThisInstall(doc((d) => { at(d, 'audience')['minVersion'] = { ios: '9.0' }; }), install)).toBe(true);
  });

  it('ignores a document for a network no installed wallet is on', () => {
    expect(isForThisInstall(doc(), { ...install, networks: ['cardano-preprod'] })).toBe(false);
    expect(isForThisInstall(doc(), { ...install, networks: [] })).toBe(false);
    expect(isForThisInstall(doc(), { ...install, networks: ['cardano-preprod', 'cardano-mainnet'] })).toBe(true);
  });

  it('shows a document that names no network to everyone, wallets or not', () => {
    const forAll = doc((d) => { delete at(d, 'audience')['networks']; });
    expect(isForThisInstall(forAll, { ...install, networks: [] })).toBe(true);
  });
});
