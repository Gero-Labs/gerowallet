// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bech32, bech32m } from 'bech32';
import { DustSecretKey, ZswapSecretKeys } from '@midnightntwrk/ledger-v9';
import {
  DustAddress,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { Blockchain, Network } from '@/models/types';
import { canReplaceWalletKey, isSameWalletKey } from '@/db/walletIdentity';
import { deriveMidnightKeys, type MidnightDerivedKeys } from './midnightKeyManager';
import { midnightKeystore, schnorrHex } from './midnightLedger';
import { withoutViewingKey } from './midnightRecordScrub';
import {
  RETIRED_STAGENET,
  previewContactAddress,
  previewMoveOf,
  previewPublicKey,
  stagenetToPreviewAddress,
} from './midnightPreviewMove';

// The Cardano twin is network-independent on every testnet and not what this
// spec is about; deriving it would initialize browser stores. Fail if called.
vi.mock('@/shared/utils/resolver', () => ({
  resolvePrivateKey: () => { throw new Error('Cardano derivation must be skipped'); },
}));
vi.mock('@/chrome/serialization', () => ({
  getAddress: () => { throw new Error('Cardano derivation must be skipped'); },
  getPaymentKeyExternal: () => { throw new Error('Cardano derivation must be skipped'); },
  getRewardAddress: () => { throw new Error('Cardano derivation must be skipped'); },
}));

// Public BIP39 test vector; never fund these wallets.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/**
 * The record a Stagenet wallet stored before the move: the addresses the wallet
 * derived with the SDK network id `stagenet` (what midnightKeyManager did for
 * Stagenet, through the SDK's pass-through of unknown network ids), serialized
 * as `createNewWallet` stores them.
 */
async function stagenetRecordAddresses(derived: MidnightDerivedKeys): Promise<Record<string, unknown>> {
  const keystore = await midnightKeystore(derived.unshieldedSecretKey, 'stagenet');
  const dustSk = DustSecretKey.fromSeed(derived.dustSecretKey);
  const zswap = ZswapSecretKeys.fromSeed(derived.zswapSecretKey);
  try {
    return withoutViewingKey({
      ...derived.addresses,
      unshielded: keystore.getBech32Address().toString(),
      shielded: ShieldedAddress.codec.encode('stagenet', new ShieldedAddress(
        new ShieldedCoinPublicKey(Buffer.from(zswap.coinPublicKey, 'hex')),
        new ShieldedEncryptionPublicKey(Buffer.from(zswap.encryptionPublicKey, 'hex')),
      )).toString(),
      dust: DustAddress.encodePublicKey('stagenet', dustSk.publicKey),
      publicKeyHex: schnorrHex(keystore.getPublicKey()),
      addressHex: keystore.getAddress() as unknown as string,
    }) as unknown as Record<string, unknown>;
  } finally {
    dustSk.clear();
    zswap.clear();
  }
}

const wipe = (derived: MidnightDerivedKeys) => {
  derived.seed.fill(0);
  derived.unshieldedSecretKey.fill(0);
  derived.dustSecretKey.fill(0);
  derived.zswapSecretKey.fill(0);
};

describe('moving a Stagenet wallet record to Preview needs no secret (issue 1453)', () => {
  let preview: MidnightDerivedKeys;
  let other: MidnightDerivedKeys;
  let stagenetAddresses: Record<string, unknown>;
  let stagenetPublicKey: string;
  let previewRecordKey: string;

  beforeAll(async () => {
    preview = await deriveMidnightKeys(MNEMONIC, Network.PREVIEW, 0, { skipCardano: true });
    other = await deriveMidnightKeys(OTHER, Network.PREVIEW, 0, { skipCardano: true });
    stagenetAddresses = await stagenetRecordAddresses(preview);
    stagenetPublicKey = JSON.stringify(stagenetAddresses);
    previewRecordKey = JSON.stringify(withoutViewingKey(preview.addresses));
  });
  afterAll(() => { wipe(preview); wipe(other); });

  it('starts from a real Stagenet record: the three addresses carry the Stagenet prefixes', () => {
    expect(stagenetAddresses['unshielded']).toMatch(/^mn_addr_stagenet1/);
    expect(stagenetAddresses['shielded']).toMatch(/^mn_shield-addr_stagenet1/);
    expect(stagenetAddresses['dust']).toMatch(/^mn_dust_stagenet1/);
    // The phrase derives Preview addresses for the same keys.
    expect(preview.addresses.unshielded).toMatch(/^mn_addr_preview1/);
  });

  it('the payloads are the same on both networks: only the prefix names the network', () => {
    for (const field of ['unshielded', 'shielded', 'dust'] as const) {
      const before = bech32m.decode(stagenetAddresses[field] as string, 1023);
      const after = bech32m.decode(preview.addresses[field], 1023);
      expect(after.words).toEqual(before.words);
      expect(after.prefix).toBe(before.prefix.replace(/_stagenet$/, '_preview'));
    }
    // The signing key and the address bytes the Nexus sidecar is given do not depend on the network.
    expect(stagenetAddresses['publicKeyHex']).toBe(preview.publicKeyHex);
    expect(stagenetAddresses['addressHex']).toBe(preview.addressHex);
  });

  it('a moved record equals what the phrase derives on Preview, field for field and in order', () => {
    const moved = previewPublicKey(stagenetPublicKey)!;
    expect(moved).toBe(previewRecordKey);
    expect(JSON.parse(moved)).toEqual(JSON.parse(previewRecordKey));
  });

  it('so the wallet identity checks take the next re-derivation as the same account, and only after the move', () => {
    const moved = previewPublicKey(stagenetPublicKey)!;
    expect(isSameWalletKey(Blockchain.MIDNIGHT, moved, previewRecordKey)).toBe(true);
    expect(canReplaceWalletKey(Blockchain.MIDNIGHT, moved, previewRecordKey)).toBe(true);
    // Without the move, UPDATE_MIDNIGHT_PUBLIC_KEY would refuse it as another account's.
    expect(canReplaceWalletKey(Blockchain.MIDNIGHT, stagenetPublicKey, previewRecordKey)).toBe(false);
    // And a moved record never accepts another phrase's addresses.
    const otherKey = JSON.stringify(withoutViewingKey(other.addresses));
    expect(canReplaceWalletKey(Blockchain.MIDNIGHT, moved, otherKey)).toBe(false);
  });

  it('keeps every other field of the record as it was (the Cardano twin is the same on both testnets)', () => {
    const withTwin = JSON.stringify({
      ...stagenetAddresses,
      cardanoXpub: 'xpub1synthetic',
      cardanoBaseAddress: 'addr_test1synthetic',
      cardanoStakeAddress: 'stake_test1synthetic',
      cardanoPaymentKeyHashHex: 'ab'.repeat(28),
      extra: { nested: true },
    });
    const moved = JSON.parse(previewPublicKey(withTwin)!);
    expect(moved).toMatchObject({
      unshielded: preview.addresses.unshielded,
      shielded: preview.addresses.shielded,
      dust: preview.addresses.dust,
      cardanoXpub: 'xpub1synthetic',
      cardanoBaseAddress: 'addr_test1synthetic',
      cardanoStakeAddress: 'stake_test1synthetic',
      cardanoPaymentKeyHashHex: 'ab'.repeat(28),
      extra: { nested: true },
    });
    expect(Object.keys(moved)).toEqual(Object.keys(JSON.parse(withTwin)));
  });
});

describe('stagenetToPreviewAddress', () => {
  const words = bech32m.toWords(Buffer.alloc(32, 7));
  const encode = (prefix: string) => bech32m.encode(prefix, words, 1023);

  it('re-encodes each kind of Stagenet address, payload unchanged', () => {
    for (const kind of ['addr', 'shield-addr', 'dust']) {
      expect(stagenetToPreviewAddress(encode(`mn_${kind}_stagenet`))).toBe(encode(`mn_${kind}_preview`));
    }
  });

  it('is idempotent and touches no other network\'s address', () => {
    for (const prefix of ['mn_addr_preview', 'mn_addr_preprod', 'mn_addr', 'mn_shield-esk_stagenet_x', 'addr_test', 'other_addr_stagenet']) {
      expect(stagenetToPreviewAddress(encode(prefix))).toBeNull();
    }
  });

  it('refuses anything that is not a valid bech32m string', () => {
    const valid = encode('mn_addr_stagenet');
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('q') ? 'p' : 'q'}`;
    for (const value of ['', 'mn_addr_stagenet1', tampered, bech32Encoded(), undefined as unknown as string, 42 as unknown as string]) {
      expect(stagenetToPreviewAddress(value)).toBeNull();
    }
  });

  function bech32Encoded(): string {
    // A bech32 (not bech32m) checksum under a Stagenet prefix is not a Midnight address.
    return bech32.encode('mn_addr_stagenet', words, 1023);
  }

  it('maps a saved contact\'s Stagenet address to Preview and leaves anything else as it is', () => {
    expect(previewContactAddress(encode('mn_addr_stagenet'))).toBe(encode('mn_addr_preview'));
    expect(previewContactAddress(encode('mn_addr'))).toBe(encode('mn_addr'));
    expect(previewContactAddress('addr_test1qq')).toBe('addr_test1qq');
  });
});

describe('previewMoveOf: which records move, and how', () => {
  const words = bech32m.toWords(Buffer.alloc(32, 3));
  const stagenet = bech32m.encode('mn_addr_stagenet', words, 1023);
  const moved = bech32m.encode('mn_addr_preview', words, 1023);
  const blob = JSON.stringify({ unshielded: stagenet, shielded: '', dust: '' });

  it('moves a Midnight Stagenet wallet to Preview and remembers its Stagenet address for the cleanup', () => {
    expect(RETIRED_STAGENET).toBe('Stagenet');
    expect(previewMoveOf({ chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: blob })).toEqual({
      network: Network.PREVIEW,
      publicKey: JSON.stringify({ unshielded: moved, shielded: '', dust: '' }),
      previewMovePending: { stagenetUnshielded: stagenet },
    });
  });

  it('leaves Cardano Preview wallets, other networks and other chains alone', () => {
    expect(previewMoveOf({ chain: Blockchain.CARDANO, network: Network.PREVIEW, publicKey: 'xpub1' })).toBeNull();
    expect(previewMoveOf({ chain: Blockchain.CARDANO, network: 'Stagenet', publicKey: 'xpub1' })).toBeNull();
    expect(previewMoveOf({ chain: Blockchain.BITCOIN, network: 'Stagenet', publicKey: 'tpub' })).toBeNull();
    for (const network of [Network.PREVIEW, Network.PREPROD, Network.MAINNET, 'stagenet']) {
      expect(previewMoveOf({ chain: Blockchain.MIDNIGHT, network, publicKey: blob })).toBeNull();
    }
    expect(previewMoveOf(null)).toBeNull();
    expect(previewMoveOf(undefined)).toBeNull();
  });

  it('is idempotent: a moved record does not move again', () => {
    const update = previewMoveOf({ chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: blob })!;
    expect(previewMoveOf({ chain: Blockchain.MIDNIGHT, ...update })).toBeNull();
    expect(previewPublicKey(update.publicKey)).toBe(update.publicKey);
  });

  it('moves the network of a record whose key cannot be read, and leaves that key as it is', () => {
    for (const publicKey of [undefined, '', 'not json', '[]', '"text"']) {
      expect(previewMoveOf({ chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey })).toEqual({
        network: Network.PREVIEW,
        previewMovePending: { stagenetUnshielded: '' },
      });
    }
  });

  it('a record from before Stagenet (still holding old Preview addresses) moves without a change of key', () => {
    const old = JSON.stringify({ unshielded: moved, shielded: '', dust: '' });
    expect(previewMoveOf({ chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: old })).toEqual({
      network: Network.PREVIEW,
      publicKey: old,
      previewMovePending: { stagenetUnshielded: moved },
    });
  });
});
