import { describe, expect, it } from 'vitest';
import { analyse, declarationOffset, fingerprint } from './bundle-tdz-analysis.mjs';

/**
 * These fixtures are trimmed transcriptions of the real background bundle, not
 * invented shapes: the `reader.readInt()` line below is verbatim from
 * node_modules/.cache/gero/background.pre-minify.js, where it sat ~242k lines
 * above the `@walletconnect/core` namespace and hid it from the guard.
 */
const read = name => `await __vitePreload(() => Promise.resolve().then(() => ${name}));`;

const namespace = (name, exports) =>
  `const ${name} = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({\n`
  + `        __proto__: null,\n`
  + exports.map(key => `        ${key}: x${key}`).join(',\n')
  + `\n    }, Symbol.toStringTag, { value: 'Module' }));`;

describe('declarationOffset', () => {
  it('skips a same-named local and finds the namespace declaration', () => {
    const source = [
      'function decode(reader) {',
      '            const index = reader.readInt();',
      '}',
      namespace('index', ['Core', 'Crypto']),
    ].join('\n');

    expect(declarationOffset(source, 'index')).toBe(source.indexOf('const index = /*#__PURE__*/'));
  });

  it('falls back to the loose form when the annotation is absent', () => {
    const source = 'const alias = someOtherNamespace;';

    expect(declarationOffset(source, 'alias')).toBe(0);
  });

  it('reports -1 when the name is never declared', () => {
    expect(declarationOffset('const other = 1;', 'missing')).toBe(-1);
  });
});

describe('analyse', () => {
  it('flags a namespace declared after its read even behind a same-named local', () => {
    const source = [
      'const index = reader.readInt();',
      read('index'),
      namespace('index', ['Core', 'Crypto']),
    ].join('\n');

    expect(analyse(source)).toEqual([
      expect.objectContaining({ name: 'index', key: 'index{Core,Crypto}' }),
    ]);
  });

  it('does not flag a namespace declared before its read', () => {
    const source = [
      namespace('index', ['Core', 'Crypto']),
      read('index'),
    ].join('\n');

    expect(analyse(source)).toEqual([]);
  });

  it('does not flag a non-namespace shape whose declaration precedes the read', () => {
    const source = [
      'const index$c = /*#__PURE__*/_mergeNamespaces({ a: 1 }, [b]);',
      read('index$c'),
    ].join('\n');

    expect(analyse(source)).toEqual([]);
  });

  it('keys an offender on its base name so Rollup\'s $N suffix is not churn', () => {
    const source = [
      read('index$1'),
      namespace('index$1', ['Core', 'Crypto']),
    ].join('\n');

    expect(analyse(source)[0].key).toBe('index{Core,Crypto}');
  });
});

describe('fingerprint', () => {
  it('sorts the export list so member order is not churn', () => {
    const source = namespace('ns', ['b', 'a']);

    expect(fingerprint(source, 'ns', 0)).toBe('ns{a,b}');
  });
});
