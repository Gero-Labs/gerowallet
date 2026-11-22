import { describe, expect, it } from 'vitest';
import { Network } from '@/models/types';
import {
  MIDNIGHT_STATION_NETWORKS, MidnightStationError, isMidnightStationError, isStationCode, isStationNetwork,
  stationCodeOfError, stationCopyKey, stationSubmitUncertain,
} from './midnightStationConfig';

describe('fee station config', () => {
  it('is offered on preprod only in this build', () => {
    expect(MIDNIGHT_STATION_NETWORKS).toEqual([Network.PREPROD]);
    expect(isStationNetwork(Network.PREPROD)).toBe(true);
    expect(isStationNetwork(Network.MAINNET)).toBe(false);
    expect(isStationNetwork(undefined)).toBe(false);
  });

  it('knows the server codes and nothing else', () => {
    for (const code of ['NOT_REGISTERED', 'NOT_DELEGATED', 'BELOW_THRESHOLD', 'ALREADY_ISSUED', 'CHALLENGE_INVALID',
      'VOUCHER_INVALID', 'VOUCHER_SPENT', 'TX_NOT_ELIGIBLE', 'FEE_OVER_CAP', 'BUDGET_EXHAUSTED', 'STATION_OFF', 'STATION_BUSY',
      'STATION_UNAVAILABLE', 'STATION_NO_ANSWER', 'STATION_NO_VOUCHER', 'SEAL_UNKNOWN', 'NO_TWIN']) {
      expect(isStationCode(code)).toBe(true);
    }
    expect(isStationCode('SOMETHING_ELSE')).toBe(false);
    expect(isStationCode(undefined)).toBe(false);
    // An inherited property name is not a code.
    expect(isStationCode('toString')).toBe(false);
  });

  it('carries its code as the message unless a text is given', () => {
    const bare = new MidnightStationError('STATION_BUSY');
    expect(bare.message).toBe('STATION_BUSY');
    expect(bare.code).toBe('STATION_BUSY');
    const said = new MidnightStationError('STATION_BUSY', 'Busy, try again');
    expect(said.message).toBe('Busy, try again');
    expect(isMidnightStationError(said)).toBe(true);
    expect(isMidnightStationError(new Error('STATION_BUSY'))).toBe(false);
  });

  it('reads a code from an error, and anything else as unavailable', () => {
    expect(stationCodeOfError(new MidnightStationError('FEE_OVER_CAP'))).toBe('FEE_OVER_CAP');
    expect(stationCodeOfError(new Error('boom'))).toBe('STATION_UNAVAILABLE');
    expect(stationCodeOfError('BUDGET_EXHAUSTED')).toBe('STATION_UNAVAILABLE');
  });

  it('has copy for every code, and only a lost answer leaves the send uncertain', () => {
    expect(stationCopyKey('STATION_BUSY')).toBe('midnight.station.error.busy');
    expect(stationCopyKey('VOUCHER_SPENT')).toBe('midnight.station.error.voucher');
    // "Nothing was sent. Try again.": sealing again makes the transaction known to the worker.
    expect(stationCopyKey('SEAL_UNKNOWN')).toBe('midnight.station.error.voucher');
    expect(stationCopyKey('NOT_DELEGATED')).toBe('midnight.station.error.notEligible');
    expect(stationCopyKey('STATION_NO_ANSWER')).toBe('midnight.station.error.noAnswer');
    expect(stationSubmitUncertain('STATION_NO_ANSWER')).toBe(true);
    expect(stationSubmitUncertain('STATION_BUSY')).toBe(false);
  });
});
