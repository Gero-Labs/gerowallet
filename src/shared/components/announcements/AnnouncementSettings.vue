<template>
  <div v-if="enabled" class="announce-settings text-left">
    <div class="pt-2">
      <h3 class="announce-settings__heading">{{ $t('announce.settings.title') }}</h3>
      <span class="helper my-0">{{ $t('announce.settings.hint') }}</span>
    </div>

    <!-- Service notices cannot be switched off: a network or service issue is the one message every wallet must get. -->
    <v-row no-gutters class="py-2">
      <v-col cols="9">
        <div class="announce-settings__title">{{ $t('announce.settings.service.title') }}</div>
        <span class="helper my-0">{{ $t('announce.settings.service.hint') }}</span>
      </v-col>
      <v-col cols="3" class="announce-settings__control">
        <span class="t-label">{{ $t('notify.types.alwaysOn') }}</span>
      </v-col>
    </v-row>

    <v-row v-for="kind in kinds" :key="kind" no-gutters class="py-2">
      <v-col cols="9">
        <button type="button" class="announce-settings__label" :disabled="busy" @click="set(kind, isOff(kind))">
          <span class="announce-settings__title">{{ $t(`announce.settings.${kind}.title`) }}</span>
          <span class="helper my-0 d-block">{{ $t(`announce.settings.${kind}.hint`) }}</span>
        </button>
      </v-col>
      <v-col cols="3" class="announce-settings__control">
        <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" :model-value="!isOff(kind)" :disabled="busy" @update:model-value="(on) => set(kind, on)" />
      </v-col>
    </v-row>
    <span v-if="failed" class="helper my-0 d-block error--text" role="alert">{{ $t('announce.settings.saveFailed') }}</span>

    <!-- The promise that makes a fake announcement recognisable. -->
    <div class="announce-settings__real">
      <v-icon size="20" color="var(--g-success)">mdi-shield-check-outline</v-icon>
      <div>
        <div class="announce-settings__real-title">{{ $t('announce.settings.real.title') }}</div>
        <ul class="announce-settings__real-list">
          <li>{{ $t('announce.settings.real.inWallet') }}</li>
          <li>{{ $t('announce.settings.real.links') }}</li>
          <li>{{ $t('announce.settings.real.never') }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// "Announcements from Gero" in Settings → Notifications, after the "Settings" artboard. Not per
// wallet and not tied to push: it shows for every wallet type and chain, with notifications on or
// off. A kind that is switched off stops in the bell, the snackbar and browser notifications alike
// (the worker filters what it shows and tells the server to stop pushing that kind).
import { computed, ref } from 'vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { OPT_OUT_KINDS } from '@/services/announcements/announcementStore';
import { announcementsStore, type OptOutKind } from '@/stores/announcementsStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';

announcementsStore.init();
const kinds = OPT_OUT_KINDS;
const enabled = computed(() => featureFlagsStore.isAnnouncementsEnabled());
const busy = ref(false);
const failed = ref(false);

function isOff(kind: OptOutKind): boolean { return announcementsStore.isOff(kind); }

async function set(kind: OptOutKind, on: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  try {
    await announcementsStore.setKind(kind, on);
  } catch {
    // The store put the switch back; say why it moved.
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped lang="scss">
.announce-settings__heading { color: var(--g-text-1); }
.announce-settings__title { font-size: 14px; color: var(--g-text-1); }
.announce-settings__label {
  display: block;
  width: 100%;
  padding: 0;
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  &:disabled { cursor: default; }
}
.announce-settings__control { display: flex; align-items: center; justify-content: center; }
.announce-settings__real {
  @include g-glass-tier();
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  margin-top: var(--g-s-2);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.announce-settings__real-title { font-size: 14px; font-weight: 500; color: var(--g-text-1); }
.announce-settings__real-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin: var(--g-s-2) 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--g-text-2);
}
</style>
