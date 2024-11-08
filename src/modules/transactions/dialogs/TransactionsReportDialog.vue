<template>
  <BaseDialog :isOpen="!!transactionReportInfo" @close="$emit('close')" title="Report Transaction" :subtitle="`Help us improve Cardano Sheild by reporting scam or making website as safe`" :min-height="600" :height="600">

  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
export default {
  name: 'TransactionsReportDialog',
  components: { BaseDialog },
  props: {
    transactionReportInfo: {
      type: Object,
      default: null,
    },
  },

  data: () => ({
 
  }),
  async mounted() {
    console.log(this.transactionReportInfo)
  }
};
</script>
<style scoped>

</style>
