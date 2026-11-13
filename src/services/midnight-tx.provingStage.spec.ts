// When a send says it is proving. The background syncs DUST and signs before it
// proves, in the same call, so the proving stage starts only when the
// background reports `sendProgress.phase === 'proving'`, never before the call.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGER8_PROTOCOL_VERSION as L8, LEDGER9_PROTOCOL_VERSION_SAMPLE as L9, useMidnightChains } from '@test/helpers/midnightChains';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  api: vi.fn(),
  health: vi.fn(),
  proofServer: { mode: 'local', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301' },
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: mocks.api }));
vi.mock('@/stores/midnightStore', async () => {
  const { reactive } = await import('vue');
  return {
    midnightStore: reactive({
      proofServer: mocks.proofServer,
      sendProgress: null as null | { phase: string; percent: number },
      get shieldedProvingConsent() {
        return { version: 4, acceptedAt: 1, provider: mocks.proofServer.mode === 'zkpaas' ? 'zkpaas' : 'cloud' };
      },
    }),
  };
});
vi.mock('@/chains/midnight/midnightLocalProver', () => ({ checkProofServerHealth: mocks.health }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/chains/midnight/midnightZkpaas', () => ({
  resolveZkpaasUrl: () => 'https://prover.example',
  buildZkpaasHeaders: () => ({}),
  isZkpaasConfigured: () => true,
}));

import { midnightStore } from '@/stores/midnightStore';
import { sendShieldedNight, sendUnshieldedNight, type MidnightSendStage } from './midnight-tx.service';

const progress = (value: null | { phase: string; percent: number }) => {
  (midnightStore as { sendProgress: unknown }).sendProgress = value;
};

/**
 * The background's sign call as the page sees it: DUST sync progress, then
 * (unless `proves` is false) the proving phase, then cleared, then the answer.
 * Records the stages the page had shown at each point.
 */
function backgroundCall(stages: MidnightSendStage[], seen: Seen, proves = true) {
  return async () => {
    progress({ phase: 'syncingDust', percent: 40 });
    seen.syncing = [...stages];
    if (proves) {
      progress({ phase: 'proving', percent: -1 });
      seen.proving = [...stages];
    }
    progress(null);
    return { data: { success: true, signedTxHex: 'sealed', proven: true, ledgerTxHash: 'ledger', txIdentifiers: ['00ab'] } };
  };
}

/** The stages the page had shown when the background reported each phase. */
interface Seen { syncing?: MidnightSendStage[]; proving?: MidnightSendStage[] }

const keys = { data: { success: true, publicKeyHex: '11', addressHex: '22' } };

describe('a wallet-side send says it is proving only once the background proves', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    progress(null);
    mocks.health.mockResolvedValue(true);
    useMidnightChains({ preprod: [L9, L9], stagenet: [L9, L9], mainnet: [L8, L8] });
    mocks.api.mockReturnValue({
      buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitProvenMidnightTx: vi.fn().mockResolvedValue({ txHash: '0x1', status: 'InBlock' }),
    });
  });

  it.each([
    ['local', 'provingLocal'],
    ['zkpaas', 'provingZkpaas'],
    ['remote', 'provingDevice'],
  ])('a public send (%s): DUST sync under "working", then %s', async (mode, proving) => {
    mocks.proofServer.mode = mode;
    const stages: MidnightSendStage[] = [];
    const seen: Seen = {};
    mocks.send.mockResolvedValueOnce(keys).mockImplementationOnce(backgroundCall(stages, seen));

    await sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, (s) => stages.push(s));

    expect(seen.syncing).toEqual(['authorizing', 'building', 'working']);
    expect(seen.proving).toEqual(['authorizing', 'building', 'working', proving]);
    expect(stages).toEqual(['authorizing', 'building', 'working', proving, 'submitting', 'done']);
  });

  it('a public send whose background never reports proving stays "working" until it submits', async () => {
    const stages: MidnightSendStage[] = [];
    mocks.send.mockResolvedValueOnce(keys).mockImplementationOnce(backgroundCall(stages, {}, false));

    await sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, (s) => stages.push(s));

    expect(stages).toEqual(['authorizing', 'building', 'working', 'submitting', 'done']);
  });

  it('a proving report after the send is over changes nothing', async () => {
    const stages: MidnightSendStage[] = [];
    mocks.send.mockResolvedValueOnce(keys).mockImplementationOnce(backgroundCall(stages, {}, false));
    await sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, (s) => stages.push(s));

    progress({ phase: 'proving', percent: -1 });

    expect(stages).toEqual(['authorizing', 'building', 'working', 'submitting', 'done']);
  });

  it.each([
    ['local', 'provingLocal'],
    ['zkpaas', 'provingZkpaas'],
  ])('a private send (%s): sync and signing under "working", then %s', async (mode, proving) => {
    mocks.proofServer.mode = mode;
    const stages: MidnightSendStage[] = [];
    const seen: Seen = {};
    mocks.send.mockImplementationOnce(backgroundCall(stages, seen));

    await sendShieldedNight('Preprod', [{ receiverAddress: 'recipient', amount: 1n, tokenType: '12'.repeat(32) }], {}, 'InBlock', (s) => stages.push(s));

    expect(seen.syncing).toEqual(['working']);
    expect(seen.proving).toEqual(['working', proving]);
    expect(stages).toEqual(['working', proving, 'submitting', 'done']);
  });
});
