// src/chrome/supportChatAuth.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const STAKE = 'stake1uexampleexampleexampleexampleexampleexampleexampleex';

/** Mirror of NONCE_PATTERN, asserted against the module's own copy below. */
const NONCE_OK = /^[A-Za-z0-9_-]{16,128}$/;

/** Opaque server nonces of the shape the wallet is willing to sign. */
const NONCE_1 = 'nonce_abcdefghijkl1';
const NONCE_2 = 'nonce_abcdefghijkl2';

function httpError(status: number) {
  return { isAxiosError: true, response: { status, data: {} }, message: `status ${status}` };
}

/** `gero-support/v1|<stake>|<nonce>` as hex, which is what the wallet must sign. */
function expectedPayloadHex(nonce: string): string {
  const message = `gero-support/v1|${STAKE}|${nonce}`;
  return Array.from(new TextEncoder().encode(message))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('support chat handshake (background)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./supportChatAuth');
    expect(mod.supportAuthAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('signs the challenge message and returns the verified identity', async () => {
    const mod = await import('./supportChatAuth');
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
      if (path === '/api/support/chat/challenge') {
        return { data: { nonce: NONCE_1, message: `gero-support/v1|${STAKE}|${NONCE_1}` } };
      }
      return { data: { identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' } };
    }) as never);
    const sign = vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' });

    const identity = await mod.runSupportChatHandshake({ stakeAddress: STAKE, sign });

    expect(post).toHaveBeenNthCalledWith(1, '/api/support/chat/challenge', { stakeAddress: STAKE });
    expect(sign).toHaveBeenCalledWith(expectedPayloadHex(NONCE_1));
    expect(post).toHaveBeenNthCalledWith(2, '/api/support/chat/verify', {
      stakeAddress: STAKE,
      nonce: NONCE_1,
      coseSign1Hex: 'c0se',
      coseKeyHex: 'a4',
    });
    expect(identity).toEqual({ identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' });
  });

  it('refuses to sign a challenge whose message is not the exact expected subject', async () => {
    const mod = await import('./supportChatAuth');
    vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockResolvedValue({
      data: { nonce: NONCE_1, message: 'please sign this unrelated payload' },
    } as never);
    const sign = vi.fn();
    await expect(mod.runSupportChatHandshake({ stakeAddress: STAKE, sign })).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });

  it('retries the challenge exactly once when verify returns 400 (expired nonce)', async () => {
    const mod = await import('./supportChatAuth');
    let verifyCalls = 0;
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
      if (path === '/api/support/chat/challenge') {
        const nonce = verifyCalls === 0 ? NONCE_1 : NONCE_2;
        return { data: { nonce, message: `gero-support/v1|${STAKE}|${nonce}` } };
      }
      verifyCalls += 1;
      if (verifyCalls === 1) throw httpError(400);
      return { data: { identifier: 'v1:bb', identifierHash: 'h2', displayName: 'calm-fog-1a2b' } };
    }) as never);
    const sign = vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' });

    const identity = await mod.runSupportChatHandshake({ stakeAddress: STAKE, sign });

    expect(identity.identifier).toBe('v1:bb');
    expect(post.mock.calls.filter((c) => c[0] === '/api/support/chat/challenge')).toHaveLength(2);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenLastCalledWith(expectedPayloadHex(NONCE_2));
  });

  it('does not retry a 401 (bad signature)', async () => {
    const mod = await import('./supportChatAuth');
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
      if (path === '/api/support/chat/challenge') {
        return { data: { nonce: NONCE_1, message: `gero-support/v1|${STAKE}|${NONCE_1}` } };
      }
      throw httpError(401);
    }) as never);
    const sign = vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' });

    await expect(mod.runSupportChatHandshake({ stakeAddress: STAKE, sign })).rejects.toThrow();
    expect(post.mock.calls.filter((c) => c[0] === '/api/support/chat/challenge')).toHaveLength(1);
  });

  it('rejects a non-reward address before touching the network', async () => {
    const mod = await import('./supportChatAuth');
    const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post');
    await expect(
      mod.runSupportChatHandshake({ stakeAddress: 'addr1qxyz', sign: vi.fn() }),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  describe('nonce shape', () => {
    // The nonce is the ONLY server-chosen input to a string the stake key signs.
    const rejected = [
      ['a pipe (the subject separator)', 'abcdefghijklmnop|extra'],
      ['a newline', 'abcdefghijklmnop\nstake1uattacker'],
      ['whitespace', 'abcdefghij klmnop'],
      ['too short', 'abc123'],
      ['over-long', 'a'.repeat(129)],
      ['empty', ''],
    ] as const;

    it.each(rejected)('refuses to sign a challenge whose nonce has %s', async (_label, nonce) => {
      const mod = await import('./supportChatAuth');
      vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockResolvedValue({
        // The subject is internally consistent — only the nonce shape is wrong.
        data: { nonce, message: `gero-support/v1|${STAKE}|${nonce}` },
      } as never);
      const sign = vi.fn();
      await expect(mod.runSupportChatHandshake({ stakeAddress: STAKE, sign })).rejects.toThrow();
      expect(sign).not.toHaveBeenCalled();
    });

    it('accepts an opaque URL-safe token', async () => {
      const mod = await import('./supportChatAuth');
      expect(mod.NONCE_PATTERN.source).toBe(NONCE_OK.source);
      expect(mod.NONCE_PATTERN.test('Xy9_-abcdefghijklmnop')).toBe(true);
    });
  });

  describe('authenticateSupportChat (message-handler entry point)', () => {
    function walletStub(overrides: Record<string, unknown> = {}) {
      return {
        chain: 'Cardano',
        stakeAddress: STAKE,
        signData: vi.fn().mockResolvedValue({ signature: 'c0se', key: 'a4' }),
        ...overrides,
      };
    }

    async function stubChallengeAndVerify(mod: typeof import('./supportChatAuth')) {
      return vi.spyOn(mod.supportAuthAxiosInstance, 'post').mockImplementation((async (path: string) => {
        if (path === '/api/support/chat/challenge') {
          return { data: { nonce: 'nonce_abcdefghijklm', message: `gero-support/v1|${STAKE}|nonce_abcdefghijklm` } };
        }
        return { data: { identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' } };
      }) as never);
    }

    it('signs with the wallet stake key and returns the verified identity', async () => {
      const mod = await import('./supportChatAuth');
      await stubChallengeAndVerify(mod);
      const wallet = walletStub();

      const identity = await mod.authenticateSupportChat(wallet, { payment: [] }, { password: 'pw' });

      expect(identity).toEqual({ identifier: 'v1:aa', identifierHash: 'hh', displayName: 'quiet-dew-4f2a' });
      expect(wallet.signData).toHaveBeenCalledWith(
        STAKE,
        expectedPayloadHex('nonce_abcdefghijklm'),
        'pw',
        { payment: [] },
        undefined,
      );
    });

    it('passes PRF root-key bytes through instead of a password', async () => {
      const mod = await import('./supportChatAuth');
      await stubChallengeAndVerify(mod);
      const wallet = walletStub();
      const privateKeyBytes = new Uint8Array([1, 2, 3]);

      await mod.authenticateSupportChat(wallet, null, { privateKeyBytes });

      expect(wallet.signData).toHaveBeenCalledWith(
        STAKE,
        expect.any(String),
        '',
        null,
        privateKeyBytes,
      );
    });

    it('refuses a locked wallet, a non-Cardano wallet, and a wallet with no reward address', async () => {
      const mod = await import('./supportChatAuth');
      const post = vi.spyOn(mod.supportAuthAxiosInstance, 'post');

      await expect(mod.authenticateSupportChat(null, null, {})).rejects.toThrow(/unlocked/i);
      await expect(
        mod.authenticateSupportChat(walletStub({ chain: 'Bitcoin' }), null, {}),
      ).rejects.toThrow(/Cardano/i);
      await expect(
        mod.authenticateSupportChat(walletStub({ stakeAddress: 'addr1qxyz' }), null, {}),
      ).rejects.toThrow(/reward address/i);

      expect(post).not.toHaveBeenCalled(); // every guard short-circuits before the network
    });

    it('propagates a signing failure (wrong password) instead of swallowing it', async () => {
      const mod = await import('./supportChatAuth');
      await stubChallengeAndVerify(mod);
      const wallet = walletStub({ signData: vi.fn().mockRejectedValue(new Error('Invalid password')) });
      await expect(mod.authenticateSupportChat(wallet, null, { password: 'nope' })).rejects.toThrow(
        /Invalid password/,
      );
    });
  });
});
