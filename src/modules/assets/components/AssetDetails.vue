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
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import assets from '@/utils/assets';
import filters from '@/shared/utils/filters';



interface AssetFile { src: string; mediaType: string }
interface DetailAsset {
  name: string;
  unit: string;
  fingerprint: string;
  onchain_metadata?: { image?: string; mediaType?: string; files?: AssetFile[]; [key: string]: unknown };
}
const props = defineProps<{ asset: DetailAsset; totalAssets?: number }>();

const autoGrowHack = ref<boolean>(false);
const tab = ref(0);
const selectedFile = ref(0);
const audioElement = ref<HTMLAudioElement | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);

const metadata = computed(() => {
  return props.asset.onchain_metadata
});

const files = computed(() => {
  const files: AssetFile[] = []
  if (props.asset && props.asset.onchain_metadata) {
    let image = ''
    let mediaType = ''
    if (props.asset.onchain_metadata.image) {
      image = props.asset.onchain_metadata.image
    }
    if (props.asset.onchain_metadata.mediaType) {
      mediaType = props.asset.onchain_metadata.mediaType
    }
    if (image) {
      files.push({ src: image, mediaType })
    }
    if (props.asset.onchain_metadata.files) {
      props.asset.onchain_metadata.files.forEach(file => {
        if (files.find(f => f.src === file.src) == null) {
          files.push(file)
        }
      })
    }
  }
  return files
});

function openInNewTab() {
  window.open(assets.resolveIcon(files.value[selectedFile.value].src), '_blank')
}

function forceReRender() {
  autoGrowHack.value = !autoGrowHack.value
}

function isImage(mediaType) {
  return (mediaType === '' || mediaType === 'image/png' || mediaType === 'image/webp' || mediaType === 'image/jpeg' || mediaType === 'image/gif')
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
.videoClass {
  width: 100%;
  max-height: 216px;
  width: -moz-available;
  width: -webkit-fill-available;
  width: stretch;
}
</style>
