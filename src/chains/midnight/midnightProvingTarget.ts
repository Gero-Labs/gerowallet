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

import { getMidnightEndpoints, isLedger9Network } from '@/chains/midnight/midnightConfig';
import { resolveZkpaasUrl, buildZkpaasHeaders, isZkpaasConfigured } from '@/chains/midnight/midnightZkpaas';
import type { ZkpaasSettings } from '@/chains/midnight/midnightZkpaas';

/** The slice of `midnightStore.proofServer` target resolution needs. */
export interface ProofServerPreference extends ZkpaasSettings {
  mode: 'remote' | 'local' | 'zkpaas';
  /** Local proof server for the ledger-8 networks (mainnet, preprod). */
  localUrl: string;
  /**
   * Local proof server for the ledger-9 network (stagenet). A separate URL
   * rather than a "which ledger is my server" toggle: the two circuit
   * families need two different servers, and keying the choice off the
   * active wallet's network means there is nothing to switch when the user
   * moves between networks. Absent on preferences stored before this field
   * existed; callers fall back to the ledger-9 default.
   */
  localUrlLedger9?: string;
}

/**
 * The local proof-server URL for a network's circuit family. Ledger 8
 * (mainnet, preprod) → `localUrl`; ledger 9 (stagenet) → `localUrlLedger9`.
 * Accepts both the wallet `Network` value and a `midnight-<id>` slug.
 */
export function localUrlForNetwork(network: string, ps: Pick<ProofServerPreference, 'localUrl' | 'localUrlLedger9'>): string {
  return isLedger9Network(network) ? (ps.localUrlLedger9 ?? '') : ps.localUrl;
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
    /** Local mode, but no URL is stored for this network's circuit family. */
    | 'local-url-missing';
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
    // The network chooses the server. A missing URL is the only way local
    // mode can be unusable before a health check; a server that is up but
    // for the other ledger simply fails its health/prove and surfaces as
    // "not detected" for THIS network's server, with the matching docker
    // command on the settings page.
    const url = localUrlForNetwork(network, ps);
    if (!url) {
      return { kind: 'unconfigured', mode: 'local', url: '', reason: 'local-url-missing' };
    }
    return { kind: 'server', mode: 'local', url, lenientHealth: false };
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
    if (target.reason === 'local-url-missing') {
      throw new DappProvingUnavailableError(
        `GeroWallet has no local proof server URL for the ${isLedger9Network(network) ? 'ledger-9 (Stagenet)' : 'ledger-8'} `
        + "circuit family. Set one in GeroWallet's Midnight proof-server settings.",
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
