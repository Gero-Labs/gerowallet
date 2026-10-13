// Eager worker registration; the UI loads these same compiled modules lazily.
// Keep this import before background services: explicit-locale notifications
// must work before any UI selects a language. No DOM or runtime compiler.
import de from 'virtual:gero-locales/de';
import es from 'virtual:gero-locales/es';
import { registerLocaleMessages } from '@/plugins/i18n';
registerLocaleMessages('de', de);
registerLocaleMessages('es', es);
