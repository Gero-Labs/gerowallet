<template>
  <v-card flat class="transparent">
    <v-card-title class="text-h6 pt-0 justify-center" style="word-break: break-word">
      {{ asset.name }}
    </v-card-title>
    <v-card-subtitle class="pb-0">
      Unit: {{ asset.unit | truncate }}
      <CopyButton class="ml-1" :value="asset.unit" x-small></CopyButton>
    </v-card-subtitle>
    <v-card-subtitle class="py-0 pb-3">
      Fingerprint: {{  fingerprint | truncate }}
      <CopyButton class="ml-1" :value="fingerprint" x-small></CopyButton>
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
                :src="files[selectedFile].src | toIPFS" max-height="217"
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
                :src="files[selectedFile].src | toIPFS"
                style="width: 100%; top: 50%"
              ></audio>
              <video
                v-else-if="isVideo(files[selectedFile].mediaType)" controls loop
                :src="files[selectedFile].src | toIPFS" class="videoClass"
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
<script>
// import rarities from '@/api/rarities'
import filters from '@/shared/utils/filters';
import rules from '@/utils/rules';
import CopyButton from '@/shared/components/CopyButton.vue';
import AssetFingerprint from '@emurgo/cip14-js';
import { mapState } from 'pinia';
import { useStore } from '@/stores';

export default {
  name: 'AssetDetails',
  components: { CopyButton },
  filters,
  props: {
    asset: {
      type: Object,
      default: () => {
      },
    },
    totalAssets: {
      type: Number,
      default: () => 0,
    },
  },
  // rarities,
  data: () => ({
    autoGrowHack: false,
    editing: false,
    editedAsset: {
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
    },
    additional_attributes: [],
    tab: null,
    loading: false,
    selectedFile: null,
    rules,
  }),
  computed: {
    filters() {
      return filters
    },
    ...mapState(useStore, ['assets']),
    fingerprint() {
      return AssetFingerprint.fromParts(Buffer.from(this.asset.policy_id, 'hex'), Buffer.from(this.asset.unit.slice(56), 'hex'))?.fingerprint()
    },
    ableToSave() {
      return JSON.stringify(this.asset) !== JSON.stringify(this.editedAsset)
    },
    policies() {
      return this.project.policies
    },
    thumbnail() {
      if (this.editedAsset) {
        return {src: this.editedAsset.image, mediaType: this.editedAsset.media_type}
      }

      return {src: '', mediaType: ''}
    },
    properties() {
      const properties = []
      if (this.editedAsset && this.metadata) {
        // const returnedObject = rarities.computeRarity(this.metadata[721][this.editedAsset.policy_id][this.editedAsset.asset_name], false)
        // properties.push(...Object.keys(returnedObject))
      }

      return properties
    },
    metadata() {
      if (this.assets) {
        const asset = this.assets[this.asset.unit]
        if (asset) {
          return asset.onchain_metadata
        }
      }
      return 'N/A'
    },
    files() {
      const files = []
      if (this.asset && this.asset.onchain_metadata) {
        let image = ''
        let mediaType = ''
        if (this.asset.onchain_metadata.image) {
          image = this.asset.onchain_metadata.image
        }
        if (this.asset.onchain_metadata.mediaType) {
          mediaType = this.asset.onchain_metadata.mediaType
        }
        if (image) {
          files.push({ src: image, mediaType })
        }
        if (this.asset.onchain_metadata.files) {
          this.asset.onchain_metadata.files.forEach(file => {
            if (files.find(f => f.src === file.src) == null) {
              files.push(file)
            }
          })
        }
      }
      console.log(files)
      return files
    },
  },
  watch: {
    tab() {
      this.forceReRender()
    },
    dialog(val) {
      if (val) {
        console.log(this.asset)
        this.editedAsset = {...this.asset}
        this.additional_attributes = []
        if (this.asset && this.asset.additional_attributes) {
          const attrObject = this.asset.additional_attributes
          Object.keys(attrObject).forEach(key => this.additional_attributes.push({name: key, value: attrObject[key] }))
        }
      }
      this.dialogLocal = val
    },
    asset(val) {
      this.editedAsset = {...val}
    },
    additional_attributes: {
      handler(newVal) {
        const additionalAttributes = {}
        newVal.forEach(element => {
          additionalAttributes[element.name] = element.value
        })
        this.editedAsset.additional_attributes = additionalAttributes
      },
      deep: true
    },
  },
  methods: {
    openInNewTab() {
      window.open(filters.toIPFS(this.files[this.selectedFile].src), '_blank')
    },
    forceReRender() {
      this.autoGrowHack = !this.autoGrowHack
    },
    save() {

      this.editing = false
    },
    toggleEditing() {
      if (this.editing) {
        this.editing = false
        this.editedAsset = {...this.asset}
        this.additional_attributes = []
        if (this.asset && this.asset.additional_attributes) {
          const attrObject = this.asset.additional_attributes
          Object.keys(attrObject).forEach(key => this.additional_attributes.push({name: key, value: attrObject[key] }))
        }
      } else {
        this.editing = true
      }
    },
    // rarityPercentage(val) {
    //   return ((rarities.properties[val] / this.totalAssets) * 100).toFixed(2)
    // },
    isImage(mediaType) {
      console.log(mediaType)
      return (mediaType === '' || mediaType === 'image/png' || mediaType === 'image/webp' || mediaType === 'image/jpeg' || mediaType === 'image/gif')
    },
    isAudio(mediaType) {
      return (mediaType === 'audio/mpeg' || mediaType === 'audio/mp3' || mediaType === 'audio/aac')
    },
    isVideo(mediaType) {
      return (mediaType === 'video/webm' || mediaType === 'video/mp4' || mediaType === 'video/h264' || mediaType === 'video/quicktime' || mediaType === 'video/raw')
    },
    addMetaDataField() {
      if (this.additional_attributes) {
        this.additional_attributes.push({name: '', value: '' })
      }
    },
    deleteAttribute(index) {
      this.additional_attributes.splice(index, 1)
    },
  },
}
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
