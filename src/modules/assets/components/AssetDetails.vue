<template>
  <v-card flat class="transparent">
    <v-card-title class="text-h6 pt-0 justify-center" style="word-break: break-word">
      {{ asset.name }}
    </v-card-title>
    <v-card-subtitle class="pb-0">
      {{ $t('assets.unit') }}: {{ filters.truncate(asset.unit) }}
      <CopyButton class="ml-1" :value="asset.unit" x-small></CopyButton>
    </v-card-subtitle>
    <v-card-subtitle class="py-0 pb-3">
      {{ $t('assets.fingerprint') }}: {{  filters.truncate(asset.fingerprint) }}
      <CopyButton class="ml-1" :value="asset.fingerprint" x-small></CopyButton>
      <ExplorerLink type="asset" :id="asset.fingerprint" x-small />
    </v-card-subtitle>
    <!-- Gero's NFT market: list this NFT, or change the price of / take down its listing. List and
         Edit price need the market on (flag, network, wallet); Unlist stays with the flag off. -->
    <div v-if="hasMarketActions" class="asset-market-actions" data-testid="asset-market-actions">
      <span v-if="listing" class="asset-market-actions__status t-caption" data-testid="asset-listed-status">
        {{ $t('nftMarket.badge.listed', { ticker, price: formatLovelaceAsAda(listing.datum.price) }) }}
      </span>
      <GButton v-if="marketActions.list" tier="primary" compact data-testid="asset-list" @click="emit('list')">
        {{ $t('nftMarket.actions.list') }}
      </GButton>
      <GButton v-if="marketActions.reprice" tier="secondary" compact data-testid="asset-edit-price" @click="emit('edit-price')">
        {{ $t('nftMarket.actions.editPrice') }}
      </GButton>
      <GButton v-if="marketActions.unlist" tier="secondary" compact data-testid="asset-unlist" @click="emit('unlist')">
        {{ $t('nftMarket.actions.unlist') }}
      </GButton>
      <!-- A hardware wallet cannot unlist here (a dApp made the listing): say where it can. -->
      <span v-if="marketActions.unlistElsewhere" class="asset-market-actions__note t-caption" data-testid="asset-unlist-elsewhere">
        {{ $t('nftMarket.unlistElsewhere') }}
      </span>
    </div>
    <v-card-text class="pa-0">
      <v-tabs v-model="tab" fixed-tabs >
        <v-tab :value="0">
          {{ $t('assets.files') }}
        </v-tab>
        <v-tab :value="1">
          {{ $t('assets.metadata') }}
        </v-tab>
      </v-tabs>
      <v-window
        v-model="tab"
        class="transparent"
      >
        <v-window-item :value="0" :transition="false">
          <v-card variant="outlined" rounded flat>
            <v-card-text v-if="files[selectedFile]"
                         flat rounded class="transparent text-center justify-center fill-height pb-0"
                         style="margin: auto; height: 233px" >
              <v-img
                v-if="isImage(files[selectedFile].mediaType)"
                :src="assets.resolveIcon(files[selectedFile].src)" max-height="217"
                max-width="217"
                style="margin: auto; cursor: pointer"
                @click="openInNewTab"
              >
                <template v-slot:placeholder>
                  <v-row
                    class="fill-height ma-0 align-center justify-center"


                  >
                    <v-progress-circular
                      indeterminate
                      color="grey lighten-5"
                    ></v-progress-circular>
                  </v-row>
                </template>
              </v-img>

              <audio
                v-else-if="isAudio(files[selectedFile].mediaType)" controls loop
                :src="assets.resolveIcon(files[selectedFile].src)"
                style="width: 100%; top: 50%"
                ref="audioElement"
              ></audio>
              <video
                v-else-if="isVideo(files[selectedFile].mediaType)" controls loop
                :src="assets.resolveIcon(files[selectedFile].src)" class="videoClass"
                ref="videoElement"
              ></video>
            </v-card-text>
            <v-card-text>
              <v-slide-group
                v-model="selectedFile"
                show-arrows
                mandatory
              >
                <v-slide-group-item
                  v-for="(file, index) in files" :key="index" :value="index"
                  v-slot="{ isSelected, toggle }" class="mx-4"
                >
                  <v-card rounded variant="outlined" :class="isSelected ? 'primary' : 'transparent'">
                    <v-btn elevation="0" width="40" height="40" class="pa-0" @click="toggle" style="min-width: 35px!important;">
                      <v-avatar size="40" rounded>
                        <v-icon v-if="isImage(file.mediaType)">
                          {{file.mediaType === 'image/gif' ? 'mdi-file-gif-box' : 'mdi-image'}}
                        </v-icon>
                        <v-icon v-else-if="isAudio(file.mediaType)">
                          mdi-music
                        </v-icon>
                        <v-icon v-else-if="isVideo(file.mediaType)">
                          mdi-movie-open
                        </v-icon>
                      </v-avatar>
                    </v-btn>
                  </v-card>
                </v-slide-group-item>
              </v-slide-group>
            </v-card-text>
          </v-card>
        </v-window-item>
        <v-window-item :value="1" :transition="false">
          <v-card variant="outlined" rounded flat>
            <v-card-text class="text-left" style="font-size: 12px;font-family: monospace!important; height: 307px; overflow-y: auto; white-space: pre;" >
              <CopyButton small :value="JSON.stringify(metadata)" style="position: absolute;right: 16px;"></CopyButton>
              {{JSON.stringify(metadata, null, 2)}}
            </v-card-text>
          </v-card>
        </v-window-item>
      </v-window>
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useMyListings } from '@/shared/composables/useMyListings';
import assets from '@/utils/assets';
import filters from '@/shared/utils/filters';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { nftMarketActionsFor, nftMarketListingsVisible } from '@/shared/utils/nftMarketAvailability';
import { assetFilesOf, isImageMediaType } from '@/modules/assets/utils/assetFiles';

interface DetailAsset {
  name: string;
  unit: string;
  fingerprint: string;
  quantity?: number | string;
  // CIP-25: `image` and a file's `src` may be a string or, past 64 bytes, an array of chunks.
  onchain_metadata?: { image?: string | string[]; mediaType?: string; files?: unknown[]; [key: string]: unknown };
}
const props = defineProps<{ asset: DetailAsset; totalAssets?: number }>();
const { currencyTicker: ticker } = useNativeCurrency();

// The market's actions are the host's to carry out (it hosts the sheets); this only says which apply.
const emit = defineEmits<{
  (e: 'list'): void;
  (e: 'edit-price'): void;
  (e: 'unlist'): void;
}>();

const { byUnit } = useMyListings();
/** This NFT's own listing, where its network has a market. Shown with the market switched off too: a listing locks the NFT. */
const listing = computed(() => (nftMarketListingsVisible() ? byUnit.value.get(String(props.asset.unit).toLowerCase()) : undefined));
const marketActions = computed(() => nftMarketActionsFor(props.asset, listing.value));
const hasMarketActions = computed(() => marketActions.value.list || marketActions.value.reprice || marketActions.value.unlist || marketActions.value.unlistElsewhere);

const autoGrowHack = ref<boolean>(false);
const tab = ref(0);
const selectedFile = ref(0);
const audioElement = ref<HTMLAudioElement | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);

const metadata = computed(() => {
  return props.asset.onchain_metadata
});

const files = computed(() => assetFilesOf(props.asset?.onchain_metadata));

function openInNewTab() {
  const src = files.value[selectedFile.value]?.src
  // An inline image is already shown in full; opened as a page, an SVG's scripts would run.
  if (!src || src.startsWith('data:')) return
  window.open(assets.resolveIcon(src), '_blank')
}

function forceReRender() {
  autoGrowHack.value = !autoGrowHack.value
}

function isImage(mediaType: string) {
  return isImageMediaType(mediaType)
}

function isAudio(mediaType) {
  return (mediaType === 'audio/mpeg' || mediaType === 'audio/mp3' || mediaType === 'audio/aac')
}

function isVideo(mediaType) {
  return (mediaType === 'video/webm' || mediaType === 'video/mp4' || mediaType === 'video/h264' || mediaType === 'video/quicktime' || mediaType === 'video/raw')
}

function stopMedia() {
  if (audioElement.value && !audioElement.value.paused) {
    audioElement.value.pause();
    audioElement.value.currentTime = 0;
  }
  if (videoElement.value && !videoElement.value.paused) {
    videoElement.value.pause();
    videoElement.value.currentTime = 0;
  }
}

defineExpose({
  stopMedia
});

watch(tab, () => {
  forceReRender()
})

watch(() => props.asset, () => { stopMedia(); selectedFile.value = 0; });
</script>
<style scoped>
.asset-market-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-2);
  padding: 0 var(--g-s-4) var(--g-s-3);
}

.asset-market-actions__status,
.asset-market-actions__note {
  color: var(--g-text-2);
}

.videoClass {
  width: 100%;
  max-height: 216px;
  width: -moz-available;
  width: -webkit-fill-available;
  width: stretch;
}
</style>
