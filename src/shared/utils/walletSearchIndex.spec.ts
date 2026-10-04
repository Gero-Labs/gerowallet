import { describe, it, expect } from 'vitest';
import us from '@/plugins/i18n/us';
import {
  ACTION_INDEX,
  PAGE_INDEX,
  SETTINGS_INDEX,
  actionResults,
  pageResults,
  searchGates,
  settingResults,
  type GateInputs,
  type SearchFlags,
  type SearchGate,
  type SearchGates,
} from '@/shared/utils/walletSearchIndex';

/** Translator over the real English dictionary, so titles match what users see. */
const t = (key: string) => (us as Record<string, string>)[key] ?? key;

const allGates = () => true;
/** Every gate on except the named ones. */
const without = (...off: SearchGate[]) => (gate: SearchGate) => !off.includes(gate);

describe('wallet search index', () => {
  it('names only keys that exist in us.ts', () => {
    // A missing key renders the raw key as the result title, so the index must
    // never point at one. (settings.verifyAddress was such a key until now.)
    const keys = [
      ...PAGE_INDEX.flatMap(entry => [entry.titleKey, entry.subtitleKey]),
      ...ACTION_INDEX.map(entry => entry.titleKey),
      'dashboard.showBalances',
      ...SETTINGS_INDEX.flatMap(entry => [entry.titleKey, entry.subtitleKey]),
    ].filter((key): key is string => !!key);
    expect(keys.filter(key => !(key in us))).toEqual([]);
  });

  it('gives every page a distinct route', () => {
    const routes = PAGE_INDEX.map(entry => entry.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe('pageResults', () => {
  const options = { t, can: allGates };

  it('finds a page by keyword, title or translation-independent synonym', () => {
    expect(pageResults('staking', options)[0]).toMatchObject({ type: 'page', route: '/staking', _score: 100 });
    expect(pageResults('utxo', options)[0]).toMatchObject({ route: '/transactions?tab=utxos' });
    expect(pageResults('nfts', options)[0]).toMatchObject({ route: '/?view=collectibles' });
    expect(pageResults('verlauf', options)[0]).toMatchObject({ route: '/transactions' });
    expect(pageResults('tarjeta', options)[0]).toMatchObject({ route: '/card' });
  });

  it('hides a page whose gate is off', () => {
    const routes = (q: string, can = allGates as (gate: SearchGate) => boolean) =>
      pageResults(q, { t, can }).map(result => result.route);
    expect(routes('mempool')).toContain('/mempool');
    expect(routes('mempool', without('mempool'))).not.toContain('/mempool');
    expect(routes('watchlist', without('market'))).toEqual([]);
    expect(routes('proof server', without('midnight'))).toEqual([]);
  });

  it('keeps pages without a gate, like Dashboard and Nexus', () => {
    const none = () => false;
    expect(pageResults('dashboard', { t, can: none }).map(r => r.route)).toContain('/');
    expect(pageResults('nexus', { t, can: none }).map(r => r.route)).toContain('/nexus');
  });

  it('labels a page with its drawer section', () => {
    expect(pageResults('lightning', options)[0]).toMatchObject({ title: 'Lightning & LNURL', subtitle: 'Financial Hub' });
  });

  it('returns nothing for a blank query', () => {
    expect(pageResults('  ', options)).toEqual([]);
  });
});

describe('actionResults', () => {
  const options = { t, can: allGates, balancesHidden: false };

  it('opens the quick-action dialogs', () => {
    expect(actionResults('send', options)[0]).toMatchObject({
      type: 'action',
      id: 'action-send',
      data: { action: { kind: 'dialog', dialog: 'SEND' } },
    });
    expect(actionResults('qr code', options)[0]?.data).toEqual({ action: { kind: 'dialog', dialog: 'RECEIVE' } });
  });

  it('drops Buy and Perpetuals where the chain has neither', () => {
    expect(actionResults('buy', { ...options, can: without('buy') })).toEqual([]);
    expect(actionResults('perps', { ...options, can: without('perpetuals') })).toEqual([]);
  });

  it('titles the balance toggle for what it does next', () => {
    expect(actionResults('hide balances', options)[0]?.title).toBe('Hide balances');
    expect(actionResults('hide balances', { ...options, balancesHidden: true })[0]?.title).toBe('Show balances');
  });
});

describe('settingResults', () => {
  const options = { t, can: allGates };

  it('opens the dialog on the row tab', () => {
    expect(settingResults('seed phrase', options)[0]).toMatchObject({
      type: 'setting',
      title: 'Recovery Phrase',
      subtitle: 'Settings → Security',
      data: { tab: 'security' },
    });
    expect(settingResults('auto-withdraw', options)[0]?.data).toMatchObject({ tab: 'advanced' });
  });

  it('only offers a row the tab actually renders', () => {
    // An MPC wallet reveals its phrase from its own row; neither exists on a hardware wallet.
    expect(settingResults('seed phrase', { t, can: without('backup', 'mpc') })).toEqual([]);
    expect(settingResults('verify address', { t, can: without('verifyAddress') })).toEqual([]);
    expect(settingResults('remote signing', { t, can: without('remoteSigning') })).toEqual([]);
    expect(settingResults('shop earn', { t, can: without('cashback') })).toEqual([]);
  });

  it('does not offer two-factor authentication, which the security tab does not render', () => {
    expect(settingResults('2fa', options)).toEqual([]);
  });

  it('never returns the same row twice', () => {
    const ids = settingResults('lock', options).map(result => result.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('chain isolation', () => {
  /** Every flag on: isolation must hold even with every feature switched on. */
  const flags: SearchFlags = {
    isBitcoinEnabled: () => true,
    isRealFiEnabled: () => true,
    isGeroCardEnabled: () => true,
    isGoMiningEnabled: () => true,
    isBlogEnabled: () => true,
    isCopilotEnabled: () => true,
    isPoolOperatorEnabled: () => true,
    isGovernanceEnabled: () => true,
    isGovernanceVotingEnabled: () => true,
    isCrossDeviceSigningEnabled: () => true,
    isLiveChatEnabled: () => true,
  };

  type GateWallet = NonNullable<GateInputs['wallet']>;

  function gatesFor(chain: string, network: string, extra: Partial<GateWallet> = {}, playlistLength = 0): SearchGates {
    return searchGates({
      wallet: { chain, network, type: 'Normal', encryptionMethod: 'password', stakeAddress: 'stake1u9xyz0abc', ...extra },
      flags,
      hasBackupState: true,
      playlistLength,
    });
  }

  const cardanoMainnet = gatesFor('Cardano', 'Mainnet');
  const cardanoPreprod = gatesFor('Cardano', 'Preprod', { stakeAddress: 'stake_test1uqxyz0abc' });
  const apexVector = gatesFor('Apex Fusion Vector', 'Mainnet', {}, 3);
  const bitcoinMainnet = gatesFor('Bitcoin', 'Mainnet');
  const bitcoinLedger = gatesFor('Bitcoin', 'Mainnet', { type: 'Ledger' });
  const midnightMainnet = gatesFor('Midnight', 'Mainnet', {}, 3);

  const canFor = (gates: SearchGates) => (gate: SearchGate) => gates[gate];

  /** Each page found through its own first keyword, i.e. what a user typing for it gets. */
  function offeredPages(gates: SearchGates): string[] {
    const can = canFor(gates);
    return PAGE_INDEX
      .filter(entry => pageResults(entry.keywords[0], { t, can }).some(result => result.route === entry.route))
      .map(entry => entry.route);
  }

  function offeredSettings(gates: SearchGates): string[] {
    const can = canFor(gates);
    return SETTINGS_INDEX
      .filter(entry => settingResults(entry.keywords[0], { t, can }).some(result => result.id === `setting-${entry.tab}-${entry.titleKey}`))
      .map(entry => entry.titleKey);
  }

  function offeredActions(gates: SearchGates): string[] {
    const can = canFor(gates);
    return ACTION_INDEX
      .filter(entry => actionResults(entry.keywords[0], { t, can, balancesHidden: false }).some(result => result.id === `action-${entry.id}`))
      .map(entry => entry.id);
  }

  const MIDNIGHT_ONLY = ['/proof-server'];
  const BITCOIN_ONLY = ['/gomining', '/babylon', '/ordinals', '/thorchain', '/mempool', '/lightning'];
  const CARDANO_FAMILY_ONLY = [
    '/?view=holdings', '/?view=collectibles', '/?view=market', '/?view=watchlist', '/staking', '/realfi', '/card',
    '/swap', '/cashback', '/media-player', '/pool-operator',
  ];

  it('never offers a Midnight page outside Midnight', () => {
    for (const gates of [cardanoMainnet, cardanoPreprod, apexVector, bitcoinMainnet]) {
      expect(offeredPages(gates).filter(route => MIDNIGHT_ONLY.includes(route))).toEqual([]);
    }
    expect(pageResults('proof server', { t, can: canFor(cardanoMainnet) })).toEqual([]);
  });

  it('never offers a Bitcoin page outside Bitcoin', () => {
    for (const gates of [cardanoMainnet, cardanoPreprod, apexVector, midnightMainnet]) {
      expect(offeredPages(gates).filter(route => BITCOIN_ONLY.includes(route))).toEqual([]);
    }
  });

  it('never offers a Cardano page outside the Cardano family', () => {
    for (const gates of [bitcoinMainnet, midnightMainnet]) {
      expect(offeredPages(gates).filter(route => CARDANO_FAMILY_ONLY.includes(route))).toEqual([]);
    }
  });

  it('offers each chain exactly its own pages', () => {
    expect(offeredPages(cardanoMainnet)).toEqual([
      '/', '/?view=holdings', '/?view=collectibles', '/?view=market', '/?view=watchlist', '/transactions',
      '/transactions?tab=utxos', '/staking', '/realfi', '/card', '/swap', '/cashback', '/blog', '/copilot-feed',
      '/pool-operator', '/nexus',
    ]);
    expect(offeredPages(midnightMainnet)).toEqual([
      '/', '/transactions', '/transactions?tab=utxos', '/proof-server', '/blog', '/copilot-feed', '/nexus',
    ]);
    expect(offeredPages(bitcoinMainnet)).toEqual([
      '/', '/transactions', '/gomining', '/babylon', '/ordinals', '/thorchain', '/mempool', '/lightning', '/blog',
      '/copilot-feed', '/nexus',
    ]);
  });

  it('keeps mainnet-only Cardano pages off testnet', () => {
    const preprod = offeredPages(cardanoPreprod);
    for (const route of ['/?view=market', '/?view=watchlist', '/card', '/swap', '/cashback']) {
      expect(preprod).not.toContain(route);
    }
    expect(preprod).toContain('/staking');
  });

  it('sends a "staking" search on Bitcoin to Babylon, never to Cardano staking', () => {
    const routes = pageResults('staking', { t, can: canFor(bitcoinMainnet) }).map(result => result.route);
    expect(routes).toEqual(['/babylon']);
  });

  it('keeps the media player to the chains whose NFTs fill it', () => {
    expect(midnightMainnet.mediaPlayer).toBe(false);
    expect(apexVector.mediaPlayer).toBe(false);
    expect(gatesFor('Cardano', 'Mainnet', {}, 3).mediaPlayer).toBe(true);
  });

  it('offers only the quick actions the chain has', () => {
    expect(offeredActions(cardanoMainnet)).toEqual(['send', 'receive', 'buy', 'perpetuals', 'toggleBalances']);
    expect(offeredActions(bitcoinMainnet)).toEqual(['send', 'receive', 'buy', 'toggleBalances']);
    expect(offeredActions(midnightMainnet)).toEqual(['send', 'receive', 'toggleBalances']);
  });

  it('keeps chain-specific settings rows on their chain', () => {
    const cardanoOnly = [
      'settings.collateral', 'settings.autoWithdrawRewards', 'crossDevice.settings.title', 'settings.shopEarnPopups',
      'notify.wallet.title', 'notify.categories.title', 'notify.security.title',
    ];
    for (const gates of [bitcoinMainnet, bitcoinLedger, midnightMainnet]) {
      expect(offeredSettings(gates).filter(key => cardanoOnly.includes(key))).toEqual([]);
    }
    expect(offeredSettings(cardanoMainnet)).toEqual(expect.arrayContaining(cardanoOnly));

    expect(offeredSettings(bitcoinLedger)).toContain('settings.verifyAddress');
    for (const gates of [cardanoMainnet, midnightMainnet, bitcoinMainnet]) {
      expect(offeredSettings(gates)).not.toContain('settings.verifyAddress');
    }
  });

  it('closes the token, NFT and market sources outside their chains', () => {
    // useGlobalSearch reads these two for owned tokens, NFTs and the market list.
    for (const gates of [bitcoinMainnet, midnightMainnet]) {
      expect(gates.cardanoFamily).toBe(false);
      expect(gates.market).toBe(false);
    }
    expect(cardanoPreprod.market).toBe(false);
    expect(apexVector.market).toBe(false);
    expect(apexVector.cardanoFamily).toBe(true);
  });

  it('closes governance outside the Cardano networks that serve it', () => {
    expect(cardanoMainnet.governance).toBe(true);
    for (const gates of [apexVector, bitcoinMainnet, midnightMainnet]) {
      expect(gates.governance).toBe(false);
    }
  });
});
