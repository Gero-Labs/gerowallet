import { describe, expect, it } from 'vitest';
import {
  actionTypeResolverFor,
  canonicalActionKey,
  drepAnchorState,
  drepBio,
  drepDisplayName,
  eligibleActionIdsFor,
  epochInflow,
  powerConcentration,
} from '@/shared/utils/drepView';

// A real mainnet gov action id, in both live forms.
const TX_A = 'a'.repeat(64);
const TX_B = 'b'.repeat(64);
const DISPLAY_A = `${TX_A}#0`;
const DISPLAY_B = `${TX_B}#3`;
// bech32 of (32-byte hash + index byte) — produced by the same encoder the API uses.
const CIP129_A = 'gov_action1424242424242424242424242424242424242424242424242424qqm57ncf';

describe('drepDisplayName', () => {
  it('reads a plain CIP-119 givenName', () => {
    expect(drepDisplayName({ metadata: { meta_json: { body: { givenName: 'Atlas Research' } } } })).toBe(
      'Atlas Research',
    );
  });

  it('unwraps the JSON-LD @value form', () => {
    expect(
      drepDisplayName({ metadata: { meta_json: { body: { givenName: { '@value': 'Quill Labs' } } } } }),
    ).toBe('Quill Labs');
  });

  it('falls back to a top-level display_name', () => {
    expect(drepDisplayName({ display_name: 'Harbor Node' })).toBe('Harbor Node');
  });

  it('is null when there is no name at all, never an empty string', () => {
    expect(drepDisplayName({})).toBeNull();
    expect(drepDisplayName({ metadata: { meta_json: { body: { givenName: '   ' } } } })).toBeNull();
    expect(drepDisplayName(null)).toBeNull();
    expect(drepDisplayName('nonsense')).toBeNull();
  });
});

describe('drepBio', () => {
  it('prefers objectives, then motivations', () => {
    expect(drepBio({ metadata: { meta_json: { body: { objectives: 'Protocol first.' } } } })).toBe('Protocol first.');
    expect(drepBio({ metadata: { meta_json: { body: { motivations: { '@value': 'Treasury skeptics.' } } } } })).toBe(
      'Treasury skeptics.',
    );
  });

  it('is null when the body carries neither', () => {
    expect(drepBio({ metadata: { meta_json: { body: {} } } })).toBeNull();
  });
});

describe('drepAnchorState', () => {
  it('is `none` when the DRep published no anchor at all', () => {
    expect(drepAnchorState({ drep_id: 'drep1x' })).toBe('none');
  });

  it('is `verified` only when the backend actually validated the document', () => {
    expect(drepAnchorState({ url: 'https://x.io/a.json', metadata: { is_valid: true } })).toBe('verified');
  });

  it('is `mismatch` when validation ran and failed', () => {
    expect(drepAnchorState({ url: 'https://x.io/a.json', metadata: { is_valid: false } })).toBe('mismatch');
  });

  it('is `unverified` when an anchor exists but is_valid is absent — never `mismatch`', () => {
    expect(drepAnchorState({ url: 'https://x.io/a.json', metadata: {} })).toBe('unverified');
    expect(drepAnchorState({ hash: 'deadbeef', metadata: { is_valid: null } })).toBe('unverified');
    expect(drepAnchorState({ metadata: { meta_url: 'https://x.io/a.json' } })).toBe('unverified');
  });
});

describe('epochInflow', () => {
  const EPOCH = 653;

  it('sums only the delegations recorded in the current epoch', () => {
    const rows = [
      { amount: '1000000', epoch_no: EPOCH },
      { amount: '2500000', epoch_no: EPOCH },
      { amount: '9000000', epoch_no: EPOCH - 4 },
    ];
    expect(epochInflow(rows, EPOCH)).toBe(3500000n);
  });

  it('refuses to report a delta when every row carries the current epoch', () => {
    // A feed that stamps every delegator with the snapshot epoch is not telling
    // us what arrived this epoch. Claiming the whole power as inflow would be a
    // fabricated number, so this is null.
    const rows = [
      { amount: '1000000', epoch_no: EPOCH },
      { amount: '2000000', epoch_no: EPOCH },
    ];
    expect(epochInflow(rows, EPOCH)).toBeNull();
  });

  it('returns 0 when the epoch field varies but nothing landed this epoch', () => {
    const rows = [
      { amount: '1000000', epoch_no: EPOCH - 1 },
      { amount: '2000000', epoch_no: EPOCH - 6 },
    ];
    expect(epochInflow(rows, EPOCH)).toBe(0n);
  });

  it('is null without an epoch, without rows, or with no usable epoch field', () => {
    expect(epochInflow([{ amount: '1', epoch_no: EPOCH }], null)).toBeNull();
    expect(epochInflow([], EPOCH)).toBeNull();
    expect(epochInflow(null, EPOCH)).toBeNull();
    expect(epochInflow([{ amount: '1' }], EPOCH)).toBeNull();
  });

  it('never goes through Number() — lovelace beyond 2^53 survives', () => {
    const rows = [
      { amount: '9007199254740993', epoch_no: EPOCH },
      { amount: '1', epoch_no: EPOCH - 1 },
    ];
    expect(epochInflow(rows, EPOCH)).toBe(9007199254740993n);
  });
});

describe('canonicalActionKey', () => {
  it('collapses every live id form onto one join key', () => {
    expect(canonicalActionKey(DISPLAY_A)).toBe(DISPLAY_A);
    expect(canonicalActionKey(CIP129_A)).toBe(DISPLAY_A);
    expect(canonicalActionKey(`${TX_A}%230`)).toBe(DISPLAY_A);
  });

  it('is null for anything that is not a governance action id', () => {
    expect(canonicalActionKey('drep1abc')).toBeNull();
    expect(canonicalActionKey(null)).toBeNull();
    expect(canonicalActionKey(42)).toBeNull();
  });
});

describe('actionTypeResolverFor', () => {
  const actions = [
    { govActionId: DISPLAY_A, govActionIdCip129: CIP129_A, type: 'TreasuryWithdrawals' },
    { govActionId: DISPLAY_B, govActionIdCip129: null, type: 'ParameterChange' },
  ];

  it('resolves a type whichever id form the vote row uses', () => {
    const resolve = actionTypeResolverFor(actions);
    expect(resolve(DISPLAY_A)).toBe('TreasuryWithdrawals');
    expect(resolve(CIP129_A)).toBe('TreasuryWithdrawals');
    expect(resolve(DISPLAY_B)).toBe('ParameterChange');
  });

  it('returns null for an unknown or unparseable id rather than guessing', () => {
    const resolve = actionTypeResolverFor(actions);
    expect(resolve('not-an-id')).toBeNull();
    expect(resolve(`${'c'.repeat(64)}#0`)).toBeNull();
  });

  it('survives an empty or junk action list', () => {
    expect(actionTypeResolverFor([])('x')).toBeNull();
    expect(actionTypeResolverFor(null)(DISPLAY_A)).toBeNull();
  });
});

describe('eligibleActionIdsFor', () => {
  const actions = [
    { govActionId: DISPLAY_A, govActionIdCip129: CIP129_A, type: 'TreasuryWithdrawals' },
    { govActionId: DISPLAY_B, govActionIdCip129: null, type: 'ParameterChange' },
  ];

  it('emits the display form when the vote feed speaks the display form', () => {
    expect(eligibleActionIdsFor(DISPLAY_A, actions)).toEqual([DISPLAY_A, DISPLAY_B]);
  });

  it('emits the bech32 form when the vote feed speaks bech32 — and only if every action has one', () => {
    expect(eligibleActionIdsFor(CIP129_A, actions)).toBeNull();
    expect(
      eligibleActionIdsFor(CIP129_A, [{ govActionId: DISPLAY_A, govActionIdCip129: CIP129_A, type: 'InfoAction' }]),
    ).toEqual([CIP129_A]);
  });

  it('is null when the sample id form cannot be recognised — a wrong denominator is worse than none', () => {
    expect(eligibleActionIdsFor('drep1abc', actions)).toBeNull();
    expect(eligibleActionIdsFor(null, actions)).toBeNull();
    expect(eligibleActionIdsFor(DISPLAY_A, [])).toBeNull();
  });

  it('de-duplicates', () => {
    const dupes = [
      { govActionId: DISPLAY_A, govActionIdCip129: CIP129_A, type: 'InfoAction' },
      { govActionId: DISPLAY_A, govActionIdCip129: CIP129_A, type: 'InfoAction' },
    ];
    expect(eligibleActionIdsFor(DISPLAY_A, dupes)).toEqual([DISPLAY_A]);
  });
});

describe('powerConcentration', () => {
  const rows = (amounts: string[]) => amounts.map(amount => ({ amount }));

  it('detects that a sample really is ordered by power, descending', () => {
    expect(powerConcentration(rows(['500', '400', '400', '100']), 2).sortedDesc).toBe(true);
    expect(powerConcentration(rows(['500', '400', '900']), 2).sortedDesc).toBe(false);
  });

  it('computes the top-N share of the sample with BigInt sums', () => {
    const result = powerConcentration(rows(['500', '300', '150', '50']), 2);
    expect(result.topShare).toBe(80);
    expect(result.sampleSize).toBe(4);
  });

  it('reads the Nth-largest power regardless of the input order', () => {
    expect(powerConcentration(rows(['100', '900', '400']), 2).cutoffPower).toBe(400n);
    expect(powerConcentration(rows(['900', '400', '100']), 2).cutoffPower).toBe(400n);
  });

  it('has no cutoff when the sample is shorter than N', () => {
    expect(powerConcentration(rows(['900', '400']), 10).cutoffPower).toBeNull();
  });

  it('has no share when the sample holds no power at all', () => {
    const result = powerConcentration(rows(['0', '0']), 1);
    expect(result.topShare).toBeNull();
  });

  it('survives junk input', () => {
    const result = powerConcentration(null, 10);
    expect(result).toEqual({ sampleSize: 0, sortedDesc: false, topShare: null, cutoffPower: null });
  });

  it('handles lovelace beyond 2^53 without precision loss', () => {
    const result = powerConcentration(rows(['9007199254740993', '9007199254740992']), 1);
    expect(result.cutoffPower).toBe(9007199254740993n);
  });
});
