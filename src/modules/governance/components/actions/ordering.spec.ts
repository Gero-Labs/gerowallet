// The list's reading order. Two rules, and one thing that must NOT happen:
// live actions lead, soonest to expire first; concluded actions follow, newest
// first; and an unknown epoch never sorts as though it were imminent, because
// "we were not told when this expires" is not "this expires next".
import { describe, it, expect } from 'vitest';
import { orderActions } from './ordering';
import type { GovProposal } from '@/api/governance.types';

function action(over: Partial<GovProposal> & { govActionId: string }): GovProposal {
  return {
    govActionIdCip129: over.govActionId,
    txHash: 'aa'.repeat(32),
    index: 0,
    slot: null,
    type: 'InfoAction',
    status: 'active',
    deposit: null,
    returnAddress: null,
    anchorUrl: null,
    anchorHash: null,
    title: null,
    submittedEpoch: null,
    expiresEpoch: null,
    ...over,
  } as GovProposal;
}

const ids = (rows: GovProposal[]): string[] => rows.map(row => row.govActionId);

describe('orderActions', () => {
  it('puts every live action above every concluded one', () => {
    const rows = orderActions([
      action({ govActionId: 'enacted', status: 'enacted', submittedEpoch: 655 }),
      action({ govActionId: 'live', status: 'active', expiresEpoch: 700 }),
      action({ govActionId: 'expired', status: 'expired', submittedEpoch: 640 }),
    ]);

    expect(ids(rows)).toEqual(['live', 'enacted', 'expired']);
  });

  it('orders the live group by soonest expiry first', () => {
    const rows = orderActions([
      action({ govActionId: 'later', expiresEpoch: 680 }),
      action({ govActionId: 'soonest', expiresEpoch: 652 }),
      action({ govActionId: 'middle', expiresEpoch: 661 }),
    ]);

    expect(ids(rows)).toEqual(['soonest', 'middle', 'later']);
  });

  it('parks a live action with an unknown expiry last, not first', () => {
    // A null expiry read as 0 would put an action we know nothing about at the
    // very top of a board whose whole point is "this one closes next".
    const rows = orderActions([
      action({ govActionId: 'unknown', expiresEpoch: null }),
      action({ govActionId: 'soonest', expiresEpoch: 652 }),
    ]);

    expect(ids(rows)).toEqual(['soonest', 'unknown']);
  });

  it('orders the concluded group newest first, by submission', () => {
    const rows = orderActions([
      action({ govActionId: 'oldest', status: 'ratified', submittedEpoch: 600 }),
      action({ govActionId: 'newest', status: 'enacted', submittedEpoch: 649 }),
      action({ govActionId: 'middle', status: 'dropped', submittedEpoch: 620 }),
    ]);

    expect(ids(rows)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('breaks a shared submission epoch on slot, newest first', () => {
    // Many actions land in the same epoch, so the epoch alone leaves the order
    // to chance wherever upstream carries something finer.
    const rows = orderActions([
      action({ govActionId: 'earlier-slot', status: 'enacted', submittedEpoch: 640, slot: 10 }),
      action({ govActionId: 'later-slot', status: 'enacted', submittedEpoch: 640, slot: 99 }),
    ]);

    expect(ids(rows)).toEqual(['later-slot', 'earlier-slot']);
  });

  it('parks a concluded action with no submission epoch last', () => {
    const rows = orderActions([
      action({ govActionId: 'undated', status: 'expired', submittedEpoch: null }),
      action({ govActionId: 'dated', status: 'expired', submittedEpoch: 610 }),
    ]);

    expect(ids(rows)).toEqual(['dated', 'undated']);
  });

  it('keeps the server order for rows it cannot tell apart', () => {
    // A stable sort, so two equally-unknown rows do not swap between renders.
    const rows = orderActions([
      action({ govActionId: 'first' }),
      action({ govActionId: 'second' }),
      action({ govActionId: 'third' }),
    ]);

    expect(ids(rows)).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the array it was handed', () => {
    // It orders a store's own array; sorting in place would reorder state.
    const input = [
      action({ govActionId: 'later', expiresEpoch: 680 }),
      action({ govActionId: 'soonest', expiresEpoch: 652 }),
    ];
    orderActions(input);

    expect(ids(input)).toEqual(['later', 'soonest']);
  });

  it('treats an unrecognised status as concluded rather than dropping the row', () => {
    // A status Nexus adds later must still render, just below the live ones.
    const rows = orderActions([
      action({ govActionId: 'novel', status: 'something-new', submittedEpoch: 659 }),
      action({ govActionId: 'live', expiresEpoch: 700 }),
    ]);

    expect(ids(rows)).toEqual(['live', 'novel']);
  });
});
