/**
 * The logged wallet's GoMining link: backend config, whether this wallet can use
 * GoMining, its session, and connecting.
 *
 * Every authenticated call goes through `withSession`. A refused token is dropped
 * and the page falls back to "connect", with `sessionExpired` set so it can say why.
 * A wallet switch starts over, and any reply for the previous wallet is discarded.
 */

import { computed, ref, watch } from 'vue';
import goMiningApi, { GoMiningApiError, GoMiningSessionError, type GoMiningConfig } from '@/api/gomining-api';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import {
  clearGoMiningSession,
  goMiningLinkMessage,
  goMiningUnsupportedReason,
  readGoMiningSession,
  writeGoMiningSession,
  type GoMiningUnsupportedReason,
} from './goMiningSession';

export type GoMiningPhase = 'loading' | 'unavailable' | 'unsupported' | 'unlinked' | 'linked';

/** What unlocks the wallet's signing key: its spending password, or a PassKey's PRF output. */
export type GoMiningCredentials = { password: string } | { privateKeyBytes: Uint8Array };

/** The wallet refused to sign the link message (wrong password, cancelled PassKey, …). */
export class GoMiningSignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoMiningSignError';
  }
}

const ERROR_KEYS: Record<string, string> = {
  session_expired: 'gomining.errorSessionExpired',
  network_error: 'gomining.errorNetwork',
  rate_limited: 'gomining.errorRateLimited',
  orders_disabled: 'gomining.errorOrdersDisabled',
  quote_expired: 'gomining.errorQuoteExpired',
  below_minimum: 'gomining.errorBelowMinimum',
  insufficient_balance: 'errors.insufficientBalance',
  invalid_signature: 'gomining.errorLinkRefused',
  challenge_expired: 'gomining.errorLinkRefused',
  upstream_unavailable: 'gomining.errorUnavailable',
};

/** A message for the user. Backend errors map by code; nothing raw from the server is shown. */
export function goMiningErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof GoMiningApiError) return t(ERROR_KEYS[error.code] ?? 'common.somethingWentWrong');
  if (error instanceof GoMiningSignError) return /password/i.test(error.message) ? t('errors.wrongPassword') : t('gomining.errorSignFailed');
  return t('common.somethingWentWrong');
}

export function useGoMiningAccount() {
  const config = ref<GoMiningConfig | null>(null);
  const phase = ref<GoMiningPhase>('loading');
  const unsupportedReason = ref<GoMiningUnsupportedReason | null>(null);
  const sessionExpired = ref(false);
  const token = ref<string | null>(null);
  let generation = 0;

  const wallet = computed(() => walletStore.loggedWallet);
  const address = computed(() => wallet.value?.baseAddress ?? '');

  async function load(): Promise<void> {
    const current = ++generation;
    phase.value = 'loading';
    token.value = null;
    let loaded: GoMiningConfig;
    try {
      loaded = await goMiningApi.getConfig();
    } catch {
      if (current === generation) phase.value = 'unavailable';
      return;
    }
    if (current !== generation) return;
    config.value = loaded;

    const reason = goMiningUnsupportedReason(wallet.value, loaded);
    unsupportedReason.value = reason;
    if (reason || !wallet.value) {
      phase.value = 'unsupported';
      return;
    }
    const session = await readGoMiningSession(wallet.value.id, address.value, wallet.value.network);
    if (current !== generation) return;
    token.value = session?.token ?? null;
    phase.value = token.value ? 'linked' : 'unlinked';
  }

  /** Proves the wallet owns its address and opens a GoMining session. Throws on failure. */
  async function connect(credentials: GoMiningCredentials): Promise<void> {
    const current = generation;
    const linked = wallet.value;
    if (phase.value !== 'unlinked' || !linked) return;
    const linkedAddress = address.value;
    const network = linked.network;

    const challenge = await goMiningApi.createChallenge(linkedAddress, network);
    const message = goMiningLinkMessage(linkedAddress, challenge.nonce);
    const secret = 'password' in credentials
      ? { password: credentials.password }
      : { privateKeyBytes: Array.from(credentials.privateKeyBytes) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sendToBackgroundFromOptions resolves an untyped messaging envelope
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE,
      data: { message, type: 'bip322-simple', ...secret },
    });
    if (!response?.data?.success || typeof response.data.signature !== 'string') {
      throw new GoMiningSignError(typeof response?.data?.error === 'string' ? response.data.error : '');
    }
    const session = await goMiningApi.createSession({ address: linkedAddress, network, nonce: challenge.nonce, signature: response.data.signature });
    if (current !== generation || wallet.value?.id !== linked.id) return;

    await writeGoMiningSession(linked.id, session, linkedAddress, network);
    if (current !== generation) return;
    token.value = session.token;
    sessionExpired.value = false;
    phase.value = 'linked';
  }

  /** Runs an authenticated call. A refused session drops the page back to "connect". */
  async function withSession<T>(call: (sessionToken: string) => Promise<T>): Promise<T> {
    const current = generation;
    const sessionToken = token.value;
    const walletId = wallet.value?.id;
    if (!sessionToken || walletId === undefined) throw new GoMiningSessionError();
    try {
      return await call(sessionToken);
    } catch (error) {
      if (error instanceof GoMiningSessionError && current === generation && token.value === sessionToken) {
        token.value = null;
        sessionExpired.value = true;
        phase.value = 'unlinked';
        await clearGoMiningSession(walletId);
      }
      throw error;
    }
  }

  /** Whether a reply was asked for the wallet still shown; replies for an earlier one are dropped. */
  function captureGeneration(): () => boolean {
    const current = generation;
    return () => current === generation;
  }

  watch(
    () => [wallet.value?.id, wallet.value?.network, wallet.value?.baseAddress],
    () => { sessionExpired.value = false; void load(); },
    { immediate: true },
  );

  return { config, phase, unsupportedReason, sessionExpired, address, wallet, load, connect, withSession, captureGeneration };
}
