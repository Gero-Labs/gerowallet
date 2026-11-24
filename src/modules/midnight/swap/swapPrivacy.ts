// How the swap screens speak about private (shielded) legs: which side shows
// on the chain, the note under a form or a review, which offers the swap
// screens can withdraw, and what private balance is free to offer.

import { computed, type Ref } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { canProvePrivateSwap } from '@/chains/midnight/midnightSwapConfig';
import { sendProofServerPreference, walletProverFor } from '@/chains/midnight/midnightProvingTarget';
import { localProvingOffersHere } from '@/chains/midnight/geroProverFlag';
import { midnightShieldedKeysHosted } from '@/chains/midnight/midnightZkKeys';
import type { MidnightSwapLeg, MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import { swapTokenInfo } from './swapTokens';

type Translate = (key: string, values?: Record<string, unknown>) => string;

export const isPrivateLeg = (leg: Pick<MidnightSwapLeg, 'shielded'>): boolean => leg.shielded === true;

function symbols(legs: readonly MidnightSwapLeg[], network: string | null | undefined): string {
  return [...new Set(legs.map(leg => swapTokenInfo(leg.tokenType, network).symbol))].join(', ');
}

/** "Visible on Midnight": both sides, only the public side, or neither. */
export function swapVisibleText(legs: readonly MidnightSwapLeg[], network: string | null | undefined, t: Translate): string {
  const open = legs.filter(leg => !isPrivateLeg(leg));
  if (open.length === legs.length) return t('midnight.swap.visibleBoth');
  if (!open.length) return t('midnight.swap.visibleNone');
  return t('midnight.swap.visibleSideOnly', { token: symbols(open, network) });
}

/** The line under the make form and the take review: what is private, and NIGHT is always public. */
export function swapPrivacyNote(legs: readonly MidnightSwapLeg[], network: string | null | undefined, t: Translate): string {
  const hidden = legs.filter(isPrivateLeg);
  if (!hidden.length) return t('midnight.swap.publicNote');
  if (hidden.length === legs.length) return t('midnight.swap.privateNoteBoth');
  return t('midnight.swap.privateNote', { token: symbols(hidden, network), night: symbols(legs.filter(leg => !isPrivateLeg(leg)), network) });
}

/**
 * Whether the chosen prover can prove a private swap, as the worker decides it
 * (walletBg.withMidnightSwapKeys): a proof server, or this computer with the
 * hosted Zswap keys. The screens say so before asking for the password.
 */
export const privateSwapProverReady = computed(() => {
  const network = walletStore.loggedWallet?.network;
  if (!network) return false;
  const hosted = midnightShieldedKeysHosted();
  // On preprod a swap proves with the Local proof server only, whatever the stored choice.
  const prover = walletProverFor(network, sendProofServerPreference(network, midnightStore.proofServer), 'shielded', {
    shieldedOnDevice: hosted, ...localProvingOffersHere(),
  });
  return canProvePrivateSwap(prover, hosted);
});

/**
 * Whether the swap screens can withdraw `record`: a self-send of its public
 * coins. An offer that gives private coins is cancelled by spending them.
 */
export function canWithdrawSwapOffer(record: MidnightSwapOfferRecord): boolean {
  return record.inputs.length > 0 && !record.nullifiers?.length;
}

/**
 * The private balance free to offer, per token type: the private sync's
 * figures (the last complete ones while it catches up) less what the wallet's
 * open offers already give privately. `null` while there is no private sync.
 */
export function usePrivateSwapBalances(offers: Ref<readonly MidnightSwapOfferRecord[]>, now: Ref<number>) {
  return computed<ReadonlyMap<string, bigint> | null>(() => {
    if (midnightStore.privateSyncStatus === 'idle' || midnightStore.privateSyncStatus === 'error') return null;
    const totals = new Map<string, bigint>();
    for (const [type, value] of Object.entries(midnightStore.balances.shieldedTokens ?? {})) {
      totals.set(type.toLowerCase(), (totals.get(type.toLowerCase()) ?? 0n) + BigInt(value));
    }
    for (const record of offers.value) {
      if (record.status !== 'open' || now.value >= record.expiresAt) continue;
      for (const leg of record.gives) {
        if (!isPrivateLeg(leg)) continue;
        const left = (totals.get(leg.tokenType) ?? 0n) - BigInt(leg.amount);
        totals.set(leg.tokenType, left > 0n ? left : 0n);
      }
    }
    return totals;
  });
}
