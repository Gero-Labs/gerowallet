import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import {
  governanceStatus,
  useGovernanceStatus,
  type GovernanceStatusInput,
  type GovernanceStatus,
} from '@/shared/composables/useGovernanceStatus';
import type { DelegatedDRepRecord } from '@/shared/composables/useDelegationHealth';

// A real preprod DRep, in both of the forms the wallet holds it in: `drep129`
// keys carry the CIP-129 bech32 as `address` and the bare credential as `cred`.
const CIP129 = 'drep1yfrr09kj5wtz8f2yr602k9v5ctfpl9kj54z0f8uzhsprhlcw09j6x';
const CREDENTIAL_HEX = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';
const OTHER_DREP_HEX = 'a'.repeat(56);

const EPOCH = 653;

function account(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    pool_id: 'pool1abc',
    drep_id: OTHER_DREP_HEX,
    withdrawable_amount: '412390000',
    ...overrides,
  };
}

function record(overrides: Partial<DelegatedDRepRecord> = {}): DelegatedDRepRecord {
  return {
    drep_id: OTHER_DREP_HEX,
    registered: true,
    active: true,
    expires_epoch_no: EPOCH + 12,
    votes: [],
    ...overrides,
  };
}

function statusOf(input: GovernanceStatusInput): GovernanceStatus {
  return governanceStatus({ currentEpoch: EPOCH, ...input }).status;
}

describe('governanceStatus — not in governance', () => {
  it('an absent account is not in governance', () => {
    expect(statusOf({ account: null })).toBe('notInGovernance');
    expect(statusOf({})).toBe('notInGovernance');
  });

  it('an unregistered stake key is not in governance', () => {
    expect(statusOf({ account: account({ active: false, pool_id: '', drep_id: '' }) })).toBe('notInGovernance');
  });

  it('reuses the registration predicate: pool delegation proves a stale active flag wrong', () => {
    // `active: false` with a pool delegation is the known-bad payload
    // isStakeKeyRegistered exists to correct. It must NOT read as unregistered.
    const result = governanceStatus({
      account: account({ active: false, pool_id: 'pool1abc', drep_id: '' }),
      currentEpoch: EPOCH,
    });
    expect(result.registered).toBe(true);
    expect(result.status).toBe('registeredNoDRep');
  });

  it('a DRep delegation alone also proves registration', () => {
    expect(
      governanceStatus({
        account: account({ active: false, pool_id: '', drep_id: OTHER_DREP_HEX }),
        record: record(),
        currentEpoch: EPOCH,
      }).registered,
    ).toBe(true);
  });

  it('nothing is blocked when the stake key was never registered', () => {
    const result = governanceStatus({ account: account({ active: false, pool_id: '', drep_id: '' }) });
    expect(result.withdrawalsBlocked).toBe(false);
    expect(result.delegation).toBe('none');
  });
});

describe('governanceStatus — registered with no DRep', () => {
  it('a registered key with no drep_id blocks withdrawals', () => {
    const result = governanceStatus({ account: account({ drep_id: '' }), currentEpoch: EPOCH });
    expect(result.status).toBe('registeredNoDRep');
    expect(result.withdrawalsBlocked).toBe(true);
    expect(result.delegation).toBe('none');
    expect(result.drepId).toBeNull();
  });

  it('treats a null and an empty drep_id alike', () => {
    expect(statusOf({ account: account({ drep_id: null }) })).toBe('registeredNoDRep');
    expect(statusOf({ account: account({ drep_id: '   ' }) })).toBe('registeredNoDRep');
  });

  it('ignores a DRep record that arrived for nobody', () => {
    expect(statusOf({ account: account({ drep_id: '' }), record: record({ registered: false }) })).toBe(
      'registeredNoDRep',
    );
  });

  it('reports the blocked rewards as exact lovelace, never as a Number', () => {
    const blocked = governanceStatus({
      account: account({ drep_id: '', withdrawable_amount: '90071992547409910' }),
      currentEpoch: EPOCH,
    });
    // Past Number.MAX_SAFE_INTEGER: a Number() round-trip would corrupt this.
    expect(blocked.lockedRewards).toBe(90071992547409910n);
  });

  it('locks nothing once the stake has taken a position', () => {
    expect(governanceStatus({ account: account(), record: record(), currentEpoch: EPOCH }).lockedRewards).toBe(0n);
  });
});

describe('governanceStatus — represented', () => {
  it('a registered key delegated to a healthy DRep is represented', () => {
    const result = governanceStatus({ account: account(), record: record(), currentEpoch: EPOCH });
    expect(result.status).toBe('represented');
    expect(result.delegation).toBe('drep');
    expect(result.withdrawalsBlocked).toBe(false);
    expect(result.drepId).toBe(OTHER_DREP_HEX);
    expect(result.recordAvailable).toBe(true);
  });

  it('stays represented when the DRep record has not loaded — absence is not retirement', () => {
    const result = governanceStatus({ account: account(), record: null, currentEpoch: EPOCH });
    expect(result.status).toBe('represented');
    expect(result.recordAvailable).toBe(false);
    expect(result.health.retired).toBe(false);
  });

  it('stays represented when the record carries no expiry epoch', () => {
    const result = governanceStatus({
      account: account(),
      record: record({ expires_epoch_no: null }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('represented');
    expect(result.health.epochsLeft).toBeNull();
  });

  it('stays represented while the epoch is unknown', () => {
    expect(statusOf({ account: account(), record: record({ expires_epoch_no: EPOCH }), currentEpoch: null })).toBe(
      'represented',
    );
  });
});

describe('governanceStatus — the predefined choices', () => {
  it('always-abstain unlocks withdrawals without claiming a representative', () => {
    const result = governanceStatus({
      account: account({ drep_id: 'drep_always_abstain' }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('represented');
    expect(result.delegation).toBe('abstain');
    expect(result.withdrawalsBlocked).toBe(false);
    expect(result.copyKey).toBe('governance.status.abstaining');
  });

  it('no-confidence is its own delegation kind', () => {
    const result = governanceStatus({
      account: account({ drep_id: 'drep_always_no_confidence' }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('represented');
    expect(result.delegation).toBe('noConfidence');
    expect(result.copyKey).toBe('governance.status.noConfidence');
  });

  it('never raises an inactivity or retirement claim against a predefined choice', () => {
    const result = governanceStatus({
      account: account({ drep_id: 'drep_always_abstain' }),
      // A stray record must not be attributed to a keyword delegation.
      record: record({ registered: false, expires_epoch_no: EPOCH }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('represented');
    expect(result.health.retired).toBe(false);
    expect(result.health.inactiveSoon).toBe(false);
  });
});

describe('governanceStatus — the DRep going inactive', () => {
  it('warns at 5 epochs left, the 15-of-20 boundary', () => {
    expect(statusOf({ account: account(), record: record({ expires_epoch_no: EPOCH + 5 }) })).toBe('drepInactiveSoon');
  });

  it('does not warn at 6 epochs left', () => {
    expect(statusOf({ account: account(), record: record({ expires_epoch_no: EPOCH + 6 }) })).toBe('represented');
  });

  it('reports the final-epoch warning at the exact expiry epoch, and drepInactive one past it', () => {
    // Conway RATIFY: the expiry epoch itself still counts, so exclusion may
    // only be claimed strictly past it.
    const atExpiry = governanceStatus({
      account: account(),
      record: record({ active: null, expires_epoch_no: EPOCH }),
      currentEpoch: EPOCH,
    });
    expect(atExpiry.status).toBe('drepInactiveSoon');
    expect(atExpiry.health.expired).toBe(false);
    expect(atExpiry.health.windowUsed).toBe(20);

    const pastExpiry = governanceStatus({
      account: account(),
      record: record({ active: null, expires_epoch_no: EPOCH - 1 }),
      currentEpoch: EPOCH,
    });
    expect(pastExpiry.status).toBe('drepInactive');
    expect(pastExpiry.tone).toBe('critical');
    expect(pastExpiry.health.expired).toBe(true);
  });

  // The Cardano Foundation false positive: an indexed record can say
  // active: true beside an expiry epochs in the past. The explicit flag wins;
  // the stale countdown is withheld rather than shown as "0 of 20 left".
  it('stays represented when active: true contradicts an elapsed expiry', () => {
    const result = governanceStatus({
      account: account(),
      record: record({ active: true, expires_epoch_no: EPOCH - 22 }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('represented');
    expect(result.health.expired).toBe(false);
    expect(result.health.expiryStale).toBe(true);
    expect(result.health.epochsLeft).toBeNull();
    expect(result.health.windowUsed).toBeNull();
  });

  it('reports drepInactive on an explicit active: false, whatever the expiry says', () => {
    const result = governanceStatus({
      account: account(),
      record: record({ active: false, expires_epoch_no: EPOCH + 10 }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('drepInactive');
    expect(result.titleKey).toBe('governance.status.drepInactive.title');
    expect(result.health.expired).toBe(true);
  });

  it('takes the warning threshold as a parameter', () => {
    const input = { account: account(), record: record({ expires_epoch_no: EPOCH + 8 }), currentEpoch: EPOCH };
    expect(governanceStatus(input).status).toBe('represented');
    expect(governanceStatus({ ...input, warnAt: 10 }).status).toBe('drepInactiveSoon');
  });

  it('takes the activity window from the epoch params', () => {
    const result = governanceStatus({
      account: account(),
      record: record({ expires_epoch_no: EPOCH + 5 }),
      currentEpoch: EPOCH,
      activityWindow: 30,
    });
    expect(result.health.windowUsed).toBe(25);
    expect(result.health.activityWindow).toBe(30);
  });
});

describe('governanceStatus — the DRep retired', () => {
  it('a deregistered DRep is retired', () => {
    const result = governanceStatus({
      account: account(),
      record: record({ registered: false }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('drepRetired');
    expect(result.health.retired).toBe(true);
  });

  it('retirement outranks the inactivity warning', () => {
    expect(
      statusOf({ account: account(), record: record({ registered: false, expires_epoch_no: EPOCH + 1 }) }),
    ).toBe('drepRetired');
  });

  it('ignores a record that belongs to a different DRep than the one delegated to', () => {
    // A stale record left over from a previous delegation must not retire the
    // DRep the account is actually delegated to now.
    const result = governanceStatus({
      account: account({ drep_id: CIP129 }),
      record: record({ drep_id: OTHER_DREP_HEX, registered: false }),
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('represented');
    expect(result.recordAvailable).toBe(false);
  });

  it('an absent registered flag is never read as retirement', () => {
    expect(statusOf({ account: account(), record: record({ registered: undefined }) })).toBe('represented');
    expect(statusOf({ account: account(), record: record({ registered: null }) })).toBe('represented');
  });
});

describe('governanceStatus — self DRep', () => {
  it('matches the wallet own DRep key', () => {
    const result = governanceStatus({
      account: account({ drep_id: CIP129 }),
      record: record({ drep_id: CIP129 }),
      ownDRepIds: [{ address: CIP129, cred: CREDENTIAL_HEX }],
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('selfDRep');
    expect(result.isSelf).toBe(true);
    expect(result.delegation).toBe('self');
  });

  it('matches across id formats: CIP-129 on the account, bare hex on the key', () => {
    expect(
      statusOf({
        account: account({ drep_id: CIP129 }),
        record: record(),
        ownDRepIds: [CREDENTIAL_HEX],
      }),
    ).toBe('selfDRep');
  });

  it('matches the other way round too: hex on the account, CIP-129 on the key', () => {
    expect(
      statusOf({
        account: account({ drep_id: CREDENTIAL_HEX }),
        record: record(),
        ownDRepIds: [CIP129],
      }),
    ).toBe('selfDRep');
  });

  it('an empty drep129 array is not a match', () => {
    const result = governanceStatus({
      account: account({ drep_id: CIP129 }),
      record: record(),
      ownDRepIds: [],
      currentEpoch: EPOCH,
    });
    expect(result.isSelf).toBe(false);
    expect(result.status).toBe('represented');
  });

  it('an absent key list is not a match — a watch wallet must not crash here', () => {
    expect(statusOf({ account: account({ drep_id: CIP129 }), record: record(), ownDRepIds: undefined })).toBe(
      'represented',
    );
    expect(statusOf({ account: account({ drep_id: CIP129 }), record: record(), ownDRepIds: null })).toBe(
      'represented',
    );
  });

  it('ignores empty and unparseable entries in the key list', () => {
    expect(
      governanceStatus({
        account: account({ drep_id: CIP129 }),
        record: record(),
        ownDRepIds: [null, undefined, '', '   ', 'not-a-drep', { address: '', cred: '' }],
        currentEpoch: EPOCH,
      }).isSelf,
    ).toBe(false);
  });

  it('delegating to somebody else is never self, however many keys the wallet holds', () => {
    expect(
      statusOf({
        account: account({ drep_id: OTHER_DREP_HEX }),
        record: record(),
        ownDRepIds: [CIP129, CREDENTIAL_HEX],
      }),
    ).toBe('represented');
  });

  it('self outranks the inactivity warning but still exposes the health for the strip', () => {
    const result = governanceStatus({
      account: account({ drep_id: CIP129 }),
      record: record({ drep_id: CIP129, expires_epoch_no: EPOCH + 2 }),
      ownDRepIds: [CREDENTIAL_HEX],
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('selfDRep');
    expect(result.health.inactiveSoon).toBe(true);
    expect(result.health.epochsLeft).toBe(2);
  });

  it('retiring your own DRep is reported as retired, not as self', () => {
    const result = governanceStatus({
      account: account({ drep_id: CIP129 }),
      record: record({ drep_id: CIP129, registered: false }),
      ownDRepIds: [CREDENTIAL_HEX],
      currentEpoch: EPOCH,
    });
    expect(result.status).toBe('drepRetired');
    expect(result.isSelf).toBe(true);
  });
});

describe('governanceStatus — copy and tone', () => {
  const cases: Array<[GovernanceStatus, GovernanceStatusInput]> = [
    ['notInGovernance', { account: account({ active: false, pool_id: '', drep_id: '' }) }],
    ['registeredNoDRep', { account: account({ drep_id: '' }) }],
    ['represented', { account: account(), record: record() }],
    ['drepInactiveSoon', { account: account(), record: record({ expires_epoch_no: EPOCH + 1 }) }],
    ['drepRetired', { account: account(), record: record({ registered: false }) }],
    [
      'selfDRep',
      { account: account({ drep_id: CIP129 }), record: record({ drep_id: CIP129 }), ownDRepIds: [CREDENTIAL_HEX] },
    ],
  ];

  it('every state in the machine is reachable', () => {
    const reached = cases.map(([, input]) => statusOf(input));
    expect(reached).toEqual(cases.map(([expected]) => expected));
    expect(new Set(reached).size).toBe(6);
  });

  it('every state exposes a namespaced title and description key', () => {
    for (const [, input] of cases) {
      const result = governanceStatus({ currentEpoch: EPOCH, ...input });
      expect(result.copyKey.startsWith('governance.status.')).toBe(true);
      expect(result.titleKey).toBe(`${result.copyKey}.title`);
      expect(result.descriptionKey).toBe(`${result.copyKey}.description`);
    }
  });

  it('tones follow the design: green represented, amber going inactive, red blocked or retired', () => {
    const toneOf = (input: GovernanceStatusInput) => governanceStatus({ currentEpoch: EPOCH, ...input }).tone;
    expect(toneOf(cases[0][1])).toBe('neutral');
    expect(toneOf(cases[1][1])).toBe('critical');
    expect(toneOf(cases[2][1])).toBe('success');
    expect(toneOf(cases[3][1])).toBe('warning');
    expect(toneOf(cases[4][1])).toBe('critical');
    expect(toneOf(cases[5][1])).toBe('success');
  });
});

describe('useGovernanceStatus', () => {
  it('recomputes when the account changes', () => {
    const source = ref<GovernanceStatusInput>({ account: account({ drep_id: '' }), currentEpoch: EPOCH });
    const status = useGovernanceStatus(source);
    expect(status.value.status).toBe('registeredNoDRep');

    source.value = { account: account(), record: record(), currentEpoch: EPOCH };
    expect(status.value.status).toBe('represented');
  });

  it('recomputes when the epoch advances past the warning boundary', () => {
    const epoch = ref(EPOCH);
    const status = useGovernanceStatus(() => ({
      account: account(),
      record: record({ expires_epoch_no: EPOCH + 6 }),
      currentEpoch: epoch.value,
    }));
    expect(status.value.status).toBe('represented');

    epoch.value = EPOCH + 1;
    expect(status.value.status).toBe('drepInactiveSoon');
  });

  it('does not fetch — the same input always gives the same answer', () => {
    const input = { account: account(), record: record(), currentEpoch: EPOCH };
    expect(governanceStatus(input)).toEqual(governanceStatus(input));
  });
});
