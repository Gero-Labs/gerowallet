// Use cborg which is more browser-friendly than cbor
import { decode, encode } from 'cborg';

// Create cbor-compatible interface using cborg
const decodeAllSync = (buffer) => {
  try {
    // cborg.decode is synchronous and works in browsers
    const decoded = decode(buffer);
    // cbor.decodeAllSync returns an array, so wrap single result
    return [decoded];
  } catch (e) {
    console.error('CBOR decode error:', e);
    return null;
  }
};

const decodeFirstSync = (buffer) => {
  try {
    return decode(buffer);
  } catch (e) {
    console.error('CBOR decode error:', e);
    return null;
  }
};

// Export cbor-compatible interface
const cbor = {
  decodeAllSync,
  decodeFirstSync,
  decode: decodeFirstSync,
  decodeFirst: decodeFirstSync,
  encode: encode,
  Encoder: class CborEncoder {},
  Decoder: class CborDecoder {}
};

export default cbor;
export { decodeAllSync, decodeFirstSync, encode, decode };