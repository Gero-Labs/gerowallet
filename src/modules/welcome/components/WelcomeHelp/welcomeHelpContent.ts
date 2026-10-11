import { answers, applies, searchAnswers, type HelpAnswer } from '@/modules/help/helpContent';

/**
 * What the welcome screen is showing decides which answers the Help panel leads with:
 *   saved: wallets exist and the sign-in list is on screen
 *   new:   first run, no wallets yet
 *   setup: the Get Started step is open
 */
export type WelcomeHelpState = 'saved' | 'new' | 'setup';
export type WelcomeHelpSectionId = 'gettingBack' | 'newToGero' | 'aboutStep' | 'common';

export interface WelcomeHelpSection {
  id: WelcomeHelpSectionId;
  /** i18n key of the section heading. */
  labelKey: string;
  answers: HelpAnswer[];
}

// Ids of the bundled answers (bundledAnswers.json), in display order.
const LAYOUT: Record<WelcomeHelpState, Array<{ id: WelcomeHelpSectionId; ids: string[] }>> = {
  saved: [
    { id: 'gettingBack', ids: ['restore', 'hardware', 'backup'] },
    { id: 'common', ids: ['midnight-start', 'network', 'pending'] },
  ],
  new: [
    { id: 'newToGero', ids: ['create', 'restore', 'network'] },
    { id: 'common', ids: ['midnight-start', 'backup', 'pending'] },
  ],
  setup: [
    { id: 'aboutStep', ids: ['create', 'restore', 'hardware'] },
    { id: 'common', ids: ['backup', 'network', 'midnight-start'] },
  ],
};

const LABEL_KEYS: Record<WelcomeHelpSectionId, string> = {
  gettingBack: 'help.welcome.gettingBack',
  newToGero: 'help.welcome.newToGero',
  aboutStep: 'help.welcome.aboutStep',
  common: 'help.welcome.common',
};

/** Someone outside their wallet has no chain context, so every answer is in scope. */
const OUTSIDE_WALLET = { chain: 'all', features: {} } as const;

export function welcomeHelpState(started: boolean, hasWallets: boolean): WelcomeHelpState {
  return started ? 'setup' : hasWallets ? 'saved' : 'new';
}

export function welcomeHelpSections(state: WelcomeHelpState): WelcomeHelpSection[] {
  return LAYOUT[state].map(section => ({
    id: section.id,
    labelKey: LABEL_KEYS[section.id],
    answers: section.ids
      .map(id => answers.find(answer => answer.id === id))
      .filter((answer): answer is HelpAnswer => !!answer && applies(answer, OUTSIDE_WALLET)),
  })).filter(section => section.answers.length > 0);
}

/** Other answers from the same state's lists, in list order. */
export function relatedWelcomeAnswers(state: WelcomeHelpState, current: HelpAnswer, limit = 3): HelpAnswer[] {
  const seen = new Set<string>([current.id]);
  const related: HelpAnswer[] = [];
  for (const answer of welcomeHelpSections(state).flatMap(section => section.answers)) {
    if (seen.has(answer.id)) continue;
    seen.add(answer.id);
    related.push(answer);
  }
  return related.slice(0, limit);
}

export function searchWelcomeHelp(query: string): HelpAnswer[] {
  return query.trim() ? searchAnswers(query, OUTSIDE_WALLET) : [];
}

/** English sentence that the bundled `create` answer already ends with. */
export const SETUP_NOTE_SENTENCE = 'Help stays available while setup is open.';

/**
 * Splits a bundled answer into one step per sentence. The setup note is dropped while
 * setup is open because the panel then shows it as its own caption.
 */
export function answerSteps(body: string, setupOpen: boolean): string[] {
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(‘“])/).map(sentence => sentence.trim()).filter(Boolean);
  const steps = setupOpen ? sentences.filter(sentence => sentence !== SETUP_NOTE_SENTENCE) : sentences;
  return steps.length ? steps : [body.trim()].filter(Boolean);
}

/** Path of the full Help Center page for an answer, opened in a new tab. */
export function answerHelpPath(answer: HelpAnswer): string {
  return `/help/articles/${encodeURIComponent(answer.slug || answer.id)}?basic=1`;
}
