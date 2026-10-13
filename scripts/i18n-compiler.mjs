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

export async function compileCatalogs(root = repository) {
  const directory = resolve(root, 'src/plugins/i18n');
  const pushPath = resolve(directory, 'push.ts');
  const push = readLiteralModule(await readFile(pushPath, 'utf8'), pushPath, 'pushStrings');
  const compiled = {};
  for (const locale of locales) {
    const path = resolve(directory, `${locale}.ts`);
    const messages = readLiteralModule(await readFile(path, 'utf8'), path);
    compiled[locale] = { ...compileMessages({ ...messages, ...push[locale] }, locale), paths: [path, pushPath] };
  }
  return compiled;
}

/** UI, service-worker and tests share these modules. Raw catalog imports stay strings. */
export function localeMessagesPlugin() {
  return {
    name: 'gero-precompiled-locale-messages', enforce: 'pre',
    resolveId(id) { if (id.startsWith(prefix)) return `\0${id}`; },
    async buildStart() { await compileCatalogs(); },
    async load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      const locale = id.slice(prefix.length + 1);
      if (!locales.includes(locale)) throw new Error(`Unsupported shipped locale: ${locale}`);
      const compiled = (await compileCatalogs())[locale];
      for (const path of compiled.paths) this.addWatchFile(path);
      return { code: compiled.code, map: null };
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const compiled = await compileCatalogs();
  console.log(JSON.stringify({ compiler: '11.4.14', locales: Object.fromEntries(Object.entries(compiled).map(([locale, result]) => [locale, result.count])) }, null, 2));
}
