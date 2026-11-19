// The Solana dApp connection's worker, relay and panel wiring, read from source (the handlers
// live inside background.ts's single module, as the other connector wiring specs read them).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(__dirname, path), 'utf8').replace(/\r\n/g, '\n');
const background = read('background.ts');
const messaging = read('messaging.ts');
const overlay = read('../sidepanel/components/DAppOverlay.vue');

/** The body of `app.add(SOLANA_METHOD.<name>, …)` / `app.addToOptions(MessageTypes.<name>, …)`. */
function handler(registration: string): string {
  const start = background.indexOf(registration);
  expect(start).toBeGreaterThan(-1);
  const next = background.slice(start + 10).search(/\napp\.add(ToOptions)?\(/);
  return background.slice(start, next < 0 ? undefined : start + 10 + next);
}

describe('Solana dApp handlers', () => {
  it('every method refuses while the isSolanaEnabled flag is off', () => {
    expect(background).toContain("return (await readFeatureFlagMirror())['isSolanaEnabled'] === true;");
    for (const name of ['connect', 'signMessage']) {
      expect(handler(`app.add(SOLANA_METHOD.${name},`)).toContain('if (!(await isSolanaDappEnabled())) return { error: SOLANA_NOT_AVAILABLE };');
    }
    expect(handler('app.add(SOLANA_METHOD.available,')).toContain('isSolanaDappEnabled()');
  });

  it('connect answers a connected site at once, never prompts a silent call, and parks the prompt otherwise', () => {
    const body = handler('app.add(SOLANA_METHOD.connect,');
    expect(body).toContain('solanaDappWallet()');
    expect(body).toMatch(/if \(WalletStore\.isWhitelisted\(origin\)\) \{\s*return \{ data: \{ address: wallet\.publicKey/);
    expect(body).toContain("'This site is not connected'");
    expect(body).toContain('parkMidnightRequest(SOLANA_METHOD.connect, payload, tabId)');
    expect(body).toContain('connectApproved(approval, wallet.id, origin)');
  });

  it('signMessage gates on the whitelist and the account, refuses transactions, and checks the signature it returns', () => {
    const body = handler('app.add(SOLANA_METHOD.signMessage,');
    expect(body).toContain('if (!WalletStore.isWhitelisted(origin))');
    expect(body).toContain('if (address !== wallet.publicKey)');
    expect(body).toContain('solanaSignMessageRefusal(bytes)');
    expect(body).toContain('verifySolanaSignature(signature, bytes, base58Decode(wallet.publicKey))');
    expect(body).toContain('still.id !== wallet.id');
  });

  it('the panel sign call is extension-page only, closed while locked, and re-checks the bytes', () => {
    const body = handler('app.addToOptions(MessageTypes.SIGN_SOLANA_MESSAGE,');
    expect(body).toContain('refuseSettingsWhileLocked(request, sendResponse)');
    expect(body).toContain('solanaSignMessageRefusal(bytes)');
    expect(read('senderTrust.ts')).toContain("'SIGN_SOLANA_MESSAGE',");
  });
});

describe('Solana relay and panel', () => {
  it('fast-paths the three methods and gives the page coded errors', () => {
    for (const name of ['available', 'connect', 'signMessage']) {
      expect(messaging).toContain(`request.method === SOLANA_METHOD.${name} ||`);
    }
    expect(messaging).toContain('if (SOLANA_METHOD_VALUES.has(method)) return toSolanaPageError(error);');
  });

  it('renders and answers both prompts, a decline as a coded rejection', () => {
    expect(overlay).toContain(`currentRequest.method === 'solana_connect'`);
    expect(overlay).toContain(`currentRequest.method === 'solana_signMessage'`);
    expect(overlay).toContain("encodeSolanaPanelError(SolanaDappErrorCode.UserRejected, 'User rejected the request.')");
    expect(overlay).toContain('method: MessageTypes.SIGN_SOLANA_MESSAGE,');
    expect(read('../sidepanel/services/dappRequestHub.ts')).toContain("'solana_connect', 'solana_signMessage',");
    expect(read('connectApproval.ts')).toContain("'solana_connect'");
  });
});
