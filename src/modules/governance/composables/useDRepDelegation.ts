import { ref, type Ref } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { nexusTxApi, walletUtxosToNexusInputs } from '@/api/nexus-tx-api';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { isStakeKeyRegistered } from '@/shared/utils/stakeRegistration';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';
import { debugLog } from '@/utils/debug';

/**
 * Builds a vote-delegation transaction and hands it to the EXISTING
 * `DRepDelegateDialog`.
 *
 * The directory and the profile are two routes with one delegate button between
 * them, so the build lives here once and both mount the same dialog with the
 * same `{ drep, tx }` props it has always taken. This is the sole owner of the
 * flow: the pre-split `CardanoGovernance.vue`, which used to carry its own copy,
 * has been deleted now that the side-panel handoff is re-homed on the directory.
 *
 * The Nexus-vs-local branch is inherited from that surface and matters: Trezor
 * cannot sign the combined Conway certificates Nexus emits, so it keeps the
 * client-side builder. First-time stake registration folds the deposit in on
 * both paths.
 */

/** The shape `DRepDelegateDialog` reads. `hex` + `has_script` drive the certificate. */
export interface DelegateTarget {
  /** bech32 `drep_id`. Empty for the two predefined options, which carry no credential. */
  id: string;
  name?: string;
  image?: string;
  delegators?: number;
  votes?: number;
  voting_power?: bigint;
  /** 56-char credential hex. Required for a real DRep. */
  hex?: string;
  has_script?: boolean;
  /** Raw CIP-119 `references[]`; the dialog normalises them through `toSafeLinks`. */
  links?: unknown;
}

export type PredefinedDRep = 'abstain' | 'noConfidence';

export interface UseDRepDelegation {
  selectedDRep: Ref<DelegateTarget | undefined>;
  tx: Ref<Cardano.Tx | undefined>;
  isDialogOpen: Ref<boolean>;
  /** The id currently building, so only the clicked row spins. Null when idle. */
  building: Ref<string | null>;
  delegateToDRep: (target: DelegateTarget) => Promise<void>;
  delegateToPredefined: (kind: PredefinedDRep) => Promise<void>;
  closeDialog: () => void;
}

export function useDRepDelegation(): UseDRepDelegation {
  const { t } = useTranslation();

  const selectedDRep = ref<DelegateTarget | undefined>(undefined);
  const tx = ref<Cardano.Tx | undefined>(undefined);
  const isDialogOpen = ref(false);
  /** The id currently building, so only the clicked row shows a spinner. */
  const building = ref<string | null>(null);

  function closeDialog(): void {
    isDialogOpen.value = false;
  }

  /**
   * Build and open. `dRep` is the Conway certificate payload; `target` is what
   * the dialog renders; `nexusDrepId` is what the server-side builder takes.
   */
  async function build(
    target: DelegateTarget,
    dRep: Cardano.DelegateRepresentative,
    nexusDrepId: string,
  ): Promise<void> {
    const wallet = walletStore.loggedWallet;
    const keys = walletStore.keys;
    const epochParams = networkStore.epochParams;

    if (!wallet || !keys?.stake?.[0]?.cred || !keys?.payment?.[0]?.address) {
      snackbar.setError(String(t('governance.failedToInitiateDelegation')));
      return;
    }
    if (!epochParams) {
      snackbar.setError(String(t('common.epochParametersNotAvailable')));
      return;
    }

    building.value = target.id || nexusDrepId;
    selectedDRep.value = target;

    try {
      const stakeCredential: Cardano.Credential = {
        type: Cardano.CredentialType.KeyHash,
        hash: keys.stake[0].cred,
      };
      const registered = isStakeKeyRegistered(walletStore.account);
      const stakeKeyDeposit = BigInt(epochParams.stakeKeyDeposit);

      const certificate: Cardano.Certificate = registered
        ? ({
            __typename: Cardano.CertificateType.VoteDelegation,
            stakeCredential,
            dRep,
          } as Cardano.VoteDelegationCertificate)
        : ({
            __typename: Cardano.CertificateType.VoteRegistrationDelegation,
            stakeCredential,
            dRep,
            deposit: stakeKeyDeposit,
          } as Cardano.VoteRegistrationDelegationCertificate);

      if (featureFlagsStore.isNexusVoteDelegationEnabled() && wallet.type !== WalletType.Trezor) {
        const { tx_cbor } = await nexusTxApi.buildVoteDelegationTx(
          {
            stakeAddress: wallet.stakeAddress,
            drepId: nexusDrepId,
            changeAddress: keys.payment[0].address,
            utxos: walletUtxosToNexusInputs(walletStore.utxos as Cardano.Utxo[], walletStore.collateral),
            includeStakeRegistration: !registered,
          },
          wallet.network,
        );
        if (!tx_cbor) throw new Error('Nexus returned an empty transaction CBOR');
        tx.value = Serialization.Transaction.fromCbor(HexBlob(tx_cbor)).toCore();
      } else {
        tx.value = await buildCardanoTransaction({
          certificates: [certificate],
          utxos: walletStore.utxos as Cardano.Utxo[],
          epochParams,
          changeAddress: keys.payment[0].address,
          tip: networkStore.tip,
          implicitCoin: registered ? 0n : stakeKeyDeposit,
          walletContext: {
            keys,
            stakeAddress: wallet.stakeAddress,
            accountIndex: 0,
          },
        });
      }

      debugLog('useDRepDelegation: vote delegation transaction built');
      isDialogOpen.value = true;
    } catch (error) {
      console.error('Error building DRep delegation transaction:', error);
      snackbar.setError(
        `${t('errors.buildTransactionFailed')}: ${error instanceof Error ? error.message : t('errors.unknownError')}`,
      );
    } finally {
      building.value = null;
    }
  }

  async function delegateToDRep(target: DelegateTarget): Promise<void> {
    if (!target?.hex) {
      snackbar.setError(String(t('governance.failedToInitiateDelegation')));
      return;
    }
    const dRep = target.has_script
      ? Serialization.DRep.newScriptHash(target.hex)
      : Serialization.DRep.newKeyHash(target.hex);
    await build(target, dRep.toCore(), target.id);
  }

  async function delegateToPredefined(kind: PredefinedDRep): Promise<void> {
    const isAbstain = kind === 'abstain';
    const dRep = (
      isAbstain ? { __typename: 'AlwaysAbstain' } : { __typename: 'AlwaysNoConfidence' }
    ) as Cardano.DelegateRepresentative;

    await build(
      {
        id: '',
        name: String(t(isAbstain ? 'governance.abstain' : 'governance.noConfidence')),
        image: '',
        delegators: 0,
        votes: 0,
        voting_power: 0n,
      },
      dRep,
      isAbstain ? 'drep_always_abstain' : 'drep_always_no_confidence',
    );
  }

  return { selectedDRep, tx, isDialogOpen, building, delegateToDRep, delegateToPredefined, closeDialog };
}
