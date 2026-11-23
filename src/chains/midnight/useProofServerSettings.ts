import { ref, computed, toRefs, watch, onUnmounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import {
  ARKHIA_DASHBOARD_URL,
  buildZkpaasHeaders,
  isZkpaasConfigured,
  resolveZkpaasUrl,
} from '@/chains/midnight/midnightZkpaas';

/**
 * Re-exported for the existing UI consumers. The definitions moved to
 * midnightConfig.ts so the BACKGROUND worker can read the pinned tag (XDP
 * advertises it as `proverLedgerVersion` and gates jobs on it) without
 * importing this composable, which pulls in Vue, snackbar and the stores.
 */
export { PROOF_SERVER_DOCKER_TAG, PROOF_SERVER_DOCKER_COMMAND } from '@/chains/midnight/midnightConfig';
import {
  isLedger9Network,
  midnightProofServerCommand,
  midnightProofServerTag,
  midnightProofServerVersionLine,
} from '@/chains/midnight/midnightConfig';
import { midnightLedgerOrNewest, midnightNetworkName } from '@/chains/midnight/midnightLedger';
import { markProofServerLedger9NoticeDone } from '@/chains/midnight/proofServerLedger9Notice';
import { isLoopbackProverUrl, localUrlForNetwork, walletProverFor, type LocalProvingEngine } from '@/chains/midnight/midnightProvingTarget';
import { geroProverOfferedHere, threadedProvingOfferedHere } from '@/chains/midnight/geroProverFlag';
import { refreshGeroProver } from '@/chains/midnight/geroProverState';


export type ProofServerMode = 'remote' | 'local' | 'zkpaas';

/**
 * `notConfigured` is zkPaaS-only: the mode is selected but there is no API
 * key (and no override URL) yet, so there is nothing to health-check.
 */
/** `wrongVersion`: a local server that answers but runs another ledger's release. */
export type ProofServerHealthStatus = 'checking' | 'detected' | 'notDetected' | 'notConfigured' | 'wrongVersion';

/** Health-poll cadence per mode: localhost is free to poll; the Arkhia
 * gateway is a metered third-party API, so poll it an order of magnitude
 * less often (the Test button still forces an immediate check). */
const HEALTH_POLL_INTERVAL_MS: Record<'local' | 'zkpaas', number> = {
  local: 4_000,
  zkpaas: 30_000,
};
/**
 * Gero Prover is a program the browser starts to ask and stops again, so its
 * status is read seldom: polling it like a URL would keep it running.
 */
const HELPER_POLL_INTERVAL_MS = 5 * 60_000;

// The coarse "3m ago" label, shared with the wallet list (src/shared/utils/relativeTime.ts).
export { formatRelativeTime } from '@/shared/utils/relativeTime';

/**
 * Shared proof-server settings logic (mode, local URL, Arkhia zkPaaS
 * credentials, live health polling). Consumed by the Settings > Advanced
 * summary, the full Proof Server page, and the dashboard/mini widgets so
 * the surfaces can never drift apart. See midnightStore.ts for the store
 * field's broadcast/hydrate contract - browser contexts can't write the
 * store directly, so saves round-trip through BG via
 * SET_MIDNIGHT_PROOF_SERVER, mirroring the shielded-proving consent
 * dialog's own persistence.
 */
export function useMidnightProofServer() {
  const { t } = useTranslation();
  const { proofServer } = toRefs(midnightStore);

  const proofServerSaving = ref(false);

  /**
   * Persist a partial change merged over the CURRENT store value — the BG
   * handler takes the full record, so every save carries all five fields.
   */
  async function saveProofServer(patch: Partial<typeof midnightStore.proofServer>) {
    proofServerSaving.value = true;
    try {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SET_MIDNIGHT_PROOF_SERVER,
        data: { ...proofServer.value, ...patch },
      }) as { data: { success: boolean; error?: string } };
      if (!response?.data?.success) {
        throw new Error(response?.data?.error || 'Failed to save proof server preference');
      }
    } catch (e) {
      snackbar.setError(e instanceof Error ? e.message : String(e));
    } finally {
      proofServerSaving.value = false;
    }
  }

  /** Gero Prover (the desktop helper) is offered: the `isGeroProverEnabled` flag. */
  const helperOffered = computed(() => geroProverOfferedHere());
  /** "In this browser" is offered: the `isMidnightThreadedProvingEnabled` flag. */
  const browserOffered = computed(() => threadedProvingOfferedHere());

  const proofServerMode = computed<ProofServerMode>({
    get: () => proofServer.value.mode,
    set: (mode) => {
      if (mode === proofServer.value.mode) return;
      // First time on "This computer" with a no-Docker way on offer: start with
      // the one that needs no install, else Gero Prover. A stored choice
      // (Docker included) is never changed here.
      const first: LocalProvingEngine | undefined = browserOffered.value ? 'browser' : helperOffered.value ? 'helper' : undefined;
      const firstLocal = mode === 'local' && !!first && proofServer.value.localEngine === undefined;
      void saveProofServer(firstLocal ? { mode, localEngine: first } : { mode });
    },
  });

  /** What "local" proves with, as the user chose it and as it is on offer. */
  const localEngine = computed<LocalProvingEngine>(() => {
    const stored = proofServer.value.localEngine;
    if (stored === 'helper' && helperOffered.value) return 'helper';
    if (stored === 'browser' && browserOffered.value) return 'browser';
    return 'docker';
  });

  async function setLocalEngine(engine: LocalProvingEngine) {
    if (proofServer.value.mode === 'local' && proofServer.value.localEngine === engine) return;
    await saveProofServer({ mode: 'local', localEngine: engine });
    restartHealthPollingIfActive();
  }

  // ── Drafts: field edits buffer locally and persist on blur ──────────────

  const localUrlDraft = ref(proofServer.value.localUrl);
  const localUrlError = ref('');
  const localUrlLedger9Draft = ref(proofServer.value.localUrlLedger9);
  const localUrlLedger9Error = ref('');
  const zkpaasUrlDraft = ref(proofServer.value.zkpaasUrl);
  const zkpaasUrlError = ref('');
  const zkpaasKeyDraft = ref(proofServer.value.zkpaasApiKey);
  const zkpaasSecretDraft = ref(proofServer.value.zkpaasApiSecret);

  // Keep the drafts in sync with externally-applied changes (another open
  // surface, or our own save round-tripping back through the store broadcast).
  watch(() => proofServer.value.localUrl, (next) => { localUrlDraft.value = next; });
  watch(() => proofServer.value.localUrlLedger9, (next) => { localUrlLedger9Draft.value = next; });
  watch(() => proofServer.value.zkpaasUrl, (next) => { zkpaasUrlDraft.value = next; });
  watch(() => proofServer.value.zkpaasApiKey, (next) => { zkpaasKeyDraft.value = next; });
  watch(() => proofServer.value.zkpaasApiSecret, (next) => { zkpaasSecretDraft.value = next; });

  function validateProofServerUrl(value: string): string {
    if (!value) return t('midnight.proofServer.urlInvalid');
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return t('midnight.proofServer.urlInvalid');
      }
    } catch {
      return t('midnight.proofServer.urlInvalid');
    }
    return '';
  }

  /** A local proof server must be on this machine: anything else is a remote prover without its consent. */
  function validateLocalProofServerUrl(value: string): string {
    return validateProofServerUrl(value) || (isLoopbackProverUrl(value) ? '' : t('midnight.proofServer.urlNotLoopback'));
  }

  async function onLocalUrlBlur() {
    const value = localUrlDraft.value.trim();
    const error = validateLocalProofServerUrl(value);
    localUrlError.value = error;
    if (error) return;
    if (value === proofServer.value.localUrl) return;
    await saveProofServer({ localUrl: value });
    restartHealthPollingIfActive();
  }

  async function onLocalUrlLedger9Blur() {
    const value = localUrlLedger9Draft.value.trim();
    const error = validateLocalProofServerUrl(value);
    localUrlLedger9Error.value = error;
    if (error) return;
    if (value === proofServer.value.localUrlLedger9) return;
    await saveProofServer({ localUrlLedger9: value });
    restartHealthPollingIfActive();
  }

  async function onZkpaasUrlBlur() {
    const value = zkpaasUrlDraft.value.trim();
    // '' is valid — it means "derive the Arkhia endpoint per network".
    const error = value ? validateProofServerUrl(value) : '';
    zkpaasUrlError.value = error;
    if (error) return;
    if (value === proofServer.value.zkpaasUrl) return;
    await saveProofServer({ zkpaasUrl: value });
    restartHealthPollingIfActive();
  }

  async function onZkpaasKeyBlur() {
    const value = zkpaasKeyDraft.value.trim();
    if (value === proofServer.value.zkpaasApiKey) return;
    await saveProofServer({ zkpaasApiKey: value });
    restartHealthPollingIfActive();
  }

  async function onZkpaasSecretBlur() {
    const value = zkpaasSecretDraft.value.trim();
    if (value === proofServer.value.zkpaasApiSecret) return;
    await saveProofServer({ zkpaasApiSecret: value });
    restartHealthPollingIfActive();
  }

  // ── zkPaaS derived state ─────────────────────────────────────────────────

  const walletNetwork = computed(() => walletStore.loggedWallet?.network);

  /**
   * A send from the active wallet would be proved by Gero Prover: the same
   * rule the send uses (`walletProverFor`), so the status shown is the status
   * of the prover that would be used. A chain still on ledger 8 keeps the
   * Docker server even with the helper chosen.
   */
  const localProver = computed(() => walletProverFor(
    walletNetwork.value ?? '', proofServer.value, 'unshielded', { helper: helperOffered.value, browser: browserOffered.value },
  ));
  const usesHelper = computed(() => localProver.value === 'helper');
  /** The same, for "In this browser": the prover inside the extension makes every proof. */
  const usesBrowser = computed(() => proofServer.value.mode === 'local' && localProver.value === 'device');

  /** Effective Arkhia endpoint (override, else per-network default). Shown
   * as the URL field's placeholder so "automatic" is a visible URL, not a
   * mystery. */
  const zkpaasEffectiveUrl = computed(() => resolveZkpaasUrl(walletNetwork.value, proofServer.value));

  const zkpaasConfigured = computed(() => isZkpaasConfigured(proofServer.value));

  // ── Live health status ───────────────────────────────────────────────────
  //
  // GET {url}/health while a wallet-side mode (local or zkpaas) is selected.
  // Runs in extension-page context directly (not via BG) - that's what the
  // prod CSP localhost + arkhia entries exist for. Dynamic import keeps the
  // ledger-v8 dependency out of this composable's own chunk until a
  // consumer is actually mounted.

  const healthStatus = ref<ProofServerHealthStatus>('checking');
  const testingConnection = ref(false);
  /** Unix ms the last health check completed, or null before the first one. */
  const lastCheckedAt = ref<number | null>(null);
  /** Round-trip time of the last health check, or null before the first one. */
  const lastCheckLatencyMs = ref<number | null>(null);
  /** The release a local server reported at the last check, when it said. */
  const serverVersion = ref<string | null>(null);
  /** The releases the active wallet's chain needs: `9.0.x`. */
  const requiredVersion = computed(() => midnightProofServerVersionLine(midnightLedgerOrNewest(walletNetwork.value)));
  let healthPollTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Each (re)start of polling is a new generation. A check reports only if no
   * restart came while it ran, and a check of an older generation never holds
   * back a new one. Otherwise a Docker probe started before the flag store
   * loaded (or before the user switched engine) could finish after the switch
   * to Gero Prover and leave "Not detected" until the next poll, minutes later.
   */
  let healthCheckGeneration = 0;
  /** The generation of the check now running, or null. */
  let inFlightGeneration: number | null = null;

  /**
   * The health-check target for the CURRENT mode, or null when there is
   * nothing to check (remote mode, or zkpaas before any key/URL exists).
   * zkPaaS checks are lenient about 404 — see checkProofServerHealth.
   */
  function currentHealthTarget(): { url: string; headers?: Record<string, string>; acceptNotFound?: boolean } | null {
    const ps = proofServer.value;
    // The server for the active wallet's ledger — the one a send from this
    // wallet would actually use — so the status pill answers the question
    // the user is asking.
    if (ps.mode === 'local') return { url: localUrlForNetwork(walletNetwork.value ?? '', ps) };
    if (ps.mode === 'zkpaas') {
      const url = zkpaasEffectiveUrl.value;
      if (!zkpaasConfigured.value || !url) return null;
      return { url, headers: buildZkpaasHeaders(ps), acceptNotFound: true };
    }
    return null;
  }

  async function runHelperCheck(generation: number) {
    inFlightGeneration = generation;
    const startedAt = Date.now();
    try {
      const snapshot = await refreshGeroProver();
      if (generation !== healthCheckGeneration) return;
      serverVersion.value = snapshot.connection === 'wrong-version' ? snapshot.version ?? null : null;
      healthStatus.value = snapshot.connection === 'connected' ? 'detected'
        : snapshot.connection === 'wrong-version' ? 'wrongVersion' : 'notDetected';
      lastCheckedAt.value = Date.now();
      lastCheckLatencyMs.value = lastCheckedAt.value - startedAt;
    } finally {
      if (inFlightGeneration === generation) inFlightGeneration = null;
    }
  }

  async function runHealthCheck() {
    // A check of this generation is already running; an older one is not waited for.
    if (inFlightGeneration === healthCheckGeneration) return;
    const generation = healthCheckGeneration;
    if (usesHelper.value) {
      await runHelperCheck(generation);
      return;
    }
    if (usesBrowser.value) {
      // The prover is part of the extension: there is nothing to reach.
      healthStatus.value = 'detected';
      serverVersion.value = null;
      lastCheckedAt.value = Date.now();
      lastCheckLatencyMs.value = null;
      return;
    }
    const target = currentHealthTarget();
    if (!target) {
      healthStatus.value = proofServer.value.mode === 'zkpaas' ? 'notConfigured' : 'notDetected';
      return;
    }
    inFlightGeneration = generation;
    const startedAt = Date.now();
    try {
      const { checkProofServerHealth, checkProofServerVersion } = await import('@/chains/midnight/midnightLocalProver');
      const healthy = await checkProofServerHealth(target.url, {
        headers: target.headers,
        acceptNotFound: target.acceptNotFound,
      });
      // A local server's release must match the chain's ledger: one for the
      // other ledger answers /health and only fails when it proves. zkPaaS is
      // Arkhia's to keep current, and its gateway relays only the proving routes.
      const version = healthy && proofServer.value.mode === 'local'
        ? await checkProofServerVersion(target.url, midnightLedgerOrNewest(walletNetwork.value))
        : null;
      if (generation !== healthCheckGeneration) return;
      serverVersion.value = version && version.status !== 'unknown' ? version.version : null;
      // Already on a ledger 9 release: the update notice has nothing left to say.
      if (version?.status === 'match' && midnightLedgerOrNewest(walletNetwork.value) === 9) markProofServerLedger9NoticeDone();
      healthStatus.value = !healthy ? 'notDetected' : version?.status === 'mismatch' ? 'wrongVersion' : 'detected';
      lastCheckedAt.value = Date.now();
      lastCheckLatencyMs.value = lastCheckedAt.value - startedAt;
    } finally {
      if (inFlightGeneration === generation) inFlightGeneration = null;
    }
  }

  function stopHealthPolling() {
    if (healthPollTimer !== null) {
      clearInterval(healthPollTimer);
      healthPollTimer = null;
    }
  }

  function startHealthPolling() {
    stopHealthPolling();
    healthCheckGeneration += 1;
    healthStatus.value = 'checking';
    void runHealthCheck();
    const mode = proofServer.value.mode;
    if (mode === 'remote' || usesBrowser.value) return;
    healthPollTimer = setInterval(() => {
      void runHealthCheck();
    }, usesHelper.value ? HELPER_POLL_INTERVAL_MS : HEALTH_POLL_INTERVAL_MS[mode]);
  }

  function restartHealthPollingIfActive() {
    if (proofServer.value.mode !== 'remote') startHealthPolling();
  }

  // Switching wallets across ledgers changes which local server is relevant,
  // so re-check rather than keep showing the other server's status.
  watch(() => isLedger9Network(walletNetwork.value), () => { restartHealthPollingIfActive(); });
  // Docker and Gero Prover are checked differently and at different rates.
  watch([usesHelper, usesBrowser], () => { restartHealthPollingIfActive(); });

  async function testConnection() {
    testingConnection.value = true;
    try {
      await runHealthCheck();
    } finally {
      testingConnection.value = false;
    }
  }

  const healthStatusLabel = computed(() => {
    switch (healthStatus.value) {
      case 'detected': return t('midnight.proofServer.statusDetected');
      case 'notDetected': return t('midnight.proofServer.statusNotDetected');
      case 'notConfigured': return t('midnight.proofServer.zkpaasKeyMissing');
      case 'wrongVersion': return t('midnight.proofServer.statusWrongVersion', { version: serverVersion.value ?? '' });
      default: return t('midnight.proofServer.statusChecking');
    }
  });

  // Polling runs whenever a wallet-side mode is selected. Watch the MODE
  // string (not a boolean) so a direct local -> zkpaas switch restarts the
  // loop with the right target and cadence.
  watch(
    proofServerMode,
    (mode) => {
      if (mode !== 'remote') startHealthPolling();
      else stopHealthPolling();
    },
    { immediate: true },
  );

  onUnmounted(() => {
    stopHealthPolling();
  });

  return {
    proofServer,
    proofServerMode,
    proofServerSaving,
    /** Gero Prover is offered (the flag). Off, every surface is as it was before the helper. */
    helperOffered,
    /** "In this browser" is offered (the flag). */
    browserOffered,
    localEngine,
    setLocalEngine,
    usesHelper,
    usesBrowser,
    localUrlDraft,
    localUrlError,
    onLocalUrlBlur,
    localUrlLedger9Draft,
    localUrlLedger9Error,
    onLocalUrlLedger9Blur,
    /** Which ledger the active wallet's chain runs, so the page can label the relevant server. */
    activeLedger9: computed(() => isLedger9Network(walletNetwork.value)),
    /** The network and server release the page names for it. */
    activeServer: computed(() => ({
      network: midnightNetworkName(walletNetwork.value ?? ''),
      tag: midnightProofServerTag(walletNetwork.value),
    })),
    zkpaasUrlDraft,
    zkpaasUrlError,
    onZkpaasUrlBlur,
    zkpaasKeyDraft,
    onZkpaasKeyBlur,
    zkpaasSecretDraft,
    onZkpaasSecretBlur,
    zkpaasEffectiveUrl,
    zkpaasConfigured,
    arkhiaDashboardUrl: ARKHIA_DASHBOARD_URL,
    dockerRunCommand: computed(() => midnightProofServerCommand(walletStore.loggedWallet?.network)),
    /** The release the last check read from a local server, when it said. */
    serverVersion,
    requiredVersion,
    healthStatus,
    healthStatusLabel,
    testingConnection,
    testConnection,
    lastCheckedAt,
    lastCheckLatencyMs,
    /** Recent wallet-side proving attempts, newest first. See midnightStore.ts. */
    provingHistory: toRefs(midnightStore).provingHistory,
  };
}
