import { describe, expect, it } from 'vitest';
import { displayLabel, readLabel, writeLabel } from './labels';

const ISOLATE = (s: string) => `\u2068${s}\u2069`;
const err = expect.objectContaining({ code: 'INVALID_LABEL' });

/** A code point this platform's Unicode tables see as unassigned: one a newer version may assign. */
const UNASSIGNED_HERE = [0x0378, 0x0379, 0x1fafa, 0x2fffd].map(c => String.fromCodePoint(c)).find(c => /\p{Cn}/u.test(c));

describe('labels: the read rule', () => {
  it('accepts any well-formed text of at most 64 bytes without control characters', () => {
    for (const ok of ['Alice', '', 'x'.repeat(64), '\u6c34', '\u{1F512} Vault', 'a|b', '  padded  ', 'Bo\u200Bb', 'Ame\u0301lie']) {
      expect(readLabel(ok)).toBe(ok);
    }
  });

  it('refuses control characters, more than 64 bytes and anything not well-formed', () => {
    for (const bad of ['a\u0000b', 'line\u000Abreak', 'del\u007F', 'c1\u0085', 'x'.repeat(65), '\u00E9'.repeat(33), '\uD800', '\uDC00x', 42, undefined, null]) {
      expect(readLabel(bad)).toBeUndefined();
    }
  });

  it('accepts a code point this platform sees as unassigned, which the display escapes', () => {
    expect(UNASSIGNED_HERE).toBeDefined();
    const label = `new${UNASSIGNED_HERE}`;
    expect(readLabel(label)).toBe(label);
    expect(() => writeLabel(label)).toThrow(err);
    const hex = (UNASSIGNED_HERE.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0');
    expect(displayLabel(label)).toBe(ISOLATE(`new[U+${hex}]`));
  });
});

describe('labels: the write rule', () => {
  it('writes the NFC form, trimmed', () => {
    expect(writeLabel('Ame\u0301lie')).toBe('Am\u00E9lie');
    expect(writeLabel('Treasurer')).toBe('Treasurer');
    expect(writeLabel('  Bob  ')).toBe('Bob');
    expect(writeLabel('\u3000\u00A0Bob\uFEFF\u000A')).toBe('Bob');
    expect(writeLabel('\u{1F512} Vault')).toBe('\u{1F512} Vault');
  });

  it.each([
    ['a zero-width space', 'Al\u200Bice'],
    ['a byte order mark inside', 'Ca\uFEFFrol'],
    ['a right-to-left override', 'evil\u202Egpj.exe'],
    ['a line separator', 'a\u2028b'],
    ['a paragraph separator', 'a\u2029b'],
    ['a soft hyphen', 'Da\u00ADvid'],
    ['tag characters', 'Eve\u{E0041}'],
    ['a private use character', 'x\uE000'],
    ['a newline', 'a\u000Ab'],
    ['a Hangul filler (U+115F)', 'x\u115F'],
    ['a Hangul filler (U+3164)', 'x\u3164'],
    ['a halfwidth Hangul filler', 'x\uFFA0'],
    ['a combining grapheme joiner', 'Bo\u034Fb'],
    ['a variation selector', 'Bob\uFE0F'],
    ['a Braille blank', '\u2800'],
    ['an ideographic space inside', 'Bo\u3000b'],
    ['a no-break space inside', 'Bo\u00A0b'],
    ['an empty label', ''],
    ['only spaces', '   '],
    ['only an ideographic space', '\u3000'],
    ['65 bytes', '\u00E9'.repeat(33)],
    ['a lone surrogate', 'x\uD800'],
    ['not a string', 42],
  ])('refuses %s', (_what, label) => {
    expect(() => writeLabel(label)).toThrow(err);
  });

  it('writes only what the read rule accepts', () => {
    for (const ok of ['Alice', 'Ame\u0301lie', '\u{1F512}', 'x'.repeat(64), ' Treasury 2027 ']) expect(readLabel(writeLabel(ok))).toBe(writeLabel(ok));
  });
});

describe('labels: display', () => {
  it('isolates every label for bidirectional text', () => {
    expect(displayLabel('Alice')).toBe(ISOLATE('Alice'));
    expect(displayLabel('\u05D0\u05D1')).toBe(ISOLATE('\u05D0\u05D1'));
  });

  it('shows format, unassigned, private-use, separator, filler and blank-looking code points as visible escapes', () => {
    expect(displayLabel('Alice\u202Eecila')).toBe(ISOLATE('Alice[U+202E]ecila'));
    expect(displayLabel('\u2067Bob\u2069')).toBe(ISOLATE('[U+2067]Bob[U+2069]'));
    expect(displayLabel('Ca\u200Brol')).toBe(ISOLATE('Ca[U+200B]rol'));
    expect(displayLabel('pua\u{F0000}')).toBe(ISOLATE('pua[U+F0000]'));
    expect(displayLabel('\u3164')).toBe(ISOLATE('[U+3164]'));
    expect(displayLabel('a\u2028b')).toBe(ISOLATE('a[U+2028]b'));
    expect(displayLabel('a\u000Ab')).toBe(ISOLATE('a[U+000A]b'));
    expect(displayLabel('Bo\u034Fb\uFE0F')).toBe(ISOLATE('Bo[U+034F]b[U+FE0F]'));
    expect(displayLabel('\u2800\u3000\u00A0')).toBe(ISOLATE('[U+2800][U+3000][U+00A0]'));
    expect(displayLabel(undefined)).toBe(ISOLATE(''));
  });

  it('escapes the spaces of other widths the writer keeps inside a label', () => {
    expect(writeLabel('Bob\u2003Alice')).toBe('Bob\u2003Alice');
    expect(displayLabel('Bob\u2003Alice')).toBe(ISOLATE('Bob[U+2003]Alice'));
    expect(displayLabel('a\u2000b\u200Ac\u202Fd\u205Fe f')).toBe(ISOLATE('a[U+2000]b[U+200A]c[U+202F]d[U+205F]e f'));
  });

  it('leaves no character that could break out of the isolation', () => {
    const shown = displayLabel('\u2069\u202E\u2066\u200F\u061C');
    expect(shown.slice(1, -1)).toBe('[U+2069][U+202E][U+2066][U+200F][U+061C]');
    expect(/[\u2066-\u2069\u202A-\u202E\u200E\u200F\u061C]/.test(shown.slice(1, -1))).toBe(false);
  });
});
