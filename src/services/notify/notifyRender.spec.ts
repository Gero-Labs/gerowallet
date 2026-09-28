import { describe, it, expect } from 'vitest';
import { computeEventTag, parsePushPayload, sanitizeAmounts } from './notifyPayload';
import { formatAmounts, renderPush, routeFor, scaleQuantity, type TokenLookup } from './notifyRender';
import { pushStrings } from '@/plugins/i18n/push';

// CONTRACT §6.6 examples, verbatim.
const TAG = '00112233445566778899aabbccddeeff';
const EX = {
  funds: '{"v":1,"t":"funds","c":"funds","w":"00112233445566778899aabbccddeeff","e":"431819262709d4f7e2e7b293474c0743","ts":1790553660000,"exp":1790640060000,"d":"activity","a":{"ada":"12.5","assets":[{"sym":"NIGHT","qty":"250"}],"otherAssets":1},"x":{"tx":"a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130"}}',
  funds_summary: '{"v":1,"t":"funds_summary","c":"funds","w":"00112233445566778899aabbccddeeff","e":"8d66e9e1e07c4da7b7ecca5915a062d4","ts":1790554200000,"exp":1790640600000,"d":"activity","n":3}',
  signwake: '{"v":1,"t":"signwake","c":"remoteSigning","w":"00112233445566778899aabbccddeeff","e":"5562d7c4267797f249a5966300f52a07","ts":1790553600000,"exp":1790553900000,"d":"signRequest"}',
  new_device: '{"v":1,"t":"new_device","c":"remoteSigning","w":"00112233445566778899aabbccddeeff","e":"d8880f491358cd89d151d6e0b0fc3661","ts":1790553600000,"exp":1790640000000,"d":"pairedDevices","x":{"deviceId":"4884fdaafea47c29fea7159d0daddd9c"}}',
  reward: '{"v":1,"t":"reward","c":"staking","w":"00112233445566778899aabbccddeeff","e":"f22fe1d26bdd80a834a7b76c1b8996a2","ts":1790557200000,"exp":1790816400000,"d":"staking","a":{"ada":"3.21"},"x":{"epoch":612}}',
  swap_filled: '{"v":1,"t":"swap_filled","c":"swap","w":"00112233445566778899aabbccddeeff","e":"f29be55f4bcc280ce668f091b904e093","ts":1790553600000,"exp":1790640000000,"d":"swapOrders","x":{"orderRef":"a42c5e7edeb7df2b13960071ce84e1f42fbed75aad7675bf66dd6724b4ebbed6#0"}}',
  swap_cancelled: '{"v":1,"t":"swap_cancelled","c":"swap","w":"00112233445566778899aabbccddeeff","e":"ed62e4b709914b402d1d6effb6d8e600","ts":1790553600000,"exp":1790640000000,"d":"swapOrders","x":{"orderRef":"a42c5e7edeb7df2b13960071ce84e1f42fbed75aad7675bf66dd6724b4ebbed6#0"}}',
  adam_proposal: '{"v":1,"t":"adam_proposal","c":"adam","w":"00112233445566778899aabbccddeeff","e":"477c4393b9514abe006c09c626e2c22f","ts":1790553600000,"exp":1790557200000,"d":"adam","x":{"proposalRef":"prop_8f2c"}}',
  drep_retired: '{"v":1,"t":"drep_retired","c":"governance","w":"00112233445566778899aabbccddeeff","e":"23e508501de7bd7ef381b15e1333639e","ts":1790553600000,"exp":1790812800000,"d":"governance","x":{"drepId":"drep1y2uf2gxdj4hhkzkmhgtd7rfxh5q45sne2h3mlra2up53rrg4mwfnf"}}',
  drep_inactive: '{"v":1,"t":"drep_inactive","c":"governance","w":"00112233445566778899aabbccddeeff","e":"1fc44e8a1bed1cc819d0d3f67a8248ec","ts":1790553600000,"exp":1790812800000,"d":"governance","x":{"drepId":"drep1y2uf2gxdj4hhkzkmhgtd7rfxh5q45sne2h3mlra2up53rrg4mwfnf"}}',
  drep_expiring: '{"v":1,"t":"drep_expiring","c":"governance","w":"00112233445566778899aabbccddeeff","e":"cbdeecf66f251a16aed016f0aff9495e","ts":1790553600000,"exp":1790812800000,"d":"governance","x":{"drepId":"drep1y2uf2gxdj4hhkzkmhgtd7rfxh5q45sne2h3mlra2up53rrg4mwfnf"}}',
  test: '{"v":1,"t":"test","c":"system","w":"00112233445566778899aabbccddeeff","e":"8485b3752ebf592436a6786107e20610","ts":1790553600000,"exp":1790557200000,"d":"home"}',
};
const NOW = 1790553700000; // before every exp above
const wallet = { walletId: 4, name: 'Daily Cardano' };
const render = (text: string, over: Partial<{ wallet: typeof wallet | null; locale: string; now: number; tokenInfo: TokenLookup }> = {}) =>
  renderPush({ parsed: parsePushPayload(text), wallet: over.wallet === undefined ? wallet : over.wallet, locale: over.locale ?? 'us', now: over.now ?? NOW, tokenInfo: over.tokenInfo });
const us = pushStrings.us;

describe('§6.3 event tag vectors', () => {
  it('reproduces both vectors and every example e from its eventId', () => {
    const key = '0f0e0d0c0b0a09080706050403020100';
    const stake = '0d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06';
    expect(computeEventTag(key, `funds:cardano-mainnet:${stake}:a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130`)).toBe('431819262709d4f7e2e7b293474c0743');
    expect(computeEventTag(key, `paired:cardano-mainnet:${stake}:4884fdaafea47c29fea7159d0daddd9c`)).toBe('d8880f491358cd89d151d6e0b0fc3661');
    expect(computeEventTag(key, `fundsum:cardano-mainnet:${stake}:1790554200`)).toBe('8d66e9e1e07c4da7b7ecca5915a062d4');
    expect(computeEventTag(key, `reward:cardano-mainnet:${stake}:612`)).toBe('f22fe1d26bdd80a834a7b76c1b8996a2');
    expect(computeEventTag(key, 'test:21fe31dfa154a261626bf854046fd227:adm-0001')).toBe('8485b3752ebf592436a6786107e20610');
  });
});

describe('payload rendering (§6.7), every t of §6.2', () => {
  it('funds with amounts: title carries the wallet name, body the amounts, click goes to activity with the tx', () => {
    const r = render(EX.funds);
    expect(r.title).toBe('ADA Received · Daily Cardano');
    expect(r.body).toBe('You received 12.5 ADA, 250 NIGHT, 1 other token');
    expect(r.tag).toBe('431819262709d4f7e2e7b293474c0743');
    expect(r.requireInteraction).toBe(false);
    expect(r.timestamp).toBe(1790553660000);
    expect(r.route).toEqual({ dashboard: '/transactions?tx=a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130', sidepanel: '/activity', highlight: { tx: 'a690b5e80b646a7d2542e0f440882bebebd6fa4973ee831fac63ad0ebfdf9130' } });
    expect(r.data).toMatchObject({ v: 1, t: 'funds', c: 'funds', w: TAG, e: r.tag, d: 'activity', walletId: 4, degraded: 'none' });
    expect(r.unknownWalletTag).toBeNull();
  });

  it('funds without amounts: no wallet name, generic body (the user did not opt into details)', () => {
    const r = render(JSON.stringify({ ...JSON.parse(EX.funds), a: undefined }));
    expect(r.title).toBe('ADA Received');
    expect(r.body).toBe('You received funds');
  });

  it('funds_summary uses n, with the singular for n == 1', () => {
    expect(render(EX.funds_summary).body).toBe('3 more transactions');
    expect(render(EX.funds_summary.replace('"n":3', '"n":1')).body).toBe('1 more transaction');
    expect(render(EX.funds_summary).title).toBe('Funds Received');
  });

  it('new_device requires interaction and routes to the Security tab with the device id', () => {
    const r = render(EX.new_device);
    expect(r.title).toBe(us.PUSH_NEWDEVICE_TITLE);
    expect(r.requireInteraction).toBe(true);
    expect(r.route).toEqual({ dashboard: '/', sidepanel: null, settingsTab: 'security', highlight: { deviceId: '4884fdaafea47c29fea7159d0daddd9c' } });
  });

  it('reward with an amount, swaps, adam, dreps and test render their own strings and routes', () => {
    expect(render(EX.reward)).toMatchObject({ title: 'Staking Reward Received · Daily Cardano', body: 'Your staking reward of 3.21 ADA has arrived', route: { dashboard: '/staking', sidepanel: '/staking' } });
    expect(render(EX.swap_filled)).toMatchObject({ title: 'Swap Filled', body: us.PUSH_SWAP_FILLED_BODY, route: { dashboard: '/swap', sidepanel: null } });
    expect(render(EX.swap_cancelled)).toMatchObject({ title: 'Order Cancelled', route: { dashboard: '/swap', sidepanel: null } });
    expect(render(EX.adam_proposal)).toMatchObject({ title: us.PUSH_ADAM_TITLE, route: { dashboard: '/', sidepanel: '/' } });
    for (const t of ['drep_retired', 'drep_inactive', 'drep_expiring'] as const) {
      const r = render(EX[t]);
      expect(r.body).toContain('The DRep you delegate to');
      expect(r.body).not.toContain('drep1');
      expect(r.route).toEqual({ dashboard: '/governance/dreps/drep1y2uf2gxdj4hhkzkmhgtd7rfxh5q45sne2h3mlra2up53rrg4mwfnf', sidepanel: null, highlight: { drepId: 'drep1y2uf2gxdj4hhkzkmhgtd7rfxh5q45sne2h3mlra2up53rrg4mwfnf' } });
    }
    expect(render(EX.test)).toMatchObject({ title: us.PUSH_TEST_TITLE, body: us.PUSH_TEST_BODY, route: { dashboard: '/', sidepanel: '/' } });
    expect(render(EX.signwake)).toMatchObject({ title: us.PUSH_SIGNWAKE_TITLE, route: { dashboard: '/', sidepanel: '/' } }); // signRequest is home in v1
  });

  it('German strings', () => {
    expect(render(EX.funds, { locale: 'de' }).title).toBe('ADA erhalten · Daily Cardano');
    expect(render(EX.funds_summary.replace('"n":3', '"n":1'), { locale: 'de' }).body).toBe('1 weitere Transaktion');
  });

  it('Spanish strings, and an unsupported locale falls back to English', () => {
    expect(render(EX.funds, { locale: 'es' }).title).toBe('ADA recibido · Daily Cardano');
    expect(render(EX.funds_summary.replace('"n":3', '"n":1'), { locale: 'es' }).body).toBe('1 transacción más');
    expect(render(EX.funds, { locale: 'fr' }).title).toBe(render(EX.funds).title);
  });

  it('unknown t renders the category text; unknown c the generic notification; unknown d goes home', () => {
    const r = render(EX.funds.replace('"t":"funds"', '"t":"funds_v9"'));
    expect(r.title).toBe(us.PUSH_GENERIC_TITLE);
    expect(r.body).toBe(us.PUSH_CATEGORY_FUNDS);
    expect(r.data.degraded).toBe('category');
    expect(r.route.dashboard).toBe('/transactions'); // the category is known, so d still applies
    const unknownCategory = render(EX.test.replace('"t":"test","c":"system"', '"t":"foo","c":"bar"'));
    expect(unknownCategory.body).toBe(us.PUSH_GENERIC_BODY);
    expect(unknownCategory.route.dashboard).toBe('/');
    expect(render(EX.funds.replace('"d":"activity"', '"d":"moon"')).route).toEqual({ dashboard: '/', sidepanel: '/' });
  });

  it('bad JSON and v > 1 render the generic notification and open home', () => {
    const bad = render('{not json');
    expect(bad).toMatchObject({ title: us.PUSH_GENERIC_TITLE, body: us.PUSH_GENERIC_BODY, route: { dashboard: '/', sidepanel: '/' }, data: { degraded: 'generic' } });
    expect(bad.tag).toMatch(/^generic-/);
    const v2 = render(EX.funds.replace('"v":1', '"v":2'));
    expect(v2).toMatchObject({ title: us.PUSH_GENERIC_TITLE, body: us.PUSH_GENERIC_BODY, tag: '431819262709d4f7e2e7b293474c0743', data: { degraded: 'generic' } });
    expect(render(EX.funds.replace('"v":1', '"v":"1"')).data.degraded).toBe('generic');
  });

  it('an expired push renders the category text with no amounts and no deep link', () => {
    const r = render(EX.funds, { now: 1790640060001 });
    expect(r.title).toBe('ADA Received');
    expect(r.body).toBe(us.PUSH_CATEGORY_FUNDS);
    expect(r.body).not.toContain('12.5');
    expect(r.route).toEqual({ dashboard: '/transactions', sidepanel: '/activity' });
    expect(r.data.degraded).toBe('expired');
  });

  it('an unknown w renders the generic notification and asks for the DELETE of that tag', () => {
    const r = render(EX.funds, { wallet: null });
    expect(r).toMatchObject({ title: us.PUSH_GENERIC_TITLE, body: us.PUSH_GENERIC_BODY, unknownWalletTag: TAG, data: { degraded: 'unknown_wallet', walletId: null } });
    expect(r.route).toEqual({ dashboard: '/', sidepanel: '/' });
    expect(render(EX.funds.replace(TAG, 'zz'), { wallet: null }).unknownWalletTag).toBeNull(); // not even a tag shape
  });

  it('a bad sym is dropped, other amount fields survive', () => {
    expect(sanitizeAmounts({ ada: '1.5', assets: [{ sym: 'night', qty: '1' }, { sym: 'TOOLONGSYMBOL', qty: '1' }, { sym: 'USDM', qty: '9' }], otherAssets: 2 }))
      .toEqual({ ada: '1.5', assets: [{ sym: 'USDM', qty: '9' }], otherAssets: 2 });
    expect(sanitizeAmounts({ assets: [] })).toBeUndefined();
    expect(formatAmounts('us', { assets: [], otherAssets: 2 })).toBe('2 other tokens');
    const r = render(EX.funds.replace('"sym":"NIGHT"', '"sym":"n!ght"'));
    expect(r.body).toBe('You received 12.5 ADA, 1 other token');
  });

  describe('received assets by unit (the server lists them raw; the wallet names and scales them)', () => {
    const policy = '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6';
    const gero = `${policy}4745524f`;
    const hosky = `${policy}486f736b79`;
    const withUnits = (assets: string) => EX.funds.replace('"assets":[{"sym":"NIGHT","qty":"250"}],"otherAssets":1', `"assets":[${assets}]`);

    it('a unit must be hex; sym stays optional next to it', () => {
      expect(sanitizeAmounts({ ada: '1', assets: [{ sym: 'GERO', qty: '1500000', unit: gero }, { qty: '1', unit: hosky }, { qty: '1', unit: 'nothex' }, { qty: '1' }] }))
        .toEqual({ ada: '1', assets: [{ sym: 'GERO', qty: '1500000', unit: gero }, { qty: '1', unit: hosky }] });
    });

    it('the registry ticker and decimals win over the symbol; a raw quantity is shown only once the decimals are known', () => {
      const registry: TokenLookup = (unit) => (unit === gero ? { ticker: '$GERO', decimals: 6 } : unit === hosky ? { ticker: 'HOSKY', decimals: 0 } : undefined);
      const r = render(withUnits(`{"sym":"GERO","qty":"1500000","unit":"${gero}"},{"qty":"42","unit":"${hosky}"}`), { tokenInfo: registry });
      expect(r.body).toBe('You received 12.5 ADA, 1.5 $GERO, 42 HOSKY');
      // No registry data (cold worker, unknown token): the server symbol without an unscaled number.
      expect(render(withUnits(`{"sym":"GERO","qty":"1500000","unit":"${gero}"}`)).body).toBe('You received 12.5 ADA, GERO');
      // Nothing to name it by: folded into the other count.
      expect(render(withUnits(`{"qty":"1","unit":"${hosky}"}`)).body).toBe('You received 12.5 ADA, 1 other token');
      expect(render(withUnits(`{"qty":"1","unit":"${hosky}"},{"qty":"2","unit":"${gero}"}`).replace('"assets":[', '"otherAssets":1,"assets":[')).body).toBe('You received 12.5 ADA, 3 other tokens');
      // A symbol without a unit is display-ready as before (the contract example).
      expect(render(EX.funds, { tokenInfo: registry }).body).toBe('You received 12.5 ADA, 250 NIGHT, 1 other token');
    });

    it('scaleQuantity', () => {
      expect(scaleQuantity('1500000', 6)).toBe('1.5');
      expect(scaleQuantity('1', 6)).toBe('0.000001');
      expect(scaleQuantity('123456789', 6)).toBe('123.456789');
      expect(scaleQuantity('5000000', 6)).toBe('5');
      expect(scaleQuantity('42', 0)).toBe('42');
    });
  });

  it('never shows a payload string: only table strings plus a and n', () => {
    const r = render(EX.funds.replace('"d":"activity"', '"d":"activity","title":"<b>hax</b>","body":"pwned"'));
    expect(r.title + r.body).not.toMatch(/hax|pwned/);
  });

  it('routing table (§6.4)', () => {
    expect(routeFor('home', undefined, true)).toEqual({ dashboard: '/', sidepanel: '/' });
    expect(routeFor('activity', { tx: 'a'.repeat(64) }, true)).toEqual({ dashboard: `/transactions?tx=${'a'.repeat(64)}`, sidepanel: '/activity', highlight: { tx: 'a'.repeat(64) } });
    expect(routeFor('activity', undefined, true)).toEqual({ dashboard: '/transactions', sidepanel: '/activity' });
    expect(routeFor('activity', { tx: 'a'.repeat(64) }, false)).toEqual({ dashboard: '/transactions', sidepanel: '/activity' });
    expect(routeFor('staking', undefined, true)).toEqual({ dashboard: '/staking', sidepanel: '/staking' });
    expect(routeFor('swapOrders', undefined, true)).toEqual({ dashboard: '/swap', sidepanel: null });
    expect(routeFor('governance', undefined, true)).toEqual({ dashboard: '/governance/me', sidepanel: null });
    expect(routeFor('pairedDevices', { deviceId: 'b'.repeat(32) }, true)).toEqual({ dashboard: '/', sidepanel: null, settingsTab: 'security', highlight: { deviceId: 'b'.repeat(32) } });
    expect(routeFor('signRequest', undefined, true)).toEqual({ dashboard: '/', sidepanel: '/' });
    expect(routeFor('adam', undefined, true)).toEqual({ dashboard: '/', sidepanel: '/' });
  });
});
