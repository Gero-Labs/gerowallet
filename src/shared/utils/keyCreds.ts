import { Cardano } from '@cardano-sdk/core';
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

/** The payment or change key at an address, as an input or collateral UTxO there is signed. */
export const keyAtAddress = (keys: KeySet, address: string | undefined): Key | undefined =>
  address
    ? keyList(keys?.payment).find((key) => key.address === address) ?? keyList(keys?.change).find((key) => key.address === address)
    : undefined;

/**
 * The lowercase key hash of a reward account whose credential is a key hash. Undefined for a
 * script's reward account or an unparseable one, which no key of the wallet signs for.
 */
export const rewardAccountKeyHash = (account: string): string | undefined => {
  try {
    const credential = Cardano.Address.fromBech32(account).asReward()?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.KeyHash ? credential.hash.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The stake key of the key set a reward account belongs to: the one carrying its key hash, else
 * the one at that address (when it carries no other hash). The signers and the approval card
 * decide a withdrawal, pool ownership or proposal deposit account is the wallet's by this.
 */
export const stakeKeyFor = (keys: KeySet, account: string): Key | undefined => {
  const hash = rewardAccountKeyHash(account);
  if (!hash) return undefined;
  const stake = keyList(keys?.stake);
  return stake.find((key) => lower(key.cred) === hash)
    ?? stake.find((key) => key.address === account && (!key.cred || lower(key.cred) === hash));
};

/** The role of a key that witnesses a transaction, as `analyzeTransactionForSignatures` names it. */
export type WitnessRole = 'payment' | 'stake' | 'drep' | 'ccCold' | 'ccHot';

/** A witness from the wallet beyond its inputs: the key hash it is for, and the key that has it. */
export interface WalletWitness {
  keyHash: string;
  role: WitnessRole;
  key: Key;
}

/** What a transaction needs the wallet's keys for, worked out once for every signer. */
export interface WalletWitnessPlan {
  /** Each input whose UTxO is known, with the payment or change key at its address, if any. */
  inputs: Array<{ utxo: Cardano.Utxo; key: Key | undefined }>;
  /** Keys at a collateral UTxO's address that sign no input. */
  collateralKeys: Key[];
  /** Every other witness, one per key hash. */
  witnesses: WalletWitness[];
  /** A pool registration or retirement, or a pool's vote: the pool cold key signs too. */
  needsPoolColdKey: boolean;
}

/**
 * Every witness a transaction needs from the wallet's keys, the one rule `analyzeTransactionForSignatures`
 * (software wallets and the fee estimate) and the Keystone signer both follow:
 * - inputs and collateral by the payment or change key at the UTxO's address;
 * - the stake key for certificates of its stake credential, and for pool ownerships and
 *   withdrawals of its reward account (`stakeKeyFor`);
 * - the DRep key for its DRep certificates and the votes it casts;
 * - the committee cold key for authorizing a hot key or resigning, and the hot key for its votes;
 * - each required signer the key set carries, payment and change keys first, then the stake,
 *   DRep and committee keys.
 * Each hash is signed by the key that has it, with the role it has there. A credential of a
 * script, or a hash the key set doesn't carry, is not the wallet's to sign: another party
 * signs for it (a multisig), and a key set with no cred of a kind owns none of that kind.
 */
export const walletWitnessPlan = (tx: Cardano.Tx, keys: KeySet, utxos: ReadonlyArray<Cardano.Utxo>): WalletWitnessPlan => {
  // Indexed once by `txId#index`, the first of any duplicate kept, as a scan would find it.
  const utxoByRef = new Map<string, Cardano.Utxo>();
  utxos.forEach((utxo) => {
    const ref = `${utxo[0].txId}#${utxo[0].index}`;
    if (!utxoByRef.has(ref)) utxoByRef.set(ref, utxo);
  });
  const utxoOf = (txIn: Cardano.TxIn) => utxoByRef.get(`${txIn.txId}#${txIn.index}`);
  const addressOf = ([txIn, txOut]: Cardano.Utxo) => txIn.address || txOut.address;

  const inputs = tx.body.inputs.flatMap((txIn) => {
    const utxo = utxoOf(txIn);
    return utxo ? [{ utxo, key: keyAtAddress(keys, addressOf(utxo)) }] : [];
  });
  const inputPaths = new Set(inputs.flatMap(({ key }) => (key?.path ? [key.path] : [])));
  const collateralKeys = (tx.body.collaterals ?? []).flatMap((txIn) => {
    const utxo = utxoOf(txIn);
    const key = utxo && keyAtAddress(keys, addressOf(utxo));
    return key?.path && !inputPaths.has(key.path) ? [key] : [];
  });

  const witnesses = new Map<string, WalletWitness>();
  const add = (role: WitnessRole, key: Key | undefined, keyHash: string | undefined = key?.cred) => {
    const hash = lower(keyHash);
    if (key && hash && !witnesses.has(hash)) witnesses.set(hash, { keyHash: hash, role, key });
  };
  const stakeKeys = [keys?.stake];
  const drepKeys = [keys?.drep105, keys?.drep129];
  // The key of `lists` carrying a credential's hash, when that credential is a key hash.
  const keyFor = (lists: Array<ReadonlyArray<Key> | null | undefined>, credential: Cardano.Credential | undefined) => {
    if (credential?.type !== Cardano.CredentialType.KeyHash) return undefined;
    const hash = lower(credential.hash);
    return lists.flatMap(keyList).find((key) => lower(key.cred) === hash);
  };
  const ownReward = (account: Cardano.RewardAccount) => add('stake', stakeKeyFor(keys, account), rewardAccountKeyHash(account));

  let needsPoolColdKey = false;
  for (const cert of tx.body.certificates ?? []) {
    switch (cert.__typename) {
      case Cardano.CertificateType.PoolRegistration:
        // Each owner of a registered pool signs its registration with that owner's stake key.
        cert.poolParameters.owners.forEach(ownReward);
        needsPoolColdKey = true;
        break;
      case Cardano.CertificateType.PoolRetirement:
        needsPoolColdKey = true;
        break;
      case Cardano.CertificateType.RegisterDelegateRepresentative:
      case Cardano.CertificateType.UpdateDelegateRepresentative:
      case Cardano.CertificateType.UnregisterDelegateRepresentative:
        add('drep', keyFor(drepKeys, cert.dRepCredential));
        break;
      case Cardano.CertificateType.AuthorizeCommitteeHot:
      case Cardano.CertificateType.ResignCommitteeCold:
        // Witnessed by the cold credential: the hot credential an authorization names signs nothing.
        add('ccCold', keyFor([keys?.ccCold], cert.coldCredential));
        break;
      default:
        // Every stake (and Conway vote-delegation) certificate carries its stake credential.
        if ('stakeCredential' in cert) add('stake', keyFor(stakeKeys, cert.stakeCredential));
    }
  }
  // One group per voter, so a batch of votes is one witness.
  for (const { voter } of tx.body.votingProcedures ?? []) {
    if (voter.__typename === Cardano.VoterType.dRepKeyHash) add('drep', keyFor(drepKeys, voter.credential));
    else if (voter.__typename === Cardano.VoterType.ccHotKeyHash) add('ccHot', keyFor([keys?.ccHot], voter.credential));
    // The pool cold key lives outside the HD tree, so it is flagged, not resolved to a key.
    else if (voter.__typename === Cardano.VoterType.stakePoolKeyHash) needsPoolColdKey = true;
  }
  for (const withdrawal of tx.body.withdrawals ?? []) ownReward(withdrawal.stakeAddress);

  const byRole: Array<[WitnessRole, ReadonlyArray<Key> | null | undefined]> = [
    ['payment', keys?.payment], ['payment', keys?.change], ['stake', keys?.stake], ['drep', keys?.drep105],
    ['drep', keys?.drep129], ['ccCold', keys?.ccCold], ['ccHot', keys?.ccHot],
  ];
  for (const required of tx.body.requiredExtraSignatures ?? []) {
    const hash = lower(required);
    for (const [role, list] of byRole) {
      const key = keyList(list).find((k) => lower(k.cred) === hash);
      if (key) {
        add(role, key, hash);
        break;
      }
    }
  }

  return { inputs, collateralKeys, witnesses: [...witnesses.values()], needsPoolColdKey };
};
