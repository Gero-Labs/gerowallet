// The page half of the Gero NFT market actions (list, reprice, cancel, buy, migrate): prepare in
// the worker with the message of the action, then sign and submit the CBOR exactly as the worker
// returned it, and turn every failure into one of a few states with a fixed i18n message. Messaging
// is stubbed; what is checked is the order and bytes of the messages, and what the page is told.
// The signing machinery itself is shared (usePreparedTxFlow, pinned by useLegacyRescue.spec.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, walletState, deviceSign, signerOptions, debugLog } = vi.hoisted(() => ({
  send: vi.fn(),
  walletState: {
    keys: { payment: [{ address: 'addr_p', cred: 'p', path: "m/1852'/1815'/0'/0/0" }], change: [], stake: [] },
    utxos: [['fee-utxo']] as unknown[],
    loggedWallet: undefined as { type: string; network: string } | undefined,
  },
  deviceSign: vi.fn(),
  signerOptions: [] as unknown[],
  debugLog: vi.fn(),
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...args: unknown[]) => send(...args) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));
vi.mock('@/shared/composables/useHardwareTxSigner', () => ({
  signsOnDevice: (type: string | undefined) => ['Ledger', 'Trezor', 'Keystone'].includes(type ?? ''),
  useHardwareTxSigner: (options: unknown) => {
    signerOptions.push(options);
    return { sign: (cbor: string) => deviceSign(cbor), keystone: {} };
  },
}));
vi.mock('@/api/nexus-collateral-api', () => ({ nexusCollateralApi: { cosign: vi.fn() } }));
vi.mock('@/shared/utils/witnessSets', () => ({ mergeWitnessSets: async (user: string, extra: string) => `${user}+${extra}` }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/utils/debug', () => ({ debugLog: (...args: unknown[]) => debugLog(...args) }));

import {
  NFT_MARKET_INPUT_SPENT,
  describeNftMarketFailure,
  isInputAlreadySpentError,
  useNftMarketFlow,
  type NftMarketFailureKind,
} from './useNftMarketFlow';
import type { MarketAction } from '@/chrome/nftMarket/marketPrepare';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { describeSubmitFailure } from '@/chrome/submitErrors';
import i18n from '@/plugins/i18n';
import { MessageTypes } from '@/models/MessageTypes';

const TX_CBOR = '84a400d9010281825820bb';
const TX_ID = 'cd'.repeat(32);
const UNIT = `${'aa'.repeat(28)}4e4654`;
const REF = `${'bb'.repeat(32)}#1`;
const LEGACY_REF = `${'cc'.repeat(32)}#0`;
const SUMMARY = { txId: TX_ID };

type Handler = (data: Record<string, unknown>) => unknown;
function respond(handlers: Partial<Record<string, Handler>>) {
  send.mockImplementation(async ({ method, data }: { method: string; data: Record<string, unknown> }) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected ${method}`);
    return { data: handler(data) };
  });
}

const prepared = (summary: Record<string, unknown> = SUMMARY) => () => ({
  success: true,
  result: { txCbor: TX_CBOR, txId: TX_ID, summary },
});
const refusal = (errorCode: string, extra: Record<string, unknown> = {}) => () => ({
  success: false,
  error: 'A fixed worker message',
  errorCode,
  ...extra,
});
const methods = () => send.mock.calls.map(([message]) => (message as { method: string }).method);
const messageAt = (index: number) => send.mock.calls[index][0] as { method: string; data: Record<string, unknown> };

const PREPARE: Record<MarketAction, MessageTypes> = {
  list: MessageTypes.NFT_MARKET_PREPARE_LIST,
  reprice: MessageTypes.NFT_MARKET_PREPARE_REPRICE,
  cancel: MessageTypes.NFT_MARKET_PREPARE_CANCEL,
  buy: MessageTypes.NFT_MARKET_PREPARE_BUY,
  migrate: MessageTypes.NFT_MARKET_PREPARE_MIGRATE,
};

const PAYLOADS = {
  list: { unit: UNIT, priceLovelace: '25000000' },
  reprice: { ref: REF, priceLovelace: '30000000' },
  cancel: { ref: REF },
  buy: { ref: REF },
  migrate: { legacyRef: LEGACY_REF, priceLovelace: '40000000' },
} as const;

/** Prepare an action of this name with its usual payload (the type system wants the exact pair). */
function prepareWith(action: MarketAction, flow: { prepare: (payload: never) => Promise<boolean> }): Promise<boolean> {
  return (flow.prepare as (payload: unknown) => Promise<boolean>)(PAYLOADS[action]);
}

beforeEach(() => {
  send.mockReset();
  deviceSign.mockReset();
  debugLog.mockReset();
  signerOptions.length = 0;
  walletState.loggedWallet = undefined;
});

describe('useNftMarketFlow prepare', () => {
  it.each(Object.keys(PREPARE) as MarketAction[])('%s sends its own message with the request and nothing else', async (action) => {
    respond({ [PREPARE[action]]: prepared() });
    const flow = useNftMarketFlow(action);

    expect(await prepareWith(action, flow)).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(messageAt(0)).toEqual({ method: PREPARE[action], data: PAYLOADS[action] });
    expect(flow.stage.value).toBe('review');
    expect(flow.prepared.value).toEqual({ txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY });
    expect(flow.failure.value).toBeNull();
    expect(flow.failureKind.value).toBeNull();
    expect(flow.failureMessage.value).toBeNull();
  });

  it('sends only the fields of the action, never an address, key or input a caller slipped in', async () => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared() });
    const flow = useNftMarketFlow('list');

    await (flow.prepare as (payload: unknown) => Promise<boolean>)({
      unit: UNIT,
      priceLovelace: '25000000',
      ownerPkh: 'aa'.repeat(28),
      sellerAddress: 'addr1evil',
      stakeCredential: 'bb'.repeat(28),
      inputs: ['x#0'],
    });

    expect(messageAt(0).data).toEqual({ unit: UNIT, priceLovelace: '25000000' });
  });

  it('turns a bigint price into the decimal text the worker takes', async () => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_REPRICE]: prepared() });
    const flow = useNftMarketFlow('reprice');

    await flow.prepare({ ref: REF, priceLovelace: 123_000_000n });

    expect(messageAt(0).data).toEqual({ ref: REF, priceLovelace: '123000000' });
  });

  it.each(['list', 'migrate'] as const)('%s carries the royalty confirmation only when it is exactly true', async (action) => {
    respond({ [PREPARE[action]]: prepared() });
    const flow = useNftMarketFlow(action);
    const base = PAYLOADS[action];
    const prepareRaw = flow.prepare as (payload: unknown) => Promise<boolean>;

    await prepareRaw({ ...base, confirmRoyaltyAboveCap: true });
    await prepareRaw({ ...base, confirmRoyaltyAboveCap: 'true' });
    await prepareRaw({ ...base, confirmRoyaltyAboveCap: false });
    await prepareRaw({ ...base });

    expect(messageAt(0).data).toEqual({ ...base, confirmRoyaltyAboveCap: true });
    expect(messageAt(1).data).toEqual(base);
    expect(messageAt(2).data).toEqual(base);
    expect(messageAt(3).data).toEqual(base);
  });

  it('a second prepare clears the failure of the first', async () => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_BUY]: refusal('LISTING_NOT_FOUND') });
    const flow = useNftMarketFlow('buy');
    expect(await flow.prepare({ ref: REF })).toBe(false);
    expect(flow.failureKind.value).toBe('changed');

    respond({ [MessageTypes.NFT_MARKET_PREPARE_BUY]: prepared() });
    expect(await flow.prepare({ ref: REF })).toBe(true);
    expect(flow.failure.value).toBeNull();
    expect(flow.failureKind.value).toBeNull();
  });

  it('reset returns to a clean idle flow', async () => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_CANCEL]: refusal('LISTING_NOT_FOUND') });
    const flow = useNftMarketFlow('cancel');
    await flow.prepare({ ref: REF });

    flow.reset();

    expect(flow.stage.value).toBe('idle');
    expect(flow.failure.value).toBeNull();
    expect(flow.failureKind.value).toBeNull();
    expect(flow.royaltyConfirmation.value).toBeNull();
  });
});

describe('failure states', () => {
  // [code, kind, i18n key]: the whole table of the worker's and Nexus's codes, as one place to read it.
  const TABLE: [string, NftMarketFailureKind, string][] = [
    ['LISTING_NOT_FOUND', 'changed', 'nftMarket.error.listingChanged'],
    ['NFT_NOT_FOUND', 'changed', 'nftMarket.error.nftNotFound'],
    ['VERIFY_FAILED', 'refused', 'nftMarket.error.verifyFailed'],
    ['ROYALTY_CONFIRMATION_REQUIRED', 'confirmRoyalty', 'nftMarket.error.royaltyConfirmation'],
    ['ROYALTIES_MALFORMED', 'refused', 'nftMarket.error.royaltiesMalformed'],
    ['ROYALTIES_UNREADABLE', 'retry', 'nftMarket.error.royaltiesUnreadable'],
    ['PRIVATE_LISTING', 'refused', 'nftMarket.error.privateListing'],
    ['OWN_LISTING', 'refused', 'nftMarket.error.ownListing'],
    ['LISTING_UNREADABLE', 'retry', 'nftMarket.error.listingUnreadable'],
    ['NETWORK_UNSUPPORTED', 'refused', 'nftMarket.error.networkUnsupported'],
    ['WALLET_UNSUPPORTED', 'refused', 'nftMarket.error.walletUnsupported'],
    ['WALLET_CHANGED', 'retry', 'nftMarket.error.walletChanged'],
    ['PRICE_TOO_LOW', 'refused', 'nftMarket.error.priceTooLow'],
    ['SELLER_SHARE_TOO_LOW', 'refused', 'nftMarket.error.sellerShareTooLow'],
    ['TOO_MANY_ROYALTIES', 'refused', 'nftMarket.error.tooManyRoyalties'],
    ['OFFER_NOT_MOVABLE', 'refused', 'nftMarket.error.offerNotMovable'],
    ['NOT_SINGLE_NFT', 'refused', 'nftMarket.error.notSingleNft'],
    ['NOT_OWNED', 'refused', 'nftMarket.error.notOwned'],
    ['INSUFFICIENT_ADA', 'refused', 'nftMarket.error.insufficientAda'],
    // The shared collateral pool may only be empty for now.
    ['NO_COLLATERAL', 'retry', 'nftMarket.error.noCollateral'],
    ['FEE_INPUT_SPENT', 'retry', 'nftMarket.error.feeInputSpent'],
    ['NOT_GERO_LISTING', 'refused', 'nftMarket.error.notListing'],
    ['DATUM_UNREADABLE', 'refused', 'nftMarket.error.notListing'],
    // The contract refused the listing as it now stands: refresh, then start again.
    ['EVALUATION_FAILED', 'changed', 'nftMarket.error.rejected'],
    ['INVALID_REQUEST', 'refused', 'nftMarket.error.invalidRequest'],
    ['BUILD_FAILED', 'retry', 'nftMarket.error.failed'],
    ['EXPIRED', 'retry', 'nftMarket.error.expired'],
    ['SIGN_FAILED', 'retry', 'nftMarket.error.signFailed'],
    ['SUBMIT_FAILED', 'maybeSent', 'nftMarket.error.maybeSent'],
    ['WRONG_PASSWORD', 'wrongPassword', 'errors.wrongPassword'],
    // A code nobody here knows (a Nexus code added later, a typo) is the general retry, never raw text.
    ['SOMETHING_NEW', 'retry', 'nftMarket.error.failed'],
    // A market request names one listing, so Nexus's "more listings than one transaction takes" can
    // only mean the request itself is wrong: a refusal, in the invalid-request words.
    ['TOO_MANY_LISTINGS', 'refused', 'nftMarket.error.invalidRequest'],
  ];

  // The page's own codes come from signing and submitting, never from a prepare: a prepare reply
  // that carries one is a failed build (below). Their copy is pinned by describeNftMarketFailure.
  const SIGNING_CODES = ['EXPIRED', 'SIGN_FAILED', 'SUBMIT_FAILED', 'WRONG_PASSWORD'];

  it.each(TABLE.filter(([code]) => !SIGNING_CODES.includes(code)))('%s is %s with %s', async (code, kind, key) => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: refusal(code) });
    const flow = useNftMarketFlow('list');

    expect(await flow.prepare(PAYLOADS.list)).toBe(false);

    expect(flow.failure.value?.code).toBe(code);
    expect(flow.failureKind.value).toBe(kind);
    expect(flow.failureMessage.value?.key).toBe(key);
    expect(flow.stage.value).toBe('idle');
    expect(flow.prepared.value).toBeNull();
  });

  it.each(TABLE)('describeNftMarketFailure: %s is %s with %s', (code, kind, key) => {
    const described = describeNftMarketFailure('list', { code });
    expect(described.kind).toBe(kind);
    expect(described.message.key).toBe(key);
  });

  it.each(['reprice', 'cancel', 'buy', 'migrate'] as const)(
    'LISTING_NOT_FOUND on %s is "changed": refresh, then try again',
    async (action) => {
      respond({ [PREPARE[action]]: refusal('LISTING_NOT_FOUND') });
      const flow = useNftMarketFlow(action);

      expect(await prepareWith(action, flow)).toBe(false);

      expect(flow.failureKind.value).toBe('changed');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.listingChanged' });
    },
  );

  it('a "refused" message never tells the user to try again, and a "retry" or "changed" one may', () => {
    // The kind and the copy must agree: a refusal has no Try again button, so its sentence must not offer one.
    for (const [code, kind, key] of TABLE) {
      if (kind !== 'refused') continue;
      expect(i18n.t(key, 'us', { min: '5' }), `${code} is refused, so its copy cannot say "try again"`).not.toMatch(/try again/i);
    }
  });

  it('a missing or malformed prepare reply is a failed build to retry', async () => {
    send.mockRejectedValueOnce(new Error('port closed'));
    const flow = useNftMarketFlow('buy');
    expect(await flow.prepare({ ref: REF })).toBe(false);
    expect(flow.failure.value?.code).toBe('BUILD_FAILED');
    expect(flow.failureKind.value).toBe('retry');

    respond({ [MessageTypes.NFT_MARKET_PREPARE_BUY]: () => ({ success: true, result: { txCbor: TX_CBOR } }) });
    expect(await flow.prepare({ ref: REF })).toBe(false);
    expect(flow.failure.value?.code).toBe('BUILD_FAILED');
    expect(flow.failureKind.value).toBe('retry');
  });

  it('shows the minimum price and the minimum seller share in ADA', () => {
    expect(describeNftMarketFailure('list', { code: 'PRICE_TOO_LOW' }).message).toEqual({
      key: 'nftMarket.error.priceTooLow',
      params: { ticker: 'ADA', min: '5' },
    });
    expect(describeNftMarketFailure('list', { code: 'SELLER_SHARE_TOO_LOW' }).message).toEqual({
      key: 'nftMarket.error.sellerShareTooLow',
      params: { ticker: 'ADA', min: '1.5' },
    });
  });

  it.each(['WRONG_PASSWORD', 'EXPIRED', 'SIGN_FAILED', 'SUBMIT_FAILED', 'INPUT_SPENT'])(
    'a prepare reply that carries %s, a code the page uses for signing and submitting, is a failed build: nothing was signed',
    async (code) => {
      respond({ [MessageTypes.NFT_MARKET_PREPARE_BUY]: () => ({ success: false, error: 'x', errorCode: code }) });
      const flow = useNftMarketFlow('buy');

      expect(await flow.prepare({ ref: REF })).toBe(false);

      // Not a password re-prompt, not "may have been sent", not "sold or delisted".
      expect(flow.failure.value?.code).toBe('BUILD_FAILED');
      expect(flow.failureKind.value).toBe('retry');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.failed' });
    },
  );

  it('VERIFY_FAILED is the same fixed message whatever rule refused, and the rule is only logged', async () => {
    respond({
      [MessageTypes.NFT_MARKET_PREPARE_BUY]: () => ({ success: false, error: 'OUTPUTS', errorCode: 'VERIFY_FAILED' }),
    });
    const flow = useNftMarketFlow('buy');

    expect(await flow.prepare({ ref: REF })).toBe(false);

    expect(flow.failureKind.value).toBe('refused');
    expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.verifyFailed' });
    expect(debugLog).toHaveBeenCalledWith('NFT market verify refused:', 'buy', 'OUTPUTS');
    // The rule never reaches the page's state: a dialog cannot show what it is not given.
    expect(flow.failure.value).toEqual({ code: 'VERIFY_FAILED' });
    expect(JSON.stringify(flow.failure.value)).not.toContain('OUTPUTS');
    expect(JSON.stringify(flow.failureMessage.value)).not.toContain('OUTPUTS');
  });

  it('never exposes the text of a failed reply, whatever the code', async () => {
    const leaky = 'Nexus said: secret internal detail at 10.0.0.35';
    for (const code of ['BUILD_FAILED', 'LISTING_NOT_FOUND', 'SOMETHING_NEW', 'INSUFFICIENT_ADA']) {
      respond({
        [MessageTypes.NFT_MARKET_PREPARE_BUY]: () => ({ success: false, error: leaky, errorCode: code, message: leaky }),
      });
      const flow = useNftMarketFlow('buy');
      await flow.prepare({ ref: REF });
      expect(JSON.stringify(flow.failure.value)).not.toContain('secret');
      expect(JSON.stringify(flow.failureMessage.value)).not.toContain('secret');
    }
  });

  describe('royalty confirmation', () => {
    it('is its own state, carrying what the royalties would cost', async () => {
      respond({
        [MessageTypes.NFT_MARKET_PREPARE_LIST]: refusal('ROYALTY_CONFIRMATION_REQUIRED', {
          effectiveRoyaltyLovelace: '3750000',
          effectiveRoyaltyRate: '0.150000',
          royaltyRate: '0.150000',
        }),
      });
      const flow = useNftMarketFlow('list');

      expect(await flow.prepare(PAYLOADS.list)).toBe(false);

      expect(flow.failureKind.value).toBe('confirmRoyalty');
      expect(flow.royaltyConfirmation.value).toEqual({
        effectiveRoyaltyLovelace: '3750000',
        effectiveRoyaltyRate: '0.150000',
        royaltyRate: '0.150000',
        ada: '3.75',
        percent: '15',
      });
      // The sentence has no placeholder: the dialog shows the amounts above beside it.
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.royaltyConfirmation' });
    });

    it.each([
      ['us', '12.81'],
      ['de', '12,81'],
    ])('reads the percent in the active language (%s: %s)', async (locale, percent) => {
      const before = i18n.locale;
      i18n.locale = locale;
      try {
        respond({
          [MessageTypes.NFT_MARKET_PREPARE_LIST]: refusal('ROYALTY_CONFIRMATION_REQUIRED', {
            effectiveRoyaltyLovelace: '5125000',
            effectiveRoyaltyRate: '0.128125',
            royaltyRate: '0.130000',
          }),
        });
        const flow = useNftMarketFlow('list');
        await flow.prepare(PAYLOADS.list);
        expect(flow.royaltyConfirmation.value?.percent).toBe(percent);
        // The raw fraction the worker sent stays as it is, for the dialog's own maths.
        expect(flow.royaltyConfirmation.value?.effectiveRoyaltyRate).toBe('0.128125');

        // It follows a language switch while the dialog is open.
        i18n.locale = locale === 'us' ? 'de' : 'us';
        expect(flow.royaltyConfirmation.value?.percent).toBe(locale === 'us' ? '12,81' : '12.81');
      } finally {
        i18n.locale = before;
      }
    });

    it('shows a fractional percent, and sends the confirmation on the next prepare', async () => {
      respond({
        [MessageTypes.NFT_MARKET_PREPARE_MIGRATE]: refusal('ROYALTY_CONFIRMATION_REQUIRED', {
          effectiveRoyaltyLovelace: '5125000',
          effectiveRoyaltyRate: '0.128125',
          royaltyRate: '0.130000',
        }),
      });
      const flow = useNftMarketFlow('migrate');
      await flow.prepare(PAYLOADS.migrate);
      expect(flow.royaltyConfirmation.value?.percent).toBe('12.81');
      expect(flow.royaltyConfirmation.value?.ada).toBe('5.125');

      respond({ [MessageTypes.NFT_MARKET_PREPARE_MIGRATE]: prepared() });
      expect(await flow.prepare({ ...PAYLOADS.migrate, confirmRoyaltyAboveCap: true })).toBe(true);
      expect(messageAt(1).data).toEqual({ ...PAYLOADS.migrate, confirmRoyaltyAboveCap: true });
      expect(flow.royaltyConfirmation.value).toBeNull();
    });

    it('a reprice asks too (its royalties stay in lovelace, so a lower price raises their share) and sends the confirmation on the next prepare', async () => {
      respond({
        [MessageTypes.NFT_MARKET_PREPARE_REPRICE]: refusal('ROYALTY_CONFIRMATION_REQUIRED', {
          effectiveRoyaltyLovelace: '5000000',
          effectiveRoyaltyRate: '0.125000',
        }),
      });
      const flow = useNftMarketFlow('reprice');
      expect(await flow.prepare(PAYLOADS.reprice)).toBe(false);
      expect(flow.failureKind.value).toBe('confirmRoyalty');
      expect(flow.royaltyConfirmation.value).toMatchObject({ ada: '5', percent: '12.5' });

      respond({ [MessageTypes.NFT_MARKET_PREPARE_REPRICE]: prepared() });
      expect(await flow.prepare({ ...PAYLOADS.reprice, confirmRoyaltyAboveCap: true })).toBe(true);
      expect(messageAt(1).data).toEqual({ ...PAYLOADS.reprice, confirmRoyaltyAboveCap: true });
      expect(flow.royaltyConfirmation.value).toBeNull();
    });

    it('sends a confirmation only when it is exactly true, for a reprice as for a list', async () => {
      for (const value of [false, 'true', 1, 'yes', {}, null]) {
        send.mockReset();
        respond({ [MessageTypes.NFT_MARKET_PREPARE_REPRICE]: prepared() });
        const flow = useNftMarketFlow('reprice');
        await (flow.prepare as (payload: unknown) => Promise<boolean>)({ ...PAYLOADS.reprice, confirmRoyaltyAboveCap: value });
        expect(messageAt(0).data, String(value)).toEqual(PAYLOADS.reprice);
      }
    });

    it('without usable amounts there is nothing to show, but it is still a confirmation', async () => {
      respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: refusal('ROYALTY_CONFIRMATION_REQUIRED', { effectiveRoyaltyLovelace: 'many' }) });
      const flow = useNftMarketFlow('list');
      await flow.prepare(PAYLOADS.list);

      expect(flow.failureKind.value).toBe('confirmRoyalty');
      expect(flow.royaltyConfirmation.value).toBeNull();
    });

    it('is null for any other failure', async () => {
      respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: refusal('SELLER_SHARE_TOO_LOW', { effectiveRoyaltyLovelace: '3750000' }) });
      const flow = useNftMarketFlow('list');
      await flow.prepare(PAYLOADS.list);
      expect(flow.royaltyConfirmation.value).toBeNull();
    });
  });
});

describe('signing and submitting', () => {
  it('signs the exact CBOR and submits it with the witnesses', async () => {
    respond({
      [MessageTypes.NFT_MARKET_PREPARE_BUY]: prepared(),
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: true }),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    const flow = useNftMarketFlow('buy');

    expect(await flow.prepare({ ref: REF })).toBe(true);
    expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);

    expect(methods()).toEqual([
      MessageTypes.NFT_MARKET_PREPARE_BUY,
      MessageTypes.VERIFY_SPENDING_PASSWORD,
      MessageTypes.SIGN_TX,
      MessageTypes.SUBMIT_TX,
    ]);
    expect(messageAt(2).data).toMatchObject({ txCbor: TX_CBOR, partialSign: false, mergeWitnesses: false, password: 'secret' });
    expect(messageAt(3).data).toEqual({ txCbor: TX_CBOR, witnessHex: 'WITNESSES' });
    expect(flow.submittedTxId.value).toBe(TX_ID);
    expect(flow.stage.value).toBe('done');
    expect(flow.failureKind.value).toBeNull();
  });

  it('a wrong password is its own state, with the shared message, and nothing is signed', async () => {
    respond({
      [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared(),
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: false }),
    });
    const flow = useNftMarketFlow('list');
    await flow.prepare(PAYLOADS.list);

    expect(await flow.signAndSubmit({ password: 'wrong' })).toBe(false);

    expect(flow.failure.value?.code).toBe('WRONG_PASSWORD');
    expect(flow.failureKind.value).toBe('wrongPassword');
    expect(flow.failureMessage.value).toEqual({ key: 'errors.wrongPassword' });
    expect(methods()).not.toContain(MessageTypes.SIGN_TX);
    expect(flow.stage.value).toBe('review');
  });

  it('a failed signature keeps the review and offers a retry', async () => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared(), [MessageTypes.SIGN_TX]: () => ({ error: 'nope' }) });
    const flow = useNftMarketFlow('list');
    await flow.prepare(PAYLOADS.list);

    expect(await flow.signAndSubmit()).toBe(false);

    expect(flow.failureKind.value).toBe('retry');
    expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.signFailed' });
    expect(flow.stage.value).toBe('review');
    expect(flow.prepared.value?.txId).toBe(TX_ID);
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('the worker refusing to sign (the allowance ran out) is "expired": prepare again, nothing sent', async () => {
    respond({
      [MessageTypes.NFT_MARKET_PREPARE_CANCEL]: prepared(),
      [MessageTypes.SIGN_TX]: () => ({ error: NFT_MARKET_SIGN_REFUSAL_MESSAGE }),
    });
    const flow = useNftMarketFlow('cancel');
    await flow.prepare({ ref: REF });

    expect(await flow.signAndSubmit()).toBe(false);

    expect(flow.failure.value?.code).toBe('EXPIRED');
    expect(flow.failureKind.value).toBe('retry');
    expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.expired' });
    expect(flow.prepared.value).toBeNull();
    expect(flow.stage.value).toBe('idle');
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('another signing error text is a failed signature, not an expiry', async () => {
    respond({ [MessageTypes.NFT_MARKET_PREPARE_CANCEL]: prepared(), [MessageTypes.SIGN_TX]: () => ({ error: 'Gero cannot sign something else' }) });
    const flow = useNftMarketFlow('cancel');
    await flow.prepare({ ref: REF });

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SIGN_FAILED');
  });

  it('a failed submit after signing may have been sent: check activity, no retry', async () => {
    respond({
      [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared(),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => { throw new Error('port closed'); },
    });
    const flow = useNftMarketFlow('list');
    await flow.prepare(PAYLOADS.list);

    expect(await flow.signAndSubmit()).toBe(false);

    expect(flow.failureKind.value).toBe('maybeSent');
    expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.maybeSent' });
    expect(flow.prepared.value).toBeNull();
    expect(flow.stage.value).toBe('idle');
  });

  it('a submit the node answered with an unclear error may still have been sent', async () => {
    respond({
      [MessageTypes.NFT_MARKET_PREPARE_BUY]: prepared(),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ error: 'We could not confirm whether your transaction reached the network (HTTP 502).' }),
    });
    const flow = useNftMarketFlow('buy');
    await flow.prepare({ ref: REF });

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failureKind.value).toBe('maybeSent');
  });

  describe('the sale alert (NOTIFY_WATCH_LISTINGS) after a submit that went through', () => {
    const LISTING_SUMMARY = { txId: TX_ID, listingOutputIndex: 2 };
    const WATCHED = ['list', 'reprice', 'migrate'] as const;
    const watchCalls = () => send.mock.calls.map(([m]) => m as { method: string; data: Record<string, unknown> }).filter((m) => m.method === MessageTypes.NOTIFY_WATCH_LISTINGS);

    function submitted(action: MarketAction, over: { summary?: Record<string, unknown>; watch?: Handler } = {}) {
      respond({
        [PREPARE[action]]: prepared(over.summary ?? LISTING_SUMMARY),
        [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: true }),
        [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
        [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
        [MessageTypes.NOTIFY_WATCH_LISTINGS]: over.watch ?? (() => ({ success: true, result: { result: 'ok', watching: 1 } })),
      });
      return useNftMarketFlow(action);
    }

    it.each(WATCHED)('%s registers the listing output the verified summary names, once, with the logged wallet', async (action) => {
      walletState.loggedWallet = { id: 7, type: 'Normal', network: 'Preprod' } as never;
      const flow = submitted(action);
      await prepareWith(action, flow);

      expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);

      expect(watchCalls()).toHaveLength(1);
      // The index is the one the verified summary names (2), never an assumed 0; the page names no owner.
      expect(watchCalls()[0].data).toEqual({ walletId: 7, listingRefs: [`${TX_ID}#2`] });
      expect(methods().slice(-2)).toEqual([MessageTypes.SUBMIT_TX, MessageTypes.NOTIFY_WATCH_LISTINGS]);
    });

    it.each(['cancel', 'buy'] as const)('%s creates no listing of the wallet, so nothing is registered', async (action) => {
      const flow = submitted(action);
      await prepareWith(action, flow);
      expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);
      expect(watchCalls()).toHaveLength(0);
    });

    it('is never sent for a transaction that did not go through', async () => {
      // A wrong password, a refused signature and a submit that was not confirmed.
      respond({
        [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared(LISTING_SUMMARY),
        [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: false }),
      });
      const wrong = useNftMarketFlow('list');
      await wrong.prepare(PAYLOADS.list);
      expect(await wrong.signAndSubmit({ password: 'wrong' })).toBe(false);

      respond({
        [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared(LISTING_SUMMARY),
        [MessageTypes.SIGN_TX]: () => ({ witnesses: 'W' }),
        [MessageTypes.SUBMIT_TX]: () => ({ error: 'node down' }),
      });
      const unconfirmed = useNftMarketFlow('list');
      await unconfirmed.prepare(PAYLOADS.list);
      expect(await unconfirmed.signAndSubmit()).toBe(false);

      expect(watchCalls()).toHaveLength(0);
    });

    it('does not guess: a summary without a usable output index registers nothing', async () => {
      for (const summary of [{ txId: TX_ID }, { txId: TX_ID, listingOutputIndex: -1 }, { txId: TX_ID, listingOutputIndex: 1.5 }, { txId: TX_ID, listingOutputIndex: '1' }, { listingOutputIndex: 1 }]) {
        send.mockReset();
        const flow = submitted('list', { summary });
        await flow.prepare(PAYLOADS.list);
        expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);
        expect(watchCalls(), JSON.stringify(summary)).toHaveLength(0);
      }
    });

    it('never blocks the done screen: it resolves, and the flow is done, while the registration is still pending', async () => {
      // The worker never answers the registration (the channel itself stays pending, not just its payload).
      send.mockImplementation(({ method }: { method: string }) => {
        if (method === MessageTypes.NOTIFY_WATCH_LISTINGS) return new Promise(() => undefined);
        if (method === MessageTypes.NFT_MARKET_PREPARE_LIST) return Promise.resolve({ data: prepared(LISTING_SUMMARY)() });
        if (method === MessageTypes.SIGN_TX) return Promise.resolve({ data: { witnesses: 'W' } });
        if (method === MessageTypes.SUBMIT_TX) return Promise.resolve({ data: { txId: TX_ID } });
        return Promise.reject(new Error(`unexpected ${method}`));
      });
      const flow = useNftMarketFlow('list');
      await flow.prepare(PAYLOADS.list);

      expect(await flow.signAndSubmit()).toBe(true);

      expect(flow.stage.value).toBe('done');
      expect(flow.failure.value).toBeNull();
      expect(watchCalls()).toHaveLength(1);
    });

    it.each([
      ['the device has no push registration', () => ({ success: true, result: { result: 'not_registered' } })],
      ['gero-sync refuses (a 422 limit_exceeded, say)', () => ({ success: false, result: { result: 'failed' }, errorCode: 'FAILED' })],
      ['the worker refuses the listing', () => ({ success: false, result: { result: 'failed' }, errorCode: 'NOT_VERIFIED' })],
    ])('is non-fatal and only logged when %s', async (_name, watch) => {
      const flow = submitted('migrate', { watch: watch as Handler });
      await prepareWith('migrate', flow);

      expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);
      await Promise.resolve();
      await Promise.resolve();

      expect(flow.stage.value).toBe('done');
      expect(flow.failure.value).toBeNull();
      expect(debugLog).toHaveBeenCalled();
    });

    it('a message that throws is swallowed the same way', async () => {
      send.mockImplementation(async ({ method }: { method: string }) => {
        if (method === MessageTypes.NOTIFY_WATCH_LISTINGS) throw new Error('worker asleep');
        if (method === MessageTypes.NFT_MARKET_PREPARE_LIST) return { data: prepared(LISTING_SUMMARY)() };
        if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'W' } };
        if (method === MessageTypes.SUBMIT_TX) return { data: { txId: TX_ID } };
        throw new Error(`unexpected ${method}`);
      });
      const flow = useNftMarketFlow('list');
      await flow.prepare(PAYLOADS.list);

      expect(await flow.signAndSubmit()).toBe(true);
      await Promise.resolve();
      await Promise.resolve();

      expect(flow.stage.value).toBe('done');
      expect(debugLog).toHaveBeenCalled();
    });

    it('registers a transaction once, even if the submit result is asked twice', async () => {
      const flow = submitted('list');
      await flow.prepare(PAYLOADS.list);
      expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);
      // The prepared transaction is still held at "done"; a second call must not register it again.
      expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);
      expect(watchCalls()).toHaveLength(1);
    });
  });

  describe('the node refusing a spent input on submit', () => {
    // The text SUBMIT_TX really answers with: the worker's own prefix (submitErrors.ts) and the node's reason.
    const submitText = (reason: string) => describeSubmitFailure(400, reason);
    const BAD_INPUTS = submitText('Ogmios rejected tx: BadInputsUTxO (ConwayUtxoFailure)');

    async function submitRefused(action: MarketAction, message = BAD_INPUTS) {
      respond({
        [PREPARE[action]]: prepared(),
        [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
        [MessageTypes.SUBMIT_TX]: () => ({ error: message }),
      });
      const flow = useNftMarketFlow(action);
      await prepareWith(action, flow);
      const ok = await flow.signAndSubmit();
      return { flow, ok };
    }

    it('a buy that lost the race reads "just bought or delisted" and is "changed"', async () => {
      const { flow, ok } = await submitRefused('buy');

      expect(ok).toBe(false);
      expect(flow.failure.value?.code).toBe(NFT_MARKET_INPUT_SPENT);
      expect(flow.failureKind.value).toBe('changed');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.soldOrDelisted' });
      // The node refused it: nothing is on its way, and the prepared transaction is spent.
      expect(flow.prepared.value).toBeNull();
      expect(flow.stage.value).toBe('idle');
    });

    it.each(['reprice', 'cancel', 'migrate'] as const)('a %s whose listing moved is "changed": refresh the listing', async (action) => {
      const { flow } = await submitRefused(action);
      expect(flow.failureKind.value).toBe('changed');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.listingChanged' });
    });

    it('a list whose input moved is the wallet catching up: try again', async () => {
      const { flow } = await submitRefused('list');
      expect(flow.failureKind.value).toBe('retry');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.feeInputSpent' });
    });

    it.each([
      'Ogmios rejected tx: BadInputsUTxO',
      'Ogmios rejected tx: Transaction contains unknown UTxO references as inputs. This can either be because the specified references do not exist, or because they have already been spent.',
      'Ogmios rejected tx: {"error":{"data":{"unknownOutputReferences":[{"transaction":{"id":"ab"},"index":1}]}}}',
    ])('recognises the rejection: %s', async (reason) => {
      const { flow } = await submitRefused('buy', submitText(reason));
      expect(flow.failure.value?.code).toBe(NFT_MARKET_INPUT_SPENT);
    });

    it('does not read other refusals as a spent input', async () => {
      for (const reason of [
        'Ogmios rejected tx: ValueNotConservedUTxO',
        'Ogmios rejected tx: fee 3117 is too small',
        '',
      ]) {
        const { flow } = await submitRefused('buy', submitText(reason));
        expect(flow.failure.value?.code).toBe('SUBMIT_FAILED');
        expect(flow.failureKind.value).toBe('maybeSent');
      }
    });
  });

  describe('on a hardware wallet', () => {
    beforeEach(() => {
      walletState.loggedWallet = { type: 'Ledger', network: 'Mainnet' };
    });

    it("hands the Ledger the user's transport choice", () => {
      const getIsBT = () => true;
      useNftMarketFlow('buy', { getIsBT });
      expect(signerOptions).toEqual([{ getIsBT }]);
    });

    it('a device refused by the worker (allowance gone) is "expired" too', async () => {
      respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared() });
      deviceSign.mockRejectedValue(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE));
      const flow = useNftMarketFlow('list');
      await flow.prepare(PAYLOADS.list);

      expect(await flow.signAndSubmit()).toBe(false);

      expect(flow.failure.value?.code).toBe('EXPIRED');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.expired' });
      expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    });

    it('a cancelled device keeps the review', async () => {
      respond({ [MessageTypes.NFT_MARKET_PREPARE_LIST]: prepared() });
      deviceSign.mockRejectedValue(new Error('Keystone signing cancelled'));
      const flow = useNftMarketFlow('list');
      await flow.prepare(PAYLOADS.list);

      expect(await flow.signAndSubmit()).toBe(false);
      expect(flow.failure.value?.code).toBe('SIGN_FAILED');
      expect(flow.stage.value).toBe('review');
    });
  });
});

describe('isInputAlreadySpentError', () => {
  it('names the node refusals that mean an input is gone, and not others', () => {
    expect(isInputAlreadySpentError('BadInputsUTxO')).toBe(true);
    expect(isInputAlreadySpentError('Some inputs have already been spent')).toBe(true);
    expect(isInputAlreadySpentError('unknownOutputReferences')).toBe(true);
    expect(isInputAlreadySpentError('FeeTooSmallUTxO')).toBe(false);
    expect(isInputAlreadySpentError('')).toBe(false);
  });
});
