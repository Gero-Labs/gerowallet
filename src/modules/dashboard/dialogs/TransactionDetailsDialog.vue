<template>
  <BaseDialog :isOpen="!!transactionInfo" @close="$emit('close')" title="Transaction" :subtitle="new Date(transactionInfo.tx_timestamp * 1000).toLocaleString()" :min-height="600" :height="600">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <div class="transaction-info text-left pb-4">
        <div class="break-text">
          Transaction ID: <a style="color: #00DFF3" :href="`https://cexplorer.io/tx/${transactionInfo.tx_hash}`" target="_blank">{{ transactionInfo.tx_hash | truncate }}</a>
          <CopyButton x-small :value="transactionInfo.tx_hash" class="ml-1"></CopyButton>
        </div>
        <div>
          Tx Size: <span class="value-text">{{transactionInfo.tx_size | humanFileSize}}</span>
        </div>
        <div>
          Block ID: <a style="color: #00DFF3" :href="`https://cexplorer.io/block/${transactionInfo.block_hash}`" target="_blank">{{ transactionInfo.block_hash | truncate }}</a>
          <CopyButton x-small :value="transactionInfo.block_hash" class="ml-1"></CopyButton>
        </div>
        <div>
          Block Height: <span class="value-text">{{ transactionInfo.block_height.toLocaleString('en-US') }}</span>
        </div>
        <div>
          Network Fee: <span style="color: #FF8E8E">{{ transactionInfo.fee | toCurrency }}</span>
        </div>
        <div>
          {{ (Number(transactionInfo.ada) > 0 ? 'Received: ' : 'Sent: ') }}
          <span :style="Number(transactionInfo.ada) > 0 ? { color: '#00DFF3' } : { color: '#FF8E8E' }">
            {{Number(transactionInfo.ada) | toCurrency}}{{ (Number(transactionInfo?.assets.length) > 1 ? ', '+Number(transactionInfo.assets.length-1)+ ' Assets' : '') }}
          </span>
        </div>
        <div v-if="txAssets?.length > 0">
          <v-avatar rounded size="50" v-for="(asset, index) in txAssets" :key="index">
            <v-img :src="asset.img" :alt="`${asset.name} Logo`" contain></v-img>
          </v-avatar>
          <v-btn
            class="px-0"
            height="50"
            width="50"
            style="min-width: 50px!important;"
            v-if="!isExpanded && residue.length > 0"
            @click="expand"
          >
            <v-avatar
              size="50"
              color="black"
              rounded
            >
              <span class="white--text">{{'+' + residue.length}}</span>
            </v-avatar>
          </v-btn>
        </div>
      </div>
      <v-expansion-panels v-model="panels" multiple class="accordion-container">
        <v-expansion-panel>
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-bank-transfer</v-icon>
              </div>
              <h3>UTxOs</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat>
              <v-card-title>Inputs ({{transactionInfo.inputs.length}})</v-card-title>
              <v-card-text>
                <v-simple-table dense>
                  <thead class="grey--text">
                    <tr>
                      <td class="text-left">UTxO</td>
                      <td class="text-left">Address</td>
                      <td class="text-right">Amount</td>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(input, index) in transactionInfo.inputs" :key="`input_${index}`">
                      <td class="text-left">
                        {{ `${input.tx_hash}#${input.tx_index}` | truncate}}<CopyButton x-small class="ml-1" :value="input.payment_addr.bech32"></CopyButton>
                      </td>
                      <td class="text-left">
                        {{input.payment_addr.bech32 | truncate}}<CopyButton x-small class="ml-1" :value="input.payment_addr.bech32"></CopyButton>
                      </td>
                      <td class="text-right">
                        <div>
                          {{input.value | toCurrency}}
                        </div>
                        <div v-for="(asset, assetIndex) in input.asset_list" :key="`input_${index}_asset_${assetIndex}`">
                          <v-chip class="my-1" small>{{getAssetName(asset, true)+' '}}{{(Number(asset.quantity) / (asset.decimals ? Math.pow(10, asset.decimals) : 1)).toLocaleString('en-US', {maximumFractionDigits: 6})}} </v-chip>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </v-simple-table>
              </v-card-text>
              <v-card-title>Outputs ({{transactionInfo.outputs.length}})</v-card-title>
              <v-card-text>
                <v-simple-table dense>
                  <thead class="grey--text">
                  <tr>
                    <td class="text-left">UTxO</td>
                    <td class="text-left">Address</td>
                    <td class="text-right">Amount</td>
                  </tr>
                  </thead>
                  <tbody>
                  <tr v-for="(output, index) in transactionInfo.outputs" :key="`output_${index}`">
                    <td class="text-left">
                      {{ `${output.tx_hash}#${output.tx_index}` | truncate}}<CopyButton x-small class="ml-1" :value="output.payment_addr.bech32"></CopyButton>
                    </td>
                    <td class="text-left">
                      {{output.payment_addr.bech32 | truncate}}<CopyButton x-small class="ml-1" :value="output.payment_addr.bech32"></CopyButton>
                    </td>
                    <td class="text-right">
                      <div>
                        {{output.value | toCurrency}}
                      </div>
                      <div v-for="(asset, assetIndex) in output.asset_list" :key="`output_${index}_asset_${assetIndex}`">
                        <v-chip small class="my-1">{{getAssetName(asset, true)+' '}}{{(Number(asset.quantity) / (asset.decimals ? Math.pow(10, asset.decimals) : 1)).toLocaleString('en-US', {maximumFractionDigits: 6})}} </v-chip>
                      </div>
                    </td>
                  </tr>
                  </tbody>
                  <tfoot class="grey--text">
                    <tr>
                      <td class="text-left">Total Output</td>
                      <td></td>
                      <td class="text-right">{{transactionInfo.total_output | toCurrency}}</td>
                    </tr>
                  </tfoot>
                </v-simple-table>
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-if="transactionInfo?.certificates?.length > 0">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-certificate-outline</v-icon>
              </div>
              <h3>Certificates ({{transactionInfo.certificates.length}})</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat v-for="(certificate, index) in transactionInfo.certificates" :key="index" class="mb-2">
              <v-card-title>{{getCertificateType(certificate.type)}}</v-card-title>
              <v-card-text>
                <v-simple-table dense>
                  <tbody>
                    <tr v-if="certificate.info.drep_id">
                      <td class="text-left grey--text" >
                        DRep Id
                      </td>
                      <td class="text-left">
                        {{certificate.info.drep_id | truncate}}<CopyButton x-small class="ml-1" :value="certificate.info.drep_id"></CopyButton>
                      </td>
                    </tr>
                    <tr v-if="certificate.info.drep_hex">
                      <td class="text-left grey--text">
                        DRep Hex
                      </td>
                      <td class="text-left">
                        {{certificate.info.drep_hex | truncate}}<CopyButton x-small class="ml-1" :value="certificate.info.drep_hex"></CopyButton>
                      </td>
                    </tr>
                    <tr v-if="certificate.info.deposit">
                      <td class="text-left grey--text" >
                        Deposit
                      </td>
                      <td class="text-left">
                        {{ Number(certificate.info.deposit) | toCurrency }}
                      </td>
                    </tr>
                    <tr v-if="certificate.info.stake_address">
                      <td class="text-left grey--text">
                        Stake Address
                      </td>
                      <td class="text-left">
                        {{certificate.info.stake_address | truncate}}<CopyButton x-small class="ml-1" :value="certificate.info.stake_address"></CopyButton>
                      </td>
                    </tr>
                    <tr v-if="certificate.info.pool_id_hex">
                      <td class="text-left grey--text">
                        Pool Id (Hex)
                      </td>
                      <td class="text-left">
                        {{certificate.info.pool_id_hex | truncate}}<CopyButton x-small class="ml-1" :value="certificate.info.pool_id_hex"></CopyButton>
                      </td>
                    </tr>
                    <tr v-if="certificate.info.pool_id_bech32">
                      <td class="text-left grey--text">
                        Pool Id (Bech32)
                      </td>
                      <td class="text-left">
                        {{certificate.info.pool_id_bech32 | truncate}}<CopyButton x-small class="ml-1" :value="certificate.info.pool_id_bech32"></CopyButton>
                      </td>
                    </tr>
                  </tbody>
                </v-simple-table>
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-if="transactionInfo?.metadata">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-code-block-tags</v-icon>
              </div>
              <h3>Metadata</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat>
              <v-card-title class="pb-0">
                <v-spacer>
                </v-spacer>
                <CopyButton :value="JSON.stringify(transactionInfo.metadata)" small></CopyButton>
              </v-card-title>
              <v-card-text class="text-left" style="font-size: 12px;font-family: monospace!important;">
                {{JSON.stringify(transactionInfo.metadata, null, 2)}}
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-if="transactionInfo?.assets_minted?.length > 0">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-code-block-tags</v-icon>
              </div>
              <h3>Assets Minted ({{transactionInfo.assets_minted.length}})</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat>
              <v-card-text class="px-0">
                <v-simple-table class="transparent" dense>
                  <thead class="grey--text">
                    <tr>
                      <td class="text-left">Policy Id</td>
                      <td class="text-left">Asset Name</td>
                      <td class="text-left">Fingerprint</td>
                      <td class="text-left">Quantity</td>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(asset_minted, index) in transactionInfo.assets_minted" :key="`asset_minted_${index}`">
                      <td class="text-left">
                        {{asset_minted.policy_id | truncate}}<CopyButton x-small class="ml-1" :value="asset_minted.policy_id"></CopyButton>
                      </td>
                      <td class="text-left">
                        {{getAssetName(asset_minted, false)}}
                      </td>
                      <td class="text-left">
                        {{getFingerprint(asset_minted) }}<CopyButton x-small class="ml-1" :value="getFingerprint(asset_minted)"></CopyButton>
                      </td>
                      <td class="text-center">
                        {{(Number(asset_minted.quantity) / (asset_minted.decimals ? Math.pow(10, asset_minted.decimals) : 1)).toLocaleString('en-US', {maximumFractionDigits: 6})}}
                      </td>
                    </tr>
                  </tbody>
                </v-simple-table>
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-if="transactionInfo?.withdrawals?.length > 0">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-bank-transfer-out</v-icon>
              </div>
              <h3>Withdrawals ({{transactionInfo.withdrawals.length}})</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat v-for="(withdrawal, index) in transactionInfo.withdrawals" :key="`withdrawal_${index}`">
              <v-card-title>Withdrawal</v-card-title>
              <v-card-text>
                <v-simple-table dense>
                  <tbody>
                  <tr>
                    <td class="text-left grey--text">
                      Stake Address
                    </td>
                    <td class="text-left">
                      {{withdrawal.stake_addr | truncate}}<CopyButton x-small class="ml-1" :value="withdrawal.stake_addr"></CopyButton>
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">
                      Amount
                    </td>
                    <td class="text-left">
                      {{withdrawal.amount | toCurrency}}
                    </td>
                  </tr>
                  </tbody>
                </v-simple-table>
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-if="transactionInfo?.plutus_contracts?.length > 0">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-file-sign</v-icon>
              </div>
              <h3>Contracts ({{transactionInfo.plutus_contracts.length}})</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat v-for="(contract, index) in transactionInfo.plutus_contracts" :key="`contracts_${index}`" class="mb-2">
              <v-card-title>Contract</v-card-title>
              <v-card-subtitle class="text-left">{{contract.address | truncate}}<CopyButton x-small :value="contract.address" class="ml-1"></CopyButton></v-card-subtitle>
              <v-card-title>Redeemer</v-card-title>
              <v-card-text>
                <v-simple-table dense>
                  <tbody>
                  <tr>
                    <td class="text-left grey--text">
                      Type
                    </td>
                    <td class="text-left">
                      {{ contract.input.redeemer.purpose }}
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">
                      Steps
                    </td>
                    <td class="text-left">
                      {{ contract.input.redeemer.unit.steps }}
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">
                      Mem
                    </td>
                    <td class="text-left">
                      {{ contract.input.redeemer.unit.mem }}
                    </td>
                  </tr>
                  </tbody>
                </v-simple-table>
              </v-card-text>
              <v-card-title>Datum</v-card-title>
              <v-card-text>
                <v-simple-table dense>
                  <tbody>
                    <tr>
                      <td class="text-left grey--text">
                        Datum Hash
                      </td>
                      <td class="text-left" style="overflow-wrap: anywhere;">
                        {{ contract.input.datum.hash | truncate }}<CopyButton x-small class="ml-1" :value="contract.input.datum.hash"></CopyButton>
                      </td>
                    </tr>
                    <tr>
                      <td class="text-left grey--text">
                        Contract Bytecode
                      </td>
                      <td class="text-left" style="overflow-wrap: anywhere;">
                        {{ contract.bytecode | truncate }}<CopyButton x-small class="ml-1" :value="contract.bytecode"></CopyButton>
                      </td>
                    </tr>
                  </tbody>
                </v-simple-table>
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-if="false">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="received-arrow-container">
                <v-icon color="#333741">mdi-cash</v-icon>
              </div>
              <h3>Collateral</h3>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">

          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import filters from "@/shared/utils/filters";
import { mapState } from 'pinia';
import { useStore } from '@/store';
import CopyButton from '@/shared/components/CopyButton.vue';
import { resolveAsset } from '@/shared/utils/resolver';
import { unitToFingerprint } from '@/shared/utils/converter';

export default {
  name: 'transactionDetailsDialog',
  components: { CopyButton, BaseDialog },
  props: {
    transactionInfo: {
      type: Object,
      default: null,
    },
  },
  filters,
  computed: {
    ...mapState(useStore, ['network', 'assets', 'resolvedAssets']),
  },
  methods: {
    expand() {
      this.txAssets.push(...this.residue)
      this.isExpanded = true
    },
    async updateTokens(tokens) {
      const assets = await Promise.all(tokens.map(token => resolveAsset(this.assets[token['policy_id']+token['asset_name']], token)));
      this.txAssets = assets.slice(0, 4)
      if (assets?.length > 4) {
        this.residue = assets.slice(4)
      } else {
        this.residue = []
      }
    },
    getAssetName(asset, checkAscii) {
      const ascii = /^[ -~\t\n\r]+$/;
      const assetName = Buffer.from(asset.asset_name, 'hex').toString('ascii');
      if (checkAscii && !ascii.test( assetName ) ) {
        return filters.truncate(unitToFingerprint(asset.policy_id+asset.asset_name))
      }
      return assetName
    },
    getFingerprint(asset) {
      return filters.truncate(unitToFingerprint(asset.policy_id+asset.asset_name))
    },
    getCertificateType(type) {
      switch (type) {
        case "drep_retire": {
          return "DRep De-Registration"
        }
        case "drep_registration": {
          return 'DRep Registrations'
        }
        case "vote_delegation": {
          return 'Vote Delegation'
        }
        case "stake_registration": {
          return 'Stake Registration'
        }
        case "pool_delegation": {
          return 'Pool Delegation'
        }
        case "stake_deregistration": {
          return "Stake De-Registration"
        }
      }
      console.log(type)
      return 'N/A'
    },
  },
  data: () => ({
    txAssets: [],
    residue: [],
    panels: [],
    isExpanded: false,
  }),
  async mounted() {
    console.log(this.transactionInfo)
    await this.updateTokens(this.transactionInfo.assets.filter(asset => asset.policy_id !== ''))
  }
};
</script>
<style scoped >
.transaction-info{

  & > div {
    font-size: 13px;
    color: #cecfd2;
  }

  .value-text{
    color: #FFFFFF;
  }
}
.accordion-container {
  .header-container {
    display: flex;
    align-items: center;
    gap: 15px;

    .received-arrow-container,
    .sent-arrow-container {
      align-items: center;
      justify-content: center;
      display: flex;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(to right, #00c7f3, #00fad5);
    }

    .sent-arrow-container {
      background: linear-gradient(to right, #ad24a8, #df2063);
    }
  }

  .received-text {
    margin-bottom: 10px;
    color: #75e0a7;
    &::before {
      content: '+ ';
    }
  }

  .sent-text {
    margin-bottom: 10px;
    color: rgb(255, 104, 104);
    &::before {
      content: '- ';
    }
  }
}
</style>
