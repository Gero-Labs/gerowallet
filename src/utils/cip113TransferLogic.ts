// Reviewed CIP-113 transfer-logic templates (decision 14).
//
// Every CIP-113 token names a transfer-logic script in its registry node, and a transfer
// withdraws 0 from it. Gero's Send signs a transfer only when that script, attached to the
// transaction as a witness, is one of these templates: the template itself when it takes no
// parameters, or the template with exactly its parameters applied (checked by re-applying
// them, see src/chrome/cip113Uplc.ts). Any other logic is refused, so a token whose issuer
// wrote their own logic cannot be sent from Gero until that logic is reviewed and added here.
//
// Same review bar as cip113Deployments.ts, and the same list as Nexus's
// src/main/resources/cip113/transfer-logic-templates.json: a template added on one side
// only is refused by the other.
//
// Source: cardano-foundation/cip113-programmable-tokens-platform @
// `ab75bd5d16f4c7d5e5a5ced54ec3bf3d5ff775ce`, the blueprint named on each entry, compiled
// with Aiken `v1.1.21+42babe5`. `hash` is blake2b-224(0x03 ‖ compiledCode); the spec
// re-hashes each entry.

export type Cip113TransferLogicModule = 'dummy' | 'freeze-and-seize';

export interface Cip113TransferLogicTemplate {
  moduleId: Cip113TransferLogicModule;
  /** Blueprint validator and file in the source repository. */
  validator: string;
  blueprint: string;
  /** Names of the data parameters applied to the template, in order. */
  parameters: readonly string[];
  /** PlutusV3 hash of `compiledCode` as given (parameters not applied). */
  hash: string;
  /** The blueprint's `compiledCode`: one CBOR bytestring around a flat program. */
  compiledCode: string;
}

export const CIP113_TRANSFER_LOGIC_TEMPLATES: readonly Cip113TransferLogicTemplate[] = [
  {
    moduleId: 'dummy',
    validator: 'transfer.transfer.withdraw',
    blueprint: 'src/modules/dummy/plutus.json',
    parameters: [],
    hash: '6ae51f97696717eb0de100c151a30965a3c4ff97c167124b2b206ba9',
    compiledCode:
      '588901010029800aba2aba1aab9eaab9dab9a488889660026464646644b30013370e900200144c8cdc39bad300a005482400cc024c020dd5001c566002' +
      '66e1d2006002899192cc004cdc3a400060126ea8c02cc03000a294629410081bad300a0013008375400714a0803100618029baa00130070033006300700' +
      '130060013003375400d149a26cac80081',
  },
  {
    moduleId: 'freeze-and-seize',
    validator: 'example_transfer_logic.transfer.withdraw',
    blueprint: 'src/modules/freeze-and-seize/plutus.json',
    // Applied as data: Credential `Script(PLB)`, then the blacklist node policy id (bytes).
    parameters: ['programmable_logic_base_cred', 'blacklist_node_cs'],
    hash: 'd95bf16fdd1ce4260100f158d042a91801ca753339d57d97078075c8',
    compiledCode:
      '5904810101002229800aba2aba1aba0aab9faab9eaab9dab9a9bae00248888888966002646465300130063754003370e90024c02800d222598009801001c' +
      '4cc88c8cc00400400888c9660020051325980099198008009bab30143015301530153015301530153015301530153011375401044b30010018a508acc0' +
      '04c966002601660246ea8006266ebcc058c04cdd5000804c5282022301130150018a51899801001180b000a020404d13298009800800c896600200314a3' +
      '15980099b8748008c048dd5180b000c4cc008008c05c006294101120289bac30023011375401091119801001194c00400664660020026eb0c064c058dd5' +
      '006912cc004006297ae0899912cc004cdd7980e180c9baa301c30193754601460326ea800808226644b3001300d301a3754005132598009807180d9baa0' +
      '018992cc004c03cc070dd5000c4cc07cc080c074dd5000802c4cc07cc080c074dd5000802a036301f301c37540030024068603c60366ea800a00280c8c0' +
      '28c064dd5180e180c9baa300a3019375400420031001405c603400266004004603600280c201480088896600200514bd70456600200314bd7044cc0666' +
      '0026644b3001300b3018375400313259800acc004cdc4240006466446600400400244b3001001801c4c8cc896600266e452201000028acc004cdc7a441' +
      '000028800c01901e44cc014014c09001101e1bae301d001375a603c002604000280f0c8c8cc004004dd59807180e9baa0042259800800c00e2646644b3' +
      '0013372203c00515980099b8f01e0028800c01901f44cc014014c09401101f1bae301e0013756603e002604200280f852f5bded8c0290004528c4c8cc0' +
      '04004c8cc004004dd59806980e1baa0032259800800c52f5c113233223322330020020012259800800c400e2646604a6e9ccc094dd4802998129811000' +
      '998129811800a5eb80cc00c00cc09c008c0940050231bab3020003375c603a002660060066044004604000280f0896600200314a115980099b8f375c60' +
      '3e6eb0c07c0040662946266004004604000280d101d20308992cc004c034c068dd5000c4c8c8cc8966002604600715980099b90375c6044603e6ea8014' +
      '022266e40020dd71808180f9baa0058a5040751640806eb8c080004dd718100011810000980d9baa0018b203232598009809980d1baa0018980f180d9b' +
      'aa0018b2032301d301e301e301a3754003164060601460326ea8c070c064dd5000c590171bae301a002325980099b88001480022980103d87a8000899' +
      '803802800a02c375a6034602e6ea8c06800698103d87a8000a60103d879800040553001003980d8014c06c005003203040602225980080145300103d87a' +
      '80008acc004c014006266e9520003301530160024bd70466002007301700299b80001480050032022405114a080708c04cc050006264b30013002300f37' +
      '540031323259800980b00144cc018018c0580162c8098dd6980a00098081baa0018b201c301200240406e1d2000300d300a37540086eb0c0340162b300' +
      '13370e9003001c4c8cc89289bad300e001300e300f001300a3754009164020804060126014002601200260086ea802629344d95900201',
  },
];
