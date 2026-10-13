import { parse } from '@vue/compiler-sfc';

// Keep original UTF-16 offsets and line endings for TypeScript source locations.
// This extracts SFC script blocks for analysis; it is not an HTML sanitizer.
export function scriptSource(file, text) {
  if (!file.endsWith('.vue')) return text;
  const { descriptor, errors } = parse(text, { filename: file, sourceMap: false });
  if (errors.length) {
    throw new Error(`Cannot inventory ${file}: ${errors.map(error => typeof error === 'string' ? error : error.message).join('; ')}`);
  }
  let script = text.replace(/[^\r\n]/g, ' ');
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    const { start, end } = block.loc;
    script = script.slice(0, start.offset) + text.slice(start.offset, end.offset) + script.slice(end.offset);
  }
  return script;
}
