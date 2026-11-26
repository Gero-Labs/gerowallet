/**
 * Display labels (participant and address book names, spec 5.3 and 6.8): three rules, so that
 * clients on different Unicode versions never disagree about what a stored label is.
 *
 * - Read (`readLabel`): well-formed text (valid UTF-8 once encoded), at most 64 bytes of UTF-8, no
 *   C0 or C1 control character (U+0000 to U+001F, U+007F to U+009F), nothing more. It needs no
 *   Unicode tables, so a label written with a code point assigned after this client's Unicode
 *   version is still read.
 * - Write (`writeLabel`): NFC, then refuse any control (Cc), format (Cf), line or paragraph
 *   separator (Zl, Zp), private-use (Co), unassigned (Cn) or surrogate code point, and the Hangul
 *   fillers U+115F, U+1160, U+3164 and U+FFA0, which render as nothing. The categories are this
 *   platform's; another client's tables may differ, which is harmless because readers check none of
 *   them. The result is never empty and passes the read rule.
 * - Display (`displayLabel`): never trusted as text. The label is isolated for bidirectional text
 *   (U+2068 FIRST STRONG ISOLATE before, U+2069 POP DIRECTIONAL ISOLATE after), and every format,
 *   unassigned, private-use, separator, control or surrogate code point and Hangul filler is shown
 *   as a visible escape `[U+XXXX]`, so a right-to-left override or an invisible character cannot
 *   change what the rest of the screen says.
 */
import { GeroVaultError } from './errors';

const MAX_BYTES = 64;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const REFUSED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}\u115F\u1160\u3164\uFFA0]/u;
const ESCAPED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}\u115F\u1160\u3164\uFFA0]/gu;
const ISOLATE_START = '\u2068';
const ISOLATE_END = '\u2069';

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** The label as stored, when it passes the read rule; `undefined` otherwise. Never throws. */
export function readLabel(value: unknown): string | undefined {
  if (typeof value !== 'string' || LONE_SURROGATE.test(value) || CONTROL.test(value) || utf8Length(value) > MAX_BYTES) return undefined;
  return value;
}

/**
 * The label to store: its NFC form, when that passes the write rule. Throws
 * `GeroVaultError('INVALID_LABEL')` naming the rule it breaks.
 */
export function writeLabel(value: unknown): string {
  if (typeof value !== 'string' || LONE_SURROGATE.test(value)) throw new GeroVaultError('INVALID_LABEL', 'A label is well-formed text');
  const nfc = value.normalize('NFC');
  if (nfc.length === 0) throw new GeroVaultError('INVALID_LABEL', 'A label is not empty');
  if (REFUSED.test(nfc)) throw new GeroVaultError('INVALID_LABEL', 'A label has no control, format, separator, private-use, unassigned or filler character');
  if (utf8Length(nfc) > MAX_BYTES) throw new GeroVaultError('INVALID_LABEL', `A label is at most ${MAX_BYTES} bytes of UTF-8`);
  return nfc;
}

/** The label as a screen shows it: isolated, with every invisible or unassigned code point escaped. */
export function displayLabel(label: unknown): string {
  const text = typeof label === 'string' ? label : '';
  const escaped = text.replace(ESCAPED, c => `[U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}]`);
  return `${ISOLATE_START}${escaped}${ISOLATE_END}`;
}
