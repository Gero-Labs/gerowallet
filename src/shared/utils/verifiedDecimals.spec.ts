import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/plugins/i18n';
import {
  assertTokenDecimals,
  cip68Decimals,
  clearConfirmedDecimals,
  koiosDecimalsSource,
  publishedDecimals,
  TokenDecimalsError,
  type DecimalsSource,
} from '@/shared/utils/verifiedDecimals';

const MIN = '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6' + '4d494e';
const USDM = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad' + '0014df105553444d';
const BARE = 'ab'.repeat(28) + '4e4f4d455441';

/** A CIP-68 333 reference datum the way Koios's asset_info returns it (USDM's, trimmed). */
const usdmCip68 = {
  333: {
    fields: [
      {
        map: [
          { k: { bytes: '6e616d65' }, v: { bytes: '5553444d' } },
          { k: { bytes: '646563696d616c73' }, v: { int: 6 } },
        ],
      },
      { int: 1 },
    ],
    constructor: 0,
  },
};

describe('publishedDecimals', () => {
  it('reads the token registry, the CIP-68 datum, both, or neither (which means 0)', () => {
    expect([...publishedDecimals({ token_registry_metadata: { decimals: 6 }, cip68_metadata: null })]).toEqual([6]);
    expect([...publishedDecimals({ token_registry_metadata: null, cip68_metadata: usdmCip68 })]).toEqual([6]);
    expect([...publishedDecimals({ token_registry_metadata: { decimals: 2 }, cip68_metadata: usdmCip68 })].sort()).toEqual([2, 6]);
    expect([...publishedDecimals({ token_registry_metadata: null, cip68_metadata: null })]).toEqual([0]);
  });

  it('ignores a value that is not a small whole number', () => {
    expect([...publishedDecimals({ token_registry_metadata: { decimals: -1 } })]).toEqual([0]);
    expect([...publishedDecimals({ token_registry_metadata: { decimals: 1.5 } })]).toEqual([0]);
    expect(cip68Decimals({ 222: usdmCip68[333] })).toBeNull(); // an NFT's datum is not a fungible token's
  });
});

describe('koiosDecimalsSource', () => {
  it('asks asset_info for each policy and name, and keys the answer by unit', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { policy_id: MIN.slice(0, 56), asset_name: MIN.slice(56), token_registry_metadata: { decimals: 6 }, cip68_metadata: null },
      { policy_id: USDM.slice(0, 56), asset_name: USDM.slice(56), token_registry_metadata: { decimals: 6 }, cip68_metadata: usdmCip68 },
    ])));
    const answers = await koiosDecimalsSource('Mainnet', fetchImpl as unknown as typeof fetch)([MIN, USDM]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.koios.rest/api/v1/asset_info');
    expect(JSON.parse(String(init.body))).toEqual({ _asset_list: [[MIN.slice(0, 56), MIN.slice(56)], [USDM.slice(0, 56), USDM.slice(56)]] });
    expect([...(answers.get(MIN) ?? [])]).toEqual([6]);
    expect([...(answers.get(USDM) ?? [])]).toEqual([6]);
  });

  it('has no answers for a network Koios does not serve', async () => {
    const fetchImpl = vi.fn();
    expect((await koiosDecimalsSource('Sanchonet', fetchImpl as unknown as typeof fetch)([MIN])).size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('assertTokenDecimals', () => {
  const source = (answers: Record<string, number[]>): DecimalsSource & ReturnType<typeof vi.fn> =>
    vi.fn(async (units: string[]) => new Map(units.filter((u) => answers[u]).map((u) => [u, new Set(answers[u])]))) as never;

  beforeEach(() => clearConfirmedDecimals());

  it('passes the decimals the issuer published', async () => {
    await expect(assertTokenDecimals([{ unit: MIN, decimals: 6 }, { unit: BARE, decimals: 0 }], 'Mainnet',
      source({ [MIN]: [6], [BARE]: [0] }))).resolves.toBeUndefined();
  });

  it('refuses the decimals a tampered backend reports, either way', async () => {
    // 0 for a 6-decimal token: "10" would send 10 base units. 12: a million times what was meant.
    for (const decimals of [0, 12]) {
      clearConfirmedDecimals();
      const refused = await assertTokenDecimals([{ unit: MIN, decimals }], 'Mainnet', source({ [MIN]: [6] })).catch((e) => e);
      expect(refused).toBeInstanceOf(TokenDecimalsError);
      expect(refused).toMatchObject({ problem: 'mismatch', units: [MIN], message: String(i18n.t('txGuard.tokenDecimalsMismatch')) });
    }
  });

  it('refuses when the decimals cannot be checked: an unknown unit, or the source failing', async () => {
    await expect(assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Mainnet', source({})))
      .rejects.toMatchObject({ problem: 'unverified', units: [MIN] });
    const failing: DecimalsSource = async () => { throw new Error('Koios down'); };
    await expect(assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Mainnet', failing))
      .rejects.toMatchObject({ problem: 'unverified', message: String(i18n.t('txGuard.tokenDecimalsUnverified')) });
  });

  it('needs no check for ADA, and asks once per token while the answer is fresh', async () => {
    const answers = source({ [MIN]: [6] });
    await assertTokenDecimals([{ unit: 'lovelace', decimals: 6 }], 'Mainnet', answers);
    expect(answers).not.toHaveBeenCalled();

    let now = 1_000;
    await assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Mainnet', answers, () => now);
    await assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Mainnet', answers, () => now);
    expect(answers).toHaveBeenCalledTimes(1);
    now += 2 * 60 * 60 * 1000;
    await assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Mainnet', answers, () => now);
    expect(answers).toHaveBeenCalledTimes(2);
  });

  it('keeps networks apart', async () => {
    await assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Mainnet', source({ [MIN]: [6] }));
    await expect(assertTokenDecimals([{ unit: MIN, decimals: 6 }], 'Preprod', source({})))
      .rejects.toMatchObject({ problem: 'unverified' });
  });
});

describe('every flow that turns a typed token amount into base units', () => {
  // Each converts with decimals from Gero's backend, so each must confirm them
  // before it builds or sizes anything with the result.
  it.each([
    ['src/modules/dashboard/dialogs/SendDialog.vue', 'nexusTxApi.buildTransferTx('],
    ['src/sidepanel/components/flows/SendSheet.vue', 'nexusTxApi.buildTransferTx('],
    ['src/modules/swap/components/GeroSwapEmbed.vue', 'toBaseUnits(typed, decimals)'],
    ['src/shared/composables/useCip113Send.ts', 'method: MessageTypes.CIP113_PREPARE_TRANSFER'],
  ])('%s confirms the decimals first', (file, use) => {
    const source = readFileSync(join(__dirname, '../../..', file), 'utf8');
    const check = source.indexOf('assertTokenDecimals(');
    expect(check).toBeGreaterThan(-1);
    expect(source.indexOf(use)).toBeGreaterThan(check);
  });
});
