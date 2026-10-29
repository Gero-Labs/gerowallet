// Data parameters of a compiled Plutus program, in the flat encoding the ledger hashes.
//
// A port of Nexus's UplcDataParams (src/main/java/io/gerowallet/service/cip113/uplc), kept
// byte-compatible with it: the background uses it to prove that the transfer-logic script
// attached to a CIP-113 transfer is a reviewed template (src/utils/cip113TransferLogic.ts)
// with the expected parameters, before the wallet signs.
//
// An Aiken blueprint's `compiledCode` is one CBOR bytestring around a flat program: a
// three-part version, a term, and padding to the byte. Applying parameters p1..pn gives
// `version ‖ Apply(..Apply(term, p1).., pn) ‖ padding`, each pi a `data` constant.
//
// extractDataParams() is the inverse and deliberately strict: the template's version, then
// exactly n applications, then the template's term bit for bit, then n data constants, then
// nothing but padding. Callers still re-apply what was extracted and compare bytes and hash,
// so a parser mistake can only refuse a script, never accept a wrong one.
//
// Only the UPLC needed to step over a term is implemented: every term tag of Plutus 1.1.0 and
// the constant types integer, bytestring, string, unit, bool, list, pair and data. A template
// holding any other constant type is refused.

import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const TAG_BITS = 4;
const APPLY = 3;
const CONSTANT = 4;
const DATA_TYPE = 8;
const PLUTUS_V3_TAG = 0x03;

/** `compiledCode` with `dataParams` (each the CBOR of one PlutusData) applied in order. */
export function applyDataParams(compiledCode: Uint8Array, dataParams: readonly Uint8Array[]): Uint8Array {
  const program = parseProgram(unwrapByteString(compiledCode));
  if (dataParams.length === 0) return compiledCode;
  const w = new BitWriter();
  for (const v of program.version) w.natural(v);
  for (let i = 0; i < dataParams.length; i++) w.bits(APPLY, TAG_BITS);
  w.copy(program.flat, program.termStart, program.termEnd);
  for (const param of dataParams) w.dataConstant(param);
  w.filler();
  return wrapByteString(w.toBytes());
}

/**
 * The CBOR of the `count` data parameters applied to `template` to give `applied`.
 * Throws when `applied` is not exactly `template` with `count` data parameters applied.
 */
export function extractDataParams(applied: Uint8Array, template: Uint8Array, count: number): Uint8Array[] {
  const tpl = parseProgram(unwrapByteString(template));
  const r = new BitReader(unwrapByteString(applied));
  for (const v of tpl.version) {
    if (r.natural() !== v) throw new Error("program version differs from the template's");
  }
  for (let i = 0; i < count; i++) {
    if (r.bits(TAG_BITS) !== APPLY) throw new Error(`expected ${count} applications`);
  }
  for (let i = tpl.termStart; i < tpl.termEnd; i++) {
    if (r.bit() !== bitAt(tpl.flat, i)) throw new Error(`program body differs from the template at bit ${i}`);
  }
  const params: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    if (r.bits(TAG_BITS) !== CONSTANT) throw new Error(`parameter ${i} is not a constant`);
    if (r.bit() !== 1 || r.bits(TAG_BITS) !== DATA_TYPE || r.bit() !== 0) {
      throw new Error(`parameter ${i} is not a data constant`);
    }
    params.push(r.byteString());
  }
  r.filler();
  r.requireEnd();
  return params;
}

/** The PlutusV3 script hash of a single-bytestring `compiledCode`: blake2b-224(0x03 ‖ bytes). */
export function plutusV3Hash(compiledCode: Uint8Array): string {
  const tagged = new Uint8Array(compiledCode.length + 1);
  tagged[0] = PLUTUS_V3_TAG;
  tagged.set(compiledCode, 1);
  return bytesToHex(blake2b(tagged, { dkLen: 28 }));
}

/** The content of a definite-length CBOR bytestring that makes up all of `cbor`. */
export function unwrapByteString(cbor: Uint8Array): Uint8Array {
  if (!cbor || cbor.length === 0 || (cbor[0] & 0xe0) !== 0x40) throw new Error('not a CBOR bytestring');
  const info = cbor[0] & 0x1f;
  let length: number;
  let offset: number;
  if (info < 24) {
    length = info;
    offset = 1;
  } else if (info <= 27) {
    const width = 1 << (info - 24);
    if (cbor.length < 1 + width) throw new Error('truncated CBOR bytestring header');
    length = 0;
    for (let i = 0; i < width; i++) length = length * 256 + cbor[1 + i];
    offset = 1 + width;
  } else {
    throw new Error('indefinite or malformed CBOR bytestring');
  }
  if (offset + length !== cbor.length) throw new Error('CBOR bytestring length does not match its content');
  return cbor.slice(offset);
}

/** `content` as one definite-length CBOR bytestring. */
export function wrapByteString(content: Uint8Array): Uint8Array {
  const n = content.length;
  let header: number[];
  if (n < 24) header = [0x40 | n];
  else if (n < 0x100) header = [0x58, n];
  else if (n < 0x10000) header = [0x59, n >>> 8, n & 0xff];
  else header = [0x5a, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const out = new Uint8Array(header.length + n);
  out.set(header);
  out.set(content, header.length);
  return out;
}

/** A parsed flat program: its version and where its term starts and ends, in bits. */
interface Program {
  flat: Uint8Array;
  version: number[];
  termStart: number;
  termEnd: number;
}

function parseProgram(flat: Uint8Array): Program {
  const r = new BitReader(flat);
  const version = [r.natural(), r.natural(), r.natural()];
  const termStart = r.position();
  r.skipTerm();
  const termEnd = r.position();
  r.filler();
  r.requireEnd();
  return { flat, version, termStart, termEnd };
}

function bitAt(bytes: Uint8Array, index: number): number {
  return (bytes[index >>> 3] >>> (7 - (index & 7))) & 1;
}

/** A constant type: a base tag, or list (5) / pair (6) with its argument types. */
interface ConstantType {
  tag: number;
  args: ConstantType[];
}

function parseType(tags: number[], cursor: { i: number }): ConstantType {
  const next = () => {
    if (cursor.i >= tags.length) throw new Error('malformed constant type');
    return tags[cursor.i++];
  };
  const tag = next();
  if (tag !== 7) {
    if (tag === 5 || tag === 6 || tag > 8) throw new Error(`unsupported constant type ${tag}`);
    return { tag, args: [] };
  }
  const applied = next();
  if (applied === 5) return { tag: 5, args: [parseType(tags, cursor)] };
  if (applied === 7 && next() === 6) {
    const a = parseType(tags, cursor);
    const b = parseType(tags, cursor);
    return { tag: 6, args: [a, b] };
  }
  throw new Error('unsupported constant type application');
}

class BitReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  position(): number {
    return this.pos;
  }

  bit(): number {
    if (this.pos >= this.bytes.length * 8) throw new Error('program ends early');
    return bitAt(this.bytes, this.pos++);
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }

  /** A flat natural. Nine 7-bit groups at most, as Nexus reads them. */
  natural(): number {
    let v = 0n;
    let shift = 0n;
    for (;;) {
      const more = this.bit();
      const word = BigInt(this.bits(7));
      if (shift > 56n) throw new Error('natural too large');
      v |= word << shift;
      shift += 7n;
      if (more === 0) return Number(v);
    }
  }

  /** Flat filler: up to seven zeros and a one, ending exactly on the next byte boundary. */
  filler(): void {
    let zeros = 0;
    while (this.bit() === 0) {
      if (++zeros > 7) throw new Error('filler longer than a byte');
    }
    if ((this.pos & 7) !== 0) throw new Error('filler does not end on a byte boundary');
  }

  requireEnd(): void {
    if (this.pos !== this.bytes.length * 8) throw new Error('unexpected bytes after the program');
  }

  byteString(): Uint8Array {
    this.filler();
    const out: number[] = [];
    for (;;) {
      const n = this.bits(8);
      if (n === 0) return Uint8Array.from(out);
      for (let i = 0; i < n; i++) out.push(this.bits(8));
    }
  }

  skipTerm(): void {
    const tag = this.bits(TAG_BITS);
    switch (tag) {
      case 0: // variable (de Bruijn index)
        this.natural();
        break;
      case 1: // delay
      case 2: // lambda
      case 5: // force
        this.skipTerm();
        break;
      case 3: // application
        this.skipTerm();
        this.skipTerm();
        break;
      case 4: // constant
        this.skipValue(this.readType());
        break;
      case 6: // error
        break;
      case 7: // builtin
        this.bits(7);
        break;
      case 8: // constr
        this.natural();
        while (this.bit() === 1) this.skipTerm();
        break;
      case 9: // case
        this.skipTerm();
        while (this.bit() === 1) this.skipTerm();
        break;
      default:
        throw new Error(`unknown term tag ${tag} at bit ${this.pos - 4}`);
    }
  }

  private readType(): ConstantType {
    const tags: number[] = [];
    while (this.bit() === 1) tags.push(this.bits(TAG_BITS));
    const cursor = { i: 0 };
    const type = parseType(tags, cursor);
    if (cursor.i !== tags.length) throw new Error('malformed constant type');
    return type;
  }

  private skipValue(type: ConstantType): void {
    switch (type.tag) {
      case 0: // integer (zigzag)
        this.natural();
        break;
      case 1: // bytestring
      case 2: // string
      case 8: // data
        this.byteString();
        break;
      case 3: // unit
        break;
      case 4: // bool
        this.bit();
        break;
      case 5: // list
        while (this.bit() === 1) this.skipValue(type.args[0]);
        break;
      case 6: // pair
        this.skipValue(type.args[0]);
        this.skipValue(type.args[1]);
        break;
      default:
        throw new Error(`unsupported constant type ${type.tag}`);
    }
  }
}

class BitWriter {
  private readonly out: number[] = [];
  private current = 0;
  private count = 0;

  bit(b: number): void {
    this.current = (this.current << 1) | (b & 1);
    if (++this.count === 8) {
      this.out.push(this.current);
      this.current = 0;
      this.count = 0;
    }
  }

  bits(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bit(value >>> i);
  }

  natural(value: number): void {
    let v = value;
    do {
      const word = v % 128;
      v = Math.floor(v / 128);
      this.bit(v !== 0 ? 1 : 0);
      this.bits(word, 7);
    } while (v !== 0);
  }

  copy(source: Uint8Array, fromBit: number, toBit: number): void {
    for (let i = fromBit; i < toBit; i++) this.bit(bitAt(source, i));
  }

  filler(): void {
    while (this.count !== 7) this.bit(0);
    this.bit(1);
  }

  dataConstant(cbor: Uint8Array): void {
    this.bits(CONSTANT, TAG_BITS);
    this.bit(1);
    this.bits(DATA_TYPE, TAG_BITS);
    this.bit(0);
    this.filler();
    for (let i = 0; i < cbor.length; i += 255) {
      const n = Math.min(255, cbor.length - i);
      this.bits(n, 8);
      for (let j = 0; j < n; j++) this.bits(cbor[i + j], 8);
    }
    this.bits(0, 8);
  }

  toBytes(): Uint8Array {
    if (this.count !== 0) throw new Error('program does not end on a byte boundary');
    return Uint8Array.from(this.out);
  }
}
