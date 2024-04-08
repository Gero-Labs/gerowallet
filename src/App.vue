<template>
  <div>
    <component :is="this.$route.meta.layout || 'div'">
      <router-view></router-view>
    </component>
    <v-overlay v-if="this.$router.currentRoute.path !== '/login'" opacity="0.9" :value="loading">
      <img :src="require('@/assets/gero_logo.png')" width="160" alt="logo" />
      <v-progress-linear
          buffer-value="0"
          color="primary"
          reverse
          stream
          value="0"
          style="color: cyan"
      ></v-progress-linear>
    </v-overlay>
  </div>
</template>

<script>
import BlankLayout from "@/layouts/BlankLayout.vue";
import ContentLayout from "@/layouts/ContentLayout.vue";
import {mapState} from "vuex";

export default {
  computed: {
    ...mapState(['loading']),
  },
  components: {BlankLayout, ContentLayout},
  data: () => ({

  }),
}
</script>
<style lang="scss">
.v-application {
  background-color: var(--v-background-base) !important;
}
.v-navigation-drawer {
  background-color: var(--v-navigationDrawerBackground-base) !important;
}
.v-app-bar.v-toolbar.v-sheet {
  background-color: var(--v-appBarBackground-base) !important;
}
.v-card {
  background-color: var(--v-cardBackground-base) !important;
}
</style>