import { describe, it, expect } from 'vitest';
import { extractNexusErrorMessage, isCollateralError, isInsufficientAdaError } from './txErrors';

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

describe('extractNexusErrorMessage', () => {
  /** What parseHttpError hands the DUST dialog for a node rejection (trimmed sample, 2026-09-15). */
  const ogmiosRejection = JSON.stringify({
    data: {
      timestamp: '2026-09-15T14:21:27.761127944',
      status: 400,
      error: 'Transaction Submission Failed',
      message: 'Ogmios rejected transaction (400 BAD_REQUEST): ' + JSON.stringify({
        jsonrpc: '2.0',
        method: 'submitTransaction',
        error: {
          code: 3120,
          message: 'Some output values in the transaction are too large. Once serialized, values must be '
            + 'below a certain threshold. That threshold sits around 4 KB during the Mary era, and was then '
            + 'made configurable as a protocol parameter in later era.',
          data: { excessivelyLargeOutputs: [{ address: 'addr1q98q…', value: { ada: { lovelace: 35418749 } } }] },
        },
        id: null,
      }),
      path: '/api/transactions/submit',
    },
    headers: { 'content-type': 'application/json' },
    status: 400,
  });

  it('unwraps an Ogmios rejection down to the node\'s first sentence', () => {
    expect(extractNexusErrorMessage(ogmiosRejection))
      .toBe('Some output values in the transaction are too large.');
  });

  it('keeps a multi-sentence Nexus build message intact', () => {
    const message = 'Insufficient ADA for DUST registration. Required: ~3.353340 ADA '
      + '(script output + fee), available in non-collateral UTxOs: 2.100000 ADA';
    expect(extractNexusErrorMessage(JSON.stringify({ data: { message }, status: 400 }))).toBe(message);
  });

  it('returns a plain-text body and non-JSON input unchanged', () => {
    expect(extractNexusErrorMessage(JSON.stringify({ data: 'Collateral pool empty', status: 503 })))
      .toBe('Collateral pool empty');
    expect(extractNexusErrorMessage('Request timeout - please try again')).toBe('Request timeout - please try again');
  });

  it('still lets the collateral classifier see a wrapped collateral error', () => {
    const wrapped = JSON.stringify({ data: { message: 'Wallet needs a pure-ADA UTxO of at least 5.0 ADA for Plutus collateral.' } });
    expect(isCollateralError(extractNexusErrorMessage(wrapped))).toBe(true);
  });
});
