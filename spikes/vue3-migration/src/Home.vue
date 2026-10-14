<template><section data-testid="home"><h2>{{ t('home') }}</h2><p>{{ t('guard') }}</p></section></template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>
