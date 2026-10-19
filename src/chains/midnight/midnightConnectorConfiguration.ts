/**
 * DApp Connector `getConfiguration()` payload.
 *
 * Gero hands dApps no indexer and no node RPC. Gero's indexer and node are
 * private, and gero-sync's relay serves only the wallet SDKs' operations: it
 * answers `operation not allowed` to a dApp's `contractAction` query. The
 * Foundation's public indexers that 2.7.1 advertised are gone (preprod and
 * mainnet answer HTTP 410), and their Blockfrost successor needs a
 * per-project token, so dApps bring their own Midnight services (issue 1320).
 *
 * Type-only imports keep this free of runtime dependencies, so the background
 * can import it statically without moving any inlined module in its bundle.
 */

import type { Configuration } from '@midnight-ntwrk/dapp-connector-api';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { ProofServerPreference } from './midnightProvingTarget';

export function connectorConfiguration(
  endpoints: Pick<MidnightNetworkEndpoints, 'defaultProofServerUrl'>,
  proofServer: Pick<ProofServerPreference, 'mode' | 'localUrl'>,
  sdkNetworkId: string,
): Configuration {
  // A dApp has no way to reach Gero's internal cloud prover directly, so
  // when the user's preference is 'remote' the network's default proof
  // server URL remains the least-wrong answer to advertise here (WP-P5:
  // connector `getProvingProvider()` delegation is a separate, later
  // phase). Only report the user's own local proof server once they've
  // actually opted into local mode (WP-P1/P4). zkPaaS mode deliberately
  // ALSO reports the default: the Arkhia endpoint is useless to a dApp
  // without the user's API key, and a user-pasted override URL may embed
  // that key as a path segment — advertising it would hand the user's
  // paid credential to every connected dApp.
  const proverServerUri = proofServer.mode === 'local'
    ? proofServer.localUrl
    : (endpoints.defaultProofServerUrl || undefined);
  return {
    indexerUri: '',
    indexerWsUri: '',
    proverServerUri,
    substrateNodeUri: '',
    networkId: sdkNetworkId,
  };
}
