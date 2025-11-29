/**
 * JSON serialization utilities to handle big integers
 */
import JSONbig from 'json-bigint'
import { BigIntWrap } from '@/services/zkFold/types';

// Configure JSONbig to handle BigInt values properly
// storeAsString: false ensures large integers are serialized as numeric values (not quoted strings)
// alwaysParseAsBig: true ensures all large numbers are parsed as BigInt
// This is required for compatibility with Haskell's Aeson parser which expects unquoted numbers
const JSONbigConfig = JSONbig({
  storeAsString: false,
  alwaysParseAsBig: true,
  useNativeBigInt: true
})

export function serialize(data: any): string {
  return JSONbigConfig.stringify(data)
}

export function deserialize(jsonString: string): any {
  try {
    return JSONbigConfig.parse(jsonString)
  } catch (error) {
    console.error('Failed to parse JSON:', error)
    return null
  }
}

export function b64ToBn(b64: string): BigIntWrap {
  const bin = atob(b64)
  const hex: string[] = []

  bin.split('').forEach(function (ch) {
    let h = ch.charCodeAt(0).toString(16)
    if (h.length % 2) { h = '0' + h }
    hex.push(h)
  })

  return new BigIntWrap(BigInt('0x' + hex.join('')))
}
