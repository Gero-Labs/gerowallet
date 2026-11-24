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

describe('Solana dApp transactions', () => {
  const body = () => {
    const start = background.indexOf('function handleSolanaTransactionRequest(');
    expect(start).toBeGreaterThan(-1);
    return background.slice(start, background.indexOf('\n}\n', start));
  };

  it('both methods share one handler, gated like signMessage, and never change the transaction', () => {
    expect(handler('app.add(SOLANA_METHOD.signTransaction,')).toContain("handleSolanaTransactionRequest(request, sendResponse, 'sign')");
    expect(handler('app.add(SOLANA_METHOD.signAndSendTransaction,')).toContain("handleSolanaTransactionRequest(request, sendResponse, 'signAndSend')");
    const b = body();
    expect(b).toContain('if (!(await isSolanaDappEnabled())) return { error: SOLANA_NOT_AVAILABLE };');
    expect(b).toContain('if (!WalletStore.isWhitelisted(origin))');
    expect(b).toContain('if (address !== wallet.publicKey)');
    expect(b).toContain('chain !== solanaChainId(wallet.network)');
    expect(b).toContain('prepareSolanaDappTransaction(bytes, wallet.publicKey, api)');
    expect(b).toContain('grantSolanaTxAllowance(wallet.id, prepared.messageKey)');
    expect(b).toContain('isSignedByWalletOnly(prepared, signed, wallet.publicKey)');
    expect(b).toContain('still.id !== wallet.id');
    expect(b).toContain('releaseSolanaTxAllowance(wallet.id, prepared.messageKey)');
    // A submit with no answer may have landed: never "nothing was sent".
    expect(b).toContain('Gero could not confirm the transaction was sent');
  });

  it('the panel signs only a message whose preview is open, checked before any secret is opened', () => {
    const b = handler('app.addToOptions(MessageTypes.SIGN_SOLANA_TRANSACTION,');
    expect(b).toContain('refuseSettingsWhileLocked(request, sendResponse)');
    const check = b.indexOf('hasSolanaTxAllowance(wallet.id, solanaMessageKey(tx.messageBytes))');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(b.indexOf('wallet.signSolanaDappTransaction('));
    expect(read('senderTrust.ts')).toContain("'SIGN_SOLANA_TRANSACTION',");
  });
});

describe('Sign in with Solana', () => {
  it('checks the fields, builds the text itself, verifies the signature, and connects a new site', () => {
    const b = handler('app.add(SOLANA_METHOD.signIn,');
    expect(b).toContain('if (!(await isSolanaDappEnabled())) return { error: SOLANA_NOT_AVAILABLE };');
    expect(b).toContain('originHost = new URL(origin).host;');
    expect(b).toContain('checkSolanaSignIn((data as { input?: unknown } | undefined)?.input, { originHost, address: wallet.publicKey, chain })');
    expect(b).toContain('solanaSignInMessageText(check.fields)');
    expect(b).toContain('solanaSignMessageRefusal(bytes)');
    expect(b).toContain('verifySolanaSignature(signature, bytes, base58Decode(wallet.publicKey))');
    expect(b).toContain('still.id !== wallet.id');
    expect(b).toContain('const connected = WalletStore.isWhitelisted(origin);');
    // After the prompt: the window again (it may have expired meanwhile) and the whitelist again.
    expect(b.indexOf('solanaSignInTimeRefusal(check.fields)')).toBeGreaterThan(b.indexOf('parkMidnightRequest(SOLANA_METHOD.signIn'));
    expect(b).toContain('!WalletStore.isWhitelisted(origin) && !(await connectApproved({}, wallet.id, origin))');
  });

  it('is fast-pathed, parked, and rendered with the message signer', () => {
    expect(messaging).toContain('request.method === SOLANA_METHOD.signIn ||');
    expect(background).toContain('SOLANA_METHOD.signTransaction, SOLANA_METHOD.signIn]);');
    expect(overlay).toContain(`currentRequest.method === 'solana_signIn'`);
    expect(read('../sidepanel/services/dappRequestHub.ts')).toContain("'solana_signTransaction', 'solana_signIn',");
  });
});

describe('Solana account switches', () => {
  it('the store signals every tab with an event that carries nothing, on any change of account', () => {
    const store = read('../stores/walletStore.ts');
    expect(store).toContain("const accountChanged = walletStore.loggedWallet?.id !== loggedWallet?.id || prevAddress !== newAddress;");
    expect(store).toContain('{ target: TARGET, sender: SENDER.extension, event: SOLANA_ACCOUNT_SIGNAL },');
  });

  it('the relay passes that signal without data and without the whitelist round trip', () => {
    const at = messaging.indexOf('if (response.event === SOLANA_ACCOUNT_SIGNAL) {');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(messaging.indexOf('method: METHOD.isWhitelisted,', at - 2000 > 0 ? at - 2000 : 0));
    expect(messaging).toContain('window.dispatchEvent(new CustomEvent(`${TARGET}${SOLANA_ACCOUNT_SIGNAL}`));');
  });
});

describe('Solana relay and panel', () => {
  it('fast-paths the Solana methods and gives the page coded errors', () => {
    for (const name of ['available', 'connect', 'signMessage', 'signTransaction', 'signAndSendTransaction']) {
      expect(messaging).toContain(`request.method === SOLANA_METHOD.${name} ||`);
    }
    expect(messaging).toContain('if (SOLANA_METHOD_VALUES.has(method)) return toSolanaPageError(error);');
  });

  it('renders and answers both prompts, a decline as a coded rejection', () => {
    expect(overlay).toContain(`currentRequest.method === 'solana_connect'`);
    expect(overlay).toContain(`currentRequest.method === 'solana_signMessage'`);
    expect(overlay).toContain(`currentRequest.method === 'solana_signTransaction'`);
    expect(overlay).toContain('method: MessageTypes.SIGN_SOLANA_TRANSACTION,');
    // A critical warning blocks signing until acknowledged.
    expect(overlay).toContain('(!solanaTxPreview.value.requiresAcknowledgement || solanaTxAcknowledged.value)');
    expect(overlay).toContain("encodeSolanaPanelError(SolanaDappErrorCode.UserRejected, 'User rejected the request.')");
    expect(overlay).toContain('method: MessageTypes.SIGN_SOLANA_MESSAGE,');
    expect(read('../sidepanel/services/dappRequestHub.ts')).toContain("'solana_connect', 'solana_signMessage',");
    expect(read('connectApproval.ts')).toContain("'solana_connect'");
  });
});

describe('Solana prompts on a hardware wallet', () => {
  it('a device signs only message bytes the panel kept after the transaction refusal', () => {
    // solanaMessageBytes is null for bytes solanaSignMessageRefusal refuses (the worker refused
    // them before the prompt opened too), and the device signer reads nothing else.
    expect(overlay).toContain('return bytes && !solanaSignMessageRefusal(bytes) ? bytes : null;');
    const body = overlay.slice(overlay.indexOf('function signSolanaMessageHardware'), overlay.indexOf('function signSolanaTransactionHardware'));
    expect(body).toContain('const bytes = solanaMessageBytes.value;');
    expect(body).toContain("solanaHw.sign(bytes, 'message')");
  });

  it('a device signature reaches the dApp only through the worker checks', () => {
    const signIn = handler('app.add(SOLANA_METHOD.signIn,');
    expect(signIn).toContain('verifySolanaSignature(signature, bytes, base58Decode(wallet.publicKey))');
    expect(background).toContain('isSignedByWalletOnly(prepared, signed, wallet.publicKey)');
    const submit = handler('app.addToOptions(MessageTypes.SUBMIT_SOLANA_SEND,');
    expect(submit).toContain('isSolanaHardware(');
    expect(read('solanaSend.ts')).toContain('verifySolanaSignature(signature, pending.message, base58Decode(sender.publicKey))');
  });
});
