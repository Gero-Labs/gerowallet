// What is pinned here is HONESTY, not layout. Every case below is one where a
// convenient default would state something false about the user or about the
// voters: a missing timestamp rendered as a date, a truncated list read as
// "your DRep did not vote", a head count presented as a tally, or a DRep
// matched by display string so the same credential in another encoding misses.
import { describe, it, expect } from 'vitest';
import {
  committeeNameIndex,
  committeeNameOf,
  filterPositions,
  isCommitteeRow,
  isYourRow,
  orderNoteKey,
  resolveYourPosition,
  sortPositions,
  summarizePositions,
  toPositionRows,
} from './positions';
import type { PositionFilters } from './positions';
import { toCip129 } from '@/shared/utils/drepId';
import type { CommitteeMember, GovVote } from '@/api/governance.types';

const CRED_A = 'aa'.repeat(28);
const CRED_B = 'bb'.repeat(28);
const DREP_A = toCip129(CRED_A) as string;
const DREP_B = toCip129(CRED_B) as string;

function vote(over: Partial<GovVote> = {}): GovVote {
  return {
    voterRole: 'DRep',
    voterHash: CRED_A,
    drepId: DREP_A,
    vote: 'Yes',
    txHash: null,
    ...over,
  };
}

/** Real mainnet credentials: the HOT one a committee vote carries... */
const CC_HOT = '2ea7a78eb914d988b9d368ed88906f3bc9fc5421667dea6a366710ec';
/** ...and the COLD one the committee endpoint lists for a member. Different keys. */
const CC_COLD = '1980dbf1ad624b0cb5410359b5ab14d008561994a6c2b6c53fabec00';

function committeeVote(over: Partial<GovVote> = {}): GovVote {
  return {
    voterRole: 'ConstitutionalCommittee',
    voterHash: CC_HOT,
    drepId: null,
    vote: 'Yes',
    txHash: null,
    voterId: 'cc_hot1qvh20fuwhy2dnz9e6d5wmzysduaunlz5y9n8m6n2xen3pmqqvyw8v',
    ...over,
  };
}

const NO_FILTERS: PositionFilters = { search: '', role: 'all', choice: 'all', rationaleOnly: false };

describe('toPositionRows', () => {
  it('treats every optional field as absent until it is actually present', () => {
    // This is the production shape today: Nexus's projection is not confirmed
    // to carry any of the four extras.
    const [row] = toPositionRows([vote()]);
    expect(row.votedAt).toBeNull();
    expect(row.rationaleUrl).toBeNull();
    expect(row.rationaleHash).toBeNull();
    expect(row.hasScript).toBe(false);
  });

  it('reads the extras through when the projection does carry them', () => {
    const [row] = toPositionRows([
      vote({
        votedAt: 1787463005,
        rationaleUrl: 'https://example.test/why.json',
        rationaleHash: 'ab'.repeat(32),
        hasScript: true,
      }),
    ]);
    expect(row.votedAt).toBe(1787463005);
    expect(row.rationaleUrl).toBe('https://example.test/why.json');
    expect(row.rationaleHash).toBe('ab'.repeat(32));
    expect(row.hasScript).toBe(true);
  });

  it('refuses epoch 0 as a date', () => {
    // A zeroed block time is a missing field, not 1 January 1970.
    expect(toPositionRows([vote({ votedAt: 0 })])[0].votedAt).toBeNull();
  });

  it('carries the anchor through untouched, whatever its scheme', () => {
    // Rationale anchors are author-controlled, so the scheme is theirs to pick.
    // The row does not judge it: the dialog's loader decides what can be
    // fetched (ipfs through the proxy) and `toInAppUrl` refuses the rest.
    const rows = toPositionRows([
      vote({ rationaleUrl: 'javascript:alert(1)' }),
      vote({ rationaleUrl: 'ipfs://QmSomething' }),
      vote({ rationaleUrl: 'https://a.test/why.json' }),
      vote({ rationaleUrl: '   ' }),
      vote(),
    ]);
    expect(rows.map(row => row.hasRationale)).toEqual([true, true, true, false, false]);
    expect(rows.map(row => row.rationaleUrl)).toEqual([
      'javascript:alert(1)',
      'ipfs://QmSomething',
      'https://a.test/why.json',
      null,
      null,
    ]);
  });

  it('treats a blank hash as no hash', () => {
    const rows = toPositionRows([
      vote({ rationaleUrl: 'https://a.test/why.json', rationaleHash: '   ' }),
      vote({ rationaleUrl: 'https://a.test/why.json', rationaleHash: null }),
    ]);
    expect(rows.map(row => row.rationaleHash)).toEqual([null, null]);
  });

  it('only claims a script voter on an explicit true', () => {
    // Unknown is not "not a script": the marker renders in the positive only.
    expect(toPositionRows([vote({ hasScript: null })])[0].hasScript).toBe(false);
    expect(toPositionRows([vote({ hasScript: undefined })])[0].hasScript).toBe(false);
  });

  it('uses the role-agnostic voter id so an SPO is not left showing raw hex', () => {
    const [row] = toPositionRows([
      vote({ voterRole: 'SPO', drepId: null, voterHash: 'ff'.repeat(28), voterId: 'pool1ahazpr2yz5gljk2m4' }),
    ]);
    expect(row.id).toBe('pool1ahazpr2yz5gljk2m4');
    expect(row.isDRep).toBe(false);
    // A pool hash is 56 hex too, so it must never land in the DRep name index.
    expect(row.credentialHex).toBeNull();
  });

  it('keys a DRep row on its credential, whichever id form arrived', () => {
    const bech32 = toPositionRows([vote({ drepId: DREP_A })])[0];
    const hex = toPositionRows([vote({ drepId: CRED_A })])[0];
    expect(bech32.credentialHex).toBe(CRED_A);
    expect(hex.credentialHex).toBe(CRED_A);
  });

  it('keys a committee row separately from a DRep one', () => {
    const [committee, drep, spo] = toPositionRows([
      committeeVote(),
      vote(),
      vote({ voterRole: 'SPO', drepId: null, voterHash: 'ff'.repeat(28) }),
    ]);
    expect(committee.committeeHex).toBe(CC_HOT);
    // The two indexes never share a key: a committee hash must not be able to
    // borrow the name of a DRep whose credential happens to equal it.
    expect(committee.credentialHex).toBeNull();
    expect(drep.committeeHex).toBeNull();
    expect(spo.committeeHex).toBeNull();
  });

  it('refuses a committee hash that is not a credential', () => {
    // `voterHash` is whatever upstream sent. A short, empty or non-hex value is
    // not a key — it must not become one that could collide with a real member.
    expect(toPositionRows([committeeVote({ voterHash: 'not-hex' })])[0].committeeHex).toBeNull();
    expect(toPositionRows([committeeVote({ voterHash: 'ab' })])[0].committeeHex).toBeNull();
    expect(toPositionRows([committeeVote({ voterHash: null })])[0].committeeHex).toBeNull();
  });
});

// Committee members are named from the committee endpoint, and mostly are NOT:
// the endpoint lists cold credentials while a vote carries the hot one, and the
// projection in front of the wallet today sends no `displayName` at all. Every
// case here is about the same rule — a name is rendered when it is known, and
// the hash stands in every other time. Nothing infers one.
describe('committeeNameIndex', () => {
  function member(over: Partial<CommitteeMember> = {}): CommitteeMember {
    return { hash: CC_COLD, credType: 'SCRIPTHASH', startEpoch: 581, expiredEpoch: 726, ...over };
  }

  it('indexes a member that published a name', () => {
    const index = committeeNameIndex([member({ displayName: 'Tingvard' })]);
    expect(index.get(CC_COLD)).toBe('Tingvard');
  });

  it('leaves out a member with no published name', () => {
    // The live projection sends exactly this shape. An indexed empty string
    // would render as a blank name where the hash belongs.
    const index = committeeNameIndex([member(), member({ hash: CC_HOT, displayName: '  ' })]);
    expect(index.size).toBe(0);
  });

  it('resolves a row only against a member that is actually in the committee', () => {
    const index = committeeNameIndex([member({ displayName: 'Tingvard' })]);
    // A committee vote carries the HOT credential, and the committee lists the
    // COLD one — verified on mainnet, where the eight members and the committee
    // rows on a live action overlap on zero hashes. An expired member who voted
    // is legitimately absent from the current set too. Either way the answer is
    // "not known", never the name of whichever member happened to be first.
    const [row] = toPositionRows([committeeVote()]);
    expect(committeeNameOf(row, index)).toBeNull();
  });

  it('matches whatever case either side wrote the hash in', () => {
    const index = committeeNameIndex([member({ hash: CC_HOT.toUpperCase(), displayName: 'Tingvard' })]);
    const [row] = toPositionRows([committeeVote({ voterHash: CC_HOT.toUpperCase() })]);
    expect(committeeNameOf(row, index)).toBe('Tingvard');
  });

  it('names nothing from an absent committee', () => {
    const [row] = toPositionRows([committeeVote()]);
    expect(committeeNameOf(row, committeeNameIndex(null))).toBeNull();
    expect(committeeNameOf(row, null)).toBeNull();
  });

  it('names the member when the projection resolved the cold credential', () => {
    // Gero-Labs/nexus#898: the vote row now carries the member's COLD hash
    // alongside the hot one it was signed with. That is the only value the
    // committee endpoint lists, so it is the only thing this index can match.
    const index = committeeNameIndex([member({ displayName: 'Tingvard' })]);
    const [row] = toPositionRows([committeeVote({ committeeColdHash: CC_COLD })]);

    expect(row.committeeColdHex).toBe(CC_COLD);
    // The hot hash is kept: it is what signed the vote, and a reader may have
    // copied it from another explorer.
    expect(row.committeeHex).toBe(CC_HOT);
    expect(committeeNameOf(row, index)).toBe('Tingvard');
  });

  it('still names nothing when the projection could not resolve one', () => {
    // A hot key with no authorization certificate, a vote predating every known
    // authorization, or an ambiguous tie: nexus omits the field rather than
    // guessing, and the row falls back to its hash exactly as before.
    const index = committeeNameIndex([member({ displayName: 'Tingvard' })]);
    const [row] = toPositionRows([committeeVote()]);

    expect(row.committeeColdHex).toBeNull();
    expect(committeeNameOf(row, index)).toBeNull();
  });

  it('ignores a cold hash that is not a credential', () => {
    const index = committeeNameIndex([member({ displayName: 'Tingvard' })]);
    for (const bad of ['not-hex', 'ab', '', null]) {
      const [row] = toPositionRows([committeeVote({ committeeColdHash: bad as string | null })]);
      expect(row.committeeColdHex, String(bad)).toBeNull();
      expect(committeeNameOf(row, index), String(bad)).toBeNull();
    }
  });

  it('carries a cold hash only for committee rows', () => {
    // A DRep row that happened to carry the field must not gain a committee
    // identity from it.
    const [drep] = toPositionRows([vote({ drepId: DREP_A, committeeColdHash: CC_COLD })]);
    expect(drep.committeeColdHex).toBeNull();
    expect(drep.committeeHex).toBeNull();
  });

  it('is a committee row by ROLE, not by which hashes happened to parse', () => {
    // The lookup's gate. Reading it off `committeeHex` instead would skip the
    // committee index entirely for a row whose hot credential arrived in a form
    // `toCredentialHex` rejects — with a cold hash resolved and the name sitting
    // right there in the index.
    const [resolved] = toPositionRows([
      committeeVote({ voterHash: 'cc_hot1notrawhex', committeeColdHash: CC_COLD }),
    ]);
    expect(resolved.committeeHex).toBeNull();
    expect(resolved.committeeColdHex).toBe(CC_COLD);
    expect(isCommitteeRow(resolved)).toBe(true);
    expect(committeeNameOf(resolved, committeeNameIndex([member({ displayName: 'Tingvard' })]))).toBe(
      'Tingvard',
    );

    // And a DRep row is never one, whatever it carries.
    const [drep] = toPositionRows([vote({ drepId: DREP_A })]);
    expect(isCommitteeRow(drep)).toBe(false);
  });

  it('never names a row of another body', () => {
    // Same 28 bytes, different body: an SPO or a DRep whose hash equals a
    // member's must not inherit that member's name.
    const index = committeeNameIndex([{ hash: CRED_A, credType: null, startEpoch: null, expiredEpoch: null, displayName: 'Tingvard' }]);
    const [drep] = toPositionRows([vote({ drepId: DREP_A, voterHash: CRED_A })]);
    expect(committeeNameOf(drep, index)).toBeNull();
  });
});

describe('summarizePositions', () => {
  it('counts voters, one per row, and never produces a percentage', () => {
    const summary = summarizePositions(
      toPositionRows([
        vote({ vote: 'Yes' }),
        vote({ vote: 'Yes' }),
        vote({ vote: 'No' }),
        vote({ vote: 'Abstain' }),
      ]),
    );
    expect(summary).toMatchObject({ total: 4, yes: 2, no: 1, abstain: 1 });
    // Head counts are not the tally; nothing here may be mistaken for one.
    expect(Object.keys(summary)).not.toContain('yesPct');
  });

  it('omits a body with no rows rather than reporting it as zero', () => {
    // SPOs cannot vote on a treasury withdrawal at all. "SPOs 0" would misread
    // ineligibility as abstention.
    const summary = summarizePositions(
      toPositionRows([vote(), vote({ voterRole: 'ConstitutionalCommittee', drepId: null })]),
    );
    expect(summary.byRole.map(entry => entry.role)).toEqual(['DRep', 'ConstitutionalCommittee']);
  });

  it('counts rationales and reports whether ordering by date is even possible', () => {
    const none = summarizePositions(toPositionRows([vote(), vote()]));
    expect(none.withRationale).toBe(0);
    expect(none.anyVotedAt).toBe(false);

    const some = summarizePositions(
      toPositionRows([vote({ rationaleUrl: 'https://a.test/x', votedAt: 100 }), vote()]),
    );
    expect(some.withRationale).toBe(1);
    expect(some.anyVotedAt).toBe(true);
  });

  it('counts every published rationale, ipfs included', () => {
    // The head count is about the voters, not about what this wallet can open.
    const summary = summarizePositions(
      toPositionRows([
        vote({ rationaleUrl: 'ipfs://QmSomething' }),
        vote({ drepId: DREP_B, rationaleUrl: 'https://a.test/why.json' }),
        vote({ voterRole: 'SPO', drepId: null, voterHash: 'cc'.repeat(28) }),
      ]),
    );
    expect(summary.withRationale).toBe(2);
  });

  it('reports a list that mixes dated and undated rows', () => {
    // "Newest first" needs a caveat exactly here, and nowhere else.
    const mixed = summarizePositions(toPositionRows([vote({ votedAt: 100 }), vote({ drepId: DREP_B })]));
    expect(mixed).toMatchObject({ anyVotedAt: true, anyMissingVotedAt: true });

    const dated = summarizePositions(toPositionRows([vote({ votedAt: 100 })]));
    expect(dated).toMatchObject({ anyVotedAt: true, anyMissingVotedAt: false });

    const undated = summarizePositions(toPositionRows([vote()]));
    expect(undated).toMatchObject({ anyVotedAt: false, anyMissingVotedAt: true });
  });
});

describe('sortPositions', () => {
  it('orders by when the position was cast, newest first by default', () => {
    const rows = toPositionRows([
      vote({ votedAt: 100, drepId: DREP_A }),
      vote({ votedAt: 300, drepId: DREP_B }),
      vote({ votedAt: 200, drepId: null, voterHash: 'cc'.repeat(28) }),
    ]);
    expect(sortPositions(rows, 'newest').map(r => r.votedAt)).toEqual([300, 200, 100]);
    expect(sortPositions(rows, 'oldest').map(r => r.votedAt)).toEqual([100, 200, 300]);
  });

  it('parks undated rows at the end rather than interleaving them by guess', () => {
    const rows = toPositionRows([
      vote({ drepId: DREP_A }),
      vote({ votedAt: 300, drepId: DREP_B }),
      vote({ votedAt: 100, drepId: null, voterHash: 'cc'.repeat(28) }),
    ]);
    expect(sortPositions(rows, 'newest').map(r => r.votedAt)).toEqual([300, 100, null]);
    // Even reversed, the unknowns stay last: they are not "the oldest".
    expect(sortPositions(rows, 'oldest').map(r => r.votedAt)).toEqual([100, 300, null]);
  });

  it('does not mutate the input', () => {
    const rows = toPositionRows([vote({ votedAt: 100 }), vote({ votedAt: 300 })]);
    sortPositions(rows, 'newest');
    expect(rows.map(r => r.votedAt)).toEqual([100, 300]);
  });
});

describe('orderNoteKey', () => {
  it('describes the ordering in force, not the default one', () => {
    // The footnote asserted "newest first" while the reader had chosen oldest
    // first — a statement about the list that the list contradicted on screen.
    const dated = { anyVotedAt: true };
    expect(orderNoteKey('newest', dated)).toBe('governance.positionsOrderNewest');
    expect(orderNoteKey('oldest', dated)).toBe('governance.positionsOrderOldest');
  });

  it('claims no time ordering when nothing carries a time', () => {
    // With no block times the sort falls back to body and id, so neither
    // direction is a true description of the list.
    const undated = { anyVotedAt: false };
    expect(orderNoteKey('newest', undated)).toBe('governance.positionsOrderUntimed');
    expect(orderNoteKey('oldest', undated)).toBe('governance.positionsOrderUntimed');
  });
});

describe('filterPositions', () => {
  const rows = toPositionRows([
    vote({ voterRole: 'DRep', drepId: DREP_A, vote: 'Yes', rationaleUrl: 'https://a.test/x' }),
    vote({ voterRole: 'SPO', drepId: null, voterHash: 'cc'.repeat(28), voterId: 'pool1abc', vote: 'No' }),
    vote({ voterRole: 'ConstitutionalCommittee', drepId: null, voterHash: 'dd'.repeat(28), vote: 'Abstain' }),
  ]);

  it('filters by body and by choice independently', () => {
    expect(filterPositions(rows, { ...NO_FILTERS, role: 'SPO' })).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, choice: 'Abstain' })).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, role: 'SPO', choice: 'Yes' })).toHaveLength(0);
  });

  it('filters to rows that published a rationale', () => {
    expect(filterPositions(rows, { ...NO_FILTERS, rationaleOnly: true })).toHaveLength(1);
  });

  it('keeps an ipfs:// rationale in the filter it belongs to', () => {
    // The filter asks "who explained their vote", not "whose explanation opens
    // in this browser". Filtering on the href hid every IPFS-hosted rationale.
    const withIpfs = toPositionRows([
      vote({ drepId: DREP_A, rationaleUrl: 'https://a.test/x' }),
      vote({ drepId: DREP_B, rationaleUrl: 'ipfs://QmSomething' }),
      vote({ voterRole: 'SPO', drepId: null, voterHash: 'cc'.repeat(28) }),
    ]);
    expect(filterPositions(withIpfs, { ...NO_FILTERS, rationaleOnly: true })).toHaveLength(2);
  });

  it('searches the resolved name as well as every id form', () => {
    const nameOf = (row: { credentialHex: string | null }) =>
      row.credentialHex === 'aa'.repeat(28) ? 'CryptoCrow' : null;
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'cryptocrow' }, nameOf)).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'pool1abc' })).toHaveLength(1);
    // The raw credential is searchable even when the row displays bech32.
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'aaaaaa' })).toHaveLength(1);
    expect(filterPositions(rows, { ...NO_FILTERS, search: 'nothing here' })).toHaveLength(0);
  });
});

describe('isYourRow / resolveYourPosition', () => {
  it('matches the credential, not the display string', () => {
    // The wallet holds one id form and the vote row may carry another; a string
    // compare would report "has not voted" about a vote that is right there.
    const [row] = toPositionRows([vote({ drepId: DREP_A })]);
    expect(isYourRow(row, { drepId: CRED_A, kind: 'delegated' })).toBe(true);
    expect(isYourRow(row, { drepId: DREP_B, kind: 'delegated' })).toBe(false);
  });

  it('never matches an SPO or committee row, whose drepId is null', () => {
    const [row] = toPositionRows([vote({ voterRole: 'SPO', drepId: null, voterHash: CRED_A })]);
    expect(isYourRow(row, { drepId: DREP_A, kind: 'delegated' })).toBe(false);
  });

  it('says nothing at all when the wallet has no voting identity', () => {
    expect(resolveYourPosition(toPositionRows([vote()]), null, true)).toEqual({ kind: 'none' });
  });

  it('does not call an unread delegation "you have not delegated"', () => {
    // Both states arrive as a null identity, and only one of them is a fact
    // about the user. Collapsing them puts a false statement on screen for as
    // long as the account takes to load.
    const rows = toPositionRows([vote()]);
    expect(resolveYourPosition(rows, null, true, true)).toEqual({ kind: 'identityUnknown' });
    expect(resolveYourPosition(rows, null, true, false)).toEqual({ kind: 'none' });
  });

  it('ignores the unknown flag once an identity is actually in hand', () => {
    const rows = toPositionRows([vote({ drepId: DREP_A })]);
    expect(resolveYourPosition(rows, { drepId: CRED_A, kind: 'delegated' }, true, true).kind).toBe('voted');
  });

  it('reports the vote when the delegated DRep is on the list', () => {
    const rows = toPositionRows([vote({ drepId: DREP_B, vote: 'No' }), vote({ drepId: DREP_A, vote: 'Yes' })]);
    const result = resolveYourPosition(rows, { drepId: CRED_A, kind: 'delegated' }, true);
    expect(result.kind).toBe('voted');
    if (result.kind === 'voted') {
      expect(result.row.vote).toBe('Yes');
      expect(result.who).toBe('delegated');
    }
  });

  it('distinguishes voting as yourself from voting through a DRep', () => {
    const rows = toPositionRows([vote({ drepId: DREP_A })]);
    // Matched on the whole result: `.who` does not exist on every branch of the
    // union, and reading it off the union is a type error.
    expect(resolveYourPosition(rows, { drepId: DREP_A, kind: 'self' }, true)).toMatchObject({
      kind: 'voted',
      who: 'self',
    });
  });

  it('claims "has not voted" only from a COMPLETE list', () => {
    const rows = toPositionRows([vote({ drepId: DREP_B })]);
    const identity = { drepId: DREP_A, kind: 'delegated' as const };
    expect(resolveYourPosition(rows, identity, true)).toEqual({ kind: 'notVoted', who: 'delegated' });
    // Truncated: absence from the loaded prefix proves nothing about the vote.
    expect(resolveYourPosition(rows, identity, false)).toEqual({ kind: 'unknown', who: 'delegated' });
  });

  it('treats a keyword delegation as a standing position, not a missing vote', () => {
    // Always-abstain casts no vote row at all, so "has not voted" would be a
    // misleading way to describe a choice the user deliberately made.
    for (const keyword of ['drep_always_abstain', 'drep_always_no_confidence']) {
      const result = resolveYourPosition(toPositionRows([vote()]), { drepId: keyword, kind: 'delegated' }, true);
      expect(result).toEqual({ kind: 'keyword', who: 'delegated' });
    }
  });
});
