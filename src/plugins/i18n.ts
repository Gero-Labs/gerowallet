import Vue from 'vue';
import VueI18n from 'vue-i18n';

// Vuetify locales
import { en as vuetifyEn, ru as vuetifyRu } from 'vuetify/src/locale';

// Flat structure - one file per language (includes all modules)
import cn from '@/plugins/i18n/cn';
import cz from '@/plugins/i18n/cz';
import de from '@/plugins/i18n/de';
import us from '@/plugins/i18n/us';
import es from '@/plugins/i18n/es';
import fr from '@/plugins/i18n/fr';
import gb from '@/plugins/i18n/gb';
import gr from '@/plugins/i18n/gr';
import he from '@/plugins/i18n/he';
import hr from '@/plugins/i18n/hr';
import id from '@/plugins/i18n/id';
import ind from '@/plugins/i18n/in';
import it from '@/plugins/i18n/it';
import jp from '@/plugins/i18n/jp';
import nl from '@/plugins/i18n/nl';
import pk from '@/plugins/i18n/pk';
import pt from '@/plugins/i18n/pt';
import ru from '@/plugins/i18n/ru';
import th from '@/plugins/i18n/th';
import tr from '@/plugins/i18n/tr';
import tz from '@/plugins/i18n/tz';
import vn from '@/plugins/i18n/vn';

/**
 * Wrap translations with Vuetify locale support
 */
const wrapWithVuetify = (translations: any, vuetifyLocale: any, rtl = false, locale = 'en-US') => ({
  rtl: rtl ? 'true' : 'false',
  locale,
  $vuetify: { ...vuetifyLocale },
  ...translations,
});

const messages = {
  cn: wrapWithVuetify(cn, vuetifyEn, false, 'zh-CN'),
  cz: wrapWithVuetify(cz, vuetifyEn, false, 'cs-CZ'),
  de: wrapWithVuetify(de, vuetifyEn, false, 'de-DE'),
  gb: wrapWithVuetify(gb, vuetifyEn, false, 'en-GB'),
  es: wrapWithVuetify(es, vuetifyEn, false, 'es-ES'),
  fr: wrapWithVuetify(fr, vuetifyEn, false, 'fr-FR'),
  gr: wrapWithVuetify(gr, vuetifyEn, false, 'el-GR'),
  he: wrapWithVuetify(he, vuetifyEn, true, 'he-IL'), // RTL
  hr: wrapWithVuetify(hr, vuetifyEn, false, 'hr-HR'),
  id: wrapWithVuetify(id, vuetifyEn, false, 'id-ID'),
  in: wrapWithVuetify(ind, vuetifyEn, false, 'hi-IN'),
  it: wrapWithVuetify(it, vuetifyEn, false, 'it-IT'),
  jp: wrapWithVuetify(jp, vuetifyEn, false, 'ja-JP'),
  nl: wrapWithVuetify(nl, vuetifyEn, false, 'nl-NL'),
  pk: wrapWithVuetify(pk, vuetifyEn, true, 'ur-PK'), // RTL
  pt: wrapWithVuetify(pt, vuetifyEn, false, 'pt-PT'),
  ru: wrapWithVuetify(ru, vuetifyRu, false, 'ru-RU'),
  tr: wrapWithVuetify(tr, vuetifyEn, false, 'tr-TR'),
  th: wrapWithVuetify(th, vuetifyEn, false, 'th-TH'),
  tz: wrapWithVuetify(tz, vuetifyEn, false, 'sw-TZ'),
  us: wrapWithVuetify(us, vuetifyEn, false, 'en-US'),
  vn: wrapWithVuetify(vn, vuetifyEn, false, 'vi-VN'),
};

Vue.use(VueI18n);

const getSavedLocale = (): string => {
  try {
    const savedConfig = localStorage.getItem('walletStore');
    if (savedConfig) {
      const config = JSON.parse(savedConfig);
      return config?.config?.locale || 'us';
    }
  } catch (e) {
    console.warn('Failed to load saved locale:', e);
  }
  return 'us';
};

const i18n: VueI18n = new VueI18n({
  locale: getSavedLocale(), // set locale from saved config
  fallbackLocale: 'us', // set fallback locale
  messages, // set locale messages
});

export default i18n;
