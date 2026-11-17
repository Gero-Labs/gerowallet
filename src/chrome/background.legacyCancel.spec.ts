// The LEGACY_LISTING_PREPARE_CANCEL handler of background.ts. background.ts itself cannot be
// loaded by a unit test (cip113Wiring.spec.ts pins the CIP-113 one by its source), so the
// handler body is built by legacyCancelPrepareHandler() from injected dependencies and
// tested here as behaviour; the registration in background.ts is pinned by its source.
// The verifier is stubbed: legacyCancelPrepare.spec.ts runs the real one.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { Blockchain, Network } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import { type LegacyCancelHandlerDeps, type LegacyCancelHandlerWallet, legacyCancelPrepareHandler } from './legacyCancelPrepare';

const TX_ID = 'ab'.repeat(32);
const SPONSORED = `${'aa'.repeat(32)}#2`;

vi.mock('./legacyCancelVerify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./legacyCancelVerify')>();
  return {
    ...actual,
    verifyLegacyCancel: vi.fn((_cbor: string, txHash: string, refs: string[], ctx: { sponsoredCollateralRef?: string }) => ({
      txId: txHash,
      feeLovelace: '300000',
      refs: [...refs],
      items: [],
      ...(ctx.sponsoredCollateralRef ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
    })),
  };
});

const OWNER = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';
const RECEIVE = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Mainnet,
  { hash: Hash28ByteBase16(OWNER), type: Cardano.CredentialType.KeyHash },
  { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash },
).toAddress().toBech32();

const LISTING: LegacyListingItem = {
  txHash: 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165',
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER,
  lovelace: '1361960',
  assets: [{ unit: `${'22'.repeat(28)}4e4654`, quantity: '1' }],
};
const REF = `${LISTING.txHash}#0`;
const FEE_UTXO = [
  { txId: Cardano.TransactionId('7d'.repeat(32)), index: 0, address: RECEIVE },
  { address: RECEIVE, value: { coins: 10_000_000n } },
] as unknown as Cardano.Utxo;

const WALLET: LegacyCancelHandlerWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: 'Normal', baseAddress: RECEIVE };

function setup(overrides: Partial<LegacyCancelHandlerDeps> = {}, initial: LegacyCancelHandlerWallet | null = WALLET) {
  let wallet: LegacyCancelHandlerWallet | null = initial;
  const sendResponse = vi.fn();
  const deps: LegacyCancelHandlerDeps = {
    booted: vi.fn().mockResolvedValue(undefined),
    getWallet: vi.fn(() => wallet),
    getState: vi.fn(() => ({
      utxos: [FEE_UTXO],
      keys: { payment: [{ address: RECEIVE, cred: OWNER, path: "m/1852'/1815'/0'/0/0" }], change: [], stake: [{ cred: STAKE, path: "m/1852'/1815'/0'/2/0" }] },
      collateral: null,
    })),
    lookup: vi.fn().mockResolvedValue([LISTING]),
    build: vi.fn().mockResolvedValue({ tx_cbor: 'aa', tx_hash: TX_ID }),
    markNexusLent: vi.fn(),
    ...overrides,
  };
  const handler = legacyCancelPrepareHandler(deps);
  const run = (data: unknown = { refs: [REF] }) => handler({ id: 'req-1', data }, sendResponse);
  return { deps, sendResponse, run, setWallet: (next: LegacyCancelHandlerWallet | null) => { wallet = next; } };
}

const replyData = (sendResponse: ReturnType<typeof vi.fn>) => sendResponse.mock.calls[0][0].data;
const nexus422 = (errorCode: string, message: string) => Object.assign(new Error(message), { response: { status: 422, data: { errorCode, message } } });

describe('the LEGACY_LISTING_PREPARE_CANCEL handler', () => {
  it('replies once with the verified transaction, in the envelope the page matches on', async () => {
    const { run, sendResponse, deps } = setup();
    await run();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      id: 'req-1',
      data: { success: true, result: { txCbor: 'aa', txId: TX_ID, summary: expect.objectContaining({ txId: TX_ID, refs: [REF]}) } },
      target: 'gerowallet',
      sender: 'extension',
    });
    expect(deps.markNexusLent).not.toHaveBeenCalled();
    expect(deps.getState).toHaveBeenCalledTimes(1);
  });

  it('hands the worker its own wallet data: the page names only the refs', async () => {
    const { run, deps } = setup();
    await run({ refs: [REF], walletId: 99, changeAddress: 'addr1_attacker', returnAddress: 'addr1_attacker', network: 'Preprod' });
    const [request, network] = (deps.build as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(network).toBe(Network.MAINNET);
    expect(request.returnAddress).toBe(RECEIVE);
    expect(request.changeAddress).toBe(RECEIVE);
  });

  it('waits for the worker to boot before it reads the wallet', async () => {
    let boot!: () => void;
    const booted = vi.fn(() => new Promise<void>((resolve) => { boot = resolve; }));
    const { run, sendResponse, deps } = setup({ booted });
    const done = run();
    await Promise.resolve();
    expect(deps.getWallet).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    boot();
    await done;
    expect(deps.getWallet).toHaveBeenCalled();
    expect(replyData(sendResponse).success).toBe(true);
  });

  it('marks the pool collateral Nexus lent, before it replies', async () => {
    const order: string[] = [];
    const markNexusLent = vi.fn(() => { order.push('mark'); });
    const { run, sendResponse } = setup({
      markNexusLent,
      build: vi.fn().mockResolvedValue({ tx_cbor: 'aa', tx_hash: TX_ID, sponsoredCollateralRef: SPONSORED }),
    });
    sendResponse.mockImplementation(() => { order.push('reply'); });
    await run();
    expect(markNexusLent).toHaveBeenCalledTimes(1);
    expect(markNexusLent).toHaveBeenCalledWith(SPONSORED);
    expect(order).toEqual(['mark', 'reply']);
    expect(replyData(sendResponse).result.summary.sponsoredCollateralRef).toBe(SPONSORED);
  });

  describe('when the wallet changes while Nexus is building', () => {
    const switched: [string, LegacyCancelHandlerWallet | null][] = [
      ['another wallet is logged in', { ...WALLET, id: 2 }],
      ['the same wallet is on another network', { ...WALLET, network: Network.PREPROD }],
      ['the wallet is on another chain', { ...WALLET, chain: Blockchain.BITCOIN }],
      ['the wallet is logged out', null],
    ];

    it.each(switched)('refuses the result with WALLET_UNSUPPORTED when %s', async (_name, next) => {
      const control = { setWallet: (_wallet: LegacyCancelHandlerWallet | null) => undefined as void };
      const build = vi.fn(async () => {
        control.setWallet(next);
        return { tx_cbor: 'aa', tx_hash: TX_ID, sponsoredCollateralRef: SPONSORED };
      });
      const { run, sendResponse, deps, setWallet } = setup({ build });
      control.setWallet = setWallet;
      await run();
      expect(build).toHaveBeenCalledTimes(1);
      expect(sendResponse).toHaveBeenCalledTimes(1);
      const data = replyData(sendResponse);
      expect(data).toEqual({ success: false, error: expect.any(String), errorCode: 'WALLET_UNSUPPORTED' });
      expect(data.result).toBeUndefined();
      expect(deps.markNexusLent).not.toHaveBeenCalled();
    });

    it('still answers when the wallet is the same one', async () => {
      const control = { setWallet: (_wallet: LegacyCancelHandlerWallet | null) => undefined as void };
      const build = vi.fn(async () => {
        control.setWallet({ ...WALLET });
        return { tx_cbor: 'aa', tx_hash: TX_ID };
      });
      const { run, sendResponse, setWallet } = setup({ build });
      control.setWallet = setWallet;
      await run();
      expect(replyData(sendResponse).success).toBe(true);
    });
  });

  it('refuses with WALLET_UNSUPPORTED when no wallet is logged in, and asks Nexus nothing', async () => {
    const { run, sendResponse, deps } = setup({}, null);
    await run();
    expect(replyData(sendResponse)).toMatchObject({ success: false, errorCode: 'WALLET_UNSUPPORTED' });
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(deps.build).not.toHaveBeenCalled();
  });

  it('answers a prepare refusal with its code', async () => {
    const { run, sendResponse, deps } = setup();
    await run({ refs: [] });
    expect(replyData(sendResponse)).toMatchObject({ success: false, errorCode: 'INVALID_REQUEST' });
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('passes a Nexus 422 code through with its message', async () => {
    const { run, sendResponse } = setup({ build: vi.fn().mockRejectedValue(nexus422('LISTING_NOT_FOUND', 'Listing already spent')) });
    await run();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(replyData(sendResponse)).toEqual({ success: false, error: 'Listing already spent', errorCode: 'LISTING_NOT_FOUND' });
  });

  it('answers LISTING_NOT_FOUND when the worker\'s own lookup no longer returns a ref, and asks Nexus to build nothing', async () => {
    // The real prepareLegacyCancel: the item was spent between the list and the click.
    const { run, sendResponse, deps } = setup({ lookup: vi.fn().mockResolvedValue([]) });
    await run();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(replyData(sendResponse)).toMatchObject({ success: false, errorCode: 'LISTING_NOT_FOUND' });
    expect(deps.lookup).toHaveBeenCalledTimes(1);
    expect(deps.build).not.toHaveBeenCalled();
  });

  it('answers anything unexpected BUILD_FAILED, still exactly once', async () => {
    const { run, sendResponse } = setup({ getState: vi.fn(() => { throw new Error('store not ready'); }) });
    await run();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(replyData(sendResponse)).toEqual({ success: false, error: 'store not ready', errorCode: 'BUILD_FAILED' });
  });

  it('answers a failed boot wait BUILD_FAILED instead of hanging', async () => {
    const { run, sendResponse } = setup({ booted: vi.fn().mockRejectedValue(new Error('boot failed')) });
    await run();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(replyData(sendResponse)).toMatchObject({ success: false, errorCode: 'BUILD_FAILED' });
  });

  it('never replies twice, even when the reply itself throws', async () => {
    const { run, sendResponse } = setup();
    sendResponse.mockImplementation(() => { throw new Error('the message port closed'); });
    await expect(run()).resolves.toBeUndefined();
    expect(sendResponse).toHaveBeenCalledTimes(1);
  });
});

describe('the LEGACY_LISTING_PREPARE_CANCEL wiring', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const bg = read('chrome/background.ts');
  const registration = (() => {
    const marker = 'app.addToOptions(MessageTypes.LEGACY_LISTING_PREPARE_CANCEL,';
    const start = bg.indexOf(marker);
    expect(start, `${marker} not found in background.ts`).toBeGreaterThan(-1);
    const next = bg.indexOf('\napp.add', start + marker.length);
    return bg.slice(start, next < 0 ? undefined : next);
  })();

  it('has its own message type', () => {
    expect(MessageTypes.LEGACY_LISTING_PREPARE_CANCEL).toBe('LEGACY_LISTING_PREPARE_CANCEL');
  });

  it('is registered through the extension-pages channel with the real lookup, build and booted gate', () => {
    expect(registration).toContain('legacyCancelPrepareHandler({');
    expect(registration).toContain('booted,');
    expect(registration).toContain('fetchLegacyListings(');
    expect(registration).toContain('nexusTxApi.buildLegacyCancel(');
    expect(registration).toContain('markNexusLent');
    expect(registration).toContain('walletManager.getWallet()');
  });

  it('reads the wallet data from the worker, never from the request', () => {
    expect(registration).toContain('WalletStore.state.utxos');
    expect(registration).toContain('WalletStore.state.keys');
    expect(registration).toContain('WalletStore.state.collateral');
    expect(registration).not.toMatch(/request\.data/);
  });

  it('grants no CIP-113 signing allowance: a legacy cancel spends no programmable input', () => {
    expect(registration).not.toMatch(/Cip113SignAllowance/);
    expect(read('chrome/legacyCancelPrepare.ts')).not.toMatch(/Cip113SignAllowance/);
  });
});
