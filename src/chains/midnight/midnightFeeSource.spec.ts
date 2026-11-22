import { describe, expect, it } from 'vitest';
import { chooseMidnightFeeSource } from './midnightFeeSource';

const base = { mayLackDust: true, feeWalletChosen: false, stationAvailable: true, stationOptedOut: false, shielded: false };

describe('who pays a Midnight fee', () => {
  it('the wallet itself while it has a fee\'s worth of DUST, whatever else is on offer', () => {
    expect(chooseMidnightFeeSource({ ...base, mayLackDust: false })).toBe('own');
    expect(chooseMidnightFeeSource({ ...base, mayLackDust: false, feeWalletChosen: true })).toBe('own');
  });

  it('a fee wallet the user chose comes before the station', () => {
    expect(chooseMidnightFeeSource({ ...base, feeWalletChosen: true })).toBe('feeWallet');
  });

  it('the station only when the first two cannot pay and it is available', () => {
    expect(chooseMidnightFeeSource(base)).toBe('station');
    expect(chooseMidnightFeeSource({ ...base, stationAvailable: false })).toBe('own');
  });

  it('never the station when the user opted out or the send is shielded', () => {
    expect(chooseMidnightFeeSource({ ...base, stationOptedOut: true })).toBe('own');
    expect(chooseMidnightFeeSource({ ...base, shielded: true })).toBe('own');
  });
});
