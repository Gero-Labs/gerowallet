// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compileCatalogs, compileMessages, readLiteralModule } from './i18n-compiler.mjs';

describe('production message compiler', () => {
  it('compiles every shipped catalog and push message using production options', async () => {
    const catalogs = await compileCatalogs();
    expect(Object.keys(catalogs).sort()).toEqual(['de', 'es', 'us']);
    const counts = Object.values(catalogs).map(catalog => catalog.count);
    expect(counts.every(count => count > 5500 && count === counts[0])).toBe(true);
    for (const catalog of Object.values(catalogs)) {
      expect(catalog.code).not.toContain('new Function');
      expect(catalog.code).not.toContain('eval(');
    }
  });
  it('fails with the exact locale/key when syntax cannot be compiled', () => {
    expect(() => compileMessages({ address: 'user@domain.com' }, 'es')).toThrow('es:address');
    expect(() => compileMessages({ broken: 'Hello {name' }, 'de')).toThrow('de:broken');
    expect(() => compileMessages({ address: "user{'@'}domain.com" }, 'es')).not.toThrow();
  });
  it('reads literal data but never evaluates executable catalog expressions', () => {
    expect(readLiteralModule("export default { title: 'A', count: '{count}' }", 'fixture.ts')).toEqual({ title: 'A', count: '{count}' });
    expect(() => readLiteralModule("export default { title: process.exit() }", 'fixture.ts')).toThrow('unsupported catalog expression');
  });
});
