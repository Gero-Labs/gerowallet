<template>
  <BaseDialog :isOpen="dialogLocal" @close="dialogLocal = false">
    <v-card-title style="word-break: break-word">Buy
      <v-spacer></v-spacer>
      <v-btn icon @click="dialogLocal = false">
        <v-icon>mdi-window-close</v-icon>
      </v-btn>
    </v-card-title>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';


export default {
  name: 'BuyDialog',
  components: {BaseDialog},
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