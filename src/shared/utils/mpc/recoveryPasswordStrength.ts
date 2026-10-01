// Recovery password is the load-bearing secret (design D3): enforce a concrete
// floor client-side on every set/change. Pure + framework-free so it unit-tests
// and is reusable by onboarding and the Settings change-password dialog.
export const MIN_RECOVERY_PASSWORD_LENGTH = 12;

export interface RecoveryPasswordScore {
  /** 0 (weakest) … 4 (strongest). */
  score: 0 | 1 | 2 | 3 | 4;
  /** i18n key for the tier label (see welcome.recoveryStrength*). */
  labelKey: string;
  /** True once the password clears the enforced floor. */
  acceptable: boolean;
}

const STRENGTH_LABEL_KEYS = [
  'welcome.recoveryStrengthWeak',   // 0
  'welcome.recoveryStrengthWeak',   // 1
  'welcome.recoveryStrengthFair',   // 2
  'welcome.recoveryStrengthGood',   // 3
  'welcome.recoveryStrengthStrong', // 4
];

/**
 * Base words that make up most guessed passwords, plus wallet- and brand-
 * specific ones an attacker targeting this wallet would try first. Matched
 * after lower-casing and undoing common letter swaps (0→o, 1→i, 3→e, @→a…).
 */
const COMMON_BASE_WORDS: readonly string[] = [
  'password', 'passwort', 'contrasena', 'passphrase', 'pass', 'secret', 'letmein', 'welcome',
  'admin', 'login', 'master', 'iloveyou', 'loveyou', 'trustno', 'monkey', 'dragon', 'shadow',
  'sunshine', 'princess', 'football', 'baseball', 'soccer', 'superman', 'batman', 'starwars',
  'freedom', 'whatever', 'qwerty', 'qwertz', 'azerty', 'asdfgh', 'zxcvbn', 'qazwsx', 'abcdef',
  'recovery', 'recover', 'backup', 'wallet', 'gerowallet', 'gero', 'cardano', 'bitcoin',
  'crypto', 'google', 'gmail', 'changeme', 'default', 'test',
];

const BASE_WORDS_LONGEST_FIRST = [...COMMON_BASE_WORDS].sort((a, b) => b.length - a.length);

/** Letter swaps undone before the base-word check ('P@ssw0rd' reads as 'password'). */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g' };

/** Fewer distinct characters than this is a repeat pattern ('Aaaa1111aaaa'). */
const MIN_DISTINCT_CHARS = 6;
/** A run of sequential or repeated characters this long dominates the password. */
const MAX_RUN_FRACTION = 0.5;

/** Longest run of characters stepping by +1, -1 or 0 (case-insensitive): 'abcd', '4321', 'zzzz'. */
function longestRun(password: string): number {
  const codes = Array.from(password.toLowerCase(), (c) => c.codePointAt(0) ?? 0);
  let best = codes.length > 0 ? 1 : 0;
  let run = 1;
  let step: number | null = null;
  for (let i = 1; i < codes.length; i++) {
    const d = codes[i] - codes[i - 1];
    if (Math.abs(d) <= 1 && (step === null || d === step)) {
      run += 1;
      step = d;
    } else if (Math.abs(d) <= 1) {
      run = 2;
      step = d;
    } else {
      run = 1;
      step = null;
    }
    best = Math.max(best, run);
  }
  return best;
}

/**
 * True when the password is built from a guessable pattern that the length and
 * class rules alone let through, such as 'Password1234', 'P@ssw0rd2024!',
 * 'Cardano12345' or 'Abcdefgh1234'. The recovery blob can be fetched and
 * attacked offline, so these are refused rather than just scored low.
 */
export function isCommonRecoveryPattern(pw: string): boolean {
  const password = pw ?? '';
  if (new Set(Array.from(password.toLowerCase())).size < MIN_DISTINCT_CHARS) return true;
  if (longestRun(password) >= Math.ceil(password.length * MAX_RUN_FRACTION)) return true;

  // Keep letters only (once as typed, once with letter swaps undone, so both
  // 'Cardano12345' and 'P@ssw0rd!' are read), then strip every common base
  // word: if under 4 letters are left, it is a base word plus padding.
  const lower = password.toLowerCase();
  const asTyped = lower.replace(/[^a-z]/g, '');
  const unswapped = Array.from(lower, (c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
  return [asTyped, unswapped].some(isBaseWordPlusPadding);
}

function isBaseWordPlusPadding(letters: string): boolean {
  let rest = letters;
  let hit = false;
  for (const word of BASE_WORDS_LONGEST_FIRST) {
    if (rest.includes(word)) {
      hit = true;
      rest = rest.split(word).join('');
    }
  }
  return hit && rest.length < 4;
}

/** Heuristic 0–4 score from length + character-class variety. No external deps. */
export function scoreRecoveryPassword(pw: string): RecoveryPasswordScore {
  const password = pw ?? '';
  if (password.length === 0) {
    return { score: 0, labelKey: STRENGTH_LABEL_KEYS[0], acceptable: false };
  }

  let variety = 0;
  if (/[a-z]/.test(password)) variety += 1;
  if (/[A-Z]/.test(password)) variety += 1;
  if (/\d/.test(password)) variety += 1;
  if (/[^A-Za-z0-9]/.test(password)) variety += 1;

  // Length-only signals (>=8, >=16) can still push the numeric `score` to 2
  // or higher on their own — that's fine, `score` just drives the UI meter.
  // The `acceptable` gate below is the actual security floor and independently
  // requires `variety >= 2`, so a long-but-single-class password (e.g. 16 or
  // 20 lowercase letters, or 16 digits) can score high yet is NEVER
  // acceptable: length alone must never satisfy the D3 custody gate.
  let raw = 0;
  if (password.length >= 8) raw += 1;
  if (password.length >= 16) raw += 1;
  if (variety >= 2) raw += 1;
  if (variety >= 3) raw += 1;
  if (variety >= 4) raw += 1;

  // A common pattern is capped at the weakest tier and never acceptable.
  const common = isCommonRecoveryPattern(password);
  const score = (common ? Math.min(1, raw) : Math.min(4, raw)) as 0 | 1 | 2 | 3 | 4;
  const acceptable =
    password.length >= MIN_RECOVERY_PASSWORD_LENGTH && variety >= 2 && score >= 2 && !common;
  return { score, labelKey: STRENGTH_LABEL_KEYS[score], acceptable };
}

/**
 * Single gate used by every set/change site: the onboarding and Settings forms,
 * and again in the background before a recovery blob is ever encrypted.
 */
export function isAcceptableRecoveryPassword(pw: string): boolean {
  return scoreRecoveryPassword(pw).acceptable;
}
