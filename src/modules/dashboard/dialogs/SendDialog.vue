<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')">
    <v-card-title>Quick Send</v-card-title>
    <v-card-text>
        Send AP3X or other assets to another wallet.
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';

export default {
  name: 'BuyDialog',
  components: {BaseDialog},
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    
  },
  data: () => ({
    loading: false,
  }),
}
</script>

<style scoped>

</style>