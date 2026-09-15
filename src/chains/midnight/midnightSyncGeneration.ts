export interface MidnightSyncIdentity {
  network: string;
  generation: number;
  genesisHash: string;
}

export function parseMidnightSyncIdentity(data: Record<string, unknown>, network: string): MidnightSyncIdentity | null {
  if (!/^midnight-(mainnet|preprod|stagenet)$/.test(network)
    || data['midnight_network'] !== network
    || !Number.isSafeInteger(data['midnight_chain_generation'])
    || (data['midnight_chain_generation'] as number) < 1
    || typeof data['midnight_genesis_hash'] !== 'string'
    || !/^0x[0-9a-fA-F]{64}$/.test(data['midnight_genesis_hash'])) return null;
  return { network, generation: data['midnight_chain_generation'] as number,
    genesisHash: data['midnight_genesis_hash'].toLowerCase() };
}

/** Serializes reset and replay so an asynchronous reset cannot erase a newer event. */
export class MidnightGenerationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(
    data: Record<string, unknown>,
    network: string,
    current: () => MidnightSyncIdentity | null,
    isActive: () => boolean,
    reset: (identity: MidnightSyncIdentity) => Promise<void>,
    apply: () => Promise<void>,
  ): Promise<void> {
    const identity = parseMidnightSyncIdentity(data, network);
    const next = this.tail.then(async () => {
      if (!identity || !isActive()) return;
      const previous = current();
      if (previous?.network === network) {
        if (identity.generation < previous.generation) return;
        if (identity.generation === previous.generation && identity.genesisHash !== previous.genesisHash) return;
      }
      if (!previous || previous.network !== network || previous.generation !== identity.generation) {
        await reset(identity);
      }
      if (isActive()) await apply();
    });
    this.tail = next.catch(() => {});
    return next;
  }
}

/** Clear only this Midnight network's SDK caches, including historical SDK namespaces. */
export async function clearMidnightNetworkCheckpoints(network: string): Promise<void> {
  if (!/^midnight-(mainnet|preprod|stagenet)$/.test(network)) throw new Error('Invalid Midnight reset network');
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const sdkNetwork = network.slice('midnight-'.length);
  const prefixes = [`midnight_wallet_state_${sdkNetwork}_`, `midnight_wallet_state_${sdkNetwork}-ledger9-`,
    `midnight_wallet_state_${network}-ledger9-`];
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.get(null, (all) => {
      if (chrome.runtime?.lastError) { reject(new Error('Cannot read Midnight checkpoints')); return; }
      const keys = Object.keys(all ?? {}).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
      if (!keys.length) { resolve(); return; }
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime?.lastError) reject(new Error('Cannot clear Midnight checkpoints'));
        else resolve();
      });
    });
  });
}
