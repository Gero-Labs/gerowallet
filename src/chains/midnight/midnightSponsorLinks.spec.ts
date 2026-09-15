import { describe, expect, it } from 'vitest';
import {
  linkFor,
  sponsoredByWallet,
  sponsoredTxFor,
  withLink,
  withSponsoredTx,
  withoutLink,
  withoutWallet,
  type SponsorLink,
} from './midnightSponsorLinks';

const NOW = 1_800_000_000_000;

function link(over: Partial<SponsorLink> = {}): SponsorLink {
  return {
    walletId: 36,
    sponsorWalletId: 46,
    sponsorName: 'Cyber Nexus',
    network: 'Mainnet',
    at: NOW,
    ...over,
  };
}

describe('links', () => {
  it('stores and reads back a wallet sponsor', () => {
    expect(linkFor(withLink({}, link()), 36, 'Mainnet')?.sponsorName).toBe('Cyber Nexus');
  });

  it('replaces rather than accumulating when the sponsor changes', () => {
    const map = withLink(withLink({}, link()), link({ sponsorWalletId: 41, sponsorName: 'Frost Core' }));
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['36'].sponsorName).toBe('Frost Core');
  });

  it('never applies a link from another network', () => {
    // DUST is per-network; a mainnet sponsor cannot pay a preprod fee.
    expect(linkFor(withLink({}, link({ network: 'Preprod' })), 36, 'Mainnet')).toBeNull();
  });

  it('returns null for a wallet with no sponsor', () => {
    expect(linkFor({}, 99, 'Mainnet')).toBeNull();
  });

  it('turns sponsorship off', () => {
    expect(linkFor(withoutLink(withLink({}, link()), 36), 36, 'Mainnet')).toBeNull();
  });

  it('does not mutate the input map', () => {
    const before = withLink({}, link());
    withoutLink(before, 36);
    expect(before['36']).toBeDefined();
  });
});

describe('withoutWallet', () => {
  it('drops links where the wallet is sponsored', () => {
    const map = withLink({}, link());
    expect(Object.keys(withoutWallet(map, 36))).toHaveLength(0);
  });

  it('drops links where the wallet is the sponsor', () => {
    // Otherwise a deleted wallet keeps being named as the payer.
    const map = withLink({}, link());
    expect(Object.keys(withoutWallet(map, 46))).toHaveLength(0);
  });

  it('keeps links that mention neither', () => {
    const map = withLink({}, link());
    expect(Object.keys(withoutWallet(map, 99))).toHaveLength(1);
  });
});

describe('sponsoredByWallet', () => {
  it('lists the wallets a sponsor pays for', () => {
    const map = withLink(withLink({}, link()), link({ walletId: 41 }));
    expect(sponsoredByWallet(map, 46, 'Mainnet').map((l) => l.walletId)).toEqual([36, 41]);
  });

  it('is empty for a wallet sponsoring nobody', () => {
    expect(sponsoredByWallet(withLink({}, link()), 99, 'Mainnet')).toEqual([]);
  });

  it('ignores links on another network', () => {
    expect(sponsoredByWallet(withLink({}, link({ network: 'Preprod' })), 46, 'Mainnet')).toEqual([]);
  });
});

describe('transaction attribution', () => {
  const record = { txHash: 'AbC123', sponsorWalletId: 46, sponsorName: 'Cyber Nexus', at: NOW };

  it('matches a hash regardless of case', () => {
    const map = withSponsoredTx({}, record);
    expect(sponsoredTxFor(map, 'abc123')?.sponsorName).toBe('Cyber Nexus');
    expect(sponsoredTxFor(map, 'ABC123')?.sponsorName).toBe('Cyber Nexus');
  });

  it('returns null for a transaction the wallet paid itself', () => {
    expect(sponsoredTxFor(withSponsoredTx({}, record), 'other')).toBeNull();
  });

  it('returns null for an empty hash rather than matching something', () => {
    expect(sponsoredTxFor(withSponsoredTx({}, record), '')).toBeNull();
  });

  it('survives the link being turned off afterwards', () => {
    // History records what happened; it must not change when a preference does.
    const txs = withSponsoredTx({}, record);
    withoutLink(withLink({}, link()), 36);
    expect(sponsoredTxFor(txs, 'abc123')).not.toBeNull();
  });
});
