import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tripwire: the lock is enforced in background.ts, not only by the lock screen.
 * The rules themselves are unit-tested in unlockGuards.spec.ts and
 * walletManager.unlock.spec.ts; this keeps the wiring from silently going away.
 */

const source = readFileSync(join(__dirname, 'background.ts'), 'utf8');

/** Body of `app.addToOptions(MessageTypes.<name>, …)` up to the next registration. */
function optionsHandler(name: string): string {
  const start = source.indexOf(`app.addToOptions(MessageTypes.${name},`);
  expect(start, `${name} is registered`).toBeGreaterThan(-1);
  const next = source.indexOf('\napp.addToOptions(', start + 10);
  return source.slice(start, next < 0 ? undefined : next);
}

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = source.indexOf('\n}\n', start);
  return source.slice(start, next);
}

describe('security settings refuse while locked', () => {
  it.each([
    'SET_REMOTE_SIGNING_ENABLED',
    'SET_CROSS_DEVICE_POLICY',
    'SET_SERVE_PROOFS_ENABLED',
    'SET_DEVICE_SERVE_PROOFS',
    'TRUST_CROSS_DEVICE',
    'UNTRUST_CROSS_DEVICE',
    // Notification settings: which wallets and events alert the user.
    'NOTIFY_SET_BROWSER_ENABLED',
    'NOTIFY_ENABLE_WALLET',
    'NOTIFY_DISABLE_WALLET',
    'NOTIFY_SET_PREFS',
    // Pairing a dApp session over WalletConnect or CIP-45.
    'WC_APPROVE_SESSION',
    'CIP45_BEGIN_SESSION',
  ])('%s', name => {
    expect(optionsHandler(name)).toContain('refuseSettingsWhileLocked(request, sendResponse)');
  });

  it('DEREGISTER_MPC_ACCOUNT (deletes the Google account\'s recovery shares), with a readable reason', () => {
    expect(optionsHandler('DEREGISTER_MPC_ACCOUNT'))
      .toContain("refuseSettingsWhileLocked(request, sendResponse, String(i18n.t('welcome.resetGoogleAccountLocked')))");
  });

  it('every Submit API handler (set, test, clear)', () => {
    expect(functionBody('registerSubmitApiHandler')).toContain('refuseSettingsWhileLocked(request, sendResponse, failure)');
    for (const name of ['SET_SUBMIT_API', 'TEST_SUBMIT_API', 'CLEAR_SUBMIT_API']) {
      expect(source).toContain(`registerSubmitApiHandler(MessageTypes.${name},`);
    }
  });
});

describe('LOGIN never unlocks a locked or logged-out session by itself', () => {
  it('every background login goes through the lock policy', () => {
    const body = functionBody('loginWallet');
    expect(body).toContain('await loginRequiresUnlock(wallet)');
    expect(body).toContain('walletManager.login(wallet, { requireUnlock })');
    expect(optionsHandler('LOGIN')).toContain('loginWallet(request.data.wallet)');
  });

  it('a verified pre-login unlock grants the LOGIN that follows', () => {
    expect(optionsHandler('VERIFY_PRE_LOGIN_UNLOCK')).toContain('preLoginGrants.grant(');
    expect(functionBody('loginRequiresUnlock')).toContain('preLoginGrants.consume(group.id)');
  });
});

describe('unlock paths', () => {
  it('the MPC unlock checks 2FA like the others', () => {
    expect(optionsHandler('UNLOCK_MPC_WALLET')).toContain('verifySecondFactor(');
  });

  it('UNLOCK and the pre-login unlock report the back-off wait', () => {
    expect(optionsHandler('UNLOCK')).toContain('retryAfterMs: err.retryAfterMs');
    expect(optionsHandler('VERIFY_PRE_LOGIN_UNLOCK')).toContain('retryAfterMs: err.retryAfterMs');
  });
});

describe('every check of a wallet\'s secrets shares the unlock back-off', () => {
  it('the MPC unlock counts wrong device secrets and reports the wait', () => {
    const body = optionsHandler('UNLOCK_MPC_WALLET');
    expect(body).toContain('withUnlockThrottle(');
    expect(body).toContain('error instanceof MpcCredentialRejectedError');
    expect(body).toContain('retryAfterMs: error.retryAfterMs');
  });

  it('VERIFY_SPENDING_PASSWORD reports the wait', () => {
    expect(optionsHandler('VERIFY_SPENDING_PASSWORD')).toContain('retryAfterMs: error.retryAfterMs');
  });

  it('the wait message is translated in the worker', () => {
    expect(source).toContain("setUnlockThrottleMessage((seconds) => String(i18n.t('unlockGuard.tooManyAttempts', { seconds })))");
  });
});

describe('no unlock is granted on the page\'s word', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : [];
    });
  }

  it('the old magic unlock signals are gone from every page and the worker', () => {
    const offenders = sources(join(__dirname, '..')).filter(path => {
      const text = readFileSync(path, 'utf8');
      return text.includes('passkey-authenticated') || text.includes('lockpassword-verified');
    });
    expect(offenders).toEqual([]);
  });

  it('UNLOCK and the pre-login unlock hand the PassKey PRF output to the worker\'s check', () => {
    expect(optionsHandler('UNLOCK')).toContain('passKeyPrfOf(request.data)');
    expect(optionsHandler('VERIFY_PRE_LOGIN_UNLOCK')).toContain('passKeyPrfOf(request.data)');
  });
});
