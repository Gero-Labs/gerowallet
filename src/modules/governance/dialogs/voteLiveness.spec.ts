import { describe, it, expect, vi, beforeEach } from 'vitest';
import governanceApi from '@/api/governance-api';
import { checkActionsStillOpen } from '@/modules/governance/dialogs/voteLiveness';
import type { GovProposal } from '@/api/governance.types';

vi.mock('@/api/governance-api', () => ({
  default: {
    getProposal: vi.fn(),
  },
}));

const TX_A = 'a'.repeat(64);
const TX_B = 'b'.repeat(64);

function action(txHash: string, index: number, status = 'active'): GovProposal {
  return {
    govActionId: `${txHash}#${index}`,
    govActionIdCip129: '',
    txHash,
    index,
    slot: null,
    type: 'InfoAction',
    status,
    deposit: null,
    returnAddress: null,
    anchorUrl: null,
    anchorHash: null,
    title: `Action ${index}`,
    submittedEpoch: null,
    expiresEpoch: null,
  };
}

beforeEach(() => {
  vi.mocked(governanceApi.getProposal).mockReset();
});

describe('checkActionsStillOpen', () => {
  it('keeps every action whose re-fetched status is still active', async () => {
    vi.mocked(governanceApi.getProposal).mockImplementation(async id => {
      const [txHash, index] = id.split('#');
      return action(txHash, Number(index), 'active') as never;
    });

    const selected = [action(TX_A, 0), action(TX_B, 2)];
    const result = await checkActionsStillOpen(selected, 'Preprod');

    expect(result.open).toEqual(selected);
    expect(result.dropped).toHaveLength(0);
    // Each selected action is re-fetched fresh, immediately before the build.
    expect(governanceApi.getProposal).toHaveBeenCalledTimes(2);
    expect(governanceApi.getProposal).toHaveBeenCalledWith(`${TX_A}#0`, 'Preprod');
    expect(governanceApi.getProposal).toHaveBeenCalledWith(`${TX_B}#2`, 'Preprod');
  });

  it('drops an action that is no longer active, naming its new status', async () => {
    vi.mocked(governanceApi.getProposal).mockImplementation(async id =>
      (id.startsWith(TX_A)
        ? action(TX_A, 0, 'expired')
        : action(TX_B, 2, 'active')) as never,
    );

    const stale = action(TX_A, 0);
    const fresh = action(TX_B, 2);
    const result = await checkActionsStillOpen([stale, fresh], 'Preprod');

    expect(result.open).toEqual([fresh]);
    expect(result.dropped).toEqual([
      { action: stale, reasonKey: 'governance.actionDroppedNotOpen', status: 'expired' },
    ]);
  });

  it('drops an action the re-fetch can no longer find (404 → null)', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue(null);

    const gone = action(TX_A, 0);
    const result = await checkActionsStillOpen([gone], 'Preprod');

    expect(result.open).toHaveLength(0);
    expect(result.dropped).toEqual([{ action: gone, reasonKey: 'governance.actionDroppedGone' }]);
  });

  it('rejects when a re-fetch fails — an unverifiable action must not ride an all-or-nothing tx', async () => {
    vi.mocked(governanceApi.getProposal).mockRejectedValue(new Error('network down'));

    await expect(checkActionsStillOpen([action(TX_A, 0)], 'Preprod')).rejects.toThrow(/network down/);
  });
});
