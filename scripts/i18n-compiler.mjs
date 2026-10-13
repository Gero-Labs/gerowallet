import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { baseCompile } from '@intlify/message-compiler';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const locales = ['us', 'de', 'es'];
const prefix = 'virtual:gero-locales/';

/** Read data-only TS catalogs without evaluating arbitrary module code. */
export function readLiteralModule(source, filename, exported = 'default') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function literal(node) {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      const result = {};
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) throw new Error(`${filename}: catalog must contain literal properties only`);
        result[property.name.text] = literal(property.initializer);
      }
      return result;
    }
    throw new Error(`${filename}: unsupported catalog expression ${ts.SyntaxKind[node.kind]}`);
  }
  for (const statement of file.statements) {
    if (exported === 'default' && ts.isExportAssignment(statement)) return literal(statement.expression);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exported && declaration.initializer) return literal(declaration.initializer);
    }
  }
  throw new Error(`${filename}: missing ${exported} catalog export`);
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
  return {
    paths: [...Object.values(paths), pushPath],
    localePaths(locale) { return [paths[locale], pushPath]; },
    compile(locale) {
      if (!compiled.has(locale)) {
        // Cache the promises before awaiting: parallel virtual-module loads
        // share both the push catalog read and each locale's compilation.
        push ??= readFile(pushPath, 'utf8').then(source => readLiteralModule(source, pushPath, 'pushStrings'));
        compiled.set(locale, (async () => {
          const [source, pushMessages] = await Promise.all([readFile(paths[locale], 'utf8'), push]);
          const messages = readLiteralModule(source, paths[locale]);
          return { ...compileMessages({ ...messages, ...pushMessages[locale] }, locale), paths: [paths[locale], pushPath] };
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
  return {
    name: 'gero-precompiled-locale-messages', enforce: 'pre',
    resolveId(id) { if (id.startsWith(prefix)) return `\0${id}`; },
    async buildStart() {
      compiler = catalogCompiler(root);
      // Watch every shipped catalog even if it is not imported (or fails to
      // compile), so correcting it can recover a failed watch build.
      for (const path of compiler.paths) this.addWatchFile(path);
      await Promise.all(locales.map(locale => compiler.compile(locale)));
    },
    watchChange(file) {
      if (watchedPaths.has(resolve(file))) compiler = catalogCompiler(root);
    },
    async load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      const locale = id.slice(prefix.length + 1);
      if (!locales.includes(locale)) throw new Error(`Unsupported shipped locale: ${locale}`);
      for (const path of compiler.localePaths(locale)) this.addWatchFile(path);
      const compiled = await compiler.compile(locale);
      return { code: compiled.code, map: null };
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const compiled = await compileCatalogs();
  console.log(JSON.stringify({ compiler: '11.4.14', locales: Object.fromEntries(Object.entries(compiled).map(([locale, result]) => [locale, result.count])) }, null, 2));
}
