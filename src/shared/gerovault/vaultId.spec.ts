import { describe, expect, it, beforeAll } from 'vitest';
import { blake2b as sdkBlake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { deriveSharedRoleKeys } from './keys';
import { buildVaultFromRoleKeys } from './scripts';
import { NETWORK_MAGIC, VAULT_ID_TAG, vaultId, vaultIdPreimage } from './vaultId';
import { decodeRegistration, dedupeRegistrations, encodeRegistration, rebuildFromRegistration } from './registration';
import { VaultNetwork, VaultScripts } from './types';
import { publishedAccountKey, testCosignerAccount } from './__fixtures__/vectors';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors.
 * Participants: the published cardano-addresses account key and two test cosigners
 * (`testCosignerAccount(1)` and `(2)`), all at vault index 1.
 * - standard: 2 of 3.
 * - backup: owners the first two, threshold 2; backup holder the third, threshold 1, after slot 200000000.
 */
const VECTORS: Record<'standard' | 'backup', { payment: string; stake: string; ids: Record<VaultNetwork, string> }> = {
  standard: {
    payment: '15a2d7075091e8b329778f82f80706bcc7266f62a4376e8486fe9d7a',
    stake: '09b5ec2324cb6f3d0fb5fda56094b37b91b65e94325dddff2bb9fb82',
    ids: {
      mainnet: 'ada9fe79dce57df901dab74e289f8d2ad84edc38c692da3b21ff80c3ea466d49',
      preprod: '0d2d86cdfe63becafa9f7f4f88bda9c6daccc8ebb857704d964d1232e477b12e',
      preview: 'e76f639d319d1bd0bca984a0cae31a51de6dce6d3a499c013e35893711d35b2e',
    },
  },
  backup: {
    payment: '39e1063102c4f0306e8c98c889a34f55e4364a25ab760a36d1b96bb5',
    stake: '6494df150d8dcea83bfeb3a33a97b6dc2a888a87f25b9b85f659cc18',
    ids: {
      mainnet: '886de83cb99600a49c9c72c47b8aa67d95a0cfc6e9d315be6ce658063b0bf4d0',
      preprod: '5ebe48a3d3410341c98639fa35fd6f258dc2ac74c026f08fb202a9a6483b55f4',
      preview: 'b8211de50ed3f22c58e065ae89a283a459821842fb015c9089873f29319ca606',
    },
  },
};

const NETWORKS: VaultNetwork[] = ['mainnet', 'preprod', 'preview'];
let vaults: Record<'standard' | 'backup', VaultScripts>;

beforeAll(async () => {
  const people = await Promise.all([publishedAccountKey(), testCosignerAccount(1), testCosignerAccount(2)].map(async a => deriveSharedRoleKeys(await a)));
  vaults = {
    standard: await buildVaultFromRoleKeys({ template: { kind: 'standard', threshold: 2 }, owners: people, index: 1 }),
    backup: await buildVaultFromRoleKeys({
      template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
      owners: people.slice(0, 2),
      backups: [people[2]],
      index: 1,
    }),
  };
});

describe('vault identifier (provisional vectors)', () => {
  it.each(['standard', 'backup'] as const)('%s vault matches the pinned vectors on every network', kind => {
    expect(vaults[kind].payment.hash).toBe(VECTORS[kind].payment);
    expect(vaults[kind].stake.hash).toBe(VECTORS[kind].stake);
    for (const network of NETWORKS) expect(vaultId(vaults[kind], network)).toBe(VECTORS[kind].ids[network]);
  });

  it('hashes tag, 4-byte big-endian magic, payment CBOR, stake CBOR (checked with a second blake2b)', () => {
    const v = vaults.standard;
    const tag = Buffer.from(VAULT_ID_TAG, 'utf8').toString('hex');
    expect(tag).toBe('6765726f2d7661756c742f76317c6e61746976657c');
    const magic = { mainnet: '2d964a09', preprod: '00000001', preview: '00000002' };
    for (const network of NETWORKS) {
      expect(NETWORK_MAGIC[network].toString(16).padStart(8, '0')).toBe(magic[network]);
      const preimage = `${tag}${magic[network]}${v.payment.cbor}${v.stake.cbor}`;
      expect(vaultIdPreimage(v, network)).toBe(preimage);
      expect(vaultId(v, network)).toBe(sdkBlake2b.hash(HexBlob(preimage), 32));
    }
  });

  it('preprod and preview give different identifiers for the same scripts', () => {
    expect(vaultId(vaults.standard, 'preprod')).not.toBe(vaultId(vaults.standard, 'preview'));
  });

  it('does not depend on a registration: two registrations of the same scripts are one vault', async () => {
    const a = encodeRegistration(vaults.standard, { name: 'One' });
    const b = encodeRegistration(vaults.standard, { name: 'Another name, published by someone else' });
    const decoded = [a, b].map(e => decodeRegistration({ metadata: { cbor: e.offChain.metadata }, nativeScripts: { cbor: e.offChain.native_scripts } }));
    const regs = decoded.map(d => (d.ok === true ? d.registration : undefined));
    expect(dedupeRegistrations(regs)).toEqual([regs[0]]);
    const people = await Promise.all([publishedAccountKey(), testCosignerAccount(1), testCosignerAccount(2)].map(async x => deriveSharedRoleKeys(await x)));
    const rebuilt = await Promise.all(regs.map(r => rebuildFromRegistration(r, people)));
    const ids = rebuilt.map(r => (r.ok === true ? vaultId(r.vault, 'preprod') : undefined));
    expect(ids).toEqual([VECTORS.standard.ids.preprod, VECTORS.standard.ids.preprod]);
  });

  it('refuses an unknown network or a missing script', () => {
    // @ts-expect-error: not a vault network.
    expect(() => vaultId(vaults.standard, 'sanchonet')).toThrow(expect.objectContaining({ code: 'UNKNOWN_NETWORK' }));
    expect(() => vaultId({ payment: vaults.standard.payment, stake: undefined }, 'preprod'))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_TEMPLATE' }));
  });
});
