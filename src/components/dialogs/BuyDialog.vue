<template>
  <v-dialog content-class="rounded-xxl dialogStyle" v-model="dialogLocal" scrollable max-width="850" :persistent="loading">
    <v-card class="py-0 rounded-xxl transparent fill-height">
      <v-card-title style="word-break: break-word">Buy
        <v-spacer></v-spacer>
        <v-btn icon @click="dialogLocal = false">
          <v-icon>mdi-window-close</v-icon>
        </v-btn>
      </v-card-title>
    </v-card>
  </v-dialog>
</template>
<script>

export default {
  name: 'BuyDialog',
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        this.$emit('dialogChange', value)
        this.quantity = 1
      },
    },
  },
  data: () => ({
    loading: false,
  }),
}
</script>

<style scoped>

</style>