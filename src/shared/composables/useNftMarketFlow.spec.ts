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
  marketSignRefusalKey,
  useNftMarketFlow,
  type NftMarketFailureKind,
} from './useNftMarketFlow';
import type { MarketAction } from '@/chrome/nftMarket/marketPrepare';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/nftMarket/marketAllowance';
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
    ['NOT_OWNED', 'refused', 'nftMarket.error.notOwned'],
    ['INSUFFICIENT_ADA', 'refused', 'nftMarket.error.insufficientAda'],
    ['NO_COLLATERAL', 'refused', 'nftMarket.error.noCollateral'],
    ['FEE_INPUT_SPENT', 'retry', 'nftMarket.error.feeInputSpent'],
    ['NOT_GERO_LISTING', 'refused', 'nftMarket.error.notListing'],
    ['DATUM_UNREADABLE', 'refused', 'nftMarket.error.notListing'],
    ['EVALUATION_FAILED', 'refused', 'nftMarket.error.rejected'],
    ['INVALID_REQUEST', 'refused', 'nftMarket.error.invalidRequest'],
    ['BUILD_FAILED', 'retry', 'nftMarket.error.failed'],
    ['EXPIRED', 'retry', 'nftMarket.error.expired'],
    ['SIGN_FAILED', 'retry', 'nftMarket.error.signFailed'],
    ['SUBMIT_FAILED', 'maybeSent', 'nftMarket.error.maybeSent'],
    ['WRONG_PASSWORD', 'wrongPassword', 'errors.wrongPassword'],
    // A code nobody here knows (a Nexus code added later, a typo) is the general retry, never raw text.
    ['SOMETHING_NEW', 'retry', 'nftMarket.error.failed'],
    ['TOO_MANY_LISTINGS', 'retry', 'nftMarket.error.failed'],
  ];

  it.each(TABLE)('%s is %s with %s', async (code, kind, key) => {
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
    'LISTING_NOT_FOUND on %s is "changed": refresh, then try again (Review Focus 5)',
    async (action) => {
      respond({ [PREPARE[action]]: refusal('LISTING_NOT_FOUND') });
      const flow = useNftMarketFlow(action);

      expect(await prepareWith(action, flow)).toBe(false);

      expect(flow.failureKind.value).toBe('changed');
      expect(flow.failureMessage.value).toEqual({ key: 'nftMarket.error.listingChanged' });
    },
  );

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
      params: { min: '5' },
    });
    expect(describeNftMarketFailure('list', { code: 'SELLER_SHARE_TOO_LOW' }).message).toEqual({
      key: 'nftMarket.error.sellerShareTooLow',
      params: { min: '1.5' },
    });
  });

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

  describe('the node refusing a spent input on submit', () => {
    const BAD_INPUTS = 'Transaction submission failed. Ogmios rejected tx: BadInputsUTxO (ConwayUtxoFailure)';

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
      'Transaction submission failed. Transaction contains unknown UTxO references as inputs. This can either be because the specified references do not exist, or because they have already been spent.',
      'Ogmios rejected tx: {"error":{"data":{"unknownOutputReferences":[{"transaction":{"id":"ab"},"index":1}]}}}',
    ])('recognises the rejection: %s', async (message) => {
      const { flow } = await submitRefused('buy', message);
      expect(flow.failure.value?.code).toBe(NFT_MARKET_INPUT_SPENT);
    });

    it('does not read other refusals as a spent input', async () => {
      for (const message of [
        'Ogmios rejected tx: ValueNotConservedUTxO',
        'Transaction submission failed. fee 3117 is too small',
        'Transaction submission failed.',
      ]) {
        const { flow } = await submitRefused('buy', message);
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

describe('the signing refusal, for the dApp approval screens', () => {
  it('maps the worker refusal text to the expired copy and nothing else', () => {
    expect(marketSignRefusalKey(NFT_MARKET_SIGN_REFUSAL_MESSAGE)).toBe('nftMarket.error.expired');
    expect(marketSignRefusalKey('Gero cannot sign something else')).toBeNull();
    expect(marketSignRefusalKey(undefined)).toBeNull();
    expect(marketSignRefusalKey(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE))).toBe('nftMarket.error.expired');
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
