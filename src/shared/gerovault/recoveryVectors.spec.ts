// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import { bytesToHex, hexToBytes } from './cbor';
import { RECOVERY_HEADER_BYTES, normalizeRecoveryPassphrase, openRecoveryFile, readRecoveryHeader, sealRecoveryFile } from './recoveryFormat';
import { decodeRecoveryPayload, encodeRecoveryPayload } from './recoveryPayload';
import { exportRecoveryPackage, openRecoveryPackage, restoreVaultFromPackage } from './recoveryPackage';
import { encodeRegistration } from './registration';
import { vaultAddresses } from './scripts';
import { vaultId } from './vaultId';
import { RoleKeys } from './types';
import {
  RECOVERY_NONCE,
  RECOVERY_PASSPHRASE,
  RECOVERY_SALT,
  backupContents,
  plutusContents,
  standardContents,
  standardVault,
  vectorPeople,
} from './__fixtures__/recoveryPackageVectors';

/**
 * PROVISIONAL vectors (GV-14): not frozen until they match the other client's. Inputs in
 * `__fixtures__/recoveryPackageVectors.ts`. These are the only tests that run Argon2id at full
 * strength (64 MiB, 3 passes, 1 lane); the others replace it with a fast stand-in.
 */
const VECTORS = {
  standardPayload:
    'af00010101021b000001a21526e40003a30000015864830302838200581c1196fe3062e96b78dd959058f5adad44dd663519200f2495d17ef10d8200581c3e94c7a4a4179bdfa3e337b4317534272fcdb126454dc4963698a5568200581c87106519b7b4b1bca202cf14940ad1a96bfcea14e35dae0d27382796025864830302838200581c2361abf3a7b928aa332833de3ae61fc1d6f9e70f78c4428276dbd3cb8200581cb52bf00b8c22926abead9d3df775a0edd30bcfe083a0bf618df8927a8200581cd9d94c38b82231f94dc2c5f3fda3d47108c57a3c139dae7813895b4904a2000001010583a300000158207225e2a4ce53366b04f441cf3bbbe9fd8d9637de5e9c47ce165cd49d6a2e6e36025820cde24ddd6a132994025981a3cf15e5638a0aefb66371f24b1617579b5c0c3545a300000158203a469d54a952a2ef488c93fe5669bc31cc15000f1d568ba2846552c8543a1c20025820e535d2e3372f3cec8cbb6d37fc5e2b9d79a2bf5a552e2131f9ef202cf65dfc7aa30000015820fd5b03e74b4a3db999772e7f88c28efa56de58dd4fbd36a1721e05faa285b65c025820024c73d668f6325b0ddbeb4f5f5d0967f926e0ae79846f96cd9139acaf42c82906800780088009800a000b000c800d800e00',
  standardFile:
    '894756520d0a1a0a01000100000000000300000001000102030405060708090a0b0c0d0e0f404142434445464748494a4b4c4d4e4f505152535455565761d9d37b6127bfcf3925a563d9baf391000001e625fd9377cabaeabefdb6781f1ab8e5f1534d6a1be1ebf8f8b4cbeb50fa77d8bdd61d791347c2cef08dd853490e57dc9781dac3a016ca64964488bb3360cd50902c0060b4e142cd037822bbd917c6dd8e517ee462f5e299b8bd56cbd1c7c989462f8feb59ab5d3889aac00c6f978588e0fca270610e065ef2e4648157c13983f592325e07c4ada536d9b02b81619a1ea9ef777da5d14db1952345fea77d603d4d65308f85e209f617733184d24d9e01dc45d1e1a059f17628ff794d2c28d72ab9c7d045bf6e198562e91cae60380ab5ce43f559534f7f659daa0fc852255c147922a5e382871ca2221cdb9a86981118380f949052f442a62f2f09e9d12b09e5ab667b0866b54ad5d4573ea20cc61f1a88ea06114fe8c02693ca1fd2c8f4f293aa8335e79bf252a268e78fafaa57047fb573ed8e3de8f560fb802f29b30b2e9b4c8dd346bc52e6a1e8781c6806bc62b5fafa37e4053a8013dc50c92c6747dec40b7c954bfcde1545eef309d1a5d305043ec4e1c1b1f019d8dc2b7cf15cfcc8bbbd7fdb01fa65935534f87af22e09ee20377e24502f97cfbd8d30d5aa54cf830548685d0b6363fe69694792943ecce7c2554e97907b760f9d6f2c232bf1757ed2ad8c8e0c3adf296db92aa1d887fce90314d70da2631428e8e42147014a7a46f1af07b0653ee772',
  backupPayload:
    'af00010101021b000001a21526e40003a40000015875820282830302828200581c1196fe3062e96b78dd959058f5adad44dd663519200f2495d17ef10d8200581c3e94c7a4a4179bdfa3e337b4317534272fcdb126454dc4963698a556820182830301818200581c87106519b7b4b1bca202cf14940ad1a96bfcea14e35dae0d2738279682041a0bebc200025875820282830302828200581c2361abf3a7b928aa332833de3ae61fc1d6f9e70f78c4428276dbd3cb8200581cd9d94c38b82231f94dc2c5f3fda3d47108c57a3c139dae7813895b49820182830301818200581cb52bf00b8c22926abead9d3df775a0edd30bcfe083a0bf618df8927a82041a0bebc20003a20001011a0bebc20004a2000201010583a400000158207225e2a4ce53366b04f441cf3bbbe9fd8d9637de5e9c47ce165cd49d6a2e6e36025820cde24ddd6a132994025981a3cf15e5638a0aefb66371f24b1617579b5c0c35450469547265617375726572a500000158203a469d54a952a2ef488c93fe5669bc31cc15000f1d568ba2846552c8543a1c20025820e535d2e3372f3cec8cbb6d37fc5e2b9d79a2bf5a552e2131f9ef202cf65dfc7a03830158407f6740215e5e7c1438c3e39d7ae2c04937beb344b1019e71ee081767de9abae40a14bdf6d53d4c52c10238721360225c0936c7b80cf15076d01edb97165647e95840e1a4def407051cce9ab0b50328e98da6e0cbcce62790bf2f78c5e3f65e042ee5e671333b4d4093cbc6a350a499403d83ea915df6ea8c0fdf4315da45346ca71c046741756469746f72a30001015820fd5b03e74b4a3db999772e7f88c28efa56de58dd4fbd36a1721e05faa285b65c025820024c73d668f6325b0ddbeb4f5f5d0967f926e0ae79846f96cd9139acaf42c8290682820150a1006d6765726f2d7661756c742f7631820252a2006d6765726f2d7661756c742f7631010207818258205a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a448301020c088182581d601c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c67506179726f6c6c0981825820bebebebebebebebebebebebebebebebebebebebebebebebebebebebebebebebe000a000b000c818558201111111111111111111111111111111111111111111111111111111111111111581c222222222222222222222222222222222222222222222222222222225820333333333333333333333333333333333333333333333333333333333333333350444444444444444444444444444444445840555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555550d8182014784a400818258200e00',
  plutusPayload:
    'af00010102021b000001a21526e40003a40001018258200f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f030201034f59010100003322222005120012001104a2000001010583a200000158207225e2a4ce53366b04f441cf3bbbe9fd8d9637de5e9c47ce165cd49d6a2e6e36a200000158203a469d54a952a2ef488c93fe5669bc31cc15000f1d568ba2846552c8543a1c20a200020158203a68c118216349580a1368c18fb5135d92c94cf049b7871d278b033f4c72af1c06800780088009818258200e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e000a000b000c800d800e00',
} as const;

/** The standard vault of the vault identifier vectors (`vaultId.spec.ts`), on preprod. */
const STANDARD_PAYMENT_HASH = '15a2d7075091e8b329778f82f80706bcc7266f62a4376e8486fe9d7a';
const STANDARD_PREPROD_ID = '0d2d86cdfe63becafa9f7f4f88bda9c6daccc8ebb857704d964d1232e477b12e';

let people: RoleKeys[];

beforeAll(async () => {
  people = await vectorPeople();
});

describe('payload vectors (provisional)', () => {
  it.each([
    ['standard', standardContents, VECTORS.standardPayload],
    ['backup', backupContents, VECTORS.backupPayload],
    ['plutus', plutusContents, VECTORS.plutusPayload],
  ] as const)('%s payload encodes to the pinned bytes and decodes back', async (_, contents, hex) => {
    const c = await contents(people);
    expect(bytesToHex(encodeRecoveryPayload(c))).toBe(hex);
    const decoded = decodeRecoveryPayload(hexToBytes(hex));
    if (decoded.ok !== true) throw new Error(decoded.code);
    expect(bytesToHex(encodeRecoveryPayload(decoded.package))).toBe(hex);
    expect(decoded.package.participants).toEqual(c.participants);
  });

  it('the standard vector is the standard vault of the vault identifier vectors', async () => {
    const v = await standardVault(people);
    expect(v.payment.hash).toBe(STANDARD_PAYMENT_HASH);
    expect(vaultId(v, 'preprod')).toBe(STANDARD_PREPROD_ID);
  });
});

describe('file vector at full strength (provisional)', () => {
  it('lays out the header as documented', () => {
    const file = hexToBytes(VECTORS.standardFile) as Uint8Array;
    const at = (from: number, to: number) => bytesToHex(file.subarray(from, to));
    expect(at(0, 8)).toBe('894756520d0a1a0a');
    expect(at(8, 9)).toBe('01');
    expect(at(9, 13)).toBe('00010000');
    expect(at(13, 17)).toBe('00000003');
    expect(at(17, 21)).toBe('00000001');
    expect(at(21, 37)).toBe(bytesToHex(RECOVERY_SALT));
    expect(at(37, 61)).toBe(bytesToHex(RECOVERY_NONCE));
    expect(new DataView(file.buffer).getUint32(77, false)).toBe(file.length - RECOVERY_HEADER_BYTES);
    expect(file.length - RECOVERY_HEADER_BYTES).toBe(VECTORS.standardPayload.length / 2 + 16);
    expect(readRecoveryHeader(file)).toMatchObject({ ok: true, header: { version: 1, kdf: { memoryKiB: 65536, passes: 3, lanes: 1 } } });
  });

  it('seals the vector payload with the fixed salt and nonce into the pinned file', async () => {
    const file = await sealRecoveryFile(hexToBytes(VECTORS.standardPayload) as Uint8Array, RECOVERY_PASSPHRASE, {
      salt: RECOVERY_SALT,
      nonce: RECOVERY_NONCE,
    });
    expect(bytesToHex(file)).toBe(VECTORS.standardFile);
  });

  it('opens the pinned file to the vector payload', async () => {
    const opened = await openRecoveryFile(hexToBytes(VECTORS.standardFile), RECOVERY_PASSPHRASE);
    if (opened.ok !== true) throw new Error(opened.code);
    expect(bytesToHex(opened.payload)).toBe(VECTORS.standardPayload);
  });

  it('an independent implementation (libsodium) builds the same file from the documented layout', async () => {
    await sodium.ready;
    const utf8 = (s: string) => new TextEncoder().encode(s);
    expect(normalizeRecoveryPassphrase(RECOVERY_PASSPHRASE)).toBe(RECOVERY_PASSPHRASE);
    const master = sodium.crypto_pwhash(32, utf8(RECOVERY_PASSPHRASE), RECOVERY_SALT, 3, 64 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
    const key = sodium.crypto_generichash(32, utf8('gero-vault/recovery-package/v1|key'), master);
    const check = sodium.crypto_generichash(16, utf8('gero-vault/recovery-package/v1|check'), master);
    const payload = hexToBytes(VECTORS.standardPayload) as Uint8Array;
    const u32 = (n: number) => n.toString(16).padStart(8, '0');
    const header = hexToBytes(
      `894756520d0a1a0a01${u32(65536)}${u32(3)}${u32(1)}${bytesToHex(RECOVERY_SALT)}${bytesToHex(RECOVERY_NONCE)}${bytesToHex(check)}${u32(payload.length + 16)}`,
    ) as Uint8Array;
    expect(header.length).toBe(RECOVERY_HEADER_BYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(payload, header, null, RECOVERY_NONCE, key);
    expect(bytesToHex(header) + bytesToHex(ciphertext)).toBe(VECTORS.standardFile);
  });

  it('exports, opens and restores end to end with the real key derivation', async () => {
    const contents = await standardContents(people);
    const { file } = await exportRecoveryPackage(contents, RECOVERY_PASSPHRASE, people[0]);
    expect(bytesToHex(file)).not.toBe(VECTORS.standardFile); // fresh salt and nonce
    const opened = await openRecoveryPackage(file, RECOVERY_PASSPHRASE);
    if (opened.ok !== true) throw new Error(opened.code);
    const vault = await standardVault(people);
    const reg = encodeRegistration(vault);
    const restored = await restoreVaultFromPackage(opened.package, {
      roleKeys: people[0],
      chain: { network: 'preprod', registrations: [{ metadata: { cbor: reg.offChain.metadata }, nativeScripts: { cbor: reg.offChain.native_scripts } }] },
    });
    if (restored.ok !== true) throw new Error(restored.code);
    expect(restored.candidate.vaultId).toBe(STANDARD_PREPROD_ID);
    expect(restored.candidate.addresses).toEqual(vaultAddresses(vault, 'preprod'));
    expect(restored.candidate).toMatchObject({ status: 'candidate', depositsBlocked: true, chainState: { registered: true } });
  });
});
