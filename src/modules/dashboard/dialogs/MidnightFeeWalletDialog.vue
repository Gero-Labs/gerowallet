<template>
  <BaseDialog
    :is-open="isOpen"
    solid
    size="md"
    icon="mdi-lightning-bolt-outline"
    :title="t('midnight.sponsor.feeWallet')"
    :subtitle="t('midnight.sponsor.dialogSubtitle', { name: walletName })"
    @close="$emit('close')"
  >
    <div class="fwd">
      <div v-if="loading" class="fwd-state">{{ t('midnight.sponsor.checking') }}</div>

      <template v-else>
        <div v-if="ready.length" class="fwd-group">
          {{ t('midnight.sponsor.groupWithDust', { network }) }}
        </div>
        <button
          v-for="c in ready"
          :key="c.walletId"
          type="button"
          class="fwd-row"
          :class="{ 'fwd-row--sel': selected === c.walletId }"
          @click="selected = c.walletId"
        >
          <span class="av">{{ initials(c.name) }}</span>
          <span class="fwd-id">
            <span class="fwd-name">{{ c.name }}</span>
            <span class="fwd-net">{{ network }}</span>
          </span>
          <span class="grow"></span>
          <span class="fwd-num g-num">
            <span>{{ amount(c) }}</span>
            <span class="fwd-pct">{{ pctLabel(c) }}</span>
          </span>
        </button>

        <template v-if="unchecked.length">
          <div class="fwd-group">{{ t('midnight.sponsor.notChecked') }}</div>
          <div v-for="c in unchecked" :key="c.walletId" class="fwd-row fwd-row--off">
            <span class="av">{{ initials(c.name) }}</span>
            <span class="fwd-id">
              <span class="fwd-name">{{ c.name }}</span>
              <span class="fwd-net">{{ network }}</span>
            </span>
            <span class="grow"></span>
            <span class="fwd-num">{{ t('midnight.sponsor.unlockToCheck') }}</span>
          </div>
        </template>

        <div v-if="!ready.length && !unchecked.length" class="fwd-state">
          {{ t('midnight.sponsor.noneFound') }}
        </div>

        <!-- Wallets on other networks are excluded, and saying so is the point:
             silence here reads as "you have no other wallets". -->
        <p v-if="otherNetworkCount" class="fwd-note">
          {{ t('midnight.sponsor.notListed', { count: otherNetworkCount }) }}
        </p>

        <!-- One visible caveat — the linkability unknown is the only thing a
             user must weigh. What pre-selecting does is on the info icon. -->
        <p class="fwd-note">
          {{ t('midnight.sponsor.disclosureLinkability') }}
          <v-tooltip top max-width="280" content-class="custom-tooltip">
            <template #activator="{ on, attrs }">
              <v-icon x-small v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
            </template>
            <span>{{ t('midnight.sponsor.tipUnlock') }}</span>
          </v-tooltip>
        </p>
      </template>

      <div class="fwd-actions">
        <GButton v-if="hasLink" tier="tertiary" @click="turnOff">
          {{ t('midnight.sponsor.turnOff') }}
        </GButton>
        <span class="grow"></span>
        <GButton tier="primary" :disabled="selected === null" @click="confirm">
          {{ selectedName
            ? t('midnight.sponsor.preSelectName', { name: selectedName })
            : t('midnight.sponsor.preSelect') }}
        </GButton>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
/**
 * Choose which wallet pays this wallet's Midnight fees.
 *
 * Reachable from the dashboard's fee-wallet strip as well as mid-send, because
 * a user who has just been told "this wallet has no DUST" should be able to fix
 * it where they are standing.
 *
 * Eligibility is resolved from live cNIGHT registrations, never from a battery
 * reading — see `midnightSponsorEligibility` for why that distinction is
 * load-bearing. Wallets whose DUST has not been read are listed as "not
 * checked", never as empty, and are not selectable.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatTokenAmount } from '@/chains/midnight/midnightAmount';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { loadSponsorCandidates } from '@/chains/midnight/midnightSponsorLookup';
import { chargePercent, type SponsorCandidate } from '@/chains/midnight/midnightSponsorEligibility';
import {
  clearSponsorLink,
  loadSponsorLinks,
  saveSponsorLink,
} from '@/chains/midnight/midnightSponsorLinks';

const props = defineProps<{
  isOpen: boolean;
  walletId: number;
  walletName: string;
  network: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', sponsorWalletId: number | null): void;
}>();

const { t } = useTranslation();

const loading = ref(false);
const candidates = ref<SponsorCandidate[]>([]);
const otherNetworkCount = ref(0);
const selected = ref<number | null>(null);
const hasLink = ref(false);

const ready = computed(() => candidates.value.filter((c) => c.state === 'ready'));
const unchecked = computed(() => candidates.value.filter((c) => c.state !== 'ready'));
const selectedName = computed(() => ready.value.find((c) => c.walletId === selected.value)?.name ?? '');

const dustTicker = computed(() => (props.network === 'Mainnet' ? 'DUST' : 'tDUST'));

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function amount(c: SponsorCandidate): string {
  if (c.capacity == null) return `— ${dustTicker.value}`;
  return `${formatTokenAmount(c.capacity, MIDNIGHT_DECIMALS.DUST, 4)} ${dustTicker.value}`;
}

function pctLabel(c: SponsorCandidate): string {
  const pct = chargePercent(c);
  return pct === null ? '' : (t('midnight.sponsor.ofCap', { pct }) as string);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const result = await loadSponsorCandidates(props.walletId, props.network);
    candidates.value = result.candidates;

    const { geroStore } = await import('@/stores/geroStore');
    const all = Object.values(geroStore.wallets ?? {});
    otherNetworkCount.value = all.filter(
      (w) => w.chain === 'Midnight' && w.id !== props.walletId && w.network !== props.network,
    ).length;

    const link = (await loadSponsorLinks())[String(props.walletId)] ?? null;
    hasLink.value = !!link;
    // Only pre-select a stored choice that can actually pay now.
    const stored = link
      ? result.candidates.find((c) => c.walletId === link.sponsorWalletId)
      : undefined;
    selected.value = stored?.state === 'ready' ? stored.walletId : null;
  } finally {
    loading.value = false;
  }
}

async function confirm(): Promise<void> {
  const c = ready.value.find((x) => x.walletId === selected.value);
  if (!c) return;
  await saveSponsorLink({
    walletId: props.walletId,
    sponsorWalletId: c.walletId,
    sponsorName: c.name,
    network: props.network,
    at: Date.now(),
  });
  emit('saved', c.walletId);
  emit('close');
}

async function turnOff(): Promise<void> {
  await clearSponsorLink(props.walletId);
  emit('saved', null);
  emit('close');
}

watch(() => props.isOpen, (open) => { if (open) void refresh(); }, { immediate: true });
</script>

<style lang="scss" scoped>
.fwd {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.fwd-state,
.fwd-group,
.fwd-note {
  color: var(--g-text-3);
}

.fwd-group {
  margin-top: var(--g-s-2);
}

.fwd-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  width: 100%;
  padding: var(--g-s-2);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  color: var(--g-text-1);
  text-align: left;
  transition: border-color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;

  &:hover:not(.fwd-row--off) {
    border-color: var(--g-hairline-3);
  }
}

.fwd-row--sel {
  border-color: var(--g-accent);
  background: var(--g-overlay);
}

.fwd-row--off {
  color: var(--g-text-3);
}

.grow {
  flex: 1 1 auto;
}

.av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--g-r-pill);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
  flex: none;
}

.fwd-id {
  display: flex;
  flex-direction: column;
}

.fwd-net,
.fwd-pct,
.fwd-num {
  color: var(--g-text-3);
}

.fwd-num {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.fwd-note--warn {
  color: var(--g-warning);
}

.fwd-actions {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-top: var(--g-s-3);
}
</style>
