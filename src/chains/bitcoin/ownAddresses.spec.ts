import { describe, expect, it, vi } from 'vitest';

// bitcoinjs-lib is externalized to Node by Vitest and checks keys against Node's Buffer,
// while the sources get the polyfill. Hand the sources Node's Buffer too (the bundles use
// one Buffer, so the extension is unaffected).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});

import { deriveBitcoinAccountXpub, deriveBitcoinAddress } from './bitcoinKeyManager';
import { ownBitcoinAddresses } from './ownAddresses';

const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('ownBitcoinAddresses', () => {
  it('splits the account xpub\'s addresses into receive and change', () => {
    const xpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit');
    const own = ownBitcoinAddresses({ publicKey: xpub, addressType: 'segwit', network: 'Testnet' });
    expect(own.receive.has(deriveBitcoinAddress(xpub, 'Testnet', 'segwit', 0, 19))).toBe(true);
    expect(own.change.has(deriveBitcoinAddress(xpub, 'Testnet', 'segwit', 1, 0))).toBe(true);
    expect(own.receive.has(deriveBitcoinAddress(xpub, 'Testnet', 'segwit', 1, 0))).toBe(false);
  });

  it('adds synced keys and the base address, and survives a key that is not an xpub', () => {
    const own = ownBitcoinAddresses(
      { publicKey: 'not-an-xpub', network: 'Mainnet', baseAddress: 'bc1qbase' },
      { payment: [{ address: 'bc1qpay' }], change: [{ address: 'bc1qchange' }] },
    );
    expect([...own.receive]).toEqual(['bc1qpay', 'bc1qbase']);
    expect([...own.change]).toEqual(['bc1qchange']);
  });
});
