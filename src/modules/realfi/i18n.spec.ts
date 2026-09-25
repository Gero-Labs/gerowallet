import { describe, expect, it } from 'vitest';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import { ORDER_ACTION_VALUES, ORDER_STATUS_VALUES } from './types';

/**
 * Every status and action the SDK can return must have a label in every language.
 *
 * The page builds these keys at runtime (`realfi.statuses.${…}`), so a missing one is
 * invisible to the typechecker and to any test that mocks $t — it only shows up as a
 * raw `realfi.statuses.heldForScreening` in front of a user. This is the test that
 * would have caught the SDK adding four statuses and two actions behind our back.
 */
const locales = { us, de } as Record<string, Record<string, string>>;

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

describe('RealFi labels', () => {
  for (const [name, dict] of Object.entries(locales)) {
    it(`${name} labels every order status`, () => {
      const missing = ORDER_STATUS_VALUES.map((s) => `realfi.statuses.${lowerFirst(s)}`).filter(
        (key) => !dict[key],
      );
      expect(missing).toEqual([]);
    });

    it(`${name} labels every order action`, () => {
      const missing = ORDER_ACTION_VALUES.map((a) => `realfi.actions.${lowerFirst(a)}`).filter(
        (key) => !dict[key],
      );
      expect(missing).toEqual([]);
    });
  }

  it('has the same RealFi keys in every language', () => {
    const keys = (dict: Record<string, string>) =>
      Object.keys(dict).filter((k) => k.startsWith('realfi.')).sort();
    expect(keys(locales['de']!)).toEqual(keys(locales['us']!));
  });
});
