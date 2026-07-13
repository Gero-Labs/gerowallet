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

  // Length-only signals are deliberately weak: the >=12 floor is already
  // enforced separately via `acceptable`, so a single mid threshold here (>=8)
  // plus a high one (>=16) keeps a long-but-single-class password (e.g. 14
  // lowercase letters) from reaching the "acceptable" score on length alone —
  // it needs class variety too.
  let raw = 0;
  if (password.length >= 8) raw += 1;
  if (password.length >= 16) raw += 1;
  if (variety >= 2) raw += 1;
  if (variety >= 3) raw += 1;
  if (variety >= 4) raw += 1;

  const score = Math.min(4, raw) as 0 | 1 | 2 | 3 | 4;
  const acceptable = password.length >= MIN_RECOVERY_PASSWORD_LENGTH && score >= 2;
  return { score, labelKey: STRENGTH_LABEL_KEYS[score], acceptable };
}

/** Single gate used by every set/change site. */
export function isAcceptableRecoveryPassword(pw: string): boolean {
  return scoreRecoveryPassword(pw).acceptable;
}
