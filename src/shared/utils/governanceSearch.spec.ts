import { describe, it, expect } from 'vitest';
import {
  actionStatusLabel,
  actionTypeLabel,
  drepResults,
  governanceActionResults,
  governancePageResults,
  MIN_ID_FRAGMENT,
  type DRepSearchRow,
} from '@/shared/utils/governanceSearch';
import type { GovProposal } from '@/api/governance.types';

/**
 * Stand-in translator. Returns the key, which is exactly what `useTranslation`
 * does for a missing key, so it also exercises the "fall back to the raw
 * upstream value" branch of the type/status labels.
 */
const echoT = (key: string) => key;

/** Translator with a small dictionary, for the cases where the copy matters. */
function dictT(entries: Record<string, string>) {
  return (key: string) => entries[key] ?? key;
}

const TX_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

function proposal(overrides: Partial<GovProposal> = {}): GovProposal {
  return {
    govActionId: `${TX_HASH}#0`,
    govActionIdCip129: 'gov_action1abcdefghij',
    txHash: TX_HASH,
    index: 0,
    slot: null,
    type: 'InfoAction',
    status: 'active',
    deposit: null,
    returnAddress: null,
    anchorUrl: null,
    anchorHash: null,
    title: 'Reimburse Ikigai Info Governance Action Deposit.',
    submittedEpoch: null,
    expiresEpoch: null,
    ...overrides,
  };
}

function drepRow(overrides: Partial<DRepSearchRow> = {}): DRepSearchRow {
  return {
    drep_id: 'drep1qwertyuiopasdfghjklzxcvbnm0011223344556677',
    metadata: { meta_json: { body: { givenName: 'Ikigai Collective' } } },
    amount: '1500000000000',
    ...overrides,
  };
}

describe('governanceActionResults', () => {
  it('surfaces the product owner acceptance case by title prefix', () => {
    const results = governanceActionResults([proposal()], 'Reimburse Ikigai', { t: echoT });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Reimburse Ikigai Info Governance Action Deposit.');
    expect(results[0].type).toBe('govAction');
    // Prefix match, not a mid-string one.
    expect(results[0]._score).toBe(80);
  });

  it('routes to the action detail route, split into txHash and index segments', () => {
    const results = governanceActionResults([proposal({ govActionId: `${TX_HASH}#7`, index: 7 })], 'reimburse', {
      t: echoT,
    });

    expect(results[0].route).toBe(`/governance/actions/${TX_HASH}/7`);
  });

  it('reads the type and status into the subtitle', () => {
    const t = dictT({
      'governance.actionType.infoaction': 'Info Action',
      'governance.status.active': 'Active',
    });
    const results = governanceActionResults([proposal()], 'ikigai', { t });

    expect(results[0].subtitle).toBe('Info Action · Active');
  });

  it('falls back to the raw upstream type and status when neither is translated', () => {
    const results = governanceActionResults([proposal({ type: 'BrandNewThing', status: 'weird' })], 'ikigai', {
      t: echoT,
    });

    expect(results[0].subtitle).toBe('BrandNewThing · weird');
  });

  it('matches a gov_action id fragment once the query is long enough', () => {
    const rows = [proposal({ govActionIdCip129: 'gov_action1xyzzyplugh' })];
    const fragment = 'gov_action1xyz';
    expect(fragment.length).toBeGreaterThanOrEqual(MIN_ID_FRAGMENT);

    expect(governanceActionResults(rows, fragment, { t: echoT })).toHaveLength(1);
  });

  it('matches a transaction-hash fragment', () => {
    const results = governanceActionResults([proposal({ title: null })], TX_HASH.slice(0, 16), { t: echoT });

    expect(results).toHaveLength(1);
    // No anchor title, so the id stands in for one.
    expect(results[0].title).toBe(`${TX_HASH.slice(0, 12)}...#0`);
  });

  it('does not match id fragments shorter than the threshold', () => {
    const short = 'aaaa';
    expect(short.length).toBeLessThan(MIN_ID_FRAGMENT);

    expect(governanceActionResults([proposal({ title: null })], short, { t: echoT })).toEqual([]);
  });

  it('skips an action whose id cannot be parsed, since it has no reachable route', () => {
    const broken = proposal({ govActionId: 'not-an-id', govActionIdCip129: 'also-not-an-id' });

    expect(governanceActionResults([broken], 'reimburse', { t: echoT })).toEqual([]);
  });

  it('ranks an exact title above a substring hit and caps the list at five', () => {
    const rows: GovProposal[] = [
      proposal({ govActionId: `${OTHER_HASH}#1`, txHash: OTHER_HASH, index: 1, title: 'About treasury spending' }),
      proposal({ title: 'Treasury' }),
    ];
    const results = governanceActionResults(rows, 'treasury', { t: echoT });

    expect(results.map(r => r.title)).toEqual(['Treasury', 'About treasury spending']);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('is empty for an empty query or an empty list', () => {
    expect(governanceActionResults([proposal()], '   ', { t: echoT })).toEqual([]);
    expect(governanceActionResults([], 'ikigai', { t: echoT })).toEqual([]);
    expect(governanceActionResults(null, 'ikigai', { t: echoT })).toEqual([]);
  });
});

describe('drepResults', () => {
  it('matches a DRep by its published CIP-119 name', () => {
    const results = drepResults([drepRow()], 'ikigai', { t: echoT });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Ikigai Collective');
    expect(results[0].type).toBe('drep');
  });

  it('routes to the DRep profile route, not the directory deep link', () => {
    const results = drepResults([drepRow()], 'ikigai', { t: echoT });

    expect(results[0].route).toBe('/governance/dreps/drep1qwertyuiopasdfghjklzxcvbnm0011223344556677');
  });

  it('matches a drep1 id prefix once the query is long enough', () => {
    const results = drepResults([drepRow({ metadata: null })], 'drep1qwerty', { t: echoT });

    expect(results).toHaveLength(1);
    // No name published, so the truncated id is the title.
    expect(results[0].title).toBe('drep1qwertyuiopasdfg...');
  });

  it('does not match id fragments shorter than the threshold', () => {
    expect(drepResults([drepRow({ metadata: null })], 'dre', { t: echoT })).toEqual([]);
  });

  it('falls back to a bare name field when there is no CIP-119 metadata', () => {
    const results = drepResults([drepRow({ metadata: null, name: 'Ikigai' })], 'ikigai', { t: echoT });

    expect(results[0].title).toBe('Ikigai');
  });

  it('puts the voting power in the subtitle when the row carries an amount', () => {
    const t = dictT({ 'search.dreps': 'DReps', 'governance.votingPower': 'Voting Power' });
    const results = drepResults([drepRow()], 'ikigai', { t, currencySymbol: '₳' });

    expect(results[0].subtitle).toBe('DReps · Voting Power 1.50M ₳');
  });

  it('omits the voting power rather than printing zero when the amount is absent', () => {
    const t = dictT({ 'search.dreps': 'DReps' });

    expect(drepResults([drepRow({ amount: null })], 'ikigai', { t })[0].subtitle).toBe('DReps');
    expect(drepResults([drepRow({ amount: '0' })], 'ikigai', { t })[0].subtitle).toBe('DReps');
  });

  it('skips a row with no drep id', () => {
    expect(drepResults([drepRow({ drep_id: null })], 'ikigai', { t: echoT })).toEqual([]);
  });

  it('is empty for an empty query or an empty list', () => {
    expect(drepResults([drepRow()], '  ', { t: echoT })).toEqual([]);
    expect(drepResults(undefined, 'ikigai', { t: echoT })).toEqual([]);
  });
});

describe('governancePageResults', () => {
  const t = dictT({
    'navigation.governance': 'Governance',
    'navigation.governanceMe': 'My governance',
    'governance.dReps': 'DReps',
    'governance.actionsTitle': 'Governance Actions',
    'navigation.becomeDRep': 'Become a DRep',
  });

  it('finds a page by its translated title', () => {
    const results = governancePageResults('my governance', { t, votingEnabled: true });

    expect(results[0].title).toBe('My governance');
    expect(results[0].route).toBe('/governance/me');
    expect(results[0].type).toBe('page');
    expect(results[0].subtitle).toBe('Governance');
  });

  it('finds a page by an indexed keyword the title does not contain', () => {
    const routes = governancePageResults('proposals', { t, votingEnabled: true }).map(r => r.route);

    expect(routes).toContain('/governance/actions');
  });

  it('hides Become a DRep when the voting sub-flag is off', () => {
    const withVoting = governancePageResults('become a drep', { t, votingEnabled: true });
    const withoutVoting = governancePageResults('become a drep', { t, votingEnabled: false });

    expect(withVoting.map(r => r.route)).toContain('/governance/register');
    expect(withoutVoting.map(r => r.route)).not.toContain('/governance/register');
  });

  it('still lists the read-only pages when voting is off', () => {
    const routes = governancePageResults('governance', { t, votingEnabled: false }).map(r => r.route);

    expect(routes).toContain('/governance/me');
  });

  it('gives every page a stable, distinct id', () => {
    const ids = governancePageResults('drep', { t, votingEnabled: true }).map(r => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => id.startsWith('page-/governance/'))).toBe(true);
  });

  it('is empty for an empty query and for a query nothing indexes', () => {
    expect(governancePageResults('   ', { t, votingEnabled: true })).toEqual([]);
    expect(governancePageResults('zzzzzzz', { t, votingEnabled: true })).toEqual([]);
  });
});

describe('actionTypeLabel / actionStatusLabel', () => {
  it('translate a known value and pass an unknown one through', () => {
    const t = dictT({ 'governance.actionType.treasurywithdrawals': 'Treasury Withdrawals' });

    expect(actionTypeLabel('TreasuryWithdrawals', t)).toBe('Treasury Withdrawals');
    expect(actionTypeLabel('SomethingNew', t)).toBe('SomethingNew');
  });

  it('are empty for a missing value', () => {
    expect(actionTypeLabel(null, echoT)).toBe('');
    expect(actionStatusLabel(undefined, echoT)).toBe('');
  });
});
