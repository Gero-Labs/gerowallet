import { describe, expect, it } from 'vitest';
import {
  compareUnits,
  isCancellable,
  isClaimable,
  isUnclaimed,
  toSmallestUnit,
  type RealFiOrder,
} from './types';

describe('toSmallestUnit', () => {
  it.each([
    ['1', '1000000'],
    ['0.1', '100000'],
    ['12.5', '12500000'],
    ['0.000001', '1'],
    ['.5', '500000'],
    ['7.', '7000000'],
    // Past 2^53 in smallest units: a Number would round the last digits away.
    ['12345678901.123456', '12345678901123456'],
  ])('reads %s as %s units', (input, units) => {
    expect(toSmallestUnit(input)).toBe(units);
  });

  // Commas are refused, never guessed at: '1,5' is 1.5 to a German reader and 15 with
  // the comma dropped; '1,500' is 1.5 or 1500 depending on who typed it.
  it.each(['', '.', '0', '0.000000', '-1', '1e6', 'abc', '1.0000001', '1.2.3', '1,5', '1,500', '1,000.25'])(
    'rejects %j',
    (input) => {
      expect(toSmallestUnit(input)).toBeNull();
    },
  );
});

describe('compareUnits', () => {
  it('compares exactly past 2^53', () => {
    expect(compareUnits('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareUnits('5', '5')).toBe(0);
    expect(compareUnits('4', '5')).toBe(-1);
  });
});

const TX = 'd26ab71e901bd3375a77e2674bd17fc487b5cf8be2ac0c33e0cf20a6e80690f6';

function order(partial: Partial<RealFiOrder>): RealFiOrder {
  return { txHash: TX, outputIndex: 0, action: 'Stake', status: 'Open', ...partial };
}

const EXECUTED_UNSTAKE = order({
  action: 'Unstake',
  status: 'Executed',
  unlockSlot: '1000',
  resultTxHash: TX,
  resultOutputIndex: 1,
});

describe('claiming', () => {
  it('is possible from the unlock slot on, not before', () => {
    expect(isClaimable(EXECUTED_UNSTAKE, 999)).toBe(false);
    expect(isClaimable(EXECUTED_UNSTAKE, 1000)).toBe(true);
  });

  it('is never offered without a chain tip to compare against', () => {
    expect(isClaimable(EXECUTED_UNSTAKE, null)).toBe(false);
  });

  it('is done once claimed', () => {
    expect(isUnclaimed({ ...EXECUTED_UNSTAKE, claimTxHash: TX })).toBe(false);
  });

  it('needs everything the claim is built from', () => {
    expect(isUnclaimed({ ...EXECUTED_UNSTAKE, unlockSlot: undefined })).toBe(false);
    expect(isUnclaimed({ ...EXECUTED_UNSTAKE, resultTxHash: undefined })).toBe(false);
    expect(isUnclaimed({ ...EXECUTED_UNSTAKE, status: 'Open' })).toBe(false);
    expect(isUnclaimed({ ...EXECUTED_UNSTAKE, action: 'Stake' })).toBe(false);
  });
});

describe('cancelling', () => {
  it('covers waiting and stranded orders', () => {
    expect(isCancellable(order({ status: 'Open' }))).toBe(true);
    expect(isCancellable(order({ status: 'Invalidated' }))).toBe(true);
    expect(isCancellable(order({ status: 'InvalidMinReceived' }))).toBe(true);
  });

  it('leaves in-flight, settled and failed orders alone', () => {
    for (const status of [
      'Validating',
      'HeldForScreening',
      'Executed',
      'Canceled',
      'InvalidatedBlockedScreening',
      'Failed',
      'Rejected',
    ] as const) {
      expect(isCancellable(order({ status })), status).toBe(false);
    }
  });
});
