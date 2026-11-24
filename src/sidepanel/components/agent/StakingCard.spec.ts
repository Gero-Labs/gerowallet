import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import StakingCard from './StakingCard.vue';

const message = vi.hoisted(() => vi.fn());
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: message } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/sidepanel/composables/useAgentStaking', () => ({ createAgentStaking: () => ({
  prepare: async () => {}, error: { value: '' },
  proposal: { value: { kind: 'delegate', status: 'ready', unsignedTxCbor: 'a10080', poolSymbol: 'QA', targetPoolId: 'pool' } },
}) }));

async function sign() {
  const view = mount(StakingCard, { props: { intent: { type: 'delegate', poolSymbol: 'QA' } },
    global: { mocks: { $t: (key: string) => key } } });
  await flushPromises();
  await view.get('button').trigger('click');
  await flushPromises();
  return view;
}

describe('staking card submission receipts', () => {
  it.each([undefined, { error: 'Message port closed' }, { data: {} }, { data: { txId: '   ' } }])(
    'shows the history message without claiming submission when its receipt is missing', async reply => {
      message.mockReset().mockResolvedValueOnce({ data: { witnesses: 'a10080' } }).mockResolvedValueOnce(reply);
      const view = await sign();
      expect(view.get('.staking-card__failed').text()).toBe('errors.submitUnconfirmed');
      expect(view.find('.staking-card__submitted').exists()).toBe(false);
      expect(message).toHaveBeenCalledTimes(2);
      view.unmount();
    },
  );
  it('stops after a lost signing reply and succeeds only with a transaction ID', async () => {
    message.mockReset().mockResolvedValueOnce(undefined);
    const failed = await sign();
    expect(failed.get('.staking-card__failed').text()).toBe('errors.unknownError');
    expect(message).toHaveBeenCalledTimes(1);
    failed.unmount();
    message.mockReset().mockResolvedValueOnce({ data: { witnesses: 'a10080' } }).mockResolvedValueOnce({ data: { txId: 'confirmed-id' } });
    const done = await sign();
    expect(done.get('.staking-card__submitted').text()).toBe('copilot.staking.submitted');
    done.unmount();
  });
});
