/**
 * Compressed NFTs (Bubblegum leaves) and Metaplex Core assets: not token accounts, so Gero Sync's
 * token list never names them. Nexus lists them from a DAS index (`GET /api/sol/addresses/{a}/assets`)
 * and gives what a transfer needs, read fresh (`GET /api/sol/assets/{id}/transfer`). Both answers
 * are read strictly here: an unexpected kind, address, URL or number drops the row or fails the
 * read, never shows half of it. Their text is third-party text, shown only as text.
 */
import { isValidSolanaAddress } from './solanaKeyManager';
import { solanaNftUrl, type SolanaNft } from './solanaNfts';

export type SolanaAssetKind = 'compressed' | 'core';

const MAX_NAME = 200;
const MAX_TEXT = 2000;
const MAX_ATTRIBUTES = 32;
const MAX_PROOF = 30;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Nexus's asset list as display rows (a SolanaNft with its `kind`); unreadable rows are dropped. */
export function parseSolanaAssets(body: unknown, now: number): SolanaNft[] {
  const rows = (body as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(rows)) throw new Error('Unexpected Nexus assets answer');
  const out: SolanaNft[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = r['id'];
    const kind = r['kind'];
    if (!isValidSolanaAddress(id) || (kind !== 'compressed' && kind !== 'core') || seen.has(id)) continue;
    seen.add(id);
    const collection = r['collection'] as Record<string, unknown> | null | undefined;
    const attributes = Array.isArray(r['attributes']) ? r['attributes'] as Array<Record<string, unknown>> : [];
    out.push({
      mint: id,
      kind,
      standard: null,
      name: text(r['name'], MAX_NAME),
      symbol: text(r['symbol'], MAX_NAME),
      image: solanaNftUrl(r['image']),
      animationUrl: solanaNftUrl(r['animationUrl']),
      description: text(r['description'], MAX_TEXT),
      externalUrl: solanaNftUrl(r['externalUrl']),
      collection: collection && isValidSolanaAddress(collection['address'])
        ? { address: collection['address'] as string, verified: collection['verified'] === true }
        : null,
      ruleSet: null,
      attributes: attributes.slice(0, MAX_ATTRIBUTES).flatMap((a) => {
        const value = text(a?.['value'], MAX_NAME);
        return value ? [{ traitType: text(a?.['traitType'], MAX_NAME), value }] : [];
      }),
      sellerFeeBasisPoints: null,
      offChain: true,
      fetchedAt: now,
    });
  }
  return out;
}

export interface SolanaCompressedTransferInputs {
  kind: 'compressed';
  id: string;
  owner: string;
  delegate: string;
  frozen: boolean;
  tree: string;
  treeVersion: number;
  root: string;
  dataHash: string;
  creatorHash: string;
  nonce: bigint;
  index: number;
  proof: string[];
}

export interface SolanaCoreTransferInputs {
  kind: 'core';
  id: string;
  owner: string;
  frozen: boolean;
  collection: string | null;
}

export type SolanaAssetTransferInputs = SolanaCompressedTransferInputs | SolanaCoreTransferInputs;

const isUint = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;

/** Nexus's transfer inputs for `id`, read strictly; throws for anything that does not fit. */
export function parseSolanaAssetTransfer(body: unknown, id: string): SolanaAssetTransferInputs {
  const r = (body ?? {}) as Record<string, unknown>;
  if (r['id'] !== id || !isValidSolanaAddress(r['owner'])) throw new Error('Unexpected Nexus transfer answer');
  const frozen = r['frozen'] === true;
  if (r['kind'] === 'core') {
    const collection = r['collection'];
    if (collection !== undefined && collection !== null && !isValidSolanaAddress(collection)) throw new Error('Unexpected collection');
    return { kind: 'core', id, owner: r['owner'] as string, frozen, collection: (collection as string | null | undefined) ?? null };
  }
  if (r['kind'] !== 'compressed') throw new Error('Unexpected asset kind');
  const proof = r['proof'];
  if (!Array.isArray(proof) || proof.length > MAX_PROOF || !proof.every(isValidSolanaAddress)) throw new Error('Unexpected proof');
  for (const field of ['delegate', 'tree', 'root', 'dataHash', 'creatorHash']) {
    if (!isValidSolanaAddress(r[field])) throw new Error(`Unexpected ${field}`);
  }
  if (!isUint(r['nonce'], Number.MAX_SAFE_INTEGER) || !isUint(r['index'], 0xffffffff) || !isUint(r['treeVersion'], 255)) {
    throw new Error('Unexpected leaf numbers');
  }
  return {
    kind: 'compressed',
    id,
    owner: r['owner'] as string,
    delegate: r['delegate'] as string,
    frozen,
    tree: r['tree'] as string,
    treeVersion: r['treeVersion'] as number,
    root: r['root'] as string,
    dataHash: r['dataHash'] as string,
    creatorHash: r['creatorHash'] as string,
    nonce: BigInt(r['nonce'] as number),
    index: r['index'] as number,
    proof: proof as string[],
  };
}
