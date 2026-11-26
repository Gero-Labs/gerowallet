/**
 * Published test vectors. Nothing here is a real wallet: every key comes from a public test
 * suite or is generated from a fixed test entropy.
 *
 * - CIP-1854 "User-facing encoding" example (cardano-foundation/CIPs, CIP-1854/README.md).
 * - cardano-addresses (IntersectMBO/cardano-addresses), the reference implementation of
 *   CIP-1854 shared keys:
 *   - docs/command-line.md, "How to generate a payment verification key for shared wallet" and
 *     "How to construct a multisig script hash": the root key, the account key at
 *     1854H/1815H/0H, the keys at 0/0, 0/1, 0/2 and 2/0, and the hash of `all [0/1, 0/2]`.
 *   - test/Command/Script/HashSpec.hs: script hashes over `verKeyH1..H4`, which are the hashes
 *     of the keys at 0/1..0/4 under the root above.
 *   - test/Command/Address/DelegationSpec.hs: a base address whose stake part is the script
 *     `all [stake_shared_vkh1nqc...]`, the hash of the key at 2/0 under the root above.
 * - CIP-83 "Encryption/Decryption example on the console - basic mode" (CIP-0083/README.md).
 */
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import { MultisigAccountPublicKey } from '../types';
import { multisigAccountPublicKey } from '../keys';

export const CIP1854_ENCODING_EXAMPLE = {
  base16:
    '179be1ac9e63abb5fe4666df03007b0733a3b63cdd08cd3635b8d364e16aaf2649856f2ba513786afdbe5c7a07565c029ba7a4290d20aa3c80ecc1835841ed78',
  bech32:
    'addr_shared_xvk1z7d7rty7vw4mtljxvm0sxqrmque68d3um5yv6d34hrfkfct24unynpt09wj3x7r2lkl9c7s82ewq9xa85s5s6g928jqwesvrtpq767qs66fnu',
};

export const CARDANO_ADDRESSES = {
  rootXsk:
    'root_shared_xsk1hqzfzrgskgnpwskxxrv5khs7ess82ecy8za9l5ef7e0afd2849p3zryje8chk39nxtva0sww5me3pzkej4rvd5cae3q3v8eu7556n6pdrp4fdu8nsglynpmcppxxvfdyzdz5gfq3fefjepxhvqspmuyvmvzteqlc',
  acctXsk:
    'acct_shared_xsk14zh0kh0geaz9qpxv6q0n5upq8ux4n97u2gyl69mnhan74w6849pa3hj2p40xg0nugw8tzqu5eynzjunay6tffru9wdjank0phsfuc7vngjsmtktel05g6mx555tw8nxr8rpn2gac6km5plu9mwqsz54rfyhwd7pd',
  vk: {
    '0/0': 'addr_shared_vk1a9h46rvjnqquxz02zyesh0ct29szh7vv9x7r2h87ttmnkgrfgguqhz0mtc',
    '0/1': 'addr_shared_vk1wgj79fxw2vmxkp85g88nhwlflkxevd77t6wy0nsktn2f663wdcmqcd4fp3',
    '0/2': 'addr_shared_vk1jthguyss2vffmszq63xsmxlpc9elxnvdyaqk7susl4sppp2s9xqsuszh44',
    '2/0': 'stake_shared_vk18a8z5dcrlwene88n84j6dm9yvj5rt296fjtresqnunmacetdcymquyq43z',
  },
  xvk: {
    '0/1': 'addr_shared_xvk1wgj79fxw2vmxkp85g88nhwlflkxevd77t6wy0nsktn2f663wdcmqhlfft3dn0qcn6q99dvlfl2ws5duy6w65zks5jgufe60fg839sysavl5pc',
    '0/2': 'addr_shared_xvk1jthguyss2vffmszq63xsmxlpc9elxnvdyaqk7susl4sppp2s9xq3zegcxtslhpghmadrlvsphssfjqp3mxg9gca27e35wpu43lqjqnsmjvxuw',
  },
  vkh: {
    '0/1': 'addr_shared_vkh1zxt0uvrza94h3hv4jpv0ttddgnwkvdgeyq8jf9w30mcs6y8w3nq',
    '0/2': 'addr_shared_vkh1y3zl4nqgm96ankt96dsdhc86vd5geny0wr7hu8cpzdfcqskq2cp',
    '0/3': 'addr_shared_vkh175wsm9ckhm3snwcsn72543yguxeuqm7v9r6kl6gx57h8gdydcd9',
    '0/4': 'addr_shared_vkh1fee6yrlnczhfp77ftunc6snjrv0hv0s92qj2pe47dt4hz8ajp6a',
    '2/0': 'stake_shared_vkh1nqc00hvlc6cq0sfhretk0rmzw8dywmusp8retuqnnxzajtzhjg5',
  },
  /** `script hash` goldens; H1..H4 are the key hashes at 0/1..0/4. */
  scriptHashes: {
    'all [H1, H2]': 'script1gr69m385thgvkrtspk73zmkwk537wxyxuevs2u9cukglvtlkz4k',
    'all [H1, H2, H3]': 'script1s7uwytqrwv63wp8e8cu7jz7j0nmqfcw3lmeh8u8dujmkvafpkpf',
    'any [H1, H2, H3]': 'script1wnsgkncprsznm9smhc6x9h2gms3dn7kyx5g549hjueussc5twaa',
    'at_least 1 [H1, H2, H3]': 'script1vw9etsd8d52dndc4aqkgpp23pmj2j9u29dayed494dyngpc9rsv',
    'at_least 1 [H1, all [H2, H3]]': 'script1hwv9dxq42uqy34las3gvhxg3s45n8vtzn74wjq6ungpp7xg86mh',
    'at_least 1 [H1, H2, active_from 10, active_until 25]': 'script1ltujlnyeee7j5ujgjjw6taqc9vqlaj63ws75ttpfzxq9557zuzv',
  },
  /** Base address: CIP-1852 payment key of another test phrase, stake script `all [2/0 key hash]`. */
  delegationAddress: 'addr1y9therz8fgux9ywdysrcpaclznyyvl23l2zfcery3f4m9qfe5nnvf2a5vzmvdfhda0yw08qrj32kn4ytx2l7xpd08l7q0xlqfx',
};

export const CIP83_EXAMPLE = {
  plaintext: '["Invoice-No: 123456789","Order-No: 7654321","Email: john@doe.com"]',
  chunks: [
    'U2FsdGVkX1/5Y0A7l8xK686rvLsmPviTlna2n3P/ADNm89Ynr1UPZ/Q6bynbe28Y',
    '/zWYOB9PAGt+bq1L0z/W2LNHe92HTN/Fwz16aHa98TOsgM3q8tAR4NSqrLZVu1H7',
  ],
};

export function bech32Bytes(value: string): Uint8Array {
  return Uint8Array.from(bech32.fromWords(bech32.decode(value, 1023).words));
}

export function bech32Hex(value: string): string {
  return Buffer.from(bech32Bytes(value)).toString('hex');
}

const HARDENED = 0x80000000;

/** Test only: the multisig account key of a root, `m/1854'/1815'/0'`. */
export async function accountKeyOfRoot(root: Bip32PrivateKey): Promise<MultisigAccountPublicKey> {
  await ready();
  return multisigAccountPublicKey(root.derive([HARDENED + 1854, HARDENED + 1815, HARDENED]).toPublic().hex());
}

/** Test only: the published cardano-addresses account key, made public. */
export async function publishedAccountKey(): Promise<MultisigAccountPublicKey> {
  await ready();
  return multisigAccountPublicKey(Bip32PrivateKey.fromBytes(bech32Bytes(CARDANO_ADDRESSES.acctXsk)).toPublic().hex());
}

/** Test only: a cosigner generated from a fixed entropy byte, standing in for another person. */
export async function testCosignerAccount(seed: number): Promise<MultisigAccountPublicKey> {
  await ready();
  return accountKeyOfRoot(Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, seed), ''));
}
