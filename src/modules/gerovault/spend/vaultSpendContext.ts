/**
 * What a spend needs to know about one vault, read again from the stored record: the payment
 * script, its threshold and owner keys, the vault's full address, and each participant's payment
 * key. The store checked the record on write; this reads it back and checks it once more, because
 * every signature and every "change to vault" decision below compares against these values and
 * never against anything a bundle or a witness file says.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import {
  ROLE,
  parseVaultPublicKeys,
  parseVaultScript,
  vaultId as vaultIdOf,
  vaultKeyHashes,
  vaultScript,
  type ParsedVaultScript,
  type VaultNetwork,
} from '@/shared/gerovault';
import type { VaultParticipantRole, VaultRecord } from '@/modules/gerovault/contracts';
import { spendError } from './errors';

export interface VaultSpendParticipant {
  readonly role: VaultParticipantRole;
  /** Payment vault key hash, 28 bytes of lowercase hex. */
  readonly credential: string;
  /** Stake vault key hash. */
  readonly stakeKeyHash: string;
  /** The raw Ed25519 payment public key, 32 bytes of lowercase hex. */
  readonly paymentKey: string;
  /** A claim from whoever named the participant. Show it only through `displayLabel`. */
  readonly label?: string;
  readonly self: boolean;
}

export interface VaultSpendContext {
  readonly vaultId: string;
  readonly network: VaultNetwork;
  /** The network id every address of the vault's transactions carries. */
  readonly networkId: 0 | 1;
  readonly name?: string;
  /** The payment script, as the transaction's witness set carries it. */
  readonly paymentScript: Cardano.NativeScript;
  readonly paymentScriptHash: string;
  readonly stakeScriptHash: string;
  readonly template: ParsedVaultScript;
  /** Signatures the owners' branch needs. */
  readonly threshold: number;
  /** Owner payment key hashes, in script order. */
  readonly owners: readonly string[];
  /** The vault's full address (script payment, script stake), bech32. */
  readonly baseAddress: string;
  /** The same address, raw bytes as lowercase hex: what an output's address is compared with. */
  readonly baseAddressHex: string;
  readonly participants: readonly VaultSpendParticipant[];
  /** This wallet's own participant. */
  readonly self: VaultSpendParticipant;
  /** This wallet's CIP-1854 index in the vault. */
  readonly ownIndex: number;
  readonly accepted: boolean;
}

const NETWORK_ID: Readonly<Record<VaultNetwork, 0 | 1>> = { mainnet: 1, preprod: 0, preview: 0 };

function readScript(cbor: string, role: typeof ROLE.PAYMENT | typeof ROLE.STAKE, storedHash: string) {
  let core: Cardano.NativeScript;
  try {
    core = Serialization.NativeScript.fromCbor(HexBlob(cbor)).toCore();
  } catch {
    return spendError('VAULT_INVALID', 'A stored script is not a native script');
  }
  const script = vaultScript(role, core);
  if (script.cbor !== cbor || script.hash !== storedHash) spendError('VAULT_INVALID', 'A stored script does not give its stored hash');
  const parsed = parseVaultScript(core);
  if (!parsed) spendError('VAULT_INVALID', 'A stored script is not a vault template');
  return { script, parsed };
}

/** The vault's full address on its network, bech32 and raw hex. */
export function vaultBaseAddress(network: VaultNetwork, paymentScriptHash: string, stakeScriptHash: string): { bech32: string; hex: string } {
  const credential = (hash: string): Cardano.Credential => ({ type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(hash) });
  const address = Cardano.BaseAddress.fromCredentials(NETWORK_ID[network], credential(paymentScriptHash), credential(stakeScriptHash)).toAddress();
  return { bech32: address.toBech32(), hex: address.toBytes() };
}

/** Reads a stored vault record into a spend context. Throws `VaultSpendError` (`VAULT_INVALID`, `NOT_AN_OWNER`). */
export async function spendContextOf(record: VaultRecord): Promise<VaultSpendContext> {
  if (!record || record.kind !== 'native' || !Object.prototype.hasOwnProperty.call(NETWORK_ID, record.network)) {
    spendError('VAULT_INVALID', 'Not a native vault record');
  }
  const payment = readScript(record.paymentScriptCbor, ROLE.PAYMENT, record.paymentScriptHash);
  const stake = readScript(record.stakeScriptCbor, ROLE.STAKE, record.stakeScriptHash);
  if (vaultIdOf({ payment: payment.script, stake: stake.script }, record.network) !== record.vaultId) {
    spendError('VAULT_INVALID', 'The vault id is not the one its scripts give');
  }

  const participants: VaultSpendParticipant[] = [];
  for (const stored of record.participants) {
    let paymentKey: string;
    try {
      const keys = parseVaultPublicKeys(stored.vaultKeys);
      const hashes = await vaultKeyHashes(keys);
      if (hashes.payment !== stored.credential || hashes.stake !== stored.stakeKeyHash) throw new Error('hash');
      paymentKey = keys.payment;
    } catch {
      return spendError('VAULT_INVALID', 'A participant\'s keys do not give their stored hashes');
    }
    participants.push(Object.freeze({
      role: stored.role,
      credential: stored.credential,
      stakeKeyHash: stored.stakeKeyHash,
      paymentKey,
      ...(stored.label !== undefined ? { label: stored.label } : {}),
      self: stored.self === true,
    }));
  }
  const owners = [...payment.parsed.owners];
  for (const owner of owners) {
    if (!participants.some(p => p.role === 'owner' && p.credential === owner)) spendError('VAULT_INVALID', 'An owner key of the script has no participant');
  }
  const selves = participants.filter(p => p.self);
  if (selves.length !== 1) spendError('VAULT_INVALID', 'Exactly one participant is this wallet');
  const self = selves[0];
  if (self.role !== 'owner' || !owners.includes(self.credential)) {
    spendError('NOT_AN_OWNER', 'This wallet holds no owner key of the vault');
  }

  const address = vaultBaseAddress(record.network, payment.script.hash, stake.script.hash);
  return Object.freeze({
    vaultId: record.vaultId,
    network: record.network,
    networkId: NETWORK_ID[record.network],
    ...(record.name !== undefined ? { name: record.name } : {}),
    paymentScript: payment.script.script,
    paymentScriptHash: payment.script.hash,
    stakeScriptHash: stake.script.hash,
    template: payment.parsed,
    threshold: payment.parsed.threshold,
    owners: Object.freeze(owners),
    baseAddress: address.bech32,
    baseAddressHex: address.hex,
    participants: Object.freeze(participants),
    self,
    ownIndex: record.ownIndex,
    accepted: record.status === 'accepted',
  });
}

/** The participant whose payment key hashes to `credential`, if any. */
export function participantByCredential(context: VaultSpendContext, credential: string): VaultSpendParticipant | undefined {
  return context.participants.find(p => p.credential === credential);
}
