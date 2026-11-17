import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';
import StepSeedPhrase from './StepSeedPhrase.vue';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const mountedWrappers: ReturnType<typeof mount>[] = [];
let originalClipboardDescriptor: PropertyDescriptor | undefined;
let clipboardWasOverridden = false;

function render(useRealAutocomplete = false) {
  const wrapper = mount(StepSeedPhrase, {
    props: { network },
    attachTo: useRealAutocomplete ? document.body : undefined,
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: useRealAutocomplete ? {} : { MnemonicAutocomplete: true },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

const lengthButtons = (wrapper: ReturnType<typeof render>) => wrapper.findAll('button.seed-phrase-length-option');
const phraseCells = (wrapper: ReturnType<typeof render>) => wrapper.findAll('.mnemonic-grid .v-col');

afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  if (clipboardWasOverridden) {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    clipboardWasOverridden = false;
  }
  vi.restoreAllMocks();
});

describe('recovery phrase length selection', () => {
  it('defaults to 24 words and exposes a labeled, pressed-state button group', () => {
    const wrapper = render();

    expect(wrapper.find('[role="group"]').attributes('aria-labelledby')).toBe('recovery-phrase-length-label');
    expect(lengthButtons(wrapper).map((button) => button.text())).toEqual(['12', '15', '24']);
    expect(lengthButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(phraseCells(wrapper)).toHaveLength(24);
  });

  it('updates the selected option and resizes the phrase grid for each supported length', async () => {
    const wrapper = render();

    for (const [index, length] of ['12', '15', '24'].entries()) {
      await lengthButtons(wrapper)[index].trigger('click');
      await flushPromises();

      expect(lengthButtons(wrapper).map((button) => button.attributes('aria-pressed')))
        .toEqual(['12', '15', '24'].map((choice) => String(choice === length)));
      expect(phraseCells(wrapper)).toHaveLength(Number(length));
      expect(wrapper.emitted('change')?.at(-1)?.[0]).toHaveLength(Number(length));
    }
  });

  it('selects the matching supported length when a phrase is pasted from the clipboard', async () => {
    const readText = vi.fn().mockResolvedValue(Array(12).fill('abandon').join(' '));
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    clipboardWasOverridden = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    const wrapper = render();

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true, bubbles: true }));
    await flushPromises();

    expect(readText).toHaveBeenCalledOnce();
    expect(lengthButtons(wrapper).map((button) => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(phraseCells(wrapper)).toHaveLength(12);
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toHaveLength(12);
  });

  it('renders numbered autocomplete fields and moves focus between them with Tab and Shift+Tab', async () => {
    const wrapper = render(true);
    const inputs = wrapper.findAll('.mnemonic-grid input[type="text"]');

    expect(inputs).toHaveLength(24);
    expect(wrapper.findAll('.mnemonic-grid .mnemonic-index').map((index) => index.text()))
      .toEqual(Array.from({ length: 24 }, (_, index) => `${index + 1}.`));

    await inputs[0].trigger('keydown', { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(inputs[1].element);

    await inputs[2].trigger('keydown', { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(inputs[1].element);
  });
});
