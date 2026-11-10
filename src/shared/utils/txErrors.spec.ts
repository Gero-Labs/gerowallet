import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/plugins/i18n';
import { extractNexusErrorMessage, friendlyDappTxError, friendlyTxError, isCollateralError, isInsufficientAdaError, isMissingInputError, signRefusalText, shortfallLovelaceFromMessage } from './txErrors';
import {
  MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE,
  TREZOR_GOVERNANCE_REFUSAL_MESSAGE,
  TX_SUBMIT_UNCONFIRMED_MESSAGE,
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  SUBMIT_API_STORAGE_MESSAGE,
} from '@/chrome/config';
import { InputLimitError } from '@/api/nexusInputSelection';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';

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

  // A dApp's market transaction is signable only under the approval it was previewed with; once
  // that runs out the worker refuses with a fixed English string, which has to read as a sentence
  // the user can act on, in their own language.
  it('localizes the market signing refusal for a dApp approval, where an approval ran out', () => {
    const localized = friendlyDappTxError(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE));
    expect(localized).toBe('This took too long. Start it again.');
    expect(localized).not.toContain('Gero cannot sign');
    expect(friendlyTxError(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE), { marketApproval: true })).toBe(localized);
  });

  // A plain Gero Send (or any other flow of the wallet's own) to a listing-script address meets the
  // same refusal. Nothing there took too long: the transaction is simply not one to sign from there.
  it('says so honestly for every other caller: the transaction can only be signed from the market screens', () => {
    const localized = friendlyTxError(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE));
    expect(localized).toBe('This transaction touches an NFT listing, so it can only be signed from the market screens.');
    expect(localized).not.toMatch(/took too long|start it again/i);
    expect(localized).not.toContain('Gero cannot sign');
    expect(friendlyTxError(NFT_MARKET_SIGN_REFUSAL_MESSAGE)).toBe(localized);
  });

  it('keeps the market copy for the dApp approval screens only: the side panel and the popup both ask for it', () => {
    const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
    const overlay = read('../../sidepanel/components/DAppOverlay.vue');
    expect(overlay).toContain('friendlyDappTxError(');
    expect(overlay.replace(/friendlyDappTxError/g, '')).not.toMatch(/friendlyTxError\(/);
    // The popup shows device errors as they are, so it reads the refusals alone.
    const popup = read('../../popup/modules/views/SignTx.vue');
    expect(popup).toContain('signRefusalText(message, { marketApproval: true })');
    expect(popup).not.toMatch(/friendlyTxError\(|friendlyDappTxError\(/);
  });

  it('signRefusalText words the market refusal for its caller and leaves any other message alone', () => {
    expect(signRefusalText(NFT_MARKET_SIGN_REFUSAL_MESSAGE, { marketApproval: true })).toBe('This took too long. Start it again.');
    expect(signRefusalText(NFT_MARKET_SIGN_REFUSAL_MESSAGE)).toBe('This transaction touches an NFT listing, so it can only be signed from the market screens.');
    expect(signRefusalText('Device rejected synthetic test request', { marketApproval: true })).toBeUndefined();
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

describe('friendlyTxError on a signing refusal', () => {
  it('localizes the background\'s refusal of a transaction marked to fail', () => {
    expect(friendlyTxError(new Error(MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE))).toBe(i18n.t('errors.markedToFailRefused'));
  });

  it('localizes the Trezor refusal of a body it cannot carry', () => {
    expect(friendlyTxError(new Error(TREZOR_GOVERNANCE_REFUSAL_MESSAGE))).toBe(i18n.t('errors.trezorGovernanceRefused'));
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

  // Nexus's transfer builder, when the inputs it was offered hold less than the outputs:
  // the case a wallet spread over more UTxOs than one request carries runs into.
  it('reads required minus available from a transfer build short of ADA', () => {
    expect(shortfallLovelaceFromMessage('Insufficient ADA. Required: 15000.170000 ADA (15000170000 lovelace), available: 9112.400000 ADA (9112400000 lovelace)'))
      .toBe(BigInt(5_887_770_000));
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

describe('friendlyTxError on the request rate limit', () => {
  // gero-backend's Nexus proxy answers 429 `{"error":"rate_limit_exceeded","message":"Too many
  // requests — slow down"}`; a sweep on a large wallet hit it (2026-11-02) and the dialog showed
  // the raw text, em dash mangled. The status may come on the enriched error, the words in the
  // message, or both.
  it('localizes a 429 whichever way it arrives', () => {
    const expected = i18n.t('errors.rateLimited');
    const enriched = Object.assign(new Error('Too many requests — slow down'), {
      response: { status: 429, data: { error: 'rate_limit_exceeded', message: 'Too many requests — slow down' } },
    });
    expect(friendlyTxError(enriched)).toBe(expected);
    expect(friendlyTxError(Object.assign(new Error('Request failed with status code 429'), { response: { status: 429 } }))).toBe(expected);
    expect(friendlyTxError(new Error('Too many requests — slow down'))).toBe(expected);
    expect(friendlyTxError(new Error(JSON.stringify({ data: { error: 'rate_limit_exceeded', message: 'slow down' }, status: 429 })))).toBe(expected);
  });

  it('never shows the server text', () => {
    const localized = friendlyTxError(new Error('Too many requests — slow down'));
    expect(localized).not.toContain('slow down');
    expect(localized).not.toBe('errors.rateLimited');
  });
});

describe('isMissingInputError', () => {
  it.each([
    'BadInputsUTxO',
    'Ogmios rejected tx: (BadInputsUTxO (fromList [TxIn ...]))',
    'The transaction contains unknown UTxO references as inputs',
  ])('recognises %s', (message) => {
    expect(isMissingInputError(message)).toBe(true);
  });

  it('does not mistake other refusals for it', () => {
    expect(isMissingInputError('ValueNotConservedUTxO')).toBe(false);
    expect(isMissingInputError('OutsideValidityIntervalUTxO')).toBe(false);
  });
});
