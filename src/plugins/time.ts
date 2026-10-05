import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en'
import de from 'javascript-time-ago/locale/de'
import es from 'javascript-time-ago/locale/es'
import i18n, { getLocaleCode } from '@/plugins/i18n'

TimeAgo.addDefaultLocale(en)
TimeAgo.addLocale(de)
TimeAgo.addLocale(es)

const formatters: Record<string, TimeAgo> = {}

// Callers keep `time.format(date)`. The language follows the UI locale at call
// time, so a render after a language switch reads "hace 5 minutos".
export default {
  format(input: Date | number): string {
    const tag = getLocaleCode(i18n.locale)
    formatters[tag] ??= new TimeAgo(tag)
    return formatters[tag].format(input)
  },
}
