import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

/** A fresh real plugin instance for each component test; no validation stubs. */
export function createTestVuetify() {
  return createVuetify({ components, directives });
}
