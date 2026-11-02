// The keys a Trezor is asked to witness, as trezor-connect works them out from a sign request:
// its own transforms and `gatherWitnessPaths`, so a test checks the device's witness set rather
// than restating connect's rules (which element paths it witnesses, in which signing mode).
import type * as Trezor from '@trezor/connect';
import { gatherWitnessPaths } from '@trezor/connect/lib/api/cardano/cardanoWitnesses';
import { transformCertificate } from '@trezor/connect/lib/api/cardano/cardanoCertificate';
import { transformCollateralInput, transformInput } from '@trezor/connect/lib/api/cardano/cardanoInputs';
import { getSerializedPath, validatePath } from '@trezor/connect/lib/utils/pathUtils';

/** Every key path the device witnesses for `request`, as m/… strings in the order connect asks. */
export const deviceWitnessPaths = (request: Trezor.CardanoSignTransaction): string[] =>
  gatherWitnessPaths(
    request.inputs.map(transformInput),
    (request.certificates ?? []).map(transformCertificate),
    (request.withdrawals ?? []).map((withdrawal) => ({
      path: withdrawal.path ? validatePath(withdrawal.path, 5) : undefined,
      amount: withdrawal.amount,
      script_hash: withdrawal.scriptHash,
      key_hash: withdrawal.keyHash,
    })),
    (request.collateralInputs ?? []).map(transformCollateralInput),
    (request.requiredSigners ?? []).map((signer) => ({
      key_path: signer.keyPath ? validatePath(signer.keyPath, 3) : undefined,
      key_hash: signer.keyHash,
    })),
    (request.additionalWitnessRequests ?? []).map((path) => validatePath(path, 3)),
    request.signingMode,
  ).map((path) => getSerializedPath(path));
