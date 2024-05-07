<template>
  <v-dialog v-model="isDialogVisible" persistent max-width="850">
    <v-card class="pa-7">
      <Rings/>
      <img :src="require('../assets/flag-05.png')" alt="token-bundle-image" />
      <v-btn icon @click="$emit('close')" class="close-button">
        <v-icon color="#cecfd2">mdi-window-close</v-icon>
      </v-btn>
      <v-card-title class="pa-0 card-title">
        MusicBox Dimensions (21) 
        <v-spacer></v-spacer>
        <span class="white-grey policy">Policy: 85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18</span>
      </v-card-title>
      <v-card-subtitle class="pa-0 my-3"
        >Music touches us emotionally, where images and words alone can't</v-card-subtitle
      >
      <div class="tokens-container">
        <img :src="require('../assets/66.png')" alt="token" v-for="token in tokens" :key="token" class="token-image" />
      </div>
      <div class="d-flex justify-center align-center mt-3">
        <v-btn icon @click="prevPage" class="arrow-button">
          <v-icon color="#cecfd2" size="20">mdi-arrow-left</v-icon>
        </v-btn>
        <span class="white-grey">Page 1 of 10</span>
        <v-btn icon @click="nextPage" class="arrow-button">
          <v-icon color="#cecfd2" size="20">mdi-arrow-right</v-icon>
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
<script>
import Rings from "../components/Rings.vue";

export default {
  name: "tokensDialog",
  components: {Rings},
  props: {
    modalData: {
      type: Object,
      default: null,
    },
  },
  computed: {
    isDialogVisible: {
      get() {
        return !!this.modalData;
      },
    },
    page: {
      get() {
        return 1;
      },
      set(value) {
        console.log(value);
      },
    },
  },
  data: () => ({
    tokens: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  }),
  methods: {},
};
</script>
<style scoped>
.close-button {
  position: absolute;
  top: 10px;
  right: 10px;
}

.card-title{
  z-index: 1;
  position: relative;
}

.tokens-container {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;

  & .token-image {
    width: 20%;
    cursor: pointer;
    transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;

    &:hover {
      transform: scale(1.05);
      opacity: 0.8;
    }
  }
}

.white-grey{
 color: #cecfd2
}

.arrow-button {
  color: black;
  background-color: #161b26;
  border-radius: 8px;
  border: 1px solid #333741;
  margin: 0 50px;
}

.policy{
  font-size: 10px;
  font-weight: 300;
  letter-spacing: -0.8px;
  line-height: 0px;
}
</style>
