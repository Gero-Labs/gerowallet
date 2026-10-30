import axios from 'axios';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import type { LegacyContract } from '@/utils/legacyMarketScripts';

/**
 * Finds the wallet's listings and offers still sitting at the two legacy marketplace
 * contracts, through gero-backend's Nexus proxy (VITE_NEXUS_URL -> <backend>/api/nexus), which
 * injects the Nexus API key server-side. Nexus answers from its hourly index of the
 * contracts, so an item can be spent between the answer and the click: the cancel build is
 * what settles that (422 LISTING_NOT_FOUND), not this list.
 */

export interface LegacyListingItem {
  txHash: string;
  outputIndex: number;
  contract: LegacyContract;
  /** A UTxO holding any non-ADA asset is a listing; an ADA-only one is an offer. */
  kind: 'listing' | 'offer';
  /** Payment key hash of the owner named in the datum. */
  ownerPkh: string;
  /** Lovelace locked in the UTxO, a decimal string. */
  lovelace: string;
  assets: { unit: string; quantity: string }[];
}

/** Most owner key hashes Nexus accepts in one by-owner request. */
export const LEGACY_OWNERS_PER_REQUEST = 200;

const legacyClient = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

const TX_HASH = /^[0-9a-f]{64}$/;
const OWNER_PKH = /^[0-9a-f]{56}$/;
const DECIMAL = /^[0-9]+$/;
const HEX = /^[0-9a-f]+$/;

/** `txHash#outputIndex`, the key the rest of the rescue flow indexes an item by. */
export function legacyRef(item: LegacyListingItem): string {
  return `${item.txHash}#${item.outputIndex}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One item of Nexus's answer, rebuilt from the fields the wallet uses, or undefined when
 * any of them is missing or malformed. The wallet never shows or builds from a half-read
 * item.
 */
function parseItem(raw: unknown): LegacyListingItem | undefined {
  if (!isRecord(raw)) return undefined;
  const { txHash, outputIndex, contract, kind, ownerPkh, lovelace, assets } = raw;
  if (typeof txHash !== 'string' || !TX_HASH.test(txHash)) return undefined;
  if (typeof outputIndex !== 'number' || !Number.isSafeInteger(outputIndex) || outputIndex < 0) return undefined;
  if (contract !== 'legacy_v3' && contract !== 'legacy_v2') return undefined;
  if (kind !== 'listing' && kind !== 'offer') return undefined;
  if (typeof ownerPkh !== 'string' || !OWNER_PKH.test(ownerPkh)) return undefined;
  if (typeof lovelace !== 'string' || !DECIMAL.test(lovelace)) return undefined;
  if (!Array.isArray(assets)) return undefined;
  const parsedAssets: LegacyListingItem['assets'] = [];
  for (const asset of assets) {
    if (!isRecord(asset)) return undefined;
    const { unit, quantity } = asset;
    if (typeof unit !== 'string' || !HEX.test(unit)) return undefined;
    if (typeof quantity !== 'string' || !DECIMAL.test(quantity)) return undefined;
    parsedAssets.push({ unit, quantity });
  }
  return { txHash, outputIndex, contract, kind, ownerPkh, lovelace, assets: parsedAssets };
}

/**
 * The listings and offers of these owners (payment key hashes) that are still unspent at
 * the legacy contracts. Mainnet only: any other network returns `[]` without a request.
 * Owners go to Nexus in chunks of 200 and each distinct owner is asked about once. Items
 * that do not read back whole are dropped. Throws when Nexus fails or answers with
 * something that is not an items list, so a failed lookup never reads as "nothing stuck".
 */
export async function fetchLegacyListings(ownerPkhs: string[], network: string): Promise<LegacyListingItem[]> {
  const nexusNetwork = toNexusNetwork(network);
  if (nexusNetwork !== 'cardano-mainnet') return [];
  const owners = [...new Set(ownerPkhs)];
  const items: LegacyListingItem[] = [];
  for (let start = 0; start < owners.length; start += LEGACY_OWNERS_PER_REQUEST) {
    const { data } = await legacyClient.post<{ items?: unknown }>(
      '/api/legacy-listings/by-owner',
      { ownerPkhs: owners.slice(start, start + LEGACY_OWNERS_PER_REQUEST) },
      { params: { network: nexusNetwork } },
    );
    if (!isRecord(data) || !Array.isArray(data.items)) throw new Error('Malformed legacy listings response');
    for (const raw of data.items) {
      const item = parseItem(raw);
      if (item) items.push(item);
    }
  }
  return items;
}
