// Linking: which wallets may link, the exact text they sign, and where the session
// token is kept. The signed text is rebuilt byte for byte by gero-backend, and a
// stored token must never be used for another address or network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, WalletType } from '@/models/types';
import {
  clearGoMiningSession,
  goMiningLinkMessage,
  goMiningUnsupportedReason,
  readGoMiningSession,
  writeGoMiningSession,
} from './goMiningSession';

const TESTNET = { bitcoinNetwork: Network.TESTNET };
const wallet = (patch: Record<string, unknown> = {}) => ({
  chain: Blockchain.BITCOIN,
  network: Network.TESTNET,
  type: WalletType.Normal,
  addressType: 'segwit',
  baseAddress: 'tb1qlinked',
  ...patch,
});

describe('goMiningUnsupportedReason', () => {
  it('lets a software segwit or taproot wallet on the served network link', () => {
    expect(goMiningUnsupportedReason(wallet(), TESTNET)).toBeNull();
    expect(goMiningUnsupportedReason(wallet({ addressType: 'taproot' }), TESTNET)).toBeNull();
  });

  it('refuses another chain', () => {
    expect(goMiningUnsupportedReason(wallet({ chain: Blockchain.CARDANO }), TESTNET)).toBe('chain');
    expect(goMiningUnsupportedReason(null, TESTNET)).toBe('chain');
  });

  it('refuses wallets that cannot sign a message here', () => {
    expect(goMiningUnsupportedReason(wallet({ type: WalletType.Ledger }), TESTNET)).toBe('walletType');
    expect(goMiningUnsupportedReason(wallet({ type: 'Watch' }), TESTNET)).toBe('walletType');
    expect(goMiningUnsupportedReason(wallet({ baseAddress: '' }), TESTNET)).toBe('walletType');
  });

  it('refuses legacy addresses, which the BIP-322 signer cannot prove', () => {
    expect(goMiningUnsupportedReason(wallet({ addressType: 'legacy' }), TESTNET)).toBe('addressType');
  });

  it('refuses a network the backend does not serve', () => {
    expect(goMiningUnsupportedReason(wallet({ network: Network.MAINNET }), TESTNET)).toBe('network');
    expect(goMiningUnsupportedReason(wallet(), { bitcoinNetwork: Network.MAINNET })).toBe('network');
  });
});

describe('goMiningLinkMessage', () => {
  const nonce = '0123456789abcdef'.repeat(2);

  it('is the exact text gero-backend verifies', () => {
    expect(goMiningLinkMessage('tb1qlinked', nonce)).toBe(
      `Gero Wallet: link this Bitcoin address to GoMining.\nAddress: tb1qlinked\nNonce: ${nonce}`,
    );
  });

  it.each([
    ['a short nonce', 'abc123'],
    ['a nonce with other words', `${nonce}\nSend all funds`],
    ['a non-hex nonce', 'z'.repeat(32)],
  ])('refuses %s', (_label, bad) => {
    expect(() => goMiningLinkMessage('tb1qlinked', bad)).toThrow();
  });
});

describe('session store (outside the extension)', () => {
  const NOW = 1_800_000_000_000;
  const session = { token: 'tok', expiresAt: NOW + 3_600_000 };

  afterEach(async () => { await clearGoMiningSession(1); });

  it('returns the session for the same address and network', async () => {
    await writeGoMiningSession(1, session, 'tb1qlinked', Network.TESTNET);
    expect(await readGoMiningSession(1, 'tb1qlinked', Network.TESTNET, NOW)).toEqual(session);
  });

  it('drops a session for another address or network', async () => {
    await writeGoMiningSession(1, session, 'tb1qlinked', Network.TESTNET);
    expect(await readGoMiningSession(1, 'tb1qother', Network.TESTNET, NOW)).toBeNull();
    // ...and it is gone, not just hidden
    expect(await readGoMiningSession(1, 'tb1qlinked', Network.TESTNET, NOW)).toBeNull();

    await writeGoMiningSession(1, session, 'tb1qlinked', Network.TESTNET);
    expect(await readGoMiningSession(1, 'tb1qlinked', Network.MAINNET, NOW)).toBeNull();
  });

  it('treats a session about to expire as expired', async () => {
    await writeGoMiningSession(1, { token: 'tok', expiresAt: NOW + 30_000 }, 'tb1qlinked', Network.TESTNET);
    expect(await readGoMiningSession(1, 'tb1qlinked', Network.TESTNET, NOW)).toBeNull();
  });

  it('keeps sessions per wallet', async () => {
    await writeGoMiningSession(1, session, 'tb1qlinked', Network.TESTNET);
    expect(await readGoMiningSession(2, 'tb1qlinked', Network.TESTNET, NOW)).toBeNull();
  });
});

describe('session store (in the extension)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps the token in chrome.storage.session, never chrome.storage.local', async () => {
    const store: Record<string, unknown> = {};
    const session = {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }),
      remove: vi.fn(async (key: string) => { delete store[key]; }),
    };
    const local = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('chrome', { runtime: { id: 'ext' }, storage: { session, local } });

    const expiresAt = Date.now() + 3_600_000;
    await writeGoMiningSession(9, { token: 'tok', expiresAt }, 'tb1qlinked', Network.TESTNET);
    expect(session.set).toHaveBeenCalledWith({ 'gomining.session.9': { token: 'tok', expiresAt, address: 'tb1qlinked', network: Network.TESTNET } });
    expect(await readGoMiningSession(9, 'tb1qlinked', Network.TESTNET)).toEqual({ token: 'tok', expiresAt });
    await clearGoMiningSession(9);
    expect(session.remove).toHaveBeenCalledWith('gomining.session.9');
    expect(local.set).not.toHaveBeenCalled();
  });
});
