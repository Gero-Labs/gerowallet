import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  createNexusReadClient,
  resolveRealFiReadClient,
  toOrders,
  toPosition,
  toProtocol,
} from './realfiClient';
import { isRealFiAsset, REALFI_ASSETS, usdrAssetIdFor } from '../assets';

/** A fake axios that records every GET and answers from a table keyed by view. */
function fakeHttp(answers: Record<string, unknown> = {}) {
  const get = vi.fn(async (url: string, _config?: { params?: Record<string, unknown> }) => {
    const view = url.replace('/api/realfi/', '');
    return { data: answers[view] ?? null };
  });
  return { http: { get } as unknown as AxiosInstance, get };
}

describe('RealFi read client', () => {
  describe('network routing', () => {
    it('sends the Nexus network slug, not the wallet enum', async () => {
      const { http, get } = fakeHttp();
      const resolved = await resolveRealFiReadClient('Mainnet', http);
      if (resolved.status !== 'ok') throw new Error('expected a client');

      await resolved.client.getPosition('addr1xyz');

      expect(get).toHaveBeenCalledWith('/api/realfi/position', {
        params: { network: 'cardano-mainnet', address: 'addr1xyz' },
      });
    });

    it('reports unsupported-network for a chain RealFi is not on', async () => {
      const resolved = await resolveRealFiReadClient('Bitcoin');
      expect(resolved).toEqual({ status: 'unavailable', reason: 'unsupported-network' });
    });
  });

  describe('referral codes', () => {
    // Reading a code on RealFi CREATES one. The flag must never reach the wire
    // unless the user explicitly asked, not even as `issueCode=false`.
    it('never sends issueCode on the default read', async () => {
      const { http, get } = fakeHttp();
      await createNexusReadClient(http, 'cardano-mainnet').getReferrals('addr1xyz');

      const params = get.mock.calls[0]?.[1]?.params ?? {};
      expect(params).not.toHaveProperty('issueCode');
    });

    it('sends issueCode=true only when asked', async () => {
      const { http, get } = fakeHttp();
      await createNexusReadClient(http, 'cardano-mainnet').getReferrals('addr1xyz', true);

      const params = get.mock.calls[0]?.[1]?.params ?? {};
      expect(params['issueCode']).toBe(true);
    });
  });

  describe('mapping Nexus responses', () => {
    it('maps a position, keeping amounts as strings', () => {
      expect(
        toPosition({
          totalSUSDr: '12106421500',
          totalUSDrValue: '12500000000',
          principal: '12000000000',
          earned: '500000000',
          yieldPercent: 4.16,
        }),
      ).toEqual({
        totalSUSDr: '12106421500',
        totalUSDrValue: '12500000000',
        principal: '12000000000',
        earned: '500000000',
        yieldPercent: 4.16,
      });
    });

    it('never renders garbage as a balance', () => {
      const p = toPosition({ totalSUSDr: '[object Object]', principal: null });
      expect(p?.totalSUSDr).toBe('0');
      expect(p?.principal).toBe('0');
    });

    it('keeps every order, including the statuses added in SDK 2.18 and 3.1', () => {
      const orders = toOrders([
        { txHash: 'aa', outputIndex: 0, action: 'Stake', status: 'HeldForScreening' },
        { txHash: 'bb', outputIndex: 1, action: 'Unstake', status: 'Failed' },
        { txHash: 'cc', outputIndex: 0, action: 'DirectMint', status: 'InvalidatedBlockedScreening' },
      ]);
      expect(orders.map((o) => o.status)).toEqual([
        'HeldForScreening',
        'Failed',
        'InvalidatedBlockedScreening',
      ]);
      expect(orders[2]?.action).toBe('DirectMint');
    });

    it('keeps order amounts and the released USDr as exact strings, dropping junk', () => {
      const [unstake, junk] = toOrders([
        { txHash: 'aa', outputIndex: 0, action: 'Unstake', status: 'Executed', amount: '5000000000', resultAmount: '5168241487' },
        { txHash: 'bb', outputIndex: 0, action: 'Stake', status: 'Open', amount: '1e9', resultAmount: -5 },
      ]);

      expect(unstake).toMatchObject({ amount: '5000000000', resultAmount: '5168241487' });
      expect(junk!.amount).toBeUndefined();
      expect(junk!.resultAmount).toBeUndefined();
    });

    it('shows an unknown status as still working rather than dropping the order', () => {
      const [order] = toOrders([{ txHash: 'aa', outputIndex: 0, action: 'Stake', status: 'Brand-new' }]);
      expect(order?.status).toBe('Validating');
    });

    it('drops the APY date and rate together, never one without the other', () => {
      expect(toProtocol({ apyPercent: null, apyAsOf: '2026-05-08' })).toMatchObject({
        apyPercent: null,
        apyAsOf: null,
      });
      expect(toProtocol({ apyPercent: 14, apyAsOf: '2026-05-08' })).toMatchObject({
        apyPercent: 14,
        apyAsOf: '2026-05-08',
      });
    });
  });
});

describe('isRealFiAsset', () => {
  it('recognises USDrf and sUSDrf on mainnet and preprod', () => {
    for (const net of Object.values(REALFI_ASSETS)) {
      expect(isRealFiAsset(net.usdr)).toBe(true);
      expect(isRealFiAsset(net.susdr)).toBe(true);
    }
  });

  it('does not vouch for anything else', () => {
    expect(isRealFiAsset('lovelace')).toBe(false);
    expect(isRealFiAsset('')).toBe(false);
    expect(isRealFiAsset(undefined)).toBe(false);
    // Same policy, different asset name: not ours to verify.
    expect(isRealFiAsset('7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae414141')).toBe(false);
  });
});

describe('usdrAssetIdFor', () => {
  it('knows USDrf per network, so a failed protocol read cannot hide a holding', () => {
    expect(usdrAssetIdFor('Mainnet')).toBe(REALFI_ASSETS.mainnet.usdr);
    expect(usdrAssetIdFor('Preprod')).toBe(REALFI_ASSETS.preprod.usdr);
    expect(usdrAssetIdFor('Preview')).toBeNull();
    expect(usdrAssetIdFor(undefined)).toBeNull();
  });
});

describe('toProtocol yield and rate', () => {
  const BASE = {
    stablecoinAssetId: 'ab',
    circulatingSusdr: '57996439368652',
    vaultUsdr: '59947920817694',
    pendingYield: '0',
    diffusionStartUnixMilli: '0',
    diffusionEndUnixMilli: '0',
  };

  it('keeps the yield history and average, dropping days that would draw a false point', () => {
    const p = toProtocol({
      ...BASE,
      apyAvg90Percent: 8.32,
      apyHistory: [
        { date: '2026-09-24', apyPercent: 8.2 },
        { date: '2026-09-25', apyPercent: 0 },
        { date: null, apyPercent: 8.4 },
        { date: '2026-09-26', apyPercent: '8.5' },
      ],
    });

    expect(p!.apyAvg90Percent).toBe(8.32);
    expect(p!.apyHistory).toEqual([
      { date: '2026-09-24', apyPercent: 8.2 },
      { date: '2026-09-26', apyPercent: 8.5 },
    ]);
  });

  it('carries the five rate inputs, or none: a partial set gives a wrong rate', () => {
    expect(toProtocol(BASE)!.rateInputs).toEqual({
      vaultUsdr: '59947920817694',
      circulatingSusdr: '57996439368652',
      pendingYield: '0',
      diffusionStart: '0',
      diffusionEnd: '0',
    });
    expect(toProtocol({ ...BASE, vaultUsdr: null })!.rateInputs).toBeNull();
  });

  it('has an empty history when Nexus sends none', () => {
    expect(toProtocol({ stablecoinAssetId: 'ab' })!.apyHistory).toEqual([]);
  });
});

