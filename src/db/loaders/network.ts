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
        let defaultEpochParams;
        if (!epochParams) {
          defaultEpochParams = networks.resolveNetwork(this.chain, this.network).protocolParams;
        }
        try {
          const protocolParametersByron = {
            maxTxSize: epochParams?.max_tx_size || defaultEpochParams.max_tx_size,
          };
          const newProtocolParamsInShelley = {
            minFeeCoefficient: epochParams?.min_fee_a || defaultEpochParams.min_fee_a,
            minFeeConstant: epochParams?.min_fee_b || defaultEpochParams.min_fee_b,
            maxBlockBodySize: epochParams?.max_block_size,
            maxBlockHeaderSize: epochParams?.max_block_header_size,
            stakeKeyDeposit: epochParams?.key_deposit || parseInt(defaultEpochParams.key_deposit),
            poolDeposit: epochParams?.pool_deposit || parseInt(defaultEpochParams.pool_deposit),
            poolRetirementEpochBound: epochParams?.e_max,
            desiredNumberOfPools: epochParams?.n_opt,
            poolInfluence: epochParams?.a0,
            monetaryExpansion: epochParams?.rho,
            treasuryExpansion: epochParams?.tau,
            decentralizationParameter: epochParams?.decentralisation_param,
            minUtxoValue: epochParams?.min_utxo || parseInt(defaultEpochParams.min_utxo_value),
            minPoolCost: epochParams?.min_pool_cost,
            extraEntropy: epochParams?.extra_entropy,
            protocolVersion: {
              major: epochParams?.protocol_major_ver,
              minor: epochParams?.protocol_minor_ver,
            },
          };
          const newProtocolParamsInAlonzo = {
            coinsPerUtxoWord: epochParams?.coins_per_utxo_word,
            maxValueSize: epochParams?.max_val_size || defaultEpochParams.max_val_size,
            collateralPercentage: epochParams?.collateral_percent,
            maxCollateralInputs: epochParams?.max_collateral_inputs,
            costModels: epochParams?.cost_models
              ? new Map<Cardano.PlutusLanguageVersion, Cardano.CostModel>([
                  [Cardano.PlutusLanguageVersion.V1, Object.values(epochParams.cost_models.PlutusV1 || {})],
                  [Cardano.PlutusLanguageVersion.V2, Object.values(epochParams.cost_models.PlutusV2 || {})],
                  [Cardano.PlutusLanguageVersion.V3, Object.values(epochParams.cost_models.PlutusV3 || {})],
                ])
              : new Map(),
            prices: {
              memory: epochParams?.price_mem,
              steps: epochParams?.price_step,
            } as Cardano.ExUnits,
            maxExecutionUnitsPerTransaction: {
              memory: epochParams?.max_tx_ex_mem,
              steps: epochParams?.max_tx_ex_steps,
            } as Cardano.ExUnits,
            maxExecutionUnitsPerBlock: {
              memory: epochParams?.max_block_ex_mem,
              steps: epochParams?.max_block_ex_steps,
            } as Cardano.ExUnits,
          };
          const newProtocolParamsInBabbage = {
            coinsPerUtxoByte: epochParams?.coins_per_utxo_size,
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
              : undefined,
            dRepVotingThresholds: epochParams?.dvt_update_to_constitution
              ? ({
                  updateConstitution: Cardano.FractionUtils.toFraction(epochParams.dvt_update_to_constitution),
                  ppNetworkGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_network_group),
                  ppEconomicGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_economic_group),
                  ppTechnicalGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_technical_group),
                  ppGovernanceGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_gov_group),
                  treasuryWithdrawal: Cardano.FractionUtils.toFraction(epochParams.dvt_treasury_withdrawal),
                } as Cardano.DelegateRepresentativeThresholds)
              : undefined,
            minCommitteeSize: epochParams?.committee_min_size,
            committeeTermLimit: epochParams?.committee_max_term_length
              ? Cardano.EpochNo(epochParams.committee_max_term_length)
              : undefined,
            governanceActionValidityPeriod: epochParams?.gov_action_lifetime
              ? Cardano.EpochNo(epochParams.gov_action_lifetime)
              : undefined,
            governanceActionDeposit: epochParams?.gov_action_deposit,
            dRepDeposit: epochParams?.drep_deposit,
            dRepInactivityPeriod: epochParams?.drep_activity ? Cardano.EpochNo(epochParams.drep_activity) : undefined,
            minFeeRefScriptCostPerByte: epochParams?.min_fee_ref_script_cost_per_byte,
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
