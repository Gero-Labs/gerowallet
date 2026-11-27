import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { baseCompile } from '@intlify/message-compiler';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const locales = ['us', 'de', 'es'];
const prefix = 'virtual:gero-locales/';

/**
 * Read data-only TS catalogs without evaluating arbitrary module code. A catalog may spread other
 * catalogs into its top-level object (`import part from './dir/part.us'` and `...part`): `parts`
 * maps each such import's name to the messages read from it (`readCatalog` fills it). A key may not
 * come both from a part and from the catalog or another part.
 */
export function readLiteralModule(source, filename, exported = 'default', parts = new Map()) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function literal(node, top = false) {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      const result = {};
      const fromParts = new Set();
      for (const property of node.properties) {
        if (top && ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) && parts.has(property.expression.text)) {
          for (const [key, value] of Object.entries(parts.get(property.expression.text))) {
            if (Object.hasOwn(result, key)) throw new Error(`${filename}: ${key} is defined twice`);
            result[key] = value;
            fromParts.add(key);
          }
          continue;
        }
        if (!ts.isPropertyAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) throw new Error(`${filename}: catalog must contain literal properties only`);
        if (fromParts.has(property.name.text)) throw new Error(`${filename}: ${property.name.text} is defined twice`);
        result[property.name.text] = literal(property.initializer);
      }
      return result;
    }
    throw new Error(`${filename}: unsupported catalog expression ${ts.SyntaxKind[node.kind]}`);
  }
  for (const statement of file.statements) {
    if (exported === 'default' && ts.isExportAssignment(statement)) return literal(statement.expression, true);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exported && declaration.initializer) return literal(declaration.initializer, true);
    }
  }
  throw new Error(`${filename}: missing ${exported} catalog export`);
}

/**
 * The catalogs `filename` spreads, by import name: default imports of a relative path inside
 * `directory`. Any other import is refused, so a catalog stays data.
 */
function catalogImports(source, filename, directory) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = new Map();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
    if (!clause?.name || clause.namedBindings || clause.isTypeOnly || !specifier.startsWith('./')) {
      throw new Error(`${filename}: a catalog imports only other catalogs, as a default import of a relative path`);
    }
    const target = resolve(dirname(filename), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`);
    if (!target.startsWith(directory + sep)) throw new Error(`${filename}: ${specifier} is outside ${directory}`);
    imports.set(clause.name.text, target);
  }
  return imports;
}

export function compileMessages(messages, locale) {
  const errors = [];
  let count = 0;
  const fields = Object.entries(messages).map(([key, value]) => {
    if (typeof value !== 'string') throw new Error(`${locale}:${key}: expected a message string`);
    count += 1;
    const result = baseCompile(value, { mode: 'arrow', onError(error) { errors.push(`${locale}:${key}: ${error.message}`); } });
    return `${JSON.stringify(key)}:${result.code}`;
  });
  if (errors.length) throw new Error(`Locale message compilation failed:\n${errors.join('\n')}`);
  return { code: `export default {${fields.join(',')}};`, count };
}

function catalogCompiler(root) {
  const directory = resolve(root, 'src/plugins/i18n');
  const pushPath = resolve(directory, 'push.ts');
  const paths = Object.fromEntries(locales.map(locale => [locale, resolve(directory, `${locale}.ts`)]));
  let push;
  const compiled = new Map();
  // Catalogs read only because a locale spreads them, so the plugin can watch them too.
  const parts = new Set();
  async function readCatalog(path, chain = []) {
    if (chain.includes(path)) throw new Error(`${path}: a catalog spreads itself`);
    const source = await readFile(path, 'utf8');
    const read = new Map();
    const files = [path];
    for (const [name, target] of catalogImports(source, path, directory)) {
      parts.add(target);
      const part = await readCatalog(target, [...chain, path]);
      read.set(name, part.messages);
      files.push(...part.paths);
    }
    return { messages: readLiteralModule(source, path, 'default', read), paths: files };
  }
  return {
    paths: [...Object.values(paths), pushPath],
    parts,
    localePaths(locale) { return [paths[locale], pushPath]; },
    compile(locale) {
      if (!compiled.has(locale)) {
        // Cache the promises before awaiting: parallel virtual-module loads
        // share both the push catalog read and each locale's compilation.
        push ??= readFile(pushPath, 'utf8').then(source => readLiteralModule(source, pushPath, 'pushStrings'));
        compiled.set(locale, (async () => {
          const [catalog, pushMessages] = await Promise.all([readCatalog(paths[locale]), push]);
          return { ...compileMessages({ ...catalog.messages, ...pushMessages[locale] }, locale), paths: [...catalog.paths, pushPath] };
        })());
      }
      return compiled.get(locale);
    },
  };
}

export async function compileCatalogs(root = repository) {
  const compiler = catalogCompiler(root);
  return Object.fromEntries(await Promise.all(locales.map(async locale => [locale, await compiler.compile(locale)])));
}

/** UI, service-worker and tests share these modules. Raw catalog imports stay strings. */
export function localeMessagesPlugin(root = repository) {
  let compiler = catalogCompiler(root);
  const watchedPaths = new Set(compiler.paths);
  // Watch the catalogs a locale spreads as well, once a compile has found them.
  const watchParts = context => {
    for (const path of compiler.parts) {
      if (compiler.paths.includes(path)) continue;
      watchedPaths.add(path);
      context.addWatchFile(path);
    }
  };
  return {
    name: 'gero-precompiled-locale-messages', enforce: 'pre',
    resolveId(id) { if (id.startsWith(prefix)) return `\0${id}`; },
    async buildStart() {
      compiler = catalogCompiler(root);
      // Watch every shipped catalog even if it is not imported (or fails to
      // compile), so correcting it can recover a failed watch build.
      for (const path of compiler.paths) this.addWatchFile(path);
      try {
        await Promise.all(locales.map(locale => compiler.compile(locale)));
      } finally {
        watchParts(this);
      }
    },
    watchChange(file) {
      if (watchedPaths.has(resolve(file))) compiler = catalogCompiler(root);
    },
    async load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      const locale = id.slice(prefix.length + 1);
      if (!locales.includes(locale)) throw new Error(`Unsupported shipped locale: ${locale}`);
      for (const path of compiler.localePaths(locale)) this.addWatchFile(path);
      try {
        const compiled = await compiler.compile(locale);
        return { code: compiled.code, map: null };
      } finally {
        watchParts(this);
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const compiled = await compileCatalogs();
  console.log(JSON.stringify({ compiler: '11.4.14', locales: Object.fromEntries(Object.entries(compiled).map(([locale, result]) => [locale, result.count])) }, null, 2));
}
