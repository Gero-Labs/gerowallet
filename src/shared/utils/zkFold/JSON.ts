/**
 * JSON serialization utilities to handle big integers
 */

import JSONbig from 'json-bigint'
import { BigIntWrap, ProofBytes, BackendKey } from './Types';


// Configure JSONbig to handle BigInt values properly
const JSONbigConfig = JSONbig({
    storeAsString: false,
    useNativeBigInt: true
})

export function serialize(data: any): string {
    return JSONbigConfig.stringify(data)
}

export function deserialize(jsonString: string): any {
    return JSONbigConfig.parse(jsonString)
}

export function parseProofBytes(json: string): ProofBytes | null {
    console.log(json);
    let unsafe;
    if (typeof json === 'string') {
        const parser = JSONbig({ useNativeBigInt: true });
        unsafe = parser.parse(json);
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
    const parser = JSONbig({ useNativeBigInt: true });
    const unsafe = parser.parse(json);
    if (unsafe.tag == "Completed") {
        return parseProofBytes(unsafe.contents.bytes) || "";
    }
    return unsafe.tag;
}