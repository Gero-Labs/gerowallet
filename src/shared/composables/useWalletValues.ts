import { onBeforeUnmount, reactive, watch, type Ref } from 'vue';
import { WALLET_PENDING_MAX_WAIT_MS } from '@/api/market-api';
import type { LibraryWallet } from '@/services/walletLibrary/model';
import {
  VALUE_FRESH_MS,
  fetchWalletValue,
  hasPortfolioValue,
  readCachedValues,
  writeCachedValue,
  type WalletValue,
} from '@/services/walletLibrary/walletValues';

/** Requests to the portfolio server at a time, so a long wallet list doesn't burst. */
const MAX_CONCURRENT = 2;

/**
 * The value of every wallet in the wallet list (#1332), by stake address: the
 * last-known one at once, then the portfolio server's when it is older than
 * VALUE_FRESH_MS. A wallet the server is still indexing is asked again after
 * its hint, for up to WALLET_PENDING_MAX_WAIT_MS. Nothing is asked while
 * `enabled` is off.
 */
export function useWalletValues(wallets: Ref<LibraryWallet[]>, enabled: Ref<boolean>) {
  const values = reactive<Record<string, WalletValue>>({});
  const pending = reactive<Record<string, true>>({});
  const queue: string[] = [];
  const requested = new Set<string>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingSince = new Map<string, number>();
  let active = 0;
  let stopped = false;

  function pump() {
    while (!stopped && enabled.value && active < MAX_CONCURRENT && queue.length) {
      const stake = queue.shift()!;
      active += 1;
      fetchWalletValue(stake)
        .then((answer) => {
          if (stopped || !enabled.value) return;
          if (answer.state === 'ready') {
            delete pending[stake];
            pendingSince.delete(stake);
            if (answer.value) {
              values[stake] = answer.value;
              writeCachedValue(stake, answer.value);
            }
            return;
          }
          const since = pendingSince.get(stake) ?? Date.now();
          pendingSince.set(stake, since);
          if (Date.now() - since >= WALLET_PENDING_MAX_WAIT_MS) {
            delete pending[stake];
            return;
          }
          pending[stake] = true;
          retries.set(stake, setTimeout(() => {
            retries.delete(stake);
            queue.push(stake);
            pump();
          }, answer.retryAfterMs));
        })
        // A failed request keeps the last-known value; the next opening asks again.
        .catch(() => { delete pending[stake]; })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  function load() {
    if (!enabled.value) return;
    const cached = readCachedValues();
    for (const wallet of wallets.value) {
      const stake = wallet.stakeAddress;
      if (!hasPortfolioValue(wallet, stake) || requested.has(stake)) continue;
      requested.add(stake);
      const known = cached[stake];
      if (known) {
        const { fetchedAt: _fetchedAt, ...value } = known;
        values[stake] = value;
      }
      if (!known || Date.now() - known.fetchedAt >= VALUE_FRESH_MS) queue.push(stake);
    }
    pump();
  }

  function reset() {
    queue.length = 0;
    requested.clear();
    pendingSince.clear();
    retries.forEach(clearTimeout);
    retries.clear();
    for (const key of Object.keys(values)) delete values[key];
    for (const key of Object.keys(pending)) delete pending[key];
  }

  watch([() => wallets.value.map((wallet) => wallet.stakeAddress).join(','), enabled], ([, on]) => {
    if (on) load();
    else reset();
  }, { immediate: true });

  onBeforeUnmount(() => {
    stopped = true;
    reset();
  });

  return {
    /** The wallet's value, when known. */
    valueOf: (wallet: LibraryWallet): WalletValue | undefined => values[wallet.stakeAddress],
    /** Whether the server is still working out the wallet's value. */
    isPending: (wallet: LibraryWallet): boolean => !!pending[wallet.stakeAddress],
  };
}
