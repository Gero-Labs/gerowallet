// The link flow: config → support check → stored session, and connecting by
// signing the link message with BIP-322 at the wallet's first receive address.
// A refused session must drop the page back to "connect", and a reply for a
// wallet the user has switched away from must change nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import { Blockchain, Network, WalletType } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';

vi.mock('@/api/gomining-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/gomining-api')>();
  return { ...actual, default: { getConfig: vi.fn(), createChallenge: vi.fn(), createSession: vi.fn() } };
});
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: null as Record<string, unknown> | null }) };
});

import goMiningApi, { GoMiningApiError, GoMiningSessionError } from '@/api/gomining-api';
import { Messaging } from '@/chrome/messaging';
import { walletStore } from '@/stores/walletStore';
import { goMiningErrorMessage, GoMiningSignError, useGoMiningAccount } from './useGoMiningAccount';
import { clearGoMiningSession, goMiningLinkMessage, readGoMiningSession, writeGoMiningSession } from './goMiningSession';

const api = vi.mocked(goMiningApi);
const send = vi.mocked(Messaging.sendToBackgroundFromOptions);
const NONCE = 'ab'.repeat(16);
const CONFIG = { environment: 'sandbox' as const, bitcoinNetwork: Network.TESTNET, ordersEnabled: true, referralUrl: null };
const FUTURE = () => Date.now() + 3_600_000;

function btcWallet(id: number, patch: Record<string, unknown> = {}) {
  return { id, chain: Blockchain.BITCOIN, network: Network.TESTNET, type: WalletType.Normal, addressType: 'segwit', baseAddress: `tb1qwallet${id}`, ...patch };
}

let scope: EffectScope;
function start() {
  scope = effectScope();
  return scope.run(() => useGoMiningAccount())!;
}

beforeEach(() => {
  api.getConfig.mockReset().mockResolvedValue(CONFIG);
  api.createChallenge.mockReset().mockResolvedValue({ nonce: NONCE, expiresAt: FUTURE() });
  api.createSession.mockReset().mockResolvedValue({ token: 'tok_new', expiresAt: FUTURE() });
  send.mockReset().mockResolvedValue({ data: { success: true, signature: 'c2ln' } });
  (walletStore as { loggedWallet: unknown }).loggedWallet = btcWallet(1);
});

afterEach(async () => {
  scope?.stop();
  await clearGoMiningSession(1);
  await clearGoMiningSession(2);
});

describe('loading', () => {
  it('is linked when this wallet has a live session', async () => {
    await writeGoMiningSession(1, { token: 'tok_old', expiresAt: FUTURE() }, 'tb1qwallet1', Network.TESTNET);
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('linked'));
  });

  it('asks to connect when there is no session', async () => {
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unlinked'));
  });

  it('says GoMining is unavailable when the backend config cannot be read', async () => {
    api.getConfig.mockRejectedValueOnce(new GoMiningApiError('network_error', 0));
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unavailable'));
  });

  it('turns away a wallet that cannot link, before any session is read', async () => {
    (walletStore as { loggedWallet: unknown }).loggedWallet = btcWallet(1, { addressType: 'legacy' });
    await writeGoMiningSession(1, { token: 'tok_old', expiresAt: FUTURE() }, 'tb1qwallet1', Network.TESTNET);
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unsupported'));
    expect(account.unsupportedReason.value).toBe('addressType');
  });
});

describe('connect', () => {
  it('signs the link message with BIP-322 and keeps the session', async () => {
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unlinked'));

    await account.connect({ password: 'pw' });

    expect(api.createChallenge).toHaveBeenCalledWith('tb1qwallet1', Network.TESTNET);
    expect(send).toHaveBeenCalledWith({
      method: MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE,
      data: { message: goMiningLinkMessage('tb1qwallet1', NONCE), type: 'bip322-simple', password: 'pw' },
    });
    expect(api.createSession).toHaveBeenCalledWith({ address: 'tb1qwallet1', network: Network.TESTNET, nonce: NONCE, signature: 'c2ln' });
    expect(account.phase.value).toBe('linked');
    expect(await readGoMiningSession(1, 'tb1qwallet1', Network.TESTNET)).toMatchObject({ token: 'tok_new' });
  });

  it('passes a PassKey PRF output instead of a password', async () => {
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unlinked'));
    await account.connect({ privateKeyBytes: new Uint8Array([1, 2, 3]) });
    expect(send.mock.calls[0][0].data).toMatchObject({ type: 'bip322-simple', privateKeyBytes: [1, 2, 3] });
    expect(send.mock.calls[0][0].data).not.toHaveProperty('password');
  });

  it('stays unlinked when the wallet refuses to sign', async () => {
    send.mockResolvedValueOnce({ data: { success: false, error: 'Wrong password' } });
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unlinked'));

    const failure = await account.connect({ password: 'bad' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoMiningSignError);
    expect(goMiningErrorMessage(failure, (key) => key)).toBe('errors.wrongPassword');
    expect(api.createSession).not.toHaveBeenCalled();
    expect(account.phase.value).toBe('unlinked');
  });

  it('drops a session that arrives after the user switched wallet', async () => {
    let finish!: (value: { token: string; expiresAt: number }) => void;
    api.createSession.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('unlinked'));

    const connecting = account.connect({ password: 'pw' });
    await vi.waitFor(() => expect(api.createSession).toHaveBeenCalled());
    (walletStore as { loggedWallet: unknown }).loggedWallet = btcWallet(2);
    await nextTick();
    finish({ token: 'tok_for_wallet_1', expiresAt: FUTURE() });
    await connecting;

    await vi.waitFor(() => expect(account.phase.value).toBe('unlinked'));
    expect(await readGoMiningSession(1, 'tb1qwallet1', Network.TESTNET)).toBeNull();
    expect(await readGoMiningSession(2, 'tb1qwallet2', Network.TESTNET)).toBeNull();
  });
});

describe('withSession', () => {
  it('drops a refused session and asks to connect again', async () => {
    await writeGoMiningSession(1, { token: 'tok_old', expiresAt: FUTURE() }, 'tb1qwallet1', Network.TESTNET);
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('linked'));

    const call = vi.fn().mockRejectedValue(new GoMiningSessionError());
    await expect(account.withSession(call)).rejects.toBeInstanceOf(GoMiningSessionError);

    expect(call).toHaveBeenCalledWith('tok_old');
    expect(account.phase.value).toBe('unlinked');
    expect(account.sessionExpired.value).toBe(true);
    expect(await readGoMiningSession(1, 'tb1qwallet1', Network.TESTNET)).toBeNull();
  });

  it('keeps the session through any other failure', async () => {
    await writeGoMiningSession(1, { token: 'tok_old', expiresAt: FUTURE() }, 'tb1qwallet1', Network.TESTNET);
    const account = start();
    await vi.waitFor(() => expect(account.phase.value).toBe('linked'));

    await expect(account.withSession(() => Promise.reject(new GoMiningApiError('rate_limited', 429)))).rejects.toBeInstanceOf(GoMiningApiError);
    expect(account.phase.value).toBe('linked');
  });
});

describe('goMiningErrorMessage', () => {
  it('maps backend codes and never shows server text', () => {
    const t = (key: string) => key;
    expect(goMiningErrorMessage(new GoMiningApiError('quote_expired', 409), t)).toBe('gomining.errorQuoteExpired');
    expect(goMiningErrorMessage(new GoMiningApiError('something_new', 500), t)).toBe('common.somethingWentWrong');
    expect(goMiningErrorMessage(new Error('stack trace here'), t)).toBe('common.somethingWentWrong');
  });
});
