import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// A `.geroButton` gets its text colour from baseline.css: `--g-on-grad` when
// enabled, `--g-text-3` when disabled. An inline `color: … !important` beats
// both, so a disabled button kept a dark or on-gradient label on the raised
// fill (as low as 1:1). No call site may set one.
const src = join(__dirname, '../..');

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : vueFiles(path);
    return name.endsWith('.vue') ? [path] : [];
  });
}

describe('.geroButton call sites', () => {
  it('set no inline text colour', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(src)) {
      const text = readFileSync(file, 'utf8');
      for (const tag of text.match(/<v-btn\b[^>]*>/g) ?? []) {
        if (!/\bclass="[^"]*\bgeroButton\b/.test(tag)) continue;
        const style = tag.match(/\sstyle="([^"]*)"/)?.[1] ?? '';
        if (/(^|;)\s*color\s*:/.test(style)) offenders.push(`${relative(src, file)}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
