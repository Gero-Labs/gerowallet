<template>
  <section class="legacy-card glass-panel" data-testid="legacy-listings-card" :aria-labelledby="titleId">
    <header class="legacy-card__header">
      <div class="legacy-card__title">
        <h2 :id="titleId" class="t-heading">{{ t('legacyListings.title') }}</h2>
        <!-- Looking the list up again: a spinner beside the title, not a status line under the rows. -->
        <v-progress-circular
          v-if="loading"
          indeterminate
          :size="12"
          :width="2"
          color="var(--g-text-3)"
          class="flex-shrink-0"
          role="status"
          :aria-label="t('common.loading')"
        />
      </div>
      <p class="legacy-card__subtitle t-body-sm">{{ t('legacyListings.subtitle') }}</p>
    </header>

    <ul class="legacy-card__rows">
      <li v-for="item in items" :key="legacyRef(item)">
        <!-- The whole row is the checkbox's label: a bigger target, and the row reads as one choice. -->
        <label
          class="legacy-card__row glass-tier"
          :class="{
            'legacy-card__row--selected': selection.has(legacyRef(item)),
            'legacy-card__row--blocked': isBlocked(item),
          }"
          data-testid="legacy-row"
        >
          <v-checkbox-btn
            class="legacy-card__check"
            :model-value="selection.has(legacyRef(item))"
            :disabled="isBlocked(item)"
            :aria-label="rowLabel(item)"
            density="comfortable"
            color="var(--g-accent)"
            @update:model-value="toggle(item, $event)"
          />
          <LegacyItemLine :item="item" :meta="meta" />
        </label>
      </li>
    </ul>

    <footer class="legacy-card__footer">
      <div v-if="showMaxHint || showVersionHint" class="legacy-card__hints">
        <p v-if="showMaxHint" class="legacy-card__hint t-caption" data-testid="legacy-max-hint">
          {{ t('legacyListings.maxHint', { max: selectedMax }) }}
        </p>
        <p v-if="showVersionHint" class="legacy-card__hint t-caption" data-testid="legacy-version-hint">
          {{ t('legacyListings.versionHint') }}
        </p>
      </div>
      <GButton
        tier="primary"
        :disabled="selection.size === 0"
        data-testid="legacy-get-back"
        @click="getBack()"
      >
        {{ t('legacyListings.getBack') }}
      </GButton>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue';
import { legacyRef, type LegacyListingItem } from '@/api/legacy-listings-api';
import { useLegacyListings } from '@/shared/composables/useLegacyListings';
import { useTranslation } from '@/shared/composables/useTranslation';
import { legacyCancelMax, type LegacyContract } from '@/utils/legacyMarketScripts';
import GButton from '@/shared/components/GButton/GButton.vue';
import LegacyItemLine from '@/modules/portfolio/components/LegacyItemLine.vue';
import { formatAda, legacyItemName } from '@/modules/portfolio/components/legacyItemDisplay';

/**
 * Portfolio -> Collectibles: the wallet's NFTs and offers still locked at a closed marketplace's
 * contracts. A cancel transaction takes one marketplace version only, and each version has its
 * own limit (legacyCancelMax), so the first pick fixes the version: the other version's rows are
 * disabled until the selection is empty again, and the user picks up to that version's limit.
 * The card hands their refs (`txHash#index`) up as `get-back`; LegacyCancelDialog does the rest.
 * Every stuck item is listed, so a wallet with more than one transaction's worth (or both
 * versions) gets them back over several rounds.
 */
const emit = defineEmits<{ (e: 'get-back', refs: string[]): void }>();

const { t } = useTranslation();
const { items, meta, loading, refresh } = useLegacyListings();
const titleId = `legacy-card-title-${useId()}`;

const selection = ref(new Set<string>());

/** The version of the selected items: none until something is picked, then fixed until the selection empties. */
const selectedContract = computed<LegacyContract | undefined>(
  () => items.value.find((item) => selection.value.has(legacyRef(item)))?.contract,
);
/** The limit of the selected version; 0 while nothing is selected (nothing to cap yet). */
const selectedMax = computed(() => (selectedContract.value ? legacyCancelMax(selectedContract.value) : 0));
const atCap = computed(() => selectedContract.value !== undefined && selection.value.size >= selectedMax.value);
/** The limit is worth saying once it is hit, and only when more of that version are waiting. */
const showMaxHint = computed(
  () => atCap.value && items.value.filter((item) => item.contract === selectedContract.value).length > selectedMax.value,
);
/** Items of the other version are listed: they go back in a transaction of their own. */
const showVersionHint = computed(
  () => selectedContract.value !== undefined && items.value.some((item) => item.contract !== selectedContract.value),
);

/** Only the selected version's rows stay open, and at the cap only the picked ones: they are how a slot is given back. */
function isBlocked(item: LegacyListingItem): boolean {
  if (selection.value.has(legacyRef(item))) return false;
  if (selectedContract.value === undefined) return false;
  return item.contract !== selectedContract.value || atCap.value;
}

function toggle(item: LegacyListingItem, checked: unknown): void {
  const ref = legacyRef(item);
  const next = new Set(selection.value);
  if (checked) {
    if (isBlocked(item)) return;
    next.add(ref);
  } else {
    next.delete(ref);
  }
  selection.value = next;
}

/** A name for the checkbox: the NFT's, or the offer's own line. */
function rowLabel(item: LegacyListingItem): string {
  return item.kind === 'offer' ? t('legacyListings.offer', { ada: formatAda(item.lovelace) }) : legacyItemName(item, meta.value);
}

// An item that leaves the list (cancelled, spent elsewhere) leaves the selection with it.
watch(items, (current) => {
  const present = new Set(current.map(legacyRef));
  const kept = [...selection.value].filter((ref) => present.has(ref));
  if (kept.length !== selection.value.size) selection.value = new Set(kept);
});

function getBack(): void {
  // The list's order, not the order the user clicked in.
  const refs = items.value.map(legacyRef).filter((ref) => selection.value.has(ref));
  if (refs.length === 0) return;
  emit('get-back', refs);
}

onMounted(() => { void refresh(); });
</script>

<style scoped lang="scss">
.legacy-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.legacy-card__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);

  h2 {
    margin: 0;
  }
}

.legacy-card__subtitle {
  margin: var(--g-s-1) 0 0;
}

.legacy-card__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
  // Long lists scroll inside the card; the button stays in reach.
  max-height: 320px;
  overflow-y: auto;
}

// Vuetify's checkbox grows to fill the row: keep it its own width so the item takes the rest.
.legacy-card__check {
  flex: none;
}

// A choice card nested in the card: the glass-tier material (class in the markup), its hover
// lift and its selected tint, never a solid repaint.
.legacy-card__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);

  &:hover { @include g-glass-tier-hover; }
  &--selected,
  &--selected:hover { @include g-glass-tier-active; }
  // Blocked (the other version, or the cap): no lift, and the cursor says so.
  &--blocked,
  &--blocked:hover { cursor: not-allowed; opacity: 0.6; }
}

.legacy-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--g-s-3);
}

// The limit and version hints stack at the footer's start, the button stays at its end.
.legacy-card__hints {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin-right: auto;
}

.legacy-card__hint {
  margin: 0;
}
</style>
