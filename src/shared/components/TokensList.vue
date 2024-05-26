<template>
  <div>
    <div class="tokens-container">
      <img
        :src="require('../../modules/assets/assets/66.png')"
        alt="token"
        v-for="(token, index) in displayedTokens"
        :key="index"
        class="token-image"
        @click="handleTokenClick(token)"
      />
    </div>
    <div class="d-flex justify-center align-center mt-3" v-if="tokensData.length > 0">
      <v-btn icon @click="prevPage" class="arrow-button" :disabled="currentPage <= 1">
        <v-icon color="#cecfd2" size="20">mdi-arrow-left</v-icon>
      </v-btn>
      <span class="white-grey">Page {{ currentPage }} of {{ totalPages }}</span>
      <v-btn icon @click="nextPage" class="arrow-button" :disabled="currentPage >= totalPages">
        <v-icon color="#cecfd2" size="20">mdi-arrow-right</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<script>
export default {
  name: "TokensList",
  props: {
    tokensData: {
      type: Array,
      required: true
    },
    rows: {
      type: Number,
      default: 4
    }
  },
  data() {
    return {
      currentPage: 1
    };
  },
  computed: {
    totalPages() {
      return Math.ceil(this.tokensData.length / (5 * this.rows));
    },
    displayedTokens() {
      const start = (this.currentPage - 1) * this.rows * 5;
      const end = start + this.rows * 5;
      return this.tokensData.slice(start, end);
    },
  },
  methods: {
    handleTokenClick(token) {
      this.$emit("token-click", token);
    },
    nextPage() {
      if (this.currentPage < this.totalPages) {
        this.currentPage++;
      }
    },
    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--;
      }
    }
  }
};
</script>

<style scoped>
.tokens-container {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;

  & .token-image {
    width: calc(20% - 2px);
    height: 130px;
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
