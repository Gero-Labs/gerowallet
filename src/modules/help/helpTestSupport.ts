// Spec helper only (never imported by app code): renders the real English strings so specs can assert on visible copy.
import type Vue from 'vue';
import us from '@/plugins/i18n/us';

const dictionary = us as Record<string, string>;
const fill = (text: string, params: Record<string, unknown> = {}): string =>
  text.replace(/\{(\w+)\}/g, (_match, name: string) => name in params ? String(params[name]) : `{${name}}`);

export function translate(key: string, params?: Record<string, unknown>): string {
  return fill(dictionary[key] ?? key, params);
}
/** vue-i18n's two-form plural rule: one is the first form, anything else the second. */
export function translateChoice(key: string, count: number, params?: Record<string, unknown>): string {
  const forms = (dictionary[key] ?? key).split('|').map(form => form.trim());
  const form = forms.length > 1 && count !== 1 ? forms[1] : forms[0];
  return fill(form, { count, n: count, ...params });
}

type StubThis = Vue & { to?: string | { path: string }; href?: string };
/** Stands in for Vuetify's v-btn: a link when it has `to`/`href`, otherwise a button, keeping attrs, classes and click listeners. */
export const vBtnStub = {
  props: ['to', 'href'],
  render(this: StubThis, h: Vue.CreateElement) {
    const href = this.to ? (typeof this.to === 'string' ? this.to : this.to.path) : this.href;
    return h(href ? 'a' : 'button', { attrs: { ...this.$attrs, ...(href ? { href } : {}) }, on: this.$listeners }, this.$slots['default']);
  },
};
