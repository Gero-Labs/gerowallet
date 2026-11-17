// The open announcement, for the dashboard dialog and the side panel's sheet: the same content and
// the same rules on both, so only the layout differs.
//
// Opens from a bell row, the banner's Details, a snackbar's Read (all through
// announcementsStore.open) and from `?announcement=<id>`, which is where a notification click lands.
// The query is removed once it is read, so a reload or the back button does not open it again.

import { computed, getCurrentInstance, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { openFullDashboard } from '@/shared/utils/openFullDashboard';
import { announcementsStore } from '@/stores/announcementsStore';
import { iconOf, openGeroUrl, resolveAction, toneColor, toneOf, type AnnouncementSurface } from './announcementView';

export function useAnnouncementView(surface: AnnouncementSurface) {
  const { t } = useTranslation();
  const router = getCurrentInstance()?.proxy?.$router;

  const openId = computed(() => announcementsStore.state.openId);
  const item = computed(() => announcementsStore.byId(openId.value));
  /** The stored copy has not been read yet: the title and body wait, nothing is "ended" so far. */
  const loading = computed(() => openId.value !== null && !announcementsStore.state.loaded);
  /** Asked for, and not there: it expired, Gero took it down, or its kind was switched off. */
  const ended = computed(() => openId.value !== null && announcementsStore.state.loaded && item.value === null);
  const text = computed(() => (item.value ? announcementsStore.text(item.value) : null));
  const title = computed(() => (ended.value ? t('announce.ended.title') : text.value?.title ?? ''));
  /** The Gero mark says who is speaking; a service notice leads with its tone instead. */
  const showMark = computed(() => !ended.value && item.value?.document.kind !== 'service');
  const headerIcon = computed(() => (ended.value ? 'mdi-clock-outline' : item.value ? iconOf(item.value) : 'mdi-bell-outline'));
  const headerIconColor = computed(() => (ended.value || !item.value ? 'var(--g-text-3)' : toneColor(toneOf(item.value))));
  const hero = computed(() => {
    // Editorial only: the worker never fetches an image for a headline.
    if (item.value?.tier !== 'editorial') return null;
    const doc = item.value.document;
    return doc?.thumb ? doc.media.find((m) => m.sha256 === doc.thumb) ?? null : null;
  });
  const action = computed(() => (item.value ? resolveAction(item.value.document, surface) : null));
  const actionLabel = computed(() => {
    const a = action.value;
    if (!a) return '';
    return a.type === 'url' ? t('announce.action.readOn', { host: a.host }) : t(a.labelKey);
  });

  function close(): void { announcementsStore.close(); }

  function run(): void {
    const a = action.value;
    if (!a) return;
    if (a.type === 'url') { openGeroUrl(a.url); return; }
    close();
    if (a.handOver) { void openFullDashboard(`#${a.path}`, true); return; }
    if (router && router.currentRoute.value.fullPath !== a.path) router.push(a.path).catch(() => undefined);
  }

  if (router) {
    watch(() => router.currentRoute.value.query['announcement'], (id) => {
      if (typeof id !== 'string') return;
      announcementsStore.open(id);
      const { path, query } = router.currentRoute.value;
      const rest = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'announcement'));
      router.replace({ path, query: rest }).catch(() => undefined);
    }, { immediate: true });
  }

  announcementsStore.init();

  return { openId, item, loading, ended, text, title, showMark, headerIcon, headerIconColor, hero, action, actionLabel, close, run };
}
