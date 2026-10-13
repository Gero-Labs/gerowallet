#!/usr/bin/env node
// Reproduce the committed-source V01 inventory without executing application code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
const walk = (node, visitor) => { visitor(node); ts.forEachChild(node, child => walk(child, visitor)); };
const key = node => node?.text ?? node?.getText();
const prop = (node, name) => node.properties.find(item => key(item.name) === name)?.initializer;
const normalize = text => text.replace(/\s+/g, ' ').trim();

function scriptSource(file, text) {
  if (!file.endsWith('.vue')) return text;
  let script = text.replace(/[^\r\n]/g, ' ');
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)) {
    const start = match.index + match[0].indexOf('>') + 1;
    // Slice strings, not Unicode codepoints: TypeScript offsets are UTF-16.
    script = script.slice(0, start) + match[1] + script.slice(start + match[1].length);
  }
  return script;
}

const parsed = new Map(sourceFiles.filter(file => /\.(vue|[cm]?[jt]sx?)$/.test(file)).map(file => [file,
  ts.createSourceFile(file, scriptSource(file, sources.get(file)), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
]));
function resolveLocal(from, specifier) {
  const clean = specifier.split('?')[0];
  const base = clean.startsWith('@/') || clean.startsWith('~/') ? `src/${clean.slice(2)}` : clean.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), clean)) : null;
  return base && [base, ...['.ts', '.js', '.mjs', '.vue', '/index.ts', '/index.js'].map(extension => base + extension)].find(file => fileSet.has(file));
}

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

// Work-package ownership is deliberately independent of staffing. Specific
// security/trading exceptions precede broad feature-folder rules.
const securityNames = /^(?:PassKey|Password|Security|TransactionAuth|TxApproval|HardwareSign|KeystoneSign|NumericOtp|Backup|Pattern|Lock|Unlock|RevealRecovery|ChangePassword|ChangeRecovery|PinSetup|TwoFactor|RemoteSigning|ShieldedProvingConsent|ConnectedDapps|DAppOverlay|PendingRequest|SupportAuth|NoWallet|WalletsListLogin)/i;
const tradingNames = /^(?:Perps|Perpetuals|Swap|Vault|BuyDialog|BuySell)/;
function ownership(file) {
  const name = path.posix.basename(file, '.vue');
  let primary;
  let rationale;
  if (securityNames.test(name) || /^src\/modules\/(authentication|welcome|cip45|walletconnect)\//.test(file) || /^src\/popup\/modules\//.test(file)) {
    primary = 'V08'; rationale = 'Authentication, onboarding, backup, device pairing or approval boundary; preserve cancellation and authorization semantics.';
  } else if (tradingNames.test(name) || /^src\/modules\/(swap|thorchain|realfi)\//.test(file) || /\/(perps|flows\/SwapSheet)\//.test(file) || file.includes('/components/perps/')) {
    primary = 'V10'; rationale = 'Trading, perpetuals, vaults or earn integration; preserve host/widget contracts and financial flow parity.';
  } else if (/^src\/modules\/(assets|market|transactions|portfolio|mempool|ordinals|lightning)\//.test(file) || /^src\/sidepanel\/pages\/(Home|Market|Activity)Page.vue$/.test(file) || /^src\/sidepanel\/components\/(BalanceSection|TokenList|QuickActions|MiniDustGauge|flows\/(Send|Receive|MidnightSend|TxDetail)Sheet)\.vue$/.test(file) || /^src\/shared\/components\/(TransactionDetails|TransactionDetailsCard|MidnightSendTimeline|TokenSelector|SelectTokenDialog|TradingViewChart|VueHighcharts)\.vue$/.test(file)) {
    primary = 'V09'; rationale = 'Asset, balance, amount, send/receive, history or market surface; preserve financial display and transaction selection behavior.';
  } else if (/^src\/modules\/dashboard\//.test(file)) {
    if (/^(?:SettingsDialog|AdvancedSettingsTab|ProfileTab|ProfilePictureDialog|NotificationsTab|SubmitApi|ContactsTab|StakingCard|RewardsChart|CashbackCard)/.test(name)) {
      primary = 'V11'; rationale = 'Dashboard settings or remaining service/staking feature; retain its owning feature behavior.';
    } else if (/^(?:EditableTextField|EmptyStateHero|EmptyStateMini|FeatureCarousel)$/.test(name)) {
      primary = 'V07'; rationale = 'Reusable dashboard presentation/control primitive; establish the shared Vue3/Vuetify contract first.';
    } else {
      primary = 'V09'; rationale = 'Dashboard asset/balance/send/receive/transaction component; financial UI parity owns integration.';
    }
  } else if (/^src\/shared\//.test(file) || /^src\/modules\/navigation\//.test(file) || /^src\/options\//.test(file) || file === 'src/popup/Popup.vue' || file === 'src/sidepanel/App.vue' || /^src\/sidepanel\/(layouts|components\/(BottomNav|BottomSheet|MiniHeader|WalletSelector|FeaturedCarousel))/.test(file)) {
    primary = 'V07'; rationale = 'Shared app shell, layout, control or presentation component; one shared contract owner avoids parallel edits.';
  } else {
    primary = 'V11'; rationale = 'Governance, staking, card, help, copilot or remaining shipped/retained feature route; explicit residual parity ownership.';
  }
  const coordination = primary === 'V07' ? ['V04', 'V08', 'V09', 'V10', 'V11'] : ['V07'];
  if (/sign|auth|password|pin|seed|backup|stake|vote|delegate|send|withdraw|deposit|order|payment|topup|top-up|coldkey|vrf|kes|register|confirm|convert|security|approval/i.test(file) && primary !== 'V08') coordination.push('V08');
  if (/^(?:src\/options\/App.vue|src\/sidepanel\/App.vue|src\/modules\/navigation\/layouts\/)/.test(file) && !coordination.includes('V04')) coordination.push('V04');
  return { primary, rationale, coordination: [...new Set(coordination)].sort(), overlapResolution: 'The primary work package owns edits; coordination packages review the shared contract or security behavior. These are scope assignments, not additional people.' };
}

function routeInventory(file, app) {
  const ast = parsed.get(file);
  const text = sources.get(file);
  const variables = new Map();
  const componentSymbols = new Map();
  const located = node => ({ file, line: lineAt(text, node.getStart(ast)), expression: normalize(node.getText(ast)) });
  for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.importClause?.name && ts.isStringLiteral(node.moduleSpecifier)) componentSymbols.set(node.importClause.name.text, resolveLocal(file, node.moduleSpecifier.text));
  walk(ast, node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variables.set(node.name.text, node.initializer); });
  const component = node => {
    if (!node) return null;
    if (ts.isIdentifier(node)) {
      if (componentSymbols.has(node.text)) return componentSymbols.get(node.text);
      node = variables.get(node.text) ?? node;
    }
    let result = null;
    walk(node, child => {
      if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(child.arguments[0])) result = resolveLocal(file, child.arguments[0].text) ?? null;
    });
    return result;
  };
  const value = (node, bindings = {}) => {
    if (!node) return null;
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
    if (ts.isIdentifier(node) && Object.hasOwn(bindings, node.text)) return bindings[node.text];
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => `${value(span.expression, bindings)}${span.literal.text}`).join('');
    return { expression: normalize(node.getText(ast)) };
  };
  const network = variables.get('routeNetworkGuards');
  const maintenance = new Map();
  walk(ast, node => {
    if (!ts.isFunctionDeclaration(node) || node.name?.text !== 'isRouteUnderMaintenance') return;
    walk(node, child => {
      if (!ts.isCaseBlock(child)) return;
      let pending = [];
      for (const clause of child.clauses) {
        if (ts.isCaseClause(clause)) pending.push(value(clause.expression));
        const returned = clause.statements.find(statement => ts.isReturnStatement(statement));
        if (returned) { for (const name of pending) maintenance.set(name, located(returned)); pending = []; }
      }
    });
  });
  const conditions = [];
  walk(ast, node => { if (ts.isIfStatement(node)) conditions.push(located(node.expression)); });
  const routes = [];
  function add(node, bindings = {}, expansion = null) {
    assert(ts.isObjectLiteralExpression(node), `Unrecognized route object in ${file}`);
    const propertyValue = name => {
      const found = node.properties.find(item => key(item.name) === name);
      return found && ts.isShorthandPropertyAssignment(found) ? bindings[found.name.text] : value(found?.initializer, bindings);
    };
    const routePath = propertyValue('path');
    const name = propertyValue('name');
    assert.equal(typeof routePath, 'string', `Unresolved route path in ${file}`);
    assert(name === null || typeof name === 'string', `Unresolved route name ${routePath}`);
    const meta = prop(node, 'meta');
    const routeComponent = component(prop(node, 'component'));
    assert(!prop(node, 'component') || routeComponent, `Unresolved component ${routePath}`);
    const guards = [];
    if (network && ts.isObjectLiteralExpression(network)) {
      const networkGuard = network.properties.find(item => key(item.name) === name);
      if (networkGuard) guards.push({ kind: 'network-support (when logged in)', ...located(networkGuard) });
    }
    if (maintenance.has(name)) guards.push({ kind: 'maintenance (only when flags initialized)', ...maintenance.get(name) });
    if (prop(node, 'beforeEnter')) guards.push({ kind: 'beforeEnter', ...located(prop(node, 'beforeEnter')) });
    if (app === 'sidepanel') {
      guards.push(...conditions.filter(condition => name && condition.expression.includes(`to.name === '${name}'`)).map(condition => ({ kind: 'route guard', ...condition })));
      if (name && !['home', 'staking', 'activity'].includes(name)) guards.push({ kind: 'Apex route allowlist', ...conditions.find(condition => condition.expression.includes('APEX_ALLOWED_ROUTE_NAMES.has')) });
    }
    const flagNames = [...new Set(guards.flatMap(guard => [...guard.expression.matchAll(/featureFlagsStore\.(\w+)\(/g)].map(match => match[1])))].sort();
    routes.push({ app, ...located(node), path: routePath, name, component: routeComponent,
      primary: routeComponent ? ownership(routeComponent).primary : 'V04',
      layout: meta && ts.isObjectLiteralExpression(meta) ? component(prop(meta, 'layout')) : null,
      metaPublic: meta && ts.isObjectLiteralExpression(meta) ? value(prop(meta, 'public')) : null,
      metaRequiresAuth: meta && ts.isObjectLiteralExpression(meta) ? value(prop(meta, 'requiresAuth')) : null,
      redirect: propertyValue('redirect'), popupView: routeComponent?.startsWith('src/popup/modules/') ?? false,
      featureFlags: flagNames, guards, expansion,
      authPolicy: app === 'sidepanel' ? 'App.vue lock/wallet overlay; this router has no requiresAuth metadata.' : name === 'passkey-auth' ? 'Guard exception: may render before login and while locked; preserve walletId request binding.' : name === 'ledger-ble-sign' ? 'Guard exception: bypass syncing/locked redirects, but not missing logged-wallet guard.' : 'Use router.beforeEach requiresAuth, welcome redirect and synchronization/locking policies; metaPublic alone is not a new bypass.',
    });
  }
  const table = variables.get('routes');
  assert(table && ts.isArrayLiteralExpression(table), `Missing static route table: ${file}`);
  for (const element of table.elements) {
    if (ts.isObjectLiteralExpression(element)) { add(element); continue; }
    // The options help routes are a literal string-array .map. Expand only
    // this safe syntax; fail closed if a future router adds dynamic structure.
    assert(ts.isSpreadElement(element) && ts.isCallExpression(element.expression), `Unsupported route entry in ${file}`);
    const call = element.expression;
    assert(ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'map' && ts.isArrayLiteralExpression(call.expression.expression), `Unsupported route spread in ${file}`);
    const callback = call.arguments[0];
    assert(ts.isArrowFunction(callback), 'Route map must have an arrow callback');
    const body = ts.isParenthesizedExpression(callback.body) ? callback.body.expression : callback.body;
    call.expression.expression.elements.forEach((item, index) => add(body, {
      [callback.parameters[0].name.getText(ast)]: value(item), [callback.parameters[1].name.getText(ast)]: index,
    }, { kind: 'literal-array-map', source: located(element) }));
  }
  const policySources = [];
  walk(ast, node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'router.beforeEach') policySources.push(located(node));
  });
  return { app, file, routes, globalGuards: policySources };
}
const routers = [routeInventory('src/modules/navigation/router.ts', 'options'), routeInventory('src/sidepanel/router.ts', 'sidepanel')];
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
