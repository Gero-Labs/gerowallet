import { describe, it, expect, vi } from 'vitest';
import i18n from '@/plugins/i18n';
import { extractNexusErrorMessage, friendlyTxError, isCollateralError, isInsufficientAdaError, shortfallLovelaceFromMessage } from './txErrors';
import {
  TX_SUBMIT_UNCONFIRMED_MESSAGE,
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  SUBMIT_API_STORAGE_MESSAGE,
} from '@/chrome/config';
import { InputLimitError } from '@/api/nexusInputSelection';

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

describe('friendlyTxError on submit failures', () => {
  // Regression: the background used to hand the UI the CIP-30 boilerplate
  // "Inputs do not conform to this spec or are otherwise invalid." for an HTTP 502,
  // so a backend outage read as a malformed transaction (ticket, 2026-09-21).
  it('localizes the unconfirmed-submission marker without claiming the tx failed', () => {
    const localized = friendlyTxError(new Error(`${TX_SUBMIT_UNCONFIRMED_MESSAGE} (HTTP 502). It may still have reached the network.`));
    expect(localized).not.toContain(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    expect(localized.toLowerCase()).toContain('could not confirm');
    expect(localized.toLowerCase()).not.toContain('was not sent');
  });

  it('drops our prefix from a plain-text node rejection', () => {
    const raw = 'Wallet could not send the tx. Ogmios rejected tx: The withdrawal amount does not match the reward balance.';
    expect(friendlyTxError(new Error(raw)))
      .toBe('The withdrawal amount does not match the reward balance.');
  });

  it('cuts an Ogmios protocol essay to its first sentence', () => {
    const essay = 'Ogmios rejected tx: Invalid transaction; It looks like the given transaction wasn\'t well-formed. '
      + 'Note that I try to decode the transaction in multiple possible eras and it was malformed in ALL eras. '
      + 'Yet, I can\'t pinpoint the exact issue for I do not know in which era / format you intended the transaction to be. '
      + 'The \'data\' field, therefore, contains errors for each era.';
    expect(friendlyTxError(new Error(essay)))
      .toBe('Invalid transaction; It looks like the given transaction wasn\'t well-formed.');
  });
});

describe('friendlyTxError on Nexus input limits', () => {
  it('explains a wallet too fragmented for one transaction, with both counts', () => {
    const localized = friendlyTxError(new InputLimitError(439, 200));
    expect(localized).toContain('439');
    expect(localized).toContain('200');
    expect(localized.toLowerCase()).toContain('consolidate');
  });

  it('shows the reason behind a Nexus validation rejection, not the bare envelope', () => {
    const localized = friendlyTxError(new Error('Validation failed: utxos: Maximum 200 UTXOs allowed per request'));
    expect(localized).toContain('Maximum 200 UTXOs allowed per request');
    expect(localized).not.toBe('Validation failed');
  });
});

describe('shortfallLovelaceFromMessage', () => {
  it('reads outputs plus fee minus inputs from an insufficient-input rejection', () => {
    expect(shortfallLovelaceFromMessage('Insufficient input in transaction. {ada in inputs: 1000000, ada in outputs: 5000000, fee 170000}'))
      .toBe(BigInt(4_170_000));
  });

  it('reads required minus available from a change min-UTxO rejection', () => {
    expect(shortfallLovelaceFromMessage('Insufficient ADA to cover minimum UTXO for change output. Available: 800000 lovelace, required: 1200000 lovelace'))
      .toBe(BigInt(400_000));
  });

  it('returns undefined for anything else', () => {
    expect(shortfallLovelaceFromMessage('Validation failed')).toBeUndefined();
    expect(shortfallLovelaceFromMessage('')).toBeUndefined();
  });
});

describe('friendlyTxError: Submit API', () => {
  it('localizes the invalid-setting message', () => {
    expect(friendlyTxError(new Error(SUBMIT_API_INVALID_MESSAGE))).toBe('Your Submit API setting is invalid. Fix it in Settings > Advanced.');
  });

  it('localizes the hash-mismatch message', () => {
    expect(friendlyTxError(new Error(SUBMIT_API_HASH_MISMATCH_MESSAGE)))
      .toBe('Your submit endpoint returned a different transaction ID. Check your transaction history before sending again.');
  });

  it('localizes the storage-unavailable message through its own key', () => {
    // The English copy equals the constant, so the lookup itself is what proves the mapping.
    const translate = vi.spyOn(i18n, 't');
    try {
      expect(friendlyTxError(new Error(SUBMIT_API_STORAGE_MESSAGE)))
        .toBe("Could not read this wallet's Submit API setting. Nothing was sent.");
      expect(translate).toHaveBeenCalledWith('settings.submitApi.errors.storageUnavailable');
    } finally {
      translate.mockRestore();
    }
  });

  it('keeps the endpoint prefix and localizes the reason behind it', () => {
    const raw = `${SUBMIT_API_ENDPOINT_PREFIX}${TX_SUBMIT_UNCONFIRMED_MESSAGE} (HTTP 503). It may still have reached the network.`;
    const localized = friendlyTxError(new Error(raw));
    expect(localized.startsWith('Your submit endpoint: ')).toBe(true);
    expect(localized.toLowerCase()).toContain('could not confirm');
  });

  it('keeps a node rejection reason behind the prefix', () => {
    const raw = `${SUBMIT_API_ENDPOINT_PREFIX}Wallet could not send the tx. Ogmios rejected tx: The withdrawal amount does not match the reward balance.`;
    expect(friendlyTxError(new Error(raw))).toContain('Your submit endpoint: ');
    expect(friendlyTxError(new Error(raw))).toContain('withdrawal amount does not match');
  });
});
