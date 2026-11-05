import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Api client is gero-backend's, with the response-signature check installed. Here only its
// asset-info call is answered; the rest of the module is real.
const { getAssetsInfo, constructed } = vi.hoisted(() => ({ getAssetsInfo: vi.fn(), constructed: [] as unknown[][] }));
vi.mock('@/api/api', () => ({
  Api: class {
    constructor(...args: unknown[]) { constructed.push(args); }
    getAssetsInfo(units: string[]) { return getAssetsInfo(units); }
  },
}));

import i18n from '@/plugins/i18n';
import { Provider } from '@/models/types';
import {
  cip68Decimals,
  clearConfirmedDecimals,
  confirmTokenDecimals,
  decimalsFromAssetInfo,
  geroBackendDecimalsSource,
  TokenDecimalsError,
} from '@/shared/utils/verifiedDecimals';

const MIN = '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6' + '4d494e';
const USDM = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad' + '0014df105553444d';
const BARE = 'ab'.repeat(28) + '4e4f4d455441';
const MAINNET = { chain: 'Cardano', network: 'Mainnet' };

/** A CIP-68 333 reference datum as gero-backend's asset row carries it (USDM's, trimmed). */
const usdmDatum = {
  constructor: 0,
  fields: [
    { map: [{ k: { bytes: '6e616d65' }, v: { bytes: '5553444d' } }, { k: { bytes: '646563696d616c73' }, v: { int: 6 } }] },
    { int: 1 },
  ],
};
const usdmExtra = JSON.stringify({ 333: usdmDatum });

/** gero-backend's rows (cardano-client-lib `Asset`, snake_case), as `POST /api/assets/info` answers. */
const rows: Record<string, Record<string, unknown>> = {
  [MIN]: { asset: MIN, policy_id: MIN.slice(0, 56), asset_name: MIN.slice(56), metadata: { name: 'Minswap', ticker: 'MIN', decimals: 6 } },
  [USDM]: { asset: USDM, policy_id: USDM.slice(0, 56), asset_name: USDM.slice(56), metadata: null, onchain_metadata_extra: usdmExtra },
  [BARE]: { asset: BARE, policy_id: BARE.slice(0, 56), asset_name: BARE.slice(56), metadata: null },
};
/** The backend answering for the units it knows, as the endpoint does: unknown units have no row. */
function backendKnows(known: Record<string, Record<string, unknown>> = rows) {
  getAssetsInfo.mockImplementation(async (units: string[]) => ({ status: 200, data: units.filter((u) => known[u]).map((u) => known[u]) }));
}

beforeEach(() => {
  clearConfirmedDecimals();
  getAssetsInfo.mockReset();
  constructed.length = 0;
  backendKnows();
});

describe('decimalsFromAssetInfo', () => {
  it('reads the registry entry, the CIP-68 datum, or neither (which the backend model means as 0)', () => {
    expect(decimalsFromAssetInfo(MIN, rows[MIN])).toBe(6);
    expect(decimalsFromAssetInfo(USDM, rows[USDM])).toBe(6);
    expect(decimalsFromAssetInfo(BARE, rows[BARE])).toBe(0);
    // A registry entry without decimals, explicitly null or left out.
    expect(decimalsFromAssetInfo(BARE, { asset: BARE, metadata: { name: 'x', decimals: null } })).toBe(0);
    expect(decimalsFromAssetInfo(BARE, { asset: BARE, metadata: { name: 'x' } })).toBe(0);
    // A datum that is already parsed reads the same; a datum's decimals win over the registry's.
    expect(decimalsFromAssetInfo(USDM, { asset: USDM, metadata: { decimals: 2 }, onchain_metadata_extra: { 333: usdmDatum } })).toBe(6);
  });

  it('falls back to the registry entry when a datum states no decimals, as the wallet\'s own mapping does', () => {
    const noDecimals = JSON.stringify({ 333: { constructor: 0, fields: [{ map: [{ k: { bytes: '6e616d65' }, v: { bytes: '5553444d' } }] }, { int: 1 }] } });
    expect(decimalsFromAssetInfo(USDM, { asset: USDM, metadata: { decimals: 6 }, onchain_metadata_extra: noDecimals })).toBe(6);
    expect(decimalsFromAssetInfo(USDM, { asset: USDM, metadata: null, onchain_metadata_extra: noDecimals })).toBe(0);
    expect(decimalsFromAssetInfo(USDM, { asset: USDM, metadata: null, onchain_metadata_extra: 'null' })).toBe(0);
  });

  it('states nothing for a missing row or a value that is not a small whole number', () => {
    expect(decimalsFromAssetInfo(MIN, undefined)).toBeNull();
    expect(decimalsFromAssetInfo(MIN, { asset: MIN, metadata: { decimals: -1 } })).toBeNull();
    expect(decimalsFromAssetInfo(MIN, { asset: MIN, metadata: { decimals: 1.5 } })).toBeNull();
    expect(decimalsFromAssetInfo(MIN, { asset: MIN, metadata: 'six' })).toBeNull();
    expect(decimalsFromAssetInfo(MIN, { asset: MIN, metadata: { decimals: '6' } })).toBe(6);
  });

  it('reads a datum only for a CIP-68 fungible token', () => {
    const nftUnit = USDM.slice(0, 56) + '000de140' + '5553444d'; // label 222: an NFT
    expect(cip68Decimals(nftUnit, { 222: usdmDatum })).toBeNull();
    expect(cip68Decimals(MIN, usdmExtra)).toBeNull();
    expect(cip68Decimals(USDM, '{not json')).toBeNull();
    expect(cip68Decimals(USDM.slice(0, 56) + '001bc280' + '5553444d', { 444: usdmDatum })).toBe(6);
  });
});

describe('geroBackendDecimalsSource', () => {
  it('asks gero-backend\'s asset info for the wallet\'s chain and network, and keys the answer by unit', async () => {
    const answers = await geroBackendDecimalsSource(MAINNET)([MIN, USDM, BARE]);
    expect(constructed).toEqual([[MAINNET, Provider.KOIOS]]);
    expect(getAssetsInfo).toHaveBeenCalledWith([MIN, USDM, BARE]);
    expect([...answers]).toEqual([[MIN, 6], [USDM, 6], [BARE, 0]]);
  });

  it('reads only rows for units it asked about, and none that contradict each other', async () => {
    getAssetsInfo.mockResolvedValue({ status: 200, data: [
      rows[MIN], { ...rows[MIN], metadata: { decimals: 12 } },
      rows[BARE], rows[BARE],
      { asset: 'ff'.repeat(28), metadata: { decimals: 6 } },
    ] });
    const answers = await geroBackendDecimalsSource(MAINNET)([MIN, BARE]);
    expect([...answers]).toEqual([[BARE, 0]]);
  });

  it('throws when the backend does not answer with a list', async () => {
    getAssetsInfo.mockResolvedValue({ status: 204, data: '' });
    await expect(geroBackendDecimalsSource(MAINNET)([MIN])).rejects.toThrow('204');
  });
});

describe('confirmTokenDecimals', () => {
  it('passes, and returns, the decimals gero-backend confirms', async () => {
    const confirmed = await confirmTokenDecimals([{ unit: MIN, decimals: 6 }, { unit: USDM, decimals: 6n }, { unit: BARE, decimals: 0 }], MAINNET);
    expect([...confirmed]).toEqual([[MIN, 6], [USDM, 6], [BARE, 0]]);
    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
  });

  it('refuses decimals gero-backend does not state, either way', async () => {
    // 0 for a 6-decimal token: "10" would send 10 base units. 12: a million times what was meant.
    for (const decimals of [0, 12, '12']) {
      clearConfirmedDecimals();
      const refused = await confirmTokenDecimals([{ unit: MIN, decimals }], MAINNET).catch((e) => e);
      expect(refused).toBeInstanceOf(TokenDecimalsError);
      expect(refused).toMatchObject({ problem: 'mismatch', units: [MIN], message: String(i18n.t('txGuard.tokenDecimalsMismatch')) });
    }
    // A token with no decimals: claiming some is the larger, dangerous direction.
    await expect(confirmTokenDecimals([{ unit: BARE, decimals: 6 }], MAINNET)).rejects.toMatchObject({ problem: 'mismatch' });
  });

  it('refuses a token used with two different decimals in one flow', async () => {
    await expect(confirmTokenDecimals([{ unit: MIN, decimals: 6 }, { unit: MIN, decimals: 12 }], MAINNET))
      .rejects.toMatchObject({ problem: 'mismatch', units: [MIN] });
  });

  it('refuses when the decimals cannot be confirmed: no row, the backend failing or timing out, a malformed unit', async () => {
    backendKnows({});
    await expect(confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET))
      .rejects.toMatchObject({ problem: 'unverified', units: [MIN], message: String(i18n.t('txGuard.tokenDecimalsUnverified')) });

    getAssetsInfo.mockRejectedValue(new Error('Network Error'));
    await expect(confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET)).rejects.toMatchObject({ problem: 'unverified' });

    vi.useFakeTimers();
    try {
      getAssetsInfo.mockReturnValue(new Promise(() => {}));
      const pending = confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET).catch((e) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toMatchObject({ problem: 'unverified' });
    } finally {
      vi.useRealTimers();
    }

    getAssetsInfo.mockClear();
    await expect(confirmTokenDecimals([{ unit: 'not-a-unit', decimals: 0 }], MAINNET)).rejects.toMatchObject({ problem: 'unverified' });
    expect(getAssetsInfo).not.toHaveBeenCalled();
  });

  it('needs no lookup for ADA, whose decimals are the protocol\'s', async () => {
    expect([...await confirmTokenDecimals([{ unit: 'lovelace', decimals: 6 }], MAINNET)]).toEqual([['lovelace', 6]]);
    expect(getAssetsInfo).not.toHaveBeenCalled();
    await expect(confirmTokenDecimals([{ unit: 'lovelace', decimals: 0 }], MAINNET)).rejects.toMatchObject({ problem: 'mismatch' });
  });

  it('asks once per token while the answer is an hour old at most', async () => {
    let now = 1_000;
    await confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET, undefined, () => now);
    await confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET, undefined, () => now);
    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
    // A failing backend is not asked while the kept answer agrees.
    getAssetsInfo.mockRejectedValue(new Error('down'));
    now += 59 * 60 * 1000;
    await confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET, undefined, () => now);
    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
    now += 2 * 60 * 1000;
    await expect(confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET, undefined, () => now)).rejects.toMatchObject({ problem: 'unverified' });
    expect(getAssetsInfo).toHaveBeenCalledTimes(2);
  });

  it('asks again before refusing on a kept answer, and still refuses when the answer stands', async () => {
    // A degraded answer (no registry entry) was kept as 0 ...
    backendKnows({ [MIN]: { asset: MIN, metadata: null } });
    await confirmTokenDecimals([{ unit: MIN, decimals: 0 }], MAINNET);
    // ... and does not block the send once the backend answers fully again.
    backendKnows();
    expect([...await confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET)]).toEqual([[MIN, 6]]);
    expect(getAssetsInfo).toHaveBeenCalledTimes(2);
    await expect(confirmTokenDecimals([{ unit: MIN, decimals: 12 }], MAINNET)).rejects.toMatchObject({ problem: 'mismatch' });
    expect(getAssetsInfo).toHaveBeenCalledTimes(3);
  });

  it('keeps chains and networks apart', async () => {
    await confirmTokenDecimals([{ unit: MIN, decimals: 6 }], MAINNET);
    backendKnows({});
    await expect(confirmTokenDecimals([{ unit: MIN, decimals: 6 }], { chain: 'Cardano', network: 'Preprod' }))
      .rejects.toMatchObject({ problem: 'unverified' });
  });
});

describe('every flow that turns a typed token amount into base units', () => {
  // Each converts with decimals from gero-sync or the swap catalogue, so each must have
  // them confirmed before it builds or sizes anything with the result.
  it.each([
    ['src/modules/dashboard/dialogs/SendDialog.vue', 'async function buildTx(', 'await confirmedRecipientDecimals()', 'nexusTxApi.buildTransferTx('],
    ['src/modules/dashboard/dialogs/SendDialog.vue', 'const tryBuild = async', 'await confirmedRecipientDecimals()', 'nexusTxApi.buildTransferTx('],
    ['src/sidepanel/components/flows/SendSheet.vue', 'async function buildTransaction()', 'confirmTokenDecimals(', 'decimalToBaseUnits(token.sendAmount'],
    ['src/modules/swap/components/GeroSwapEmbed.vue', 'async function currentSwapIntent()', 'confirmTokenDecimals(', 'toBaseUnits(typed, confirmed)'],
    ['src/shared/composables/useCip113Send.ts', 'async function prepare(', 'await confirmTokenDecimals(', 'MessageTypes.CIP113_PREPARE_TRANSFER'],
  ])('%s: %s confirms the decimals first', (file, start, check, use) => {
    const source = readFileSync(join(__dirname, '../../..', file), 'utf8');
    const from = source.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const checkAt = source.indexOf(check, from);
    expect(checkAt).toBeGreaterThan(from);
    expect(source.indexOf(use, from)).toBeGreaterThan(checkAt);
  });
});
