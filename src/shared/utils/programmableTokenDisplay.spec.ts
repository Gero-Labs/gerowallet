// Four render sites share this helper, so the two locked cases can't drift apart:
// a programmable token Gero won't transfer, vs the ADA locked inside those UTxOs
// (priced and counted in the portfolio total, but not spendable through Gero).
import { describe, it, expect, beforeEach } from 'vitest';
import { programmableTooltipKey, isProgrammableRow } from './programmableTokenDisplay';
import { walletStore } from '@/stores/walletStore';

describe('programmableTooltipKey', () => {
  it('explains locked ADA on the lovelace row', () => {
    expect(programmableTooltipKey('lovelace')).toBe('programmableTokens.lockedAdaTooltip');
  });

  it('explains the transfer restriction on a token row', () => {
    const unit = '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee92654657374313233';
    expect(programmableTooltipKey(unit)).toBe('programmableTokens.badgeTooltip');
  });
});

describe('isProgrammableRow', () => {
  const UNIT = '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee92654657374313233';

  beforeEach(() => {
    walletStore.programmableTokens = {};
  });

  it('trusts a row that already carries the flag', () => {
    expect(isProgrammableRow({ unit: UNIT, isProgrammable: true })).toBe(true);
  });

  // The regression this helper exists for: market rows are stamped once per fetch, and
  // the market list normally loads before sync delivers the programmable UTxOs. A row
  // built in that window carries isProgrammable=false and must still be recognised.
  it('recognises a stale market row once the holdings land', () => {
    const staleRow = { unit: UNIT, isProgrammable: false };
    expect(isProgrammableRow(staleRow)).toBe(false);

    walletStore.programmableTokens = { [UNIT]: { unit: UNIT, quantity: 5 } };

    expect(isProgrammableRow(staleRow)).toBe(true);
  });

  it('leaves ordinary holdings alone', () => {
    walletStore.programmableTokens = { [UNIT]: { unit: UNIT, quantity: 5 } };
    expect(isProgrammableRow({ unit: 'lovelace' })).toBe(false);
    expect(isProgrammableRow({ unit: 'someOtherUnit' })).toBe(false);
  });

  it('tolerates a missing row or unit', () => {
    expect(isProgrammableRow(null)).toBe(false);
    expect(isProgrammableRow(undefined)).toBe(false);
    expect(isProgrammableRow({})).toBe(false);
  });
});
