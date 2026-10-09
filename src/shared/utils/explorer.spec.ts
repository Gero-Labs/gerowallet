import { describe, expect, it } from 'vitest';
import { Blockchain, Network } from '@/models/types';
import { explorersFor, getExplorerUrl, resolveExplorerId } from '@/shared/utils/explorer';

const TX = '7ecfdae7a4a2b8ea1bd2b4cb6b3d1b4ec5e9e5e3c5f4b0c7f6c3e9d2a1b0c9d8';
const POOL_HEX = '0f292fcaa02b8b2f9b3c8f9fd8e0bb21abedb692a6d5058df3ef2735';
const POOL_BECH32 = 'pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy';
// CIP-129's own example: tx 15f82a36…c916, index 0.
const GOV_CIP129 = 'gov_action1zhuz5djmmmjg8f9s8pe6grfc98xg3szglums8cgm6qwancp4eytqqmpu0pr';
const GOV_TX = '15f82a365bdee483a4b03873a40d3829cc88c048ff3703e11bd01dd9e035c916';

const cardano = (type: Parameters<typeof getExplorerUrl>[2], id: string, explorer?: string, network?: string) =>
  getExplorerUrl(Blockchain.CARDANO, id, type, network ?? Network.MAINNET, explorer);

describe('getExplorerUrl: Cardano default (no saved choice)', () => {
  it('keeps the links it produced before the setting existed', () => {
    expect(cardano('tx', TX)).toBe(`https://cexplorer.io/tx/${TX}`);
    expect(cardano('block', TX)).toBe(`https://cexplorer.io/block/${TX}`);
    expect(cardano('tx', TX, undefined, Network.PREPROD)).toBe(`https://preprod.cexplorer.io/tx/${TX}`);
    expect(cardano('tx', TX, undefined, Network.PREVIEW)).toBe(`https://preview.cexplorer.io/tx/${TX}`);
  });

  it('treats an unknown or missing network as mainnet, as before', () => {
    expect(getExplorerUrl(Blockchain.CARDANO, TX, 'tx')).toBe(`https://cexplorer.io/tx/${TX}`);
    expect(cardano('tx', TX, undefined, Network.TESTNET)).toBe(`https://cexplorer.io/tx/${TX}`);
    expect(cardano('tx', TX, undefined, Network.STAGENET)).toBe(`https://cexplorer.io/tx/${TX}`);
  });

  it('returns nothing for an empty id', () => {
    expect(cardano('tx', '')).toBe('');
  });
});

describe('getExplorerUrl: chosen Cardano explorer', () => {
  it('builds Cardanoscan links', () => {
    expect(cardano('tx', TX, 'cardanoscan')).toBe(`https://cardanoscan.io/transaction/${TX}`);
    expect(cardano('stake', 'stake1uxyz', 'cardanoscan')).toBe('https://cardanoscan.io/stakeKey/stake1uxyz');
    expect(cardano('asset', 'asset1abc', 'cardanoscan')).toBe('https://cardanoscan.io/token/asset1abc');
    expect(cardano('policy', 'ab12', 'cardanoscan')).toBe('https://cardanoscan.io/tokenPolicy/ab12');
    expect(cardano('tx', TX, 'cardanoscan', Network.PREVIEW)).toBe(`https://preview.cardanoscan.io/transaction/${TX}`);
  });

  it('builds AdaStat links', () => {
    expect(cardano('tx', TX, 'adastat')).toBe(`https://adastat.net/transactions/${TX}`);
    expect(cardano('address', 'addr1q9', 'adastat')).toBe('https://adastat.net/addresses/addr1q9');
    expect(cardano('stake', 'stake1uxyz', 'adastat')).toBe('https://adastat.net/accounts/stake1uxyz');
    expect(cardano('pool', POOL_BECH32, 'adastat')).toBe(`https://adastat.net/pools/${POOL_BECH32}`);
    expect(cardano('drep', 'drep1xyz', 'adastat')).toBe('https://adastat.net/dreps/drep1xyz');
    expect(cardano('epoch', '660', 'adastat', Network.PREPROD)).toBe('https://preprod.adastat.net/epochs/660');
  });

  it('builds pool.pm links and converts a hex pool id, which pool.pm rejects', () => {
    expect(cardano('address', 'addr1q9', 'poolpm')).toBe('https://pool.pm/addr1q9');
    expect(cardano('pool', POOL_HEX, 'poolpm')).toBe(`https://pool.pm/${POOL_BECH32}`);
    expect(cardano('policy', 'ab12', 'poolpm')).toBe('https://pool.pm/policy/ab12');
  });

  it('falls back to Cexplorer for an entity the chosen explorer has no page for', () => {
    expect(cardano('tx', TX, 'poolpm')).toBe(`https://cexplorer.io/tx/${TX}`);
    expect(cardano('drep', 'drep1xyz', 'poolpm', Network.PREPROD)).toBe('https://preprod.cexplorer.io/drep/drep1xyz');
    // pool.pm needs the fingerprint; a policy+name unit is not one.
    expect(cardano('asset', 'ab12cd', 'poolpm')).toBe('https://cexplorer.io/asset/ab12cd');
  });

  it('ignores an unknown saved explorer', () => {
    expect(cardano('tx', TX, 'etherscan')).toBe(`https://cexplorer.io/tx/${TX}`);
  });

  it('percent-encodes ids into a single path segment', () => {
    expect(cardano('address', '../evil?x=1', 'cardanoscan')).toBe('https://cardanoscan.io/address/..%2Fevil%3Fx%3D1');
  });
});

describe('getExplorerUrl: governance actions', () => {
  it('uses each explorer\'s own id form, from either input form', () => {
    for (const input of [`${GOV_TX}#0`, GOV_CIP129]) {
      expect(cardano('govAction', input)).toBe(`https://cexplorer.io/gov/action/${GOV_TX}%230`);
      expect(cardano('govAction', input, 'cardanoscan')).toBe(`https://cardanoscan.io/govAction/${GOV_TX}00`);
      expect(cardano('govAction', input, 'adastat')).toBe(`https://adastat.net/governances/${GOV_TX}00`);
    }
  });

  it('writes the index as one hex byte', () => {
    expect(cardano('govAction', `${GOV_TX}#17`, 'adastat')).toBe(`https://adastat.net/governances/${GOV_TX}11`);
  });

  it('falls back to Cexplorer when the index does not fit the one-byte form', () => {
    expect(cardano('govAction', `${GOV_TX}#300`, 'adastat')).toBe(`https://cexplorer.io/gov/action/${GOV_TX}%23300`);
  });

  it('returns nothing for an unparseable id', () => {
    expect(cardano('govAction', 'not-an-action', 'cardanoscan')).toBe('');
  });
});

describe('getExplorerUrl: other chains', () => {
  it('sends Apex Prime and Vector to their own apexscan hosts', () => {
    expect(getExplorerUrl(Blockchain.APEX_PRIME, TX, 'tx')).toBe(`https://apexscan.org/en/transaction/${TX}`);
    expect(getExplorerUrl(Blockchain.APEX_VECTOR, TX, 'tx')).toBe(`https://vector.apexscan.org/en/transaction/${TX}`);
    expect(getExplorerUrl(Blockchain.APEX_VECTOR, TX, 'block')).toBe(`https://vector.apexscan.org/en/block/${TX}`);
    expect(getExplorerUrl(Blockchain.APEX_PRIME, POOL_HEX, 'pool')).toBe(`https://apexscan.org/en/pool/${POOL_BECH32}`);
  });

  it('ignores a Cardano explorer choice on Apex', () => {
    expect(getExplorerUrl(Blockchain.APEX_PRIME, TX, 'tx', Network.MAINNET, 'cardanoscan'))
      .toBe(`https://apexscan.org/en/transaction/${TX}`);
  });

  it('returns nothing for an entity apexscan has no page for', () => {
    expect(getExplorerUrl(Blockchain.APEX_PRIME, 'drep1xyz', 'drep')).toBe('');
  });

  it('keeps Bitcoin on mempool.space', () => {
    expect(getExplorerUrl(Blockchain.BITCOIN, TX, 'tx')).toBe(`https://mempool.space/tx/${TX}`);
    expect(getExplorerUrl(Blockchain.BITCOIN, TX, 'block')).toBe(`https://mempool.space/block/${TX}`);
    expect(getExplorerUrl(Blockchain.BITCOIN, 'bc1q', 'address')).toBe('');
  });

  it('returns nothing for Midnight', () => {
    expect(getExplorerUrl(Blockchain.MIDNIGHT, TX, 'tx')).toBe('');
  });
});

describe('explorersFor / resolveExplorerId', () => {
  it('offers four explorers on every Cardano network and marks pool.pm partial', () => {
    for (const network of [Network.MAINNET, Network.PREPROD, Network.PREVIEW]) {
      const options = explorersFor(Blockchain.CARDANO, network);
      expect(options.map(o => o.id)).toEqual(['cexplorer', 'cardanoscan', 'adastat', 'poolpm']);
      expect(options.filter(o => o.partial).map(o => o.id)).toEqual(['poolpm']);
    }
  });

  it('offers no choice on chains with one explorer or none', () => {
    expect(explorersFor(Blockchain.APEX_PRIME, Network.MAINNET)).toEqual([]);
    expect(explorersFor(Blockchain.APEX_VECTOR, Network.MAINNET)).toEqual([]);
    expect(explorersFor(Blockchain.BITCOIN, Network.MAINNET)).toEqual([]);
    expect(explorersFor(Blockchain.MIDNIGHT, Network.MAINNET)).toEqual([]);
  });

  it('keeps a valid saved choice and defaults anything else', () => {
    expect(resolveExplorerId(Blockchain.CARDANO, Network.PREPROD, 'adastat')).toBe('adastat');
    expect(resolveExplorerId(Blockchain.CARDANO, Network.MAINNET, undefined)).toBe('cexplorer');
    expect(resolveExplorerId(Blockchain.CARDANO, Network.MAINNET, 'toString')).toBe('cexplorer');
    expect(resolveExplorerId(Blockchain.CARDANO, Network.MAINNET, 42)).toBe('cexplorer');
  });
});
