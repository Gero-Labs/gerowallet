// The full-register walk.
//
// The point of this module is a promise: when it returns `complete: true`, the
// caller may tell the user that a column sorts every DRep. These tests exist to
// keep that promise expensive to break — the walk has to actually span the pages,
// and every way it can fall short has to come back as `complete: false` rather
// than as a shorter list nobody notices.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getDRepsPaginated: vi.fn() }));

vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepsPaginated: (...args: unknown[]) => h.getDRepsPaginated(...args) },
}));

import {
  loadDRepRegister,
  MAX_REGISTER_PAGES,
  pageCount,
  projectRecord,
  REGISTER_PAGE_SIZE,
  resetDRepRegister,
} from './drepRegister';

/** 56 hex chars, as `drepStats` expects a credential to be. */
const credential = (n: number): string => n.toString(16).padStart(2, '0').repeat(28);

/** A `/api/dreps` row with every field the endpoint really sends. */
function record(n: number) {
  return {
    drep_id: `drep_${n}`,
    hex: credential(n),
    has_script: false,
    registered: true,
    active: true,
    expires_epoch_no: 700,
    deposit: '500000000',
    amount: String(1_000_000 * n),
    url: null,
    hash: null,
    display_name: `drep ${n}`,
    metadata: { meta_url: null, meta_hash: null, is_valid: null, meta_json: { body: null } },
    votes: [
      {
        proposal_id: `p${n}`,
        proposal_tx_hash: 'aa'.repeat(32),
        proposal_index: 0,
        vote_tx_hash: 'bb'.repeat(32),
        block_time: 1_700_000_000 + n,
        vote: 'Yes',
        meta_url: null,
        meta_hash: null,
      },
    ],
    delegators: [
      {
        stake_address: `stake${n}`,
        stake_address_hex: 'cc'.repeat(28),
        script_hash: null,
        epoch_no: 650,
        amount: '42',
      },
    ],
  };
}

/** A server holding `total` DReps, handing them out `per_page` at a time. */
function serverWith(total: number, perPage = REGISTER_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return vi.fn(async (params: { page?: number; per_page?: number; search?: string }) => {
    const page = params?.page ?? 1;
    const start = (page - 1) * perPage;
    return {
      items: Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) =>
        record(start + i + 1),
      ),
      meta: { page, per_page: perPage, total_items: total, total_pages: totalPages },
    };
  });
}

const ids = (records: { drep_id?: string | null }[]): string[] => records.map(r => String(r.drep_id));

beforeEach(() => {
  vi.clearAllMocks();
  resetDRepRegister();
});

describe('drepRegister: the walk spans every page', () => {
  it('returns the whole register, not the first page of it', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1682));

    const register = await loadDRepRegister('Cardano', 'Mainnet');

    expect(register.records).toHaveLength(1682);
    expect(register.complete).toBe(true);
    expect(register.totalItems).toBe(1682);
    // Four requests for mainnet's register at 500 a page — the measured cost.
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(4);
    // A DRep from the LAST page is present. Page-local sorting could never see it.
    expect(ids(register.records)).toContain('drep_1682');
  });

  it('asks each page exactly once, in page order, at the register page size', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1200));

    await loadDRepRegister('Cardano', 'Mainnet');

    const asked = h.getDRepsPaginated.mock.calls.map(call => call[0]);
    expect(asked.map(p => p.page).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    for (const params of asked) expect(params.per_page).toBe(REGISTER_PAGE_SIZE);
  });

  it('passes the chain and network through to every page', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1200));

    await loadDRepRegister('Cardano', 'Preprod');

    for (const call of h.getDRepsPaginated.mock.calls) {
      expect(call[1]).toBe('Cardano');
      expect(call[2]).toBe('Preprod');
    }
  });
});

describe('drepRegister: incompleteness is never silent', () => {
  it('stops at the request budget and says the set is incomplete', async () => {
    // Far more pages than the cap allows.
    h.getDRepsPaginated.mockImplementation(serverWith(REGISTER_PAGE_SIZE * (MAX_REGISTER_PAGES + 4)));

    const register = await loadDRepRegister('Cardano', 'Mainnet');

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(MAX_REGISTER_PAGES);
    expect(register.complete).toBe(false);
    expect(register.records.length).toBe(REGISTER_PAGE_SIZE * MAX_REGISTER_PAGES);
  });

  it('keeps the pages it got when one fails, and drops the completeness claim', async () => {
    const server = serverWith(1200);
    h.getDRepsPaginated.mockImplementation(async (params: { page?: number }) => {
      if (params?.page === 2) throw new Error('gateway timeout');
      return server(params);
    });

    const register = await loadDRepRegister('Cardano', 'Mainnet');

    // Pages 1 and 3 survived; page 2's 500 rows did not.
    expect(register.records).toHaveLength(700);
    expect(register.complete).toBe(false);
  });

  it('refuses to claim completeness when fewer rows arrive than the server counts', async () => {
    // A server that reports one page but returns less than it says exists.
    h.getDRepsPaginated.mockResolvedValue({
      items: [record(1), record(2)],
      meta: { page: 1, per_page: REGISTER_PAGE_SIZE, total_items: 900, total_pages: 1 },
    });

    const register = await loadDRepRegister('Cardano', 'Mainnet');

    expect(register.records).toHaveLength(2);
    expect(register.complete).toBe(false);
  });

  it('resolves to an empty incomplete register rather than rejecting', async () => {
    h.getDRepsPaginated.mockRejectedValue(new Error('offline'));

    const register = await loadDRepRegister('Cardano', 'Mainnet');

    expect(register.records).toEqual([]);
    expect(register.complete).toBe(false);
  });

  it('walks by the rows page 1 ACTUALLY returned, not by what was asked for', () => {
    // A server clamping to 100 a page: 1,682 rows is 17 pages, not 4.
    expect(pageCount({ total_items: 1682 }, 100)).toBe(17);
    // `total_pages` is preferred wherever the server sends it.
    expect(pageCount({ total_items: 1682, total_pages: 4 }, 500)).toBe(4);
    // No counts at all: one page is all that can be walked towards.
    expect(pageCount(null, 500)).toBe(1);
  });
});

describe('drepRegister: search is part of the set, and part of the key', () => {
  it('forwards the search term on every page of the walk', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1200));

    await loadDRepRegister('Cardano', 'Mainnet', 'cardano');

    expect(h.getDRepsPaginated.mock.calls).toHaveLength(3);
    for (const call of h.getDRepsPaginated.mock.calls) {
      expect(call[0].search).toBe('cardano');
    }
  });

  it('omits `search` entirely when there is no term', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(100));

    await loadDRepRegister('Cardano', 'Mainnet');

    expect(h.getDRepsPaginated.mock.calls[0][0]).not.toHaveProperty('search');
  });

  it('does not serve one search term from another term register', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(100));

    await loadDRepRegister('Cardano', 'Mainnet', 'alice');
    await loadDRepRegister('Cardano', 'Mainnet', 'bob');

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(2);
    expect(h.getDRepsPaginated.mock.calls.map(c => c[0].search)).toEqual(['alice', 'bob']);
  });
});

describe('drepRegister: the cache', () => {
  it('walks once for the same chain, network and term', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1200));

    const first = await loadDRepRegister('Cardano', 'Mainnet');
    const second = await loadDRepRegister('Cardano', 'Mainnet');

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(3); // one walk, not two
    expect(second.records).toBe(first.records);
  });

  it('re-walks for a different network', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(100));

    await loadDRepRegister('Cardano', 'Mainnet');
    await loadDRepRegister('Cardano', 'Preprod');

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight walk between concurrent callers', async () => {
    h.getDRepsPaginated.mockImplementation(serverWith(1200));

    const [a, b] = await Promise.all([
      loadDRepRegister('Cardano', 'Mainnet'),
      loadDRepRegister('Cardano', 'Mainnet'),
    ]);

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(3);
    expect(a).toBe(b);
  });
});

describe('drepRegister: the projection', () => {
  it('keeps every field the directory reads', () => {
    const projected = projectRecord(record(7));

    expect(projected).toMatchObject({
      drep_id: 'drep_7',
      hex: credential(7),
      has_script: false,
      registered: true,
      active: true,
      expires_epoch_no: 700,
      amount: '7000000',
      display_name: 'drep 7',
    });
    // `drepStats` and `useDelegationHealth` read exactly these four vote fields.
    expect(projected?.votes?.[0]).toEqual({
      proposal_id: 'p7',
      vote: 'Yes',
      meta_url: null,
      block_time: 1_700_000_007,
    });
    // `epochInflow` reads these two; the COUNT survives as the array length.
    expect(projected?.delegators?.[0]).toEqual({ epoch_no: 650, amount: '42' });
    expect(projected?.delegators).toHaveLength(1);
    expect(projected?.metadata).toBeTruthy();
  });

  it('drops the two thirds of the payload nothing renders', () => {
    const projected = projectRecord(record(7)) as Record<string, unknown>;
    const vote = (projected['votes'] as Record<string, unknown>[])[0];
    const delegator = (projected['delegators'] as Record<string, unknown>[])[0];

    // Vote transaction identity: never read by a directory column.
    expect(vote).not.toHaveProperty('vote_tx_hash');
    expect(vote).not.toHaveProperty('proposal_tx_hash');
    // Delegator identity: 80,151 rows of it on mainnet, and only the count shows.
    expect(delegator).not.toHaveProperty('stake_address');
    expect(delegator).not.toHaveProperty('stake_address_hex');
  });

  it('survives a row with no arrays, and rejects a row that is not one', () => {
    const bare = projectRecord({ drep_id: 'drep_x' });
    expect(bare?.votes).toEqual([]);
    expect(bare?.delegators).toEqual([]);

    expect(projectRecord(null)).toBeNull();
    expect(projectRecord('drep1')).toBeNull();
    expect(projectRecord([record(1)])).toBeNull();
  });
});
