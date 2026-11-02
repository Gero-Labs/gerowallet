// The page side of the worker's hardware-signer refusal: which text a refused signature reports.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));

import { assertCip113SignAllowed } from './cip113SignPreflight';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/nftMarket/marketAllowance';
import { MessageTypes } from '@/models/MessageTypes';

describe('assertCip113SignAllowed', () => {
  beforeEach(() => send.mockReset());

  it('asks the worker about this transaction and returns when it is not refused', async () => {
    send.mockResolvedValue({ data: { success: true, refused: false } });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({ method: MessageTypes.CIP113_SIGN_PREFLIGHT, data: { txCbor: '84a0' } });
  });

  it('reports the CIP-113 refusal when the worker names none (an older answer) or that one', async () => {
    send.mockResolvedValue({ data: { success: true, refused: true } });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
    send.mockResolvedValue({ data: { success: true, refused: true, message: CIP113_SIGN_REFUSAL_MESSAGE } });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it('reports the market refusal when the worker refused a market transaction', async () => {
    send.mockResolvedValue({ data: { success: true, refused: true, message: NFT_MARKET_SIGN_REFUSAL_MESSAGE } });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(NFT_MARKET_SIGN_REFUSAL_MESSAGE);
  });

  it('never repeats any other text the answer carries', async () => {
    send.mockResolvedValue({ data: { success: true, refused: true, message: '<img src=x onerror=alert(1)>' } });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it('signs nothing without an answer', async () => {
    send.mockResolvedValue({ data: { success: false } });
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow('no answer');
    send.mockResolvedValue(undefined);
    await expect(assertCip113SignAllowed('84a0', 'no answer')).rejects.toThrow('no answer');
  });
});
