// Where the Gero Companion dock is mounted on the dashboard.
//
// Vuetify 2's dialog scroll lock (mixins/overlayable, `shouldScroll`) walks
// `parentNode` up from the wheel target until it meets the element carrying
// `data-app`. A scrollable element that is NOT under `[data-app]` makes that
// walk reach `document`, which has no `hasAttribute`, and every wheel tick at
// the list's edge logs `TypeError: el.hasAttribute is not a function`.
// ContentLayout also gives `.v-application` `z-index: 1`, so a dock mounted as
// a sibling of the layout paints ABOVE every modal and its scrim instead of
// under it. Both go away only when the dock lives inside `<v-app>`, and not
// inside `<v-main>`, whose own `z-index: 1` would trap it under the scrim for
// good. Mounting the layout here would drag in the whole dashboard (see
// governanceNav.spec.ts), and happy-dom has no layout for Vuetify's scrollbar
// check to reach `shouldScroll`, so the contract is pinned on the templates.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function template(file: string): string {
  const source = readFileSync(resolve(__dirname, file), 'utf8');
  const match = source.match(/<template>([\s\S]*?)\n<\/template>/);
  if (!match) throw new Error(`${file}: no <template> block`);
  return match[1];
}

describe('agent dock placement on the dashboard', () => {
  it('ContentLayout renders the dock inside <v-app> but outside <v-main>', () => {
    const layout = template('./ContentLayout.vue');
    const dock = layout.indexOf('<AgentDock');
    expect(dock, 'ContentLayout mounts <AgentDock>').toBeGreaterThan(-1);

    const appOpen = layout.indexOf('<v-app');
    const appClose = layout.indexOf('</v-app>');
    expect(dock).toBeGreaterThan(appOpen);
    expect(dock).toBeLessThan(appClose);

    const mainOpen = layout.indexOf('<v-main');
    const mainClose = layout.indexOf('</v-main>');
    expect(mainOpen).toBeGreaterThan(-1);
    expect(dock > mainOpen && dock < mainClose, 'dock must not sit inside <v-main>').toBe(false);
  });

  it('the options shell no longer mounts the dock beside the layout', () => {
    const shell = template('../../../options/App.vue');
    expect(shell).not.toContain('<AgentDock');
  });
});
