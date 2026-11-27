/**
 * The i18n key for every code the create flow can show, in one place, so a spec can check that
 * each one exists in every language and no screen builds a key from a code.
 */
import type { CosignerVerificationState } from '@/shared/gerovault';
import type { CosignerProblem, QrRefusal, TemplateProblem } from './createVault';
import type { CreateEligibility } from './eligibility';
import type { CreateStep, UnlockProblem } from './useCreateVault';

export const STEP_KEYS: Readonly<Record<CreateStep, string>> = {
  template: 'gerovault.create.steps.template',
  cosigners: 'gerovault.create.steps.cosigners',
  verify: 'gerovault.create.steps.verify',
};

export const UNAVAILABLE_KEYS: Readonly<Record<Extract<CreateEligibility, { ok: false }>['reason'], string>> = {
  NO_WALLET: 'gerovault.create.unavailable.noWallet',
  NETWORK_CLOSED: 'gerovault.create.unavailable.network',
  WALLET_NOT_SUPPORTED: 'gerovault.create.unavailable.wallet',
};

const LABEL_RULE = 'gerovault.create.labelRule';

export const TEMPLATE_PROBLEM_KEYS: Readonly<Record<TemplateProblem, string>> = {
  TOO_FEW_OWNERS: 'gerovault.create.template.problem.tooFewOwners',
  TOO_MANY_OWNERS: 'gerovault.create.template.problem.tooManyOwners',
  THRESHOLD_TOO_LOW: 'gerovault.create.template.problem.thresholdTooLow',
  THRESHOLD_OUT_OF_RANGE: 'gerovault.create.template.problem.thresholdTooHigh',
  NOT_ACKNOWLEDGED: 'gerovault.create.template.problem.notAcknowledged',
  INVALID_NAME: LABEL_RULE,
};

export const UNLOCK_PROBLEM_KEYS: Readonly<Record<UnlockProblem, string>> = {
  'wrong-password': 'gerovault.create.own.problem.wrongPassword',
  locked: 'gerovault.create.own.problem.locked',
  unavailable: 'gerovault.create.own.problem.unavailable',
  cancelled: 'gerovault.create.own.problem.cancelled',
  'not-supported': 'gerovault.create.own.problem.notSupported',
  'not-found': 'gerovault.create.own.problem.notFound',
  TOO_MANY_PENDING: 'gerovault.create.own.problem.tooManyPending',
  INDEX_SPACE_EXHAUSTED: 'gerovault.create.own.problem.indexSpace',
  INVALID_HISTORY: 'gerovault.create.own.problem.history',
  STORE_UNAVAILABLE: 'gerovault.create.own.problem.store',
  NETWORK: 'gerovault.invite.problem.NETWORK',
  EXPIRED: 'gerovault.invite.problem.EXPIRED',
};

export const COSIGNER_PROBLEM_KEYS: Readonly<Record<CosignerProblem, string>> = {
  LABEL_REQUIRED: 'gerovault.create.cosigner.problem.labelRequired',
  INVALID_LABEL: LABEL_RULE,
  KEYS_REQUIRED: 'gerovault.create.cosigner.problem.keysRequired',
  TWO_KEYS_EXPECTED: 'gerovault.create.cosigner.problem.twoKeys',
  INVALID_VAULT_KEYS: 'gerovault.create.cosigner.problem.invalidVaultKeys',
  EXTENDED_KEY_NOT_ACCEPTED: 'gerovault.create.cosigner.problem.extendedKey',
  VAULT_KEYS_NOT_EXTERNAL: 'gerovault.create.cosigner.problem.vaultKeysNotExternal',
  INVALID_EXTERNAL_KEYS: 'gerovault.create.cosigner.problem.invalidExternalKeys',
  CIP1852_KEY: 'gerovault.create.cosigner.problem.cip1852Key',
  INDEX_REQUIRED: 'gerovault.create.cosigner.problem.indexRequired',
  INVALID_INDEX: 'gerovault.create.cosigner.problem.invalidIndex',
  SAME_AS_YOURS: 'gerovault.create.cosigner.problem.sameAsYours',
  SAME_AS_ANOTHER: 'gerovault.create.cosigner.problem.sameAsAnother',
  INVITE_PENDING: 'gerovault.invite.card.pending',
};

export const QR_REFUSAL_KEYS: Readonly<Record<QrRefusal, string>> = {
  OTHER_VAULT: 'gerovault.create.qr.refusal.otherVault',
  DIFFERENT_KEYS: 'gerovault.create.qr.refusal.differentKeys',
  MALFORMED_QR: 'gerovault.create.qr.refusal.malformed',
};

/** A cosigner's state as the holders list shows it. `verified` is split by method there. */
export const COSIGNER_STATE_KEYS: Readonly<Record<CosignerVerificationState, string>> = {
  verified: 'gerovault.create.holders.state.verified',
  importerOnly: 'gerovault.create.holders.state.waitingFile',
  stale: 'gerovault.create.holders.state.stale',
  providerOnly: 'gerovault.create.holders.state.unverified',
  unverified: 'gerovault.create.holders.state.unverified',
};

export const VERIFIED_BY_KEYS: Readonly<Record<'number' | 'qr' | 'external' | 'endorsed', string>> = {
  number: 'gerovault.create.holders.state.byNumber',
  qr: 'gerovault.create.holders.state.byQr',
  external: 'gerovault.create.holders.state.byFile',
  endorsed: 'gerovault.create.holders.state.byFile',
};

const SAVE_PROBLEM_KEYS: Readonly<Record<string, string>> = {
  VAULT_EXISTS: 'gerovault.create.saveProblem.exists',
  STORE_UNAVAILABLE: 'gerovault.create.saveProblem.store',
  INDEX_TAKEN: 'gerovault.create.saveProblem.indexTaken',
};

/** A store or library code from Save. Unknown codes show with the code itself. */
export function saveProblemKey(code: string): string {
  return SAVE_PROBLEM_KEYS[code] ?? 'gerovault.create.saveProblem.other';
}

/** Every key above, for the spec that checks the catalogs. */
export const ALL_CREATE_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(STEP_KEYS),
  ...Object.values(UNAVAILABLE_KEYS),
  ...Object.values(TEMPLATE_PROBLEM_KEYS),
  ...Object.values(UNLOCK_PROBLEM_KEYS),
  ...Object.values(COSIGNER_PROBLEM_KEYS),
  ...Object.values(QR_REFUSAL_KEYS),
  ...Object.values(COSIGNER_STATE_KEYS),
  ...Object.values(VERIFIED_BY_KEYS),
  ...Object.values(SAVE_PROBLEM_KEYS),
  'gerovault.create.saveProblem.other',
];
