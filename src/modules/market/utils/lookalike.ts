/**
 * The lookalike warning (ruling R8). No NFT "verified collection" flag exists in any data source,
 * so the market page warns when the collection it shows has the name of one of the top 200
 * collections (`getNftCollections`) under a DIFFERENT policy id. Anyone can mint a copy of a
 * popular collection and list it; the policy id is the only thing that tells them apart, so the
 * page also shows it on every listing, and the warning never hides it.
 *
 * Names are compared case-insensitively with the ends trimmed. Nothing else is folded: another
 * spelling is not a match, so the warning does not cry wolf at a mere resemblance.
 */

/** A top collection as far as this check needs it (an `NftCollectionStats`). */
export interface TopCollectionRef {
  policyId: string;
  name?: string;
}

/** The popular collection a name copies. */
export interface Lookalike {
  /** The popular collection's own name. */
  name: string;
  /** Its policy id: the one the real collection is under. */
  policyId: string;
}

/** What a name compares as: trimmed and lower-cased. Empty for anything that is not text. */
export function normalizeCollectionName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * The name of a collection an NFT's own name carries: "SpaceBudz #1234" is of "SpaceBudz". Only
 * a trailing serial (digits, with any `#`, `_`, `-` or spaces before them) is dropped, and only when
 * something is left.
 */
export function nameStem(name: string): string {
  const stem = name.replace(/[\s#_-]*\d+\s*$/, '').trim();
  return stem === '' ? name.trim() : stem;
}

const COLLECTION_KEYS = ['collection', 'project'];
const ATTRIBUTE_KEYS = ['collection', 'project', 'collectionname'];

function textField(record: unknown, keys: readonly string[]): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined;
  for (const [key, value] of Object.entries(record)) {
    if (keys.includes(key.toLowerCase()) && typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/**
 * The collection or project an NFT's own metadata names (`collection` or `project`, at the top or
 * in `attributes`), or undefined. Never its `name`: that is the NFT's.
 */
export function collectionFieldOf(metadata: unknown): string | undefined {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  return textField(metadata, COLLECTION_KEYS) ?? textField((metadata as Record<string, unknown>)['attributes'], ATTRIBUTE_KEYS);
}

/**
 * Every name a collection might be known by: the name the wallet holds it under, what each of its
 * NFTs says its collection is, and the name of each NFT without its serial. The first spelling of a
 * name wins, each is listed once, and an empty one is not a name.
 */
export function candidateNames(source: {
  held?: string;
  items: readonly { name?: string; collection?: string }[];
}): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const add = (name: unknown) => {
    const key = normalizeCollectionName(name);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    names.push((name as string).trim());
  };
  add(source.held);
  for (const item of source.items) {
    add(item?.collection);
    if (typeof item?.name === 'string') add(nameStem(item.name));
  }
  return names;
}

/**
 * The first of `top` (ranked by volume) that has one of `names` under a policy id other than
 * `policyId`, or null. `names` are the candidate names of the collection being shown.
 */
export function findLookalike(names: readonly string[], policyId: string, top: readonly TopCollectionRef[]): Lookalike | null {
  const wanted = new Set(names.map(normalizeCollectionName).filter((name) => name !== ''));
  if (wanted.size === 0) return null;
  const own = String(policyId).toLowerCase();
  for (const entry of top) {
    const name = normalizeCollectionName(entry?.name);
    if (name === '' || !wanted.has(name)) continue;
    if (String(entry.policyId).toLowerCase() === own) continue;
    return { name: (entry.name as string).trim(), policyId: entry.policyId };
  }
  return null;
}
