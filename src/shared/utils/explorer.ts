import { Blockchain, Network } from '@/models/types';

export type ExplorerHashType = 'tx' | 'block';

export function getExplorerUrl(
  chain: string,
  hash: string,
  type: ExplorerHashType,
  network: string = Network.MAINNET,
): string {
  switch (chain) {
    case Blockchain.CARDANO: {
      const prefix = network === Network.PREPROD ? 'preprod.' : network === Network.PREVIEW ? 'preview.' : '';
      const segment = type === 'tx' ? 'tx' : 'block';
      return `https://${prefix}cexplorer.io/${segment}/${hash}`;
    }
    case Blockchain.APEX_PRIME:
    case Blockchain.APEX_VECTOR:
      return type === 'tx'
        ? `https://apexscan.org/en/transaction/${hash}/summary/`
        : `https://apexscan.org/en/block/${hash}`;
    case Blockchain.BITCOIN:
      return type === 'tx'
        ? `https://mempool.space/tx/${hash}`
        : `https://mempool.space/block/${hash}`;
    default:
      return '';
  }
}
