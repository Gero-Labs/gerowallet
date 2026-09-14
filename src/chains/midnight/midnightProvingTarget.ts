/**
 * Resolve the user's Midnight proof-server preference into a concrete
 * proving target. Shared by the wallet's own shielded sends
 * (`services/midnight-tx.service.ts`) and the DApp Connector's
 * `getProvingProvider` delegation (`chrome/midnightDappProving.ts`) so the
 * two paths can never disagree about which server a given preference means.
 *
 * Deliberately free of heavy imports (no ledger WASM, no messaging) so both
 * the background service worker and browser-context callers can import it
 * statically.
 */

import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import { resolveZkpaasUrl, buildZkpaasHeaders, isZkpaasConfigured } from '@/chains/midnight/midnightZkpaas';
import type { ZkpaasSettings } from '@/chains/midnight/midnightZkpaas';

/** The slice of `midnightStore.proofServer` target resolution needs. */
export interface ProofServerPreference extends ZkpaasSettings {
  mode: 'remote' | 'local' | 'zkpaas';
  localUrl: string;
  /** Circuit family the user's local server was started for; legacy (ledger 8) by default. */
  localProfile?: 'legacy' | 'stagenet';
}

/**
 * Circuit family a network's proofs need. Ledger 8 networks (mainnet,
 * preprod) use the legacy proof server; Stagenet runs ledger 9. Accepts both
 * the wallet `Network` value and a `midnight-<id>` slug.
 */
export function localProfileForNetwork(network: string): 'legacy' | 'stagenet' {
  return network.toLowerCase().replace(/^midnight-/, '') === 'stagenet' ? 'stagenet' : 'legacy';
}

/** A proof server the wallet can POST `/prove` + `/check` payloads to. */
export interface ProvingServerTarget {
  kind: 'server';
  /** Which preference produced this target. */
  mode: 'local' | 'zkpaas';
  url: string;
  /** Arkhia gateway auth for zkPaaS; absent for the plain docker server. */
  headers?: Record<string, string>;
  /**
   * Whether the `/health` preflight should treat a 404 as healthy — the
   * Arkhia gateway relays `/prove`/`/check` but has no documented health
   * route (see `checkProofServerHealth`).
   */
  lenientHealth: boolean;
}

/** A stored preference that cannot serve this network right now. */
export interface ProvingUnconfiguredTarget {
  kind: 'unconfigured';
  mode: 'local' | 'zkpaas';
  url: string;
  reason:
    /** zkPaaS selected but no API key and no override URL — nothing to talk to. */
    | 'zkpaas-unconfigured'
    /** Local server started for the other circuit family (ledger 8 vs 9). */
    | 'local-profile-mismatch';
}

export type ProvingTarget =
  /** Prove remotely through Gero Cloud (mode `remote`). */
  | { kind: 'cloud' }
  | ProvingServerTarget
  | ProvingUnconfiguredTarget;

/**
 * Map the stored preference to a target. Never throws: callers decide what
 * an `unconfigured` result means for their flow (the send dialogs turn it
 * into the two-action fallback; the connector rejects the request).
 */
export function resolveProvingTarget(network: string, ps: ProofServerPreference): ProvingTarget {
  if (ps.mode === 'local') {
    if ((ps.localProfile ?? 'legacy') !== localProfileForNetwork(network)) {
      return { kind: 'unconfigured', mode: 'local', url: ps.localUrl, reason: 'local-profile-mismatch' };
    }
    return { kind: 'server', mode: 'local', url: ps.localUrl, lenientHealth: false };
  }
  if (ps.mode === 'zkpaas') {
    const url = resolveZkpaasUrl(network, ps);
    if (!isZkpaasConfigured(ps) || !url) {
      return { kind: 'unconfigured', mode: 'zkpaas', url, reason: 'zkpaas-unconfigured' };
    }
    return { kind: 'server', mode: 'zkpaas', url, headers: buildZkpaasHeaders(ps), lenientHealth: true };
  }
  return { kind: 'cloud' };
}

/** Where a DApp-delegated proof will be generated. */
export interface DappProvingTarget {
  url: string;
  headers?: Record<string, string>;
  /**
   * `default` = the user is on Gero Cloud (mode `remote`), which only
   * proves whole wallet-built transactions (Nexus `/tx/prove-and-submit`)
   * and cannot serve a dapp's per-circuit `/prove` calls — so delegation
   * falls back to the network's default proof-server URL, the same answer
   * `getConfiguration().proverServerUri` already advertises in that mode.
   */
  source: 'local' | 'zkpaas' | 'default';
}

/**
 * Thrown when the stored preference cannot serve dapp proofs at all
 * (zkPaaS selected without a usable key/endpoint, or a network with no
 * Midnight endpoints). The message is written for the dapp developer /
 * end user who will read it in the dapp's error surface, so it names the
 * fix.
 */
export class DappProvingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DappProvingUnavailableError';
  }
}

/**
 * Resolve the proof server that will generate proofs delegated by a
 * connected dapp via `getProvingProvider()`.
 *
 * Privacy note: `local` and the `default` fallback never leave the user's
 * machine. `zkpaas` sends the dapp's proof preimages (the private inputs
 * the proof hides) to Arkhia — the proof-server settings page states that
 * plainly when the user picks that mode ("private data goes to Arkhia, not
 * Gero"), so the stored selection is treated as the user's informed choice
 * here; no additional per-proof prompt is raised.
 */
export function resolveDappProvingTarget(network: string, ps: ProofServerPreference): DappProvingTarget {
  const target = resolveProvingTarget(network, ps);
  if (target.kind === 'server') {
    return { url: target.url, headers: target.headers, source: target.mode };
  }
  if (target.kind === 'unconfigured') {
    if (target.reason === 'local-profile-mismatch') {
      const needed = localProfileForNetwork(network);
      throw new DappProvingUnavailableError(
        `GeroWallet's local proof server is set up for the ${needed === 'stagenet' ? 'legacy' : 'Stagenet'} circuit family, `
        + `but the connected wallet needs the ${needed} one. Pick the matching proof-server profile in GeroWallet's Midnight settings.`,
      );
    }
    throw new DappProvingUnavailableError(
      'GeroWallet is set to Arkhia zkPaaS proving but no API key is configured. '
      + 'Add your Arkhia API key in GeroWallet\'s Midnight proof-server settings, or switch to a local proof server.',
    );
  }
  const defaultUrl = getMidnightEndpoints(network)?.defaultProofServerUrl;
  if (!defaultUrl) {
    throw new DappProvingUnavailableError(`No Midnight proof server is configured for network ${network}`);
  }
  return { url: defaultUrl, source: 'default' };
}

/**
 * Turn a failed proof-server request into a message that tells the person
 * reading it (in the dapp's UI) what to do next, without leaking anything
 * about the request body. `detail` is the prover client's own error text
 * (HTTP status / network error), never a payload.
 */
export function describeDappProvingFailure(target: DappProvingTarget, detail: string): string {
  if (target.source === 'zkpaas') {
    return `Arkhia zkPaaS could not generate the proof (${detail}). Check the API key in GeroWallet's Midnight proof-server settings.`;
  }
  const hint = target.source === 'default'
    ? 'Start a local Midnight proof server (docker `midnightntwrk/proof-server`) or pick a proof server in GeroWallet\'s Midnight settings.'
    : 'Make sure the proof server is running, or change it in GeroWallet\'s Midnight settings.';
  return `GeroWallet's proof server at ${target.url} could not generate the proof (${detail}). ${hint}`;
}
