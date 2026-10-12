import type { HelpArticleSummary } from '@/api/help.api';
import bundledAnswers from './bundledAnswers.json';
import synonyms from './searchSynonyms.json';

export type HelpChain = 'all' | 'cardano' | 'midnight' | 'bitcoin';
export interface HelpAnswer {
  id: string; topic: string; title: string; chains: string[];
  requiredFeatures: string[]; keywords: string[]; body: string;
  slug?: string; locale?: string; remote?: boolean; networks?: string[]; walletTypes?: string[];
  /** Published-article metadata; bundled answers carry none of it. */
  kind?: string; lastVerifiedAt?: string; testedWalletVersion?: string;
}
export interface HelpContext {
  chain: HelpChain;
  features: Record<string, boolean | undefined>;
  cardSupported?: boolean;
  network?: string;
  walletType?: string;
}
export const answers: HelpAnswer[] = bundledAnswers;
export const topics = [
  { id: 'start', scene: 'register' }, { id: 'send', scene: 'payment' },
  { id: 'card', scene: 'hero' }, { id: 'earn', scene: 'earnHero' },
  { id: 'security', scene: 'verify' }, { id: 'fix', scene: 'attention' },
] as const;
/** A published article viewed as a catalog entry (the body holds its summary). */
export function asAnswer(value: HelpArticleSummary): HelpAnswer {
  return { id: value.id, slug: value.slug, topic: value.topic, title: value.title, body: value.summary,
    chains: value.applicability.chains, requiredFeatures: value.applicability.requiredFeatures,
    networks: value.applicability.networks, walletTypes: value.applicability.walletTypes, keywords: [], locale: value.locale, remote: true,
    kind: value.kind, lastVerifiedAt: value.lastVerifiedAt, testedWalletVersion: value.applicability.testedWalletVersion };
}
/** i18n key for the kind chip: published tutorials say so, other published articles are guides, bundled ones quick answers. */
export function kindLabelKey(answer: HelpAnswer): string {
  return !answer.remote ? 'help.quickAnswer' : answer.kind === 'tutorial' ? 'help.home.tutorialKind' : 'help.guide';
}
export function parseHelpChain(value: unknown): HelpChain | null {
  return typeof value === 'string' && ['all', 'cardano', 'midnight', 'bitcoin'].includes(value) ? value as HelpChain : null;
}
export function walletHelpChain(chain?: string): HelpChain {
  return parseHelpChain(chain?.toLowerCase()) ?? 'all';
}
export function applies(answer: HelpAnswer, context: HelpContext): boolean {
  if (context.chain === 'all') return true;
  if (answer.chains.length && !answer.chains.includes(context.chain)) return false;
  if (answer.requiredFeatures.some(flag => context.features[flag] === false)) return false;
  if (context.network && answer.networks?.length && !answer.networks.includes(context.network)) return false;
  if (context.walletType && answer.walletTypes?.length && !answer.walletTypes.includes(context.walletType)) return false;
  return answer.topic !== 'card' || context.cardSupported !== false;
}
export type TopicEntry = (typeof topics)[number] & { index: number; count: number; demoted: boolean; reason: string };
export function topicIndex(context: HelpContext, catalog: HelpAnswer[] = answers): TopicEntry[] {
  return topics.map((topic, index) => {
    const entries = catalog.filter(answer => answer.topic === topic.id);
    const count = entries.filter(answer => applies(answer, context)).length;
    const chains = [...new Set(entries.flatMap(answer => answer.chains))];
    const chainMismatch = entries.every(answer => answer.chains.length && !answer.chains.includes(context.chain));
    const reason = !entries.length ? 'notPublished' : chainMismatch && chains.length === 1 ? `${chains[0]}Only`
      : topic.id === 'card' && context.cardSupported === false ? 'networkUnavailable' : 'featureUnavailable';
    return { ...topic, index: index + 1, count, demoted: context.chain !== 'all' && count === 0, reason };
  }).sort((a, b) => Number(a.demoted) - Number(b.demoted) || a.index - b.index);
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function searchAnswers(query: string, context: HelpContext, topic?: string): HelpAnswer[] {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return answers.filter(answer => (!topic || answer.topic === topic) && applies(answer, context))
    .map(answer => {
      const title = normalize(`${answer.title} ${answer.keywords.join(' ')}`);
      const body = normalize(answer.body);
      const aliases = answer.chains.flatMap(chain => chain === 'midnight' ? synonyms.midnight : chain === 'bitcoin' ? synonyms.bitcoin : []);
      const all = `${title} ${body} ${normalize(aliases.join(' '))}`;
      return { answer, matches: words.every(word => all.includes(word)), score: words.reduce((score, word) => score + (title.includes(word) ? 4 : body.includes(word) ? 2 : 1), 0) };
    }).filter(item => item.matches).sort((a, b) => b.score - a.score).map(item => item.answer);
}
export function featuredAnswers(chain: HelpChain): HelpAnswer[] {
  const ids = chain === 'midnight' ? ['midnight-start', 'midnight-dust', 'midnight-proof']
    : chain === 'bitcoin' ? ['bitcoin-start', 'bitcoin-receive', 'bitcoin-send']
      : chain === 'cardano' ? ['receive', 'pending', 'backup'] : ['create', 'restore', 'backup'];
  return ids.map(id => answers.find(answer => answer.id === id)!);
}
