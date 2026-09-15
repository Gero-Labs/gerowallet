import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import {
  delegationHealth,
  useDelegationHealth,
  DEFAULT_DREP_ACTIVITY_EPOCHS,
  DEFAULT_EPOCH_LENGTH_SEC,
  DEFAULT_WARN_EPOCHS_LEFT,
  DEFAULT_RATIONALE_WINDOW,
  type DelegatedDRepRecord,
  type DRepVoteRecord,
} from '@/shared/composables/useDelegationHealth';

const EPOCH = 653;

/** Build a vote at `blockTime`, with or without a rationale anchor. */
function vote(blockTime: number, metaUrl: string | null = null): DRepVoteRecord {
  return {
    proposal_id: `proposal-${blockTime}`,
    vote: 'Yes',
    block_time: blockTime,
    meta_url: metaUrl,
  };
}

/** N votes, newest first in block_time, `withRationale` of them anchored. */
function votes(n: number, withRationale: number): DRepVoteRecord[] {
  return Array.from({ length: n }, (_, i) => vote(1_000 - i, i < withRationale ? `https://rationale/${i}` : null));
}

function record(overrides: Partial<DelegatedDRepRecord> = {}): DelegatedDRepRecord {
  return {
    drep_id: 'drep1yfrr09kj5wtz8f2yr602k9v5ctfpl9kj54z0f8uzhsprhlcw09j6x',
    registered: true,
    active: true,
    expires_epoch_no: EPOCH + 10,
    votes: [],
    ...overrides,
  };
}

describe('delegationHealth — epoch arithmetic', () => {
  it('epochsLeft is expires_epoch_no minus the current epoch', () => {
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 7 }), { currentEpoch: EPOCH });
    expect(health.epochsLeft).toBe(7);
  });

  it('windowUsed is the activity window minus the epochs left', () => {
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 5 }), { currentEpoch: EPOCH });
    expect(health.activityWindow).toBe(DEFAULT_DREP_ACTIVITY_EPOCHS);
    expect(health.windowUsed).toBe(15);
  });

  it('a missing expires_epoch_no yields a null epochsLeft and raises no warning', () => {
    const health = delegationHealth(record({ expires_epoch_no: null }), { currentEpoch: EPOCH });
    expect(health.epochsLeft).toBeNull();
    expect(health.windowUsed).toBeNull();
    expect(health.inactiveSoon).toBe(false);
    expect(health.expired).toBe(false);
    expect(health.expiryStale).toBe(false);
  });

  it('an unknown current epoch yields a null epochsLeft and raises no warning', () => {
    const health = delegationHealth(record(), { currentEpoch: null });
    expect(health.epochsLeft).toBeNull();
    expect(health.inactiveSoon).toBe(false);
  });

  it('clamps a past expiry to zero epochs left and reports it expired when no active flag arbitrates', () => {
    const health = delegationHealth(record({ active: null, expires_epoch_no: EPOCH - 3 }), {
      currentEpoch: EPOCH,
    });
    expect(health.epochsLeft).toBe(0);
    expect(health.windowUsed).toBe(DEFAULT_DREP_ACTIVITY_EPOCHS);
    expect(health.expired).toBe(true);
    expect(health.inactiveSoon).toBe(true);
    expect(health.expiryStale).toBe(false);
  });

  it('takes the activity window from the supplied drep_activity when present', () => {
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 4 }), {
      currentEpoch: EPOCH,
      activityWindow: 30,
    });
    expect(health.activityWindow).toBe(30);
    expect(health.windowUsed).toBe(26);
  });

  it('falls back to a 20-epoch window when drep_activity is absent', () => {
    expect(delegationHealth(record(), { currentEpoch: EPOCH, activityWindow: null }).activityWindow).toBe(20);
    expect(DEFAULT_DREP_ACTIVITY_EPOCHS).toBe(20);
  });
});

describe('delegationHealth — the inactivity warning boundary', () => {
  it('does not warn at 6 epochs left (14 of 20 elapsed)', () => {
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 6 }), { currentEpoch: EPOCH });
    expect(health.windowUsed).toBe(14);
    expect(health.inactiveSoon).toBe(false);
  });

  it('warns exactly at 5 epochs left — the 15 of 20 boundary the alerts surface names', () => {
    // record() carries active: true. A COHERENT low countdown warns anyway:
    // that is the legitimate early warning, not a contradiction.
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 5 }), { currentEpoch: EPOCH });
    expect(health.epochsLeft).toBe(5);
    expect(health.windowUsed).toBe(15);
    expect(health.inactiveSoon).toBe(true);
    expect(health.expired).toBe(false);
    expect(health.expiryStale).toBe(false);
  });

  it('is still warning, not yet expired, at 1 epoch left (19 of 20)', () => {
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 1 }), { currentEpoch: EPOCH });
    expect(health.windowUsed).toBe(19);
    expect(health.inactiveSoon).toBe(true);
    expect(health.expired).toBe(false);
  });

  it('the expiry epoch itself still counts: 0 left is the final warning, not exclusion', () => {
    // Conway RATIFY excludes a DRep only when currentEpoch > expiry, so the
    // expiry epoch is the last ACTIVE epoch and must never claim exclusion.
    const health = delegationHealth(record({ active: null, expires_epoch_no: EPOCH }), {
      currentEpoch: EPOCH,
    });
    expect(health.epochsLeft).toBe(0);
    expect(health.windowUsed).toBe(20);
    expect(health.expired).toBe(false);
    expect(health.inactiveSoon).toBe(true);
  });

  it('is expired one epoch past the expiry when no active flag arbitrates', () => {
    const health = delegationHealth(record({ active: null, expires_epoch_no: EPOCH - 1 }), {
      currentEpoch: EPOCH,
    });
    expect(health.expired).toBe(true);
    expect(health.inactiveSoon).toBe(true);
  });

  it('the warning threshold is a parameter, not a constant', () => {
    const eightLeft = record({ expires_epoch_no: EPOCH + 8 });
    expect(delegationHealth(eightLeft, { currentEpoch: EPOCH }).inactiveSoon).toBe(false);
    expect(delegationHealth(eightLeft, { currentEpoch: EPOCH, warnAt: 10 }).inactiveSoon).toBe(true);
    expect(delegationHealth(eightLeft, { currentEpoch: EPOCH, warnAt: 10 }).warnAt).toBe(10);
    expect(DEFAULT_WARN_EPOCHS_LEFT).toBe(5);
  });

  it('reports the epoch the warning fires at so a snooze can be offered against it', () => {
    expect(delegationHealth(record(), { currentEpoch: EPOCH }).warnAt).toBe(DEFAULT_WARN_EPOCHS_LEFT);
  });

  it('an explicitly inactive DRep warns even without an expiry epoch', () => {
    const health = delegationHealth(record({ active: false, expires_epoch_no: null }), { currentEpoch: EPOCH });
    expect(health.epochsLeft).toBeNull();
    expect(health.expired).toBe(true);
    expect(health.inactiveSoon).toBe(true);
  });

  it('a retired DRep does not also raise the going-inactive warning', () => {
    const health = delegationHealth(record({ registered: false, expires_epoch_no: EPOCH + 1 }), {
      currentEpoch: EPOCH,
    });
    expect(health.retired).toBe(true);
    expect(health.inactiveSoon).toBe(false);
  });
});

describe('delegationHealth — the trust hierarchy', () => {
  // The Cardano Foundation false positive: mainnet epoch 651, indexed record
  // said active: true beside expires_epoch_no 629. The expiry is provably
  // stale (Conway dormancy credit is only folded in on the next proposal), so
  // the explicit active flag must win and the countdown must be withheld.
  it('active: true vetoes a past expiry — the expiry is stale, not the DRep', () => {
    const health = delegationHealth(record({ active: true, expires_epoch_no: EPOCH - 22 }), {
      currentEpoch: EPOCH,
    });
    expect(health.expired).toBe(false);
    expect(health.inactiveSoon).toBe(false);
    expect(health.expiryStale).toBe(true);
    expect(health.epochsLeft).toBeNull();
    expect(health.windowUsed).toBeNull();
  });

  it('active: true at the exact expiry epoch is coherent: the final-epoch warning, not a contradiction', () => {
    const health = delegationHealth(record({ active: true, expires_epoch_no: EPOCH }), {
      currentEpoch: EPOCH,
    });
    expect(health.expired).toBe(false);
    expect(health.expiryStale).toBe(false);
    expect(health.epochsLeft).toBe(0);
    expect(health.inactiveSoon).toBe(true);
  });

  it('an explicit active: false still means expired, and a future countdown beside it is discarded', () => {
    // Whichever field is right, "window has run out" cannot render beside
    // "8 epochs left" — the flag is trusted, the countdown withheld.
    const health = delegationHealth(record({ active: false, expires_epoch_no: EPOCH + 8 }), {
      currentEpoch: EPOCH,
    });
    expect(health.expired).toBe(true);
    expect(health.inactiveSoon).toBe(true);
    expect(health.expiryStale).toBe(true);
    expect(health.epochsLeft).toBeNull();
  });

  it('a coherent future expiry beside active: true stays a normal countdown', () => {
    const health = delegationHealth(record({ active: true, expires_epoch_no: EPOCH + 12 }), {
      currentEpoch: EPOCH,
    });
    expect(health.epochsLeft).toBe(12);
    expect(health.expiryStale).toBe(false);
  });

  it('with no active flag, a vote younger than the window vetoes an elapsed expiry when nowSec is given', () => {
    const nowSec = 1_800_000_000;
    // Voted 5 epochs ago: a vote resets the whole 20-epoch window, and
    // dormancy only ever ADDS credit, so this expiry cannot be current.
    const recent = vote(nowSec - 5 * DEFAULT_EPOCH_LENGTH_SEC);
    const health = delegationHealth(
      record({ active: undefined, expires_epoch_no: EPOCH - 2, votes: [recent] }),
      { currentEpoch: EPOCH, nowSec },
    );
    expect(health.expired).toBe(false);
    expect(health.inactiveSoon).toBe(false);
    expect(health.expiryStale).toBe(true);
    expect(health.epochsLeft).toBeNull();
    expect(health.lastVoteAt).toBe(recent.block_time);
  });

  it('without nowSec the veto is skipped and the arithmetic verdict stands — purity keeps the clock out', () => {
    const recent = vote(1_800_000_000 - 5 * DEFAULT_EPOCH_LENGTH_SEC);
    const health = delegationHealth(
      record({ active: undefined, expires_epoch_no: EPOCH - 2, votes: [recent] }),
      { currentEpoch: EPOCH },
    );
    expect(health.expired).toBe(true);
    expect(health.expiryStale).toBe(false);
  });

  it('a vote older than the window does not veto: the expiry verdict stands', () => {
    const nowSec = 1_800_000_000;
    const old = vote(nowSec - 25 * DEFAULT_EPOCH_LENGTH_SEC);
    const health = delegationHealth(
      record({ active: undefined, expires_epoch_no: EPOCH - 2, votes: [old] }),
      { currentEpoch: EPOCH, nowSec },
    );
    expect(health.expired).toBe(true);
    expect(health.expiryStale).toBe(false);
  });

  it('the veto also catches a stale countdown that has not elapsed yet', () => {
    const nowSec = 1_800_000_000;
    // Voted 1 epoch ago: at least 19 epochs provably remain, so a stored
    // countdown of 2 is stale and the amber warning must not fire on it.
    const recent = vote(nowSec - 1 * DEFAULT_EPOCH_LENGTH_SEC);
    const health = delegationHealth(
      record({ active: true, expires_epoch_no: EPOCH + 2, votes: [recent] }),
      { currentEpoch: EPOCH, nowSec },
    );
    expect(health.expiryStale).toBe(true);
    expect(health.inactiveSoon).toBe(false);
    expect(health.epochsLeft).toBeNull();
  });

  it('one epoch of slack: a countdown a single epoch adrift of the vote proof is kept', () => {
    const nowSec = 1_800_000_000;
    // Voted 4 epochs ago: the proof says at least 16 left; the stored
    // countdown says 15. Within the wall-clock slack, so it stands.
    const recent = vote(nowSec - 4 * DEFAULT_EPOCH_LENGTH_SEC);
    const health = delegationHealth(
      record({ active: true, expires_epoch_no: EPOCH + 15, votes: [recent] }),
      { currentEpoch: EPOCH, nowSec },
    );
    expect(health.expiryStale).toBe(false);
    expect(health.epochsLeft).toBe(15);
  });

  it('windowUsed never goes negative when the expiry outruns the window (dormancy credit)', () => {
    const health = delegationHealth(record({ expires_epoch_no: EPOCH + 28 }), { currentEpoch: EPOCH });
    expect(health.epochsLeft).toBe(28);
    expect(health.windowUsed).toBe(0);
  });

  it('the veto never overrides an explicit active: false — the indexer said inactive', () => {
    const nowSec = 1_800_000_000;
    const recent = vote(nowSec - 2 * DEFAULT_EPOCH_LENGTH_SEC);
    const health = delegationHealth(
      record({ active: false, expires_epoch_no: EPOCH - 2, votes: [recent] }),
      { currentEpoch: EPOCH, nowSec },
    );
    expect(health.expired).toBe(true);
  });

  it('retirement outranks the whole hierarchy, stale expiry or not', () => {
    const health = delegationHealth(
      record({ registered: false, active: true, expires_epoch_no: EPOCH - 22 }),
      { currentEpoch: EPOCH },
    );
    expect(health.retired).toBe(true);
    expect(health.expired).toBe(false);
    expect(health.inactiveSoon).toBe(false);
  });
});

describe('delegationHealth — retirement', () => {
  it('is retired when the record says registered is false', () => {
    expect(delegationHealth(record({ registered: false }), { currentEpoch: EPOCH }).retired).toBe(true);
  });

  it('is not retired while registered is true', () => {
    expect(delegationHealth(record({ registered: true }), { currentEpoch: EPOCH }).retired).toBe(false);
  });

  it('an absent registered flag is unknown, not retirement', () => {
    expect(delegationHealth(record({ registered: undefined }), { currentEpoch: EPOCH }).retired).toBe(false);
    expect(delegationHealth(record({ registered: null }), { currentEpoch: EPOCH }).retired).toBe(false);
  });
});

describe('delegationHealth — rationale rates', () => {
  it('a DRep with no votes yields null rates, never zero', () => {
    const health = delegationHealth(record({ votes: [] }), { currentEpoch: EPOCH });
    expect(health.voteCount).toBe(0);
    expect(health.rationaleRecent).toBeNull();
    expect(health.rationaleLongRun).toBeNull();
    expect(health.lastVoteAt).toBeNull();
  });

  it('a missing votes array is n/a, not zero', () => {
    const health = delegationHealth(record({ votes: null }), { currentEpoch: EPOCH });
    expect(health.rationaleRecent).toBeNull();
    expect(health.rationaleLongRun).toBeNull();
  });

  it('a DRep who voted but never attached a rationale scores a real zero', () => {
    const health = delegationHealth(record({ votes: votes(4, 0) }), { currentEpoch: EPOCH });
    expect(health.voteCount).toBe(4);
    expect(health.rationaleRecent).toBe(0);
    expect(health.rationaleLongRun).toBe(0);
  });

  it('rationaleRecent covers the last 10 votes only', () => {
    // 20 votes, newest first: the newest 10 carry no rationale, the oldest 10 all do.
    const newest = Array.from({ length: 10 }, (_, i) => vote(2_000 - i, null));
    const oldest = Array.from({ length: 10 }, (_, i) => vote(1_000 - i, `https://rationale/${i}`));
    const health = delegationHealth(record({ votes: [...newest, ...oldest] }), { currentEpoch: EPOCH });
    expect(health.rationaleRecent).toBe(0);
    expect(health.rationaleLongRun).toBe(50);
    expect(health.recentWindow).toBe(DEFAULT_RATIONALE_WINDOW);
  });

  it('orders by block_time before taking the recent window, whatever order the API returned', () => {
    const shuffled = [
      vote(100, 'https://rationale/old'),
      vote(900, null),
      vote(500, 'https://rationale/mid'),
      vote(950, null),
    ];
    const health = delegationHealth(record({ votes: shuffled }), { currentEpoch: EPOCH, recentWindow: 2 });
    // The two newest (950, 900) carry no rationale.
    expect(health.rationaleRecent).toBe(0);
    expect(health.rationaleLongRun).toBe(50);
    expect(health.lastVoteAt).toBe(950);
  });

  it('uses the real vote count as the denominator when there are fewer than 10 votes', () => {
    const health = delegationHealth(record({ votes: votes(4, 1) }), { currentEpoch: EPOCH });
    expect(health.rationaleRecent).toBe(25);
    expect(health.rationaleLongRun).toBe(25);
  });

  it('separates a poor recent window from a healthy long run, as the alerts copy does', () => {
    const recent = Array.from({ length: 10 }, (_, i) => vote(9_000 - i, i < 2 ? `https://rationale/${i}` : null));
    const older = Array.from({ length: 15 }, (_, i) => vote(8_000 - i, i < 17 ? `https://rationale/o${i}` : null));
    const health = delegationHealth(record({ votes: [...recent, ...older] }), { currentEpoch: EPOCH });
    expect(health.rationaleRecent).toBe(20);
    expect(health.rationaleLongRun).toBe(68);
  });

  it('the recent window is a parameter, not a constant', () => {
    const health = delegationHealth(record({ votes: votes(10, 5) }), { currentEpoch: EPOCH, recentWindow: 4 });
    expect(health.recentWindow).toBe(4);
    expect(health.rationaleRecent).toBe(100);
    expect(DEFAULT_RATIONALE_WINDOW).toBe(10);
  });

  it('treats an empty-string meta_url as no rationale', () => {
    const health = delegationHealth(record({ votes: [vote(10, ''), vote(9, '   ')] }), { currentEpoch: EPOCH });
    expect(health.rationaleLongRun).toBe(0);
  });

  it('lastVoteAt is the newest block_time, and null when times are missing', () => {
    expect(delegationHealth(record({ votes: votes(3, 0) }), { currentEpoch: EPOCH }).lastVoteAt).toBe(1_000);
    const untimed = delegationHealth(record({ votes: [{ vote: 'Yes', meta_url: null }] }), { currentEpoch: EPOCH });
    expect(untimed.voteCount).toBe(1);
    expect(untimed.lastVoteAt).toBeNull();
  });
});

describe('delegationHealth — absent record', () => {
  it('a null record is entirely n/a and raises nothing', () => {
    const health = delegationHealth(null, { currentEpoch: EPOCH });
    expect(health.epochsLeft).toBeNull();
    expect(health.windowUsed).toBeNull();
    expect(health.rationaleRecent).toBeNull();
    expect(health.rationaleLongRun).toBeNull();
    expect(health.retired).toBe(false);
    expect(health.inactiveSoon).toBe(false);
    expect(health.expired).toBe(false);
    expect(health.voteCount).toBe(0);
  });

  it('does not fetch anything — it is pure over its arguments', () => {
    expect(delegationHealth(record(), {})).toEqual(delegationHealth(record(), {}));
  });
});

describe('useDelegationHealth', () => {
  it('recomputes when the record source changes', () => {
    const source = ref<DelegatedDRepRecord | null>(record({ expires_epoch_no: EPOCH + 9 }));
    const health = useDelegationHealth(source, { currentEpoch: EPOCH });
    expect(health.value.inactiveSoon).toBe(false);

    source.value = record({ expires_epoch_no: EPOCH + 2 });
    expect(health.value.epochsLeft).toBe(2);
    expect(health.value.inactiveSoon).toBe(true);
  });

  it('recomputes when the epoch advances', () => {
    const epoch = ref(EPOCH);
    const health = useDelegationHealth(record({ expires_epoch_no: EPOCH + 6 }), () => ({
      currentEpoch: epoch.value,
    }));
    expect(health.value.inactiveSoon).toBe(false);

    epoch.value = EPOCH + 1;
    expect(health.value.epochsLeft).toBe(5);
    expect(health.value.inactiveSoon).toBe(true);
  });

  it('accepts a plain getter for the record', () => {
    const drep = computed(() => record({ registered: false }));
    expect(useDelegationHealth(() => drep.value, { currentEpoch: EPOCH }).value.retired).toBe(true);
  });
});
