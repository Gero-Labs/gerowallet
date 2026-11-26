// Every key the vault and recovery screens build at run time exists in English (the parity spec
// carries it to German and Spanish), so no typed error ever shows as a raw key.
import { describe, expect, it } from 'vitest';
import us from '@/plugins/i18n/us';
import { RECOVERY_EXPORT_ERRORS } from './useRecoveryExport';
import { RECOVERY_IMPORT_ERRORS } from './useRecoveryImport';

const R = 'gerovault.detail.recovery.';

describe('GeroVault screen keys', () => {
  it('names every export and import error', () => {
    const missing = [
      ...RECOVERY_EXPORT_ERRORS.map(code => `${R}exportError.${code}`),
      ...RECOVERY_IMPORT_ERRORS.map(code => `${R}importError.${code}`),
    ].filter(key => !(key in us));
    expect(missing).toEqual([]);
  });

  it('has every key built from a state', () => {
    const built = [
      ...['CANDIDATE', 'NO_MANIFEST', 'NOT_VERIFIED'].map(r => `gerovault.detail.funding.${r}`),
      ...['opening', 'restoring', 'saving'].map(s => `${R}busy.${s}`),
      ...['funded', 'used'].flatMap(f => ['Yes', 'No', 'Unknown'].map(v => `${R}chain.${f}${v}`)),
      ...['TOO_SHORT', 'CONTROL_CHARACTER', 'NOT_WELL_FORMED'].map(p => `${R}ownProblem.${p}`),
    ];
    expect(built.filter(key => !(key in us))).toEqual([]);
  });

  it('keeps the English text plain ASCII, with no em or en dash', () => {
    const offenders = Object.entries(us).filter(([k, v]) => k.startsWith('gerovault.detail.') && /[^\x20-\x7e]/.test(v));
    expect(offenders).toEqual([]);
  });
});
