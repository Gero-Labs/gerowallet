import Vue from 'vue';
import VueI18n from 'vue-i18n';

import cn from '@/plugins/i18n/cn';
import cz from '@/plugins/i18n/cz';
import de from '@/plugins/i18n/de';
import en from '@/plugins/i18n/en';
import es from '@/plugins/i18n/es';
import fr from '@/plugins/i18n/fr';
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

const messages = {
  cn: cn,
  cz: cz,
  de: de,
  en: en,
  es: es,
  fr: fr,
  gr: gr,
  he: he,
  hr: hr,
  id: id,
  in: ind,
  it: it,
  jp: jp,
  nl: nl,
  pk: pk,
  pt: pt,
  ru: ru,
  tr: tr,
  th: th,
  tz: tz,
  vn: vn,
};

Vue.use(VueI18n);

const i18n: VueI18n = new VueI18n({
  locale: 'en', // set locale
  fallbackLocale: 'en', // set fallback locale
  messages, // set locale messages
});

export default i18n;
