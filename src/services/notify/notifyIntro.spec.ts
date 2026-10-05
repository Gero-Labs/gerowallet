import { describe, it, expect } from 'vitest';
import { notifyServiceAvailable, promptWanted, readIntroState, systemIntroWanted, type NotifyIntroState } from './notifyIntro';
import type { NotifyConfig } from './notifyTypes';

const CONFIG: NotifyConfig = {
  protocol: 1, protocols: [1], minClientProtocol: 1, enabled: true, vapidPublicKey: 'k', vapidKid: 'v1',
  categories: ['funds'], securityCategories: ['remoteSigning'], networks: ['cardano-mainnet'],
  servedCategories: { webpush: { 'cardano-mainnet': ['funds'] } },
  limits: { walletsPerDevice: 20, devicesPerWallet: 50, paymentCredsPerLink: 200, paymentCredsPerWallet: 200 }, serverTime: 0,
};
const NEVER: NotifyIntroState = { systemShownAt: null, dismissedAt: null, offered: {} };
const wallet = (over: Partial<{ id: number; eligible: boolean; registered: boolean }> = {}) => ({ id: 4, eligible: true, registered: false, ...over });

describe('readIntroState', () => {
  it('fills every field from nothing, a corrupt value, or a partial record', () => {
    expect(readIntroState(undefined)).toEqual(NEVER);
    expect(readIntroState('nope')).toEqual(NEVER);
    expect(readIntroState([1])).toEqual(NEVER);
    expect(readIntroState({ dismissedAt: 7, offered: { 4: 9, 5: 'x' }, systemShownAt: 'later' })).toEqual({ systemShownAt: null, dismissedAt: 7, offered: { 4: 9 } });
  });
});

describe('notifyServiceAvailable', () => {
  it('needs a push manager and a served config with a VAPID key', () => {
    expect(notifyServiceAvailable(true, CONFIG)).toBe(true);
    expect(notifyServiceAvailable(false, CONFIG)).toBe(false);
    expect(notifyServiceAvailable(true, null)).toBe(false);
    expect(notifyServiceAvailable(true, { ...CONFIG, enabled: false })).toBe(false);
    expect(notifyServiceAvailable(true, { ...CONFIG, vapidPublicKey: null })).toBe(false);
    expect(notifyServiceAvailable(true, { ...CONFIG, vapidKid: null })).toBe(false);
  });
});

describe('promptWanted (the in-app prompt for the open wallet)', () => {
  const base = { intro: NEVER, pushSupported: true, config: CONFIG };

  it('offers an eligible, unlinked wallet once', () => {
    expect(promptWanted({ ...base, wallet: wallet() })).toBe(true);
  });

  it('never offers where push cannot work', () => {
    expect(promptWanted({ ...base, pushSupported: false, wallet: wallet() })).toBe(false);
    expect(promptWanted({ ...base, config: null, wallet: wallet() })).toBe(false);
    expect(promptWanted({ ...base, config: { ...CONFIG, enabled: false }, wallet: wallet() })).toBe(false);
  });

  it('skips a linked, ineligible or missing wallet', () => {
    expect(promptWanted({ ...base, wallet: wallet({ registered: true }) })).toBe(false);
    expect(promptWanted({ ...base, wallet: wallet({ eligible: false }) })).toBe(false);
    expect(promptWanted({ ...base, wallet: null })).toBe(false);
  });

  it('"Not now" ends every automatic offer; "Turn on" ends it for that wallet only', () => {
    expect(promptWanted({ ...base, intro: { ...NEVER, dismissedAt: 1 }, wallet: wallet() })).toBe(false);
    const offered = { ...NEVER, offered: { '4': 1 } };
    expect(promptWanted({ ...base, intro: offered, wallet: wallet() })).toBe(false);
    expect(promptWanted({ ...base, intro: offered, wallet: wallet({ id: 5 }) })).toBe(true);
  });

  it('the system notification having been shown does not stop the prompt', () => {
    expect(promptWanted({ ...base, intro: { ...NEVER, systemShownAt: 1 }, wallet: wallet() })).toBe(true);
  });
});

describe('systemIntroWanted (the notification after an update)', () => {
  const base = { intro: NEVER, pushSupported: true, config: CONFIG };

  it('fires once while some wallet could be linked and none is', () => {
    expect(systemIntroWanted({ ...base, wallets: [wallet({ eligible: false }), wallet()] })).toBe(true);
    expect(systemIntroWanted({ ...base, intro: { ...NEVER, systemShownAt: 1 }, wallets: [wallet()] })).toBe(false);
    expect(systemIntroWanted({ ...base, intro: { ...NEVER, dismissedAt: 1 }, wallets: [wallet()] })).toBe(false);
  });

  it('stays quiet for early adopters, for installs with nothing eligible, and where push cannot work', () => {
    expect(systemIntroWanted({ ...base, wallets: [wallet(), wallet({ id: 5, registered: true })] })).toBe(false);
    expect(systemIntroWanted({ ...base, wallets: [wallet({ eligible: false })] })).toBe(false);
    expect(systemIntroWanted({ ...base, wallets: [] })).toBe(false);
    expect(systemIntroWanted({ ...base, pushSupported: false, wallets: [wallet()] })).toBe(false);
    expect(systemIntroWanted({ ...base, config: null, wallets: [wallet()] })).toBe(false);
  });
});
