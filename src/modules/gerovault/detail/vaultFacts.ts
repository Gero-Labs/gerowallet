/**
 * What the vault screens show of a stored vault, read from its scripts: the address, the template
 * and threshold, the backup terms, and the participants in script order. Pure: no store, no chain.
 *
 * The store checked every row on write (`vaultStore.ts`), so the scripts parse; a row that does
 * not is reported as unreadable rather than shown half right.
 */
import { Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import {
  ROLE,
  backupPathOpensAtMs,
  formatVaultKeyPath,
  parseVaultScript,
  vaultAddresses,
  vaultScript,
  type ParsedVaultScript,
  type Role,
  type VaultAddresses,
  type VaultScript,
} from '@/shared/gerovault';
import type { StoredVaultParticipant, VaultRecord } from '@/modules/gerovault/contracts';

export interface VaultTemplateFacts {
  readonly kind: 'standard' | 'backup';
  /** Owner signatures a spend needs. */
  readonly threshold: number;
  readonly ownerCount: number;
  /** The dated backup path, for the backup template only. */
  readonly backup?: {
    readonly threshold: number;
    readonly holderCount: number;
    readonly afterSlot: number;
    /** When the slot comes, in Unix milliseconds; undefined when it cannot be computed. */
    readonly opensAtMs?: number;
  };
}

export interface VaultFacts {
  readonly payment: VaultScript;
  readonly stake: VaultScript;
  readonly addresses: VaultAddresses;
  readonly template: VaultTemplateFacts;
  /** Owners first, then backup holders, each in script order. */
  readonly participants: readonly StoredVaultParticipant[];
  readonly self: StoredVaultParticipant | undefined;
}

function readScript(role: Role, cbor: string): VaultScript {
  return vaultScript(role, Serialization.NativeScript.fromCbor(HexBlob(cbor)).toCore());
}

function templateOf(parsed: ParsedVaultScript, record: VaultRecord): VaultTemplateFacts {
  if (parsed.kind === 'standard') return { kind: 'standard', threshold: parsed.threshold, ownerCount: parsed.owners.length };
  const opensAtMs = backupPathOpensAtMs(record.network, parsed.backupAfterSlot);
  return {
    kind: 'backup',
    threshold: parsed.threshold,
    ownerCount: parsed.owners.length,
    backup: {
      threshold: parsed.backupThreshold,
      holderCount: parsed.backups.length,
      afterSlot: parsed.backupAfterSlot,
      ...(opensAtMs === undefined ? {} : { opensAtMs }),
    },
  };
}

/** The vault's facts, or undefined when its scripts do not read as a vault template. Never throws. */
export function vaultFacts(record: VaultRecord): VaultFacts | undefined {
  try {
    const payment = readScript(ROLE.PAYMENT, record.paymentScriptCbor);
    const stake = readScript(ROLE.STAKE, record.stakeScriptCbor);
    const parsed = parseVaultScript(payment.script);
    if (!parsed) return undefined;
    const order = [...parsed.owners, ...(parsed.kind === 'backup' ? parsed.backups : [])];
    const rank = (p: StoredVaultParticipant) => {
      const i = order.indexOf(p.credential as (typeof order)[number]);
      return i < 0 ? order.length : i;
    };
    const participants = [...record.participants].sort((a, b) => rank(a) - rank(b));
    return {
      payment,
      stake,
      addresses: vaultAddresses({ payment, stake }, record.network),
      template: templateOf(parsed, record),
      participants,
      self: participants.find(p => p.self),
    };
  } catch {
    return undefined;
  }
}

/** `m/1854'/1815'/0'/0/i`: this wallet's own payment key path in the vault. */
export function ownKeyPath(record: Pick<VaultRecord, 'ownIndex'>): string {
  return formatVaultKeyPath(ROLE.PAYMENT, record.ownIndex);
}

/** Splits a long identifier into groups of four for the mono face (`g-mono`). */
export function chunk(value: string, size = 4): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

/** The record's own name, when it has one; screens show it through `displayLabel`. */
export function vaultName(record: Pick<VaultRecord, 'name'>): string | undefined {
  return typeof record.name === 'string' && record.name.length > 0 ? record.name : undefined;
}
