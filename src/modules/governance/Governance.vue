<template><div></div></template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';

// /governance lands on My governance — the hub's home, which answers "what is
// my stake doing" before the chain-wide surfaces. This shell only exists so the
// existing route name (and its gates) keep working. The global-search deep link
// `?drep=<id>` predates the split and targets the DRep directory (delegate
// flow), so it is forwarded there with its query intact.
const route = useRoute();
const router = useRouter();
onMounted(() => {
  if (route.query.drep) {
    router.replace({ name: 'governanceDReps', query: route.query });
  } else {
    router.replace({ name: 'governanceMe', query: route.query });
  }
});
</script>
