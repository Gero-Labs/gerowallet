<template>
  <div class="stackedTokens" style="max-width: 132px">
    <v-btn icon height="40" width="40" v-for="(token, index) in resolvedTokens"
           :key="index" :class="'stackedToken_'+index">
      <v-avatar
          size="40"
          :color="token.img ? '' : 'black'"
      >
        <v-img v-if="token.img" :src="token.img" :alt="token.name"></v-img>
        <span v-else class="white--text">{{token.name}}</span>
      </v-avatar>
    </v-btn>
    <v-btn
        icon height="40" width="40"
        v-if="residue > 0"
        style="margin-left: -25px"
    >
      <v-avatar
          size="40"
          color="black"
      >
        <span class="white--text">{{'+'+residue}}</span>
      </v-avatar>
    </v-btn>
  </div>
</template>
<script>
export default {
  name: "StackedTokens",
  props: {
    tokens: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    resolvedTokens() {
      if (this.tokens) {
        const arr = this.tokens.slice(0, 4);
        return arr.map(token => {
          return {img: this.resolveTokenImage(token), name: token}
        })
      }
      return []
    },
    residue() {
      if (this.tokens) {
        return this.tokens.slice(4).length
      }
      return 0
    }
  },
  methods: {
    resolveTokenImage(tokenName) {
      if (tokenName === 'ADA') {
        return require('@/assets/svg/cardano.svg')
      } else if (tokenName === 'GERO') {
        return require('@/assets/svg/gero.svg')
      } else if (tokenName === 'MUSICBOX') {
        return require('@/assets/svg/musicbox.svg')
      } else if (tokenName === 'NIDO') {
        return require('@/assets/svg/nido.svg')
      } else {
        return ''
      }
    }
  },
  data: () => ({}),
}
</script>
<style>
.stackedToken_1 {
  margin-left: -25px;
}

.stackedToken_2 {
  margin-left: -25px;
}

.stackedToken_3 {
  margin-left: -25px;
}

.stackedToken_4 {
  margin-left: -25px;
}
</style>