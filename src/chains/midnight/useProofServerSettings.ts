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
 * Pinned to the 8.x proof-server release that matches the installed
 * @midnight-ntwrk/ledger-v8 (^8.1.0) - verified against Docker Hub
 * (midnightntwrk/proof-server tags) on 2026-07-13. Deliberately not
 * `latest`, which tracks the 9.0.0-rc stream (a newer, mismatched ledger
 * generation) - see docs/plans/2026-07-13-midnight-proof-server-setting.md
 * section 0.
 */
export const PROOF_SERVER_DOCKER_TAG = '8.1.0';
export const PROOF_SERVER_DOCKER_COMMAND =
  `docker run -p 6300:6300 midnightntwrk/proof-server:${PROOF_SERVER_DOCKER_TAG} midnight-proof-server -v`;

export type ProofServerMode = 'remote' | 'local' | 'zkpaas';

/**
 * `notConfigured` is zkPaaS-only: the mode is selected but there is no API
 * key (and no override URL) yet, so there is nothing to health-check.
 */
export type ProofServerHealthStatus = 'checking' | 'detected' | 'notDetected' | 'notConfigured';

/** Health-poll cadence per mode: localhost is free to poll; the Arkhia
 * gateway is a metered third-party API, so poll it an order of magnitude
 * less often (the Test button still forces an immediate check). */
const HEALTH_POLL_INTERVAL_MS: Record<'local' | 'zkpaas', number> = {
  local: 4_000,
  zkpaas: 30_000,
};

/**
 * Coarse "Xs/Xm/Xh/Xd ago" label (matches the convention already used by
 * MidnightTransactionsCard/MempoolExplorer/etc. — extracted here so the
 * proof-server page and dashboard widget share one copy instead of adding a
 * sixth ad hoc version).
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

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

  const proofServerMode = computed<ProofServerMode>({
    get: () => proofServer.value.mode,
    set: (mode) => {
      if (mode === proofServer.value.mode) return;
      void saveProofServer({ mode });
    },
  });

  // ── Drafts: field edits buffer locally and persist on blur ──────────────

  const localUrlDraft = ref(proofServer.value.localUrl);
  const localUrlError = ref('');
  const zkpaasUrlDraft = ref(proofServer.value.zkpaasUrl);
  const zkpaasUrlError = ref('');
  const zkpaasKeyDraft = ref(proofServer.value.zkpaasApiKey);
  const zkpaasSecretDraft = ref(proofServer.value.zkpaasApiSecret);

  // Keep the drafts in sync with externally-applied changes (another open
  // surface, or our own save round-tripping back through the store broadcast).
  watch(() => proofServer.value.localUrl, (next) => { localUrlDraft.value = next; });
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

  async function onLocalUrlBlur() {
    const value = localUrlDraft.value.trim();
    const error = validateProofServerUrl(value);
    localUrlError.value = error;
    if (error) return;
    if (value === proofServer.value.localUrl) return;
    await saveProofServer({ localUrl: value });
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
  let healthPollTimer: ReturnType<typeof setInterval> | null = null;
  let healthCheckInFlight = false;

  /**
   * The health-check target for the CURRENT mode, or null when there is
   * nothing to check (remote mode, or zkpaas before any key/URL exists).
   * zkPaaS checks are lenient about 404 — see checkProofServerHealth.
   */
  function currentHealthTarget(): { url: string; headers?: Record<string, string>; acceptNotFound?: boolean } | null {
    const ps = proofServer.value;
    if (ps.mode === 'local') return { url: ps.localUrl };
    if (ps.mode === 'zkpaas') {
      const url = zkpaasEffectiveUrl.value;
      if (!zkpaasConfigured.value || !url) return null;
      return { url, headers: buildZkpaasHeaders(ps), acceptNotFound: true };
    }
    return null;
  }

  async function runHealthCheck() {
    if (healthCheckInFlight) return;
    const target = currentHealthTarget();
    if (!target) {
      healthStatus.value = proofServer.value.mode === 'zkpaas' ? 'notConfigured' : 'notDetected';
      return;
    }
    healthCheckInFlight = true;
    const startedAt = Date.now();
    try {
      const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
      const healthy = await checkProofServerHealth(target.url, {
        headers: target.headers,
        acceptNotFound: target.acceptNotFound,
      });
      healthStatus.value = healthy ? 'detected' : 'notDetected';
      lastCheckedAt.value = Date.now();
      lastCheckLatencyMs.value = lastCheckedAt.value - startedAt;
    } finally {
      healthCheckInFlight = false;
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
    healthStatus.value = 'checking';
    void runHealthCheck();
    const mode = proofServer.value.mode;
    if (mode === 'remote') return;
    healthPollTimer = setInterval(() => {
      void runHealthCheck();
    }, HEALTH_POLL_INTERVAL_MS[mode]);
  }

  function restartHealthPollingIfActive() {
    if (proofServer.value.mode !== 'remote') startHealthPolling();
  }

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
    localUrlDraft,
    localUrlError,
    onLocalUrlBlur,
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
    dockerRunCommand: PROOF_SERVER_DOCKER_COMMAND,
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
