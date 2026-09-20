/**
 * Finding inlined dynamic-import namespaces that are read before they exist.
 *
 * Split out of check-bundle-tdz.mjs so the analysis can be unit-tested: that
 * file is a CLI with a shebang and top-level side effects, and importing it
 * from a spec neither parses (vitest's node-polyfill shim prepends an import
 * above the shebang) nor would be safe if it did.
 *
 * ## How an offender is identified
 *
 * Not by its emitted variable name. Rollup deduplicates colliding module names
 * with a `$N` suffix that is assigned in emission order, so `config$1` becomes
 * `config` and `de$4` becomes `de$6` the moment any module moves — and a
 * name-keyed baseline then reports the same two i18n loaders as both "fixed"
 * and "new". An offender is keyed instead by its base name plus the export
 * list of its namespace object (`Object.freeze({ __proto__: null, a, b })`):
 * stable across reorders, and still distinct for the eight unrelated packages
 * that all bundle as `index$N`.
 *
 * The export list is only there to tell same-named modules apart. When a base
 * name occurs exactly once in the baseline and exactly once in the build, it is
 * the same module whatever its exports now are — a pinned module that gained a
 * function must not read as a new hazard. That case is reported as a key that
 * needs re-pinning, not as a failure.
 */

/** `Promise.resolve().then(() => someNamespace)` — Rollup's inlined-import shape. */
const REFERENCE = /Promise\.resolve\(\)\.then\(\(\)\s*=>\s*([A-Za-z0-9_$]+)\)/g;

/** How far past a declaration to look for its export list. */
const NAMESPACE_WINDOW = 20_000;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Offset of the namespace declaration for `name`, or -1.
 *
 * Anchored on Rollup's `/*#__PURE__*\/` annotation rather than on a bare
 * `const <name> =`. Namespace consts routinely get an undecorated base name —
 * `index`, `config`, `security` — and a 13 MB bundle is full of ordinary locals
 * spelled the same way. `const index = reader.readInt();` sits ~242k lines
 * above the `@walletconnect/core` namespace, and matching it first reported
 * that namespace as declared early and safe: a silent pass on a module read
 * 24k lines before it exists. `const config = this.config;` hid the i18n
 * language-list loader the same way.
 *
 * Every inlined namespace Rollup emits carries the annotation, carries it
 * exactly once, and carries it whatever shape follows (`Object.freeze`,
 * `_mergeNamespaces`, `getAugmentedNamespace`) — verified against all 64
 * inlined namespaces in the background bundle — so the anchor is both precise
 * and complete. The loose form remains as a fallback for output that drops the
 * annotation: less precise, but never worse than reading no declaration at all.
 */
export function declarationOffset(source, name) {
  const annotated = new RegExp(
    `\\bconst\\s+${escapeRegExp(name)}\\s*=\\s*/\\*#__PURE__\\*/`,
  ).exec(source);
  if (annotated) return annotated.index;
  const loose = new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=`).exec(source);
  return loose ? loose.index : -1;
}

/**
 * The stable identity of a namespace: `base{export,export,…}`.
 *
 * Reads the `{ __proto__: null, … }` literal Rollup emits for an ES namespace
 * and keeps only its keys — the values are local bindings and get mangled or
 * re-suffixed. A namespace built any other way (a CJS interop wrapper) has no
 * such literal and falls back to the base name alone.
 */
export function fingerprint(source, name, declaredAt) {
  const base = name.replace(/\$\d+$/, '');
  const window = source.slice(declaredAt, declaredAt + NAMESPACE_WINDOW);
  const open = window.indexOf('{');
  const literalStart = window.indexOf('__proto__');
  // The export literal is the first `{` and must be the `__proto__` one; a
  // different shape after `=` means this is not an ES namespace object.
  if (open === -1 || literalStart === -1 || literalStart - open > 20) return base;
  const close = window.indexOf('}', literalStart);
  if (close === -1) return base;
  const keys = window
    .slice(literalStart, close)
    .split(',')
    .map(entry => entry.trim().split(/\s*:/)[0].trim())
    .filter(key => key && key !== '__proto__')
    .sort();
  return `${base}{${keys.join(',')}}`;
}

/** Offsets are compared, not line numbers: cheaper and immune to reformatting. */
export function analyse(source) {
  const firstReadAt = new Map();
  for (const match of source.matchAll(REFERENCE)) {
    const name = match[1];
    if (!firstReadAt.has(name)) firstReadAt.set(name, match.index);
  }

  const violations = [];
  for (const [name, readAt] of firstReadAt) {
    const declaredAt = declarationOffset(source, name);
    // No declaration found at all means the name is not an inlined namespace
    // (an alias, or already a real import) — nothing to order.
    if (declaredAt === -1) continue;
    if (declaredAt > readAt) {
      violations.push({ name, key: fingerprint(source, name, declaredAt), declaredAt });
    }
  }
  return violations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}
