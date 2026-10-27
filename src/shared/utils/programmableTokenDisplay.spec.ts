// Four render sites share this helper, so the two locked cases can't drift apart:
// a programmable token Gero won't transfer, vs the ADA locked inside those UTxOs
// (priced and counted in the portfolio total, but not spendable through Gero).
import { describe, it, expect, beforeEach } from 'vitest';
import { programmableTooltipKey, isProgrammableRow, isCip113BadgeRow, lockedRowMessageKey } from './programmableTokenDisplay';
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

// Issue 1267: being locked at the programmable address is not enough for the CIP-113 badge.
// Anyone can send a token there; only a policy the CIP-113 registry lists gets the badge.
describe('isCip113BadgeRow and lockedRowMessageKey', () => {
  const REGISTERED = '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee92654657374313233';
  const UNREGISTERED = 'd'.repeat(56) + '41495244524f50';

  beforeEach(() => {
    walletStore.programmableTokens = {
      [REGISTERED]: { unit: REGISTERED, quantity: 5, isProgrammable: true, cip113Registered: true },
      [UNREGISTERED]: { unit: UNREGISTERED, quantity: 5, isProgrammable: true, cip113Registered: false },
    };
  });

  it('badges a locked token whose policy the registry lists', () => {
    expect(isCip113BadgeRow({ unit: REGISTERED, isProgrammable: true })).toBe(true);
    expect(lockedRowMessageKey({ unit: REGISTERED, isProgrammable: true })).toBe('programmableTokens.badgeTooltip');
  });

  it('does not badge a locked token the registry does not list, and says why it is locked', () => {
    expect(isCip113BadgeRow({ unit: UNREGISTERED, isProgrammable: true })).toBe(false);
    expect(isProgrammableRow({ unit: UNREGISTERED, isProgrammable: true })).toBe(true);
    expect(lockedRowMessageKey({ unit: UNREGISTERED, isProgrammable: true })).toBe('programmableTokens.unregisteredTooltip');
  });

  it('badges nothing before the registry has been read', () => {
    walletStore.programmableTokens = { [REGISTERED]: { unit: REGISTERED, quantity: 5, isProgrammable: true } };
    expect(isCip113BadgeRow({ unit: REGISTERED, isProgrammable: true })).toBe(false);
  });

  it('keeps the lock on the locked-ADA row', () => {
    expect(isCip113BadgeRow({ unit: 'lovelace', isProgrammable: true })).toBe(true);
    expect(lockedRowMessageKey({ unit: 'lovelace', isProgrammable: true })).toBe('programmableTokens.lockedAdaTooltip');
  });

  it('leaves ordinary holdings alone', () => {
    expect(isCip113BadgeRow({ unit: 'someOtherUnit' })).toBe(false);
    expect(isCip113BadgeRow({ unit: 'lovelace' })).toBe(false);
    expect(isCip113BadgeRow(null)).toBe(false);
  });
});
