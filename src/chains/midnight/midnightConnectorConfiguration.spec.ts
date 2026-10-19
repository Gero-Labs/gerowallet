import { describe, expect, it } from 'vitest';
import { Network } from '@/models/types';
import { getMidnightEndpoints } from './midnightConfig';
import { connectorConfiguration } from './midnightConnectorConfiguration';
import type { ProofServerPreference } from './midnightProvingTarget';

const ZKPAAS_KEY = 'arkhia-project-key-0123456789';

function preference(mode: ProofServerPreference['mode']): ProofServerPreference {
  return {
    mode,
    localUrl: 'http://localhost:6399',
    localUrlLedger9: 'http://localhost:6398',
    zkpaasUrl: `https://starter.arkhia.io/midnight/zkpaas/testnet/${ZKPAAS_KEY}`,
    zkpaasApiKey: ZKPAAS_KEY,
    zkpaasApiSecret: 'arkhia-secret',
  };
}

function endpointsFor(network: string) {
  const endpoints = getMidnightEndpoints(network);
  if (!endpoints) throw new Error(`no endpoints for ${network}`);
  return endpoints;
}

describe('connectorConfiguration', () => {
  it.each([
    [Network.MAINNET, 'mainnet'],
    [Network.PREPROD, 'preprod'],
    [Network.STAGENET, 'stagenet'],
  ])('advertises no indexer or node on %s (issue 1320)', (network, sdkNetworkId) => {
    for (const mode of ['remote', 'local', 'zkpaas'] as const) {
      const config = connectorConfiguration(endpointsFor(network), preference(mode), sdkNetworkId);
      expect(config).toMatchObject({ indexerUri: '', indexerWsUri: '', substrateNodeUri: '', networkId: sdkNetworkId });
      // The retired Foundation hosts, a token-gated Blockfrost URL and Gero's
      // SDK-only relay would each hand the dApp an endpoint that fails.
      expect(JSON.stringify(config)).not.toMatch(/midnight\.network|blockfrost|project_id|sync\.gerowallet\.io|shielded\.tools/);
    }
  });

  it('reports the local proof server only in local mode', () => {
    const endpoints = endpointsFor(Network.PREPROD);
    expect(connectorConfiguration(endpoints, preference('local'), 'preprod').proverServerUri).toBe('http://localhost:6399');
    expect(connectorConfiguration(endpoints, preference('remote'), 'preprod').proverServerUri).toBe(endpoints.defaultProofServerUrl);
  });

  it('never advertises the zkPaaS endpoint or its credentials', () => {
    const endpoints = endpointsFor(Network.MAINNET);
    const config = connectorConfiguration(endpoints, preference('zkpaas'), 'mainnet');
    expect(config.proverServerUri).toBe(endpoints.defaultProofServerUrl);
    expect(JSON.stringify(config)).not.toMatch(/arkhia/);
  });

  it('omits proverServerUri when the network has no default proof server', () => {
    expect(connectorConfiguration({ defaultProofServerUrl: '' }, preference('remote'), 'preprod').proverServerUri).toBeUndefined();
  });
});
