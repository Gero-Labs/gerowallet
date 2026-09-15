import { describe, expect, it } from 'vitest';
import {
  chargePercent,
  hasReadySponsor,
  sponsorCandidates,
  sponsorStateFor,
  type DustStatusRow,
  type SponsorWalletRef,
} from './midnightSponsorEligibility';

// The real addresses from the mainnet session, which is where every rule here
// came from. Cyber Nexus turned out to be the DUST destination; Primal Spectre
// displayed a full battery while owning nothing.
const CYBER_NEXUS_DUST = 'mn_dust1wwa2ed36ev3zns927zaxgzx2dsf8fxysa2mnmdaemaq75nwnpu535ammlsp';
const PRIMAL_DUST = 'mn_dust1wvlhuqzu0a2kqnchn33cf2qgsldzw0tl7083zwgzlufmaawr05u56etug5q';
const ADAM_STAKE = 'stake1uxc59p7uc7dq872mh6cxjwm4wy9ma5rv6rm6v4qh4dd7sacdssaxm';

function wallet(over: Partial<SponsorWalletRef> = {}): SponsorWalletRef {
  return { id: 46, name: 'Cyber Nexus', network: 'Mainnet', dustAddress: CYBER_NEXUS_DUST, ...over };
}

function row(over: Partial<DustStatusRow> = {}): DustStatusRow {
  return {
    cardanoRewardAddress: ADAM_STAKE,
    dustAddress: CYBER_NEXUS_DUST,
    registered: true,
    currentCapacity: '4880300000',
    ...over,
  };
}

describe('sponsorStateFor', () => {
  it('is ready when a live registration pays into the wallet', () => {
    const c = sponsorStateFor(wallet(), [row()]);
    expect(c.state).toBe('ready');
    expect(c.capacity).toBe(4_880_300_000n);
    expect(c.fundedBy).toEqual([ADAM_STAKE]);
  });

  it('matches the dust address case-insensitively', () => {
    expect(sponsorStateFor(wallet(), [row({ dustAddress: CYBER_NEXUS_DUST.toUpperCase() })]).state)
      .toBe('ready');
  });

  it('does NOT credit a wallet for another wallet\'s registration', () => {
    // The whole investigation went wrong here: the battery showed Primal
    // Spectre as funded while the registration paid Cyber Nexus.
    const c = sponsorStateFor(wallet({ id: 36, name: 'Primal Spectre', dustAddress: PRIMAL_DUST }), [row()]);
    expect(c.state).toBe('unknown');
    expect(c.capacity).toBeNull();
  });

  it('reports relaying when a registration UTxO exists but has not relayed', () => {
    // ~2.5h Cardano→Midnight relay. Not the same as "no DUST".
    const c = sponsorStateFor(wallet(), [row({ registered: false, registrationUtxoTxHash: 'abc123' })]);
    expect(c.state).toBe('relaying');
    expect(c.capacity).toBeNull();
  });

  it('is unknown, not empty, when no row mentions the wallet', () => {
    // The registration may live on a Cardano wallet outside this profile.
    const c = sponsorStateFor(wallet(), []);
    expect(c.state).toBe('unknown');
    expect(c.capacity).toBeNull();
  });

  it('is unknown when the wallet record stores no dust address', () => {
    expect(sponsorStateFor(wallet({ dustAddress: '' }), [row()]).state).toBe('unknown');
  });

  it('sums capacity across several registrations paying one dust address', () => {
    const c = sponsorStateFor(wallet(), [
      row({ currentCapacity: '100' }),
      row({ cardanoRewardAddress: 'stake1other', currentCapacity: '250' }),
    ]);
    expect(c.capacity).toBe(350n);
    expect(c.fundedBy).toHaveLength(2);
  });

  it('keeps capacity null when every row is unparseable rather than claiming zero', () => {
    const c = sponsorStateFor(wallet(), [row({ currentCapacity: 'not-a-number' })]);
    expect(c.capacity).toBeNull();
    expect(c.state).toBe('ready');
  });

  it('treats a registered-but-drained registration as relaying, not ready', () => {
    const c = sponsorStateFor(wallet(), [row({ currentCapacity: '0' })]);
    expect(c.state).toBe('relaying');
    expect(c.capacity).toBe(0n);
  });
});

describe('sponsorCandidates', () => {
  const wallets: SponsorWalletRef[] = [
    wallet(),
    wallet({ id: 36, name: 'Primal Spectre', dustAddress: PRIMAL_DUST }),
    wallet({ id: 44, name: 'Iron Ranger', network: 'Preprod', dustAddress: 'mn_dust_preprod1abc' }),
  ];

  it('never offers the sending wallet as its own sponsor', () => {
    const out = sponsorCandidates(wallets, [row()], 46, 'Mainnet');
    expect(out.find((c) => c.walletId === 46)).toBeUndefined();
  });

  it('never offers a wallet from another network', () => {
    // DUST is per-network; a mainnet fee cannot pay for a preprod transaction.
    const out = sponsorCandidates(wallets, [row()], 36, 'Mainnet');
    expect(out.find((c) => c.walletId === 44)).toBeUndefined();
  });

  it('offers the wallet the registration actually pays', () => {
    const out = sponsorCandidates(wallets, [row()], 36, 'Mainnet');
    expect(out[0].walletId).toBe(46);
    expect(out[0].state).toBe('ready');
  });

  it('retains unknown candidates instead of hiding them', () => {
    // Hiding these would have hidden the only working sponsor during the
    // mainnet investigation, where enumeration missed the funding wallet.
    const out = sponsorCandidates(wallets, [], 36, 'Mainnet');
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('unknown');
  });

  it('ranks ready above relaying above unknown', () => {
    const many: SponsorWalletRef[] = [
      wallet({ id: 1, name: 'Unknown one', dustAddress: 'mn_dust1none' }),
      wallet({ id: 2, name: 'Relaying one', dustAddress: 'mn_dust1relay' }),
      wallet({ id: 3, name: 'Ready one', dustAddress: 'mn_dust1ready' }),
    ];
    const rows = [
      row({ dustAddress: 'mn_dust1relay', registered: false, registrationUtxoTxHash: 'tx' }),
      row({ dustAddress: 'mn_dust1ready', currentCapacity: '5' }),
    ];
    expect(sponsorCandidates(many, rows, 99, 'Mainnet').map((c) => c.state))
      .toEqual(['ready', 'relaying', 'unknown']);
  });

  it('ranks a larger known capacity first', () => {
    const many: SponsorWalletRef[] = [
      wallet({ id: 1, name: 'Small', dustAddress: 'mn_dust1small' }),
      wallet({ id: 2, name: 'Large', dustAddress: 'mn_dust1large' }),
    ];
    const rows = [
      row({ dustAddress: 'mn_dust1small', currentCapacity: '10' }),
      row({ dustAddress: 'mn_dust1large', currentCapacity: '900' }),
    ];
    expect(sponsorCandidates(many, rows, 99, 'Mainnet')[0].name).toBe('Large');
  });
});

describe('hasReadySponsor', () => {
  it('is false when everything is merely relaying or unknown', () => {
    const out = sponsorCandidates(
      [wallet({ id: 36, name: 'Primal Spectre', dustAddress: PRIMAL_DUST })],
      [row({ dustAddress: PRIMAL_DUST, registered: false, registrationUtxoTxHash: 'tx' })],
      46,
      'Mainnet',
    );
    expect(hasReadySponsor(out)).toBe(false);
  });

  it('is true once one candidate can pay now', () => {
    expect(hasReadySponsor(sponsorCandidates([wallet()], [row()], 36, 'Mainnet'))).toBe(true);
  });
});

describe('chargePercent', () => {
  const w = wallet();

  it('reports the sponsor charge as a whole percentage', () => {
    // The design renders "0.4821 tDUST · 72%" — the percentage needs the cap.
    const c = sponsorStateFor(w, [row({ currentCapacity: '72', maxCapacity: '100' })]);
    expect(chargePercent(c)).toBe(72);
  });

  it('is null when the cap is unknown rather than claiming 0%', () => {
    const c = sponsorStateFor(w, [row({ currentCapacity: '72', maxCapacity: undefined })]);
    expect(chargePercent(c)).toBeNull();
  });

  it('is null for a wallet that was never checked', () => {
    // "Not checked yet" draws a hatched track and an em dash — never 0%.
    expect(chargePercent(sponsorStateFor(w, []))).toBeNull();
  });

  it('does not divide by a zero cap', () => {
    const c = sponsorStateFor(w, [row({ currentCapacity: '0', maxCapacity: '0' })]);
    expect(chargePercent(c)).toBeNull();
  });

  it('clamps a capacity above cap to 100', () => {
    const c = sponsorStateFor(w, [row({ currentCapacity: '150', maxCapacity: '100' })]);
    expect(chargePercent(c)).toBe(100);
  });

  it('sums caps across several registrations', () => {
    const c = sponsorStateFor(w, [
      row({ currentCapacity: '50', maxCapacity: '100' }),
      row({ cardanoRewardAddress: 'stake1other', currentCapacity: '50', maxCapacity: '100' }),
    ]);
    expect(c.cap).toBe(200n);
    expect(chargePercent(c)).toBe(50);
  });
});
