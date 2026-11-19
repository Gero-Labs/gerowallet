/* eslint-disable @typescript-eslint/no-explicit-any -- drives the untyped Wallet Standard objects as a dApp would */
// Gero as a Solana Wallet Standard wallet, driven the way a dApp's wallet adapter drives it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { base58Encode } from '@/chains/solana/solanaBase58';

const bridge = vi.hoisted(() => ({
  solanaAvailable: vi.fn(async () => true),
  solanaConnect: vi.fn(),
  solanaSignMessage: vi.fn(),
}));
vi.mock('./solanaWebpage', () => bridge);

const ADDRESS = base58Encode(new Uint8Array(32).fill(5));

/** Registers the way @wallet-standard/app does: listens, then imports the wallet script. */
async function loadAndCollect(): Promise<{ wallets: any[]; mod: typeof import('./injectSolana') }> {
  vi.resetModules();
  const wallets: any[] = [];
  const onRegister = (event: Event) => (event as CustomEvent).detail({ register: (w: unknown) => wallets.push(w) });
  window.addEventListener('wallet-standard:register-wallet', onRegister);
  try {
    const mod = await import('./injectSolana');
    await vi.waitFor(() => expect(bridge.solanaAvailable).toHaveBeenCalled());
    await Promise.resolve();
    return { wallets, mod };
  } finally {
    window.removeEventListener('wallet-standard:register-wallet', onRegister);
  }
}

beforeEach(() => {
  bridge.solanaAvailable.mockReset().mockResolvedValue(true);
  bridge.solanaConnect.mockReset().mockResolvedValue({ address: ADDRESS, chain: 'solana:devnet' });
  bridge.solanaSignMessage.mockReset().mockResolvedValue(new Uint8Array(64).fill(1));
});

describe('Gero Solana wallet registration', () => {
  it('registers nothing while Solana is off', async () => {
    bridge.solanaAvailable.mockResolvedValue(false);
    const { wallets } = await loadAndCollect();
    expect(wallets).toEqual([]);
  });

  it('registers once on, with what the Solana wallet adapter needs to list it', async () => {
    const { wallets } = await loadAndCollect();
    expect(wallets).toHaveLength(1);
    const [wallet] = wallets;
    expect(wallet.name).toBe('Gero');
    expect(wallet.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(wallet.chains).toEqual(['solana:mainnet', 'solana:devnet']);
    // isWalletAdapterCompatibleStandardWallet: connect + events + one of the sign-transaction features.
    for (const feature of ['standard:connect', 'standard:events', 'standard:disconnect', 'solana:signMessage', 'solana:signTransaction']) {
      expect(wallet.features[feature]).toBeTruthy();
    }
    expect(wallet.accounts).toEqual([]);
  });

  it('also registers for an app that loads after the wallet (app-ready)', async () => {
    const { mod } = await loadAndCollect();
    const late: unknown[] = [];
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: (w: unknown) => late.push(w) } }));
    // Earlier tests' module copies left their own listeners on this window; this copy answers too.
    expect(late).toContain(mod.geroSolanaWallet);
  });
});

describe('Gero Solana wallet features', () => {
  it('connects, exposing the account with its public key bytes, and tells listeners', async () => {
    const { mod } = await loadAndCollect();
    const wallet: any = mod.geroSolanaWallet;
    const changes: unknown[] = [];
    const off = wallet.features['standard:events'].on('change', (p: unknown) => changes.push(p));
    const { accounts } = await wallet.features['standard:connect'].connect({ silent: true });
    expect(bridge.solanaConnect).toHaveBeenCalledWith(true);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].address).toBe(ADDRESS);
    expect(accounts[0].publicKey).toEqual(new Uint8Array(32).fill(5));
    expect(accounts[0].chains).toEqual(['solana:devnet']);
    expect(changes).toHaveLength(1);
    off();
    await wallet.features['standard:disconnect'].disconnect();
    expect(wallet.accounts).toEqual([]);
    expect(changes).toHaveLength(1);
  });

  it('signs a message for the connected account only', async () => {
    const { mod } = await loadAndCollect();
    const wallet: any = mod.geroSolanaWallet;
    const message = new TextEncoder().encode('hello');
    await expect(wallet.features['solana:signMessage'].signMessage({ account: { address: ADDRESS }, message }))
      .rejects.toMatchObject({ code: 4100 });
    const { accounts } = await wallet.features['standard:connect'].connect();
    const [out] = await wallet.features['solana:signMessage'].signMessage({ account: accounts[0], message });
    expect(bridge.solanaSignMessage).toHaveBeenCalledWith(ADDRESS, message);
    expect(out.signedMessage).toEqual(message);
    expect(out.signature).toEqual(new Uint8Array(64).fill(1));
    expect(out.signatureType).toBe('ed25519');
  });

  it('refuses transaction signing for now, with a code', async () => {
    const { mod } = await loadAndCollect();
    await expect((mod.geroSolanaWallet as any).features['solana:signTransaction'].signTransaction({}))
      .rejects.toMatchObject({ code: 4200 });
  });

  it('passes a declined connect through as the error the relay gave', async () => {
    const declined = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    bridge.solanaConnect.mockRejectedValue(declined);
    const { mod } = await loadAndCollect();
    await expect((mod.geroSolanaWallet as any).features['standard:connect'].connect()).rejects.toBe(declined);
  });
});
