/**
 * Solana NFTs: which held tokens may be NFTs, Nexus's metadata rows read strictly
 * (`POST /api/sol/nfts/metadata`), and their grouping into collections for display.
 *
 * Every string here is third-party text (the NFT's own metadata): it is shown as text, never as
 * markup, and its URLs are loaded only through Gero's image proxy (`assets.resolveIcon`). The
 * wallet re-checks what Nexus returns rather than trusting it: an unexpected URL scheme, an
 * oversized string or a row for another mint is dropped.
 *
 * A collection is VERIFIED only when Nexus reports the metadata's `collection.verified` flag set
 * (the Token Metadata program sets it when the collection's authority signs; the wallet does not
 * re-read that on chain itself). Anyone can mint an NFT that claims a famous collection's name, so
 * an unverified NFT stands alone, never grouped with others under a name it chose itself.
 */
import { isValidSolanaAddress } from './solanaKeyManager';

export type SolanaNftStandard =
  | 'nonFungible'
  | 'nonFungibleEdition'
  | 'programmableNonFungible'
  | 'programmableNonFungibleEdition';

export interface SolanaNft {
  mint: string;
  /** null when the metadata does not say (older NFTs: a plain SPL transfer moves them). */
  standard: SolanaNftStandard | null;
  name: string | null;
  symbol: string | null;
  image: string | null;
  animationUrl: string | null;
  description: string | null;
  externalUrl: string | null;
  collection: { address: string; verified: boolean } | null;
  /** A programmable NFT's authorization rule set (its transfers are checked against it), or null. */
  ruleSet: string | null;
  attributes: Array<{ traitType: string | null; value: string }>;
  sellerFeeBasisPoints: number | null;
  /** The off-chain JSON was read (image, description, attributes). */
  offChain: boolean;
  /** When Gero read this (epoch ms), to read an incomplete one again later. */
  fetchedAt: number;
  /**
   * Not a token account: a compressed NFT (a Bubblegum leaf) or a Metaplex Core asset, listed by
   * the DAS index (solanaAssets.ts). `mint` is then the asset id. Absent for a token NFT.
   */
  kind?: 'compressed' | 'core';
}

export interface SolanaNftCollection {
  /** The verified collection's address, or the NFT's own mint for one that stands alone. */
  id: string;
  name: string;
  verified: boolean;
  image: string | null;
  items: SolanaNft[];
}

const STANDARDS: readonly string[] = ['nonFungible', 'nonFungibleEdition', 'programmableNonFungible', 'programmableNonFungibleEdition'];
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const MAX_URL = 2048;
const MAX_ATTRIBUTES = 32;
/** An NFT whose JSON could not be read is asked about again after this long. */
export const SOLANA_NFT_RETRY_MS = 60 * 60_000;
/** Mints asked about per Nexus call (its limit). */
export const SOLANA_NFT_BATCH = 50;

/** Held tokens that may be NFTs: 0 decimals and exactly one held. Nexus confirms the supply. */
export function solanaNftCandidates(tokens: ReadonlyArray<{ mint: string; amount: string | bigint; decimals: number }> | null | undefined): string[] {
  const mints = new Set<string>();
  for (const token of tokens ?? []) {
    if (token.decimals === 0 && String(token.amount) === '1' && isValidSolanaAddress(token.mint)) mints.add(token.mint);
  }
  return [...mints];
}

/** The mints Gero should ask Nexus about now: unknown ones, and incomplete ones past the retry delay. */
export function solanaNftMintsToRead(candidates: readonly string[], known: Readonly<Record<string, SolanaNft | false>>, now: number): string[] {
  return candidates.filter((mint) => {
    const entry = known[mint];
    if (entry === undefined) return true;
    if (entry === false) return false;
    return !entry.offChain && now - entry.fetchedAt >= SOLANA_NFT_RETRY_MS;
  });
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** A URL the image proxy can load (https, http, ipfs, ar), or null. */
export function solanaNftUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > MAX_URL || /[\s"'<>\\]/.test(url)) return null;
  return /^(https?|ipfs|ar):\/\//i.test(url) ? url : null;
}

/**
 * Nexus's answer, one entry per mint asked, in order: the NFT, `false` for a mint that is not an
 * NFT, or `undefined` for a row that could not be read (asked again next time).
 */
export function parseSolanaNftRows(body: unknown, mints: readonly string[], now: number): Array<SolanaNft | false | undefined> {
  const rows = (body as { nfts?: unknown } | null)?.nfts;
  if (!Array.isArray(rows) || rows.length !== mints.length) throw new Error('Unexpected Nexus NFT answer');
  return rows.map((row, i): SolanaNft | false | undefined => {
    if (!row || typeof row !== 'object') return undefined;
    const r = row as Record<string, unknown>;
    if (r['mint'] !== mints[i]) return undefined;
    if (r['nft'] !== true) return false;
    const collection = r['collection'] as Record<string, unknown> | null | undefined;
    const attributes = Array.isArray(r['attributes']) ? r['attributes'] as Array<Record<string, unknown>> : [];
    return {
      mint: mints[i],
      standard: typeof r['standard'] === 'string' && STANDARDS.includes(r['standard']) ? r['standard'] as SolanaNftStandard : null,
      name: text(r['name'], MAX_NAME),
      symbol: text(r['symbol'], MAX_NAME),
      image: solanaNftUrl(r['image']),
      animationUrl: solanaNftUrl(r['animationUrl']),
      description: text(r['description'], MAX_TEXT),
      externalUrl: solanaNftUrl(r['externalUrl']),
      collection: collection && isValidSolanaAddress(collection['address'])
        ? { address: collection['address'] as string, verified: collection['verified'] === true }
        : null,
      ruleSet: isValidSolanaAddress(r['ruleSet']) ? r['ruleSet'] as string : null,
      attributes: attributes.slice(0, MAX_ATTRIBUTES).flatMap((a) => {
        const value = text(a?.['value'], MAX_NAME);
        return value ? [{ traitType: text(a?.['traitType'], MAX_NAME), value }] : [];
      }),
      sellerFeeBasisPoints: typeof r['sellerFeeBasisPoints'] === 'number' && Number.isInteger(r['sellerFeeBasisPoints'])
        ? r['sellerFeeBasisPoints'] as number : null,
      offChain: r['offChain'] === true,
      fetchedAt: now,
    };
  });
}

/** A programmable NFT: sent through Token Metadata, under its creator's transfer rules. */
export function isProgrammableSolanaNft(nft: Pick<SolanaNft, 'standard'>): boolean {
  return nft.standard === 'programmableNonFungible' || nft.standard === 'programmableNonFungibleEdition';
}

/** The NFT's display name: its own, else its shortened mint. */
export function solanaNftName(nft: Pick<SolanaNft, 'name' | 'mint'>): string {
  return nft.name ?? `${nft.mint.slice(0, 4)}…${nft.mint.slice(-4)}`;
}

/** A verified collection's name: what its items' names share (trailing " #12" dropped). */
function collectionName(items: readonly SolanaNft[]): string {
  const names = items.map(solanaNftName);
  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const cleaned = prefix.replace(/[\s#\-:]*\d*$/, '').trim();
  return cleaned || names[0];
}

/**
 * The held NFTs as collections: NFTs of one VERIFIED collection together, every other NFT on
 * its own. Verified collections first, then by name.
 */
export function solanaNftCollections(nfts: readonly SolanaNft[]): SolanaNftCollection[] {
  const groups = new Map<string, SolanaNftCollection>();
  for (const nft of nfts) {
    const verified = !!nft.collection?.verified;
    const id = verified ? nft.collection!.address : nft.mint;
    const group = groups.get(id) ?? { id, name: '', verified, image: null, items: [] };
    group.items.push(nft);
    groups.set(id, group);
  }
  const out = [...groups.values()].map((group) => {
    const items = [...group.items].sort((a, b) => solanaNftName(a).localeCompare(solanaNftName(b), undefined, { numeric: true }));
    return {
      ...group,
      items,
      name: group.verified ? collectionName(items) : solanaNftName(items[0]),
      image: items.find((item) => item.image)?.image ?? null,
    };
  });
  return out.sort((a, b) => Number(b.verified) - Number(a.verified) || a.name.localeCompare(b.name));
}
