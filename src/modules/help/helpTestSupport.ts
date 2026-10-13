// Spec helper only (never imported by app code): renders the real English strings so specs can assert on visible copy.
import * as Vue from 'vue';
import { createI18n } from 'vue-i18n';
import us from 'virtual:gero-locales/us';

// Use the production-compiled messages, including literal escapes and plurals.
const composer = createI18n({ legacy: false, locale: 'us', fallbackLocale: 'us', messages: { us } }).global;
export function translate(key: string, params: Record<string, unknown> = {}): string {
  return composer.t(key, params);
}
export function translateChoice(key: string, count: number, params: Record<string, unknown> = {}): string {
  return composer.t(key, { count, n: count, ...params }, count);
}

type StubThis = Vue.ComponentPublicInstance & { to?: string | { path: string }; href?: string };
/** Stands in for Vuetify's v-btn: a link when it has `to`/`href`, otherwise a button, keeping attrs, classes and click listeners. */
export const vBtnStub = {
  props: ['to', 'href'],
  inheritAttrs: false,
  render(this: StubThis) {
    const href = this.to ? (typeof this.to === 'string' ? this.to : this.to.path) : this.href;
    return Vue.h(href ? 'a' : 'button', { ...this.$attrs, ...(href ? { href } : {}) }, this.$slots['default']?.());
},
};
