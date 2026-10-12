import { describe, expect, it } from 'vitest';
import { answers, applies, featuredAnswers, searchAnswers, topicIndex, type HelpContext } from './helpContent';

const midnight: HelpContext = { chain: 'midnight', features: {} };
describe('chain-specific Help content', () => {
  it('demotes Gero Card for Midnight without hiding it or presenting an empty guide count', () => {
    const index = topicIndex(midnight);
    expect(index).toHaveLength(6);
    const card = index.find(topic => topic.id === 'card')!;
    expect(card).toMatchObject({ demoted: true, reason: 'cardanoOnly' });
    expect(index.indexOf(card)).toBeGreaterThan(index.findIndex(topic => topic.id === 'start'));
    expect(topicIndex({ chain: 'all', features: { isGeroCardEnabled: false } }).every(topic => !topic.demoted)).toBe(true);
  });
  it('checks known flags/network independently and does not treat cold flags as exclusion', () => {
    const card = answers.find(answer => answer.id === 'card')!;
    expect(applies(card, { chain: 'cardano', features: {} })).toBe(true);
    expect(applies(card, { chain: 'cardano', features: { isGeroCardEnabled: false } })).toBe(false);
    expect(applies(card, { chain: 'cardano', features: { isGeroCardEnabled: true }, cardSupported: false })).toBe(false);
  });
  it('includes general recovery answers and matches Midnight/Bitcoin terms', () => {
    expect(searchAnswers('recovery', midnight).map(a => a.id)).toContain('backup');
    expect(searchAnswers('prover', midnight).map(a => a.id)).toContain('midnight-proof');
    expect(searchAnswers('sats', { chain: 'bitcoin', features: {} }).map(a => a.id)).toContain('bitcoin-send');
    expect(searchAnswers('DUST', midnight).every(a => !a.chains.length || a.chains.includes('midnight'))).toBe(true);
  });
  it('features relevant answers and keeps DUST registration under Get started', () => {
    expect(featuredAnswers('midnight').map(a => a.id)).toContain('midnight-dust');
    expect(featuredAnswers('bitcoin').map(a => a.id)).toContain('bitcoin-receive');
    expect(answers.find(a => a.id === 'midnight-dust')?.topic).toBe('start');
  });
});
