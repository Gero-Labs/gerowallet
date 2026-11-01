/**
 * Which of the wallet's keys a Trezor signs a Cardano transaction with, by the rule the software
 * signer and the Keystone follow (`walletWitnessPlan` and its helpers in keyCreds.ts). Trezor's
 * request is per element, so each input, certificate, withdrawal and required signer carries the
 * wallet's key by its path, or another party's credential by its hash; the device witnesses
 * every path the request carries. Shared by the service-worker signer (trezor.ts) and the
 * document one (trezorWeb.ts).
 *
 * The firmware has no DRep or committee certificates and no governance votes, so those keys sign
 * only as required signers (any CIP-1852 path is a valid required signer there).
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import type { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import * as Trezor from '@trezor/connect';
import type { Key, Keys } from '@/models/types';
import { MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE, TREZOR_GOVERNANCE_REFUSAL_MESSAGE } from '@/chrome/config';
import { debugLog } from '@/utils/debug';
import {
  isMarkedToFail,
  keyAtAddress,
  requiredSignerKey,
  stakeCredentialKey,
  stakeKeyFor,
  utxoAddress,
  utxoIndex,
  walletWitnessPlan,
} from '@/shared/utils/keyCreds';

/** The keys a Trezor request is built from: the wallet's key set and its UTxOs. */
export interface TrezorKeyContext {
  keys: Keys;
  utxoOf: (txIn: Cardano.TxIn) => Cardano.Utxo | undefined;
}

export const trezorKeyContext = (keys: Keys, utxos: ReadonlyArray<Cardano.Utxo> | null | undefined): TrezorKeyContext =>
  ({ keys, utxoOf: utxoIndex(utxos) });

/** A credential as Trezor takes it: the wallet's own key by its path, anyone else's by its hash. */
type TrezorCredential = { path?: string; keyHash?: string; scriptHash?: string };

const credentialFor = (key: Key | undefined, credential: Cardano.Credential): TrezorCredential => {
  if (key?.path) return { path: key.path };
  return credential.type === Cardano.CredentialType.ScriptHash ? { scriptHash: credential.hash } : { keyHash: credential.hash };
};

/**
 * Refuses, before the device is asked, what a Trezor cannot sign faithfully:
 * - a transaction marked to fail (isValid: false). It only forfeits its collateral, which an
 *   input's witness can authorise, and the device's request has no field to show the flag;
 * - a body with governance votes, proposals or treasury fields. The request cannot carry them, so
 *   the device would serialize, show and sign a different body.
 */
export const assertTrezorCanSign = (tx: Serialization.Transaction): void => {
  if (isMarkedToFail({ isValid: tx.isValid() })) throw new Error(MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE);
  const body = tx.body().toCore();
  if (body.votingProcedures?.length || body.proposalProcedures?.length || body.treasuryValue !== undefined || body.donation !== undefined) {
    throw new Error(TREZOR_GOVERNANCE_REFUSAL_MESSAGE);
  }
};

/** Inputs (and collateral) with the path of the payment or change key at each UTxO's address. */
export const trezorInputs = (txIns: Cardano.TxIn[], context: TrezorKeyContext): Trezor.CardanoInput[] =>
  txIns.map((txIn) => {
    const utxo = context.utxoOf(txIn);
    const path = utxo ? keyAtAddress(context.keys, utxoAddress(utxo))?.path || undefined : undefined;
    return { path, prev_hash: txIn.txId, prev_index: txIn.index };
  });

/** Reference inputs: read, not spent, so no key signs for them. */
export const trezorReferenceInputs = (txIns: Cardano.TxIn[]): Trezor.CardanoInput[] =>
  txIns.map((txIn) => ({ prev_hash: txIn.txId, prev_index: txIn.index }));

const mapDRep = (dRep: Cardano.DelegateRepresentative | undefined): Trezor.CardanoDRep | undefined => {
  if (!dRep) return undefined;

  // DelegateRepresentative is a discriminated union of Credential | AlwaysAbstain | AlwaysNoConfidence
  if ('__typename' in dRep) {
    switch (dRep.__typename) {
      case 'AlwaysAbstain':
        return { type: Trezor.PROTO.CardanoDRepType.ABSTAIN };
      case 'AlwaysNoConfidence':
        return { type: Trezor.PROTO.CardanoDRepType.NO_CONFIDENCE };
    }
  }

  if ('type' in dRep && 'hash' in dRep) {
    return {
      type: dRep.type === Cardano.CredentialType.KeyHash
        ? Trezor.PROTO.CardanoDRepType.KEY_HASH
        : Trezor.PROTO.CardanoDRepType.SCRIPT_HASH,
      keyHash: dRep.type === Cardano.CredentialType.KeyHash ? dRep.hash : undefined,
      scriptHash: dRep.type === Cardano.CredentialType.ScriptHash ? dRep.hash : undefined,
    };
  }

  return undefined;
};

const combinedCertificateError = (type: string, parts: string) => new Error(
  `[Trezor] Combined certificate type '${type}' is not supported by Trezor hardware. ` +
  `This operation requires separate certificates for ${parts}. ` +
  'Please try again or contact support if the issue persists.',
);

/**
 * Certificates in Trezor's form. A stake credential is the wallet's stake key by its path only when
 * that key carries the credential's hash; another key's credential goes by its key hash and a
 * script's by its script hash, so the device builds the certificate the transaction holds. (The
 * firmware takes a hash only in a Plutus transaction and refuses one elsewhere, rather than
 * signing a body it did not show.)
 */
export const trezorCertificates = (certificates: Cardano.Certificate[] | undefined, context: TrezorKeyContext): Trezor.CardanoCertificate[] | undefined => {
  if (!certificates || certificates.length === 0) return undefined;

  return certificates.map((cert: Cardano.Certificate, index) => {
    debugLog(`[TREZOR] Processing certificate ${index}: ${cert.__typename}`);
    const stake = (credential: Cardano.Credential) => credentialFor(stakeCredentialKey(context.keys, credential), credential);

    switch (cert.__typename) {
      case Cardano.CertificateType.VoteDelegation:
        return { type: Trezor.PROTO.CardanoCertificateType.VOTE_DELEGATION, ...stake(cert.stakeCredential), dRep: mapDRep(cert.dRep) };
      case Cardano.CertificateType.StakeDelegation:
        return { type: Trezor.PROTO.CardanoCertificateType.STAKE_DELEGATION, ...stake(cert.stakeCredential), pool: Cardano.PoolId.toKeyHash(cert.poolId) };
      case Cardano.CertificateType.Registration:
        return { type: Trezor.PROTO.CardanoCertificateType.STAKE_REGISTRATION_CONWAY, ...stake(cert.stakeCredential), deposit: cert.deposit?.toString() };
      case Cardano.CertificateType.StakeRegistration:
        return { type: Trezor.PROTO.CardanoCertificateType.STAKE_REGISTRATION, ...stake(cert.stakeCredential) };
      case Cardano.CertificateType.Unregistration:
        return { type: Trezor.PROTO.CardanoCertificateType.STAKE_DEREGISTRATION_CONWAY, ...stake(cert.stakeCredential), deposit: cert.deposit?.toString() };
      case Cardano.CertificateType.StakeDeregistration:
        return { type: Trezor.PROTO.CardanoCertificateType.STAKE_DEREGISTRATION, ...stake(cert.stakeCredential) };
      // Trezor firmware has no combined certificates: they must be split into their parts.
      case Cardano.CertificateType.StakeVoteRegistrationDelegation:
      case Cardano.CertificateType.StakeRegistrationDelegation:
      case Cardano.CertificateType.VoteRegistrationDelegation:
        throw combinedCertificateError(cert.__typename, 'registration and delegation');
      case Cardano.CertificateType.StakeVoteDelegation:
        throw combinedCertificateError(cert.__typename, 'stake and vote delegation');
      default:
        throw new Error(`Unsupported certificate type: ${cert.__typename}`);
    }
  });
};

/** Withdrawals: the wallet's own reward account by its stake key's path (`stakeKeyFor`), any other by its hash. */
export const trezorWithdrawals = (withdrawals: Cardano.Withdrawal[] | undefined, context: TrezorKeyContext): Trezor.CardanoWithdrawal[] | undefined =>
  withdrawals?.map((withdrawal) => {
    const rewardAddress = Cardano.Address.fromString(withdrawal.stakeAddress)?.asReward();
    if (!rewardAddress) throw new Error('Invalid withdrawal stake address');
    const credential = rewardAddress.getPaymentCredential();
    return { amount: withdrawal.quantity.toString(), ...credentialFor(stakeKeyFor(context.keys, withdrawal.stakeAddress), credential) };
  });

/** Required signers: a key the key set carries by its path (`requiredSignerKey`), another party's by its hash. */
export const trezorRequiredSigners = (requiredSigners: Ed25519KeyHashHex[] | undefined, context: TrezorKeyContext): Trezor.CardanoRequiredSigner[] | undefined => {
  if (!requiredSigners || requiredSigners.length === 0) return undefined;
  return requiredSigners.map((keyHash) => {
    const keyPath = requiredSignerKey(context.keys, keyHash)?.key.path;
    return keyPath ? { keyHash: undefined, keyPath } : { keyHash, keyPath: undefined };
  });
};

/** Every path the wallet signs a transaction with by the shared plan: its inputs' keys, then each other witness. */
export const walletWitnessPaths = (tx: Cardano.Tx, keys: Keys, utxos: ReadonlyArray<Cardano.Utxo> | null | undefined): string[] => {
  const plan = walletWitnessPlan(tx, keys, utxos);
  const paths = [...plan.inputs.map(({ key }) => key?.path), ...plan.witnesses.map(({ key }) => key.path)];
  return [...new Set(paths.filter((path): path is string => !!path))];
};

type TrezorRequest = Pick<Trezor.CardanoSignTransaction, 'inputs' | 'collateralInputs' | 'certificates' | 'withdrawals' | 'requiredSigners'>;

/**
 * The wallet's witnesses the request doesn't already make the device produce. Connect witnesses
 * each path the request carries (`gatherWitnessPaths` in @trezor/connect): inputs, collateral
 * (Plutus transactions), withdrawals, required signers, and every certificate but a pre-Conway
 * stake registration, which needs no witness on chain. The shared plan witnesses that one too, so
 * its stake key is asked for here.
 */
export const extraWitnessRequests = (request: TrezorRequest, walletPaths: string[]): string[] | undefined => {
  const carried = new Set<string>();
  const carry = (path: unknown) => { if (typeof path === 'string') carried.add(path); };
  request.inputs.forEach(({ path }) => carry(path));
  request.collateralInputs?.forEach(({ path }) => carry(path));
  request.withdrawals?.forEach(({ path }) => carry(path));
  request.requiredSigners?.forEach(({ keyPath }) => carry(keyPath));
  request.certificates?.forEach(({ type, path }) => {
    if (type !== Trezor.PROTO.CardanoCertificateType.STAKE_REGISTRATION) carry(path);
  });
  const extra = walletPaths.filter((path) => !carried.has(path));
  return extra.length > 0 ? extra : undefined;
};

/** A CIP-1852 key path's role and index under its account, as an account xpub derives the key. */
export const accountKeyIndices = (path: string): { role: number; index: number } => {
  const [role, index] = path.split('/').slice(-2).map((part) => Number(part.replace(/'$/, '')));
  return { role, index };
};
