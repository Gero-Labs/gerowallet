import { Cardano, Serialization } from '@cardano-sdk/core';
import type { Key, Keys } from '@/models/types';

/**
 * The lowercase key hashes (`cred`) of the given key lists, as the signers and the approval
 * card compare a transaction's key hashes against the wallet's. A missing list, or a key
 * with no cred, adds nothing.
 */
export const credSet = (...lists: Array<ReadonlyArray<{ cred?: string }> | null | undefined>): Set<string> =>
  new Set(lists.flatMap((list) => (Array.isArray(list) ? list : []))
    .map((key) => String(key?.cred ?? '').toLowerCase())
    .filter(Boolean));

/** A key set as callers hold it: an older or partial one may lack any list, or be missing. */
export type KeySet = Partial<Keys> | null | undefined;

/** A key list of the key set, empty when an older or partial key set has none. */
export const keyList = (list: ReadonlyArray<Key> | null | undefined): ReadonlyArray<Key> => (Array.isArray(list) ? list : []);

const lower = (hash: unknown) => String(hash ?? '').toLowerCase();

/**
 * Whether an HD wallet's key set carries every key the signers read with its key hash, as
 * `WalletBg.resolvePathsForMissingAddresses` derives it: a stake, DRep and committee key, and a
 * hash on each payment and change key. The signers sign nothing for a key whose hash is missing.
 */
export const carriesSigningCreds = (keys: KeySet): boolean => {
  const hasCreds = (list: ReadonlyArray<Key> | null | undefined) => Array.isArray(list) && list.every((key) => !!key?.cred);
  const roles = [keys?.stake, keys?.drep105, keys?.drep129, keys?.ccCold, keys?.ccHot];
  return roles.every((list) => hasCreds(list) && keyList(list).length > 0) && hasCreds(keys?.payment) && hasCreds(keys?.change);
};

const parse = (address: string | undefined) => {
  try {
    return address ? Cardano.Address.fromString(address) : null;
  } catch {
    return null;
  }
};

/**
 * An address's payment credential (a reward address's stake credential), key hash or script
 * hash. Undefined for a Byron or unparseable address.
 */
export const paymentCredential = (address: string | undefined): Cardano.Credential | undefined =>
  parse(address)?.getProps().paymentPart;

/**
 * The lowercase payment key hash of an address whose payment credential is a key hash. Undefined
 * for a script-locked, Byron or unparseable address, which no key of the wallet signs for.
 */
export const paymentKeyHash = (address: string | undefined): string | undefined => {
  const credential = paymentCredential(address);
  return credential?.type === Cardano.CredentialType.KeyHash ? credential.hash.toLowerCase() : undefined;
};

/**
 * The first key that matches, one with a path before one without: no signer can use a key with
 * no path, so it must not hide another key the key set carries for the same hash.
 */
const findKey = (keys: ReadonlyArray<Key>, matches: (key: Key) => boolean): Key | undefined =>
  keys.find((key) => matches(key) && !!key.path) ?? keys.find(matches);

/**
 * The payment or change key that signs for a UTxO at an address: the one at that address, else
 * the one carrying the address's payment key hash (an enterprise address of a wallet key, or one
 * with another stake part). A script-locked address, or a key the key set doesn't carry, has none.
 */
export const keyAtAddress = (keys: KeySet, address: string | undefined): Key | undefined => {
  if (!address) return undefined;
  const paymentKeys = [...keyList(keys?.payment), ...keyList(keys?.change)];
  const atAddress = findKey(paymentKeys, (key) => key.address === address);
  if (atAddress) return atAddress;
  const hash = paymentKeyHash(address);
  return hash ? findKey(paymentKeys, (key) => lower(key.cred) === hash) : undefined;
};

/**
 * The lowercase key hash of a reward account whose credential is a key hash. Undefined for a
 * script's reward account or an unparseable one, which no key of the wallet signs for.
 */
export const rewardAccountKeyHash = (account: string): string | undefined => {
  const credential = parse(account)?.asReward()?.getPaymentCredential();
  return credential?.type === Cardano.CredentialType.KeyHash ? credential.hash.toLowerCase() : undefined;
};

/**
 * The stake key of the key set a reward account belongs to: the one carrying its key hash, else
 * the one at that address when it carries no hash. A key that lists its address names its network,
 * so a reward account on another network (the same seed's) is not the wallet's. The signers and the
 * approval card decide a withdrawal, pool ownership or proposal deposit account is the wallet's by this.
 */
export const stakeKeyFor = (keys: KeySet, account: string): Key | undefined => {
  const hash = rewardAccountKeyHash(account);
  if (!hash) return undefined;
  const network = parse(account)?.getNetworkId();
  const sameNetwork = (key: Key) => !key.address || parse(key.address)?.getNetworkId() === network;
  const stake = keyList(keys?.stake);
  return findKey(stake, (key) => lower(key.cred) === hash && sameNetwork(key))
    ?? findKey(stake, (key) => key.address === account && !key.cred);
};

/**
 * The key of `lists` that carries a credential's hash, when that credential is a key hash. A
 * script's credential, or a hash the lists don't carry, has none.
 */
export const credentialKey = (
  lists: Array<ReadonlyArray<Key> | null | undefined>,
  credential: Cardano.Credential | undefined,
): Key | undefined => {
  if (credential?.type !== Cardano.CredentialType.KeyHash) return undefined;
  const hash = lower(credential.hash);
  return findKey(lists.flatMap(keyList), (key) => lower(key.cred) === hash);
};

/** The stake key that signs for a stake credential: the one carrying its key hash. */
export const stakeCredentialKey = (keys: KeySet, credential: Cardano.Credential | undefined): Key | undefined =>
  credentialKey([keys?.stake], credential);

/**
 * The key a required signer names, with its role: payment and change keys first, then the stake,
 * DRep and committee keys. A hash the key set doesn't carry is another party's.
 */
export const requiredSignerKey = (keys: KeySet, keyHash: string): { role: WitnessRole; key: Key } | undefined => {
  const credential = { type: Cardano.CredentialType.KeyHash, hash: keyHash } as Cardano.Credential;
  const byRole: Array<[WitnessRole, Array<ReadonlyArray<Key> | null | undefined>]> = [
    ['payment', [keys?.payment, keys?.change]], ['stake', [keys?.stake]], ['drep', [keys?.drep105, keys?.drep129]],
    ['ccCold', [keys?.ccCold]], ['ccHot', [keys?.ccHot]],
  ];
  for (const [role, lists] of byRole) {
    const key = credentialKey(lists, credential);
    if (key) return { role, key };
  }
  return undefined;
};

/** A UTxO's address, as the input or its output records it. */
export const utxoAddress = ([txIn, txOut]: Cardano.Utxo): string | undefined => txIn.address || txOut.address;

/** Looks a transaction input up among `utxos`, indexed once by `txId#index` (the first of any duplicate). */
export const utxoIndex = (utxos: ReadonlyArray<Cardano.Utxo> | null | undefined): ((txIn: Cardano.TxIn) => Cardano.Utxo | undefined) => {
  const byRef = new Map<string, Cardano.Utxo>();
  (utxos ?? []).forEach((utxo) => {
    const ref = `${utxo[0].txId}#${utxo[0].index}`;
    if (!byRef.has(ref)) byRef.set(ref, utxo);
  });
  return (txIn) => byRef.get(`${txIn.txId}#${txIn.index}`);
};

/**
 * Whether a transaction is marked to fail (isValid: false). It skips its scripts and forfeits its
 * collateral, and an input's witness alone authorises a collateral UTxO at the same key, so
 * leaving out the collateral witness can't protect it: the signers refuse such a transaction
 * outright (MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE). No dApp sends one honestly.
 */
export const isMarkedToFail = (tx: Pick<Cardano.Tx, 'isValid'>): boolean => tx.isValid === false;

/**
 * `isMarkedToFail` read from a transaction's own CBOR, as a signing entry receives it, never
 * from an object a dApp supplied. Unparseable or missing CBOR is not refused here: no signer
 * can sign it either, and each refuses it on its own terms.
 */
export const isMarkedToFailCbor = (txCbor: unknown): boolean => {
  if (typeof txCbor !== 'string' || !txCbor) return false;
  try {
    return isMarkedToFail({ isValid: Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).isValid() });
  } catch {
    return false;
  }
};

/** The role of a key that witnesses a transaction, as `analyzeTransactionForSignatures` names it. */
export type WitnessRole = 'payment' | 'stake' | 'drep' | 'ccCold' | 'ccHot';

/** A witness from the wallet beyond its inputs: the key hash it is for, and the key that has it. */
export interface WalletWitness {
  keyHash: string;
  role: WitnessRole;
  key: Key;
  /** For collateral, the address of the UTxO it signs for, which may differ from the key's own. */
  address?: string;
}

/** What a transaction needs the wallet's keys for, worked out once for every signer. */
export interface WalletWitnessPlan {
  /** Each input whose UTxO is known, with the payment or change key that signs for it, if any. */
  inputs: Array<{ utxo: Cardano.Utxo; key: Key | undefined }>;
  /** Every other witness, one per key hash: collateral, then certificates, votes, withdrawals and required signers. */
  witnesses: WalletWitness[];
}

/** The certificates the stake key witnesses: registration, deregistration and (vote) delegation. */
const STAKE_KEY_CERTIFICATES: ReadonlySet<Cardano.CertificateType> = new Set([
  Cardano.CertificateType.StakeRegistration,
  Cardano.CertificateType.StakeDeregistration,
  Cardano.CertificateType.Registration,
  Cardano.CertificateType.Unregistration,
  Cardano.CertificateType.StakeDelegation,
  Cardano.CertificateType.StakeRegistrationDelegation,
  Cardano.CertificateType.StakeVoteDelegation,
  Cardano.CertificateType.VoteDelegation,
  Cardano.CertificateType.VoteRegistrationDelegation,
  Cardano.CertificateType.StakeVoteRegistrationDelegation,
]);

/**
 * Every witness a transaction needs from the wallet's keys, the one rule `analyzeTransactionForSignatures`
 * (software wallets and the fee estimate) and the Keystone signer both follow:
 * - inputs and collateral by the payment or change key at the UTxO's address (`keyAtAddress`);
 * - the stake key for its stake certificates, and for pool ownerships and withdrawals of its
 *   reward account (`stakeKeyFor`);
 * - the DRep key for its DRep certificates and the votes it casts;
 * - the committee cold key for authorizing a hot key or resigning, and the hot key for its votes;
 * - each required signer the key set carries, payment and change keys first, then the stake,
 *   DRep and committee keys.
 * Each hash is signed by the key that has it, with the role it has there. A credential of a
 * script, or a hash the key set doesn't carry, is not the wallet's to sign: another party
 * signs for it (a multisig), and a key set with no cred of a kind owns none of that kind.
 */
export const walletWitnessPlan = (
  tx: Cardano.Tx,
  keys: KeySet,
  utxos: ReadonlyArray<Cardano.Utxo> | null | undefined,
): WalletWitnessPlan => {
  const utxoOf = utxoIndex(utxos);

  const inputs = tx.body.inputs.flatMap((txIn) => {
    const utxo = utxoOf(txIn);
    return utxo ? [{ utxo, key: keyAtAddress(keys, utxoAddress(utxo)) }] : [];
  });

  const witnesses = new Map<string, WalletWitness>();
  const add = (role: WitnessRole, key: Key | undefined, keyHash: string | undefined = key?.cred, address?: string) => {
    const hash = lower(keyHash);
    if (key && hash && !witnesses.has(hash)) witnesses.set(hash, { keyHash: hash, role, key, ...(address ? { address } : {}) });
  };

  // Collateral is witnessed like an input, by its key when no input's key already signs. A
  // transaction marked to fail is refused before this runs (isMarkedToFail).
  const inputPaths = new Set(inputs.flatMap(({ key }) => (key?.path ? [key.path] : [])));
  for (const txIn of tx.body.collaterals ?? []) {
    const utxo = utxoOf(txIn);
    const address = utxo && utxoAddress(utxo);
    const key = keyAtAddress(keys, address);
    if (key?.path && !inputPaths.has(key.path)) add('payment', key, key.cred || paymentKeyHash(address), address);
  }

  const drepKeys = [keys?.drep105, keys?.drep129];
  const ownReward = (account: Cardano.RewardAccount) => add('stake', stakeKeyFor(keys, account), rewardAccountKeyHash(account));

  for (const cert of tx.body.certificates ?? []) {
    switch (cert.__typename) {
      case Cardano.CertificateType.PoolRegistration:
        // Each owner of a registered pool signs its registration with that owner's stake key. The
        // pool cold key signs too; it is not one of the wallet's keys.
        cert.poolParameters.owners.forEach(ownReward);
        break;
      case Cardano.CertificateType.RegisterDelegateRepresentative:
      case Cardano.CertificateType.UpdateDelegateRepresentative:
      case Cardano.CertificateType.UnregisterDelegateRepresentative:
        add('drep', credentialKey(drepKeys, cert.dRepCredential));
        break;
      case Cardano.CertificateType.AuthorizeCommitteeHot:
      case Cardano.CertificateType.ResignCommitteeCold:
        // Witnessed by the cold credential: the hot credential an authorization names signs nothing.
        add('ccCold', credentialKey([keys?.ccCold], cert.coldCredential));
        break;
      default:
        if (STAKE_KEY_CERTIFICATES.has(cert.__typename) && 'stakeCredential' in cert) add('stake', stakeCredentialKey(keys, cert.stakeCredential));
    }
  }
  // One group per voter, so a batch of votes is one witness. A pool's vote is its cold key's.
  for (const { voter } of tx.body.votingProcedures ?? []) {
    if (voter.__typename === Cardano.VoterType.dRepKeyHash) add('drep', credentialKey(drepKeys, voter.credential));
    else if (voter.__typename === Cardano.VoterType.ccHotKeyHash) add('ccHot', credentialKey([keys?.ccHot], voter.credential));
  }
  for (const withdrawal of tx.body.withdrawals ?? []) ownReward(withdrawal.stakeAddress);

  for (const required of tx.body.requiredExtraSignatures ?? []) {
    const signer = requiredSignerKey(keys, required);
    if (signer) add(signer.role, signer.key, required);
  }

  return { inputs, witnesses: [...witnesses.values()] };
};
