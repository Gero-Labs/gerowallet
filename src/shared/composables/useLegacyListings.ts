import { computed, effectScope, ref, watch, type EffectScope } from 'vue';
import { chunkArray } from 'array-chunk-by-size';
import { Api } from '@/api/api';
import { fetchLegacyListings, legacyRef, type LegacyListingItem } from '@/api/legacy-listings-api';
import { Blockchain, Network } from '@/models/types';
import { resolveAssetWithRow } from '@/shared/utils/resolver';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import networks from '@/utils/networks';

/**
 * The logged wallet's items still sitting at a closed marketplace's contracts (listings, and
 * offers holding only ADA), for the Portfolio card and the notifications inbox.
 *
 * ONE shared state per page: every `useLegacyListings()` caller reads the same refs, and
 * concurrent `refresh()` calls share one request, so the card and the inbox cost one lookup
 * per wallet. The watchers that drive it live in a detached effect scope, so the component
 * that happened to call first unmounting never stops them.
 *
 * Asks only when the `isNftMarketEnabled` flag is on, the logged wallet is Cardano mainnet and
 * its keys are loaded. The owners it names are the payment and change key hashes, never the
 * stake key: the contracts' datums name a payment key. A switch of wallet empties the list at
 * once (wallet A's items are never shown under wallet B), and an answer for a wallet or key set
 * the user has since left is dropped. A failed lookup keeps the list it had.
 *
 * The NFTs are not in the wallet, so the wallet store has no metadata for them. Their names and
 * images come from the same asset-info call the sync makes (`POST /api/assets/info`), mapped by
 * the resolver the rest of the wallet uses (CIP-25, CIP-68, IPFS gateway rewriting). A unit with
 * no metadata, or whose lookup failed, still shows: the name is decoded from its hex asset name.
 */

export interface LegacyItemMeta {
  name: string;
  image?: string;
}

/** Bytes of units per asset-info request, as the asset sync sends them. */
const ASSET_INFO_BATCH_BYTES = 4000;
const OWNER_PKH = /^[0-9a-f]{56}$/;

/** Everything one lookup depends on. Two lookups with the same `key` would ask the same thing. */
interface LookupTarget {
  key: string;
  chain: string;
  network: string;
  owners: string[];
}

const items = ref<LegacyListingItem[]>([]);
const meta = ref(new Map<string, LegacyItemMeta>());
const loading = ref(false);
const count = computed(() => items.value.length);

/** Unit metadata is the same for every wallet, so it outlives a wallet switch. */
const metaByUnit = new Map<string, LegacyItemMeta>();
/** Units whose asset-info lookup answered; the others hold only a decoded fallback name and are asked again. */
const resolvedUnits = new Set<string>();
/**
 * How long a cancelled ref stays off the list while the server still names it. A cancel that is
 * submitted but not yet confirmed leaves its inputs unspent, so the server keeps listing them
 * for the length of the mempool window; the item is hidden for that long and no longer, so a
 * cancel that never confirms (dropped, expired, rolled back) puts a still-stuck item back where
 * the user can retry it. There is no timer: the window is checked when an answer is applied, so
 * an expired item shows again with the first answer after it (the next refresh), not by itself.
 */
export const FORGET_HIDE_MS = 15 * 60 * 1000;

/** A cancelled ref: when it was forgotten, and the owner of the output when the list showed it. */
interface ForgottenRef {
  at: number;
  /** Undefined when the list did not hold the ref at the time; such an entry only ever expires. */
  ownerPkh: string | undefined;
}

/**
 * Refs the wallet has cancelled. The by-owner lookup re-checks that a row is unspent when it
 * answers, so a confirmed cancel leaves the answer by itself; an entry is therefore dropped as
 * soon as an answer that asked about the ref's owner no longer contains it, or once FORGET_HIDE_MS
 * has passed, whichever comes first. It hides a ref only while the server still returns it.
 */
const forgotten = new Map<string, ForgottenRef>();

/** Bumped whenever the list is emptied, so an answer that started before it is not applied after it. */
let epoch = 0;
let inflight: { key: string; epoch: number; promise: Promise<void> } | null = null;
let scope: EffectScope | undefined;

function ownerHashes(): string[] {
  const owners = new Set<string>();
  for (const kind of ['payment', 'change'] as const) {
    for (const key of walletStore.keys?.[kind] ?? []) {
      if (typeof key?.cred === 'string' && OWNER_PKH.test(key.cred)) owners.add(key.cred);
    }
  }
  return [...owners].sort();
}

const target = computed<LookupTarget | null>(() => {
  if (!featureFlagsStore.isNftMarketEnabled()) return null;
  const wallet = walletStore.loggedWallet;
  if (!wallet || wallet.chain !== Blockchain.CARDANO || wallet.network !== Network.MAINNET) return null;
  const owners = ownerHashes();
  if (owners.length === 0) return null;
  return { key: `${wallet.id}:${owners.join(',')}`, chain: wallet.chain, network: wallet.network, owners };
});

function isCurrent(key: string, startedAt: number): boolean {
  return epoch === startedAt && target.value?.key === key;
}

/** Empty the list and forget any lookup in flight: its answer is for a wallet or state that is gone. */
function clear(): void {
  epoch += 1;
  inflight = null;
  loading.value = false;
  if (items.value.length > 0) items.value = [];
}

function publishMeta(): void {
  meta.value = new Map(metaByUnit);
}

/** A name for a unit from its asset row, or from the hex asset name alone when there is no row. */
function describeUnit(unit: string, row: unknown): LegacyItemMeta {
  try {
    const resolved = resolveAssetWithRow({ unit }, row);
    return { name: resolved.name, ...(resolved.img ? { image: resolved.img } : {}) };
  } catch (e) {
    debugLog('[legacy-listings] could not read the metadata of', unit, e);
    return row === undefined ? { name: unit.slice(0, 16) + '...' } : describeUnit(unit, undefined);
  }
}

/** Asks which of these units have metadata and records a name and image for each answer. Never throws. */
async function resolveUnits(units: string[], target: LookupTarget): Promise<void> {
  const wanted = units.filter((unit) => !resolvedUnits.has(unit));
  if (wanted.length === 0) return;
  const api = new Api({ chain: target.chain, network: target.network }, networks.resolveDefaultProvider(target.chain, target.network));
  const batches: string[][] = chunkArray({ input: wanted, bytesSize: ASSET_INFO_BATCH_BYTES });
  await Promise.all(batches.map(async (batch) => {
    try {
      const { status, data } = await api.getAssetsInfo(batch);
      if (status !== 200 || !Array.isArray(data)) return;
      const rows = new Map<string, unknown>();
      for (const row of data) {
        if (typeof row?.asset === 'string') rows.set(row.asset, row);
      }
      for (const unit of batch) {
        metaByUnit.set(unit, describeUnit(unit, rows.get(unit)));
        resolvedUnits.add(unit);
      }
      publishMeta();
    } catch (e) {
      debugLog('[legacy-listings] asset metadata lookup failed, keeping the decoded names', e);
    }
  }));
}

/**
 * What an answer shows once the forgotten refs are settled against it. A ref older than
 * FORGET_HIDE_MS leaves the set whatever the answer says. A ref the answer omits leaves the set
 * only if the answer asked about the ref's owner (`owners`): then it is confirmed spent, and shows
 * again if a rollback brings it back. An answer for other owners (another wallet, or another key
 * set of this one) says nothing about it, so its entry stays. The rest stay hidden.
 */
function withoutForgotten(listed: LegacyListingItem[], owners: readonly string[]): LegacyListingItem[] {
  if (forgotten.size === 0) return listed;
  const now = Date.now();
  const answered = new Set(listed.map(legacyRef));
  const asked = new Set(owners);
  for (const [ref, entry] of forgotten) {
    const confirmedSpent = !answered.has(ref) && entry.ownerPkh !== undefined && asked.has(entry.ownerPkh);
    if (now - entry.at >= FORGET_HIDE_MS || confirmedSpent) forgotten.delete(ref);
  }
  return listed.filter((item) => !forgotten.has(legacyRef(item)));
}

async function load(lookup: LookupTarget, startedAt: number): Promise<void> {
  try {
    const listed = await fetchLegacyListings(lookup.owners, lookup.network);
    if (!isCurrent(lookup.key, startedAt)) return;

    const visible = withoutForgotten(listed, lookup.owners);
    const units = [...new Set(visible.flatMap((item) => item.assets.map((asset) => asset.unit)))];
    // Every unit has a name before its item appears; the metadata lookup then improves it.
    let seeded = false;
    for (const unit of units) {
      if (!metaByUnit.has(unit)) {
        metaByUnit.set(unit, describeUnit(unit, undefined));
        seeded = true;
      }
    }
    if (seeded) publishMeta();
    items.value = visible;

    await resolveUnits(units, lookup);
  } catch (e) {
    // The list keeps what it had; nothing here is worth a toast, the card simply stays as it was.
    debugLog('[legacy-listings] lookup failed, keeping the list it had', e);
  }
}

/**
 * Looks the wallet's stuck items up again. Resolves when the list and the names are in; never
 * rejects (a failed lookup is logged and the list stays as it was). Does nothing where the
 * lookup is off. Concurrent calls for the same wallet share one request.
 */
function refresh(): Promise<void> {
  const lookup = target.value;
  if (!lookup) return Promise.resolve();
  if (inflight && inflight.key === lookup.key && inflight.epoch === epoch) return inflight.promise;

  const startedAt = epoch;
  const entry: NonNullable<typeof inflight> = { key: lookup.key, epoch: startedAt, promise: Promise.resolve() };
  entry.promise = load(lookup, startedAt).finally(() => {
    if (inflight === entry) {
      inflight = null;
      loading.value = false;
    }
  });
  inflight = entry;
  loading.value = true;
  return entry.promise;
}

/**
 * Drops these refs (`txHash#index`) from the list at once, right after their cancel was submitted,
 * and keeps them off it for up to FORGET_HIDE_MS (see there).
 */
function forget(refs: string[]): void {
  if (refs.length === 0) return;
  const now = Date.now();
  for (const ref of refs) {
    const shown = items.value.find((item) => legacyRef(item) === ref);
    forgotten.set(ref, { at: now, ownerPkh: shown?.ownerPkh ?? forgotten.get(ref)?.ownerPkh });
  }
  const gone = new Set(refs);
  items.value = items.value.filter((item) => !gone.has(legacyRef(item)));
}

function start(): void {
  if (scope) return;
  scope = effectScope(true); // detached: immune to the lifetime of whichever component asked first
  scope.run(() => {
    // Another wallet: nothing of the last one may show, not even for the length of a lookup.
    watch(() => walletStore.loggedWallet?.id, clear, { flush: 'sync' });
    // The lookup's inputs (flag, chain and network, keys) changed, or it just became possible.
    watch(() => target.value?.key ?? null, () => {
      const lookup = target.value;
      if (!lookup) {
        clear();
        return;
      }
      // Same wallet with another key set (the keys arrived late, or more were found): keep only what is still its own.
      const owners = new Set(lookup.owners);
      if (items.value.some((item) => !owners.has(item.ownerPkh))) {
        items.value = items.value.filter((item) => owners.has(item.ownerPkh));
      }
      void refresh();
    }, { immediate: true });
  });
}

/** Test seam: back to a page that has not asked yet. */
export function resetLegacyListings(): void {
  scope?.stop();
  scope = undefined;
  clear();
  metaByUnit.clear();
  resolvedUnits.clear();
  forgotten.clear();
  publishMeta();
}

export function useLegacyListings() {
  start();
  return { items, meta, count, loading, refresh, forget };
}
