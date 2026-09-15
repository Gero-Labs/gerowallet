import { computed, toRefs } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { buildVotingProcedures, VoteIntent } from '@/shared/utils/voteBuilder';
import { WalletType } from '@/models/types';

/** Which vote flows this wallet type can actually complete. */
export interface VotingCapability {
  canVote: boolean;
  canBatch: boolean;
  /** i18n key explaining the limitation — set whenever canVote or canBatch is false. */
  reasonKey?: string;
}

/**
 * The governance-vote capability matrix. Hardware support for Conway voting is
 * NOT uniform and cannot be made uniform, so the UI must surface a reason per
 * wallet type instead of letting the signing layer throw:
 *
 * - Ledger builds its transformer context with a hardcoded
 *   `chainId: Cardano.ChainIds.Mainnet` (ledger.ts:201), so a vote signed on
 *   any other network would target the wrong chain — blocked off-mainnet.
 *   On mainnet, single votes only until the multi-vote path is verified on
 *   the installed Cardano app version.
 * - Trezor's certificate mapper ends in a terminal throw for governance
 *   certs (trezor.ts:470) and GovTool lists Trezor as delegation-only.
 * - Keystone's extra-signer scan only keys on certificates/withdrawals and
 *   hardcodes the stake key path (keystone.ts:163-181, 253-278), so the DRep
 *   witness path never reaches the device.
 * - Watch wallets have no keys at all.
 */
export function votingCapability(
  walletType: string | undefined,
  network: string | undefined
): VotingCapability {
  switch (walletType) {
    case WalletType.Ledger:
      if (network !== 'mainnet') {
        return { canVote: false, canBatch: false, reasonKey: 'governance.ledgerPreprodUnsupported' };
      }
      return { canVote: true, canBatch: false, reasonKey: 'governance.ledgerSingleVoteOnly' };
    case WalletType.Trezor:
      return { canVote: false, canBatch: false, reasonKey: 'governance.trezorVotingUnsupported' };
    case WalletType.Keystone:
      return { canVote: false, canBatch: false, reasonKey: 'governance.keystoneVotingUnsupported' };
    case WalletType.Watch:
      return { canVote: false, canBatch: false, reasonKey: 'governance.watchWalletReadOnly' };
    default:
      // Normal (password + PRF PassKey) and Google (MPC) sign in software and
      // support the full flow. An untyped legacy record is a Normal wallet.
      return { canVote: true, canBatch: true };
  }
}

/**
 * Composable for casting Conway governance votes as a registered DRep.
 *
 * Mirrors useDelegation: assemble `buildCardanoTransaction` arguments from
 * walletStore/networkStore and hand the UNSIGNED transaction onward. Signing
 * and submission stay on the existing shared path (TransactionAuthSection /
 * useTransactionSigning) so every auth method keeps working.
 */
export function useVoting() {
  const { loggedWallet, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const capability = computed<VotingCapability>(() =>
    votingCapability(loggedWallet.value?.type, loggedWallet.value?.network)
  );

  /**
   * Build the unsigned vote transaction for one or more votes from this
   * wallet's DRep. Throws (never silently no-ops) when the wallet cannot
   * vote or has no DRep key — the dialog gates on `capability` first, so a
   * throw here means a caller skipped the gate.
   */
  const castVotes = async (votes: VoteIntent[]): Promise<Cardano.Tx> => {
    const cap = capability.value;
    if (!cap.canVote) {
      throw new Error(`This wallet cannot cast votes (${cap.reasonKey ?? 'unsupported wallet type'})`);
    }

    // drep129 is an array like every other key list; a wallet that never
    // derived a DRep key has an empty one — guard it, don't index blindly.
    const drepId = keys.value?.drep129?.[0]?.address;
    if (!drepId) {
      throw new Error('This wallet has no DRep key — register as a DRep before voting');
    }

    if (!epochParams.value) {
      throw new Error('Epoch parameters not available');
    }

    const votingProcedures = buildVotingProcedures(drepId, votes);

    return buildCardanoTransaction({
      votingProcedures,
      utxos: utxos.value as Cardano.Utxo[],
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value?.stakeAddress || '',
        accountIndex: 0,
      },
    });
  };

  return {
    capability,
    castVotes,
  };
}
