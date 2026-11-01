/**
 * Storage for CIP-45: the remembered dApp pairings (which peers may reconnect),
 * this wallet's peer id and the peer library's own cache.
 *
 * It lives in the extension's private store (privateStore.ts). Older releases
 * kept it in chrome.storage.local, which every content script can rewrite, so a
 * page could plant a pairing that the wallet would later resume. Each key is
 * moved across once (moveFromChromeLocal); after that nothing in
 * chrome.storage.local is ever read for it.
 *
 * The get/set shape mirrors chrome.storage so the service reads the same way.
 */
import { moveFromChromeLocal, setPrivateMany } from '@/utils/privateStore';

export const cip45Storage = {
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const value = await moveFromChromeLocal(key);
      if (value !== undefined) out[key] = value;
    }
    return out;
  },

  async set(items: Record<string, unknown>): Promise<void> {
    await setPrivateMany(Object.entries(items).map(([key, value]) => ({ key, value: JSON.parse(JSON.stringify(value)) })));
  },
};
