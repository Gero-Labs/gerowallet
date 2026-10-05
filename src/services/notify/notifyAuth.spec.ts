import { describe, it, expect } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import {
  EMPTY_BODY_SHA256, bodySha256Hex, canonicalString, encodeBody, hexToBytes, randomNonceHex, signHeaders,
} from './notifyAuth';

// CONTRACT §3.8: public test keys only (RFC 8032 TEST 1 relay key).
const RELAY_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RELAY_PUB = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const identity = { deviceId: '21fe31dfa154a261626bf854046fd227', privKeyHex: RELAY_SEED };
const TAG = '00112233445566778899aabbccddeeff';

const V1_BODY = '{"protocol":1,"relayPubKey":"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a","platform":"extension","appVersion":"2.8.0","locale":"en","osPermission":true,"transport":"webpush","webpush":{"endpoint":"https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV","p256dh":"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4","auth":"BTBZMqHH6r4Tts7J_aSIgg","vapidKid":"v1","expirationTime":null}}';
const V2_BODY = '{"network":"cardano-mainnet","stakeAddress":"stake1uyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpswtcyrc","proof":{"coseSign1":"84582aa201276761646472657373581de10d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06a166686173686564f458ba6765726f2d786465762f76317c4445564943455f52454749535445527c32316665333164666131353461323631363236626638353430343666643232377c643735613938303138326231306162376435346266656433633936343037336130656531373266336461613632333235616630323161363866373037353131617c7374616b65317579786b35346d376a3371366d726b657663756e7279727766347037653638633933636a6b38677a786b686c6b70737774637972635840689bb635e76b6272f352d295cea334b1b670ec2c38824b4c0e29baaf5fd3339357bb88427a8df8e4a3cb180f9896d33ec08fb8ada7d64405033755358aaf980e","coseKey":"a5010102581de10d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06032720062158208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"},"paymentCreds":["008b47844d92812fc30d1f0ac9b6fbf38778ccba9db8312ad9079079","8a95c8ed588306ea88860b54eb0c65e77dfab999789cc5e6ca008799"],"eventKey":"0f0e0d0c0b0a09080706050403020100"}';
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('§3.8 vectors, byte for byte', () => {
  it('vector 1: PUT /device body hash, canonical string and signature', () => {
    const body = utf8(V1_BODY);
    expect(bodySha256Hex(body)).toBe('b0bccc0b8f7ba77a9af817b9f330d996bfbe80f47286e6b74b03374788721661');
    expect(canonicalString('PUT', '/api/notify/v1/device', '1790553600000', '000102030405060708090a0b0c0d0e0f', body))
      .toBe('gero-notify/v1|PUT|/api/notify/v1/device|1790553600000|000102030405060708090a0b0c0d0e0f|b0bccc0b8f7ba77a9af817b9f330d996bfbe80f47286e6b74b03374788721661');
    const h = signHeaders(identity, 'PUT', '/api/notify/v1/device', body, 1790553600000, '000102030405060708090a0b0c0d0e0f');
    expect(h).toEqual({
      'X-Gero-Device': '21fe31dfa154a261626bf854046fd227',
      'X-Gero-Ts': '1790553600000',
      'X-Gero-Nonce': '000102030405060708090a0b0c0d0e0f',
      'X-Gero-Sig': 'e80acf9f3de00ee8a06bb14a98ded20c63a8ae223a2ec8004432c81a3aaaf0153ebc74b7d591873a7cbe46b3957aab087544c9ba736db6f3fbb27d55ff403e0e',
    });
  });

  it('vector 2: PUT /device/wallets/{tag} (wallet proof body)', () => {
    const body = utf8(V2_BODY);
    expect(bodySha256Hex(body)).toBe('f6ea561e0193b6594188911dc2ec9c296d93e84b3d2bb544e9d2f34df046df2f');
    const h = signHeaders(identity, 'PUT', `/api/notify/v1/device/wallets/${TAG}`, body, 1790553601000, '101112131415161718191a1b1c1d1e1f');
    expect(h['X-Gero-Sig']).toBe('7cf5ee82c404c7d4ce52e491ddc9a5e805e762206a5905d1f75519039632681a2d3585d847e1e12a54109d041b74ea5b22e5810b572a4c739bee29a90951a10b');
  });

  it('vector 3: GET …/prefs, empty body hash', () => {
    expect(bodySha256Hex(new Uint8Array(0))).toBe(EMPTY_BODY_SHA256);
    const h = signHeaders(identity, 'GET', `/api/notify/v1/device/wallets/${TAG}/prefs`, new Uint8Array(0), 1790553602000, '202122232425262728292a2b2c2d2e2f');
    expect(h['X-Gero-Sig']).toBe('e765224c7c84b1e102eee8cc5652480ab64822692cff04c5aa311a8c3d7105948f584356c9c3a1a0173add048cc902c8fd1212a8d08376f1746d0313269b5c00');
  });

  it('vector 4: DELETE …/wallets/{tag}', () => {
    const h = signHeaders(identity, 'DELETE', `/api/notify/v1/device/wallets/${TAG}`, new Uint8Array(0), 1790553603000, '303132333435363738393a3b3c3d3e3f');
    expect(h['X-Gero-Sig']).toBe('8154aa6bfbe66903402c26de9290c617af6f4452c6b852294853660fea49c959b9f5605d1e3de63ac2cbaba94fab284166714452c767cb77de69da2d8a8a2508');
  });

  it('the signature verifies against the relay pubkey and breaks on one body byte', async () => {
    const body = utf8(V1_BODY);
    const h = signHeaders(identity, 'PUT', '/api/notify/v1/device', body, 1790553600000, '000102030405060708090a0b0c0d0e0f');
    const subject = canonicalString('PUT', '/api/notify/v1/device', h['X-Gero-Ts'], h['X-Gero-Nonce'], body);
    expect(await ed25519.verifyAsync(hexToBytes(h['X-Gero-Sig']), utf8(subject), hexToBytes(RELAY_PUB))).toBe(true);
    const tampered = canonicalString('PUT', '/api/notify/v1/device', h['X-Gero-Ts'], h['X-Gero-Nonce'], utf8(V1_BODY.replace('"2.8.0"', '"2.8.1"')));
    expect(await ed25519.verifyAsync(hexToBytes(h['X-Gero-Sig']), utf8(tampered), hexToBytes(RELAY_PUB))).toBe(false);
  });
});

describe('signing rules', () => {
  it('encodeBody produces the exact compact bytes that are then hashed (vector 1 object)', () => {
    const body = encodeBody(JSON.parse(V1_BODY));
    expect(new TextDecoder().decode(body)).toBe(V1_BODY);
    expect(bodySha256Hex(body)).toBe('b0bccc0b8f7ba77a9af817b9f330d996bfbe80f47286e6b74b03374788721661');
  });

  it('the path is signed without host or query, and a query would change the signature', () => {
    const a = signHeaders(identity, 'GET', '/api/notify/v1/device', new Uint8Array(0), 1790553600000, '00'.repeat(16));
    const b = signHeaders(identity, 'GET', '/api/notify/v1/device?x=1', new Uint8Array(0), 1790553600000, '00'.repeat(16));
    expect(a['X-Gero-Sig']).not.toBe(b['X-Gero-Sig']);
  });

  it('X-Gero-Ts is the integer millisecond string, 13 digits', () => {
    const h = signHeaders(identity, 'GET', '/api/notify/v1/device', new Uint8Array(0), 1790553600000.7);
    expect(h['X-Gero-Ts']).toBe('1790553600000');
    expect(h['X-Gero-Ts']).toMatch(/^[0-9]{13}$/);
  });

  it('nonces are 32 lowercase hex and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const n = randomNonceHex();
      expect(n).toMatch(/^[0-9a-f]{32}$/);
      seen.add(n);
    }
    expect(seen.size).toBe(50);
    expect(randomNonceHex(() => new Uint8Array(16).fill(0xab))).toBe('ab'.repeat(16));
  });
});
