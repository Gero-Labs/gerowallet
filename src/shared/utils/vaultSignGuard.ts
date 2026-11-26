/**
 * The generic signing path never produces a vault owner's signature.
 *
 * GeroVault vaults are CIP-1854 native-script multisigs. An owner's witness for one is approved on
 * the vault screen, which shows what the vault does. The generic signers (software: WalletBg.signTx;
 * hardware: ledger.txToLedger, trezor.signTransaction, createKeystoneSignRequest) serve dApp
 * approvals and every other screen, so they refuse to give that witness:
 *
 * 1. They never sign with a CIP-1854 key other than `m/1854'/1815'/<account>'/0/0`, the one
 *    multisig key Ledger and Trezor are asked for today. A key at index 1 or above (`0/i`), or any
 *    multisig stake key (`2/i`), is refused, whatever the transaction.
 * 2. They never sign a transaction that touches a known vault (knownVaults.ts): an input whose UTxO
 *    sits at a vault's payment script, or a withdrawal or certificate under a vault's stake script.
 *    Matched by credential, never by whole address, so a spend from the vault's payment script
 *    under another stake part is caught too. Paying to a vault touches nothing.
 *
 * A refusal refuses the whole request (VAULT_SIGN_REFUSAL_MESSAGE, which signRefusalText shows in
 * the user's language). No signer hands back a witness set with the vault witness left out: like
 * every other signing refusal here, nothing is signed.
 */
import { Cardano } from '@cardano-sdk/core';
import { VAULT_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { coin_type, HARDENED, purpose } from '@/models/types';
import { knownVaultScriptHashes, type KnownVaultScriptHashes } from '@/shared/utils/knownVaults';
import { paymentCredential, utxoAddress, utxoIndex, walletWitnessPlan, type KeySet } from '@/shared/utils/keyCreds';
import { debugLog } from '@/utils/debug';

/** A key path as a signer holds it: text (`m/1854'/1815'/0'/0/0`) or BIP32 numbers. */
export type SigningKeyPath = string | readonly number[];

type Utxos = ReadonlyArray<Cardano.Utxo> | null | undefined;

const MULTISIG_PURPOSE = HARDENED + purpose.multisig;
const CARDANO_COIN = HARDENED + coin_type.cardano;
const MAX_HARDENED = 0xffffffff;

/** One level of a text path as its BIP32 number, NaN for anything that is not one. */
const level = (part: string): number => {
  const match = /^(\d+)(')?$/.exec(part);
  if (!match) return Number.NaN;
  return Number(match[1]) + (match[2] ? HARDENED : 0);
};

const withoutRoot = (path: string): string => path.replace(/^m\//, '');

/**
 * Rule 1: whether the generic signing path may sign with the key at `path`. Any key outside
 * CIP-1854 may (each signer's own checks decide those). Of CIP-1854 (purpose 1854, hardened or
 * not, so a malformed one is caught too) only the payment key 0 of an account may.
 */
export function isGenericSigningPath(path: SigningKeyPath): boolean {
  const levels = typeof path === 'string' ? withoutRoot(path).split('/').map(level) : [...path];
  const multisig = typeof path === 'string'
    ? /^1854(?!\d)/.test(withoutRoot(path))
    : levels[0] === MULTISIG_PURPOSE || levels[0] === purpose.multisig;
  if (!multisig) return true;
  const [purposeLevel, coin, account, role, index] = levels;
  return levels.length === 5
    && purposeLevel === MULTISIG_PURPOSE
    && coin === CARDANO_COIN
    && Number.isInteger(account) && account >= HARDENED && account <= MAX_HARDENED
    && role === 0
    && index === 0;
}

/** Refuses (VAULT_SIGN_REFUSAL_MESSAGE) when any of `paths` is a key the generic signing path never signs with. */
export function assertGenericSigningPaths(paths: Iterable<SigningKeyPath | null | undefined>): void {
  for (const path of paths) {
    if (path === null || path === undefined || path === '') continue;
    if (!isGenericSigningPath(path)) {
      debugLog('Vault guard: refusing a CIP-1854 key that only the vault screen signs with');
      throw new Error(VAULT_SIGN_REFUSAL_MESSAGE);
    }
  }
}

/** Whether an error is this guard's refusal, so a signer that wraps device errors passes it through as it is. */
export const isVaultSignRefusal = (error: unknown): error is Error =>
  error instanceof Error && error.message === VAULT_SIGN_REFUSAL_MESSAGE;

/** Every key path the shared plan (walletWitnessPlan) signs a transaction with: each signer follows that plan. */
export const plannedSigningPaths = (tx: Cardano.Tx, keys: KeySet, utxos: Utxos): string[] => {
  const plan = walletWitnessPlan(tx, keys, utxos);
  return [...plan.inputs.map(({ key }) => key?.path), ...plan.witnesses.map(({ key }) => key.path)]
    .filter((path): path is string => !!path);
};

const scriptHash = (credential: Cardano.Credential | undefined): string | undefined =>
  credential?.type === Cardano.CredentialType.ScriptHash ? credential.hash.toLowerCase() : undefined;

const rewardCredential = (account: string): Cardano.Credential | undefined => {
  try {
    return Cardano.Address.fromString(account)?.asReward()?.getPaymentCredential();
  } catch {
    return undefined;
  }
};

/** The credentials that witness a certificate: its stake credential, a DRep's, or a committee member's cold one. */
const certificateCredentials = (cert: Cardano.Certificate): Cardano.Credential[] => {
  const fields = cert as Partial<Record<'stakeCredential' | 'dRepCredential' | 'coldCredential', Cardano.Credential>>;
  return [fields.stakeCredential, fields.dRepCredential, fields.coldCredential]
    .filter((credential): credential is Cardano.Credential => !!credential);
};

const lowercase = (hashes: ReadonlySet<string>): ReadonlySet<string> => new Set([...hashes].map((hash) => hash.toLowerCase()));

/**
 * Rule 2: what of a transaction touches a known vault.
 * - `spends:<txId>#<index>`: an input whose UTxO's payment credential is a vault's payment script,
 *   whatever stake part its address has. The UTxO is looked up in `utxos`, the list the signer was
 *   given; an input it does not hold is not resolved here.
 * - `withdraws:<reward account>`: a withdrawal whose credential is a vault's stake script.
 * - `certificate:<index>`: a certificate witnessed by a vault's stake script.
 * An output paying to a vault touches nothing.
 */
export function findVaultTouch(tx: Cardano.Tx, vaults: KnownVaultScriptHashes, utxos: Utxos): string[] {
  const payment = lowercase(vaults.payment);
  const stake = lowercase(vaults.stake);
  const hits: string[] = [];
  if (payment.size > 0) {
    const utxoOf = utxoIndex(utxos);
    for (const txIn of tx.body.inputs ?? []) {
      const utxo = utxoOf(txIn);
      const hash = utxo ? scriptHash(paymentCredential(utxoAddress(utxo))) : undefined;
      if (hash && payment.has(hash)) hits.push(`spends:${txIn.txId}#${txIn.index}`);
    }
  }
  if (stake.size > 0) {
    for (const { stakeAddress } of tx.body.withdrawals ?? []) {
      const hash = scriptHash(rewardCredential(stakeAddress));
      if (hash && stake.has(hash)) hits.push(`withdraws:${stakeAddress}`);
    }
    (tx.body.certificates ?? []).forEach((cert, index) => {
      const hashes = certificateCredentials(cert).map(scriptHash);
      if (hashes.some((hash) => !!hash && stake.has(hash))) hits.push(`certificate:${index}`);
    });
  }
  return hits;
}

/**
 * Both rules, before a signer decrypts a key or asks a device for a witness: the keys the shared
 * plan signs `tx` with, then the known vaults. Throws VAULT_SIGN_REFUSAL_MESSAGE; a provider that
 * cannot read its store throws too, and that refuses as well.
 */
export async function assertNoVaultSignature(tx: Cardano.Tx, keys: KeySet, utxos: Utxos): Promise<void> {
  assertGenericSigningPaths(plannedSigningPaths(tx, keys, utxos));
  const hits = findVaultTouch(tx, await knownVaultScriptHashes(), utxos);
  if (hits.length > 0) {
    debugLog('Vault guard: refusing a transaction that touches a known vault:', hits);
    throw new Error(VAULT_SIGN_REFUSAL_MESSAGE);
  }
}
