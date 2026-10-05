/**
 * FROZEN stored-secret fixtures, one per format the wallet has ever written.
 * SYNTHETIC ONLY: the mnemonic is the public BIP-39 all-"abandon" test vector and
 * the password is a made-up constant. Nothing here protects real funds.
 *
 * Generated once (2026-09-28) with:
 *  - `legacy*`: real CryptoJS 4.2.0 `AES.encrypt(...).toString()` — the wire
 *    format crypto-ts wrote. Root keys use the historic nested writer
 *    `AES.encrypt(JSON.stringify(encryptWithPassword(...)), pw)`.
 *  - `rawHex`: `encryptPrivateKey` / `encryptWithPassword` (PBKDF2-SHA512 c=19162).
 *  - `gpw1`: `passwordSecret.encryptSecret`.
 *  - `gpw2`: `secretEnvelope.sealGpw2` with `GPW2_WRITE_PARAMS` at the time.
 *
 * Do NOT regenerate: they exist to prove today's readers still open blobs that
 * are already sitting in users' IndexedDB.
 */
export const SECRET_FORMAT_FIXTURES = 
{
  "pw": "Gero-fixture-pw-2026!",
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
  "cardanoRootKeyHex": "b07ff3e63c17cd2e0504e4bfd52a98c47abde183ccd0738efc385e764fd91d4bd7d399eeef3c4df68facb3f11e4a4d45513ea1e2a8018aa35b3c078714cfdcedccc42249e17984c44cf380b489f62c57f84089e150245bf49c436d0b9709c58f",
  "cardanoRootPublicKeyHex": "51aa1dcac6324b41cb184e27589a208b7f1c941c620e1e0d10414c979989a7c2ccc42249e17984c44cf380b489f62c57f84089e150245bf49c436d0b9709c58f",
  "btcRootKeyHex": "235b34cd7c9f6d7e4595ffe9ae4b1cb5606df8aca2b527d20a07c8f56b2342f4",
  "rootKey": {
    "legacyNested": "U2FsdGVkX1+mM1ArnVGQ3uqel7zJmZt3WguJr0XHj8UumqCsFJyjDA5qw6xbmP0BpEoJcamkLSLPhbb4Sx0sAjl3YjGD8p0a169XHKXY/TWPiNm4EkXTDG0+KMvhz17kjZjd5o8hjb7xwcDz/R3fuF4XK9Ob3u6yQRUdFD4E+UTW8p+2Nr8te7YxgJQjzDjcjvGkqovzB9JtRiYbSJTNDAjbXbNh/amwPrAt03kv1dPm9GMqZpDXc2vHRa0XuoqNjSGU52l7QPfMw2z+ZK0ftl0acAiToQ71213kf3oGWiOsJGAItoJ177WiB+YSDqtTefOw2aAMYNgUfvmZZ0KW/yVSkE3oePyV8ViIP4fWUbOA70Gdoc+qZ4d7GN91+Hj/4GUhTZifreb29xzuwuXpnCcRZopD3Gbsty0Tly9ziFVI76Ria+qmrNdpQmZQigzY",
    "rawHex": "af944c79db282391f7807097467072715e64c1e01cfc84f6b2e7cb16ef54e402c9ca55e5d90a251e9609c8263221661606ab5b04650caf81603c7c251e65a2084f3a5cff48a0a25f2b52d60af8e4c75805a8369a14ae311941ac68648723f10d516b343eb6897e01b7bda549d622686cd40aaad5f61077a896ae9011a555f39d9fce71b163e2d2a76810654da188195c8908995735570c4a49c489db",
    "gpw2": "gpw2.AgEBAAAAAgAATAAAAAABhSOp6exdwnmL2JJH2PBn0TetIf-yF6JiUl7E2A66ANJPnaCWrSGEW9g7ogTHBi6ym5wNVDl_t8ft_yEfUheEApAmzkwpo4-SR5dTFZDJFhVqCVdDpcUU01SkEYKIlOku-RWvhNhdModmZMXsB2_9jpQHUj4nY130xuLtnU-yvcLrXuDyEvqPFIK1RRfH8ySmFiLWZA1jUes"
  },
  "btcRootKey": {
    "legacyNested": "U2FsdGVkX18spv2fsUM3P0Hzeukr/LniPHYkzfsaH7te8LJ3BW+8edtFSdmwkr0kF6FbCzLDXv1Tsz/52Cqi4OGJIy6xOqc+J1lr/jh72jZ4vkmMLpdQ1S/Nhdw8BW+B0Qa8/cYdebQIiV6fnV+rYnLD8V8kTaPYOk4+ohZjlpeS8Aw9T4Q+aKXnWvoaIlj1r/4bND4PVSNCMtE0R5FrWTcT151EnmzMujBLUEyy/UXyx7TyX+bJ88cAP/MJ5TngbwLTVVnLbJYg367SoAZB9w==",
    "rawHex": "85cc6c00772890aadceb946f3fbbd496bbed5d2481d6ede2ee4f6b88625335ad16ab86b6ac141dbf8e4013c01169e5a98084438281db9925edadc8f4b2bb1dd6ce6bea57eba82e4acf6ab5c93df75aacad749bb0e1440db5b31238b9",
    "gpw2": "gpw2.AgEBAAAAAgAATAAAAAABPiSwN1kGiyykxUiO5vBjbpNdeB94e1nQaIyIHpJeaQ3dIsFVg9IB5KECDBdlAHpZRUZ-MKQYV0H3VlWHLNfiY7AYCMqt6EbHVYosKvvDMvqfHvuFPGAzMg"
  },
  "mnemonicBlob": {
    "legacy": "U2FsdGVkX1/8BXMYDVuJGin/K696ne3f3+tadB4SJ4+L0QOzMMs4gbapA/EIjFvtGRM9nPB1aBkeHYS/h1pvnVykwUIgvHtawJv8zJ0gnihqNLIxrIbUqwCvi/Zr+iPUqW5xLPTyv+G4Mbx6wTJlZP1pzHbqmCTWVMmKsa9Q6oUj8Gza4HFjMdKyeFHolBkNtX0Xf5UDlB0QF6zPsd1aMr1LZJhuR8iecS4CK7RpbbgHgevII+6K3r1GrGUDrUi857uSb6t/IHiDzw/Afz5Mwg==",
    "gpw1": "gpw1.AQAAAAIAAEwAAAAAAZyzVflsvDegRvs7qGIOcquVh2yuOvY0dB0AQqIo3L6KuWBxMlw5AFrolw0xRnE8HPpH62qfu0w5k7zcPjddKQmiKsMgewHvC5b9nJgOzdPkzAzogXOZ0QT40MppeFuQde7Hugk0DxlnuNSkeRKrvl7Nu2ZY4x2I_f-RAHPTkjvFOATAdRXZ69C8HkIRzuhT3knUGGGK0I6jQnFmtDj4czILFWBCQ8NN-CAiuULuhFG8_KQcQ0Lms8QxiAchmdLxPEj4YCXIdbflHu2P7_vldKNu6TMzpuqX7X1L2zxYHlTD3XJ-0d9vurFnxP4HX56AcR0u0g",
    "gpw2": "gpw2.AgIBAAAAAgAATAAAAAAByTZXT8IykUSUU3YxIYLWjOh1QPseGSGiyE7_1X-vR86AuqOk7nybx71hamoZfrdAtvr1ETnIujvPzJfNq_FRat6e6rzV8dSmZyuJ_9N9zEq3NH__UvX2LPQTyLNBomvDFelz2s7NmpkzRZsK-DAz5n5V55bqPhJf6vrNZ3Fv6tNhzoUBK7-xADPFNXWJp2TM786KCbsACZL9qCidz57btGbfJ_n0kcAip8gnV-xf4mgTgPsrYtweFaGLZAk1BPwzSLk0PzcqnRyNRsIGnRROykOp6W8T9krANLwduKb2purT1QuY_DiXs3S19R6nxid7CfGR"
  },
  "securityData": {
    "legacy": "U2FsdGVkX1914ylQ4AHJmv8w2qcR5M0jtU0GDcROHYSswR18gE9Ljj0RKdosn7KR",
    "gpw1": "gpw1.AQAAAAIAAEwAAAAAASlUgpfSZs7gRAUtvCkwHmAdpVAfT0VjYMRuYmOU8jxlbStzqkWgQ_B59bCUd3Vh2NVZJ0fnfusCcyFemqfvvklRgnq9izVAHg",
    "gpw2": "gpw2.AgQBAAAAAgAATAAAAAABEiWjbW1wYXn917493QylND65csiv7LCU4H2oPRwH-jSAaay5TkGxIIqth3ehtwVIOn1XbTb4v5j5FSSEXv2YnzMYch4JCG2C"
  },
  "coldKey": {
    "hex": "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    "rawHex": "fcc6d1e667c070404b3185faaad6721b7039fda366ca07742d5f51f06c682f9d78952f8f23ea8dafa9d909c45b93c419b6934531dbdf4fc5848768b7ae8ed2540dd09aee6c76d385511e3d0f7e437855e86bc86e95b3093f60691bee",
    "gpw2": "gpw2.AgUBAAAAAgAATAAAAAABoJ2OJGjB3jdNPTUVH8b4ABDzvsTF1ArdvO6oh9qfFF_9A-Fr3KcPeh_9wGlSgjbz5cy5S8F6vCozS9v4UQsumx0gwkiNEFmNH2m-Me4VE53-QjwAf5Tj5A"
  }
} as const;
