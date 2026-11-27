/**
 * A release bundle never carries the GeroVault test switch turned on.
 *
 * `VITE_GEROVAULT_FORCE_ON=true` at build time keeps `isVaultsEnabled` and
 * `isGeroVaultMidnightEnabled` (the Midnight vaults, still on their build-time networks only) on
 * whatever the flag service says (src/stores/featureFlagsStore.ts). One switch for both, so this
 * check covers both. It is for local test builds only. Set, the build
 * writes `const GEROVAULT_FORCED_ON = true;`, and an env object the bundler inlines whole holds
 * `"VITE_GEROVAULT_FORCE_ON": "true"`. Unset, the declaration reads a value that is not there
 * (`= __vite_import_meta_env__["VITE_GEROVAULT_FORCE_ON"] === "true"`) or is folded to `false`.
 *
 *   node scripts/check-gerovault-switch.mjs extension               fail if any built file has it on
 *   node scripts/check-gerovault-switch.mjs extension --require-off  also fail unless a file shows it
 *                                                                    off, so a change to how the build
 *                                                                    writes it cannot hide it from here
 *
 * check-release-artifact.mjs runs the first check on every release candidate; the PR bundle job
 * runs the second.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = [
  /\bGEROVAULT_FORCED_ON\s*=\s*(?:true|!0)\b/,
  /["']?VITE_GEROVAULT_FORCE_ON["']?\s*:\s*["']true["']/,
];
/** The declaration itself: present and not on is off. */
const DECLARED = /\bGEROVAULT_FORCED_ON\s*=(?!=)/;

/** 'on', 'off' or null (the file does not carry the switch) for one built file's text. */
export function gerovaultSwitchIn(code) {
  if (ON.some(pattern => pattern.test(code))) return 'on';
  return DECLARED.test(code) ? 'off' : null;
}

/** The built JavaScript files of `directory` that carry the switch on, and those that carry it off. */
export function inspectGerovaultSwitch(directory) {
  const on = [];
  const off = [];
  for (const name of readdirSync(directory, { recursive: true })) {
    const path = join(directory, name);
    if (!/\.(?:js|mjs|cjs)$/.test(name) || !statSync(path).isFile()) continue;
    const state = gerovaultSwitchIn(readFileSync(path, 'utf8'));
    const file = relative(directory, path).split(sep).join('/');
    if (state === 'on') on.push(file);
    else if (state === 'off') off.push(file);
  }
  return { on: on.sort(), off: off.sort() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const directory = args.find(arg => !arg.startsWith('--')) ?? 'extension';
  const { on, off } = inspectGerovaultSwitch(directory);
  if (on.length) {
    console.error(`check-gerovault-switch: FAIL, the bundle is built with VITE_GEROVAULT_FORCE_ON on: ${on.join(', ')}`);
    process.exitCode = 1;
  } else if (args.includes('--require-off') && !off.length) {
    console.error('check-gerovault-switch: FAIL, no built file shows the switch off; update the patterns in this script');
    process.exitCode = 1;
  } else {
    console.log(`check-gerovault-switch: OK (off in ${off.length} file${off.length === 1 ? '' : 's'})`);
  }
}
