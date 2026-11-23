import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { MessageTypes } from '@/models/MessageTypes';

const calls = vi.hoisted(() => ({
  quote: vi.fn(),
  build: vi.fn(),
  confirm: vi.fn(),
  send: vi.fn(),
  auth: vi.fn(),
  serialize: vi.fn(),
}));
vi.mock('@/api/strike-v2.user', () => ({
  strikeUserApi: { getDepositQuote: calls.quote, buildDepositTx: calls.build, confirmDeposit: calls.confirm },
}));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: calls.auth }));
vi.mock('@/stores/walletStore', () => ({ walletStore: {} }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: calls.send } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ serializeCardanoJsSdkTx: calls.serialize }));
vi.mock('@/modules/swap/composables/utxoToCip30Hex', () => ({ utxoToCip30Hex: vi.fn(() => 'utxo-hex') }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

import { useStrikeDeposit } from './useStrikeDeposit';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());
function render() {
  let deposit!: ReturnType<typeof useStrikeDeposit>;
  mount(defineComponent({ setup: () => { deposit = useStrikeDeposit(); deposit.reset(); return () => null; } }));
  return deposit;
}

describe('account deposits reject managed-vault requests', () => {
  it.each(['vault-a', ''])('rejects vault identifier %j before building or authorization', async vaultId => {
    const deposit = render();
    expect(await deposit.buildAndSign('unused-password', vaultId)).toBe(false);
    expect(deposit.error.value).toBe('vaults.transfersUnavailable');
    expect(deposit.status.value).toBe('error');
    expect(calls.auth).not.toHaveBeenCalled();
    expect(calls.build).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
  });

  it('preserves the ordinary account path and its missing-quote guard', async () => {
    const deposit = render();
    expect(await deposit.buildAndSign('unused-password')).toBe(false);
    expect(deposit.error.value).toContain('No active deposit quote');
  });
});

describe('a Strike-built deposit is signed only when it fits the confirmed quote', () => {
  const net = Cardano.NetworkId.Mainnet;
  const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
  const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
  const OWN_CHANGE = Cardano.BaseAddress.fromCredentials(net, keyCred('c'), keyCred('b')).toAddress().toBech32();
  const ATTACKER = Cardano.BaseAddress.fromCredentials(net, keyCred('f'), keyCred('f')).toAddress().toBech32();
  const DEPOSIT = Cardano.EnterpriseAddress.fromCredentials(net, {
    type: Cardano.CredentialType.ScriptHash, hash: 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5' as Cardano.Credential['hash'],
  }).toAddress().toBech32();
  // For ADA, Strike's build pays an exchanger address it creates per deposit, not deposit_address.
  const EXCHANGER = Cardano.EnterpriseAddress.fromCredentials(net, keyCred('e')).toAddress().toBech32();
  const WALLET = 10_000_000_000n;
  const AMOUNT = 100_000_000n;
  const later = () => Math.floor(Date.now() / 1000) + 600;

  // The transaction that created the wallet's UTxO: the deposit's input is valued from it.
  const FUNDING_CBOR = Serialization.Transaction.fromCore({
    id: '3'.repeat(64),
    body: { inputs: [{ txId: '3'.repeat(64), index: 0 }], outputs: [{ address: OWN, value: { coins: WALLET } }], fee: 170_000n },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx).toCbor();
  const FUND = String(Serialization.Transaction.fromCbor(FUNDING_CBOR).getId());

  function body(outputs: [string, bigint][], fee = 200_000n, requiredExtraSignatures?: string[]): string {
    const core = {
      id: '9'.repeat(64),
      body: {
        inputs: [{ txId: FUND, index: 0 }],
        outputs: outputs.map(([address, coins]) => ({ address, value: { coins } })),
        fee,
        ...(requiredExtraSignatures ? { requiredExtraSignatures } : {}),
      },
      witness: { signatures: new Map() },
    } as unknown as Cardano.Tx;
    return Serialization.Transaction.fromCore(core).toCbor();
  }

  function sentMethods(): string[] {
    return calls.send.mock.calls.map(([message]) => (message as { method: string }).method);
  }

  async function quoted(expirationAt: number) {
    Object.assign(walletStore, {
      loggedWallet: { baseAddress: OWN },
      utxos: [[{ txId: FUND, index: 0, address: OWN }, { address: OWN, value: { coins: WALLET } }]],
      transactions: [{ tx_hash: FUND, cbor: FUNDING_CBOR }],
      keys: {
        payment: [{ address: OWN, cred: 'a'.repeat(56) }],
        change: [{ address: OWN_CHANGE, cred: 'c'.repeat(56) }],
        stake: [{ cred: 'b'.repeat(56) }],
      },
    });
    calls.auth.mockReturnValue(true);
    calls.serialize.mockImplementation((core: Cardano.Tx) => Serialization.Transaction.fromCore(core).toCbor());
    calls.quote.mockResolvedValue({
      request_id: 'req-1',
      deposit_address: DEPOSIT,
      confirmations_required: 15,
      quote: { asset_symbol: 'ADA', asset_amount: AMOUNT.toString(), usd_value: '40', exchange_rate: '0.4', expiration_at: expirationAt },
    });
    calls.confirm.mockResolvedValue({ request_id: 'req-1', status: 'pending' });
    calls.send.mockImplementation(async (message: { method: string }) => {
      if (message.method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (message.method === MessageTypes.SIGN_TX) return { data: { witnesses: 'a1' } };
      if (message.method === MessageTypes.SUBMIT_TX) return { data: { txId: 'ab'.repeat(32) } };
      return { data: {} };
    });
    const deposit = render();
    await deposit.requestQuote(100);
    expect(deposit.status.value).toBe('quoted');
    return deposit;
  }

  it('refuses a body that pays the quoted deposit and the rest of the wallet elsewhere, before signing', async () => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[DEPOSIT, AMOUNT], [ATTACKER, 9_900_000_000n]], 0n) });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('txGuard.builtTxMismatch');
    expect(deposit.status.value).toBe('error');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
    expect(sentMethods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('refuses sending more than the quote allows', async () => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[EXCHANGER, AMOUNT * 99n], [OWN, 99_800_000n]]) });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('txGuard.builtTxMismatch');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });

  it('signs and submits the exact checked bytes when the quoted amount goes to the exchanger', async () => {
    const deposit = await quoted(later());
    const unsigned = body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]);
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: unsigned, expires_at: later() });
    expect(await deposit.buildAndSign('spending-password')).toBe(true);
    const sign = calls.send.mock.calls.find(([m]) => m.method === MessageTypes.SIGN_TX)?.[0] as { data: { txCbor: string } };
    const submit = calls.send.mock.calls.find(([m]) => m.method === MessageTypes.SUBMIT_TX)?.[0] as { data: { txCbor: string } };
    expect(sign.data.txCbor).toBe(unsigned);
    expect(submit.data.txCbor).toBe(unsigned);
    expect(deposit.status.value).toBe('confirmed');
  });

  it.each([
    ['disconnected message port', { error: 'The message port closed before a response was received.' }],
    ['absent reply', undefined],
    ['missing transaction ID', { data: {} }],
    ['blank transaction ID', { data: { txId: ' ' } }],
  ] as const)('reports an unconfirmed submission after a %s and confirms nothing with Strike', async (_name, reply) => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({ unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
    calls.send.mockImplementation(async ({ method }: { method: string }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'a1' } };
      return reply;
    });
    expect(await deposit.buildAndSign('test-password')).toBe(false);
    expect(sentMethods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD, MessageTypes.SIGN_TX, MessageTypes.SUBMIT_TX]);
    expect(deposit.error.value).toBe('errors.submitUnconfirmed');
    expect(deposit.status.value).toBe('error');
    expect(deposit.txHash.value).toBeNull();
    expect(calls.confirm).not.toHaveBeenCalled();
  });

  it('keeps a lost signing reply from reaching the network', async () => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({ unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
    calls.send.mockImplementation(async ({ method }: { method: string }) =>
      method === MessageTypes.VERIFY_SPENDING_PASSWORD ? { data: { success: true } } : { error: 'The message port closed before a response was received.' });
    expect(await deposit.buildAndSign('test-password')).toBe(false);
    expect(sentMethods()).toEqual([MessageTypes.VERIFY_SPENDING_PASSWORD, MessageTypes.SIGN_TX]);
    expect(deposit.error.value).toBe('Failed to sign deposit transaction.');
  });

  it('accepts a change key of the wallet as a required signer, but no one else', async () => {
    const deposit = await quoted(later());
    const own = body([[EXCHANGER, AMOUNT], [OWN_CHANGE, 9_899_800_000n]], 200_000n, ['c'.repeat(56)]);
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: own });
    expect(await deposit.buildAndSign('spending-password')).toBe(true);
    expect(sentMethods()).toContain(MessageTypes.SIGN_TX);

    calls.send.mockClear();
    const other = await quoted(later());
    calls.build.mockResolvedValue({
      blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]], 200_000n, ['e'.repeat(56)]),
    });
    expect(await other.buildAndSign('spending-password')).toBe(false);
    expect(other.error.value).toBe('txGuard.builtTxMismatch');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });

  it('refuses when an input cannot be valued from the transaction that created it', async () => {
    const deposit = await quoted(later());
    Object.assign(walletStore, { transactions: [] });
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('txGuard.builtTxMismatch');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });

  it('refuses when the UTxO list understates an input its creating transaction proves', async () => {
    const deposit = await quoted(later());
    Object.assign(walletStore, { utxos: [[{ txId: FUND, index: 0, address: OWN }, { address: OWN, value: { coins: 101_000_000n } }]] });
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('txGuard.builtTxMismatch');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });

  it('refuses an expired quote before asking Strike to build', async () => {
    const deposit = await quoted(1);
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('perpetuals.deposit.quoteExpired');
    expect(calls.build).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
  });

  it.each([
    [MessageTypes.VERIFY_SPENDING_PASSWORD, false],
    [MessageTypes.SIGN_TX, true],
  ] as const)('stops if the quote expires during %s, then accepts a fresh quote', async (method, passkey) => {
    const now = vi.spyOn(Date, 'now');
    try {
      const expiry = later();
      const deposit = await quoted(expiry);
      calls.build.mockResolvedValue({ unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
      calls.send.mockImplementationOnce(async () => {
        now.mockReturnValue((expiry + 1) * 1000);
        return { data: method === MessageTypes.SIGN_TX ? { witnesses: 'a1' } : { success: true } };
      });
      expect(await deposit.buildAndSign(passkey ? '' : 'test-password', undefined, passkey ? new Uint8Array(32) : undefined)).toBe(false);
      expect(deposit.error.value).toBe('perpetuals.deposit.quoteExpired');
      expect(sentMethods()).toEqual([method]);
      expect(calls.confirm).not.toHaveBeenCalled();

      calls.quote.mockResolvedValue({ ...deposit.quote.value, request_id: 'fresh', quote: { ...deposit.quote.value!.quote, expiration_at: later() } });
      await deposit.requestQuote(100);
      expect(await deposit.buildAndSign('test-password')).toBe(true);
      expect(calls.confirm).toHaveBeenCalledWith('fresh', 'ab'.repeat(32));
    } finally {
      now.mockRestore();
    }
  });

  it('keeps a cancelled build from signing and releases the next quote to build normally', async () => {
    const deposit = await quoted(later());
    let finish!: (value: { unsigned_tx: string }) => void;
    calls.build.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = deposit.buildAndSign('test-password');
    deposit.reset();
    finish({ unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
    expect(await first).toBe(false);
    expect(sentMethods()).toEqual([]);
    expect(deposit.status.value).toBe('idle');
  });

  it('keeps the newest quote when an earlier quote arrives last', async () => {
    const deposit = await quoted(later());
    const original = deposit.quote.value!;
    let finish!: (value: typeof original) => void;
    calls.quote.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = deposit.requestQuote(100);
    calls.quote.mockResolvedValueOnce({ ...original, request_id: 'new' });
    await deposit.requestQuote(100);
    finish(original);
    await first;
    expect(deposit.quote.value?.request_id).toBe('new');
    expect(deposit.status.value).toBe('quoted');
  });

  it('confirms a transaction already broadcast with its original request when a fresh quote arrives', async () => {
    const deposit = await quoted(later());
    const original = deposit.quote.value!;
    calls.build.mockResolvedValue({ unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]) });
    calls.send.mockImplementation(async ({ method }: { method: string }) => {
      if (method === MessageTypes.VERIFY_SPENDING_PASSWORD) return { data: { success: true } };
      if (method === MessageTypes.SIGN_TX) return { data: { witnesses: 'a1' } };
      calls.quote.mockResolvedValue({ ...original, request_id: 'next' });
      await deposit.requestQuote(100);
      return { data: { txId: 'ab'.repeat(32) } };
    });
    expect(await deposit.buildAndSign('test-password')).toBe(true);
    expect(calls.confirm).toHaveBeenCalledWith('req-1', 'ab'.repeat(32));
    expect(deposit.quote.value?.request_id).toBe('next');
    expect(deposit.status.value).toBe('quoted');
  });

  it('refuses a build whose own expiry has passed', async () => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({
      blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[EXCHANGER, AMOUNT], [OWN, 9_899_800_000n]]), expires_at: 1,
    });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('perpetuals.deposit.quoteExpired');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });
});
