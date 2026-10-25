import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivedOwnAddresses } from './ownAddresses';

const ROOT = join(__dirname, '..', '..', '..');

describe('derivedOwnAddresses', () => {
  it('lists the base address and the derived payment and change addresses, once each', () => {
    const keys = {
      payment: [{ address: 'addr_base', cred: 'p0', path: "m/1852'/1815'/0'/0/0" }, { address: 'addr_p1', cred: 'p1', path: "m/1852'/1815'/0'/0/1" }],
      change: [{ address: 'addr_c0', cred: 'c0', path: "m/1852'/1815'/0'/1/0" }, { cred: 'c1', path: "m/1852'/1815'/0'/1/1" }],
    };
    expect(derivedOwnAddresses(keys, 'addr_base')).toEqual(['addr_base', 'addr_p1', 'addr_c0']);
    expect(derivedOwnAddresses(null, null)).toEqual([]);
  });

  it('is what the Strike withdraw and the swap signer count as change, never the UTxO list', () => {
    for (const file of ['src/modules/market/composables/useStrikeWithdraw.ts', 'src/modules/swap/composables/useNativeSwapSigner.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, file).toContain('derivedOwnAddresses(');
      expect(source, file).not.toMatch(/utxos[^\n]*\.map\(\(\[, ?out\]\) => String\(out\?\.address/);
    }
  });
});
