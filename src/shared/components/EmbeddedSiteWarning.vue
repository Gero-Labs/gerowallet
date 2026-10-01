<template>
  <!-- The request came from a frame embedded in a different top-level site.
       The domain the approval shows is the embedded frame's; say which site it
       sits inside so a trusted dApp framed by a hostile page stands out. Same
       warning as the side panel (DAppOverlay), for the popup approvals. -->
  <div v-if="site" class="embedded-site-warning" role="alert" data-testid="embedded-site-warning">
    <v-icon size="13" color="warning" class="mr-1">mdi-picture-in-picture-top-right-outline</v-icon>
    <span class="warning--text text-caption">{{ $t('miniGero.embeddedIn', { site }) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  /** `embeddedIn` from the background-built request (string origin, or null). */
  embeddedIn?: unknown;
}>();

const site = computed(() => (typeof props.embeddedIn === 'string' && props.embeddedIn ? props.embeddedIn : ''));
</script>

<style scoped lang="scss">
.embedded-site-warning {
  display: flex;
  align-items: flex-start;
  overflow-wrap: anywhere;
  text-align: left;
}
</style>
