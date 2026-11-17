/**
 * "Refreshing" for Midnight views (midnightRefresh.ts): a rebuild is running,
 * and the balances and history in the store are the snapshot of what the
 * wallet showed before it.
 */
import { computed, type ComputedRef } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { useTranslation } from './useTranslation';
import type { MidnightRefreshReason, MidnightRefreshTip } from '@/chains/midnight/midnightRefresh';

export interface MidnightRefreshView {
  /** A rebuild is running and the views show the snapshot. */
  readonly refreshing: ComputedRef<boolean>;
  /** No frame for a while, or the socket is down. */
  readonly stalled: ComputedRef<boolean>;
  /** 'upgrade' only when the server said the reset was the network upgrade. */
  readonly reason: ComputedRef<MidnightRefreshReason>;
  /** 0-99 when the sync service reports progress, else null. */
  readonly progress: ComputedRef<number | null>;
  /** The block the snapshot's values are from, for "As of block N · age". */
  readonly snapshotTip: ComputedRef<MidnightRefreshTip | null>;
}

export function useMidnightRefresh(): MidnightRefreshView {
  const refreshing = computed(() => !!midnightStore.refreshing && !!midnightStore.refreshSnapshot);
  return {
    refreshing,
    stalled: computed(() => refreshing.value && midnightStore.refreshing?.stalled === true),
    reason: computed(() => (refreshing.value ? midnightStore.refreshing?.reason ?? null : null)),
    progress: computed(() => (refreshing.value ? midnightStore.refreshing?.progress ?? null : null)),
    snapshotTip: computed(() => (refreshing.value ? midnightStore.refreshSnapshot?.tip ?? null : null)),
  };
}

/** The sentence for a refresh in progress ('' when none): stalled, after the network upgrade, or plain. */
export function useMidnightRefreshSentence(): ComputedRef<string> {
  const { t } = useTranslation();
  const { refreshing, stalled, reason } = useMidnightRefresh();
  return computed(() => {
    if (!refreshing.value) return '';
    if (stalled.value) return t('midnight.refresh.stalled');
    return reason.value === 'upgrade' ? t('midnight.refresh.afterUpgrade') : t('midnight.refresh.inProgress');
  });
}
