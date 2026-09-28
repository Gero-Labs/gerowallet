// Guards the feed's no-financial-advice rule and i18n integrity. The scan is STRUCTURAL:
// it derives the narration set from the i18n files themselves (every `copilot.feed.*`
// key that is not feed chrome), so a new narration template can never dodge the scan by
// simply not being added to NARRATION_TEXT_KEYS. Checks:
//  1. Forbidden-token scan over every narration string in EN, DE and ES.
//  2. Registry match: the i18n narration set === NARRATION_TEXT_KEYS (both directions),
//     so emit-without-register and register-without-string are both caught.
//  3. Coverage: every narration key exists (non-empty) in every language.
//  4. Parity: every wizard/vibe/category/settings key exists in every language.
import { describe, it, expect } from 'vitest';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import es from '@/plugins/i18n/es';
import { NARRATION_TEXT_KEYS } from './narrator';

const EN = us as unknown as Record<string, string>;
const DE = de as unknown as Record<string, string>;
const ES = es as unknown as Record<string, string>;

// `copilot.feed.*` keys that are UI chrome, not agent narration. Chrome copy may
// reference advice in order to negate it (the disclaimer), so it is out of scan scope.
const FEED_CHROME_KEYS = new Set([
  'copilot.feed.empty',
  'copilot.feed.refresh',
  'copilot.feed.clear',
  'copilot.feed.disclaimer',
]);

// Every `copilot.feed.*` key in EN that is not chrome == an agent narration template.
const narrationKeys = Object.keys(EN).filter(
  (k) => k.startsWith('copilot.feed.') && !FEED_CHROME_KEYS.has(k),
);

// Forbidden vocabulary (design spec section 6 + smart-money/copy-trade extensions).
const EN_FORBIDDEN: RegExp[] = [
  /\bbuy\b/i, /\bsell\b/i, /\bhold\b/i, /\bape\b/i, /\bexit\b/i, /get in/i, /get out/i,
  /\bshould\b/i, /shouldn['’]?t/i, /\bwill\b/i, /won['’]?t/i, /\bmoon\b/i, /\bdump\b/i,
  /\bpump\b/i, /\brug\b/i, /\bzero\b/i, /\b\d+x\b/i, /\btarget\b/i, /good for (you|your)/i,
  /\bsuitable\b/i, /right for you/i, /recommend/i, /\bhurry\b/i, /last chance/i,
  /don['’]?t miss/i, /now!/i,
  // smart-money / copy-trading slide
  /\bfollow\b/i, /\bcopy\b/i, /smart money/i, /whale alert/i, /top trader/i, /\bprofitable\b/i,
];

const DE_FORBIDDEN: RegExp[] = [
  /kaufen/i, /\bkauf\b/i, /verkaufen/i, /verkauf/i, /halten/i, /sollst/i, /solltest/i,
  /wirst/i, /\braus\b/i, /aussteig/i, /einsteig/i, /\brein\b/i, /\bmond\b/i, /\bnull\b/i,
  /\bziel\b/i, /\bpump\b/i, /\bdump\b/i, /geeignet/i, /passt zu deinem/i, /empfehl/i,
  /jetzt zugreifen/i, /beeil/i, /letzte chance/i, /verpass/i,
  // smart-money / copy-trading slide
  /folg/i, /kopier/i, /nachkauf/i,
];

// Spanish future tense is morphological, so "will" is covered by the prediction
// verbs and the "va a" periphrasis rather than one token.
const ES_FORBIDDEN: RegExp[] = [
  /\bcompr(a|ar|as|an|e|en|es|ó|aste)\b/i, /\bvend(e|er|es|en|a|as|an|ió|iste)\b/i, /\bventa/i,
  /\bmant[eé]n(er|ga|gas)?\b/i, /deber[ií]as/i, /\bdebes\b/i, /\bvas? a\b/i, /subir[aá]n?\b/i,
  /bajar[aá]n?\b/i, /\bentrar\b/i, /\bsalir\b/i, /\bluna\b/i, /\bpump\b/i, /\bdump\b/i,
  /\brug\b/i, /\bcero\b/i, /\b\d+x\b/i, /\bobjetivo\b/i, /adecuad/i, /para ti\b/i,
  /recomend/i, /ap[uú]rate/i, /\bprisa\b/i, /[uú]ltima oportunidad/i, /no te (lo )?pierdas/i,
  /ahora!/i,
  // smart-money / copy-trading slide
  /\bsigu/i, /\bseguir/i, /\bcopi/i, /dinero inteligente/i, /smart money/i, /ballena/i,
  /\btop trader/i, /mejor(es)? trader/i, /rentable/i,
];

const NEW_COPY_PREFIXES = [
  'copilot.onboarding.',
  'copilot.vibe.',
  'copilot.category.',
  'copilot.settings.',
];

describe('feed no-advice rule (every narration string, every language)', () => {
  it('finds a non-trivial narration set', () => {
    expect(narrationKeys.length).toBeGreaterThanOrEqual(NARRATION_TEXT_KEYS.length);
  });

  it('no English narration string contains a forbidden advice/prediction token', () => {
    for (const key of narrationKeys) {
      const v = EN[key];
      expect(typeof v, `missing EN narration key ${key}`).toBe('string');
      for (const re of EN_FORBIDDEN) {
        expect(re.test(v), `EN ${key} matched forbidden ${re}: "${v}"`).toBe(false);
      }
    }
  });

  it('no German narration string contains a forbidden advice/prediction token', () => {
    for (const key of narrationKeys) {
      const v = DE[key];
      expect(typeof v, `missing DE narration key ${key}`).toBe('string');
      for (const re of DE_FORBIDDEN) {
        expect(re.test(v), `DE ${key} matched forbidden ${re}: "${v}"`).toBe(false);
      }
    }
  });

  it('no Spanish narration string contains a forbidden advice/prediction token', () => {
    for (const key of narrationKeys) {
      const v = ES[key];
      expect(typeof v, `missing ES narration key ${key}`).toBe('string');
      for (const re of ES_FORBIDDEN) {
        expect(re.test(v), `ES ${key} matched forbidden ${re}: "${v}"`).toBe(false);
      }
    }
  });
});

describe('feed i18n integrity', () => {
  it('the i18n narration set exactly matches NARRATION_TEXT_KEYS (no emit-without-register)', () => {
    expect([...narrationKeys].sort()).toEqual([...NARRATION_TEXT_KEYS].sort());
  });

  it('every narration key exists and is non-empty in every language', () => {
    for (const key of NARRATION_TEXT_KEYS) {
      expect(EN[key], `EN ${key}`).toBeTruthy();
      expect(DE[key], `DE ${key}`).toBeTruthy();
      expect(ES[key], `ES ${key}`).toBeTruthy();
    }
  });

  it('wizard/vibe/category/settings copy has full EN<->DE<->ES parity', () => {
    const keysOf = (dict: Record<string, string>) => Object.keys(dict).filter((k) => NEW_COPY_PREFIXES.some((p) => k.startsWith(p))).sort();
    const enKeys = keysOf(EN);
    expect(enKeys.length).toBeGreaterThan(0);
    expect(keysOf(DE)).toEqual(enKeys);
    expect(keysOf(ES)).toEqual(enKeys);
  });
});
