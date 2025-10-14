import Dexie from 'dexie';
import { BaseLoader } from './base';
import NetworkStore from '@/stores/networkStore';
import { Cardano } from '@cardano-sdk/core';
import networks from '@/utils/networks';

/**
 * Loader for assets data
 */
export class AssetsLoader extends BaseLoader {
  constructor(private getBlockchainDb: () => Promise<Dexie>) {
    super('assets');
  }

  async load(): Promise<any> {
    const blockchainDB = await this.getBlockchainDb();

    return this.createSubscription(
      () => blockchainDB.table('assets').toArray(),
      assets => {
        const map = assets.reduce((map: Record<string, any>, asset: any) => {
          map[asset.asset] = asset;
          return map;
        }, {});
        NetworkStore.setAssets(map);
      }
    );
  }
}

/**
 * Loader for genesis information
 */
export class GenesisLoader extends BaseLoader {
  constructor(private getBlockchainDb: () => Promise<Dexie>) {
    super('genesis_info');
  }

  async load(): Promise<any> {
    const blockchainDB = await this.getBlockchainDb();

    return this.createSubscription(
      () => blockchainDB.table('genesis_info').where({ id: 0 }).first(),
      genesis => {
        if (genesis) {
          NetworkStore.setGenesis(genesis);
        }
      },
      err => {
        console.error('liveQuery(genesis_info) failed:', err);
      }
    );
  }
}

/**
 * Loader for epoch parameters
 */
export class EpochParamsLoader extends BaseLoader {
  constructor(private getBlockchainDb: () => Promise<Dexie>, private chain: any, private network: any) {
    super('epoch_params');
  }

  async load(): Promise<any> {
    const blockchainDB = await this.getBlockchainDb();

    return this.createSubscription(
      () => blockchainDB.table('epoch_params').orderBy('epoch').last(),
      (epochParams: any) => {
        console.log('loading epochParams', epochParams)

        // Default epoch params (Cardano Mainnet Conway era - 2024)
        const defaultEpochParams = {
          coinsPerUtxoByte: 4310,
          coinsPerUtxoWord: null,
          collateralPercentage: 150,
          committeeTermLimit: 146,
          costModels: new Map<Cardano.PlutusLanguageVersion, Cardano.CostModel>([
            [Cardano.PlutusLanguageVersion.V1, [100788,420,1,1,1000,173,0,1,1000,59957,4,1,11183,32,201305,8356,4,16000,100,16000,100,16000,100,16000,100,16000,100,16000,100,100,100,16000,100,94375,32,132994,32,61462,4,72010,178,0,1,22151,32,91189,769,4,2,85848,228465,122,0,1,1,1000,42921,4,2,24548,29498,38,1,898148,27279,1,51775,558,1,39184,1000,60594,1,141895,32,83150,32,15299,32,76049,1,13169,4,22100,10,28999,74,1,28999,74,1,43285,552,1,44749,541,1,33852,32,68246,32,72362,32,7243,32,7391,32,11546,32,85848,228465,122,0,1,1,90434,519,0,1,74433,32,85848,228465,122,0,1,1,85848,228465,122,0,1,1,270652,22588,4,1457325,64566,4,20467,1,4,0,141992,32,100788,420,1,1,81663,32,59498,32,20142,32,24588,32,20744,32,25933,32,24623,32,53384111,14333,10]],
            [Cardano.PlutusLanguageVersion.V2, [100788,420,1,1,1000,173,0,1,1000,59957,4,1,11183,32,201305,8356,4,16000,100,16000,100,16000,100,16000,100,16000,100,16000,100,100,100,16000,100,94375,32,132994,32,61462,4,72010,178,0,1,22151,32,91189,769,4,2,85848,228465,122,0,1,1,1000,42921,4,2,24548,29498,38,1,898148,27279,1,51775,558,1,39184,1000,60594,1,141895,32,83150,32,15299,32,76049,1,13169,4,22100,10,28999,74,1,28999,74,1,43285,552,1,44749,541,1,33852,32,68246,32,72362,32,7243,32,7391,32,11546,32,85848,228465,122,0,1,1,90434,519,0,1,74433,32,85848,228465,122,0,1,1,85848,228465,122,0,1,1,955506,213312,0,2,270652,22588,4,1457325,64566,4,20467,1,4,0,141992,32,100788,420,1,1,81663,32,59498,32,20142,32,24588,32,20744,32,25933,32,24623,32,43053543,10,53384111,14333,10,43574283,26308,10]],
            [Cardano.PlutusLanguageVersion.V3, [541,1,33852,32,68246,32,72362,32,7243,32,7391,32,11546,32,85848,123203,7305,-900,1716,549,57,85848,0,1,90434,519,0,1,74433,32,85848,123203,7305,-900,1716,549,57,85848,0,1,1,85848,123203,7305,-900,1716,549,57,85848,0,1,955506,213312,0,2,270652,22588,4,1457325,64566,4,20467,1,4,0,141992,32,100788,420,1,1,81663,32,59498,32,20142,32,24588,32,20744,32,25933,32,24623,32,43053543,10,53384111,14333,10,43574283,26308,10,16000,100,16000,100,962335,18,2780678,6,442008,1,52538055,3756,18,267929,18,76433006,8868,18,52948122,18,1995836,36,3227919,12,901022,1,166917843,4307,36,284546,36,158221314,26549,36,74698472,36,333849714,1,254006273,72,2174038,72,2261318,64571,4,207616,8310,4,1293828,28716,63,0,1,1006041,43623,251,0,1,100181,726,719,0,1,100181,726,719,0,1,100181,726,719,0,1,107878,680,0,1,95336,1,281145,18848,0,1,180194,159,1,1,158519,8942,0,1,159378,8813,0,1,107490,3298,1,106057,655,1,1964219,24520,3,100788,420,1,1,1000,173,0,1,1000,59957,4,1,11183,32,201305,8356,4,16000,100,16000,100,16000,100,16000,100,16000,100,16000,100,100,100,16000,100,94375,32,132994,32,61462,4,72010,178,0,1,22151,32,91189,769,4,2,85848,123203,7305,-900,1716,549,57,85848,0,1,1,1000,42921,4,2,24548,29498,38,1,898148,27279,1,51775,558,1,39184,1000,60594,1,141895,32,83150,32,15299,32,76049,1,13169,4,22100,10,28999,74,1,28999,74,1,43285,552,1,44749]]
          ]),
          dRepDeposit: 500000000,
          dRepInactivityPeriod: Cardano.EpochNo(20),
          dRepVotingThresholds: {
            ppEconomicGroup: { denominator: 100, numerator: 67 },
            ppGovernanceGroup: { denominator: 4, numerator: 3 },
            ppNetworkGroup: { denominator: 100, numerator: 67 },
            ppTechnicalGroup: { denominator: 100, numerator: 67 },
            treasuryWithdrawal: { denominator: 100, numerator: 67 },
            updateConstitution: { denominator: 4, numerator: 3 }
          },
          decentralizationParameter: 0,
          desiredNumberOfPools: 500,
          extraEntropy: null,
          governanceActionDeposit: 100000000000,
          governanceActionValidityPeriod: Cardano.EpochNo(6),
          maxBlockBodySize: 90112,
          maxBlockHeaderSize: 1100,
          maxCollateralInputs: 3,
          maxExecutionUnitsPerBlock: { memory: 62000000, steps: 20000000000 },
          maxExecutionUnitsPerTransaction: { memory: 14000000, steps: 10000000000 },
          maxTxSize: 16384,
          maxValueSize: 5000,
          minCommitteeSize: 7,
          minFeeCoefficient: 44,
          minFeeConstant: 155381,
          minFeeRefScriptCostPerByte: 15,
          minPoolCost: 170000000,
          minUtxoValue: 0,
          monetaryExpansion: 0.003,
          poolDeposit: 500000000,
          poolInfluence: 0.3,
          poolRetirementEpochBound: 18,
          poolVotingThresholds: {
            committeeNoConfidence: { denominator: 100, numerator: 51 },
            committeeNormal: { denominator: 100, numerator: 51 },
            hardForkInitiation: { denominator: 100, numerator: 51 },
            motionNoConfidence: { denominator: 100, numerator: 51 },
            securityRelevantParamVotingThreshold: { denominator: 100, numerator: 51 }
          },
          prices: { memory: 0.0577, steps: 0.0000721 },
          protocolVersion: { major: 10, minor: 0 },
          stakeKeyDeposit: 2000000,
          treasuryExpansion: 0.2
        };

        if (!epochParams) {
          console.warn('⚠️ No epoch params from database, using hardcoded defaults');
        }
        try {
          const protocolParametersByron = { maxTxSize: epochParams?.max_tx_size || defaultEpochParams.maxTxSize,
          };
          const newProtocolParamsInShelley = {
            minFeeCoefficient: epochParams?.min_fee_a || defaultEpochParams.minFeeCoefficient,
            minFeeConstant: epochParams?.min_fee_b || defaultEpochParams.minFeeConstant,
            maxBlockBodySize: epochParams?.max_block_size || defaultEpochParams.maxBlockBodySize,
            maxBlockHeaderSize: epochParams?.max_block_header_size || defaultEpochParams.maxBlockHeaderSize,
            stakeKeyDeposit: epochParams?.key_deposit || defaultEpochParams.stakeKeyDeposit,
            poolDeposit: epochParams?.pool_deposit || defaultEpochParams.poolDeposit,
            poolRetirementEpochBound: epochParams?.e_max || defaultEpochParams.poolRetirementEpochBound,
            desiredNumberOfPools: epochParams?.n_opt || defaultEpochParams.desiredNumberOfPools,
            poolInfluence: epochParams?.a0 || defaultEpochParams.poolInfluence,
            monetaryExpansion: epochParams?.rho || defaultEpochParams.monetaryExpansion,
            treasuryExpansion: epochParams?.tau || defaultEpochParams.treasuryExpansion,
            decentralizationParameter: epochParams?.decentralisation_param !== undefined ? epochParams.decentralisation_param : defaultEpochParams.decentralizationParameter,
            minUtxoValue: epochParams?.min_utxo || defaultEpochParams.minUtxoValue,
            minPoolCost: epochParams?.min_pool_cost || defaultEpochParams.minPoolCost,
            extraEntropy: epochParams?.extra_entropy !== undefined ? epochParams.extra_entropy : defaultEpochParams.extraEntropy,
            protocolVersion: {
              major: epochParams?.protocol_major_ver || defaultEpochParams.protocolVersion.major,
              minor: epochParams?.protocol_minor_ver || defaultEpochParams.protocolVersion.minor,
            },
          };
          const newProtocolParamsInAlonzo = {
            coinsPerUtxoWord: epochParams?.coins_per_utxo_word || defaultEpochParams.coinsPerUtxoWord,
            maxValueSize: epochParams?.max_val_size || defaultEpochParams.maxValueSize,
            collateralPercentage: epochParams?.collateral_percent || defaultEpochParams.collateralPercentage,
            maxCollateralInputs: epochParams?.max_collateral_inputs || defaultEpochParams.maxCollateralInputs,
            costModels: epochParams?.cost_models
              ? new Map<Cardano.PlutusLanguageVersion, Cardano.CostModel>([
                  [Cardano.PlutusLanguageVersion.V1, Object.values(epochParams.cost_models.PlutusV1 || {})],
                  [Cardano.PlutusLanguageVersion.V2, Object.values(epochParams.cost_models.PlutusV2 || {})],
                  [Cardano.PlutusLanguageVersion.V3, Object.values(epochParams.cost_models.PlutusV3 || {})],
                ])
              : defaultEpochParams.costModels,
            prices: {
              memory: epochParams?.price_mem || defaultEpochParams.prices.memory,
              steps: epochParams?.price_step || defaultEpochParams.prices.steps,
            } as Cardano.ExUnits,
            maxExecutionUnitsPerTransaction: {
              memory: epochParams?.max_tx_ex_mem || defaultEpochParams.maxExecutionUnitsPerTransaction.memory,
              steps: epochParams?.max_tx_ex_steps || defaultEpochParams.maxExecutionUnitsPerTransaction.steps,
            } as Cardano.ExUnits,
            maxExecutionUnitsPerBlock: {
              memory: epochParams?.max_block_ex_mem || defaultEpochParams.maxExecutionUnitsPerBlock.memory,
              steps: epochParams?.max_block_ex_steps || defaultEpochParams.maxExecutionUnitsPerBlock.steps,
            } as Cardano.ExUnits,
          };
          const newProtocolParamsInBabbage = {
            coinsPerUtxoByte: epochParams?.coins_per_utxo_size || defaultEpochParams.coinsPerUtxoByte,
          };
          const newProtocolParamsInConway = {
            poolVotingThresholds: epochParams?.pvt_motion_no_confidence
              ? ({
                  motionNoConfidence: Cardano.FractionUtils.toFraction(epochParams.pvt_motion_no_confidence),
                  committeeNormal: Cardano.FractionUtils.toFraction(epochParams.pvt_committee_normal),
                  committeeNoConfidence: Cardano.FractionUtils.toFraction(epochParams.pvt_committee_no_confidence),
                  hardForkInitiation: Cardano.FractionUtils.toFraction(epochParams.pvt_hard_fork_initiation),
                  securityRelevantParamVotingThreshold: Cardano.FractionUtils.toFraction(
                    epochParams.pvt_p_p_security_group
                  ),
                } as Cardano.PoolVotingThresholds)
              : defaultEpochParams.poolVotingThresholds,
            dRepVotingThresholds: epochParams?.dvt_update_to_constitution
              ? ({
                  updateConstitution: Cardano.FractionUtils.toFraction(epochParams.dvt_update_to_constitution),
                  ppNetworkGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_network_group),
                  ppEconomicGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_economic_group),
                  ppTechnicalGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_technical_group),
                  ppGovernanceGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_gov_group),
                  treasuryWithdrawal: Cardano.FractionUtils.toFraction(epochParams.dvt_treasury_withdrawal),
                } as Cardano.DelegateRepresentativeThresholds)
              : defaultEpochParams.dRepVotingThresholds,
            minCommitteeSize: epochParams?.committee_min_size || defaultEpochParams.minCommitteeSize,
            committeeTermLimit: epochParams?.committee_max_term_length
              ? Cardano.EpochNo(epochParams.committee_max_term_length)
              : defaultEpochParams.committeeTermLimit,
            governanceActionValidityPeriod: epochParams?.gov_action_lifetime
              ? Cardano.EpochNo(epochParams.gov_action_lifetime)
              : defaultEpochParams.governanceActionValidityPeriod,
            governanceActionDeposit: epochParams?.gov_action_deposit || defaultEpochParams.governanceActionDeposit,
            dRepDeposit: epochParams?.drep_deposit || defaultEpochParams.dRepDeposit,
            dRepInactivityPeriod: epochParams?.drep_activity ? Cardano.EpochNo(epochParams.drep_activity) : defaultEpochParams.dRepInactivityPeriod,
            minFeeRefScriptCostPerByte: epochParams?.min_fee_ref_script_cost_per_byte || defaultEpochParams.minFeeRefScriptCostPerByte,
          };
          console.log('setEpochParams', newProtocolParamsInAlonzo)
          NetworkStore.setEpochParams({
            ...protocolParametersByron,
            ...newProtocolParamsInShelley,
            ...newProtocolParamsInAlonzo,
            ...newProtocolParamsInBabbage,
            ...newProtocolParamsInConway,
          } as Cardano.ProtocolParameters);
        } catch (error) {
          console.error('❌ Error processing epoch params:', error);
          console.warn('⚠️ Using default epoch parameters due to error');
        }
      }
    );
  }
}
