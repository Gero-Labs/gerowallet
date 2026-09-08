// Covers the rule that decides whether a restore is a duplicate:
// same chain AND same network AND same derived public key.
import { describe, it, expect } from 'vitest';
import { Blockchain, Network } from '@/models/types';
import { findDuplicateWallet, isSameWalletIdentity, toWalletIdentity } from '@/db/walletIdentity';

const CARDANO_XPUB = 'xpub1w0zjhrn6n3zvfnzhk8xkgvhy0ehmv8yvgqe4t2ah7q3p9r6l0d2xkq7v0m4';
const OTHER_CARDANO_XPUB = 'xpub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const BITCOIN_XPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

function cardano(overrides: Partial<{ id: number; name: string; chain: string; network: string; publicKey: string }> = {}) {
  return {
    id: 1,
    name: 'My Wallet',
    chain: Blockchain.CARDANO,
    network: Network.MAINNET,
    publicKey: CARDANO_XPUB,
    ...overrides,
  };
}

describe('toWalletIdentity', () => {
  it('folds bech32 case for Cardano (bech32 is case-insensitive)', () => {
    expect(toWalletIdentity(cardano({ publicKey: CARDANO_XPUB.toUpperCase() })).key)
      .toBe(CARDANO_XPUB.toLowerCase());
  });

  it('preserves case for Bitcoin (base58 is case-significant)', () => {
    const identity = toWalletIdentity({
      chain: Blockchain.BITCOIN, network: Network.MAINNET, publicKey: BITCOIN_XPUB,
    });
    expect(identity.key).toBe(BITCOIN_XPUB);
  });

  it('reads the unshielded address out of the Midnight address blob', () => {
    const identity = toWalletIdentity({
      chain: Blockchain.MIDNIGHT,
      network: Network.MAINNET,
      publicKey: JSON.stringify({ unshielded: 'mn_addr_test1abc', shielded: 's', dust: 'd' }),
    });
    expect(identity.key).toBe('mn_addr_test1abc');
  });

  it('has no identity when the public key is missing, empty, or unparsable', () => {
    expect(toWalletIdentity({ chain: Blockchain.CARDANO, network: Network.MAINNET }).key).toBeNull();
    expect(toWalletIdentity(cardano({ publicKey: '   ' })).key).toBeNull();
    expect(toWalletIdentity({
      chain: Blockchain.MIDNIGHT, network: Network.MAINNET, publicKey: 'not-json',
    }).key).toBeNull();
    expect(toWalletIdentity({
      chain: Blockchain.MIDNIGHT,
      network: Network.MAINNET,
      publicKey: JSON.stringify({ unshielded: '', shielded: '', dust: '' }),
    }).key).toBeNull();
  });
});

describe('isSameWalletIdentity', () => {
  it('matches the same seed on the same chain and network', () => {
    expect(isSameWalletIdentity(
      toWalletIdentity(cardano()),
      toWalletIdentity(cardano({ id: 2, name: 'Renamed' })),
    )).toBe(true);
  });

  it('never matches an unknown identity against itself', () => {
    const unknown = toWalletIdentity({ chain: Blockchain.MIDNIGHT, network: Network.MAINNET, publicKey: 'not-json' });
    expect(isSameWalletIdentity(unknown, unknown)).toBe(false);
  });
});

describe('findDuplicateWallet', () => {
  it('detects a re-restore of the same seed regardless of wallet name', () => {
    const stored = [cardano({ id: 7, name: 'Original name' })];
    const match = findDuplicateWallet(cardano({ name: 'Totally different name' }), stored);
    expect(match?.id).toBe(7);
  });

  it('accepts the id-keyed map that getAllWallets() returns', () => {
    const stored = { 7: cardano({ id: 7 }), 8: cardano({ id: 8, publicKey: OTHER_CARDANO_XPUB }) };
    expect(findDuplicateWallet(cardano(), stored)?.id).toBe(7);
  });

  it('allows the same seed on a different network of the same chain', () => {
    const stored = [cardano({ network: Network.MAINNET })];
    expect(findDuplicateWallet(cardano({ network: Network.PREPROD }), stored)).toBeNull();
  });

  it('allows the same seed on a different chain', () => {
    // Cardano and the Apex Fusion chains share the CIP-1852 xpub, so the chain
    // dimension is the only thing keeping them apart.
    const stored = [cardano({ chain: Blockchain.CARDANO })];
    expect(findDuplicateWallet(cardano({ chain: Blockchain.APEX_PRIME }), stored)).toBeNull();
  });

  it('allows a Bitcoin restore of a seed already restored on Cardano', () => {
    const stored = [cardano()];
    const btc = { chain: Blockchain.BITCOIN, network: Network.MAINNET, publicKey: BITCOIN_XPUB };
    expect(findDuplicateWallet(btc, stored)).toBeNull();
  });

  it('detects a duplicate Bitcoin restore', () => {
    const stored = [{ id: 3, name: 'BTC', chain: Blockchain.BITCOIN, network: Network.MAINNET, publicKey: BITCOIN_XPUB }];
    const match = findDuplicateWallet(
      { chain: Blockchain.BITCOIN, network: Network.MAINNET, publicKey: BITCOIN_XPUB },
      stored,
    );
    expect(match?.id).toBe(3);
  });

  it('detects a duplicate Midnight restore even when the blob key order differs', () => {
    const stored = [{
      id: 4,
      name: 'Midnight',
      chain: Blockchain.MIDNIGHT,
      network: Network.MAINNET,
      publicKey: JSON.stringify({ dust: 'd', shielded: 's', unshielded: 'mn_addr_test1abc' }),
    }];
    const match = findDuplicateWallet({
      chain: Blockchain.MIDNIGHT,
      network: Network.MAINNET,
      publicKey: JSON.stringify({ unshielded: 'mn_addr_test1abc', shielded: 's', dust: 'd' }),
    }, stored);
    expect(match?.id).toBe(4);
  });

  it('treats a wallet with no stored public key as not comparable', () => {
    const stored = [{ id: 5, name: 'Hardware', chain: Blockchain.CARDANO, network: Network.MAINNET }];
    expect(findDuplicateWallet(cardano(), stored)).toBeNull();
  });

  it('returns null for an empty or missing wallet set', () => {
    expect(findDuplicateWallet(cardano(), [])).toBeNull();
    expect(findDuplicateWallet(cardano(), null)).toBeNull();
  });
});
