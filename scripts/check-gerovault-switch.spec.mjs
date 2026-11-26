import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gerovaultSwitchIn, inspectGerovaultSwitch } from './check-gerovault-switch.mjs';

describe('GeroVault test switch in a built bundle', () => {
  it.each([
    ['folded on', 'const GEROVAULT_FORCED_ON = true;', 'on'],
    ['minified on', 'const GEROVAULT_FORCED_ON=!0;', 'on'],
    ['an inlined env object with it on', 'const e={"VITE_BACKEND_URL":"x","VITE_GEROVAULT_FORCE_ON":"true"};', 'on'],
    ['folded off', 'const GEROVAULT_FORCED_ON = false;', 'off'],
    ['read at run time from an env object without it', 'const GEROVAULT_FORCED_ON = __vite_import_meta_env__["VITE_GEROVAULT_FORCE_ON"] === "true";', 'off'],
    ['an inlined env object with a placeholder', 'const e={"VITE_GEROVAULT_FORCE_ON":"placeholder"};', null],
    ['a comparison, not a declaration', 'if (GEROVAULT_FORCED_ON === true) run();', null],
    ['nothing of it', 'export {};', null],
  ])('reads %s', (_name, code, state) => {
    expect(gerovaultSwitchIn(code)).toBe(state);
  });

  describe('over a directory', () => {
    let directory;
    const write = (name, contents) => { mkdirSync(dirname(join(directory, name)), { recursive: true }); writeFileSync(join(directory, name), contents); };
    beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'gero-switch-')); });
    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it('lists the JavaScript files that have it on and off, and reads nothing else', () => {
      write('js/featureFlagsStore.js', 'const GEROVAULT_FORCED_ON = false;');
      write('background/index.js', 'var env = {"VITE_GEROVAULT_FORCE_ON":"true"};');
      write('assets/notes.txt', 'const GEROVAULT_FORCED_ON = true;');
      expect(inspectGerovaultSwitch(directory)).toEqual({ on: ['background/index.js'], off: ['js/featureFlagsStore.js'] });
    });
  });
});
