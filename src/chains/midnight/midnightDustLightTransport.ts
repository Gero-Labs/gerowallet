import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { CollapsedDustTree, DustLightTransport, DustSnapshot, DustSpendTransaction } from './midnightDustLightSync';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { withMidnightAbort } from './midnightAbort';

export function createDustLightTransport(endpoints: MidnightNetworkEndpoints, signal: AbortSignal): DustLightTransport {
  const url = `${endpoints.nexusBaseUrl}/api/midnight/midnight-${endpoints.sdkNetworkId}/dust/light-sync`;
  async function request<T>(body: object): Promise<T> {
    const attempt = async (token: string) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal,
    });
    let response = await attempt(await withMidnightAbort(getNexusAccessToken(), signal));
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      response = await attempt(await withMidnightAbort(reauthenticateNexus(), signal));
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('DUST synchronization is temporarily unavailable. Please try again shortly.');
    }
    return response.json();
  }
  return {
    snapshot: address => request<DustSnapshot>({ operation: 'snapshot', dustAddress: address }),
    spends: async (block, prefixes, fromBlock, toBlock) => {
      const result = await request<{ blockHash: string; transactions: DustSpendTransaction[]; nextBlock: number | null }>({ operation: 'spends', blockHash: block.hash, prefixes, fromBlock, toBlock });
      if (result.blockHash !== block.hash || !Array.isArray(result.transactions)) throw new Error('DUST spend snapshot mismatch');
      return { transactions: result.transactions, nextBlock: result.nextBlock };
    },
    commitments: async (block, ranges) => {
      const result = await request<{ blockHash: string; updates: CollapsedDustTree[] }>({ operation: 'commitments', blockHash: block.hash, ranges });
      if (result.blockHash !== block.hash || !Array.isArray(result.updates)) throw new Error('DUST tree snapshot mismatch');
      return result.updates;
    },
  };
}
