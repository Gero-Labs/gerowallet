#!/usr/bin/env node
// V02 (#1284) route validation matrix: every shipped route, its V07-V11 owner
// and the checks that exercise it. Joins the routes read from both routers with
// the curated route-matrix.json and writes ROUTE-MATRIX.md.
//
//   node spikes/vue3-migration/route-matrix.mjs           regenerate the document
//   node spikes/vue3-migration/route-matrix.mjs --check   fail if the routers, the
//                                                          JSON or the document disagree
//
// Reads the working tree (tracked files only), so it runs in a shallow CI checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { localResolver, routeInventory } from './routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const here = 'spikes/vue3-migration';
const args = process.argv.slice(2);
assert(args.every(arg => arg === '--check'), 'Usage: node spikes/vue3-migration/route-matrix.mjs [--check]');
const check = args.includes('--check');

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
  }
  if (!automatedChecks(entry).length && !entry.manual) problems.push(`${key}: no automated check that runs unfunded, so a manual step is required`);
}
assert.equal(problems.length, 0, `route-matrix.json does not match the routers:\n  ${problems.join('\n  ')}`);

/** Checks that run without a funded wallet, a device or a live provider. */
function automatedChecks(entry) {
  return entry.checks.filter(item => !item.funded);
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
function checks(entry) {
  const lines = entry.checks.map(item => `${item.kind}: ${code(item.ref.replace(/^src\//, ''))}${item.funded ? ' (funded)' : ''}`);
  if (entry.note) lines.push(`_${entry.note}_`);
  return lines.join('<br>') || '-';
}

const owners = ['V04', 'V07', 'V08', 'V09', 'V10', 'V11'];
const byOwner = Object.fromEntries(owners.map(owner => [owner, routes.filter(route => route.primary === owner).length]).filter(([, count]) => count));
const manualOnly = routes.filter(route => !automatedChecks(matrix.routes[routeKey(route)]).length);
const fundedOnly = routes.filter(route => {
  const entry = matrix.routes[routeKey(route)];
  return entry.checks.some(item => item.funded) && !automatedChecks(entry).some(item => item.kind === 'e2e');
});
const withManual = routes.filter(route => matrix.routes[routeKey(route)].manual);

const lines = [
  '# Route validation matrix',
  '',
  '<!-- Generated by `node spikes/vue3-migration/route-matrix.mjs` from the two routers and `route-matrix.json`. Edit the JSON, not this file. -->',
  '',
  `V02 ([#1284](https://github.com/Gero-Labs/gerowallet/issues/1284)) asks for a documented matrix that maps every shipped route to its V07–V11 work package and a validation method, including manual hardware checks. This is that matrix for the routes in \`${ROUTERS[0][0]}\` and \`${ROUTERS[1][0]}\` as committed. The owner is the route component's primary work package from \`routes.mjs\`, the same rule as the V01 inventory; V04 owns redirects and catch-alls.`,
  '',
  'The ESLint Config Gate workflow runs `route-matrix.mjs --check`, so a route added or renamed without an entry in `route-matrix.json` fails the PR.',
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
  `- ${routes.length - manualOnly.length} routes have at least one automated check that runs without a funded wallet.`,
  `- ${manualOnly.length} routes have no such check and rely on the manual step: ${manualOnly.map(route => code(`${route.app}:${route.path}`)).join(', ') || 'none'}.`,
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
console.log(`${check ? 'verified' : 'wrote'} ${here}/ROUTE-MATRIX.md: ${routes.length} routes, ${manualOnly.length} manual-only`);
