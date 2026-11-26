<template>
  <!-- Four groups of four, numbered, in the mono face: easy to write down and to read back. No
       copy button: the passphrase belongs on paper beside the seed backup, not on the clipboard. -->
  <ol class="passphrase-groups" data-test="passphrase-groups" :aria-label="$t('gerovault.detail.recovery.passphraseLabel')">
    <li v-for="(group, i) in groups" :key="i" class="passphrase-groups__group glass-tier">
      <span class="t-caption">{{ i + 1 }}</span>
      <span class="passphrase-groups__value g-mono" data-test="passphrase-group">{{ group }}</span>
    </li>
  </ol>
</template>

<script setup lang="ts">
defineOptions({ name: 'PassphraseGroups' });

defineProps<{ groups: readonly string[] }>();
</script>

<style scoped>
.passphrase-groups {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--g-s-2);
}
.passphrase-groups__group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-2);
  border-radius: var(--g-r-control);
}
.passphrase-groups__value {
  color: var(--g-text-1);
  word-break: normal;
}
@media (max-width: 480px) {
  .passphrase-groups {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
