#!/usr/bin/env node
// Reproduce the committed-source V01 inventory without executing application code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { scriptSource } from './script-source.mjs';
import { lineAt, localResolver, normalize, ownership, routeInventory, walk } from './routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'spikes/vue3-migration/inventory.json');
const args = process.argv.slice(2);
assert(args.every((arg, index) => ['--check', '--ref'].includes(arg) || args[index - 1] === '--ref'), 'Usage: node spikes/vue3-migration/inventory.mjs [--ref <commit>] [--check]');
const check = args.includes('--check');
const refIndex = args.indexOf('--ref');
assert(refIndex < 0 || args[refIndex + 1], '--ref requires a commit');
const saved = check ? JSON.parse(readFileSync(output, 'utf8')) : null;
const git = (...parameters) => execFileSync('git', parameters, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const sourceRevision = git('rev-parse', '--verify', `${refIndex < 0 ? saved?.sourceRevision ?? 'HEAD' : args[refIndex + 1]}^{commit}`).trim();
const auditRevision = 'ec6b105693858ccc2ef1562aecb43d407a76210b';
const tracked = git('ls-tree', '-r', '--name-only', sourceRevision).trim().split('\n').sort();
const isTest = file => /(^|\/)(__tests__|__fixtures__|test|tests|fixtures)\//.test(file) || /\.(spec|test)\.[^.]+$/.test(file);
const isGenerated = file => /^src\/(vendor|moonpay-js)\//.test(file) || /\.d\.ts$/.test(file);
const productionCode = tracked.filter(file => file.startsWith('src/') && /\.(vue|[cm]?[jt]sx?)$/.test(file) && !isTest(file) && !isGenerated(file));
const testCode = tracked.filter(file => /\.(vue|[cm]?[jt]sx?)$/.test(file) && isTest(file) && !isGenerated(file));
const configCode = tracked.filter(file => /^[^/]+\.config\.[cm]?[jt]s$/.test(file));
const sourceFiles = [...new Set([...productionCode, ...testCode, ...configCode, 'package.json', 'vite.config.mts'])].sort();

function readSnapshot(files) {
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: files.map(file => `${sourceRevision}:${file}\n`).join(''), maxBuffer: 128 * 1024 * 1024,
  });
  let offset = 0;
  const result = new Map();
  for (const file of files) {
    const end = batch.indexOf(10, offset);
    const header = batch.subarray(offset, end).toString('utf8');
    assert(/^[a-f0-9]+ blob \d+$/.test(header), `Cannot read ${file}: ${header}`);
    const size = Number(header.split(' ')[2]);
    result.set(file, batch.subarray(end + 1, end + 1 + size).toString('utf8'));
    offset = end + 2 + size;
  }
  assert.equal(offset, batch.length);
  return result;
}
const sources = readSnapshot(sourceFiles);
const vueFiles = productionCode.filter(file => file.endsWith('.vue'));
const fileSet = new Set(productionCode);
const sha = value => createHash('sha256').update(value).digest('hex');

const parsed = new Map(sourceFiles.filter(file => /\.(vue|[cm]?[jt]sx?)$/.test(file)).map(file => [file,
  ts.createSourceFile(file, scriptSource(file, sources.get(file)), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
]));
const resolveLocal = localResolver(fileSet);

const imports = new Map();
const dynamicImports = [];
for (const [file, ast] of parsed) {
  const refs = [];
  walk(ast, node => {
    let literal;
    let kind;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { literal = node.moduleSpecifier; kind = 'static'; }
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require')) {
      literal = node.arguments[0]; kind = 'dynamic';
      if (literal && !ts.isStringLiteralLike(literal)) dynamicImports.push({ file, line: lineAt(sources.get(file), node.getStart(ast)), expression: normalize(node.getText(ast)) });
    }
    if (literal && ts.isStringLiteralLike(literal)) refs.push({ specifier: literal.text, kind, line: lineAt(sources.get(file), node.getStart(ast)), resolved: resolveLocal(file, literal.text) ?? null });
  });
  imports.set(file, refs);
}

const routeContext = { parsed, sources, resolveLocal };
const routers = [routeInventory('src/modules/navigation/router.ts', 'options', routeContext), routeInventory('src/sidepanel/router.ts', 'sidepanel', routeContext)];
const allRoutes = routers.flatMap(router => router.routes);
function reachable(entry) {
  const reached = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    queue.push(...(imports.get(file) ?? []).map(item => item.resolved).filter(Boolean));
  }
  return reached;
}
const reachability = { options: reachable('src/options/main.ts'), sidepanel: reachable('src/sidepanel/main.ts') };
const reverseImports = new Map();
for (const [file, refs] of imports) for (const item of refs) if (item.resolved && fileSet.has(file)) {
  const values = reverseImports.get(item.resolved) ?? [];
  values.push({ file, line: item.line }); reverseImports.set(item.resolved, values);
}

const apiMatches = Object.fromEntries([
  ...['observable', 'set', 'delete', 'use', 'extend', 'component', 'mixin', 'filter'].map(name => `Vue.${name} calls`),
  ...['$set', '$delete', '$on', '$off', '$once'].map(name => `${name} calls (receiver not type-resolved)`),
  'new Vue calls', 'script setup SFCs', 'Vuetify tag occurrences', '.sync template modifiers', '.native template modifiers',
  '$listeners template references', '$scopedSlots references', 'private Vuetify selector candidates', 'deep selector candidates',
].map(metric => [metric, []]));
function record(metric, file, line) { (apiMatches[metric] ??= []).push({ file, line }); }
for (const file of productionCode) {
  const ast = parsed.get(file);
  const text = sources.get(file);
  walk(ast, node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const expression = node.expression;
      if (expression.expression.getText(ast) === 'Vue' && ['observable', 'set', 'delete', 'use', 'extend', 'component', 'mixin', 'filter'].includes(expression.name.text)) record(`Vue.${expression.name.text} calls`, file, lineAt(text, node.getStart(ast)));
      if (['$set', '$delete', '$on', '$off', '$once'].includes(expression.name.text)) record(`${expression.name.text} calls (receiver not type-resolved)`, file, lineAt(text, node.getStart(ast)));
    }
    if (ts.isNewExpression(node) && node.expression.getText(ast) === 'Vue') record('new Vue calls', file, lineAt(text, node.getStart(ast)));
  });
  if (!file.endsWith('.vue')) continue;
  if (/<script\b[^>]*\bsetup\b/.test(text)) record('script setup SFCs', file, 1);
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\r\n]/g, ' '));
  const styles = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/g)];
  for (const [metric, regex] of [['Vuetify tag occurrences', /<\/?v-[\w-]+\b/g], ['.sync template modifiers', /\.[s]ync(?=[\s="'])/g], ['.native template modifiers', /\.native(?=[.\s="'])/g], ['$listeners template references', /\$listeners\b/g], ['$scopedSlots references', /\$scopedSlots\b/g]]) {
    for (const match of withoutComments.matchAll(regex)) record(metric, file, lineAt(text, match.index));
  }
  for (const style of styles) {
    const css = style[1].replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\r\n]/g, ' '));
    const start = style.index + style[0].indexOf('>') + 1;
    for (const [metric, regex] of [['private Vuetify selector candidates', /\.v-[\w-]+/g], ['deep selector candidates', /::v-deep|:deep\(|>>>|\/deep\//g]]) for (const match of css.matchAll(regex)) record(metric, file, lineAt(text, start + match.index));
  }
}
const metrics = Object.entries(apiMatches).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([metric, matches]) => {
  const groups = new Map();
  for (const match of matches) { const lines = groups.get(match.file) ?? []; lines.push(match.line); groups.set(match.file, lines); }
  return { metric, occurrences: matches.length, files: groups.size,
    fileMatches: [...groups].map(([file, lines]) => ({ file, occurrences: lines.length, lines: [...new Set(lines)] })),
  };
});
const trackedPackages = ['vue', 'vuetify', 'vue-router', 'vue-i18n', 'vue-class-component', 'vue-property-decorator', 'vue-flag-icon', 'vuedraggable', '@voerro/vue-notifications', '@vueuse/core', '@vueuse/rxjs', '@vue/test-utils', '@vitejs/plugin-vue2', 'vue-template-compiler'];
const packageJson = JSON.parse(sources.get('package.json'));
const libraries = trackedPackages.map(name => {
  const consumers = [...imports].flatMap(([file, refs]) => refs.filter(ref => ref.specifier === name || ref.specifier.startsWith(`${name}/`)).map(ref => ({ file, line: ref.line, specifier: ref.specifier, scope: isTest(file) ? 'test-source' : file.startsWith('src/') ? 'production-source' : 'build-config' })));
  return { name, declaredVersion: packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name] ?? null, files: new Set(consumers.map(item => item.file)).size,
    byScope: Object.fromEntries(['production-source', 'test-source', 'build-config'].map(scope => [scope, new Set(consumers.filter(item => item.scope === scope).map(item => item.file)).size])), consumers };
});
const components = vueFiles.map(file => {
  const owner = ownership(file);
  const importedBy = reverseImports.get(file) ?? [];
  return { file, sha256: sha(sources.get(file)), ...owner,
    reachedFrom: Object.entries(reachability).filter(([, files]) => files.has(file)).map(([app]) => app),
    reachabilityNote: 'Static local imports only; absence is a retention/removal review item, not proof of dead code.',
    importedBy, consumerWorkPackages: [...new Set(importedBy.filter(item => item.file.endsWith('.vue')).map(item => ownership(item.file).primary))].sort(),
    routes: allRoutes.filter(route => route.component === file).map(route => ({ app: route.app, path: route.path, name: route.name, file: route.file, line: route.line })),
    migrationSignals: metrics.flatMap(metric => {
      const match = metric.fileMatches.find(match => match.file === file);
      return match ? [{ metric: metric.metric, occurrences: match.occurrences, lines: match.lines }] : [];
    }),
  };
});
const drift = git('diff', '--name-status', '--no-renames', auditRevision, sourceRevision).trim().split('\n').filter(Boolean).map(entry => {
  const [status, file] = entry.split('\t');
  const primary = file.endsWith('.vue') ? ownership(file).primary : file.startsWith('src/plugins/i18n/') ? 'V06' : file.startsWith('src/stores/') ? 'V05' : file.startsWith('.github/') ? 'V03' : 'V09';
  return { status, file, primary, coordination: isTest(file) ? ['V02', 'V13'] : file.startsWith('src/plugins/i18n/') ? ['V11'] : ['V02'],
    rationale: file.startsWith('src/plugins/i18n/') ? 'Explorer preferences add translation drift; include new messages in compiler/parity gates.' : file.startsWith('src/stores/') ? 'Explorer preference persistence is part of store synchronization and upgrade parity.' : file.startsWith('.github/') ? 'Reconcile the changed required-check suite before migration tooling changes.' : 'Explorer selection/link/logo behavior changed after the audit; preserve it in this source baseline and regression evidence.',
  };
});
const excluded = tracked.filter(file => file.endsWith('.vue') && !vueFiles.includes(file)).map(file => ({ file, reason: isTest(file) ? 'test/fixture; excluded from production component count' : isGenerated(file) ? 'generated/vendor boundary' : 'outside src production scope' }));
assert.equal(new Set(components.map(item => item.file)).size, vueFiles.length);
assert(components.every(item => /^V(07|08|09|10|11)$/.test(item.primary) && item.rationale));
assert.equal(components.length + excluded.length, tracked.filter(file => file.endsWith('.vue')).length);
assert(allRoutes.every(route => !route.component || components.some(item => item.file === route.component)));
assert.equal(new Set(allRoutes.map(route => `${route.app}:${route.path}`)).size, allRoutes.length, 'Duplicate route paths');

const result = {
  schemaVersion: 1, sourceRevision, auditRevision,
  reproduction: 'node spikes/vue3-migration/inventory.mjs --ref <sourceRevision>; node spikes/vue3-migration/inventory.mjs --check verifies the saved revision. No timestamps or local paths enter output.',
  staffing: 'Only the user and the assistant. V07–V11 are work-package ownership, not engineering lanes or additional people. User retains product/security/release decisions and review.',
  methodology: {
    source: 'Tracked files read from Git blobs at sourceRevision; dirty/untracked files and generated pilot output are intentionally excluded.',
    components: 'Every tracked production src .vue is listed exactly once, even if static entry traversal does not reach it. Per-file primary ownership resolves overlapping shared/security responsibilities.',
    routes: 'TypeScript AST reads both literal route tables, resolves imported/lazy components, and expands the literal help array map. Unsupported dynamic route syntax fails generation rather than being omitted.',
    imports: 'Literal import/export/require/dynamic-import references are AST scanned. Library consumers distinguish production source, test source and root build configuration; declaration files are excluded. Auto-imported composition helpers and configuration strings are not counted as import consumers.',
    metrics: 'Vue.* call metrics count exact AST receivers named Vue, excluding comments/strings. Other receiver names and aliased/global use may need manual review. Template/style metrics are textual migration candidates, not confirmed defects; comments are excluded, opening and closing Vuetify tags both count.',
    guards: 'Actual expressions and line anchors are retained. Feature flags/network support are runtime-dependent; this inventory does not assert live availability or change existing guard behavior.',
    generatedBoundary: 'src/vendor (including the Gero swap bundled runtime) and src/moonpay-js are excluded from migration API/import counts. Host GeroSwapEmbed.vue remains owned by V10.',
  },
  summary: { trackedVueFiles: components.length + excluded.length, productionVueFiles: components.length, excludedVueFiles: excluded.length,
    productionCodeFiles: productionCode.length, byPrimary: Object.fromEntries(['V07', 'V08', 'V09', 'V10', 'V11'].map(owner => [owner, components.filter(item => item.primary === owner).length])),
    routeCount: allRoutes.length, routesByApp: Object.fromEntries(routers.map(router => [router.app, router.routes.length])),
    publicMetaRoutes: allRoutes.filter(route => route.metaPublic).length, featureFlaggedRoutes: allRoutes.filter(route => route.featureFlags.length).length,
    currentPopupViewRoutes: allRoutes.filter(route => route.popupView).length, staticallyUnreachedVueFiles: components.filter(item => item.reachedFrom.length === 0).length,
    changedFilesSinceAudit: drift.length,
  },
  architecturalDecisions: [
    'Retain both active Vite web entries (options and sidepanel). Router/app-shell mechanics remain V04; SFC edits use the primary UI owner recorded here.',
    'src/popup/main.ts is not a Vite web entry. Its Popup.vue scaffold is a separate retention/removal decision in V12; active popup/modules approval views in options routes must survive.',
    'Keep shared controls with one V07 owner, shared authorization controls with V08, and feature dialogs with their feature owner plus V08 coordination for security-sensitive behavior.',
    'Retained statically unreached components require source/build/manual confirmation before removal; the inventory does not silently reduce parity scope.',
    'Flags, network support and existing Apex guards are preserved as observed; this work does not authorize new chain/feature rollout.',
  ],
  excluded, excludedGeneratedFiles: tracked.filter(isGenerated), dynamicImports, libraries, metrics, routers, components, drift,
};
const serialized = JSON.stringify(result, null, 2) + '\n';
if (check) assert.equal(readFileSync(output, 'utf8'), serialized, 'Inventory differs: regenerate for the intended revision and review the diff.');
else writeFileSync(output, serialized);
console.log(JSON.stringify({ mode: check ? 'verified' : 'generated', sourceRevision, ...result.summary }, null, 2));
