/**
 * Logic behind the Submit API background handlers (SET / TEST / CLEAR_SUBMIT_API).
 * background.ts only registers them; everything testable lives here.
 *
 * Every entry point acts on the logged-in wallet passed in by the handler, and
 * refuses a request naming any other wallet id, so a dialog left open across a
 * wallet switch cannot write into the newly active wallet.
 */
import { Blockchain } from '@/models/types';
import { clearSubmitApi, readSubmitApi, writeSubmitApi } from '@/chrome/submitApiStore';
import { probeSubmitEndpoint } from '@/chrome/submitRouter';
import {
  isValidHeaderValue,
  submitApiLastResultKey,
  validateStoredSubmitApiConfig,
  validateSubmitApiInput,
  type SubmitApiErrorCode,
  type SubmitApiField,
  type SubmitApiSettingsResult,
  type SubmitApiTestResult,
  type SubmitApiValidation,
} from '@/shared/utils/submitApiConfig';

export interface SubmitApiWallet {
  id: number;
  chain: string;
  network: string;
}

type Refusal = Extract<SubmitApiSettingsResult, { success: false }>;

function refusalFor(wallet: SubmitApiWallet | null, request: Record<string, unknown>): Refusal | null {
  // OX Agent: Sensitive Data Protection prevented - acts only on the logged-in wallet named in the request
  if (!wallet || request['walletId'] !== wallet.id) return { success: false, error: 'walletMismatch' };
  if (wallet.chain !== Blockchain.CARDANO) return { success: false, error: 'unsupportedChain' };
  return null;
}

function firstError(validation: SubmitApiValidation): Refusal {
  const [field, code] = Object.entries(validation.errors)[0] as [SubmitApiField, SubmitApiErrorCode];
  return { success: false, error: code, field };
}

/**
 * Validates the request against the stored row. savedOrigin always comes from the
 * stored, re-validated row, never from the request, so a kept secret cannot follow
 * a typed URL to another host. keepsSaved: a stored, valid secret is kept.
 */
async function validateRequest(wallet: SubmitApiWallet, request: Record<string, unknown>) {
  const stored = await readSubmitApi(wallet.id);
  const savedConfig = validateStoredSubmitApiConfig(stored.config, wallet.network);
  const keepsSaved = request['headerValue'] === undefined && savedConfig !== null && savedConfig.hasAuth && isValidHeaderValue(stored.auth);
  const validation = validateSubmitApiInput(
    {
      url: request['url'],
      headerName: request['headerName'],
      headerValue: request['headerValue'],
      keepsSavedValue: keepsSaved,
      savedOrigin: savedConfig === null ? null : new URL(savedConfig.url).origin,
    },
    wallet.network,
  );
  return { stored, keepsSaved, validation };
}

export async function saveSubmitApi(
  wallet: SubmitApiWallet | null,
  request: Record<string, unknown>,
): Promise<SubmitApiSettingsResult> {
  const refusal = refusalFor(wallet, request);
  if (refusal !== null) return refusal;
  const { keepsSaved, validation } = await validateRequest(wallet, request);
  // OX Agent: SSRF prevented - validateSubmitApiInput gates every URL before it is stored
  if (validation.normalized === null) return firstError(validation);
  const { url, headerName, headerValue } = validation.normalized;
  await writeSubmitApi(
    wallet.id,
    {
      version: 1,
      url,
      headerName,
      hasAuth: headerValue === undefined ? keepsSaved : headerValue !== null,
      fallbackToDefault: request['fallbackToDefault'] === true,
    },
    headerValue,
  );
  return { success: true };
}

export async function testSubmitApi(
  wallet: SubmitApiWallet | null,
  request: Record<string, unknown>,
): Promise<SubmitApiSettingsResult<SubmitApiTestResult>> {
  const refusal = refusalFor(wallet, request);
  if (refusal !== null) return refusal;
  const { stored, validation } = await validateRequest(wallet, request);
  // OX Agent: SSRF prevented - validateSubmitApiInput gates the URL before the probe
  if (validation.normalized === null) return firstError(validation);
  const { url, headerName, headerValue } = validation.normalized;
  // undefined only comes back from validation when the stored, valid secret is kept.
  const value = headerValue === undefined ? (isValidHeaderValue(stored.auth) ? stored.auth : null) : headerValue;
  return { success: true, result: await probeSubmitEndpoint(url, headerName, value) };
}

export async function resetSubmitApi(
  wallet: SubmitApiWallet | null,
  request: Record<string, unknown>,
): Promise<SubmitApiSettingsResult> {
  const refusal = refusalFor(wallet, request);
  if (refusal !== null) return refusal;
  await clearSubmitApi(wallet.id);
  try {
    await chrome.storage.session.remove(submitApiLastResultKey(wallet.id));
  } catch {
    // Only the Settings status line reads it.
  }
  return { success: true };
}
