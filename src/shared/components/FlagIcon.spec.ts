import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FlagIcon from './FlagIcon.vue';

describe('FlagIcon', () => {
  it('draws the 4:3 flag by default and the 1:1 one for a round avatar', () => {
    expect(mount(FlagIcon, { props: { iso: 'US' } }).classes()).toEqual(['fi', 'fi-us']);
    expect(mount(FlagIcon, { props: { iso: 'us', square: true } }).classes()).toEqual(['fi', 'fi-us', 'fis']);
  });

  it('draws no flag for a code that is not two letters', () => {
    expect(mount(FlagIcon, { props: { iso: 'usa' } }).classes()).toEqual(['fi']);
  });
});
