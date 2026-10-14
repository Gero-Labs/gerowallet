// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { scriptSource } from './script-source.mjs';

function importsFrom(source) {
  const script = scriptSource('InventoryFixture.vue', source);
  const ast = ts.createSourceFile('InventoryFixture.vue', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  expect(ast.parseDiagnostics).toEqual([]);
  return {
    script,
    imports: ast.statements.filter(ts.isImportDeclaration).map(node => ({
      name: node.moduleSpecifier.text,
      offset: node.getStart(ast),
      ...ast.getLineAndCharacterOfPosition(node.getStart(ast)),
    })),
  };
}

describe('inventory SFC script extraction', () => {
  it('passes non-SFC source through unchanged', () => {
    const source = 'export const example = "<script>not an SFC</script>";\r\n';
    expect(scriptSource('example.ts', source)).toBe(source);
  });

  it('handles quoted tag delimiters and mixed-case closing tags', () => {
    const source = '<script lang="ts" data-example="a > b">import item from "./actual";</SCRIPT >';
    expect(importsFrom(source).imports).toEqual([
      { name: './actual', offset: source.indexOf('import item'), line: 0, character: source.indexOf('import item') },
    ]);
  });

  it.each([false, true])('retains both script blocks and exact UTF-16/CRLF locations (setup first: %s)', setupFirst => {
    const regular = '<script lang="ts">\r\n// 🚀\r\nimport regular from "./regular";\r\n</script>';
    const setup = '<script setup lang="ts">\r\nimport setup from "./setup";\r\n</script>';
    const source = ['<template><div>🚀</div></template>', ...(setupFirst ? [setup, regular] : [regular, setup]), '<style>.example { color: red; }</style>'].join('\r\n');
    const { script, imports } = importsFrom(source);
    expect(script.length).toBe(source.length);
    expect([...script.matchAll(/\r\n/g)].map(match => match.index)).toEqual([...source.matchAll(/\r\n/g)].map(match => match.index));
    expect(imports.map(item => item.name)).toEqual(setupFirst ? ['./setup', './regular'] : ['./regular', './setup']);
    for (const item of imports) {
      const offset = source.indexOf(`import ${item.name.slice(2)}`);
      const prefix = source.slice(0, offset);
      expect(item.offset).toBe(offset);
      expect(item.line).toBe(prefix.split('\n').length - 1);
      expect(item.character).toBe(offset - prefix.lastIndexOf('\n') - 1);
    }
  });

  it('ignores commented, nested template, and custom-block script lookalikes', () => {
    const source = [
      '<!-- <script>import comment from "./comment";</script> -->',
      '<template><div><script>import nested from "./nested";</script></div></template>',
      '<script-example>import custom from "./custom";</script-example>',
      '<script>import actual from "./actual";</script>',
    ].join('\n');
    expect(importsFrom(source).imports.map(item => item.name)).toEqual(['./actual']);
  });

  it('does not invent script content for template-only components', () => {
    const { script, imports } = importsFrom('<template>\n  <div>hello</div>\n</template>');
    expect(script.trim()).toBe('');
    expect(imports).toEqual([]);
  });

  it('fails with the file name on malformed SFCs instead of silently missing inventory entries', () => {
    expect(() => scriptSource('Broken.vue', '<script>import missing from "./missing";')).toThrow(/Cannot inventory Broken.vue:.*missing end tag/i);
  });
});
