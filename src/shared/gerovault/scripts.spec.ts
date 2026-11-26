// @vitest-environment node
/**
 * Script CBOR, hashes and addresses, each checked against a source other than this code:
 * - golden hashes published by cardano-addresses (the CIP-1854 reference implementation),
 * - cardano-serialization-lib (Rust, compiled to WASM: an independent CBOR encoder, hasher and
 *   address builder, in the dependency tree through @trezor/connect-core),
 * - CBOR assembled by hand from the ledger CDDL:
 *     native_script = [0, addr_keyhash] / [1, [*native_script]] / [2, [*native_script]]
 *                   / [3, uint, [*native_script]] / [4, slot] / [5, slot]
 * cardano-cli and cardano-address are not installed on the machine these were written on.
 */
import { describe, expect, it } from 'vitest';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import {
  MAX_OWNERS,
  buildVaultFromRoleKeys,
  buildVaultScripts,
  instantiateVaultScripts,
  parseVaultScript,
  validateVaultSpec,
  vaultAddresses,
  vaultSpecWarnings,
  vaultScript,
  VaultSpec,
} from './scripts';
import { deriveParticipantKeyHashes, deriveSharedRoleKeys } from './keys';
import { ParticipantKeyHashes, ROLE, VaultNetwork } from './types';
import { CARDANO_ADDRESSES, bech32Hex, publishedAccountKey, testCosignerAccount } from './__fixtures__/vectors';

const H = (n: 1 | 2 | 3 | 4) => Ed25519KeyHashHex(bech32Hex(CARDANO_ADDRESSES.vkh[`0/${n}`]));
const STAKE0 = Ed25519KeyHashHex(bech32Hex(CARDANO_ADDRESSES.vkh['2/0']));
const scriptBech32 = (hash: string) => bech32.encode('script', bech32.toWords(Buffer.from(hash, 'hex')));

const native = Cardano.ScriptType.Native;
const K = Cardano.NativeScriptKind;
const sig = (keyHash: Ed25519KeyHashHex): Cardano.NativeScript => ({ __type: native, kind: K.RequireSignature, keyHash });

/** Fake but well-formed key hashes, for shape tests that need many distinct keys. */
const fakeHash = (role: number, i: number) => Ed25519KeyHashHex(`${role}${i.toString(16).padStart(3, '0')}`.padEnd(56, 'a'));
const fake = (i: number): ParticipantKeyHashes => ({ payment: fakeHash(1, i), stake: fakeHash(2, i) });

function cslScript(cborHex: string) {
  return CSL.NativeScript.from_hex(cborHex);
}

function cslAtLeast(n: number, keys: readonly string[]) {
  const list = CSL.NativeScripts.new();
  for (const k of keys) list.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(CSL.Ed25519KeyHash.from_hex(k))));
  return CSL.NativeScript.new_script_n_of_k(CSL.ScriptNOfK.new(n, list));
}

function cslBackup(t: number, owners: readonly string[], b: number, backups: readonly string[], slot: number) {
  const inner = CSL.NativeScripts.new();
  inner.add(cslAtLeast(b, backups));
  inner.add(CSL.NativeScript.new_timelock_start(CSL.TimelockStart.new_timelockstart(CSL.BigNum.from_str(String(slot)))));
  const outer = CSL.NativeScripts.new();
  outer.add(cslAtLeast(t, owners));
  outer.add(CSL.NativeScript.new_script_all(CSL.ScriptAll.new(inner)));
  return CSL.NativeScript.new_script_any(CSL.ScriptAny.new(outer));
}

describe('script hashes against the cardano-addresses goldens', () => {
  const cases: [keyof typeof CARDANO_ADDRESSES.scriptHashes, Cardano.NativeScript][] = [
    ['all [H1, H2]', { __type: native, kind: K.RequireAllOf, scripts: [sig(H(1)), sig(H(2))] }],
    ['all [H1, H2, H3]', { __type: native, kind: K.RequireAllOf, scripts: [sig(H(1)), sig(H(2)), sig(H(3))] }],
    ['any [H1, H2, H3]', { __type: native, kind: K.RequireAnyOf, scripts: [sig(H(1)), sig(H(2)), sig(H(3))] }],
    ['at_least 1 [H1, H2, H3]', { __type: native, kind: K.RequireNOf, required: 1, scripts: [sig(H(1)), sig(H(2)), sig(H(3))] }],
    ['at_least 1 [H1, all [H2, H3]]', {
      __type: native, kind: K.RequireNOf, required: 1,
      scripts: [sig(H(1)), { __type: native, kind: K.RequireAllOf, scripts: [sig(H(2)), sig(H(3))] }],
    }],
    ['at_least 1 [H1, H2, active_from 10, active_until 25]', {
      __type: native, kind: K.RequireNOf, required: 1,
      scripts: [
        sig(H(1)), sig(H(2)),
        { __type: native, kind: K.RequireTimeAfter, slot: Cardano.Slot(10) },
        { __type: native, kind: K.RequireTimeBefore, slot: Cardano.Slot(25) },
      ],
    }],
  ];

  it.each(cases)('%s', (name, script) => {
    const s = vaultScript(ROLE.PAYMENT, script);
    expect(scriptBech32(s.hash)).toBe(CARDANO_ADDRESSES.scriptHashes[name]);
    expect(cslScript(s.cbor).hash().to_hex()).toBe(s.hash);
  });

  it('the stake script all [2/0] is the stake part of the published delegation address', () => {
    const stake = vaultScript(ROLE.STAKE, { __type: native, kind: K.RequireAllOf, scripts: [sig(STAKE0)] });
    const address = Cardano.Address.fromBech32(CARDANO_ADDRESSES.delegationAddress).asBase();
    expect(address.getStakeCredential()).toEqual({ type: Cardano.CredentialType.ScriptHash, hash: stake.hash });
  });
});

describe('vault scripts', () => {
  const owners = [H(1), H(2), H(3)].map((payment, i) => ({ payment, stake: fakeHash(2, i) }));

  it('standard 2-of-3: matches a hand-assembled CBOR fixture and CSL', () => {
    const vault = buildVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners });
    expect(vault.payment.cbor).toBe(`830302838200581c${H(1)}8200581c${H(2)}8200581c${H(3)}`);
    expect(vault.payment.cbor).toBe(cslAtLeast(2, [H(1), H(2), H(3)]).to_hex());
    expect(vault.payment.hash).toBe(cslScript(vault.payment.cbor).hash().to_hex());
    expect(vault.stake.cbor).toBe(cslAtLeast(2, owners.map(o => o.stake).sort()).to_hex());
    expect(parseVaultScript(vault.payment.script)).toEqual({ kind: 'standard', threshold: 2, owners: [H(1), H(2), H(3)] });
  });

  it('dated backup: any [atLeast 2 owners, all [atLeast 1 backup, after 1000]] matches hand CBOR and CSL', () => {
    const vault = buildVaultScripts({
      template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 1000 },
      owners: [{ payment: H(2), stake: fakeHash(2, 2) }, { payment: H(1), stake: fakeHash(2, 1) }],
      backups: [{ payment: H(3), stake: fakeHash(2, 3) }],
    });
    const hand = `8202` + `82` + `830302828200581c${H(1)}8200581c${H(2)}` + `8201` + `82` + `830301818200581c${H(3)}` + `82041903e8`;
    expect(vault.payment.cbor).toBe(hand);
    expect(vault.payment.cbor).toBe(cslBackup(2, [H(1), H(2)], 1, [H(3)], 1000).to_hex());
    expect(vault.payment.hash).toBe(cslScript(hand).hash().to_hex());
    expect(vault.stake.cbor).toBe(cslBackup(2, [fakeHash(2, 1), fakeHash(2, 2)], 1, [fakeHash(2, 3)], 1000).to_hex());
    expect(parseVaultScript(vault.stake.script)).toEqual({
      kind: 'backup', threshold: 2, owners: [fakeHash(2, 1), fakeHash(2, 2)],
      backupThreshold: 1, backups: [fakeHash(2, 3)], backupAfterSlot: 1000,
    });
  });

  it('the standard template carries no time bound', () => {
    const vault = buildVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners });
    expect(vault.payment.cbor).not.toMatch(/8204|8205/);
    expect(JSON.stringify(vault.stake.script)).not.toContain('"slot"');
  });

  it('every cosigner gets the same bytes whatever order the keys are given in', () => {
    const a = buildVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners });
    const b = buildVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners: [...owners].reverse() });
    expect(b.payment.cbor).toBe(a.payment.cbor);
    expect(b.stake.cbor).toBe(a.stake.cbor);
  });

  it('instantiateVaultScripts keeps a given order and refuses an order naming other keys', () => {
    const spec: VaultSpec = { template: { kind: 'standard', threshold: 2 }, owners };
    const reversed = instantiateVaultScripts(spec, {
      payment: { owners: [H(3), H(2), H(1)], backups: [] },
      stake: { owners: owners.map(o => o.stake), backups: [] },
    });
    expect(reversed.payment.cbor).toBe(cslAtLeast(2, [H(3), H(2), H(1)]).to_hex());
    expect(() => instantiateVaultScripts(spec, {
      payment: { owners: [H(3), H(2), H(4)], backups: [] },
      stake: { owners: owners.map(o => o.stake), backups: [] },
    })).toThrow(expect.objectContaining({ code: 'INVALID_KEY_HASH' }));
  });

  it('parseVaultScript recognises nothing but the two templates', () => {
    expect(parseVaultScript({ __type: native, kind: K.RequireAllOf, scripts: [sig(H(1)), sig(H(2))] })).toBeUndefined();
    expect(parseVaultScript({ __type: native, kind: K.RequireNOf, required: 0, scripts: [sig(H(1))] })).toBeUndefined();
    expect(parseVaultScript({ __type: native, kind: K.RequireNOf, required: 1, scripts: [] })).toBeUndefined();
    expect(parseVaultScript({
      __type: native, kind: K.RequireNOf, required: 1,
      scripts: [sig(H(1)), { __type: native, kind: K.RequireTimeBefore, slot: Cardano.Slot(9) }],
    })).toBeUndefined();
  });
});

describe('vault addresses', () => {
  const vault = buildVaultScripts({
    template: { kind: 'standard', threshold: 2 },
    owners: [1, 2, 3].map(fake),
  });

  it.each<[VaultNetwork, number, string, string]>([
    ['mainnet', 1, 'addr1', 'stake1'],
    ['preprod', 0, 'addr_test1', 'stake_test1'],
    ['preview', 0, 'addr_test1', 'stake_test1'],
  ])('%s base and reward addresses match CSL', (network, id, addrPrefix, stakePrefix) => {
    const { base, reward } = vaultAddresses(vault, network);
    const pay = CSL.Credential.from_scripthash(CSL.ScriptHash.from_hex(vault.payment.hash));
    const stake = CSL.Credential.from_scripthash(CSL.ScriptHash.from_hex(vault.stake.hash));
    expect(base).toBe(CSL.BaseAddress.new(id, pay, stake).to_address().to_bech32(undefined));
    expect(reward).toBe(CSL.RewardAddress.new(id, stake).to_address().to_bech32(undefined));
    expect(base.startsWith(addrPrefix)).toBe(true);
    expect(reward.startsWith(stakePrefix)).toBe(true);
    // Header nibbles: base address with script payment and script stake is type 3, reward script is 15.
    expect(Cardano.Address.fromBech32(base).toBytes().slice(0, 2)).toBe(`3${id}`);
    expect(Cardano.Address.fromBech32(reward).toBytes().slice(0, 2)).toBe(`f${id}`);
  });

  it('refuses an unknown network', () => {
    // @ts-expect-error: not a vault network.
    expect(() => vaultAddresses(vault, 'sanchonet')).toThrow(expect.objectContaining({ code: 'UNKNOWN_NETWORK' }));
  });
});

describe('vaults from role keys', () => {
  it('uses every participant key at the same index, role 0 for payment and role 2 for stake', async () => {
    const people = await Promise.all([publishedAccountKey(), testCosignerAccount(1), testCosignerAccount(2)].map(async a => deriveSharedRoleKeys(await a)));
    const vault = await buildVaultFromRoleKeys({ template: { kind: 'standard', threshold: 2 }, owners: people, index: 5 });
    const expected = await Promise.all(people.map(p => deriveParticipantKeyHashes(p, 5)));
    expect(new Set(parseVaultScript(vault.payment.script).owners)).toEqual(new Set(expected.map(e => e.payment)));
    expect(new Set(parseVaultScript(vault.stake.script).owners)).toEqual(new Set(expected.map(e => e.stake)));
    await expect(buildVaultFromRoleKeys({ template: { kind: 'standard', threshold: 2 }, owners: people, index: -1 }))
      .rejects.toMatchObject({ code: 'INVALID_INDEX' });
  });
});

describe('validation', () => {
  const ok = [1, 2, 3].map(fake);
  const backup = (over: Partial<{ threshold: number; backupThreshold: number; backupAfterSlot: number }> = {}) =>
    ({ kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 10, ...over }) as const;
  const cases: [string, VaultSpec][] = [
    ['UNKNOWN_TEMPLATE', { template: { kind: 'plutus' } as never, owners: ok }],
    ['TOO_FEW_OWNERS', { template: { kind: 'standard', threshold: 2 }, owners: [] }],
    ['TOO_FEW_OWNERS', { template: { kind: 'standard', threshold: 2 }, owners: [fake(1)] }],
    ['TOO_MANY_OWNERS', { template: { kind: 'standard', threshold: 2 }, owners: Array.from({ length: MAX_OWNERS + 1 }, (_, i) => fake(i)) }],
    ['THRESHOLD_TOO_LOW', { template: { kind: 'standard', threshold: 1 }, owners: ok }],
    ['THRESHOLD_TOO_LOW', { template: { kind: 'standard', threshold: 0 }, owners: ok }],
    ['THRESHOLD_TOO_LOW', { template: backup({ threshold: 1 }), owners: ok, backups: [fake(9)] }],
    ['THRESHOLD_OUT_OF_RANGE', { template: { kind: 'standard', threshold: 4 }, owners: ok }],
    ['THRESHOLD_OUT_OF_RANGE', { template: { kind: 'standard', threshold: 2.5 }, owners: ok }],
    ['INVALID_KEY_HASH', { template: { kind: 'standard', threshold: 2 }, owners: [{ payment: 'zz' as Ed25519KeyHashHex, stake: fakeHash(2, 1) }, fake(2)] }],
    ['INVALID_KEY_HASH', { template: { kind: 'standard', threshold: 2 }, owners: [{ payment: H(1).toUpperCase() as Ed25519KeyHashHex, stake: fakeHash(2, 1) }, fake(2)] }],
    ['DUPLICATE_KEY', { template: { kind: 'standard', threshold: 2 }, owners: [fake(1), fake(1), fake(2)] }],
    ['DUPLICATE_KEY', { template: { kind: 'standard', threshold: 2 }, owners: [fake(1), { payment: fakeHash(1, 2), stake: fakeHash(2, 1) }, fake(3)] }],
    ['UNEXPECTED_BACKUP_KEYS', { template: { kind: 'standard', threshold: 2 }, owners: ok, backups: [fake(9)] }],
    ['BACKUP_KEYS_REQUIRED', { template: backup(), owners: ok }],
    ['TOO_MANY_BACKUP_KEYS', { template: backup(), owners: ok, backups: Array.from({ length: 21 }, (_, i) => fake(100 + i)) }],
    ['BACKUP_THRESHOLD_OUT_OF_RANGE', { template: backup({ backupThreshold: 2 }), owners: ok, backups: [fake(9)] }],
    ['BACKUP_THRESHOLD_OUT_OF_RANGE', { template: backup({ backupThreshold: 0 }), owners: ok, backups: [fake(9)] }],
    ['BACKUP_SLOT_REQUIRED', { template: { kind: 'backup', threshold: 2, backupThreshold: 1 } as never, owners: ok, backups: [fake(9)] }],
    ['BACKUP_SLOT_REQUIRED', { template: backup({ backupAfterSlot: 0 }), owners: ok, backups: [fake(9)] }],
    ['BACKUP_SLOT_REQUIRED', { template: backup({ backupAfterSlot: -5 }), owners: ok, backups: [fake(9)] }],
    ['BACKUP_OVERLAPS_OWNER', { template: backup(), owners: ok, backups: [fake(2)] }],
    ['BACKUP_OVERLAPS_OWNER', { template: backup(), owners: ok, backups: [{ payment: fakeHash(1, 9), stake: fakeHash(2, 1) }] }],
  ];

  it.each(cases)('%s', (code, spec) => {
    expect(() => validateVaultSpec(spec)).toThrow(expect.objectContaining({ code }));
    expect(() => buildVaultScripts(spec)).toThrow(expect.objectContaining({ code }));
  });

  it('M = N without a backup path is a warning the caller must acknowledge', () => {
    const twoOfTwo: VaultSpec = { template: { kind: 'standard', threshold: 2 }, owners: [fake(1), fake(2)] };
    expect(vaultSpecWarnings(twoOfTwo)).toEqual(['ALL_OWNERS_REQUIRED']);
    expect(() => buildVaultScripts(twoOfTwo)).toThrow(expect.objectContaining({ code: 'WARNING_NOT_ACKNOWLEDGED' }));
    expect(buildVaultScripts(twoOfTwo, { acknowledged: ['ALL_OWNERS_REQUIRED'] }).warnings).toEqual(['ALL_OWNERS_REQUIRED']);
    const twenty: VaultSpec = { template: { kind: 'standard', threshold: MAX_OWNERS }, owners: Array.from({ length: MAX_OWNERS }, (_, i) => fake(i)) };
    expect(() => buildVaultScripts(twenty, { acknowledged: ['ALL_OWNERS_REQUIRED'] })).not.toThrow();
  });

  it('M = N with a backup path, or M < N, carries no warning', () => {
    const withBackup: VaultSpec = { template: backup(), owners: [fake(1), fake(2)], backups: [fake(9)] };
    expect(vaultSpecWarnings(withBackup)).toEqual([]);
    expect(buildVaultScripts(withBackup).warnings).toEqual([]);
    expect(buildVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners: ok }).warnings).toEqual([]);
  });
});
