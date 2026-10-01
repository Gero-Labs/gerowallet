import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageTypes } from '@/models/MessageTypes';

const API_PUB = 'ab'.repeat(32);

const mocks = vi.hoisted(() => ({
  generateStrikeKeyPair: vi.fn(),
  requestBuilderSignature: vi.fn(),
  verifyBuilderSignature: vi.fn(),
  sendToBackgroundFromOptions: vi.fn(),
  wallet: { current: null as null | Record<string, unknown> },
  storage: {} as Record<string, unknown>,
}));

vi.mock('@/api/strike-v2.auth', () => ({ generateStrikeKeyPair: mocks.generateStrikeKeyPair }));
vi.mock('@/api/strike-v2.builder-connect', () => ({
  requestBuilderSignature: mocks.requestBuilderSignature,
  verifyBuilderSignature: mocks.verifyBuilderSignature,
}));
vi.mock('@/api/strike-v2.client', () => ({
  setStrikeApiKeys: vi.fn(),
  clearStrikeApiKeys: vi.fn(),
  onStrikeAuthFailure: vi.fn(),
}));
vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: mocks.sendToBackgroundFromOptions },
}));
vi.mock('@/stores/walletStore', () => ({
  walletStore: {
    get loggedWallet() { return mocks.wallet.current; },
  },
}));
vi.mock('@/shared/utils/secretWriters', () => ({ sealKeySecret: vi.fn(() => 'sealed') }));
vi.mock('@/shared/utils/crypto', () => ({ SecretPurpose: { StrikeKey: 'strike' }, decryptKeyBlob: vi.fn() }));
vi.mock('@/shared/utils/webauthn-prf', () => ({
  encryptPrivateKeyWithPrf: vi.fn(),
  decryptPrivateKeyWithPrf: vi.fn(),
}));
vi.mock('./useStrikeTrading', () => ({ useStrikeTrading: () => ({ reset: vi.fn() }) }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

const utf8Hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

async function freshModule() {
  vi.resetModules();
  return import('./useStrikeOnboarding');
}

describe('assessBuilderMessage', () => {
  it('refuses empty, oversized and control / bidi text', async () => {
    const { assessBuilderMessage } = await freshModule();
    expect(assessBuilderMessage('', API_PUB)).toEqual({ ok: false, reason: 'empty' });
    expect(assessBuilderMessage('   \n', API_PUB)).toEqual({ ok: false, reason: 'empty' });
    expect(assessBuilderMessage('a'.repeat(2049), API_PUB)).toEqual({ ok: false, reason: 'tooLong' });
    expect(assessBuilderMessage('login\u0000now', API_PUB)).toEqual({ ok: false, reason: 'unsafeChars' });
    expect(assessBuilderMessage('pay ‮evil', API_PUB)).toEqual({ ok: false, reason: 'unsafeChars' });
    expect(assessBuilderMessage('a⁦b', API_PUB)).toEqual({ ok: false, reason: 'unsafeChars' });
  });

  it('accepts ordinary multi-line text and reports whether it names the API key', async () => {
    const { assessBuilderMessage } = await freshModule();
    expect(assessBuilderMessage(`Strike builder connect\r\n\tkey: ${API_PUB.toUpperCase()}`, API_PUB))
      .toEqual({ ok: true, boundToKey: true });
    expect(assessBuilderMessage('Sign in to example.org\nnonce: 42', API_PUB))
      .toEqual({ ok: true, boundToKey: false });
    expect(assessBuilderMessage('a'.repeat(2048), '')).toEqual({ ok: true, boundToKey: false });
  });
});

describe('Strike builder connect', () => {
  const MESSAGE = `Strike: bind API wallet ${API_PUB}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage = {};
    mocks.wallet.current = { id: 'w1', baseAddress: 'addr_test1qqq', encryptionMethod: 'password' };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: (key: string, cb: (r: Record<string, unknown>) => void) => cb({ [key]: mocks.storage[key] }),
          set: (items: Record<string, unknown>, cb: () => void) => { Object.assign(mocks.storage, items); cb(); },
          remove: (key: string, cb: () => void) => { delete mocks.storage[key]; cb(); },
        },
      },
    });
    mocks.generateStrikeKeyPair.mockResolvedValue({ privateKeyHex: 'cd'.repeat(32), publicKeyHex: API_PUB });
    mocks.requestBuilderSignature.mockResolvedValue({ nonce: 'n-1', message_to_sign: MESSAGE });
    mocks.verifyBuilderSignature.mockResolvedValue({ account_id: 'acct-1' });
    mocks.sendToBackgroundFromOptions.mockResolvedValue({ data: { signature: 'sig', key: 'key' } });
  });

  it('prepareConnect fetches and exposes the message without signing anything', async () => {
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    expect(await s.prepareConnect()).toBe(true);
    expect(s.pendingMessage.value).toEqual({ message: MESSAGE, boundToKey: true });
    expect(mocks.sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('refuses to sign when no message has been prepared and reviewed', async () => {
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    expect(await s.connectWithWallet('pw')).toBe(false);
    expect(mocks.requestBuilderSignature).not.toHaveBeenCalled();
    expect(mocks.sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('signs exactly the reviewed message and verifies with its nonce', async () => {
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    await s.prepareConnect();
    expect(await s.connectWithWallet('pw')).toBe(true);

    expect(mocks.sendToBackgroundFromOptions).toHaveBeenCalledTimes(1);
    const req = mocks.sendToBackgroundFromOptions.mock.calls[0][0];
    expect(req.method).toBe(MessageTypes.SIGN_DATA);
    expect(req.data.payload).toBe(utf8Hex(MESSAGE));
    expect(req.data.address).toBe('addr_test1qqq');
    expect(mocks.verifyBuilderSignature).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'n-1', wallet_signature: 'sig:key' }));
    expect(s.isConnected.value).toBe(true);
    expect(s.pendingMessage.value).toBeNull();
  });

  it('refuses an unsafe message before the user is ever asked to authenticate', async () => {
    mocks.requestBuilderSignature.mockResolvedValue({ nonce: 'n-1', message_to_sign: 'login‮txe' });
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    expect(await s.prepareConnect()).toBe(false);
    expect(s.pendingMessage.value).toBeNull();
    expect(s.error.value).toBe('perps.connect.messageRefused');
    expect(await s.connectWithWallet('pw')).toBe(false);
    expect(mocks.sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('shows a message without the API key as unbound rather than refusing it', async () => {
    mocks.requestBuilderSignature.mockResolvedValue({ nonce: 'n-1', message_to_sign: 'Sign in to Strike' });
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    expect(await s.prepareConnect()).toBe(true);
    expect(s.pendingMessage.value).toEqual({ message: 'Sign in to Strike', boundToKey: false });
  });

  it('never signs a message prepared for another wallet', async () => {
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    await s.prepareConnect();
    mocks.wallet.current = { id: 'w2', baseAddress: 'addr_test1zzz', encryptionMethod: 'password' };
    expect(await s.connectWithWallet('pw')).toBe(false);
    expect(mocks.sendToBackgroundFromOptions).not.toHaveBeenCalled();
    expect(s.pendingMessage.value).toBeNull();
  });

  it('keeps the reviewed message after a wrong password, drops it after a signature', async () => {
    mocks.sendToBackgroundFromOptions.mockResolvedValueOnce({ data: { error: 'Incorrect password' } });
    mocks.verifyBuilderSignature.mockRejectedValueOnce(new Error('nonce expired'));
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    await s.prepareConnect();

    expect(await s.connectWithWallet('wrong')).toBe(false);
    expect(s.pendingMessage.value).toEqual({ message: MESSAGE, boundToKey: true });

    expect(await s.connectWithWallet('pw')).toBe(false);
    expect(s.error.value).toBe('nonce expired');
    expect(s.pendingMessage.value).toBeNull();
    expect(await s.connectWithWallet('pw')).toBe(false);
    expect(mocks.sendToBackgroundFromOptions).toHaveBeenCalledTimes(2);
  });

  it('cancelConnect drops the prepared message', async () => {
    const { useStrikeOnboarding } = await freshModule();
    const s = useStrikeOnboarding();
    await s.prepareConnect();
    s.cancelConnect();
    expect(s.pendingMessage.value).toBeNull();
    expect(await s.connectWithWallet('pw')).toBe(false);
    expect(mocks.sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });
});
