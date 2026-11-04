<template>
  <div class="legacy-item" data-testid="legacy-item">
    <!-- An NFT with a picture. A picture that fails to load falls back to the neutral tile. -->
    <v-img
      v-if="image && !imageFailed"
      :src="image"
      :alt="name"
      :aspect-ratio="1"
      cover
      class="legacy-item__tile"
      @error="imageFailed = true"
    />
    <!-- An offer holds only ADA: the ADA mark, never an NFT tile. -->
    <span v-else-if="isOffer" class="legacy-item__tile legacy-item__tile--mark" data-testid="legacy-ada-icon">
      <img src="@/assets/svg/cardano-blue.svg" alt="" />
    </span>
    <!-- No picture (yet): a neutral tile in the picture's place. -->
    <span v-else class="legacy-item__tile legacy-item__tile--empty" data-testid="legacy-tile-placeholder" aria-hidden="true">
      <v-icon size="20" color="var(--g-text-3)">mdi-image-outline</v-icon>
    </span>

    <div class="legacy-item__text">
      <p v-if="!isOffer" class="legacy-item__name t-body-sm" data-testid="legacy-item-name">{{ name }}</p>
      <p class="legacy-item__ada t-caption g-num" data-testid="legacy-item-ada">{{ adaText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import type { LegacyItemMeta } from '@/shared/composables/useLegacyListings';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatAda, legacyItemImage, legacyItemName } from '@/modules/portfolio/components/legacyItemDisplay';

/**
 * One stuck item of a closed marketplace: its picture and name (a listing) or the ADA mark
 * (an offer), and the ADA locked with it. Shared by the Portfolio card and the cancel dialog's
 * review, so an item reads the same in both.
 */
const props = defineProps<{
  item: LegacyListingItem;
  /** Name and picture by asset unit, from useLegacyListings. A unit missing here shows a shortened unit. */
  meta: ReadonlyMap<string, LegacyItemMeta>;
}>();

const { t } = useTranslation();

const isOffer = computed(() => props.item.kind === 'offer');
const name = computed(() => legacyItemName(props.item, props.meta));
const image = computed(() => legacyItemImage(props.item, props.meta));

// Ask the picture again when the item (or its picture) changes: a failure belongs to one address.
const imageFailed = ref(false);
watch(image, () => { imageFailed.value = false; });

const adaText = computed(() => t(isOffer.value ? 'legacyListings.offer' : 'legacyListings.locked', { ada: formatAda(props.item.lovelace) }));
</script>

<style scoped lang="scss">
.legacy-item {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--g-s-3);
  min-width: 0;
}

// The picture, the ADA mark and the empty tile share one box. The empty tile and the mark are
// avatar-like controls, so they sit on a solid token (the icon needs the contrast), not on glass.
.legacy-item__tile {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--g-r-control);
  overflow: hidden;
}

.legacy-item__tile--mark,
.legacy-item__tile--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}

.legacy-item__tile--mark img {
  width: 24px;
  height: 24px;
}

.legacy-item__text {
  min-width: 0;

  p {
    margin: 0;
  }
}

.legacy-item__name {
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
