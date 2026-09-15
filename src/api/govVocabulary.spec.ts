import { describe, it, expect } from 'vitest';
import {
  normalizeActionStatus,
  toNexusActionStatus,
  toNexusActionType,
  normalizeActionType,
  normalizeProposal,
  normalizeVote,
  normalizeVoteChoice,
  normalizeVoterRole,
} from '@/api/govVocabulary';

/**
 * The values in these cases are the ones production actually answered with on
 * 2026-08-24 (api.gerowallet.io and the market-site proxy agreeing), and the
 * ones the Koios-shaped dev shim answers with. Both must land on the wallet's
 * own spelling, because the components, the i18n keys and every other spec are
 * written against it.
 */
describe('govVocabulary, the two live spellings agree after normalising', () => {
  it.each([
    ['TREASURY_WITHDRAWALS_ACTION', 'TreasuryWithdrawals'],
    ['PARAMETER_CHANGE_ACTION', 'ParameterChange'],
    ['HARD_FORK_INITIATION_ACTION', 'HardForkInitiation'],
    ['INFO_ACTION', 'InfoAction'],
    ['NEW_CONSTITUTION', 'NewConstitution'],
    ['NO_CONFIDENCE', 'NoConfidence'],
    // Same CIP-1694 action under two names: the ledger and Nexus say Update,
    // the wallet has always said New.
    ['UPDATE_COMMITTEE', 'NewCommittee'],
    ['NEW_COMMITTEE', 'NewCommittee'],
  ])('maps the Nexus type %s to %s', (nexus, expected) => {
    expect(normalizeActionType(nexus)).toBe(expected);
  });

  it.each([
    ['TreasuryWithdrawals', 'TreasuryWithdrawals'],
    ['InfoAction', 'InfoAction'],
    ['ParameterChange', 'ParameterChange'],
  ])('leaves the shim type %s alone', (shim, expected) => {
    expect(normalizeActionType(shim)).toBe(expected);
  });

  it.each([
    ['LIVE', 'active'],
    ['EXPIRED', 'expired'],
    ['ENACTED', 'enacted'],
    ['DROPPED', 'dropped'],
    ['RATIFIED', 'ratified'],
    ['active', 'active'],
  ])('maps the status %s to %s', (input, expected) => {
    expect(normalizeActionStatus(input)).toBe(expected);
  });

  it('normalises voter roles from both the yaci and the facade spellings', () => {
    expect(normalizeVoterRole('DREP_KEY_HASH')).toBe('DRep');
    expect(normalizeVoterRole('DREP_SCRIPT_HASH')).toBe('DRep');
    expect(normalizeVoterRole('STAKING_POOL_KEY_HASH')).toBe('SPO');
    expect(normalizeVoterRole('CONSTITUTIONAL_COMMITTEE_HOT_KEY_HASH')).toBe('ConstitutionalCommittee');
    expect(normalizeVoterRole('DRep')).toBe('DRep');
  });

  it('normalises ballots', () => {
    expect(normalizeVoteChoice('YES')).toBe('Yes');
    expect(normalizeVoteChoice('Abstain')).toBe('Abstain');
  });
});

describe('govVocabulary, unrecognised values are never coerced', () => {
  it('passes an unknown action type through untouched', () => {
    // A future CIP-1694 type must surface as itself. Filing it as InfoAction
    // would tell a reader the action cannot ratify when it can.
    expect(normalizeActionType('SOME_FUTURE_ACTION')).toBe('SOME_FUTURE_ACTION');
    expect(normalizeActionStatus('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
    expect(normalizeVoterRole('ORACLE')).toBe('ORACLE');
  });

  it('leaves null and undefined as they were', () => {
    expect(normalizeActionType(null)).toBeNull();
    expect(normalizeActionStatus(undefined)).toBeUndefined();
    expect(normalizeVoteChoice('')).toBe('');
  });
});

describe('govVocabulary, row helpers', () => {
  it('normalises a proposal row without disturbing its other fields', () => {
    const row = {
      govActionId: 'abc#0',
      title: 'Reimburse Ikigai Info Governance Action Deposit.',
      type: 'TREASURY_WITHDRAWALS_ACTION',
      status: 'LIVE',
      deposit: '100000000000',
    };
    expect(normalizeProposal(row)).toEqual({ ...row, type: 'TreasuryWithdrawals', status: 'active' });
  });

  it('normalises a vote row without disturbing its other fields', () => {
    const row = { voterHash: 'aa'.repeat(28), voterRole: 'DREP_KEY_HASH', vote: 'YES', votedAt: 1787463005 };
    expect(normalizeVote(row)).toEqual({ ...row, voterRole: 'DRep', vote: 'Yes' });
  });

  it('does not throw on a malformed row', () => {
    expect(normalizeProposal(null as never)).toBeNull();
    expect(normalizeVote({} as never)).toEqual({ voterRole: undefined, vote: undefined });
  });
});

describe('govVocabulary, the outbound direction', () => {
  // Normalising only inbound was half a fix. The action list's filter chips
  // carry the wallet's spelling and are sent as `type=` / `status=`, so
  // filtering against production asked for `TreasuryWithdrawals` and got an
  // EMPTY LIST back — which reads as "no actions of this kind", a claim about
  // the chain made from a vocabulary mismatch.
  it.each([
    ['TreasuryWithdrawals', 'TREASURY_WITHDRAWALS_ACTION'],
    ['ParameterChange', 'PARAMETER_CHANGE_ACTION'],
    ['HardForkInitiation', 'HARD_FORK_INITIATION_ACTION'],
    ['NoConfidence', 'NO_CONFIDENCE'],
    ['NewConstitution', 'NEW_CONSTITUTION'],
    ['InfoAction', 'INFO_ACTION'],
    // The wallet says New, the ledger and Nexus say Update. Send theirs.
    ['NewCommittee', 'UPDATE_COMMITTEE'],
  ])('sends the type %s as %s', (wallet, wire) => {
    expect(toNexusActionType(wallet)).toBe(wire);
  });

  it.each([
    ['active', 'LIVE'],
    ['ratified', 'RATIFIED'],
    ['enacted', 'ENACTED'],
    ['expired', 'EXPIRED'],
    ['dropped', 'DROPPED'],
  ])('sends the status %s as %s', (wallet, wire) => {
    expect(toNexusActionStatus(wallet)).toBe(wire);
  });

  it('round-trips: everything sent comes back as what was asked for', () => {
    // The two directions have to stay inverses. A type added to one map and not
    // the other is filterable but not displayable, or the reverse — and both
    // failures are silent.
    const walletTypes = [
      'ParameterChange',
      'HardForkInitiation',
      'TreasuryWithdrawals',
      'NoConfidence',
      'NewCommittee',
      'NewConstitution',
      'InfoAction',
    ];
    for (const type of walletTypes) {
      expect(normalizeActionType(toNexusActionType(type)), type).toBe(type);
    }

    for (const status of ['active', 'ratified', 'enacted', 'expired', 'dropped']) {
      expect(normalizeActionStatus(toNexusActionStatus(status)), status).toBe(status);
    }
  });

  it('passes an unrecognised filter through rather than inventing one', () => {
    expect(toNexusActionType('SomethingNew')).toBe('SomethingNew');
    expect(toNexusActionStatus('whatever')).toBe('whatever');
  });
});
