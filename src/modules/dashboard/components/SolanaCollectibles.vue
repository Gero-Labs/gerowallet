<template>
  <!-- The Solana NFTs the account holds, as collections (solanaNfts.ts): a VERIFIED collection
       groups its NFTs, every other NFT stands alone with an "Unverified" chip. Names and images
       are the NFTs' own metadata: text only, images through Gero's image proxy. -->
  <section class="glass-panel sol-nfts" data-test="sol-collectibles">
    <div class="sol-nfts__header">
      <span class="t-heading">{{ $t('assets.collectibles') }}</span>
      <span v-if="count" class="t-caption g-num">{{ count }}</span>
    </div>
    <p v-if="!collections.length" class="t-caption">{{ $t('solana.nft.none') }}</p>
    <div v-else class="sol-nfts__grid">
      <button
        v-for="collection in collections"
        :key="collection.id"
        type="button"
        class="glass-tier sol-nfts__tile"
        :data-test="`sol-collection-${collection.id}`"
        @click="openCollection(collection)"
      >
        <span class="sol-nfts__media">
          <img
            v-if="collection.image"
            :src="assets.resolveIcon(collection.image)"
            :alt="collection.name"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="assets.fallbackImage($event)"
          />
          <v-icon v-else size="32">mdi-image-outline</v-icon>
        </span>
        <span class="sol-nfts__name">{{ collection.name }}</span>
        <span class="sol-nfts__meta t-caption">
          <span v-if="collection.items.length > 1" class="g-num">{{ $t('solana.nft.items', { count: collection.items.length }) }}</span>
          <span v-if="!collection.verified" class="sol-nfts__unverified">{{ $t('solana.nft.unverified') }}</span>
        </span>
      </button>
    </div>

    <SolanaNftDialog
      v-model="dialogOpen"
      :collection="openedCollection"
      @send="sendNft"
    />
    <SolanaSendDialog v-model="sendOpen" :nft-mint="sendMint" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { walletStore } from '@/stores/walletStore';
import assets from '@/utils/assets';
import { solanaNftCandidates, solanaNftCollections, type SolanaNft, type SolanaNftCollection } from '@/chains/solana/solanaNfts';
import SolanaNftDialog from '@/modules/dashboard/dialogs/SolanaNftDialog.vue';
import SolanaSendDialog from '@/modules/transactions/dialogs/SolanaSendDialog.vue';

/** The NFTs still held (Gero Sync's tokens) whose metadata Nexus confirmed. */
const nfts = computed<SolanaNft[]>(() => {
  const known = walletStore.solanaNfts ?? {};
  return solanaNftCandidates(walletStore.solana?.tokens).flatMap((mint) => (known[mint] ? [known[mint] as SolanaNft] : []));
});
const collections = computed(() => solanaNftCollections(nfts.value));
const count = computed(() => nfts.value.length);

const dialogOpen = ref(false);
const openedId = ref<string | null>(null);
// Read again from the live list: an NFT sent meanwhile leaves the dialog too.
const openedCollection = computed<SolanaNftCollection | null>(() =>
  collections.value.find((collection) => collection.id === openedId.value) ?? null);

function openCollection(collection: SolanaNftCollection): void {
  openedId.value = collection.id;
  dialogOpen.value = true;
}

const sendOpen = ref(false);
const sendMint = ref<string | undefined>(undefined);

function sendNft(mint: string): void {
  dialogOpen.value = false;
  sendMint.value = mint;
  sendOpen.value = true;
}
</script>

<style scoped lang="scss">
.sol-nfts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.sol-nfts__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.sol-nfts__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--g-s-3);
}

.sol-nfts__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-2);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.sol-nfts__tile:hover {
  @include g-glass-tier-hover;
}

/* The image box is a control-like surface (an image well), not a card. */
.sol-nfts__media {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  color: var(--g-text-3);
}

.sol-nfts__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sol-nfts__name {
  overflow: hidden;
  color: var(--g-text-1);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-nfts__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.sol-nfts__unverified {
  color: var(--g-warning);
}
</style>
