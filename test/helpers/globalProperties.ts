import type { App } from 'vue';

/**
 * Install deliberately partial plugin doubles at Vue's app-config boundary.
 * Production plugin declarations remain complete; individual component tests
 * supply only the collaborators whose behavior they exercise.
 */
export function mockGlobalProperties(properties: Record<string, unknown>): App['config']['globalProperties'] {
  return properties as App['config']['globalProperties'];
}
