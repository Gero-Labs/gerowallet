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

  const score = Math.min(4, raw) as 0 | 1 | 2 | 3 | 4;
  const acceptable =
    password.length >= MIN_RECOVERY_PASSWORD_LENGTH && variety >= 2 && score >= 2;
  return { score, labelKey: STRENGTH_LABEL_KEYS[score], acceptable };
}

/** Single gate used by every set/change site. */
export function isAcceptableRecoveryPassword(pw: string): boolean {
  return scoreRecoveryPassword(pw).acceptable;
}
