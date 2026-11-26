/**
 * Test-only vault records, UTxOs and chain readers for the vault screens' specs. The keys are the
 * manifest fixture's test participants (`src/shared/gerovault/__fixtures__/manifest.ts`): published
 * or fixed test keys, never a real wallet.
 */
import { Cardano } from '@cardano-sdk/core';
import { vi } from 'vitest';
import {
  encodeManifest,
  encodeVaultPublicKeys,
  manifestHash,
  vaultAddresses,
  vaultKeyHashes,
  type VaultManifest,
  type VaultScripts,
} from '@/shared/gerovault';
import { vectorFixture, type TestParticipant } from '@/shared/gerovault/__fixtures__/manifest';
import type {
  StoredVaultParticipant,
  VaultChainReader,
  VaultHistoryEntry,
  VaultRecord,
  VaultStore,
} from '@/modules/gerovault/contracts';

export interface VaultFixture {
  readonly people: TestParticipant[];
  readonly vault: VaultScripts;
  readonly id: string;
  readonly manifest: VaultManifest;
  readonly address: string;
  /** The vector vault (owners 0, 1 and 2, 2 of 3, preprod) as person 0's wallet holds it. */
  readonly record: VaultRecord;
}

const LABELS = ['Alice', 'Bob', undefined];

export async function vaultFixture(): Promise<VaultFixture> {
  const { people, vault, id, manifest } = await vectorFixture();
  const participants: StoredVaultParticipant[] = await Promise.all(people.slice(0, 3).map(async (p, i) => {
    const hashes = await vaultKeyHashes(p.vaultKeys);
    const label = LABELS[i];
    return {
      role: 'owner' as const,
      credential: hashes.payment,
      stakeKeyHash: hashes.stake,
      vaultKeys: encodeVaultPublicKeys(p.vaultKeys),
      ...(label ? { label } : {}),
      self: i === 0,
    };
  }));
  const record: VaultRecord = {
    recordVersion: 1,
    kind: 'native',
    vaultId: id,
    network: 'preprod',
    status: 'accepted',
    origin: 'created',
    name: 'Treasury',
    paymentScriptCbor: vault.payment.cbor,
    stakeScriptCbor: vault.stake.cbor,
    paymentScriptHash: vault.payment.hash,
    stakeScriptHash: vault.stake.hash,
    participants,
    ownIndex: people[0].index,
    manifest: null,
    verifications: [],
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
  return { people, vault, id, manifest, address: vaultAddresses(vault, 'preprod').base, record };
}

/** The record with the fixture's manifest stored, as an accepted revision. */
export function withManifest(record: VaultRecord, manifest: VaultManifest): VaultRecord {
  return { ...record, manifest: { cbor: encodeManifest(manifest), hash: manifestHash(manifest), version: manifest.version } };
}

const POLICY = 'a'.repeat(56);

/** One UTxO at `address`; `datumHash` makes it one locked by a datum the wallet does not know. */
export function utxo(
  address: string,
  n: number,
  coins: bigint,
  options: { assets?: Record<string, bigint>; datumHash?: string } = {},
): Cardano.Utxo {
  const assets = new Map<Cardano.AssetId, bigint>(
    Object.entries(options.assets ?? {}).map(([name, q]) => [Cardano.AssetId(`${POLICY}${Buffer.from(name).toString('hex')}`), q]),
  );
  return [
    { txId: Cardano.TransactionId(n.toString(16).padStart(64, '0')), index: 0, address: Cardano.PaymentAddress(address) },
    {
      address: Cardano.PaymentAddress(address),
      value: { coins, ...(assets.size > 0 ? { assets } : {}) },
      ...(options.datumHash ? { datumHash: options.datumHash as Cardano.TxOut['datumHash'] } : {}),
    },
  ];
}

export function historyEntries(count: number, from = 0): VaultHistoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    txHash: (from + i + 1).toString(16).padStart(64, 'f'),
    blockHeight: 4_000_000 - (from + i),
    blockTime: 1_800_000_000 - (from + i) * 60,
  }));
}

export interface MockReader extends VaultChainReader {
  readonly utxos: ReturnType<typeof vi.fn<VaultChainReader['utxos']>>;
  readonly history: ReturnType<typeof vi.fn<VaultChainReader['history']>>;
}

export function mockReader(options: {
  utxos?: Cardano.Utxo[] | Error;
  history?: VaultHistoryEntry[] | Error | ((page: number) => VaultHistoryEntry[]);
  txCbor?: Map<string, string>;
} = {}): MockReader {
  return {
    network: 'preprod',
    utxos: vi.fn(async () => {
      if (options.utxos instanceof Error) throw options.utxos;
      return options.utxos ?? [];
    }),
    history: vi.fn(async (_address, read) => {
      const h = options.history;
      if (h instanceof Error) throw h;
      if (typeof h === 'function') return h(read?.page ?? 1);
      return h ?? [];
    }),
    txCbor: vi.fn(async () => options.txCbor ?? new Map<string, string>()),
    submit: vi.fn(async () => ''),
  };
}

/** A vault store over a list of records, with `accept` and `addCandidate` that change it. */
export function memoryStore(records: VaultRecord[], options: { failList?: boolean } = {}): VaultStore & { rows: VaultRecord[] } {
  const rows = [...records];
  const find = (vaultId: string) => rows.find(r => r.vaultId === vaultId);
  return {
    rows,
    list: vi.fn(async () => {
      if (options.failList) throw Object.assign(new Error('unavailable'), { code: 'STORE_UNAVAILABLE' });
      return [...rows];
    }),
    get: vi.fn(async (_w: number, vaultId: string) => find(vaultId)),
    addCandidate: vi.fn(async () => {
      throw new Error('not used here');
    }),
    accept: vi.fn(async (_w: number, vaultId: string) => {
      const row = find(vaultId);
      if (!row) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
      const next: VaultRecord = { ...row, status: 'accepted', acceptedAt: 1_800_000_100_000 };
      rows.splice(rows.indexOf(row), 1, next);
      return next;
    }),
    update: vi.fn(async () => {
      throw new Error('not used here');
    }),
  };
}
