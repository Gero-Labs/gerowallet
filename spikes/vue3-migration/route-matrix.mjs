#!/usr/bin/env node
// V02 (#1284) route validation matrix: every shipped route, its V07-V11 owner
// and the checks that exercise it. Joins the routes read from both routers with
// the curated route-matrix.json and writes ROUTE-MATRIX.md.
//
//   node spikes/vue3-migration/route-matrix.mjs           regenerate the document
//   node spikes/vue3-migration/route-matrix.mjs --check   fail if the routers, the
//                                                          JSON or the document disagree
//   ... --e2e <gerowallet-e2e-tests checkout>             also check each E2E reference:
//                                                          the spec exists at harnessSha
//                                                          and names the route's path
//
// Reads the working tree (tracked files only), so it runs in a shallow CI checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { localResolver, routeInventory } from './routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const here = 'spikes/vue3-migration';
const args = process.argv.slice(2);
const usage = 'Usage: node spikes/vue3-migration/route-matrix.mjs [--check] [--e2e <gerowallet-e2e-tests checkout>]';
assert(args.every((arg, index) => ['--check', '--e2e'].includes(arg) || args[index - 1] === '--e2e'), usage);
const check = args.includes('--check');
const e2eIndex = args.indexOf('--e2e');
assert(e2eIndex < 0 || args[e2eIndex + 1], usage);
const e2eRoot = e2eIndex < 0 ? null : path.resolve(args[e2eIndex + 1]);

const ROUTERS = [['src/modules/navigation/router.ts', 'options'], ['src/sidepanel/router.ts', 'sidepanel']];
const KINDS = ['unit', 'guards', 'help-browser', 'e2e', 'manual'];
const AUTOMATED = ['unit', 'guards', 'help-browser', 'e2e'];
const LOCAL_KINDS = new Set(['unit', 'guards', 'help-browser']);
const E2E_REF = /^\d{2}-[a-z0-9-]+\/[A-Za-z0-9.-]+\.spec\.ts$/;

const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean));
const read = file => readFileSync(path.join(root, file), 'utf8');

// Only the two router files are parsed; imports resolve against tracked src files.
const sources = new Map(ROUTERS.map(([file]) => [file, read(file)]));
const parsed = new Map(ROUTERS.map(([file]) => [file, ts.createSourceFile(file, sources.get(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)]));
const resolveLocal = localResolver(new Set([...tracked].filter(file => file.startsWith('src/'))));
const routes = ROUTERS.flatMap(([file, app]) => routeInventory(file, app, { parsed, sources, resolveLocal }).routes);

const matrix = JSON.parse(read(`${here}/route-matrix.json`));
assert.equal(matrix.schemaVersion, 1, 'route-matrix.json: unknown schemaVersion');
assert.deepEqual(Object.keys(matrix.kinds).sort(), [...KINDS].sort(), 'route-matrix.json: kinds must describe exactly ' + KINDS.join(', '));

// Every route has an entry, and every entry names a route.
const routeKey = route => `${route.app}:${route.path}`;
const keys = new Set(routes.map(routeKey));
assert.equal(keys.size, routes.length, 'Duplicate route paths');
const problems = [];
for (const key of keys) if (!matrix.routes[key]) problems.push(`${key}: shipped route has no entry in route-matrix.json`);
for (const key of Object.keys(matrix.routes)) if (!keys.has(key)) problems.push(`${key}: entry names no route in the routers`);
for (const [key, entry] of Object.entries(matrix.routes)) {
  assert(Array.isArray(entry.checks), `${key}: checks must be an array`);
  for (const item of entry.checks) {
    if (!AUTOMATED.includes(item.kind)) problems.push(`${key}: unknown check kind ${item.kind}`);
    else if (LOCAL_KINDS.has(item.kind) && !tracked.has(item.ref)) problems.push(`${key}: ${item.ref} is not a tracked file`);
    else if (item.kind === 'guards' && item.ref !== 'src/modules/navigation/router.guards.spec.ts') problems.push(`${key}: guards must reference router.guards.spec.ts`);
    else if (item.kind === 'e2e' && !E2E_REF.test(item.ref)) problems.push(`${key}: ${item.ref} is not a tests/specs path`);
    if (item.funded !== undefined && (item.kind !== 'e2e' || item.funded !== true)) problems.push(`${key}: funded is only for e2e checks`);
    if (item.via !== undefined && (item.kind !== 'e2e' || typeof item.via !== 'string' || !item.via)) problems.push(`${key}: via is a non-empty string, only on e2e checks`);
  }
  if (entry.via !== undefined) problems.push(`${key}: via belongs on an e2e check, not the route`);
}
// A route that renders a view needs a check that renders it (unit, Help browser
// or unfunded E2E) or a manual step; the guard spec only proves where the router
// lands. A redirect or catch-all has no view, so a guard check covers it.
for (const route of routes) {
  const entry = matrix.routes[routeKey(route)];
  if (!entry) continue;
  if (route.component ? !viewChecks(entry).length && !entry.manual : !entry.checks.some(item => item.kind === 'guards') && !entry.manual) {
    problems.push(`${routeKey(route)}: ${route.component ? 'no check renders this view' : 'no guard check covers this redirect'}, so a manual step is required`);
  }
}
if (e2eRoot) problems.push(...verifyE2e());
assert.equal(problems.length, 0, `route-matrix.json does not match the routers:\n  ${problems.join('\n  ')}`);

/** Checks that render the route's view without a funded wallet, a device or a live provider. */
function viewChecks(entry) {
  return entry.checks.filter(item => !item.funded && item.kind !== 'guards');
}

/**
 * Optional check against a local gerowallet-e2e-tests checkout: the checkout is
 * at harnessSha, each referenced spec exists, and it names the route's static
 * path prefix (or the check says `via` how it reaches the route).
 */
function verifyE2e() {
  const found = [];
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: e2eRoot, encoding: 'utf8', timeout: 10000 }).trim();
  if (head !== matrix.e2e.harnessSha) found.push(`e2e checkout is at ${head}, not harnessSha ${matrix.e2e.harnessSha}`);
  const specs = path.join(e2eRoot, 'tests', 'specs');
  for (const route of routes) {
    const entry = matrix.routes[routeKey(route)];
    const needle = route.path.split(/[:(]/)[0].replace(/\/+$/, '');
    for (const item of entry?.checks.filter(check => check.kind === 'e2e') ?? []) {
      // OX Agent: [javascript-path-traversal-prevention] Path Traversal prevented by path normalization and base directory validation
      const file = path.resolve(specs, item.ref);
      if (!file.startsWith(specs + path.sep) || !existsSync(file)) { found.push(`${routeKey(route)}: ${item.ref} does not exist in the e2e checkout`); continue; }
      if (item.via || !needle) continue;
      if (!readFileSync(file, 'utf8').includes(needle)) found.push(`${routeKey(route)}: ${item.ref} never names ${needle}; fix the reference or say how it gets there with via`);
    }
  }
  return found;
}

const cell = text => String(text).replace(/\|/g, '\\|');
const code = text => '`' + text + '`';
function gates(route) {
  const items = [];
  if (route.metaPublic) items.push('public');
  else if (route.metaRequiresAuth) items.push('auth');
  for (const flag of route.featureFlags) items.push(code(flag));
  for (const guard of route.guards) {
    const kind = guard.kind.replace(/ \(.*\)$/, '');
    if (kind === 'network-support') items.push('network');
    else if (kind === 'route guard') items.push('side-panel guard');
    else if (kind !== 'maintenance') items.push(kind);
  }
  if (route.redirect) items.push(typeof route.redirect === 'string' ? `redirect ${code(route.redirect)}` : 'redirect (computed)');
  return [...new Set(items)].join(', ') || '-';
}
const label = item => `${item.kind}: ${code(item.ref.replace(/^src\//, ''))}${item.funded ? ' (funded)' : ''}${item.via ? ` (via ${item.via})` : ''}`;
function checks(entry) {
  const lines = entry.checks.map(label);
  if (entry.note) lines.push(`_${entry.note}_`);
  return lines.join('<br>') || '-';
}

const owners = ['V04', 'V07', 'V08', 'V09', 'V10', 'V11'];
const byOwner = Object.fromEntries(owners.map(owner => [owner, routes.filter(route => route.primary === owner).length]).filter(([, count]) => count));
const views = routes.filter(route => route.component);
const redirects = routes.filter(route => !route.component);
const viewCovered = views.filter(route => viewChecks(matrix.routes[routeKey(route)]).length);
const manualOnly = views.filter(route => !viewChecks(matrix.routes[routeKey(route)]).length);
const guardOnly = manualOnly.filter(route => matrix.routes[routeKey(route)].checks.some(item => item.kind === 'guards'));
const fundedOnly = views.filter(route => {
  const entry = matrix.routes[routeKey(route)];
  return entry.checks.some(item => item.funded) && !viewChecks(entry).some(item => item.kind === 'e2e');
});
const withManual = routes.filter(route => matrix.routes[routeKey(route)].manual);

const lines = [
  '# Route validation matrix',
  '',
  '<!-- Generated by `node spikes/vue3-migration/route-matrix.mjs` from the two routers and `route-matrix.json`. Edit the JSON, not this file. -->',
  '',
  `V02 ([#1284](https://github.com/Gero-Labs/gerowallet/issues/1284)) asks for a documented matrix that maps every shipped route to its V07–V11 work package and a validation method, including manual hardware checks. This is that matrix for the routes in \`${ROUTERS[0][0]}\` and \`${ROUTERS[1][0]}\` in the working tree. The owner is the route component's primary work package from \`routes.mjs\`, the same rule as the V01 inventory; V04 owns redirects and catch-alls.`,
  '',
  'The ESLint Config Gate workflow runs `route-matrix.mjs --check`, so a route added or renamed without an entry in `route-matrix.json` fails the PR. Add `--e2e <checkout>` locally to confirm each E2E spec exists at the pinned harness and names its route.',
  '',
  '## How each route is checked',
  '',
  ...KINDS.map(kind => `- **${kind}**: ${matrix.kinds[kind]}`),
  '',
  `E2E references are paths under \`tests/specs\` in [${matrix.e2e.repository}](https://github.com/${matrix.e2e.repository}) at harness \`${matrix.e2e.harnessSha.slice(0, 8)}\`, whose wallet pin is \`${matrix.e2e.walletPin.slice(0, 8)}\`. ${matrix.e2e.note}`,
  '',
  '## Summary',
  '',
  `- ${routes.length} routes: ${ROUTERS.map(([, app]) => `${routes.filter(route => route.app === app).length} ${app}`).join(', ')}.`,
  `- By owner: ${Object.entries(byOwner).map(([owner, count]) => `${owner} ${count}`).join(', ')}.`,
  `- ${views.length} routes render a view; ${redirects.length} are redirects or catch-alls, covered by the guard spec or a manual step.`,
  `- ${viewCovered.length} of the ${views.length} views have a check that renders them without a funded wallet (unit, Help browser or E2E).`,
  `- ${manualOnly.length} views rely on the manual step: ${manualOnly.map(route => code(`${route.app}:${route.path}`)).join(', ') || 'none'}.`,
  `- Of those, ${guardOnly.length} have only the guard spec, which proves where the router lands but not that the view renders: ${guardOnly.map(route => code(`${route.app}:${route.path}`)).join(', ') || 'none'}.`,
  `- ${fundedOnly.length} routes have browser coverage only in specs that skip without a funded wallet: ${fundedOnly.map(route => code(`${route.app}:${route.path}`)).join(', ') || 'none'}.`,
  `- ${withManual.length} routes list a manual step (device, live provider, mainnet or funds) for the V13 signoff.`,
  '',
];
for (const [, app] of ROUTERS) {
  lines.push(`## ${app === 'options' ? 'Options page' : 'Side panel'}`, '', '| Route | Name | Owner | Gates | Automated checks | Manual |', '|---|---|---|---|---|---|');
  for (const route of routes.filter(item => item.app === app)) {
    const entry = matrix.routes[routeKey(route)];
    lines.push(`| ${code(route.path)} | ${route.name ? code(route.name) : '-'} | ${route.primary} | ${cell(gates(route))} | ${cell(checks(entry))} | ${cell(entry.manual ?? '-')} |`);
  }
  lines.push('');
}
const document = lines.join('\n');
const output = path.join(root, here, 'ROUTE-MATRIX.md');
if (check) assert.equal(read(`${here}/ROUTE-MATRIX.md`), document, 'ROUTE-MATRIX.md is stale: run node spikes/vue3-migration/route-matrix.mjs and commit the result.');
else writeFileSync(output, document);
console.log(`${check ? 'verified' : 'wrote'} ${here}/ROUTE-MATRIX.md: ${routes.length} routes, ${manualOnly.length} views manual-only${e2eRoot ? ', e2e references verified' : ''}`);
