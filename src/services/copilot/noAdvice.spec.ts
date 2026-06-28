// Guards the feed's no-financial-advice rule and i18n integrity:
//  1. Forbidden-token scan over NARRATION_TEXT_KEYS ONLY (what the agent "says").
//     Disclaimer/subtitle copy intentionally references advice in order to negate
//     it, so it is deliberately out of scope here.
//  2. Coverage: every narrator-emittable key exists (non-empty) in EN and DE, so no
//     emitted key can fall back to a raw string at runtime.
//  3. Parity: every new wizard/vibe/category/settings key exists in both languages.
import { describe, it, expect } from 'vitest';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import { NARRATION_TEXT_KEYS } from './narrator';

const EN = us as unknown as Record<string, string>;
const DE = de as unknown as Record<string, string>;

// Derived from the design spec section 6 forbidden list. Applied to narration only.
const EN_FORBIDDEN: RegExp[] = [
  /\bbuy\b/i, /\bsell\b/i, /\bhold\b/i, /\bape\b/i, /\bexit\b/i, /get in/i, /get out/i,
  /\bshould\b/i, /shouldn['’]?t/i, /\bwill\b/i, /won['’]?t/i, /\bmoon\b/i, /\bdump\b/i,
  /\bpump\b/i, /\brug\b/i, /\bzero\b/i, /\b\d+x\b/i, /\btarget\b/i, /good for (you|your)/i,
  /\bsuitable\b/i, /right for you/i, /recommend/i, /\bhurry\b/i, /last chance/i,
  /don['’]?t miss/i, /now!/i,
];

const DE_FORBIDDEN: RegExp[] = [
  /kaufen/i, /\bkauf\b/i, /verkaufen/i, /verkauf/i, /halten/i, /sollst/i, /solltest/i,
  /wirst/i, /\braus\b/i, /aussteig/i, /einsteig/i, /\brein\b/i, /\bmond\b/i, /\bnull\b/i,
  /\bziel\b/i, /\bpump\b/i, /\bdump\b/i, /geeignet/i, /passt zu deinem/i, /empfehl/i,
  /jetzt zugreifen/i, /beeil/i, /letzte chance/i, /verpass/i,
];

const NEW_COPY_PREFIXES = [
  'copilot.onboarding.',
  'copilot.vibe.',
  'copilot.category.',
  'copilot.settings.',
];

describe('feed no-advice rule (narration only)', () => {
  it('no English narration string contains a forbidden advice/prediction token', () => {
    for (const key of NARRATION_TEXT_KEYS) {
      const v = EN[key];
      expect(typeof v, `missing EN narration key ${key}`).toBe('string');
      for (const re of EN_FORBIDDEN) {
        expect(re.test(v), `EN ${key} matched forbidden ${re}: "${v}"`).toBe(false);
      }
    }
  });

  it('no German narration string contains a forbidden advice/prediction token', () => {
    for (const key of NARRATION_TEXT_KEYS) {
      const v = DE[key];
      expect(typeof v, `missing DE narration key ${key}`).toBe('string');
      for (const re of DE_FORBIDDEN) {
        expect(re.test(v), `DE ${key} matched forbidden ${re}: "${v}"`).toBe(false);
      }
    }
  });
});

describe('feed i18n integrity', () => {
  it('every narrator-emittable key exists and is non-empty in both languages', () => {
    for (const key of NARRATION_TEXT_KEYS) {
      expect(EN[key], `EN ${key}`).toBeTruthy();
      expect(DE[key], `DE ${key}`).toBeTruthy();
    }
  });

  it('new wizard/vibe/category/settings copy has full EN<->DE parity', () => {
    const enKeys = Object.keys(EN).filter((k) => NEW_COPY_PREFIXES.some((p) => k.startsWith(p)));
    const deKeys = Object.keys(DE).filter((k) => NEW_COPY_PREFIXES.some((p) => k.startsWith(p)));
    expect(enKeys.length).toBeGreaterThan(0);
    expect([...enKeys].sort()).toEqual([...deKeys].sort());
  });
});
