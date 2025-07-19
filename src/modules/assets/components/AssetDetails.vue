<template>
  <v-card flat class="transparent">
    <v-card-title class="text-h6 pt-0 justify-center" style="word-break: break-word">
      {{ asset.name }}
    </v-card-title>
    <v-card-subtitle class="pb-0">
      Unit: {{ filters.truncate(asset.unit) }}
      <CopyButton class="ml-1" :value="asset.unit" x-small></CopyButton>
    </v-card-subtitle>
    <v-card-subtitle class="py-0 pb-3">
      Fingerprint: {{  filters.truncate(asset.fingerprint) }}
      <CopyButton class="ml-1" :value="asset.fingerprint" x-small></CopyButton>
    </v-card-subtitle>
    <v-card-text class="pa-0">
      <v-tabs v-model="tab" fixed-tabs >
        <v-tab>
          Files
        </v-tab>
        <v-tab>
          Metadata
        </v-tab>
      </v-tabs>
      <v-tabs-items
        v-model="tab"
        class="transparent"
      >
        <v-tab-item :transition="false">
          <v-card outlined rounded flat>
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
                    class="fill-height ma-0"
                    align="center"
                    justify="center"
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
              ></audio>
              <video
                v-else-if="isVideo(files[selectedFile].mediaType)" controls loop
                :src="assets.resolveIcon(files[selectedFile].src)" class="videoClass"
              ></video>
            </v-card-text>
            <v-card-text>
              <v-slide-group
                v-model="selectedFile"
                show-arrows
                mandatory
              >
                <v-slide-item
                  v-for="(file, index) in files" :key="index"
                  v-slot="{ active, toggle }" class="mx-4"
                >
                  <v-card rounded outlined :class="active ? 'primary' : 'transparent'">
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
                </v-slide-item>
              </v-slide-group>
            </v-card-text>
          </v-card>
        </v-tab-item>
        <v-tab-item :transition="false">
          <v-card outlined rounded flat>
            <v-card-text class="text-left" style="font-size: 12px;font-family: monospace!important; height: 307px; overflow-y: auto; white-space: pre;" >
              <CopyButton small :value="JSON.stringify(metadata)" style="position: absolute;right: 16px;"></CopyButton>
              {{JSON.stringify(metadata, null, 2)}}
            </v-card-text>
          </v-card>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import CopyButton from '@/shared/components/CopyButton.vue';
import assets from '@/utils/assets';
import filters from '@/shared/utils/filters';

const props = defineProps({
  asset: {
    type: Object,
    default: () => {
    },
  },
  totalAssets: {
    type: Number,
    default: () => 0,
  },
});

const autoGrowHack = ref<boolean>(false);
const editedAsset = ref<any>({
  asset_name: '',
  description: '',
  state: '',
  fingerprint: '',
  policy_id: '',
  sold_to: undefined,
  date_sold: undefined,
  nftmetadata: undefined,
  image: '',
  media_type: '',
  additional_files: [],
});
const additional_attributes = ref<any>([]);
const tab = ref(null);
const loading = ref(false);
const selectedFile = ref(null);

const properties = computed(() => {
  const properties = []
  if (editedAsset.value && metadata.value) {
    // const returnedObject = rarities.computeRarity(this.metadata[721][this.editedAsset.policy_id][this.editedAsset.asset_name], false)
    // properties.push(...Object.keys(returnedObject))
  }
  return properties
});

const metadata = computed(() => {
  return props.asset.onchain_metadata
});

const files = computed(() => {
  const files = []
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

watch(tab, () => {
  forceReRender()
})

watch(props.asset, (val) => {
  editedAsset.value = {...val}
})

watch(additional_attributes, (newVal) => {
  const additionalAttributes = {}
  newVal.forEach(element => {
    additionalAttributes[element.name] = element.value
  })
  editedAsset.value.additional_attributes = additionalAttributes
}, { deep: true })
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
