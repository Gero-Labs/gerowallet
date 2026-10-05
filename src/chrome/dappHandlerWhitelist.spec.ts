import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tripwire: every dApp-facing handler in background.ts re-checks the origin
 * whitelist in the background itself. The content relay pre-checks too, but
 * that check runs inside the page's renderer process, so it is not a trust
 * boundary on its own.
 *
 * A new `app.add(METHOD.* | BITCOIN_METHOD.* | MIDNIGHT_METHOD.*)` handler fails
 * this test until it gates on `WalletStore.isWhitelisted(...)` (or one of the
 * shared gates below), or is added to EXEMPT with a reason.
 */

const SHARED_GATES = ['isWhitelisted(', 'requireMidnightProvingOrigin(', 'handleMidnightDappProving('];

const EXEMPT: Record<string, string> = {
  'METHOD.popupLogin': 'only opens the wallet UI; returns no wallet data',
  'MIDNIGHT_METHOD.getConnectionStatus': 'public by design: reports connected/disconnected and network id',
  'MIDNIGHT_METHOD.hintUsage': 'no-op that resolves void',
};

function handlers(): Array<{ name: string; body: string }> {
  const source = readFileSync(join(__dirname, 'background.ts'), 'utf8');
  const out: Array<{ name: string; body: string }> = [];
  const re = /\napp\.add\(((?:METHOD|BITCOIN_METHOD|MIDNIGHT_METHOD)\.\w+),/g;
  const starts: Array<{ name: string; index: number }> = [];
  for (let m = re.exec(source); m; m = re.exec(source)) starts.push({ name: m[1], index: m.index });
  for (const s of starts) {
    const next = source.indexOf('\napp.add', s.index + 10);
    out.push({ name: s.name, body: source.slice(s.index, next < 0 ? undefined : next) });
  }
  return out;
}

describe('background dApp handlers re-check the whitelist', () => {
  const all = handlers();

  it('finds the handlers (guards against the regex silently matching nothing)', () => {
    expect(all.length).toBeGreaterThan(40);
    for (const name of ['METHOD.getUtxos', 'METHOD.signTx', 'METHOD.getAccountPub', 'BITCOIN_METHOD.signPsbt', 'MIDNIGHT_METHOD.makeTransfer']) {
      expect(all.some(h => h.name === name)).toBe(true);
    }
  });

  it('every non-exempt handler gates on the whitelist', () => {
    const missing = all
      .filter(h => !(h.name in EXEMPT))
      .filter(h => !SHARED_GATES.some(g => h.body.includes(g)))
      .map(h => h.name);
    expect(missing).toEqual([]);
  });

  it('every exemption still exists (no stale entries)', () => {
    for (const name of Object.keys(EXEMPT)) expect(all.some(h => h.name === name)).toBe(true);
  });
});
