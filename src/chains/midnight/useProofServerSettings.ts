import { ref, computed, toRefs, watch, onUnmounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { midnightStore } from '@/stores/midnightStore';

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

export type ProofServerHealthStatus = 'checking' | 'detected' | 'notDetected';

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
 * Shared proof-server settings logic (mode, local URL, live health polling).
 * Consumed by both the Settings > Advanced summary and the full Proof
 * Server page so the two surfaces can never drift apart. See
 * midnightStore.ts for the store field's broadcast/hydrate contract - browser
 * contexts can't write the store directly, so saves round-trip through BG
 * via SET_MIDNIGHT_PROOF_SERVER, mirroring the shielded-proving consent
 * dialog's own persistence.
 */
export function useMidnightProofServer() {
  const { t } = useTranslation();
  const { proofServer } = toRefs(midnightStore);

  const proofServerSaving = ref(false);

  async function saveProofServer(next: { mode: 'remote' | 'local'; localUrl: string }) {
    proofServerSaving.value = true;
    try {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SET_MIDNIGHT_PROOF_SERVER,
        data: next,
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

  const proofServerMode = computed<'remote' | 'local'>({
    get: () => proofServer.value.mode,
    set: (mode) => {
      if (mode === proofServer.value.mode) return;
      void saveProofServer({ mode, localUrl: proofServer.value.localUrl });
    },
  });

  const localUrlDraft = ref(proofServer.value.localUrl);
  const localUrlError = ref('');

  // Keep the draft in sync with externally-applied changes (another open
  // surface, or our own save round-tripping back through the store broadcast).
  watch(() => proofServer.value.localUrl, (next) => {
    localUrlDraft.value = next;
  });

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
    await saveProofServer({ mode: proofServer.value.mode, localUrl: value });
    if (isLocalSectionActive.value) startHealthPolling();
  }

  // Live status: GET {localUrl}/health every 4s while a consumer marks the
  // section active. Runs in extension-page context directly (not via BG) -
  // that's what the prod CSP localhost entries exist for. Dynamic import
  // keeps the ledger-v8 dependency out of this composable's own chunk until
  // a consumer is actually mounted.
  const healthStatus = ref<ProofServerHealthStatus>('checking');
  const testingConnection = ref(false);
  /** Unix ms the last health check completed, or null before the first one. */
  const lastCheckedAt = ref<number | null>(null);
  /** Round-trip time of the last health check, or null before the first one. */
  const lastCheckLatencyMs = ref<number | null>(null);
  let healthPollTimer: ReturnType<typeof setInterval> | null = null;
  let healthCheckInFlight = false;

  async function runHealthCheck(url: string) {
    if (healthCheckInFlight) return;
    healthCheckInFlight = true;
    const startedAt = Date.now();
    try {
      const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
      const healthy = await checkProofServerHealth(url);
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
    void runHealthCheck(proofServer.value.localUrl);
    healthPollTimer = setInterval(() => {
      void runHealthCheck(proofServer.value.localUrl);
    }, 4000);
  }

  async function testConnection() {
    testingConnection.value = true;
    try {
      await runHealthCheck(proofServer.value.localUrl);
    } finally {
      testingConnection.value = false;
    }
  }

  const healthStatusLabel = computed(() => {
    switch (healthStatus.value) {
      case 'detected': return t('midnight.proofServer.statusDetected');
      case 'notDetected': return t('midnight.proofServer.statusNotDetected');
      default: return t('midnight.proofServer.statusChecking');
    }
  });

  // Each consumer decides when polling should run (e.g. "local mode selected
  // AND this panel is visible"). Defaults to local-mode-only; pass `active`
  // to widen or narrow that per consumer.
  const isLocalSectionActive = computed(() => proofServerMode.value === 'local');

  watch(
    isLocalSectionActive,
    (active) => {
      if (active) startHealthPolling();
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
    dockerRunCommand: PROOF_SERVER_DOCKER_COMMAND,
    healthStatus,
    healthStatusLabel,
    testingConnection,
    testConnection,
    lastCheckedAt,
    lastCheckLatencyMs,
    /** Recent LOCAL proving attempts, newest first. See midnightStore.ts. */
    provingHistory: toRefs(midnightStore).provingHistory,
  };
}
