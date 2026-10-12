import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  wallet: { loggedWallet: null as unknown, isLocked: true, isSyncing: false },
  route: { path: '/help', fullPath: '/help', query: {} as Record<string, string> },
  replace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive(h.wallet) }));
vi.mock('vue-router/composables', () => ({ useRoute: () => h.route, useRouter: () => ({ replace: h.replace }) }));
import { helpSectionFor, useHelpNavigation } from './helpNavigation';

beforeEach(() => { h.wallet.loggedWallet = null; h.wallet.isLocked = true; h.route.path = '/help'; h.route.query = {}; h.replace.mockClear(); });
describe('Help sections', () => {
  it('assigns every Help route to a header tab, and blog routes to none', () => {
    expect(helpSectionFor('/help')).toBe('home');
    expect(helpSectionFor('/help/updates')).toBe('updates');
    for (const path of ['/help/search', '/help/topics/fix', '/help/articles/backup']) expect(helpSectionFor(path)).toBe('answers');
    expect(helpSectionFor('/blog/some-post')).toBeNull();
  });
});
describe('Help links', () => {
  it('keeps the chain in every link and drops search state when going home', () => {
    h.route.query = { chain: 'midnight', q: 'dust', basic: '1', source: 'gero-x' };
    const { chain, homeTo, answersTo, updatesTo } = useHelpNavigation();
    expect(chain.value).toBe('midnight');
    expect(homeTo()).toEqual({ path: '/help', query: { chain: 'midnight' } });
    expect(answersTo()).toEqual({ path: '/help/search', query: { chain: 'midnight', q: 'dust', basic: '', source: 'gero-x' } });
    expect(updatesTo('gero-blog').query).toMatchObject({ source: 'gero-blog', chain: 'midnight' });
  });
  it('defaults to all chains when locked and to the wallet chain when ready', () => {
    expect(useHelpNavigation().chain.value).toBe('all');
    h.wallet.loggedWallet = { chain: 'Bitcoin' }; h.wallet.isLocked = false;
    expect(useHelpNavigation().chain.value).toBe('bitcoin');
    h.route.query = { chain: 'cardano' };
    expect(useHelpNavigation().chain.value).toBe('cardano');
  });
  it('marks bundled answers basic and ignores an unknown chain selection', () => {
    const { answerDestination, selectChain } = useHelpNavigation();
    expect(answerDestination({ id: 'backup', slug: undefined, remote: false } as never).query).toMatchObject({ basic: '1' });
    expect(answerDestination({ id: 'x', slug: 'published', remote: true } as never)).toMatchObject({ path: '/help/articles/published', query: { basic: '' } });
    selectChain('dogecoin'); expect(h.replace).not.toHaveBeenCalled();
    selectChain('bitcoin'); expect(h.replace).toHaveBeenCalledWith({ path: '/help', query: { chain: 'bitcoin' } });
  });
});
