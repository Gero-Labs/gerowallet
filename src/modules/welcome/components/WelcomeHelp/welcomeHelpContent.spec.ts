import { describe, expect, it } from 'vitest';
import { answers } from '@/modules/help/helpContent';
import {
  answerHelpPath,
  answerSteps,
  relatedWelcomeAnswers,
  searchWelcomeHelp,
  welcomeHelpSections,
  welcomeHelpState,
} from './welcomeHelpContent';

const ids = (state: Parameters<typeof welcomeHelpSections>[0]) => welcomeHelpSections(state).map(section => [section.id, section.answers.map(answer => answer.id)]);

describe('welcome help content', () => {
  it('derives the state from setup and saved wallets, setup winning', () => {
    expect(welcomeHelpState(false, true)).toBe('saved');
    expect(welcomeHelpState(false, false)).toBe('new');
    expect(welcomeHelpState(true, true)).toBe('setup');
    expect(welcomeHelpState(true, false)).toBe('setup');
  });

  it('leads each state with its own lists of bundled answers', () => {
    expect(ids('saved')).toEqual([
      ['gettingBack', ['restore', 'hardware', 'backup']],
      ['common', ['midnight-start', 'network', 'pending']],
    ]);
    expect(ids('new')).toEqual([
      ['newToGero', ['create', 'restore', 'network']],
      ['common', ['midnight-start', 'backup', 'pending']],
    ]);
    expect(ids('setup')).toEqual([
      ['aboutStep', ['create', 'restore', 'hardware']],
      ['common', ['backup', 'network', 'midnight-start']],
    ]);
  });

  it('only lists answers that ship in the bundle', () => {
    const bundled = new Set(answers.map(answer => answer.id));
    for (const state of ['saved', 'new', 'setup'] as const) {
      for (const section of welcomeHelpSections(state)) {
        expect(section.answers).toHaveLength(3);
        section.answers.forEach(answer => expect(bundled.has(answer.id)).toBe(true));
      }
    }
  });

  it('offers three other answers from the same state as related reading', () => {
    const restore = answers.find(answer => answer.id === 'restore')!;
    const related = relatedWelcomeAnswers('setup', restore).map(answer => answer.id);
    expect(related).toEqual(['create', 'hardware', 'backup']);
    expect(related).not.toContain('restore');
    // An answer found by search that is in none of the lists still gets three.
    const send = answers.find(answer => answer.id === 'send')!;
    expect(relatedWelcomeAnswers('saved', send)).toHaveLength(3);
  });

  it('searches every bundled answer without a chain filter and ignores blank queries', () => {
    expect(searchWelcomeHelp('   ')).toEqual([]);
    expect(searchWelcomeHelp('hardware').map(answer => answer.id)).toContain('hardware');
    // Chain-specific answers are reachable from the welcome screen too.
    expect(searchWelcomeHelp('midnight').map(answer => answer.id)).toContain('midnight-start');
    expect(searchWelcomeHelp('zzzz-no-such-thing')).toEqual([]);
  });

  it('splits a bundled body into one step per sentence', () => {
    const restore = answers.find(answer => answer.id === 'restore')!;
    expect(answerSteps(restore.body, false)).toEqual([
      'Use the import or restore option on the welcome screen and select the correct chain.',
      'Enter recovery information only in the wallet restoration flow, never in chat or email.',
      'Check the restored addresses and network before moving funds.',
    ]);
    expect(answerSteps('Single sentence only', false)).toEqual(['Single sentence only']);
  });

  it('drops the setup note from the steps only while setup shows it as a caption', () => {
    const create = answers.find(answer => answer.id === 'create')!;
    expect(answerSteps(create.body, false).at(-1)).toBe('Help stays available while setup is open.');
    expect(answerSteps(create.body, true)).toHaveLength(3);
    expect(answerSteps(create.body, true)).not.toContain('Help stays available while setup is open.');
  });

  it('links the full Help Center article in basic mode', () => {
    expect(answerHelpPath(answers.find(answer => answer.id === 'restore')!)).toBe('/help/articles/restore?basic=1');
  });
});
