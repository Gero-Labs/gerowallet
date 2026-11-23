import { computed } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { Blockchain, Network, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { stakeKeyFor } from '@/shared/utils/keyCreds';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { holderAnswerFields } from '@/shared/utils/holderAnswers';
import type { VoteIntent } from '@/shared/utils/voteBuilder';
import { parseGovActionId } from '@/shared/utils/govActionId';
import { checkHolderAnswers } from '@/api/holderAnswers';
import { assertStakeWalletUnchanged } from '@/shared/composables/refreshStakeAccount';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { GovProposal } from '@/api/governance.types';

export function mayAnswerAction(action: GovProposal, epoch: number | null): boolean {
  return !!action && (action.status === 'active' || action.status === 'ratified') &&
    (action.expiresEpoch == null || epoch == null || epoch < action.expiresEpoch);
}

export function useHolderAnswers() {
  const { t } = useTranslation();
  const stakeKey = computed(() => stakeKeyFor(walletStore.keys, walletStore.loggedWallet?.stakeAddress));
  const canAnswer = computed(() => {
    const wallet = walletStore.loggedWallet;
    if (!featureFlagsStore.isGovernanceVotingEnabled() || wallet?.chain !== Blockchain.CARDANO ||
      ![Network.MAINNET, Network.PREPROD].includes(wallet.network) ||
      !stakeKey.value?.cred || !stakeKey.value.path || !walletStore.keys?.payment?.[0]?.address) return false;
    const software = wallet.type === WalletType.Normal || wallet.type === WalletType.Google;
    const hardware = [WalletType.Ledger, WalletType.Trezor, WalletType.Keystone].includes(wallet.type);
    return software || (hardware && wallet.network === Network.MAINNET);
  });

  async function prepareAnswers(answers: VoteIntent[], titleFor: (id: string) => string): Promise<Cardano.Tx> {
    const { loggedWallet: wallet, keys } = walletStore;
    if (!canAnswer.value || !keys?.payment?.[0]?.address) throw new Error(t('staking.noStakeAddress'));
    const identity = { id: wallet.id, network: wallet.network, stakeAddress: wallet.stakeAddress };
    const fields = holderAnswerFields(stakeKey.value.cred, answers);
    const ids = answers.map(a => parseGovActionId(a.govActionId));
    let check: Awaited<ReturnType<typeof checkHolderAnswers>>;
    try {
      check = await checkHolderAnswers(identity.stakeAddress, identity.network, ids);
    } catch {
      throw new Error(t('governance.holderCheckFailed'));
    }
    assertStakeWalletUnchanged(identity, t);
    if (check.blocked.length) {
      throw new Error(check.blocked.map(({ id, reason }) => t(reason, { title: titleFor(id) })).join(' '));
    }
    const tx = await buildCardanoTransaction({
      ...fields, invalidHereafter: check.invalidHereafter, tip: { slot: check.slot },
      utxos: walletStore.utxos as Cardano.Utxo[], epochParams: networkStore.epochParams,
      changeAddress: keys.payment[0].address, walletContext: { keys },
    });
    assertStakeWalletUnchanged(identity, t);
    return tx;
  }
  return { canAnswer, prepareAnswers };
}
