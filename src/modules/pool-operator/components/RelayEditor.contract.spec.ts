import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { VSelect, VTextField } from 'vuetify/components';
import { createTestVuetify } from '../../../../test/helpers/vuetify';
import { i18nPlugin } from '@/plugins/i18n';
import RelayEditor from './RelayEditor.vue';

enableAutoUnmount(afterEach);
function render(initial: Cardano.Relay[]) {
  const relays = ref(initial);
  const Host = defineComponent({ setup: () => () => h(RelayEditor, {
    modelValue: relays.value,
    'onUpdate:modelValue': (value: Cardano.Relay[]) => { relays.value = value; },
  }) });
  return { relays, wrapper: mount(Host, { global: { plugins: [createTestVuetify(), i18nPlugin] } }) };
}

describe('relay editor Vue 3 model contract', () => {
  it('keeps Cardano relay objects through native field updates and parent replacements', async () => {
    const { wrapper, relays } = render([{ __typename: 'RelayByName', hostname: 'relay.example', port: 3001 }]);
    const hostname = wrapper.findAll('input').find(input => input.element.value === 'relay.example');
    expect(hostname).toBeDefined();
    await hostname!.setValue('updated.example');
    await flushPromises();
    expect(relays.value).toEqual([{ __typename: 'RelayByName', hostname: 'updated.example', port: 3001 }]);
    expect(wrapper.findAll('input').some(input => input.element.value === 'updated.example')).toBe(true);
    relays.value = [{ __typename: 'RelayByAddress', ipv6: '::1', port: 3002 }];
    await flushPromises();
    expect(wrapper.findAll('input').some(input => input.element.value === '::1')).toBe(true);
    relays.value = [];
    await flushPromises();
    expect(wrapper.findComponent(VSelect).exists()).toBe(false);
  });

  it('publishes relay type changes and adding/removing rows using the same model shape', async () => {
    const { wrapper, relays } = render([{ __typename: 'RelayByName', hostname: 'relay.example', port: 3001 }]);
    wrapper.findComponent(VSelect).vm.$emit('update:modelValue', 'srv');
    await flushPromises();
    expect(relays.value).toEqual([{ __typename: 'RelayByNameMultihost', dnsName: '' }]);
    await wrapper.findAllComponents(VTextField).at(-1)!.find('input').setValue('_cardano._tcp.example');
    await flushPromises();
    expect(relays.value[0]).toEqual({ __typename: 'RelayByNameMultihost', dnsName: '_cardano._tcp.example' });
    await wrapper.find('button').trigger('click');
    expect(relays.value).toHaveLength(2);
    expect(relays.value[1]).toEqual({ __typename: 'RelayByName', hostname: '', port: 3001 });
    await wrapper.findAll('button').find(button => button.find('.mdi-delete').exists())!.trigger('click');
    expect(relays.value).toEqual([{ __typename: 'RelayByName', hostname: '', port: 3001 }]);
  });
});
