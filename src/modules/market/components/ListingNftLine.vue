<template>
  <div class="listing-nft" data-testid="listing-nft-line">
    <!-- A picture that fails to load falls back to the neutral tile. -->
    <v-img
      v-if="image && !imageFailed"
      :src="image"
      :alt="name"
      :aspect-ratio="1"
      cover
      class="listing-nft__tile"
      @error="imageFailed = true"
    />
    <span v-else class="listing-nft__tile listing-nft__tile--empty" aria-hidden="true">
      <v-icon size="20" color="var(--g-text-3)">mdi-image-outline</v-icon>
    </span>
    <div class="listing-nft__text">
      <p class="listing-nft__name t-body-sm" data-testid="listing-nft-name">{{ name }}</p>
      <p v-if="caption" class="t-caption g-mono listing-nft__caption" data-testid="listing-nft-caption">{{ caption }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

/**
 * The NFT a market sheet is about: its picture and name, and a caption (the policy id, shortened).
 * Shared by the list, edit-price and unlist sheets, so the NFT reads the same in all three.
 */
const props = defineProps<{
  name: string;
  image?: string;
  caption?: string;
}>();

// Ask the picture again when the NFT (or its picture) changes: a failure belongs to one address.
const imageFailed = ref(false);
watch(() => props.image, () => { imageFailed.value = false; });
</script>

<style scoped lang="scss">
.listing-nft {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-width: 0;
  margin-bottom: var(--g-s-3);
}

.listing-nft__tile {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: var(--g-r-control);
  overflow: hidden;
}

// No picture (yet): a neutral tile. An avatar-like control, so a solid token (the icon needs the contrast).
.listing-nft__tile--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}

.listing-nft__text {
  min-width: 0;

  p {
    margin: 0;
  }
}

.listing-nft__name {
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.listing-nft__caption {
  color: var(--g-text-3);
}
</style>
