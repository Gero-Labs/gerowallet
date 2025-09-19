/**
 * JSON serialization utilities to handle big integers
 * CSP-safe implementation that doesn't use eval()
 */

import { BigIntWrap, ProofBytes, BackendKey } from './Types';

/**
 * Custom JSON serializer that handles BigInt values
 * Converts BigInt to string for JSON serialization
 */
export function serialize(data: any): string {
    return JSON.stringify(data, (key, value) => {
        if (typeof value === 'bigint') {
            return value.toString();
        } else if (value instanceof BigIntWrap) {
            return value.toBigInt().toString();
        }
        return value;
    });
}

/**
 * Custom JSON deserializer that handles BigInt values
 * Note: This basic implementation handles simple cases
 * For complex BigInt parsing, we rely on the specific parse functions below
 */
export function deserialize(jsonString: string): any {
    return JSON.parse(jsonString);
}

/**
 * Parse BigInt values from JSON string without using eval()
 * @param jsonString - JSON string that may contain BigInt values
 * @returns Parsed object with BigInt values
 */
export function parseBigIntFromJSON(jsonString: string): any {
    return JSON.parse(jsonString, (key, value) => {
        // Try to convert string values that look like big integers back to BigInt
        if (typeof value === 'string' && /^-?\d+$/.test(value)) {
            try {
                // Only convert very large numbers to BigInt to avoid converting regular numbers
                if (value.length > 15) {
                    return BigInt(value);
                }
            } catch {
                // If BigInt conversion fails, return the original string
            }
        }
        return value;
    });
}

export function parseProofBytes(json: string): ProofBytes | null {
    console.log(json);
    let unsafe;
    if (typeof json === 'string') {
        unsafe = parseBigIntFromJSON(json);
    } else if (typeof json === "object") {
        unsafe = json;
    } else {
        return null;
    }

    const wrapped = {
        "a_xi_int": new BigIntWrap(unsafe.a_xi_int),
        "b_xi_int": new BigIntWrap(unsafe.b_xi_int),
        "c_xi_int": new BigIntWrap(unsafe.c_xi_int),
        "cmA_bytes": unsafe.cmA_bytes,
        "cmB_bytes": unsafe.cmB_bytes,
        "cmC_bytes": unsafe.cmC_bytes,
        "cmF_bytes": unsafe.cmF_bytes,
        "cmH1_bytes": unsafe.cmH1_bytes,
        "cmH2_bytes": unsafe.cmH2_bytes,
        "cmQhigh_bytes": unsafe.cmQhigh_bytes,
        "cmQlow_bytes": unsafe.cmQlow_bytes,
        "cmQmid_bytes": unsafe.cmQmid_bytes,
        "cmZ1_bytes": unsafe.cmZ1_bytes,
        "cmZ2_bytes": unsafe.cmZ2_bytes,
        "f_xi_int": new BigIntWrap(unsafe.f_xi_int),
        "h1_xi'_int": new BigIntWrap(unsafe["h1_xi'_int"]),
        "h2_xi_int": new BigIntWrap(unsafe.h2_xi_int),
        "l1_xi": new BigIntWrap(unsafe.l1_xi),
        "l_xi": new BigIntWrap(unsafe.l_xi),
        "proof1_bytes": unsafe.proof1_bytes,
        "proof2_bytes": unsafe.proof2_bytes,
        "s1_xi_int": new BigIntWrap(unsafe.s1_xi_int),
        "s2_xi_int": new BigIntWrap(unsafe.s2_xi_int),
        "t_xi'_int": new BigIntWrap(unsafe["t_xi'_int"]),
        "t_xi_int": new BigIntWrap(unsafe.t_xi_int),
        "z1_xi'_int": new BigIntWrap(unsafe["z1_xi'_int"]),
        "z2_xi'_int": new BigIntWrap(unsafe["z2_xi'_int"])
    };

    return wrapped;
}

export function parseBackendKeys(json: any[]): BackendKey[] {
    const result = [];
    const arrayLength = json.length;
    for (let i = 0; i < arrayLength; i++) {
        const safe = {
            pkbId: json[i].id,
            pkbPublic: {
                public_e: new BigIntWrap(json[i].public.public_e),
                public_n: new BigIntWrap(json[i].public.public_n),
                public_size: new BigIntWrap(json[i].public.public_size),
            }
        }
        result.push(safe);
    }
    return result;
}

export function parseProofStatus(json: string): ProofBytes | string {
    const unsafe = parseBigIntFromJSON(json);
    if (unsafe.tag == "Completed") {
        return parseProofBytes(unsafe.contents.bytes) || "";
    }
    return unsafe.tag;
}