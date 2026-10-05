import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installMoonpayFrameRule, moonpayFrameRule, MOONPAY_FRAME_RULE_ID } from './moonpayFrameRule';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('MoonPay frame-header rule', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('only applies to frames this extension initiates', () => {
    const rule = moonpayFrameRule('abcdefghijklmnopabcdefghijklmnop');
    expect(rule.condition.initiatorDomains).toEqual(['abcdefghijklmnopabcdefghijklmnop']);
    expect(rule.condition.urlFilter).toBe('||moonpay.com^');
    expect(rule.condition.resourceTypes).toEqual(['sub_frame']);
    expect(rule.action.responseHeaders?.map((h) => h.header)).toEqual(['content-security-policy', 'x-frame-options']);
  });

  it('is installed as a session rule with the runtime extension id', async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { runtime: { id: 'ext-id' }, declarativeNetRequest: { updateSessionRules } });
    await installMoonpayFrameRule();
    expect(updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [MOONPAY_FRAME_RULE_ID],
      addRules: [moonpayFrameRule('ext-id')],
    });
  });

  it('the static, initiator-less ruleset is gone from the manifest', () => {
    const manifest = read('scripts/manifest.ts');
    expect(manifest).not.toMatch(/rule_resources:\s*\[/);
    expect(existsSync(join(ROOT, 'src/assets/public/dnr_rules.json'))).toBe(false);
  });
});

describe('page reply envelope (relay)', () => {
  it('gives a bare transport error the envelope the page matches on', async () => {
    const { toPageReply } = await import('./messaging');
    const { SENDER, TARGET, APIError } = await import('./config');
    expect(toPageReply({ error: 'Could not establish connection' }, 'r1'))
      .toEqual({ error: 'Could not establish connection', id: 'r1', target: TARGET, sender: SENDER.extension });
    expect(toPageReply(undefined, 'r2')).toEqual({ error: APIError.InternalError, id: 'r2', target: TARGET, sender: SENDER.extension });
  });

  it('leaves a complete background reply untouched (including data: undefined)', async () => {
    const { toPageReply } = await import('./messaging');
    const { SENDER, TARGET } = await import('./config');
    const reply = { id: 'r3', data: undefined, target: TARGET, sender: SENDER.extension };
    expect(toPageReply(reply, 'r3')).toBe(reply);
  });
});

describe('hygiene tripwires', () => {
  const bg = read('src/chrome/background.ts');
  const handler = (name: string) => {
    const start = bg.indexOf(`app.add(${name},`);
    expect(start).toBeGreaterThan(-1);
    const next = bg.indexOf('\napp.add', start + 10);
    return bg.slice(start, next < 0 ? undefined : next);
  };

  it('drops the unused scripting permission', () => {
    expect(read('scripts/manifest.ts')).not.toContain("'scripting'");
  });

  it('a boot-time failure to read the unlock method never unlocks the wallet', () => {
    const block = bg.slice(bg.indexOf('Failed to check unlock method for stale lock'), bg.indexOf('Failed to check unlock method for stale lock') + 200);
    expect(block).not.toContain('setLocked(false)');
  });

  it('wallet-data reads refuse while the wallet is locked', () => {
    const gated = ['METHOD.getBalance', 'METHOD.getAddress', 'METHOD.getRewardAddresses', 'METHOD.getUtxos', 'METHOD.getCollateral',
      'METHOD.getUsedAddresses', 'METHOD.getUnusedAddresses', 'METHOD.getPubDRepKey', 'METHOD.getRegisteredPubStakeKeys',
      'METHOD.getUnregisteredPubStakeKeys', 'METHOD.getAccountPub', 'BITCOIN_METHOD.getAccounts', 'BITCOIN_METHOD.getPublicKey',
      'BITCOIN_METHOD.getBalance', 'BITCOIN_METHOD.getUtxos'];
    for (const name of gated) expect(handler(name)).toContain('refuseWhileLocked(request, sendResponse)');
  });

  it('no longer logs wallet records or transaction / witness CBOR', () => {
    for (const pattern of [/console\.log\('login', request\)/, /console\.log\('restore', request\)/, /console\.log\('submit tx', request\)/,
      /console\.log\('original Cbor'/, /console\.log\('witnessHex'/, /console\.log\('Deserializing CBOR transaction:'/,
      /console\.log\('Submitting transaction with witnesses:'/]) {
      expect(bg).not.toMatch(pattern);
    }
  });
});
