/**
 * Why Midnight Send and Register for DUST are held, if they are, as one reason:
 * update required, then the network upgrade (midnightWriteGate.ts), then a
 * rebuild in progress (midnightRefresh.ts). Every held control shows this one
 * reason under it and links it with one `aria-describedby`.
 */
import { computed, type ComputedRef } from 'vue';
import { useMidnightWriteBlock } from '@/chains/midnight/midnightWriteGate';
import { useMidnightRefresh } from './useMidnightRefresh';
import { useTranslation } from './useTranslation';
import { midnightNetworkDisplayName } from '@/api/midnightApiError';

export type MidnightSendHold = 'updateRequired' | 'networkUpgrading' | 'refreshing';

export interface MidnightSendHoldView {
  readonly hold: ComputedRef<MidnightSendHold | null>;
  readonly held: ComputedRef<boolean>;
  /** The sentence under a held Send: the full one in a send dialog or sheet. */
  readonly sendText: ComputedRef<string>;
  /** The short one under the side panel's Send action (the banner above says the rest). */
  readonly sendTextShort: ComputedRef<string>;
  /** The sentence under a held Register for DUST. */
  readonly registrationText: ComputedRef<string>;
  /** The glyph for that sentence. */
  readonly icon: ComputedRef<string>;
}

export function useMidnightSendHold(network: () => string | undefined | null): MidnightSendHoldView {
  const { t } = useTranslation();
  const block = useMidnightWriteBlock(network);
  const { refreshing } = useMidnightRefresh();
  const hold = computed<MidnightSendHold | null>(() => block.value ?? (network() && refreshing.value ? 'refreshing' : null));
  const name = () => midnightNetworkDisplayName(network());
  return {
    hold,
    held: computed(() => hold.value !== null),
    sendText: computed(() => {
      switch (hold.value) {
        case 'updateRequired': return t('midnight.errors.updateRequired');
        case 'networkUpgrading': return t('midnight.upgrade.sendPaused', { network: name() });
        case 'refreshing': return t('midnight.refresh.sendHeld');
        default: return '';
      }
    }),
    sendTextShort: computed(() => {
      switch (hold.value) {
        case 'updateRequired': return t('midnight.update.sendHeld');
        case 'networkUpgrading': return t('midnight.upgrade.sendPaused', { network: name() });
        case 'refreshing': return t('midnight.refresh.sendHeld');
        default: return '';
      }
    }),
    registrationText: computed(() => {
      switch (hold.value) {
        case 'updateRequired': return t('midnight.update.registrationHeld');
        case 'networkUpgrading': return t('midnight.upgrade.registrationPaused', { network: name() });
        case 'refreshing': return t('midnight.refresh.sendHeld');
        default: return '';
      }
    }),
    icon: computed(() => (hold.value === 'refreshing' ? 'mdi-refresh' : 'mdi-pause-circle-outline')),
  };
}
