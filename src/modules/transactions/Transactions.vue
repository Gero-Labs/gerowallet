<template>
  <v-card class="transparent" flat>
    <ReportDialog :isOpen="isReportDialogOpen" @close="isReportDialogOpen = false" :reportSite="reportSite" />
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import ReportDialog from '@/modules/transactions/dialogs/ReportDialog.vue';

export default defineComponent({
  name: 'Transactions',
  components: { ReportDialog },
  data: () => ({
    isReportDialogOpen: false,
    reportSite: '' as string | string[],
  }),
  created() {
    const queryParams = this.$route.query;
    if (Object.keys(queryParams).length > 0) {
      this.reportSite = queryParams['website'];
      this.isReportDialogOpen = true;
    }
  }
});
</script>
<style scoped>

</style>
