<template>
  <BaseDialog
    :isOpen="open"
    @close="notNow"
    icon="mdi-bell-ring-outline"
    :title="$t('notify.intro.title')"
    :subtitle="$t('notify.intro.promptBody')"
    size="sm"
    :min-height="0"
  >
    <v-card-actions class="px-0 pt-4 pb-0 notify-intro__actions">
      <GButton tier="secondary" @click="notNow()">{{ $t('notify.intro.notNow') }}</GButton>
      <GButton tier="primary" @click="turnOn()">{{ $t('notify.intro.turnOn') }}</GButton>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
// The offer to turn push notifications on (notifyIntro.ts), on the dashboard: once per
// eligible wallet that is not linked yet, after the wallet is unlocked and while no other
// dialog is up. "Turn on" hands over to Settings > Notifications (the parent opens it with
// the enable step started); "Not now", Escape and the scrim end the automatic offer on this
// install. The worker keeps the answers (NOTIFY_INTRO_ANSWER); this page only mirrors
// `notifyIntro` and reads the worker's state through notifySettingsStore.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { NOTIFY_INTRO_KEY, promptWanted, readIntroState, type NotifyIntroState } from '@/services/notify/notifyIntro';
import { notifySettingsStore } from '@/stores/notifySettingsStore';
import { walletStore } from '@/stores/walletStore';

const props = defineProps<{ suppressed?: boolean }>();
const emit = defineEmits<{ (e: 'turn-on'): void }>();

/** Let the dashboard settle, and any dialog it opens on its own come first. */
const SETTLE_MS = 1_500;

const store = notifySettingsStore;
const intro = ref<NotifyIntroState | null>(null);
const unlocked = computed(() => !!walletStore.loggedWallet && !walletStore.isLocked);
const loggedId = computed(() => (walletStore.loggedWallet as { id?: number } | null)?.id ?? null);
const answered = ref(false);
const settled = ref(false);

const wanted = computed(() => {
  const s = store.state.state;
  if (!s || !intro.value || !s.logged || s.logged.walletId !== loggedId.value) return false;
  return promptWanted({
    intro: intro.value,
    pushSupported: s.pushSupported,
    config: s.config,
    wallet: { id: s.logged.walletId, eligible: s.logged.eligible, network: s.logged.network, registered: s.wallets[String(s.logged.walletId)]?.registeredAt != null },
  });
});
const open = computed(() => !props.suppressed && unlocked.value && settled.value && !answered.value && wanted.value);

const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;

async function loadState(): Promise<void> {
  if (!hasChrome()) return;
  try {
    const got = await chrome.storage.local.get(NOTIFY_INTRO_KEY);
    intro.value = readIntroState(got?.[NOTIFY_INTRO_KEY]);
  } catch { intro.value = readIntroState(undefined); }
  if (intro.value.dismissedAt !== null) return; // nothing is offered on this install any more
  // Storage first, no network: a linked or ineligible wallet needs no /config at all.
  await store.refresh();
  const s = store.state.state;
  if (!s?.logged?.eligible) return;
  if (s.wallets[String(s.logged.walletId)]?.registeredAt != null) return;
  // /config decides the offer, so ask for it every time: the client serves its copy for an hour
  // and refetches after that, so an `enabled: false` cached before the rollout does not stick.
  await store.refresh({ config: true });
}

let settleTimer: ReturnType<typeof setTimeout> | null = null;
watch([unlocked, loggedId], ([isUnlocked]) => {
  answered.value = false;
  settled.value = false;
  if (settleTimer) clearTimeout(settleTimer);
  if (!isUnlocked) return;
  settleTimer = setTimeout(() => { settled.value = true; }, SETTLE_MS);
  void loadState();
}, { immediate: true });

function onStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area === 'local' && NOTIFY_INTRO_KEY in changes) intro.value = readIntroState(changes[NOTIFY_INTRO_KEY]?.newValue);
}

onMounted(() => { if (hasChrome()) chrome.storage.onChanged.addListener(onStorageChange); });
onBeforeUnmount(() => {
  if (settleTimer) clearTimeout(settleTimer);
  if (hasChrome()) chrome.storage.onChanged.removeListener(onStorageChange);
});

function turnOn(): void {
  const id = loggedId.value;
  answered.value = true;
  if (id !== null) void store.answerIntro({ walletId: id });
  emit('turn-on');
}
function notNow(): void {
  if (answered.value) return;
  answered.value = true;
  void store.answerIntro({ dismiss: true });
}
</script>

<style scoped lang="scss">
.notify-intro__actions {
  display: flex;
  gap: var(--g-s-2);
  justify-content: flex-end;
}
</style>
