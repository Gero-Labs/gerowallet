import { computed, reactive, toRefs } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { buildVotingProcedures, VoteIntent } from '@/shared/utils/voteBuilder';
import { WalletType } from '@/models/types';
import blockchainApi from '@/api/blockchain-api';
import { debugLog } from '@/utils/debug';

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
 * - Ledger: blocked off-mainnet, where hardware wallets do not pair
 *   (`supportedHardware` in networks.ts). On mainnet, single votes only until
 *   the multi-vote path is verified on the installed Cardano app version.
 * - Trezor's certificate mapper ends in a terminal throw for governance
 *   certs (trezor.ts:470) and GovTool lists Trezor as delegation-only.
 * - Keystone: the sign request asks for the DRep key on the wallet's own DRep
 *   votes (`walletSigners` in keystone.ts), and the firmware parses votes, but
 *   no vote has been signed on a device yet, so voting stays off until one is.
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
 * Whether the logged wallet's DRep is registered on chain, shared by every
 * caller so the list, the detail CTA and the dialog agree. Keyed by DRep id,
 * chain and network so a wallet switch never inherits another wallet's answer.
 */
const drepRegistration = reactive<{
  key: string;
  registered: boolean;
  loaded: boolean;
  inflight: { key: string; promise: Promise<boolean> } | null;
}>({ key: '', registered: false, loaded: false, inflight: null });

function registrationKey(drepId: string, chain: string, network: string): string {
  return `${drepId}|${chain}|${network}`;
}

/**
 * Look up whether `drepId` is registered on chain. `registered === true`, not
 * `!!record`: a retired DRep still returns a row carrying `registered: false`.
 * `active: false` is only an inactivity expiry; an inactive DRep may still
 * vote (that is how it becomes active again), so liveness must NOT gate this.
 * A failed lookup reads as unregistered and is not cached, so the next call
 * retries. Erring toward false is the cheap direction: the node rejects a
 * vote from an unknown voter.
 */
async function lookupDrepRegistration(drepId: string, chain: string, network: string): Promise<boolean> {
  const key = registrationKey(drepId, chain, network);
  if (drepRegistration.inflight?.key === key) return drepRegistration.inflight.promise;
  const promise = (async () => {
    try {
      const record = await blockchainApi.getDRepById(drepId, chain, network);
      const registered = record?.registered === true;
      Object.assign(drepRegistration, { key, registered, loaded: true });
      return registered;
    } catch (error) {
      debugLog('useVoting: DRep registration lookup failed', error);
      Object.assign(drepRegistration, { key, registered: false, loaded: false });
      return false;
    } finally {
      if (drepRegistration.inflight?.key === key) drepRegistration.inflight = null;
    }
  })();
  drepRegistration.inflight = { key, promise };
  return promise;
}

/** Test seam: forget the shared registration answer. */
export function resetDrepRegistration(): void {
  Object.assign(drepRegistration, { key: '', registered: false, loaded: false, inflight: null });
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

  // drep129 is an array like every other key list; a watch wallet has an empty one.
  const drepId = computed(() => keys.value?.drep129?.[0]?.address ?? '');

  const currentKey = computed(() =>
    drepId.value && loggedWallet.value
      ? registrationKey(drepId.value, loggedWallet.value.chain, loggedWallet.value.network)
      : '',
  );

  /**
   * True only once a lookup for THIS wallet's DRep came back `registered: true`.
   * Having a derived DRep key is not registration: every software HD wallet
   * derives one, and the node rejects votes from unregistered credentials.
   */
  const isRegisteredDrep = computed(
    () => !!currentKey.value && drepRegistration.key === currentKey.value && drepRegistration.registered,
  );

  /**
   * Fetch the registration for the logged wallet's DRep. Callers run this on
   * mount, so a wallet that registers and comes back sees the new state.
   */
  const loadDrepRegistration = async (): Promise<boolean> => {
    if (!drepId.value || !loggedWallet.value) return false;
    return lookupDrepRegistration(drepId.value, loggedWallet.value.chain, loggedWallet.value.network);
  };

  /**
   * Build the unsigned vote transaction for one or more votes from this
   * wallet's DRep. Throws (never silently no-ops) when the wallet cannot
   * vote, has no DRep key, or that DRep is not registered on chain — the UI
   * gates on `capability` and `isRegisteredDrep` first, so a throw here means
   * a caller skipped the gate.
   */
  const castVotes = async (votes: VoteIntent[]): Promise<Cardano.Tx> => {
    const cap = capability.value;
    if (!cap.canVote) {
      throw new Error(`This wallet cannot cast votes (${cap.reasonKey ?? 'unsupported wallet type'})`);
    }

    // drep129 is an array like every other key list; a wallet that never
    // derived a DRep key has an empty one — guard it, don't index blindly.
    const drepIdValue = drepId.value;
    if (!drepIdValue) {
      throw new Error('This wallet has no DRep key. Register as a DRep before voting');
    }

    // Defense in depth for any caller that skips the UI gate: reuse a loaded
    // answer for this wallet, otherwise look it up now.
    const registered =
      drepRegistration.loaded && drepRegistration.key === currentKey.value
        ? drepRegistration.registered
        : await loadDrepRegistration();
    if (!registered) {
      throw new Error("This wallet's DRep is not registered on chain. Register as a DRep before voting");
    }

    if (!epochParams.value) {
      throw new Error('Epoch parameters not available');
    }

    const votingProcedures = buildVotingProcedures(drepIdValue, votes);

    return buildCardanoTransaction({
      votingProcedures,
      utxos: utxos.value as Cardano.Utxo[],
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      walletContext: {
        keys: keys.value,
      },
    });
  };

  return {
    capability,
    isRegisteredDrep,
    loadDrepRegistration,
    castVotes,
  };
}
