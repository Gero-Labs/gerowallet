// The recovery screens' pure parts: the passphrase rules as the screen shapes them, the export
// mark behind the staleness reminder, the script as the review prints it, and the chain facts.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { generateRecoveryPassphrase, normalizeRecoveryPassphrase } from '@/shared/gerovault';
import { mockReader, utxo, vaultFixture, withManifest, type VaultFixture } from '@/modules/gerovault/detail/__fixtures__/vaultFixtures';
import { checkOwnPassphrase, groupMatches, ownPassphraseReady, passphraseGroups, randomGroupIndex } from './passphrase';
import {
  RECOVERY_EXPORTS_STORAGE_KEY,
  readRecoveryExport,
  recordRecoveryExport,
  recoveryExportStaleness,
  recoveryFileName,
} from './exportRecord';
import { scriptLines } from './scriptView';
import { REVEALED_SCRIPT_SCAN, nativeChainFacts, plutusChainUtxos, revealedNativeScripts } from './chainFacts';

let f: VaultFixture;

beforeAll(async () => {
  f = await vaultFixture();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('generated passphrase', () => {
  it('shows four groups of four', () => {
    const groups = passphraseGroups(generateRecoveryPassphrase());
    expect(groups).toHaveLength(4);
    for (const g of groups) expect(g).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('asks for a group drawn from all four', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(randomGroupIndex());
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('accepts the group as written by hand: lowercase, spaced, with lookalikes', () => {
    expect(groupMatches('M9XD', 'M9XD')).toBe(true);
    expect(groupMatches(' m9 xd ', 'M9XD')).toBe(true);
    expect(groupMatches('7KQ2', '7KQ2')).toBe(true);
    expect(groupMatches('h8wn', 'H8WN')).toBe(true);
    expect(groupMatches('10O0', '1000')).toBe(true);
    expect(groupMatches('i1L0', '1110')).toBe(true);
    expect(groupMatches('M9XE', 'M9XD')).toBe(false);
    expect(groupMatches('', 'M9XD')).toBe(false);
    expect(groupMatches('M9XD4', 'M9XD')).toBe(false);
  });
});

describe('own passphrase', () => {
  it('needs 16 code points once normalised', () => {
    expect(checkOwnPassphrase('short one', '')).toEqual({ problem: 'TOO_SHORT', advice: false });
    expect(checkOwnPassphrase('   fifteen chars  ', '').problem).toBe('TOO_SHORT');
    expect(checkOwnPassphrase('sixteen code pts', '').problem).toBeUndefined();
  });

  it('refuses control characters, and gives one line of advice below 24 code points', () => {
    expect(checkOwnPassphrase('a passphrase\u0007 with a bell', '').problem).toBe('CONTROL_CHARACTER');
    expect(checkOwnPassphrase('sixteen code pts', '').advice).toBe(true);
    expect(checkOwnPassphrase('a much longer passphrase of mine', '').advice).toBe(false);
  });

  it('compares the repetition after the same normalisation', () => {
    const pass = 'my vault passphrase 2026';
    expect(checkOwnPassphrase(pass, 'my vault passphrase 2025').problem).toBe('MISMATCH');
    expect(checkOwnPassphrase(pass, `  ${pass}\n`).problem).toBeUndefined();
    expect(ownPassphraseReady(pass, '')).toBe(false);
    expect(ownPassphraseReady(pass, pass)).toBe(true);
    expect(ownPassphraseReady('short', 'short')).toBe(false);
    expect(normalizeRecoveryPassphrase(`  ${pass}\n`)).toBe(pass);
  });
});

describe('export mark and staleness', () => {
  it('asks for an export until this device made one', () => {
    expect(readRecoveryExport(7, f.id)).toBeUndefined();
    expect(recoveryExportStaleness(undefined, f.record)).toEqual({ stale: true, reason: 'NEVER_EXPORTED' });
    const mark = recordRecoveryExport(7, f.record, 1_800_000_000_000);
    expect(readRecoveryExport(7, f.id)).toEqual(mark);
    expect(readRecoveryExport(8, f.id)).toBeUndefined();
    expect(recoveryExportStaleness(mark, f.record)).toEqual({ stale: false, exportedAt: 1_800_000_000_000 });
  });

  it('is stale once the vault has a manifest the package did not carry, or a newer or other one', () => {
    const withM = withManifest(f.record, f.manifest);
    const before = recordRecoveryExport(7, f.record, 1);
    expect(recoveryExportStaleness(before, withM)).toEqual({ stale: true, reason: 'NO_MANIFEST', exportedAt: 1 });
    const now = recordRecoveryExport(7, withM, 2);
    expect(recoveryExportStaleness(now, withM)).toEqual({ stale: false, exportedAt: 2 });
    const newer = { ...withM, manifest: { ...withM.manifest!, version: withM.manifest!.version + 1, hash: 'f'.repeat(64) } };
    expect(recoveryExportStaleness(now, newer)).toEqual({ stale: true, reason: 'OLDER_REVISION', exportedAt: 2 });
    const other = { ...withM, manifest: { ...withM.manifest!, hash: 'f'.repeat(64) } };
    expect(recoveryExportStaleness(now, other)).toEqual({ stale: true, reason: 'OTHER_REVISION', exportedAt: 2 });
  });

  it('reads a malformed store as no export, and survives storage that throws', () => {
    localStorage.setItem(RECOVERY_EXPORTS_STORAGE_KEY, '{"7:x":{"exportedAt":"soon"}}');
    expect(readRecoveryExport(7, 'x')).toBeUndefined();
    localStorage.setItem(RECOVERY_EXPORTS_STORAGE_KEY, 'not json');
    expect(readRecoveryExport(7, f.id)).toBeUndefined();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => recordRecoveryExport(7, f.record, 3)).not.toThrow();
  });

  it('names the file by the start of the vault id only', () => {
    expect(recoveryFileName(f.id)).toBe(`gero-vault-recovery-${f.id.slice(0, 8)}.gvr`);
  });
});

describe('scriptLines', () => {
  it('prints the exact rule with every key and marks only this wallet\'s own', () => {
    const own = f.vault.owners[1].payment;
    const lines = scriptLines(f.vault.payment.script, new Set([own]));
    expect(lines[0]).toEqual({ kind: 'open', depth: 0, rule: 'atLeast', required: 2, of: 3 });
    expect(lines.at(-1)).toEqual({ kind: 'close', depth: 0 });
    const keys = lines.filter(l => l.kind === 'key');
    expect(keys.map(k => k.kind === 'key' && k.keyHash)).toEqual(f.vault.owners.map(o => o.payment));
    expect(keys.filter(k => k.kind === 'key' && k.own)).toHaveLength(1);
  });

  it('prints time locks and nested rules', () => {
    const script: Cardano.NativeScript = {
      __type: Cardano.ScriptType.Native,
      kind: Cardano.NativeScriptKind.RequireAnyOf,
      scripts: [
        { __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireTimeAfter, slot: Cardano.Slot(10) },
        {
          __type: Cardano.ScriptType.Native,
          kind: Cardano.NativeScriptKind.RequireAllOf,
          scripts: [{ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireTimeBefore, slot: Cardano.Slot(20) }],
        },
      ],
    };
    expect(scriptLines(script, new Set()).map(l => `${l.depth}:${l.kind}`)).toEqual(['0:open', '1:after', '1:open', '2:before', '1:close', '0:close']);
  });
});

/** A transaction whose witness set reveals `scripts`. */
function txRevealing(scripts: Cardano.NativeScript[]): string {
  const tx = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('0'.repeat(64)),
    body: { inputs: [], outputs: [], fee: 0n },
    witness: { signatures: new Map(), scripts },
  });
  return tx.toCbor();
}

describe('chain facts', () => {
  it('reads the native scripts a transaction reveals, and none from bytes that are not one', () => {
    expect(revealedNativeScripts(txRevealing([f.vault.payment.script]))).toEqual([f.vault.payment.cbor]);
    expect(revealedNativeScripts('00')).toEqual([]);
  });

  it('gathers funded and revealed scripts for a native vault', async () => {
    const reader = mockReader({
      utxos: [utxo(f.address, 1, 3_000_000n)],
      history: [{ txHash: 'a'.repeat(64), blockHeight: 1, blockTime: 1 }],
      txCbor: new Map([['a'.repeat(64), txRevealing([f.vault.payment.script])]]),
    });
    const facts = await nativeChainFacts(reader, 'preprod', f.address);
    expect(facts).toMatchObject({ network: 'preprod', funded: true, revealedScripts: [f.vault.payment.cbor], read: { utxos: true, history: true } });
    expect(reader.history).toHaveBeenCalledWith(f.address, expect.objectContaining({ page: 1, pageSize: REVEALED_SCRIPT_SCAN }));
  });

  it('says never used for an address with no history, and leaves out what it cannot read', async () => {
    const quiet = await nativeChainFacts(mockReader(), 'preprod', f.address);
    expect(quiet).toMatchObject({ funded: false, used: false, revealedScripts: [] });
    const broken = await nativeChainFacts(mockReader({ utxos: new Error('down'), history: new Error('down') }), 'preprod', f.address);
    expect(broken.funded).toBeUndefined();
    expect(broken.used).toBeUndefined();
    expect(broken.read).toEqual({ utxos: false, history: false });
  });

  it('turns UTxOs into the shape the Plutus restore reads', async () => {
    const rows = await plutusChainUtxos(mockReader({ utxos: [utxo(f.address, 1, 2_000_000n, { assets: { state: 1n } })] }), f.address);
    expect(rows).toEqual([{ address: f.address, assets: [{ policyId: 'a'.repeat(56), assetName: Buffer.from('state').toString('hex'), quantity: 1n }] }]);
  });
});
