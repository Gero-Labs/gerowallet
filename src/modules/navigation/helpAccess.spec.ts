import { describe, expect, it } from 'vitest';
import { blogHelpRedirect, helpUnlockPath, isHelpReady, isPublicRoute } from './helpAccess';

describe('public Help access', () => {
  it('keeps cold/off Blog visits in place and migrates only after resolved enablement', () => {
    expect(blogHelpRedirect(false, true)).toBeNull();
    expect(blogHelpRedirect(true, false)).toBeNull();
    expect(blogHelpRedirect(true, true)).toBe('/help/updates?source=blog');
  });
  it('requires explicit public metadata and does not weaken protected routes', () => {
    expect(isPublicRoute({ meta: { public: true } })).toBe(true);
    expect(isPublicRoute({ matched: [{ meta: { public: true } }] })).toBe(true);
    expect(isPublicRoute({ meta: { requiresAuth: true } })).toBe(false);
    expect(isPublicRoute({})).toBe(false);
  });
  it('uses readiness, not saved-wallet presence, for wallet chrome', () => {
    expect(isHelpReady({ loggedWallet: null, isLocked: false, isSyncing: false })).toBe(false);
    expect(isHelpReady({ loggedWallet: {}, isLocked: true, isSyncing: false })).toBe(false);
    expect(isHelpReady({ loggedWallet: {}, isLocked: false, isSyncing: true })).toBe(false);
    expect(isHelpReady({ loggedWallet: {}, isLocked: false, isSyncing: false })).toBe(true);
  });
  it('round trips all article and search context through welcome', () => {
    const path = '/help/articles/midnight-dust?q=proof%20server&chain=midnight&source=blog';
    expect(decodeURIComponent(helpUnlockPath(path).split('redirect=')[1])).toBe(path);
  });
});
