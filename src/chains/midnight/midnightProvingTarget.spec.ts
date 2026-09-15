import { describe, it, expect } from 'vitest';
import { Network } from '@/models/types';
import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import {
  DappProvingUnavailableError,
  describeDappProvingFailure,
  localUrlForNetwork,
  resolveDappProvingTarget,
  resolveProvingTarget,
} from './midnightProvingTarget';
import type { ProofServerPreference } from './midnightProvingTarget';

const base: ProofServerPreference = {
  mode: 'remote',
  localUrl: 'http://localhost:6300',
  localUrlLedger9: 'http://localhost:6301',
  zkpaasUrl: '',
  zkpaasApiKey: '',
  zkpaasApiSecret: '',
};

describe('resolveProvingTarget', () => {
  it('maps local mode to the stored local URL with a strict health check', () => {
    expect(resolveProvingTarget(Network.PREPROD, { ...base, mode: 'local', localUrl: 'http://127.0.0.1:6300' }))
      .toEqual({ kind: 'server', mode: 'local', url: 'http://127.0.0.1:6300', lenientHealth: false });
  });

  it('maps a keyed zkPaaS selection to the Arkhia endpoint with auth headers', () => {
    const target = resolveProvingTarget(Network.PREPROD, { ...base, mode: 'zkpaas', zkpaasApiKey: 'k', zkpaasApiSecret: 's' });
    expect(target.kind).toBe('server');
    if (target.kind !== 'server') return;
    expect(target.mode).toBe('zkpaas');
    expect(target.url).toBe(getMidnightEndpoints(Network.PREPROD)!.zkpaasProofServerUrl);
    expect(target.headers).toEqual({ 'x-api-key': 'k', 'x-api-secret': 's' });
    expect(target.lenientHealth).toBe(true);
  });

  it('reports zkPaaS without a key or override URL as unconfigured instead of throwing', () => {
    expect(resolveProvingTarget(Network.PREPROD, { ...base, mode: 'zkpaas' }))
      .toMatchObject({ kind: 'unconfigured', mode: 'zkpaas', reason: 'zkpaas-unconfigured' });
  });

  it('picks the local server by the network’s ledger, with nothing to switch', () => {
    // One server per circuit family. The network chooses; there is no profile
    // a user can leave on the wrong setting.
    expect(resolveProvingTarget(Network.STAGENET, { ...base, mode: 'local' }))
      .toMatchObject({ kind: 'server', mode: 'local', url: 'http://localhost:6301' });
    expect(resolveProvingTarget(Network.MAINNET, { ...base, mode: 'local' }))
      .toMatchObject({ kind: 'server', mode: 'local', url: 'http://localhost:6300' });
    expect(resolveProvingTarget(Network.PREPROD, { ...base, mode: 'local' }))
      .toMatchObject({ kind: 'server', mode: 'local', url: 'http://localhost:6300' });
    expect(localUrlForNetwork('midnight-stagenet', base)).toBe('http://localhost:6301');
    expect(localUrlForNetwork(Network.MAINNET, base)).toBe('http://localhost:6300');
  });

  it('reports a missing ledger-9 URL as unconfigured rather than falling back to the ledger-8 server', () => {
    // A ledger-8 server cannot prove stagenet; silently using it would fail
    // late with an opaque prover error instead of early with a clear one.
    expect(resolveProvingTarget(Network.STAGENET, { ...base, mode: 'local', localUrlLedger9: '' }))
      .toMatchObject({ kind: 'unconfigured', mode: 'local', reason: 'local-url-missing' });
    expect(resolveProvingTarget(Network.STAGENET, { ...base, mode: 'local', localUrlLedger9: undefined }))
      .toMatchObject({ kind: 'unconfigured', reason: 'local-url-missing' });
    // Ledger 8 is unaffected by the ledger-9 slot.
    expect(resolveProvingTarget(Network.MAINNET, { ...base, mode: 'local', localUrlLedger9: '' }))
      .toMatchObject({ kind: 'server', url: 'http://localhost:6300' });
  });

  it('maps remote mode to Gero Cloud', () => {
    expect(resolveProvingTarget(Network.PREPROD, base)).toEqual({ kind: 'cloud' });
  });
});

describe('resolveDappProvingTarget', () => {
  it('falls back to the network default proof server when the user is on Gero Cloud', () => {
    // Gero Cloud only proves whole wallet-built txs; a dapp's per-circuit
    // /prove has to go to a real proof server — the same URL
    // getConfiguration() already advertises in this mode.
    expect(resolveDappProvingTarget(Network.PREPROD, base)).toEqual({
      url: getMidnightEndpoints(Network.PREPROD)!.defaultProofServerUrl,
      source: 'default',
    });
  });

  it('uses the local server verbatim in local mode', () => {
    expect(resolveDappProvingTarget(Network.PREPROD, { ...base, mode: 'local' }))
      .toEqual({ url: 'http://localhost:6300', headers: undefined, source: 'local' });
  });

  it('passes zkPaaS credentials through as headers (never to the page — the caller keeps them)', () => {
    const target = resolveDappProvingTarget(Network.MAINNET, { ...base, mode: 'zkpaas', zkpaasApiKey: 'key' });
    expect(target.source).toBe('zkpaas');
    expect(target.headers).toEqual({ 'x-api-key': 'key' });
  });

  it('throws an actionable error when zkPaaS is selected but not configured', () => {
    expect(() => resolveDappProvingTarget(Network.PREPROD, { ...base, mode: 'zkpaas' }))
      .toThrow(DappProvingUnavailableError);
    expect(() => resolveDappProvingTarget(Network.PREPROD, { ...base, mode: 'zkpaas' }))
      .toThrow(/Arkhia API key/);
  });

  it('throws when the network has no Midnight endpoints at all', () => {
    expect(() => resolveDappProvingTarget('not-a-midnight-network', base)).toThrow(DappProvingUnavailableError);
  });

  it('delegates stagenet dapp proofs to the ledger-9 local server', () => {
    expect(resolveDappProvingTarget(Network.STAGENET, { ...base, mode: 'local' }))
      .toMatchObject({ url: 'http://localhost:6301', source: 'local' });
  });

  it('explains a missing ledger-9 URL in terms of the setting to add', () => {
    expect(() => resolveDappProvingTarget(Network.STAGENET, { ...base, mode: 'local', localUrlLedger9: '' }))
      .toThrow(/no local proof server URL for the ledger-9.*proof-server settings/);
  });
});

describe('describeDappProvingFailure', () => {
  it('tells a Gero Cloud user to start a local proof server', () => {
    const text = describeDappProvingFailure({ url: 'http://localhost:6300', source: 'default' }, 'HTTP 503');
    expect(text).toContain('http://localhost:6300');
    expect(text).toContain('HTTP 503');
    expect(text).toMatch(/Start a local Midnight proof server/);
  });

  it('points a zkPaaS user at their API key without echoing the URL', () => {
    const text = describeDappProvingFailure({ url: 'https://starter.arkhia.io/x/secret-key', source: 'zkpaas', headers: {} }, 'HTTP 401');
    expect(text).toContain('HTTP 401');
    expect(text).toMatch(/API key/);
    expect(text).not.toContain('secret-key');
  });

  it('tells a local-mode user to check the server or the setting', () => {
    const text = describeDappProvingFailure({ url: 'http://127.0.0.1:6300', source: 'local' }, 'network error');
    expect(text).toContain('http://127.0.0.1:6300');
    expect(text).toMatch(/running/);
  });
});
