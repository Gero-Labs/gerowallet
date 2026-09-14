import { describe, it, expect } from 'vitest';
import { Network } from '@/models/types';
import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import {
  DappProvingUnavailableError,
  describeDappProvingFailure,
  localProfileForNetwork,
  resolveDappProvingTarget,
  resolveProvingTarget,
} from './midnightProvingTarget';
import type { ProofServerPreference } from './midnightProvingTarget';

const base: ProofServerPreference = {
  mode: 'remote',
  localUrl: 'http://localhost:6300',
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

  it('refuses a local server whose circuit family does not match the network', () => {
    // Stagenet proofs need a ledger-9 server; a legacy (default) profile can't serve them, and vice versa.
    expect(resolveProvingTarget(Network.STAGENET, { ...base, mode: 'local' }))
      .toMatchObject({ kind: 'unconfigured', mode: 'local', reason: 'local-profile-mismatch', url: base.localUrl });
    expect(resolveProvingTarget(Network.PREPROD, { ...base, mode: 'local', localProfile: 'stagenet' }))
      .toMatchObject({ kind: 'unconfigured', reason: 'local-profile-mismatch' });
    expect(resolveProvingTarget(Network.STAGENET, { ...base, mode: 'local', localProfile: 'stagenet' }))
      .toMatchObject({ kind: 'server', mode: 'local' });
    expect(localProfileForNetwork('midnight-stagenet')).toBe('stagenet');
    expect(localProfileForNetwork(Network.MAINNET)).toBe('legacy');
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

  it('explains a local circuit-family mismatch in terms of the setting to change', () => {
    expect(() => resolveDappProvingTarget(Network.STAGENET, { ...base, mode: 'local' }))
      .toThrow(/legacy circuit family.*needs the stagenet one.*proof-server profile/);
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
