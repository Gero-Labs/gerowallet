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

describe('a Strike-built deposit is signed only when it matches the confirmed quote', () => {
  const net = Cardano.NetworkId.Mainnet;
  const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
  const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
  const ATTACKER = Cardano.BaseAddress.fromCredentials(net, keyCred('f'), keyCred('f')).toAddress().toBech32();
  const DEPOSIT = Cardano.EnterpriseAddress.fromCredentials(net, {
    type: Cardano.CredentialType.ScriptHash, hash: 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5' as Cardano.Credential['hash'],
  }).toAddress().toBech32();
  const TX = '9'.repeat(64);
  const AMOUNT = 100_000_000n;
  const later = () => Math.floor(Date.now() / 1000) + 600;

  function body(outputs: [string, bigint][], fee = 200_000n): string {
    const core = {
      id: TX,
      body: {
        inputs: [{ txId: TX, index: 0 }],
        outputs: outputs.map(([address, coins]) => ({ address, value: { coins } })),
        fee,
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
      utxos: [{ ref: `${TX}#0` }],
      keys: { payment: [{ address: OWN, cred: 'a'.repeat(56) }], change: [], stake: [{ cred: 'b'.repeat(56) }] },
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

  it('refuses a deposit output above the quoted amount', async () => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[DEPOSIT, AMOUNT * 99n], [OWN, 100_000_000n]]) });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('txGuard.builtTxMismatch');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });

  it('signs and submits the exact checked bytes when the body matches the quote', async () => {
    const deposit = await quoted(later());
    const unsigned = body([[DEPOSIT, AMOUNT], [OWN, 9_899_800_000n]]);
    calls.build.mockResolvedValue({ blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: unsigned, expires_at: later() });
    expect(await deposit.buildAndSign('spending-password')).toBe(true);
    const sign = calls.send.mock.calls.find(([m]) => m.method === MessageTypes.SIGN_TX)?.[0] as { data: { txCbor: string } };
    const submit = calls.send.mock.calls.find(([m]) => m.method === MessageTypes.SUBMIT_TX)?.[0] as { data: { txCbor: string } };
    expect(sign.data.txCbor).toBe(unsigned);
    expect(submit.data.txCbor).toBe(unsigned);
    expect(deposit.status.value).toBe('confirmed');
  });

  it('refuses an expired quote before asking Strike to build', async () => {
    const deposit = await quoted(1);
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('perpetuals.deposit.quoteExpired');
    expect(calls.build).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
  });

  it('refuses a build whose own expiry has passed', async () => {
    const deposit = await quoted(later());
    calls.build.mockResolvedValue({
      blockchain: 'cardano', format: 'cardano_cbor', unsigned_tx: body([[DEPOSIT, AMOUNT], [OWN, 9_899_800_000n]]), expires_at: 1,
    });
    expect(await deposit.buildAndSign('spending-password')).toBe(false);
    expect(deposit.error.value).toBe('perpetuals.deposit.quoteExpired');
    expect(sentMethods()).not.toContain(MessageTypes.SIGN_TX);
  });
});
