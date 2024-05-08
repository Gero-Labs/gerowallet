<template>
  <div>
    <div class="tokens-container">
      <img
        :src="require('../assets/66.png')"
        alt="token"
        v-for="token in tokens"
        :key="token"
        class="token-image"
        @click="handleTokenClick(token)"
      />
    </div>
    <div class="d-flex justify-center align-center mt-3">
      <v-btn icon @click="prevPage" class="arrow-button">
        <v-icon color="#cecfd2" size="20">mdi-arrow-left</v-icon>
      </v-btn>
      <span class="white-grey">Page {{ page }} of 10</span>
      <v-btn icon @click="nextPage" class="arrow-button">
        <v-icon color="#cecfd2" size="20">mdi-arrow-right</v-icon>
      </v-btn>
    </div>
  </div>
</template>
<script>
export default {
  name: "tokensList",
  props: {},
  computed: {
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
  methods: {
    handleTokenClick(token) {
      this.$emit("token-click", token);
    },
    nextPage() {
      this.page += 1;
    },
    prevPage() {
      this.page -= 1;
    },
  },
};
</script>
<style scoped>
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

.white-grey {
  color: #cecfd2;
}

.arrow-button {
  color: black;
  background-color: #161b26;
  border-radius: 8px;
  border: 1px solid #333741;
  margin: 0 50px;
}
</style>
