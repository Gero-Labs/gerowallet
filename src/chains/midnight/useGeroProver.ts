/**
 * Gero Prover on the Proof server page: its status, the browser permission it
 * needs, and its controls (the graphics-processor switch, a test proof,
 * removing its key files). The background owns the connection to the helper;
 * this composable only asks (geroProverState.ts).
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  askGeroProver,
  geroProverSnapshot,
  helperErrorCopyKey,
  refreshGeroProver,
} from './geroProverState';
import type { HelperAcceleratorState } from './midnightHelperProtocol';

/** What the card shows. */
export type GeroProverView =
  /** Not asked yet. */
  | 'checking'
  /** Not installed, not opened once, or the browser may not talk to it yet: the three steps. */
  | 'setup'
  /** Registered for another copy of the extension. */
  | 'forbidden'
  | 'wrongVersion'
  /** It was set up, and could not be started or answered nonsense. */
  | 'error'
  | 'connected';

export type GeroProverTestResult =
  | { ok: true; seconds: string; accelerated: boolean }
  | { ok: false; copyKey: string };

/** While the user is installing the helper, look for it this often. Nothing is started until it exists. */
const SETUP_POLL_MS = 3_000;

const NATIVE_MESSAGING: chrome.permissions.Permissions = { permissions: ['nativeMessaging'] };

/** Where the helper is downloaded from. Empty until a release is published, and then no link is shown. */
export function geroProverDownloadUrl(): string {
  // Dot access, so Vite inlines the build-time value.
  const url = (import.meta.env as { VITE_GERO_PROVER_DOWNLOAD_URL?: string }).VITE_GERO_PROVER_DOWNLOAD_URL ?? '';
  return /^https:\/\//.test(url) ? url : '';
}

export function useGeroProver(active: () => boolean) {
  const snapshot = geroProverSnapshot;
  /** Whether the browser lets the extension talk to apps on this computer; null until read. */
  const allowed = ref<boolean | null>(null);
  const busy = ref<'allow' | 'refresh' | 'toggle' | 'test' | 'remove' | null>(null);
  const testResult = ref<GeroProverTestResult | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function readAllowed(): Promise<boolean> {
    try {
      const canAsk = typeof chrome !== 'undefined' && !!chrome.permissions?.contains;
      allowed.value = canAsk ? await chrome.permissions.contains(NATIVE_MESSAGING) === true : false;
    } catch {
      allowed.value = false;
    }
    return allowed.value === true;
  }

  async function refresh() {
    await readAllowed();
    await refreshGeroProver();
  }

  /**
   * The browser's permission prompt. Must run inside the click that asked for
   * it, so nothing is awaited before `permissions.request`.
   */
  async function allow() {
    busy.value = 'allow';
    try {
      const granted = await chrome.permissions.request(NATIVE_MESSAGING) === true;
      allowed.value = granted;
      if (granted) await refreshGeroProver();
    } catch {
      allowed.value = false;
    } finally {
      busy.value = null;
    }
  }

  async function run(kind: 'refresh' | 'toggle' | 'remove', task: () => Promise<unknown>) {
    busy.value = kind;
    try {
      await task();
    } catch {
      // The helper went away mid-action: read where it stands now.
      await refreshGeroProver();
    } finally {
      busy.value = null;
    }
  }

  const setAccelerator = (enabled: boolean) => run('toggle', () => askGeroProver({ action: 'setAccelerator', enabled }));
  const removeFiles = () => run('remove', () => askGeroProver({ action: 'removeKeys' }));
  const checkAgain = () => run('refresh', refresh);

  async function runTest() {
    busy.value = 'test';
    testResult.value = null;
    try {
      const { selfTest } = await askGeroProver({ action: 'selfTest' });
      testResult.value = selfTest
        ? { ok: true, seconds: (selfTest.proveMs / 1000).toFixed(1), accelerated: selfTest.accelerated }
        : { ok: false, copyKey: 'midnight.prover.error.proofFailed' };
    } catch (error) {
      testResult.value = {
        ok: false,
        copyKey: helperErrorCopyKey(error instanceof Error ? error.message : undefined) ?? 'midnight.prover.error.proofFailed',
      };
      await refreshGeroProver();
    } finally {
      busy.value = null;
    }
  }

  const view = computed<GeroProverView>(() => {
    const current = snapshot.value;
    if (!current || allowed.value === null) return 'checking';
    switch (current.connection) {
      case 'connected': return 'connected';
      case 'wrong-version': return 'wrongVersion';
      case 'forbidden': return 'forbidden';
      case 'error': return 'error';
      default: return 'setup';
    }
  });

  const status = computed(() => (snapshot.value?.connection === 'connected' ? snapshot.value.status : undefined));
  const accelerator = computed<HelperAcceleratorState | undefined>(() => status.value?.accelerator.state);

  /** Setup step 2: the browser may look, and has found no Gero Prover yet. */
  const waitingForHelper = computed(() => allowed.value === true && snapshot.value?.connection === 'not-found');

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // Look again while the user installs it; a helper that exists is not polled
  // (asking starts it), the page's own status check reads it now and then.
  watch(
    () => active() && waitingForHelper.value,
    (waiting) => {
      stopPolling();
      if (waiting) pollTimer = setInterval(() => { void refreshGeroProver(); }, SETUP_POLL_MS);
    },
    { immediate: true },
  );

  watch(active, (isActive) => { if (isActive) void refresh(); }, { immediate: true });

  onUnmounted(stopPolling);

  return {
    snapshot,
    view,
    status,
    accelerator,
    allowed,
    waitingForHelper,
    busy,
    testResult,
    allow,
    checkAgain,
    setAccelerator,
    runTest,
    removeFiles,
    downloadUrl: geroProverDownloadUrl(),
  };
}
