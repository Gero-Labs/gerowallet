import { describe, it, expect } from 'vitest';
import tokenMetadataStoreApi, { tokenMetadataStore } from '../tokenMetadataStore';

describe('tokenMetadataStore', () => {
  it('exposes the metadata state shape used by non-swap consumers', () => {
    expect(tokenMetadataStoreApi).toBeDefined();
    // state map + blacklist are the fields resolver.ts / useMarketData depend on
    expect(tokenMetadataStoreApi.state).toHaveProperty('tokens');            // renamed-neutral token map
    expect(tokenMetadataStoreApi.state).toHaveProperty('blacklistPolicies');
    expect(typeof tokenMetadataStoreApi.loadTokens).toBe('function');
    expect(typeof tokenMetadataStoreApi.loadBlacklistPolicies).toBe('function');

    // the raw observable (named export) is what toRefs()-based consumers (e.g. TokensTab.vue) read from
    expect(tokenMetadataStore).toHaveProperty('tokens');
    expect(tokenMetadataStore).toHaveProperty('blacklistPolicies');
  });
});
