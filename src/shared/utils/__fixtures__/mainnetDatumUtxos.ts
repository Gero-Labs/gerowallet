/**
 * FROZEN mainnet UTxOs for the datum serialization specs. Real outputs, all unspent on
 * 2026-09-30 (Koios `utxo_info`).
 *
 * - `nexusRow`: the UTxO exactly as the wallet's Nexus proxy served it on 2026-09-30
 *   (`GET /api/addresses/{addr}/utxos?network=cardano-mainnet`). gero-sync relays these
 *   rows verbatim.
 * - `outputCbor` / `datumCbor`: cut by byte offset out of the transaction's own CBOR
 *   (Koios `tx_cbor`), never decoded and re-encoded. Checked by hashing: blake2b-256 of the
 *   cut body is the tx id, and of the cut datum is Koios' `datum_hash`, which is also the
 *   row's `datumHash`.
 *
 * The three inline datums are NOT canonically encoded: their lists are definite-length
 * (`8b…`, `82…`) where the SDK, like Plutus, writes a non-empty list indefinite-length
 * (`9f…ff`). Any decode -> re-encode therefore changes their bytes and their hash,
 * including the SDK's own `toCore()` -> `fromCore()`.
 *
 * Do NOT regenerate from an SDK: the point is bytes that no encoder produced.
 */
/** A Nexus `/api/addresses/{addr}/utxos` row: the fields these specs read, and the rest. */
export interface NexusUtxoRow {
  txHash: string;
  txIndex: number;
  address: string;
  value: string;
  assets: { unit: string; quantity: string; [field: string]: unknown }[];
  datumHash: string | null;
  inlineDatum: { bytes: string; value: unknown } | null;
  [field: string]: unknown;
}

export interface MainnetDatumUtxo {
  nexusRow: NexusUtxoRow;
  /** The output as it sits in its transaction. */
  outputCbor: string;
  /** Inline datum bytes as they sit in that output: `2: [1, #6.24(datumCbor)]`. */
  datumCbor?: string;
  datumHash: string;
}

export const INLINE_DATUM_UTXOS: MainnetDatumUtxo[] = [
  {
    nexusRow: {
      "txHash": "a90bd7a4339f18efb34ed870aeec5825d13925b793e12045b3139b7ab3434fcc",
      "txIndex": 1,
      "address": "addr1wyrauh45lkuld0frc77rckyrqmcr63kgck0wnqpzxyevsls4qsrls",
      "stakeAddress": null,
      "paymentCred": "07de5eb4fdb9f6bd23c7bc3c588306f03d46c8c59ee980223132c87e",
      "epoch": 658,
      "blockHeight": 14006907,
      "blockTime": 1790757079,
      "slot": 199190788,
      "value": "3000000",
      "datumHash": "cdd98916eabefd306e54d2ccf5daa162cfd211ea3e63c2936dc5c3fb73f5da02",
      "inlineDatum": {
        "bytes": "8b1b0000001facfb0f523b00000003eac024341b00001d66edd4c3111b0000007a22e6e4541b00000014173669921b004f49d7ab6c98db82c24a0155e3dd5cc33b2937dfc24c0134e9cc97f082d613f600001b000001a0f16160f01b000001a0f17ded88821b00000038a0d14b3c1b000009ccf9f1965b1a002dc6c0",
        "value": null
      },
      "referenceScript": null,
      "assets": [
        {
          "unit": "9330ff6f3d301a9abc1979cffd1465cd27f7563837a7d635f59f1aa2",
          "policyId": "9330ff6f3d301a9abc1979cffd1465cd27f7563837a7d635f59f1aa2",
          "assetName": "",
          "fingerprint": "asset13skfrkjnctrt0s2ttljqk89uu08jmhvddnjjsp",
          "quantity": "1",
          "decimals": null,
          "hasOnchainMetadata": null
        }
      ],
      "spent": false,
      "blockHash": null,
      "cborHex": "82825820a90bd7a4339f18efb34ed870aeec5825d13925b793e12045b3139b7ab3434fcc01a300581d7107de5eb4fdb9f6bd23c7bc3c588306f03d46c8c59ee980223132c87e01821a002dc6c0a1581c9330ff6f3d301a9abc1979cffd1465cd27f7563837a7d635f59f1aa2a14001028201d818587c8b1b0000001facfb0f523b00000003eac024341b00001d66edd4c3111b0000007a22e6e4541b00000014173669921b004f49d7ab6c98db82c24a0155e3dd5cc33b2937dfc24c0134e9cc97f082d613f600001b000001a0f16160f01b000001a0f17ded88821b00000038a0d14b3c1b000009ccf9f1965b1a002dc6c0"
    },
    outputCbor: 'a300581d7107de5eb4fdb9f6bd23c7bc3c588306f03d46c8c59ee980223132c87e01821a002dc6c0a1581c9330ff6f3d301a9abc1979cffd1465cd27f7563837a7d635f59f1aa2a14001028201d818587c8b1b0000001facfb0f523b00000003eac024341b00001d66edd4c3111b0000007a22e6e4541b00000014173669921b004f49d7ab6c98db82c24a0155e3dd5cc33b2937dfc24c0134e9cc97f082d613f600001b000001a0f16160f01b000001a0f17ded88821b00000038a0d14b3c1b000009ccf9f1965b1a002dc6c0',
    datumCbor: '8b1b0000001facfb0f523b00000003eac024341b00001d66edd4c3111b0000007a22e6e4541b00000014173669921b004f49d7ab6c98db82c24a0155e3dd5cc33b2937dfc24c0134e9cc97f082d613f600001b000001a0f16160f01b000001a0f17ded88821b00000038a0d14b3c1b000009ccf9f1965b1a002dc6c0',
    datumHash: 'cdd98916eabefd306e54d2ccf5daa162cfd211ea3e63c2936dc5c3fb73f5da02',
  },
  {
    nexusRow: {
      "txHash": "07ad1a23f6bc842f6a5b0458f0eb5fb7690189f5e2d3829d9b048fa78cb887cd",
      "txIndex": 1,
      "address": "addr1wxxjtzuaprw2kulnzedpzagage95vptzvsy3c9ufmfvgwfsj8cv4s",
      "stakeAddress": null,
      "paymentCred": "8d258b9d08dcab73f3165a11751d464b46056264091c1789da588726",
      "epoch": 658,
      "blockHeight": 14006918,
      "blockTime": 1790757300,
      "slot": null,
      "value": "3000000",
      "datumHash": "cc6f1e355afa9bc9e2d28d4910c7dfd3e97cb29651640361f4900ac7c02bb3c0",
      "inlineDatum": {
        "bytes": "8b1b00001522aca79a4f3b0000000190dcefd61b00060f7846506cb41b00000baae3982d4c1b00000009c3143eb71b00460162bee7842e82c24a21ff71a21506c5d0d063c24ca6adbe48d1ea97cce71e00001b000001a0f164a4e01b000001a0f1816440821b00000578e540877f1b000102940bb8121e1a002dc6c0",
        "value": {
          "list": [
            {
              "int": 23238669736527
            },
            {
              "int": -6725365719
            },
            {
              "int": 1705859110431924
            },
            {
              "int": 12828590746956
            },
            {
              "int": 41927589559
            },
            {
              "int": 19704771991012398
            },
            {
              "list": [
                {
                  "int": 160550201803685573480547
                },
                {
                  "int": 51584554390060000000000000000
                }
              ]
            },
            {
              "int": 1790756300000
            },
            {
              "int": 1790758184000
            },
            {
              "list": [
                {
                  "int": 6016800425855
                },
                {
                  "int": 284309851738654
                }
              ]
            },
            {
              "int": 3000000
            }
          ]
        }
      },
      "referenceScript": null,
      "assets": [
        {
          "unit": "5a3cb4f52fb3a00ab5abe62080618623811ccafab9c760d0b686e44c",
          "policyId": "5a3cb4f52fb3a00ab5abe62080618623811ccafab9c760d0b686e44c",
          "assetName": "",
          "fingerprint": "asset1lxg0qwekwjpsftwj2mfsc6fgakuyadnea30pk3",
          "quantity": "1",
          "decimals": 0,
          "hasOnchainMetadata": null
        }
      ],
      "spent": false,
      "blockHash": null,
      "cborHex": "8282582007ad1a23f6bc842f6a5b0458f0eb5fb7690189f5e2d3829d9b048fa78cb887cd01a300581d718d258b9d08dcab73f3165a11751d464b46056264091c1789da58872601821a002dc6c0a1581c5a3cb4f52fb3a00ab5abe62080618623811ccafab9c760d0b686e44ca14001028201d818587c8b1b00001522aca79a4f3b0000000190dcefd61b00060f7846506cb41b00000baae3982d4c1b00000009c3143eb71b00460162bee7842e82c24a21ff71a21506c5d0d063c24ca6adbe48d1ea97cce71e00001b000001a0f164a4e01b000001a0f1816440821b00000578e540877f1b000102940bb8121e1a002dc6c0"
    },
    outputCbor: 'a300581d718d258b9d08dcab73f3165a11751d464b46056264091c1789da58872601821a002dc6c0a1581c5a3cb4f52fb3a00ab5abe62080618623811ccafab9c760d0b686e44ca14001028201d818587c8b1b00001522aca79a4f3b0000000190dcefd61b00060f7846506cb41b00000baae3982d4c1b00000009c3143eb71b00460162bee7842e82c24a21ff71a21506c5d0d063c24ca6adbe48d1ea97cce71e00001b000001a0f164a4e01b000001a0f1816440821b00000578e540877f1b000102940bb8121e1a002dc6c0',
    datumCbor: '8b1b00001522aca79a4f3b0000000190dcefd61b00060f7846506cb41b00000baae3982d4c1b00000009c3143eb71b00460162bee7842e82c24a21ff71a21506c5d0d063c24ca6adbe48d1ea97cce71e00001b000001a0f164a4e01b000001a0f1816440821b00000578e540877f1b000102940bb8121e1a002dc6c0',
    datumHash: 'cc6f1e355afa9bc9e2d28d4910c7dfd3e97cb29651640361f4900ac7c02bb3c0',
  },
  {
    nexusRow: {
      "txHash": "83816ba80369b04d12c3f8152bcd100d427b07a5c35fb99b07028800f2aaf2dc",
      "txIndex": 1,
      "address": "addr1w85daktxr5fu26n3rvwc969pqq660nr383w5e99fhfqm39sh5w2ww",
      "stakeAddress": null,
      "paymentCred": "e8ded9661d13c56a711b1d82e8a10035a7cc713c5d4c94a9ba41b896",
      "epoch": 658,
      "blockHeight": 14006925,
      "blockTime": 1790757380,
      "slot": 199191089,
      "value": "3000000",
      "datumHash": "ea2f1f6fd94dd610d744cf206189e0fd618729dd20e7dcaa7b6e3574b631aa94",
      "inlineDatum": {
        "bytes": "8b1b00000013c05c654e3acd38b7a51b00002bea815737af1b000000cea49be6cc1b00000004424661de1a010c3c1882c24930a36d275450f89e91c24b666e3e8ad201b3989980001b000001a0f1825bc51b000001a0f1826610821b000000e5cd309a651b00002bea815737af1a002dc6c0",
        "value": null
      },
      "referenceScript": null,
      "assets": [
        {
          "unit": "d959ec7ee9b45b293ec2494304a5a5603bd9a7d46794d736f79813ce",
          "policyId": "d959ec7ee9b45b293ec2494304a5a5603bd9a7d46794d736f79813ce",
          "assetName": "",
          "fingerprint": "asset17pg8dzghngq4js07s2cfjumt7gtvkz46r6x9u4",
          "quantity": "1",
          "decimals": null,
          "hasOnchainMetadata": null
        }
      ],
      "spent": false,
      "blockHash": null,
      "cborHex": "8282582083816ba80369b04d12c3f8152bcd100d427b07a5c35fb99b07028800f2aaf2dc01a300581d71e8ded9661d13c56a711b1d82e8a10035a7cc713c5d4c94a9ba41b89601821a002dc6c0a1581cd959ec7ee9b45b293ec2494304a5a5603bd9a7d46794d736f79813cea14001028201d81858728b1b00000013c05c654e3acd38b7a51b00002bea815737af1b000000cea49be6cc1b00000004424661de1a010c3c1882c24930a36d275450f89e91c24b666e3e8ad201b3989980001b000001a0f1825bc51b000001a0f1826610821b000000e5cd309a651b00002bea815737af1a002dc6c0"
    },
    outputCbor: 'a300581d71e8ded9661d13c56a711b1d82e8a10035a7cc713c5d4c94a9ba41b89601821a002dc6c0a1581cd959ec7ee9b45b293ec2494304a5a5603bd9a7d46794d736f79813cea14001028201d81858728b1b00000013c05c654e3acd38b7a51b00002bea815737af1b000000cea49be6cc1b00000004424661de1a010c3c1882c24930a36d275450f89e91c24b666e3e8ad201b3989980001b000001a0f1825bc51b000001a0f1826610821b000000e5cd309a651b00002bea815737af1a002dc6c0',
    datumCbor: '8b1b00000013c05c654e3acd38b7a51b00002bea815737af1b000000cea49be6cc1b00000004424661de1a010c3c1882c24930a36d275450f89e91c24b666e3e8ad201b3989980001b000001a0f1825bc51b000001a0f1826610821b000000e5cd309a651b00002bea815737af1a002dc6c0',
    datumHash: 'ea2f1f6fd94dd610d744cf206189e0fd618729dd20e7dcaa7b6e3574b631aa94',
  },
];

/** An Alonzo-era output (array form) holding only a datum HASH. */
export const HASH_ONLY_DATUM_UTXO: MainnetDatumUtxo = {
  nexusRow: {
    "txHash": "8ad441a784d654836598af1e9593c6c7a94f5ec58396ae81b1826c794de83135",
    "txIndex": 0,
    "address": "addr1wxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uwc0h43gt",
    "stakeAddress": null,
    "paymentCred": "a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b",
    "epoch": 340,
    "blockHeight": 7281876,
    "blockTime": 1653290903,
    "slot": null,
    "value": "4000000",
    "datumHash": "e859039afd299134ff2e7c80ec7df5d3c3c75ddded0eccb0076f72b0f5763fa0",
    "inlineDatum": null,
    "referenceScript": null,
    "assets": [
      {
        "unit": "b34b3ea80060ace9427bda98690a73d33840e27aaa8d6edb7f0c757a634e455441",
        "policyId": "b34b3ea80060ace9427bda98690a73d33840e27aaa8d6edb7f0c757a",
        "assetName": "634e455441",
        "fingerprint": "asset1wnxwy544zu8fgyed5vkp2sf3t4t9aptfkc2z5x",
        "quantity": "500",
        "decimals": 0,
        "hasOnchainMetadata": null
      }
    ],
    "spent": false,
    "blockHash": null,
    "cborHex": "828258208ad441a784d654836598af1e9593c6c7a94f5ec58396ae81b1826c794de831350083581d71a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b821a003d0900a1581cb34b3ea80060ace9427bda98690a73d33840e27aaa8d6edb7f0c757aa145634e4554411901f45820e859039afd299134ff2e7c80ec7df5d3c3c75ddded0eccb0076f72b0f5763fa0"
  },
  outputCbor: '83581d71a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b821a003d0900a1581cb34b3ea80060ace9427bda98690a73d33840e27aaa8d6edb7f0c757aa145634e4554411901f45820e859039afd299134ff2e7c80ec7df5d3c3c75ddded0eccb0076f72b0f5763fa0',
  datumHash: 'e859039afd299134ff2e7c80ec7df5d3c3c75ddded0eccb0076f72b0f5763fa0',
};
