/**
 * Source tripwires for the market signing guard in background.ts and walletBg.ts, which unit
 * tests cannot load. The pieces are tested on their own (marketGuard, marketAllowance,
 * marketSign.walletBg, dappMarketPass); these pin where the guard sits: beside the CIP-113 checks
 * in WalletBg.signTx, in the hardware refusal, and that a dApp's signing entry opens a pass
 * (never refuses) and nothing else can.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Normalize CRLF (Windows checkouts) before slicing on newline delimiters.
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const bg = read('chrome/background.ts');
const walletBg = read('chrome/walletBg.ts');

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n}\n', start));
}

describe('NFT market signing wiring', () => {
  const signTx = walletBg.slice(walletBg.indexOf('  async signTx('), walletBg.indexOf('  async submitTx('));

  it('WalletBg.signTx checks the market allowance before decrypting and uses it up before signing', () => {
    const check = signTx.indexOf('hasMarketAuthorization(this.id, transaction.id, marketHits)');
    const decrypt = signTx.indexOf('this.decryptRootPrivateKey(password)');
    const authorized = signTx.indexOf('assertAuthorized?.()');
    const consume = signTx.indexOf('consumeMarketAuthorization(this.id, transaction.id, marketHits)');
    const sign = signTx.indexOf('.sign(HexBlob(transaction.id))');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(decrypt);
    expect(consume).toBeGreaterThan(authorized);
    expect(consume).toBeLessThan(sign);
  });

  it('the market check sits beside, and after, the CIP-113 check', () => {
    const cip113Check = signTx.indexOf('hasCip113SignAllowance(this.id, transaction.id, programmableInputs)');
    const marketCheck = signTx.indexOf('hasMarketAuthorization(this.id, transaction.id, marketHits)');
    const cip113Consume = signTx.indexOf('consumeCip113SignAllowance(this.id, transaction.id, programmableInputs)');
    const marketConsume = signTx.indexOf('consumeMarketAuthorization(this.id, transaction.id, marketHits)');
    expect(cip113Check).toBeGreaterThan(-1);
    expect(marketCheck).toBeGreaterThan(cip113Check);
    expect(marketConsume).toBeGreaterThan(cip113Consume);
  });

  it('what counts as a market touch is the wallet\'s own deployments and verified listings', () => {
    const body = functionBody(walletBg, '  findMarketTouch(transaction: Cardano.Tx): string[] {');
    expect(body).toContain('networks.resolveNftMarketDeployments(this.chain, this.network)');
    expect(body).toContain('WalletStore.state.listedListings');
    // A guard, not UI: the feature flag has no say.
    expect(body).not.toMatch(/isNftMarketEnabled/);
  });

  it('only the hardware refusal reads the market authorization in background.ts, and nothing there uses it up', () => {
    expect(bg.match(/hasMarketAuthorization\(/g)).toHaveLength(1);
    expect(functionBody(bg, 'function marketSignRefusal(')).toContain('hasMarketAuthorization(');
    expect(bg).not.toMatch(/consumeMarketAuthorization\(|consumeMarketSignAllowance\(|consumeDappMarketPass\(/);
    // Nor does it read either half on its own.
    expect(bg).not.toMatch(/hasMarketSignAllowance\(|hasDappMarketPass\(/);
  });

  it('the hardware refusal includes the market refusal, with its own message', () => {
    const body = functionBody(bg, 'function hardwareSignRefusal(');
    expect(body).toContain('marketSignRefusal(txCbor)');
    expect(body).toContain('NFT_MARKET_SIGN_REFUSAL_MESSAGE');
    expect(body).toContain('CIP113_SIGN_REFUSAL_MESSAGE');
  });

  it('the dApp refusal of programmable inputs never reads the market guard', () => {
    const body = functionBody(bg, 'function refusalForProgrammableInputs(');
    expect(body).not.toMatch(/Market/);
    expect(bg.match(/refusalForProgrammableInputs\(/g)!.length).toBeGreaterThan(4);
    // The market refusal is used by the hardware refusal only (its definition and that call).
    expect(bg.match(/marketSignRefusal\(/g)).toHaveLength(2);
  });

  describe('the dApp signing entries open a pass instead of refusing', () => {
    /** The registration a call at `index` sits in: the nearest handler marker before it. */
    function enclosing(src: string, index: number): string {
      const markers = ['\napp.add(', '\napp.addToOptions(', '  wcService.onSessionRequest = '];
      const at = Math.max(...markers.map((marker) => src.lastIndexOf(marker, index)));
      return src.slice(at, src.indexOf('\n', at + 1)).trim();
    }
    const calls = [...bg.matchAll(/openDappMarketPass\(/g)].map((match) => match.index!);

    it('CIP-30 signTx opens it after the whitelist and CIP-113 checks, and drops it when the request is answered', () => {
      const entry = bg.slice(bg.indexOf('app.add(METHOD.signTx,'), bg.indexOf('app.add(METHOD.submitTx,'));
      const whitelist = entry.indexOf('WalletStore.isWhitelisted(request.origin)');
      const cip113 = entry.indexOf('refusalForProgrammableInputs(request.data?.tx)');
      const open = entry.indexOf('openDappMarketPass(walletManager.getWallet(), request.data?.tx)');
      const firstPrompt = entry.indexOf('const handleMiniGeroSignTx');
      expect(whitelist).toBeGreaterThan(-1);
      expect(cip113).toBeGreaterThan(whitelist);
      expect(open).toBeGreaterThan(cip113);
      expect(open).toBeLessThan(firstPrompt);
      // Every later answer goes through the wrapper that drops the pass first.
      expect(entry).toContain('let signTxReply = guardedSignReply(request, sendResponse);');
      expect(entry).toMatch(/signTxReply = \(opts\) => \{\n\s+dropMarketPass\(\);\n\s+answerSignTx\(opts\);/);
      // The pass is made from the CBOR the dApp sent and from nothing else the request carries.
      expect(entry.slice(open, entry.indexOf(';', open))).not.toMatch(/origin|embeddedIn|partialSign/);
    });

    it('CIP-45 signTx opens it after its CIP-113 refusal and drops it however the request ends', () => {
      const entry = bg.slice(bg.indexOf("      case 'signTx': {\n        // The same entry refusal as CIP-30"), bg.indexOf("      case 'signData': {\n        if (reservedSigningDomain(params.payload))"));
      const cip113 = entry.indexOf('refusalForProgrammableInputs(params.tx)');
      const open = entry.indexOf('openDappMarketPass(walletManager.getWallet(), params.tx)');
      expect(cip113).toBeGreaterThan(-1);
      expect(open).toBeGreaterThan(cip113);
      expect(entry).toMatch(/\} finally \{\n\s+dropMarketPass\(\);/);
    });

    it('WalletConnect cardano_signTx opens it after its CIP-113 refusal and drops it however the request ends', () => {
      const start = bg.indexOf("case 'cardano_signTx': {");
      const entry = bg.slice(start, bg.indexOf("case 'cardano_signData': {", start));
      const cip113 = entry.indexOf('refusalForProgrammableInputs(wcTx)');
      const open = entry.indexOf('openDappMarketPass(walletManager.getWallet(), wcTx)');
      expect(cip113).toBeGreaterThan(-1);
      expect(open).toBeGreaterThan(cip113);
      expect(entry).toMatch(/\} finally \{\n\s+dropMarketPass\(\);/);
    });

    it('those three are the only places a pass is opened', () => {
      expect(calls).toHaveLength(3);
      expect(calls.map((index) => enclosing(bg, index)).sort()).toEqual([
        'app.add(METHOD.signTx, async (request, sendResponse) => {',
        'app.addToOptions(MessageTypes.CIP45_INVOKE, async (request, sendResponse) => {',
        'wcService.onSessionRequest = async (event) => {',
      ]);
    });

    // CIP45_INVOKE is the one of the three that an extension page can reach (it is the bridge
    // page's channel, bound to a cip45 authorization it must present); the other two are the dApp
    // channel and WalletConnect's internal callback. No other message handler (SIGN_TX included,
    // which the approval pages call) can open a pass.
    it('no other registered message handler opens a pass', () => {
      const pageReachable = calls
        .map((index) => enclosing(bg, index))
        .filter((line) => line.startsWith('app.addToOptions('))
        .map((line) => /MessageTypes\.(\w+)/.exec(line)![1]);
      expect(pageReachable).toEqual(['CIP45_INVOKE']);
    });

    it('nothing outside the pass helper grants one', () => {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.(ts|vue)$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) files.push(full);
        }
      };
      walk(join(__dirname, '..', '..'));
      const granting = files
        .filter((file) => /grantDappMarketPass\(/.test(readFileSync(file, 'utf8')))
        .map((file) => file.slice(file.lastIndexOf('src/')));
      expect(granting.sort()).toEqual(['src/chrome/nftMarket/dappMarketPass.ts', 'src/chrome/nftMarket/marketAllowance.ts']);
    });
  });

  describe('SIGN_TX signs the transaction its CBOR describes', () => {
    const start = bg.indexOf('const transaction = transactionFromSignRequest(request.data);');
    const handler = bg.slice(bg.lastIndexOf('\napp.addToOptions(MessageTypes.SIGN_TX,', start), bg.indexOf('\napp.addToOptions(', start));

    it('parses it from txCbor only', () => {
      expect(start).toBeGreaterThan(-1);
      expect(handler).toContain('transactionFromSignRequest(request.data)');
      expect(handler).not.toMatch(/request\.data\.tx(?!Cbor)\b/);
      expect(handler).not.toContain('legacy transaction object');
    });
  });

  describe('the prepare handlers', () => {
    const kinds = [
      ['LIST', 'list'],
      ['REPRICE', 'reprice'],
      ['CANCEL', 'cancel'],
      ['BUY', 'buy'],
      ['MIGRATE', 'migrate'],
    ] as const;
    // The object literal, up to its closing `};`.
    const depsStart = bg.indexOf('const marketPrepareDeps: MarketHandlerDeps = {');
    expect(depsStart).toBeGreaterThan(-1);
    const deps = bg.slice(depsStart, bg.indexOf('\n};\n', depsStart));

    it.each(kinds)('NFT_MARKET_PREPARE_%s is registered once, through the extension-pages channel, for its own action', (message, action) => {
      const registration = `app.addToOptions(MessageTypes.NFT_MARKET_PREPARE_${message}, marketPrepareHandler('${action}', marketPrepareDeps));`;
      expect(bg.split(registration)).toHaveLength(2);
      // Never the dApp channel, where a web page could reach it.
      expect(bg).not.toMatch(new RegExp(`app\\.add\\(\\s*MessageTypes\\.NFT_MARKET_PREPARE_${message}`));
    });

    it('reads the wallet from the worker, never from a request', () => {
      expect(deps).toContain('walletManager.getWallet()');
      expect(deps).toContain('WalletStore.state.utxos');
      expect(deps).toContain('WalletStore.state.keys');
      expect(deps).toContain('WalletStore.state.collateral');
      expect(deps).toContain('WalletStore.state.listedListings');
      expect(deps).toContain('NetworkStore.state.epochParams?.coinsPerUtxoByte');
      expect(deps).toContain('networks.resolveNftMarketDeployments(chain, network)');
      expect(deps).not.toMatch(/request\.data/);
    });

    it('waits for the worker to boot, so the wallet and its listings are restored first', () => {
      expect(deps).toMatch(/\n {2}booted,\n/);
    });

    it('builds through Nexus, reads the listing independently of it and grants the market allowance (not the CIP-113 one)', () => {
      for (const call of [
        'nexusTxApi.buildNftMarketList(',
        'nexusTxApi.buildNftMarketReprice(',
        'nexusTxApi.buildNftMarketCancel(',
        'nexusTxApi.buildNftMarketBuy(',
        'nexusTxApi.buildNftMarketMigrate(',
        'nftMarketApi.listing(',
        'nftMarketApi.royalties(',
        'fetchListingUtxoProven(',
        'fetchLegacyListings(',
      ]) {
        expect(deps, call).toContain(call);
      }
      expect(deps).toContain('grantAllowance: grantMarketSignAllowance');
      expect(deps).toContain('markNexusLent');
      expect(deps).not.toMatch(/Cip113/);
    });

    it('only the prepare handlers grant the page allowance', () => {
      expect(bg.match(/grantMarketSignAllowance\b/g)).toHaveLength(2); // the import and the deps
      expect(bg).not.toMatch(/grantMarketSignAllowance\(/);
    });
  });

  it('the preflight tells the page which refusal it is, and the TREZOR handler throws that message', () => {
    expect(bg).toContain('...(refusal ? { message: refusal.message } : {})');
    expect(bg).toContain('throw new Error(trezorRefusal.message)');
  });
});

describe('NFT market sale-alert registration wiring', () => {
  it('NOTIFY_WATCH_LISTINGS is registered once, on the extension-pages channel, through the worker-side handler', () => {
    expect(bg).toContain('app.addToOptions(MessageTypes.NOTIFY_WATCH_LISTINGS, watchListingsHandler(listingWatchDeps));');
    // The dApp-facing registry (`app.add`) never carries it: the only mention is that registration.
    expect(bg.match(/MessageTypes\.NOTIFY_WATCH_LISTINGS/g)).toHaveLength(1);
  });

  it('the handler reads the wallet, the key set and the verified listings from the worker, and registers through the notify actions', () => {
    const start = bg.indexOf('const listingWatchDeps: ListingWatchDeps = {');
    expect(start).toBeGreaterThan(-1);
    const deps = bg.slice(start, bg.indexOf('\n};', start));
    expect(deps).toContain('getWallet: () => walletManager.getWallet()');
    expect(deps).toContain('keys: WalletStore.state.keys');
    expect(deps).toContain('listedListings: WalletStore.state.listedListings');
    // The same union of keys as WalletBg.ownListingIdentity: the key set and the keys derived from the xpub.
    expect(deps).toContain('derivedPaymentKeyHashes: () => walletManager.getWallet()?.derivePaymentCredentials() ?? []');
    expect(deps).toContain('watch: (input) => notifyActions.watchListings(input)');
    // A guard, not UI: the feature flag has no say.
    expect(deps).not.toMatch(/isNftMarketEnabled/);
  });

  it('the prepare handlers hand their verified listings to the same memory the watch handler reads', () => {
    const start = bg.indexOf('const marketPrepareDeps: MarketHandlerDeps = {');
    const deps = bg.slice(start, bg.indexOf('\n};', start));
    expect(deps).toContain('rememberListing: rememberVerifiedListing');
  });
});
