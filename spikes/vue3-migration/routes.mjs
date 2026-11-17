// Route tables and work-package ownership, shared by the V01 inventory
// (inventory.mjs) and the V02 route validation matrix (route-matrix.mjs).
// Reads TypeScript ASTs only; no application code runs.
import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';

export const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
export const walk = (node, visitor) => { visitor(node); ts.forEachChild(node, child => walk(child, visitor)); };
export const key = node => node?.text ?? node?.getText();
export const prop = (node, name) => node.properties.find(item => key(item.name) === name)?.initializer;
export const normalize = text => text.replace(/\s+/g, ' ').trim();

/** Resolves an `@/`, `~/` or relative import to a file in `fileSet`, or undefined. */
export function localResolver(fileSet) {
  return (from, specifier) => {
    const clean = specifier.split('?')[0];
    const base = clean.startsWith('@/') || clean.startsWith('~/') ? `src/${clean.slice(2)}` : clean.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), clean)) : null;
    return base && [base, ...['.ts', '.js', '.mjs', '.vue', '/index.ts', '/index.js'].map(extension => base + extension)].find(file => fileSet.has(file));
  };
}

// Work-package ownership is deliberately independent of staffing. Specific
// security/trading exceptions precede broad feature-folder rules.
const securityNames = /^(?:PassKey|Password|Security|TransactionAuth|TxApproval|HardwareSign|KeystoneSign|NumericOtp|Backup|Pattern|Lock|Unlock|RevealRecovery|ChangePassword|ChangeRecovery|PinSetup|TwoFactor|RemoteSigning|ShieldedProvingConsent|ConnectedDapps|DAppOverlay|PendingRequest|SupportAuth|NoWallet|WalletsListLogin)/i;
const tradingNames = /^(?:Perps|Perpetuals|Swap|Vault|BuyDialog|BuySell)/;
export function ownership(file) {
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

export function routeInventory(file, app, { parsed, sources, resolveLocal }) {
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
      // Apex Fusion support (and with it this allowlist) was removed in #1552;
      // the frozen V01 revision still has it.
      const apexAllowlist = conditions.find(condition => condition.expression.includes('APEX_ALLOWED_ROUTE_NAMES.has'));
      if (apexAllowlist && name && !['home', 'staking', 'activity'].includes(name)) guards.push({ kind: 'Apex route allowlist', ...apexAllowlist });
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
