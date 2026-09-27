import { beforeEach, describe, expect, it } from 'vitest';
import { PENDING_MAX_AGE_MS, readPendingOrders, savePendingOrders } from './pendingOrders';

const TX = 'e78bc07cd1d99e2ef6b8607beedf02956c5271b890f7816f6f66e3fc2adb7f86';

describe('pending orders storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per network and address', () => {
    savePendingOrders('Preprod', 'addr_a', [{ txId: TX, kind: 'unstake', at: 1000 }]);

    expect(readPendingOrders('Preprod', 'addr_a', 2000)).toEqual([
      { txId: TX, kind: 'unstake', at: 1000 },
    ]);
    expect(readPendingOrders('Preprod', 'addr_b', 2000)).toEqual([]);
    expect(readPendingOrders('Mainnet', 'addr_a', 2000)).toEqual([]);
  });

  it('drops what has aged out', () => {
    savePendingOrders('Preprod', 'addr_a', [{ txId: TX, kind: 'stake', at: 0 }]);

    expect(readPendingOrders('Preprod', 'addr_a', PENDING_MAX_AGE_MS)).toEqual([]);
  });

  it('ignores anything that is not a pending order', () => {
    localStorage.setItem(
      'realfi.pendingOrders:Preprod:addr_a',
      JSON.stringify([{ txId: 'nope', kind: 'stake', at: 1 }, { txId: TX, kind: 'swap', at: 1 }, 7]),
    );

    expect(readPendingOrders('Preprod', 'addr_a', 2)).toEqual([]);
  });

  it('clears the entry once nothing is pending', () => {
    savePendingOrders('Preprod', 'addr_a', [{ txId: TX, kind: 'stake', at: 1 }]);
    savePendingOrders('Preprod', 'addr_a', []);

    expect(localStorage.getItem('realfi.pendingOrders:Preprod:addr_a')).toBeNull();
  });
});
