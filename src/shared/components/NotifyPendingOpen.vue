<template>
  <BaseDialog
    :isOpen="open"
    @close="stay"
    icon="mdi-bell-ring-outline"
    :title="$t('notify.pendingOpen.title')"
    :subtitle="$t('notify.pendingOpen.body', { wallet: walletName })"
    size="sm"
    :min-height="0"
    :loading="switching"
  >
    <v-card-actions class="px-0 pt-4 pb-0 notify-pending-open__actions">
      <GButton tier="secondary" :disabled="switching" @click="stay()">{{ $t('notify.pendingOpen.stay') }}</GButton>
      <GButton tier="primary" :loading="switching" @click="switchWallet()">{{ $t('notify.pendingOpen.switch') }}</GButton>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
// B4 (handover B7): a click on a notification about a wallet other than the open one never
// switches by itself. The worker parks the intent in chrome.storage ('notifyPendingOpen'),
// opens the dashboard on home, and this prompt asks once the dashboard is unlocked.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router/composables';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import type { NotifyPendingOpen } from '@/services/notify/notifyStore';
import { routeFor } from '@/services/notify/notifyRender';

const KEY = 'notifyPendingOpen';
/** A parked intent older than this is stale: the user has moved on. */
const MAX_AGE_MS = 10 * 60_000;

const router = useRouter();
const pending = ref<NotifyPendingOpen | null>(null);
const switching = ref(false);

const unlocked = computed(() => !!walletStore.loggedWallet && !walletStore.isLocked);
const loggedId = computed(() => (walletStore.loggedWallet as { id?: number } | null)?.id ?? null);
const target = computed(() => (pending.value ? geroStore.wallets[pending.value.walletId] ?? null : null));
const walletName = computed(() => target.value?.name ?? '');
const open = computed(() => unlocked.value && !!pending.value && !!target.value && loggedId.value !== pending.value.walletId);

function isPending(v: unknown): v is NotifyPendingOpen {
  return !!v && typeof v === 'object' && typeof (v as NotifyPendingOpen).walletId === 'number' && typeof (v as NotifyPendingOpen).d === 'string';
}

async function clear(): Promise<void> {
  pending.value = null;
  try { await chrome.storage.local.remove(KEY); } catch { /* storage unavailable: nothing parked */ }
}

async function load(): Promise<void> {
  try {
    const got = await chrome.storage.local.get(KEY);
    const v = got[KEY];
    if (!isPending(v)) { pending.value = null; return; }
    if (Date.now() - v.at > MAX_AGE_MS) { await clear(); return; }
    pending.value = v;
  } catch { pending.value = null; }
}

// The intent already points at the open wallet (the user switched by hand): drop it silently.
watch([pending, loggedId, unlocked], ([p, id, isUnlocked]) => {
  if (p && isUnlocked && id === p.walletId) void clear();
});

function stay(): void { void clear(); }

async function switchWallet(): Promise<void> {
  const p = pending.value;
  const wallet = target.value;
  if (!p || !wallet || switching.value) return;
  switching.value = true;
  try {
    const res = (await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet } })) as { data?: { success?: boolean } };
    if (!res?.data?.success) return;
    const route = routeFor(p.d, p.x as Parameters<typeof routeFor>[1], true);
    if (route.settingsTab) await chrome.storage.local.set({ openSettingsOnLoad: { tab: route.settingsTab } });
    if (router.currentRoute.path !== route.dashboard) await router.push(route.dashboard).catch(() => undefined);
    await clear();
  } finally { switching.value = false; }
}

function onStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== 'local' || !(KEY in changes)) return;
  const v = changes[KEY]?.newValue;
  pending.value = isPending(v) ? v : null;
}

onMounted(() => {
  void load();
  chrome.storage.onChanged.addListener(onStorageChange);
});
onBeforeUnmount(() => chrome.storage.onChanged.removeListener(onStorageChange));
</script>

<style scoped lang="scss">
.notify-pending-open__actions {
  display: flex;
  gap: var(--g-s-2);
  justify-content: flex-end;
}
</style>
