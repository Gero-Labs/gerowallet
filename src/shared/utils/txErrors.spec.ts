import { describe, it, expect } from 'vitest';
import { isCollateralError, isInsufficientAdaError } from './txErrors';

describe('isCollateralError', () => {
  it('matches a genuine missing-collateral error', () => {
    expect(isCollateralError(
      'Wallet needs a pure-ADA UTxO of at least 5.0 ADA for Plutus collateral. '
      + 'Consolidate or split a UTxO so one entry has no native tokens.',
    )).toBe(true);
  });

  it('matches the collateralReturn-too-small error', () => {
    expect(isCollateralError(
      'Collateral UTxO too small to leave a valid collateralReturn.',
    )).toBe(true);
  });

  // Regression: Nexus's insufficient-ADA message names the bucket it counted
  // ("non-collateral UTxOs"), which the bare 'collateral' substring match used to
  // hijack — the user was told to create an ADA-only UTxO when they simply needed
  // more ADA. Observed in production 2026-08-04.
  it('does NOT claim an insufficient-ADA error is a collateral error', () => {
    const msg = 'Insufficient ADA for DUST registration. Required: ~3.353340 ADA '
      + '(script output + fee), available in non-collateral UTxOs: 2.100000 ADA';
    expect(isInsufficientAdaError(msg)).toBe(true);
    expect(isCollateralError(msg)).toBe(false);
  });

  it('does not claim a shared-pool outage is the user wallet\'s problem', () => {
    expect(isCollateralError('Collateral pool empty')).toBe(false);
  });
});
