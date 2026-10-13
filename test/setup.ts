import { config } from '@vue/test-utils';

// VTU1 rendered the default slot of explicitly stubbed components. Preserve
// that observable content while migrating each test to VTU2's global options.
// This does not stub production stores, messages, forms, validation or signing.
config.global.renderStubDefaultSlot = true;

// happy-dom does not provide layout observers used by real Vuetify components.
// Browser suites remain responsible for measured layout and observer behavior.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// The browser API is nullable; happy-dom omits the global entirely. Menu layout
// is covered in the browser, while unit tests still exercise the real controls.
if (!('visualViewport' in globalThis)) {
  Object.defineProperty(globalThis, 'visualViewport', { value: null, configurable: true });
}
