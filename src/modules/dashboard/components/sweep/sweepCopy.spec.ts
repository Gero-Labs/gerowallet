// One merge is the common case (201 to 399 UTxOs): every string that counts merges has a singular form.
// Through the app's i18n, since its locales come precompiled (vitest has no message compiler).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n, { loadLanguage } from '@/plugins/i18n';

beforeAll(async () => {
  await loadLanguage('de');
  await loadLanguage('es');
});
afterEach(() => { i18n.locale = 'us'; });

const render = (locale: string, key: string, params: Record<string, unknown>, choice: number) => {
  i18n.locale = locale;
  return i18n.tc(key, choice, params);
};

describe('sweep copy plurals', () => {
  it.each([
    ['send.sweepMergesLabel', { merges: 1 }, '1 merge in your wallet', '1 Zusammenführung in deinem Wallet', '1 combinación en tu billetera'],
    ['send.sweepMergesStep', { merges: 1 }, '1 merge into your wallet', '1 Zusammenführung in dein Wallet', '1 combinación en tu billetera'],
    ['send.sweepFeeBreakdown', { merges: 1, mergeFee: '₳0.2', paymentFee: '₳0.2' }, '1 merge ₳0.2 · payment ₳0.2', '1 Zusammenführung ₳0.2 · Zahlung ₳0.2', '1 combinación ₳0.2 · pago ₳0.2'],
    ['send.sweepDoneTransactions', { steps: 2, merges: 1 }, '2 · 1 merge, 1 payment', '2 · 1 Zusammenführung, 1 Zahlung', '2 · 1 combinación, 1 pago'],
    ['send.sweepPreparingCount', { built: 0, total: 1 }, '0 of 1 merge', '0 von 1 Zusammenführung', '0 de 1 combinación'],
  ])('%s reads singular for one merge', (key, params, usText, deText, esText) => {
    expect(render('us', key, params, 1)).toBe(usText);
    expect(render('de', key, params, 1)).toBe(deText);
    expect(render('es', key, params, 1)).toBe(esText);
  });

  it('keeps the plural for several merges', () => {
    expect(render('us', 'send.sweepMergesLabel', { merges: 10 }, 10)).toBe('10 merges in your wallet');
    expect(render('de', 'send.sweepDoneTransactions', { steps: 11, merges: 10 }, 10)).toBe('11 · 10 Zusammenführungen, 1 Zahlung');
    expect(render('es', 'send.sweepPreparingCount', { built: 4, total: 10 }, 10)).toBe('4 de 10 combinaciones');
  });

  it('counts the stop body by its merges', () => {
    expect(render('us', 'send.sweepStoppedBody', { sent: 0, merges: 1 }, 1)).toContain('(0 of 1 merge)');
    expect(render('us', 'send.sweepStoppedBody', { sent: 3, merges: 10 }, 10)).toContain('(3 of 10 merges)');
  });

  it('names several recipients by their count', () => {
    expect(render('us', 'send.sweepDoneToMany', { count: 2 }, 2)).toBe('to 2 recipients');
    expect(render('de', 'send.sweepDoneToMany', { count: 2 }, 2)).toBe('an 2 Empfänger');
    expect(render('es', 'send.sweepDoneToMany', { count: 2 }, 2)).toBe('a 2 destinatarios');
  });
});
