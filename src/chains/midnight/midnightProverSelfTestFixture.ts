/**
 * A DUST fee spend proof preimage for test proofs ("Run a test proof", and the
 * speed comparison on the Proof server page). It is what the ledger hands a
 * proving provider for a ledger 9 DUST spend built from a fixed THROWAWAY seed
 * (bytes i*7+1, the seed of midnightZkKeyMaterial.spec.ts) on a blank chain: it
 * carries that seed's DUST secret key, which holds nothing anywhere, and no
 * wallet data. Proving it exercises the same circuit, keys and prover as the
 * fee proof of a real send.
 *
 * Captured with @midnightntwrk/ledger-v9 1.0.1 (ledger 9.1.0.1), network id
 * preprod. SHA-256 of the preimage bytes: 054e1faa9e52b64bf155627e58fde69b6a357a19f6ddce55b61c1802692550b5.
 * Regenerate only when the DUST circuit's key generation changes
 * (midnightZkKeys.ts), with the same fixture as the spec.
 *
 * Dependency-free: imported by the background and by tests.
 */

export const DEVICE_SELF_TEST_KEY_LOCATION = 'midnight/dust/spend';

/** base64 of the serialized ProofPreimage (1094 bytes). */
export const DEVICE_SELF_TEST_PREIMAGE = [
  'bWlkbmlnaHQ6cHJvb2YtcHJlaW1hZ2U6SQIAc1QDSJpmMBisOPdAGCvFgUgtqhOskL/DezdJlqR6bx9tc+ruUltlRqveWRAexrcguJoL65br9OYwh5lclZPV',
  'VdVxAAOByxxqc/BSai3wgP/VOqqVMgkC6mjmbSq7VtaxK0H50YAVV1skBwDyBSoBc1QDSJpmMBisOPdAGCvFgUgtqhOskL/DezdJlqR6bx9tHQNvho00u9Le',
  'NU3j8MHeqGFEFd6uwCCrsV8TB9cqYgy0NhP//////////wBvx++T2bePMT6denVZid5bpgM2I3TQFwZ/uRW2gf5kZQAEAAQABAAEAAQABAAEAAQABAAEAAQA',
  'BAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAb3nbwERWzUIaRQQVFyTTZ26zTgNDNSiI4HXB01/QE+AABAAEAAQABAAEAAQABAAE',
  'AAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEHQNvho00u9LeNU3j8MHeqGFEFd6uwCCrsV8TB9cqYgy0NgAEExhCcNDc',
  'zxACJQLAQQEEBABBAQQECEAEBHP//////v////5b/v8CpL1TBdihCQjYOTNIfZ0pU6ftc3Ptxpw9ZxzoQsZhreavUfIElCQlAobpmlQPJS0i44xRI2A0BAQE',
  'wEEBBAQEQQEEBAhABARz//////7////+W/7/AqS9UwXYoQkI2DkzSH2dKVOn7XNzyQJfsDNPk2NV0NJtFWDaZUZUfLx1fkyKKDEFsiyGM1ZgNAQEBMBBAQQE',
  'FDAMQHP//////v////5b/v8CpL1TBdihCQjYOTNIfZ0pU6ftc3P//////v////5b/v8CpL1TBdihCQjYOTNIfZ0pU6ftc6EPc+/STz5DiEX2FRBQ976z6An5',
  'opuaM72cy+6vo1azAFUmc/U7el74iaQy8vQqmchkcKUHJ9692RmAm6u0s7gteps6wEEBBAQQMAQgA5LZHGrAQQEEBAwwDCAQEAcA8gUqAS2BwajBAQQECEAE',
  'BHP//////v////5b/v8CpL1TBdihCQjYOTNIfZ0pU6ftc3Pv0k8+Q4hF9hUQUPe+s+gJ+aKbmjO9nMvur6NWswBVJkQARQKFAsBBAQQEEDAEIAOS2RxqwQEE',
  'BADBAQQEAMhBAQQEBEQEBIAAb/U7el74iaQy8vQqmchkcKUHJ9692RmAm6u0s7gteptFAoUCwQEEBAQ4BIUCwQEEBAjIQQEEBAAoRABFAokCKAQEoQ9z79JP',
  'PkOIRfYVEFD3vrPoCfmim5ozvZzL7q+jVrMAVSZz9Tt6XviJpDLy9CqZyGRwpQcn3r3ZGYCbq7SzuC16mzoDktkcagcA8gUqAS2BwagDktkcagAATG1pZG5p',
  'Z2h0L2R1c3Qvc3BlbmQ=',
].join('');

/** The ledger's overwriteBindingInput for this preimage, as a decimal string. */
export const DEVICE_SELF_TEST_BINDING_INPUT = '24047613671704002439066018681660654027890335403311979374251263231991737803352';
