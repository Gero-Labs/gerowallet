// Sends and swaps on preprod prove with the Local (Docker) proof server only;
// the stored choice is kept for other networks and for everything else.
import { describe, expect, it } from 'vitest';
import {
  isLocalProvingOnlyNetwork, sendProofServerPreference, walletProverFor, type ProofServerPreference,
} from './midnightProvingTarget';

const stored = (over: Partial<ProofServerPreference> = {}): ProofServerPreference => ({
  mode: 'remote', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301',
  zkpaasUrl: '', zkpaasApiKey: '', zkpaasApiSecret: '', ...over,
} as ProofServerPreference);

describe('sendProofServerPreference', () => {
  it('names preprod by any spelling, and only preprod', () => {
    for (const name of ['Preprod', 'preprod', 'midnight-preprod']) expect(isLocalProvingOnlyNetwork(name)).toBe(true);
    for (const name of ['Mainnet', 'Preview', '', null, undefined]) expect(isLocalProvingOnlyNetwork(name)).toBe(false);
  });

  it('is the Local Docker server on preprod, whatever was stored, keeping its URL or the ledger 9 default', () => {
    for (const mode of ['remote', 'zkpaas', 'local'] as const) {
      for (const localEngine of ['helper', 'browser', 'docker', undefined] as const) {
        const ps = sendProofServerPreference('Preprod', stored({ mode, localEngine }));
        expect(ps).toMatchObject({ mode: 'local', localEngine: 'docker', localUrlLedger9: 'http://localhost:6301' });
        expect(walletProverFor('Preprod', ps, 'shielded', { helper: true, browser: true, shieldedOnDevice: true })).toBe('local');
      }
    }
    expect(sendProofServerPreference('Preprod', stored({ localUrlLedger9: undefined })).localUrlLedger9).toBe('http://localhost:6301');
    expect(sendProofServerPreference('Preprod', stored({ localUrlLedger9: 'http://127.0.0.1:7000' })).localUrlLedger9).toBe('http://127.0.0.1:7000');
  });

  it('leaves the stored choice alone elsewhere', () => {
    const ps = stored({ mode: 'zkpaas' });
    expect(sendProofServerPreference('Mainnet', ps)).toBe(ps);
    expect(walletProverFor('Preprod', ps, 'unshielded')).toBe('zkpaas');
  });
});
