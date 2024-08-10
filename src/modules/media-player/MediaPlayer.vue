<template>
<v-card flat>
  <v-card-text class="pa-0 text-center justify-center">
    <video controls autoplay loop playsinline style="max-height: 500px; height: auto; flex: 1 1 0;">
      <source src="https://asset1zna3cy667zgupk757arsxdyvv99wqt0jkfdmpu.poolpm.nftcdn.io/files/0/?tk=xQRns7BR9aNMHc86rjQ5XUA_qxg1mgzOpxnjDxBOSY4">
    </video>
  </v-card-text>
  <v-card-title>
    Your Collection
    <v-spacer></v-spacer>
    <v-text-field
        flat
        v-model="search"
        :search-input.sync="search"
        placeholder="Search"
        outlined
        solo
        dense
        prepend-inner-icon="mdi-magnify"
        clearable
        hide-details
        style="max-width: 390px"
    >
    </v-text-field>
  </v-card-title>
  <v-card-actions>
    {{mediaNFTs}}
  </v-card-actions>
<!--  -->
<!--  <video controls width="250">-->
<!--    <source src="/media/cc0-videos/flower.webm" type="video/webm" />-->
<!--  </video>-->
</v-card>
</template>
<script lang="ts">
import {defineComponent} from 'vue'
import {mapState} from "pinia";
import {useStore} from "@/store";

export default defineComponent({
  name: "MediaPlayer",
  computed: {
    ...mapState(useStore, ['resolvedCollections']),
    mediaNFTs() {
      // const mediaNFTs = []
      // this.resolvedCollections.forEach(collection => {
      //   collection.items.forEach(nft => {
      //     nft.onchain_metadata
      //     collectibles.filter(collectible => collectible.files &&collectible.files.length > 0 &&
      //         collectible.files.some(file => file.mediaType.includes('audio'))
      //   })
      // })
      //
      // return nft.files?.map((file) => ({
      //   artist: this.getArtists(nft.metadata.artists) || nft.metadata.name || nft.name,
      //   albumImage$: nft.logo$,
      //   name: nft.metadata.song_title || file.song_title || file.name,
      //   src: file.src,
      //   mediaType: file.mediaType,
      //   metadata: nft.metadata,
      // }));
      //
      // console.log(this.resolvedCollections)
      return this.resolvedCollections
    }
  },
  data: () => ({
    search: '',
  })
})
</script>
<style scoped>

</style>