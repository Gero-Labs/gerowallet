import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { isHelpReady } from '@/modules/navigation/helpAccess';
import { parseHelpChain, walletHelpChain, type HelpAnswer, type HelpChain } from './helpContent';

export type HelpSection = 'home' | 'answers' | 'updates' | null;

/** Which header tab owns a route. Blog routes also render inside the Help layout and own none. */
export function helpSectionFor(path: string): HelpSection {
  if (path === '/help') return 'home';
  if (path === '/help/updates') return 'updates';
  if (path === '/help/search' || path.startsWith('/help/topics/') || path.startsWith('/help/articles/')) return 'answers';
  return null;
}

/** Chain, section and link builders shared by the header, tabs and every Help widget. */
export function useHelpNavigation() {
  const route = useRoute();
  const router = useRouter();
  const chain = computed<HelpChain>(() => parseHelpChain(route.query['chain'])
    ?? (isHelpReady(walletStore) ? walletHelpChain(walletStore.loggedWallet?.chain) : 'all'));
  const section = computed(() => helpSectionFor(route.path));

  function destination(path: string, extra: Record<string, string> = {}) {
    const query = { ...route.query };
    Object.assign(query, { chain: chain.value, ...extra });
    if (path === '/help') { delete query['q']; delete query['source']; delete query['basic']; }
    return { path, query };
  }
  const homeTo = () => destination('/help');
  const answersTo = () => destination('/help/search', { basic: '' });
  const updatesTo = (source?: string) => destination('/help/updates', source ? { source } : {});
  function answerDestination(answer: HelpAnswer) {
    return destination('/help/articles/' + (answer.slug || answer.id), { basic: answer.remote ? '' : '1' });
  }
  function selectChain(value: string): void {
    if (!parseHelpChain(value)) return;
    void router.replace(destination(route.path, { chain: value })).catch(() => {});
  }
  return { chain, section, destination, homeTo, answersTo, updatesTo, answerDestination, selectChain };
}
