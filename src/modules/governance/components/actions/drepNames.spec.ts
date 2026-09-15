// The name index, now that it is a projection of the DRep register rather than a
// second walk of the same endpoint.
//
// Sharing a cache between a background courtesy and a page the user waits on had
// three things to reconcile, and each one fails SILENTLY if it regresses: a
// filtered register would hand the positions tab a fraction of the names, a
// tighter page budget would drop the tail of the register, and a projection that
// stopped retaining `metadata` would leave every row nameless with nothing
// raised. All three read to a user as "this DRep published no name", which is
// also what the truth looks like. Hence these.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ getDRepsPaginated: vi.fn() }));

vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepsPaginated: (...args: unknown[]) => h.getDRepsPaginated(...args) },
}));

import { loadDRepNameIndex, resetDRepNameIndex } from './drepNames';
import { loadDRepRegister, MAX_REGISTER_PAGES, REGISTER_PAGE_SIZE } from '@/modules/governance/views/drepRegister';
import { toCip129 } from '@/shared/utils/drepId';

/** A distinct 28-byte credential per n, as hex. */
const credential = (n: number): string => n.toString(16).padStart(56, '0');

const drepId = (n: number): string => toCip129(credential(n)) as string;

/** A `/api/dreps` row carrying a published name. */
function named(n: number) {
  return {
    drep_id: drepId(n),
    hex: credential(n),
    registered: true,
    active: true,
    amount: '1000000',
    display_name: null,
    metadata: { meta_json: { body: { givenName: `DRep ${n}` } } },
    votes: [],
    delegators: [],
  };
}

/** A server holding `total` named DReps, handing them out `per_page` at a time. */
function serverWith(total: number, perPage = REGISTER_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return vi.fn(async (params: { page?: number; search?: string }) => {
    const page = params?.page ?? 1;
    const start = (page - 1) * perPage;
    return {
      items: Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => named(start + i + 1)),
      meta: { page, per_page: perPage, total_items: total, total_pages: totalPages },
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDRepNameIndex();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drepNames: one walk serves both surfaces', () => {
  it('derives the names from the register the directory already loaded', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1682));

    // The directory loads the register to order its columns...
    const register = await loadDRepRegister('Cardano', 'Mainnet');
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(4);

    // ...and the positions tab then costs nothing. It used to cost a second
    // walk: 10.74 MB gzipped over four more requests, for rows already in hand.
    const names = await loadDRepNameIndex('Cardano', 'Mainnet');

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(4);
    expect(names.size).toBe(register.records.length);
    // Including a DRep from the last page, which a single-page index never saw.
    expect(names.get(credential(1682))?.name).toBe('DRep 1682');
  });

  it('works the other way round too, whichever surface is opened first', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(600));

    await loadDRepNameIndex('Cardano', 'Mainnet');
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(2);

    const register = await loadDRepRegister('Cardano', 'Mainnet');

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(2);
    expect(register.records).toHaveLength(600);
    expect(register.complete).toBe(true);
  });
});

describe('drepNames: a searched register is never the name index', () => {
  it('asks for the unsearched register, with no term at all', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(100));

    await loadDRepNameIndex('Cardano', 'Mainnet');

    for (const call of h.getDRepsPaginated.mock.calls) {
      expect(call[0]).not.toHaveProperty('search');
    }
  });

  it('does not take the directory register while it is filtered', async () => {
    // The sharp edge of sharing a cache. The server filters BEFORE it orders, so
    // a directory sitting on a search term holds a smaller, different set — and
    // serving that here would silently unname most of the positions tab.
    h.getDRepsPaginated.mockImplementation(async (params: { page?: number; search?: string }) => {
      const page = params?.page ?? 1;
      if (params?.search) {
        return { items: [named(7)], meta: { page, per_page: REGISTER_PAGE_SIZE, total_items: 1, total_pages: 1 } };
      }
      const start = (page - 1) * REGISTER_PAGE_SIZE;
      return {
        items: Array.from({ length: Math.max(0, Math.min(REGISTER_PAGE_SIZE, 600 - start)) }, (_, i) =>
          named(start + i + 1),
        ),
        meta: { page, per_page: REGISTER_PAGE_SIZE, total_items: 600, total_pages: 2 },
      };
    });

    const filtered = await loadDRepRegister('Cardano', 'Mainnet', 'cardano');
    expect(filtered.records).toHaveLength(1);

    const names = await loadDRepNameIndex('Cardano', 'Mainnet');

    // The whole register, not the one row the search matched. The differing key
    // makes this a cache MISS, which costs a walk — never a smaller answer.
    expect(names.size).toBe(600);
    expect(names.get(credential(500))?.name).toBe('DRep 500');
  });
});

describe('drepNames: the budget did not shrink', () => {
  it('still reaches eight pages, the budget it walked on its own', async () => {
    // Where the two budgets differ is a server that clamps its page size: the
    // register is then more pages than measured, and six would have cost the
    // index two pages' worth of names with nothing to say so.
    h.getDRepsPaginated.mockImplementation(serverWith(REGISTER_PAGE_SIZE * 12));

    const names = await loadDRepNameIndex('Cardano', 'Mainnet');

    expect(MAX_REGISTER_PAGES).toBeGreaterThanOrEqual(8);
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(8);
    expect(names.size).toBe(REGISTER_PAGE_SIZE * 8);
  });
});

describe('drepNames: the two lifetimes', () => {
  it('keeps the names after the register expires, without a second walk', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(600));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    const first = await loadDRepNameIndex('Cardano', 'Mainnet');
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(2);

    // Six minutes on, the register is stale and a directory load would re-walk.
    now.mockReturnValue(1_000_000 + 6 * 60 * 1000);
    const second = await loadDRepNameIndex('Cardano', 'Mainnet');

    // The names were derived once and kept, so the courtesy costs no requests —
    // what is memoised is the small map, never the ~34 MB of records behind it.
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });
});

describe('drepNames: a failure costs only the names', () => {
  it('resolves to an empty index rather than rejecting', async () => {
    h.getDRepsPaginated.mockRejectedValue(new Error('directory down'));

    await expect(loadDRepNameIndex('Cardano', 'Mainnet')).resolves.toEqual(new Map());
  });

  it('picks the names up on a later mount instead of memoising the failure', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    h.getDRepsPaginated.mockRejectedValue(new Error('directory down'));

    expect((await loadDRepNameIndex('Cardano', 'Mainnet')).size).toBe(0);
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(1);

    // The register holds the failed walk for its own TTL, so retrying inside it
    // costs a cache read rather than another walk — that is what bounds the
    // retry rate now that an empty index is no longer memoised.
    h.getDRepsPaginated.mockImplementation(serverWith(100));
    expect((await loadDRepNameIndex('Cardano', 'Mainnet')).size).toBe(0);
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(1);

    // Once it expires the names arrive, where the old memo served EMPTY for the
    // rest of the session.
    now.mockReturnValue(1_000_000 + 6 * 60 * 1000);
    expect((await loadDRepNameIndex('Cardano', 'Mainnet')).size).toBe(100);
  });
});

describe('drepNames: what the projection has to retain', () => {
  it('carries a published avatar through, raw, as the DRep wrote it', async () => {
    // `projectRecord` drops two thirds of each record. If `metadata` ever went
    // with it, every row would render nameless and faceless with no error — so
    // this pins the field the index reads THROUGH the register.
    const cid = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';
    h.getDRepsPaginated.mockResolvedValue({
      items: [
        {
          drep_id: drepId(3),
          metadata: { meta_json: { body: { givenName: 'CryptoCrow', image: { contentUrl: `ipfs://${cid}` } } } },
        },
      ],
      meta: { page: 1, per_page: REGISTER_PAGE_SIZE, total_items: 1, total_pages: 1 },
    });

    const names = await loadDRepNameIndex('Cardano', 'Mainnet');

    // Unmapped: `DRepAvatar` stays the single place that turns `ipfs://` into
    // something the extension can load.
    expect(names.get(credential(3))).toEqual({ name: 'CryptoCrow', image: `ipfs://${cid}` });
  });

  it('indexes a DRep who published no name, so the row falls back to its id', async () => {
    h.getDRepsPaginated.mockResolvedValue({
      items: [{ drep_id: drepId(4), metadata: null, display_name: null }],
      meta: { page: 1, per_page: REGISTER_PAGE_SIZE, total_items: 1, total_pages: 1 },
    });

    const names = await loadDRepNameIndex('Cardano', 'Mainnet');

    // Present but nameless — never an invented identity, never a placeholder.
    expect(names.get(credential(4))).toEqual({ name: null, image: undefined });
  });
});
