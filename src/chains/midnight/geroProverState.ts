/**
 * Gero Prover as the extension pages know it: the last status the background
 * read from the helper, the calls that ask for it, and how a helper failure is
 * said to the user. Page context only (the background owns the connection:
 * midnightHelperProver.ts).
 */
import { ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import {
  GERO_PROVER_CLOSED,
  GERO_PROVER_FORBIDDEN,
  GERO_PROVER_KEYS,
  GERO_PROVER_NOT_ALLOWED,
  GERO_PROVER_NOT_FOUND,
  GERO_PROVER_PROOF_FAILED,
  GERO_PROVER_TIMEOUT,
  GERO_PROVER_UNSUPPORTED_CIRCUIT,
  GERO_PROVER_WRONG_VERSION,
  parseGeroProverSnapshot,
  type GeroProverConnection,
  type GeroProverSnapshot,
  type HelperSelfTest,
} from './midnightHelperProtocol';

/** Why a send that chose Gero Prover cannot use it right now. */
export type HelperUnavailableReason = 'helper-not-allowed' | 'helper-not-found' | 'helper-wrong-version' | 'helper-error';

const REASON_OF_CONNECTION: Record<Exclude<GeroProverConnection, 'connected'>, HelperUnavailableReason> = {
  'not-allowed': 'helper-not-allowed',
  'not-found': 'helper-not-found',
  // Registered for another copy of the extension: for the user, a setup to redo.
  forbidden: 'helper-not-found',
  'wrong-version': 'helper-wrong-version',
  error: 'helper-error',
};

export function isHelperUnavailableReason(reason: string | undefined): reason is HelperUnavailableReason {
  return reason === 'helper-not-allowed' || reason === 'helper-not-found' || reason === 'helper-wrong-version' || reason === 'helper-error';
}

/** What a send says when Gero Prover cannot take it. Nothing has been sent at that point. */
export const HELPER_UNAVAILABLE_COPY: Record<HelperUnavailableReason, string> = {
  'helper-not-allowed': 'midnight.prover.send.notAllowed',
  'helper-not-found': 'midnight.prover.send.notFound',
  'helper-wrong-version': 'midnight.prover.send.wrongVersion',
  'helper-error': 'midnight.prover.send.error',
};

/** Background failure codes that mean the helper could not be used at all. */
export const HELPER_UNAVAILABLE_REASON: Record<string, HelperUnavailableReason> = {
  [GERO_PROVER_NOT_ALLOWED]: 'helper-not-allowed',
  [GERO_PROVER_NOT_FOUND]: 'helper-not-found',
  [GERO_PROVER_FORBIDDEN]: 'helper-not-found',
  [GERO_PROVER_WRONG_VERSION]: 'helper-wrong-version',
};

/** Background failure codes for a proof that was attempted, and their copy. */
export const HELPER_ERROR_COPY: Record<string, string> = {
  [GERO_PROVER_CLOSED]: 'midnight.prover.error.closed',
  [GERO_PROVER_TIMEOUT]: 'midnight.prover.error.timeout',
  [GERO_PROVER_KEYS]: 'midnight.prover.error.keys',
  [GERO_PROVER_PROOF_FAILED]: 'midnight.prover.error.proofFailed',
  [GERO_PROVER_UNSUPPORTED_CIRCUIT]: 'midnight.prover.error.unsupportedCircuit',
};

/** The copy for a helper failure code, or undefined for any other error text. */
export function helperErrorCopyKey(error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (Object.prototype.hasOwnProperty.call(HELPER_ERROR_COPY, error)) return HELPER_ERROR_COPY[error];
  return Object.prototype.hasOwnProperty.call(HELPER_UNAVAILABLE_REASON, error) ? 'midnight.prover.error.unavailable' : undefined;
}

/**
 * The helper's last known status, shared by every surface in this page (the
 * Proof server page, the widgets, the send dialogs). `null` until first asked.
 */
export const geroProverSnapshot = ref<GeroProverSnapshot | null>(null);

type GeroProverAction =
  | { action: 'status' | 'selfTest' | 'removeKeys' }
  | { action: 'setAccelerator'; enabled: boolean };

/** The background refused or failed a helper action. `message` is a code or the background's own text. */
export class GeroProverActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeroProverActionError';
  }
}

/**
 * Ask the background about the helper. A helper that is missing or unusable is
 * an answer (the snapshot's `connection`), not an error; only a failed test
 * proof or a broken message channel throws.
 */
export async function askGeroProver(request: GeroProverAction): Promise<{ snapshot: GeroProverSnapshot; selfTest?: HelperSelfTest }> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.GERO_PROVER,
    data: request,
  }) as { data?: { success?: boolean; error?: string; result?: { snapshot?: unknown; selfTest?: unknown } } };
  if (!response?.data?.success) throw new GeroProverActionError(response?.data?.error || 'Gero Prover did not answer');
  const snapshot = parseGeroProverSnapshot(response.data.result?.snapshot);
  geroProverSnapshot.value = snapshot;
  const selfTest = response.data.result?.selfTest as Partial<HelperSelfTest> | undefined;
  return {
    snapshot,
    ...(selfTest && typeof selfTest.proveMs === 'number' && typeof selfTest.accelerated === 'boolean'
      ? { selfTest: { proveMs: selfTest.proveMs, accelerated: selfTest.accelerated } } : {}),
  };
}

/**
 * The processor Gero Prover is proving on, for the send timeline
 * ("Graphics processor · Apple M3 Pro"), from the status the send's preflight
 * just read. Undefined before the helper has been asked.
 */
export function helperProcessorLabel(t: (key: string, params?: Record<string, unknown>) => string): string | undefined {
  const status = geroProverSnapshot.value?.connection === 'connected' ? geroProverSnapshot.value.status : undefined;
  if (!status) return undefined;
  if (status.accelerator.state !== 'active') return t('midnight.prover.cpu');
  return status.accelerator.device ? t('midnight.prover.gpuNamed', { device: status.accelerator.device }) : t('midnight.prover.gpu');
}

/** Read the helper's status now. Never throws: an unreachable background reads as `error`. */
export async function refreshGeroProver(): Promise<GeroProverSnapshot> {
  try {
    return (await askGeroProver({ action: 'status' })).snapshot;
  } catch {
    geroProverSnapshot.value = { connection: 'error' };
    return geroProverSnapshot.value;
  }
}

/** Before a send: why Gero Prover cannot take it, or undefined when it can. */
export async function helperPreflightReason(): Promise<HelperUnavailableReason | undefined> {
  const { connection } = await refreshGeroProver();
  return connection === 'connected' ? undefined : REASON_OF_CONNECTION[connection];
}
