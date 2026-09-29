import { describe, it, expect } from 'vitest';
import { convertDustDestination, convertDustStatus, convertTransactionUtxos } from './midnight-api';

describe('convertTransactionUtxos', () => {
  const output = { owner: 'mn_addr1fixture', token_type: '0'.repeat(64), value: '9007199254740993',
    intent_hash: 'ab'.repeat(32), output_index: 0, initial_nonce: 'cd'.repeat(32),
    registered_for_dust_generation: false, ctime: 1787759076 };
  const wire = { tx_hash: 'ef'.repeat(32), created_outputs: [output], spent_outputs: [output] };

  it('maps the actual Nexus field names and preserves integer precision in both output sets', () => {
    const result = convertTransactionUtxos(wire);
    expect(result.txHash).toBe(wire.tx_hash);
    expect(result.createdOutputs[0]).toEqual({ owner: output.owner, tokenType: output.token_type,
      value: 9007199254740993n, intentHash: output.intent_hash, outputIndex: 0,
      initialNonce: output.initial_nonce, registeredForDustGeneration: false, ctime: output.ctime });
    expect(result.spentOutputs).toEqual(result.createdOutputs);
    expect(wire.created_outputs[0].value).toBe('9007199254740993');
  });

  it('preserves zero and omits a nullable creation timestamp', () => {
    const result = convertTransactionUtxos({ ...wire, created_outputs: [{ ...output, value: '0', ctime: null }], spent_outputs: [] });
    expect(result.createdOutputs[0].value).toBe(0n);
    expect(result.createdOutputs[0]).not.toHaveProperty('ctime');
    expect(result.spentOutputs).toEqual([]);
  });

  it.each([null, {}, { tx_hash: 'ab', created_outputs: null, spent_outputs: [] }])('rejects a malformed envelope: %j', value => {
    expect(() => convertTransactionUtxos(value)).toThrow('Invalid Midnight transaction UTxO response');
  });

  it.each([null, { value: 9007199254740992 }, { value: '-1' }, { value: '1.5' },
    { value: '' }, { token_type: null }, { output_index: -1 }, { ctime: '123' }])('rejects malformed output fields: %j', patch => {
    expect(() => convertTransactionUtxos({ ...wire, created_outputs: [patch === null ? null : { ...output, ...patch }] }))
      .toThrow('Invalid Midnight transaction UTxO response');
  });
});

describe('convertDustStatus', () => {
  // Captured shape of a real Nexus `dust/status` response (mainnet, verified
  // 2026-07-25).
  // The wallet-side conversion from this snake_case wire payload to the
  // camelCase DTO was missing entirely for a full release: every hyphenated
  // field (`dust_address`, `night_balance`, `generation_rate`,
  // `max_capacity`, `current_capacity`, `registration_utxo_tx_hash`,
  // `registration_utxo_output_index`) silently came through as `undefined`,
  // which broke stake matching (useDustSources.ts) and the
  // registrationOutpoint() lookup that deregister()/migrateDustAddressToOwn()
  // depend on. This test pins the conversion against a real captured payload
  // so that regression can't ship undetected again.
  it('converts a registered wire payload to the camelCase DTO', () => {
    const wire = {
      cardano_reward_address: 'stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5',
      dust_address: 'mn_dust1wvlhuqzu0a2kqnchn33cf2qgsldzw0tl7083zwgzlufmaawr05u56etug5q',
      registered: true,
      night_balance: '1076061710',
      generation_rate: '8895802156570',
      max_capacity: '5380308500000000000',
      current_capacity: '3957088700000000000',
      registration_utxo_tx_hash: '527e9a33aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      registration_utxo_output_index: 0,
    };

    expect(convertDustStatus(wire)).toEqual({
      cardanoRewardAddress: 'stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5',
      dustAddress: 'mn_dust1wvlhuqzu0a2kqnchn33cf2qgsldzw0tl7083zwgzlufmaawr05u56etug5q',
      registered: true,
      nightBalance: '1076061710',
      generationRate: '8895802156570',
      maxCapacity: '5380308500000000000',
      currentCapacity: '3957088700000000000',
      registrationUtxoTxHash: '527e9a33aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      registrationUtxoOutputIndex: 0,
    });
  });

  it('normalizes an unregistered payload with null/missing optional fields', () => {
    const wire = {
      cardano_reward_address: 'stake1u9xyz0000000000000000000000000000000000000000000000',
      dust_address: null,
      registered: false,
      // night_balance / generation_rate / max_capacity / current_capacity /
      // registration_utxo_tx_hash / registration_utxo_output_index all
      // absent — Nexus omits them rather than sending explicit nulls.
    };

    expect(convertDustStatus(wire)).toStrictEqual({
      cardanoRewardAddress: 'stake1u9xyz0000000000000000000000000000000000000000000000',
      dustAddress: null,
      registered: false,
      nightBalance: undefined,
      generationRate: undefined,
      maxCapacity: undefined,
      currentCapacity: undefined,
      registrationUtxoTxHash: null,
      registrationUtxoOutputIndex: null,
    });
  });
});

describe('convertDustDestination', () => {
  // Shape of Nexus's `GET dust/destination` (DustDestinationStatusDto): the four figures are the
  // destination's totals, counted once. Figures and outpoint hashes here are the mainnet capture of
  // seven stakes registered to one dust address (each reported the same 935253826).
  const wire = {
    dust_address: 'mn_dust1wwaytdqf2wqtz033qcryjkddpu6c43c9mffwq8fkgyknnnwmc7gn5hptr9w',
    registered: true,
    night_balance: '935253826',
    generation_rate: '7731743379542',
    max_capacity: '4676269130000000000',
    current_capacity: '4676269130000000000',
    stakes: [
      { cardano_reward_address: 'stake1u8d3d5xrfeqpt4h6tvvczpymmdfn07rrnlaesrrqhc0vc6saf8fa2', state: 'active',
        registration_utxo_tx_hash: '90cf12cac571fd17cbdbd50cfff68d1804eb3f80d25df4950b8cb73474118056',
        registration_utxo_output_index: 0 },
      { cardano_reward_address: 'stake1u8ehpy2d9asphfql8fgxrdendyc5sv5z54p43fwg9akpxpgxv8w87', state: 'relaying',
        registration_utxo_tx_hash: '06b97159211506090517c731461d3f62921d640f6463e84dcc20d7ff24314502',
        registration_utxo_output_index: 1 },
      { cardano_reward_address: 'stake1u9pdhh585nndpjzcnmj7nczax5w0tk48ftr9cfgezl2tnkc0jfr9t', state: 'duplicated',
        registration_utxo_tx_hash: '69e119cf24198729beb6a22a5d1c597657ce9e119c8e6ada4c660645cf863a18',
        registration_utxo_output_index: 0 },
    ],
  };

  it('maps the snake_case wire payload to the camelCase DTO, keeping the figures as strings', () => {
    expect(convertDustDestination(wire)).toEqual({
      dustAddress: 'mn_dust1wwaytdqf2wqtz033qcryjkddpu6c43c9mffwq8fkgyknnnwmc7gn5hptr9w',
      registered: true,
      nightBalance: '935253826',
      generationRate: '7731743379542',
      maxCapacity: '4676269130000000000',
      currentCapacity: '4676269130000000000',
      stakes: [
        { cardanoRewardAddress: 'stake1u8d3d5xrfeqpt4h6tvvczpymmdfn07rrnlaesrrqhc0vc6saf8fa2', state: 'active',
          registrationUtxoTxHash: '90cf12cac571fd17cbdbd50cfff68d1804eb3f80d25df4950b8cb73474118056',
          registrationUtxoOutputIndex: 0 },
        { cardanoRewardAddress: 'stake1u8ehpy2d9asphfql8fgxrdendyc5sv5z54p43fwg9akpxpgxv8w87', state: 'relaying',
          registrationUtxoTxHash: '06b97159211506090517c731461d3f62921d640f6463e84dcc20d7ff24314502',
          registrationUtxoOutputIndex: 1 },
        { cardanoRewardAddress: 'stake1u9pdhh585nndpjzcnmj7nczax5w0tk48ftr9cfgezl2tnkc0jfr9t', state: 'duplicated',
          registrationUtxoTxHash: '69e119cf24198729beb6a22a5d1c597657ce9e119c8e6ada4c660645cf863a18',
          registrationUtxoOutputIndex: 0 },
      ],
    });
  });

  it('normalizes an unregistered destination: zero figures, no stakes', () => {
    const result = convertDustDestination({
      dust_address: wire.dust_address, registered: false,
      night_balance: '0', generation_rate: '0', max_capacity: '0', current_capacity: '0', stakes: [],
    });
    expect(result.registered).toBe(false);
    expect(result.nightBalance).toBe('0');
    expect(result.stakes).toEqual([]);
  });

  it('turns an absent outpoint into null rather than undefined', () => {
    const result = convertDustDestination({
      ...wire, stakes: [{ cardano_reward_address: 'stake1uxyz', state: 'relaying' }],
    });
    expect(result.stakes[0]).toStrictEqual({
      cardanoRewardAddress: 'stake1uxyz', state: 'relaying',
      registrationUtxoTxHash: null, registrationUtxoOutputIndex: null,
    });
  });

  it('drops a stake in a state this client does not know, so it cannot change a total', () => {
    const result = convertDustDestination({
      ...wire, stakes: [
        { cardano_reward_address: 'stake1uaaa', state: 'something-new' },
        { cardano_reward_address: 'stake1ubbb', state: 'active' },
      ],
    });
    expect(result.stakes.map((s) => s.cardanoRewardAddress)).toEqual(['stake1ubbb']);
  });

  it.each([
    ['null', null],
    ['no address', { ...wire, dust_address: undefined }],
    ['registered is not a boolean', { ...wire, registered: 'true' }],
    ['a missing figure', { ...wire, night_balance: undefined }],
    ['a non-numeric figure', { ...wire, current_capacity: '12abc' }],
    ['a negative figure', { ...wire, max_capacity: '-1' }],
    ['a numeric (not string) figure', { ...wire, generation_rate: 7731743379542 }],
    ['stakes is not an array', { ...wire, stakes: null }],
    ['a stake without an address', { ...wire, stakes: [{ state: 'active' }] }],
    ['a stake that is not an object', { ...wire, stakes: ['stake1u'] }],
  ])('rejects a malformed payload instead of reading a missing figure as zero: %s', (_label, payload) => {
    expect(() => convertDustDestination(payload as never)).toThrow('Invalid Midnight DUST destination response');
  });
});
