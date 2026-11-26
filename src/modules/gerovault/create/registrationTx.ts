/**
 * The optional CIP-0146 registration of a new vault: a transaction from this wallet to itself,
 * paid and signed with the wallet's normal keys, whose auxiliary data carries the registration
 * under label 1854 and both native scripts. It lets every participant's wallet find the vault from
 * its own recovery phrase later. It publishes the scripts and nothing else: no vault or cosigner
 * names, which would be public on chain (CIP-83 encryption with the default passphrase hides
 * nothing).
 *
 * Built with the wallet's own builder (`buildCardanoTransaction`) and signed and submitted through
 * the wallet's own signing path (`useTransactionSigning`), as every other self-transaction.
 */
import type { Cardano } from '@cardano-sdk/core';
import { encodeRegistration, type VaultScripts } from '@/shared/gerovault';
import { buildCardanoTransaction } from '@/shared/utils/builder';

/** Label 1854 with the registration (`types` only) and the payment and stake scripts, in that order. */
export function registrationAuxiliaryData(scripts: Pick<VaultScripts, 'payment' | 'stake'>): Cardano.AuxiliaryData {
  const registration = encodeRegistration(scripts);
  return {
    blob: new Map([[registration.label, registration.metadatum]]),
    scripts: [...registration.nativeScripts],
  };
}

export type RegistrationTxInput = Omit<Parameters<typeof buildCardanoTransaction>[0], 'auxiliaryData' | 'outputs' | 'certificates' | 'withdrawals' | 'votingProcedures'>;

/** The unsigned registration transaction: no outputs but the change back to this wallet. */
export function buildRegistrationTx(scripts: Pick<VaultScripts, 'payment' | 'stake'>, input: RegistrationTxInput): Promise<Cardano.Tx> {
  return buildCardanoTransaction({ ...input, auxiliaryData: registrationAuxiliaryData(scripts) });
}
