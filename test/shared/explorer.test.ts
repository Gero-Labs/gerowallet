import { describe, it, expect } from 'vitest';
import { Blockchain, Network } from '@/models/types';
import { getExplorerUrl } from '@/shared/utils/explorer';

describe('getExplorerUrl', () => {
  it('returns cexplorer mainnet tx URL for Cardano mainnet', () => {
    const url = getExplorerUrl(Blockchain.CARDANO, 'abc123', 'tx', Network.MAINNET);
    expect(url).toBe('https://cexplorer.io/tx/abc123');
  });

  it('returns cexplorer preprod tx URL for Cardano preprod', () => {
    const url = getExplorerUrl(Blockchain.CARDANO, 'abc123', 'tx', Network.PREPROD);
    expect(url).toBe('https://preprod.cexplorer.io/tx/abc123');
  });

  it('returns cexplorer block URL for Cardano mainnet', () => {
    const url = getExplorerUrl(Blockchain.CARDANO, 'block123', 'block', Network.MAINNET);
    expect(url).toBe('https://cexplorer.io/block/block123');
  });

  it('returns apexscan tx URL for Apex Prime', () => {
    const url = getExplorerUrl(Blockchain.APEX_PRIME, 'tx456', 'tx', Network.MAINNET);
    expect(url).toBe('https://apexscan.org/en/transaction/tx456/summary/');
  });

  it('returns apexscan block URL for Apex Prime', () => {
    const url = getExplorerUrl(Blockchain.APEX_PRIME, 'blk456', 'block', Network.MAINNET);
    expect(url).toBe('https://apexscan.org/en/block/blk456');
  });

  it('returns apexscan tx URL for Apex Vector (uses same explorer)', () => {
    const url = getExplorerUrl(Blockchain.APEX_VECTOR, 'tx789', 'tx', Network.TESTNET);
    expect(url).toBe('https://apexscan.org/en/transaction/tx789/summary/');
  });

  it('returns mempool.space tx URL for Bitcoin', () => {
    const url = getExplorerUrl(Blockchain.BITCOIN, 'btx123', 'tx', Network.MAINNET);
    expect(url).toBe('https://mempool.space/tx/btx123');
  });

  it('returns empty string for unknown chain', () => {
    const url = getExplorerUrl('UnknownChain', 'x', 'tx', Network.MAINNET);
    expect(url).toBe('');
  });

  it('defaults to mainnet when network is undefined', () => {
    const url = getExplorerUrl(Blockchain.CARDANO, 'abc', 'tx');
    expect(url).toBe('https://cexplorer.io/tx/abc');
  });
});
