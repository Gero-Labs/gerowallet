<template>
  <v-card-text class="px-0 justify-center text-center" style="z-index: 1">
    <div class="transaction-info text-left pb-4">
      <div style="display: flex">
        Transaction ID:
        <a
          class="ml-1"
          style="color: #00dff3; align-items: center"
          :href="`https://cexplorer.io/tx/${transactionInfo['id']}`"
          target="_blank"
        >
          {{ filters.truncate(transactionInfo['id']) }}</a
        >
        <CopyButton x-small :value="transactionInfo['id']" class="ml-1" />
        <v-spacer />
        <v-btn color="error" x-small outlined @click="isReportDialogOpen = true"> Report Transaction </v-btn>
      </div>
      <div>
        Time: <span class="value-text">{{ new Date(transactionInfo['tx_timestamp'] * 1000)?.toLocaleString() }}</span>
      </div>
      <div>
        Epoch: <span class="value-text">{{ transactionInfo.epoch_no }}</span>
      </div>
      <div>
        Tx Size: <span class="value-text">{{ filters.humanFileSize(transactionInfo['tx_size']) }}</span>
      </div>
      <div>
        Block ID:
        <a style="color: #00dff3" :href="`https://cexplorer.io/block/${transactionInfo['block_hash']}`" target="_blank">
          {{ filters.truncate(transactionInfo['block_hash']) }}</a
        >
        <CopyButton x-small :value="transactionInfo['block_hash']" class="ml-1"></CopyButton>
      </div>
      <div>
        Block Height: <span class="value-text">{{ transactionInfo['block_height']?.toLocaleString('en-US') }}</span>
      </div>
      <div>
        Network Fee: <span style="color: #ff8e8e">{{ filters.toCurrency(transactionInfo.body['fee']) }}</span>
      </div>
      <div style="align-items: center">
        {{ Number(transactionInfo['ada']) > 0 ? 'Received: ' : 'Sent: ' }}
        <span
          :style="{
            color: Number(transactionInfo['ada']) > 0 ? '#00DFF3' : '#FF8E8E',
          }"
        >
          <span style="margin-right: 4px">
            {{ filters.toCurrency(Number(transactionInfo['ada'])) }}
          </span>
        </span>
      </div>
      <div class="pt-2" style="display: flex; width: 100%; align-items: baseline">
        <div v-if="Object.values(receivedAssets)?.length > 0">
          <template v-for="(asset, index) in receivedAssets">
            <v-chip
              pill
              outlined
              style="margin-bottom: 2px"
              class="mr-1"
              :key="`asset_${index}`"
              :color="Number(transactionInfo['ada']) > 0 ? '#00DFF3' : '#FF8E8E'"
            >
              <v-avatar v-if="asset.img" left>
                <v-img :src="asset.img" :alt="`${asset.name} Logo`" contain>
                  <template v-slot:placeholder>
                    <v-row class="fill-height ma-0" align="center" justify="center">
                      <v-progress-circular
                        size="14"
                        width="2"
                        indeterminate
                        color="grey lighten-5"
                      ></v-progress-circular>
                    </v-row>
                  </template>
                </v-img>
              </v-avatar>
              {{
                filters.toCurrency(
                  asset.quantity,
                  false,
                  4,
                  '',
                  ' ' + asset.name,
                  false,
                  asset && asset.metadata && asset.metadata.decimals ? Number(asset.metadata.decimals) : 0
                )
              }}
            </v-chip>
          </template>
          <v-chip color="white" class="px-2" outlined v-if="!isExpanded && residue.length > 0" @click="expand">
            {{ '+' + residue?.length }}
          </v-chip>
          <v-chip color="white" class="px-2" outlined v-else-if="isExpanded" @click="shrink"> Show Less </v-chip>
        </div>
      </div>
    </div>
    <v-expansion-panels v-model="panels" multiple class="accordion-container">
      <v-expansion-panel style="background-color: #1e273ab3">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-bank-transfer</v-icon>
            </div>
            <h3>UTxOs</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card flat class="transparent">
            <v-card-title class="px-0">Inputs ({{ transactionInfo['utxo']['inputs']?.length }})</v-card-title>
            <v-card-text class="px-0">
              <v-simple-table dense style="background-color: transparent">
                <thead class="grey--text">
                  <tr>
                    <td class="text-left">UTxO</td>
                    <td class="text-right">Amount</td>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(input, index) in transactionInfo['utxo']['inputs']" :key="`input_${index}`">
                    <td class="text-left" style="align-content: center">
                      <div style="align-items: center; display: flex">
                        {{ filters.truncate(`${input.tx_hash}#${input.output_index}`) }}
                        <CopyButton
                          v-if="input?.tx_hash && input?.output_index"
                          x-small
                          class="ml-1"
                          :value="`${input.tx_hash}#${input.output_index}`"
                        />
                      </div>
                      <div style="align-items: center; display: flex">
                        {{ filters.truncate(input.address) }}
                        <CopyButton v-if="input?.address" x-small class="ml-1" :value="input.address" />
                      </div>
                    </td>
                    <td class="text-right">
                      <div style="color: #ff8e8e">
                        <v-chip pill class="pl-0" outlined color="#FF8E8E" style="margin: 2px !important">
                          <v-avatar left>
                            <v-img
                              :src="networks.resolveCurrencyImage(loggedWallet.chain, loggedWallet.network)"
                              contain
                            >
                              <template v-slot:placeholder>
                                <v-row class="fill-height ma-0" align="center" justify="center">
                                  <v-progress-circular
                                    size="14"
                                    width="2"
                                    indeterminate
                                    color="grey lighten-5"
                                  ></v-progress-circular>
                                </v-row>
                              </template>
                            </v-img>
                          </v-avatar>
                          {{
                            filters.toCurrency(
                              findLovelace(input.amount),
                              false,
                              6,
                              '',
                              ' ' + networks.resolveCurrencyTicker(loggedWallet.chain, loggedWallet.network),
                              false,
                              6
                            )
                          }}
                        </v-chip>
                      </div>
                      <div>
                        <template v-for="(asset, assetIndex) in txIOAssets(input)">
                          <v-chip
                            pill
                            outlined
                            color="#FF8E8E"
                            class="pl-0"
                            :key="`input_${index}_asset_${assetIndex}`"
                            style="margin: 2px !important"
                          >
                            <v-avatar v-if="asset.img" left>
                              <v-img :src="asset.img" :alt="`${asset.name} Logo`" contain>
                                <template v-slot:placeholder>
                                  <v-row class="fill-height ma-0" align="center" justify="center">
                                    <v-progress-circular
                                      size="14"
                                      width="2"
                                      indeterminate
                                      color="grey lighten-5"
                                    ></v-progress-circular>
                                  </v-row>
                                </template>
                              </v-img>
                            </v-avatar>
                            {{ getAssetChip(asset) }}
                          </v-chip>
                        </template>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
            <v-card-title class="px-0"> Outputs ({{ transactionInfo['utxo']['outputs']?.length }}) </v-card-title>
            <v-card-text class="px-0">
              <v-simple-table dense style="background-color: transparent">
                <thead class="grey--text">
                  <tr>
                    <td class="text-left">UTxO</td>
                    <td class="text-right">Amount</td>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(output, index) in transactionInfo['utxo']['outputs']" :key="`output_${index}`">
                    <td class="text-left" style="align-content: center">
                      <div style="align-items: center; display: flex">
                        {{ filters.truncate(`${transactionInfo['id']}#${output.output_index}`) }}
                        <CopyButton
                          v-if="output?.output_index"
                          x-small
                          class="ml-1"
                          :value="`${transactionInfo['id']}#${output.output_index}`"
                        />
                      </div>
                      <div style="align-items: center; display: flex">
                        {{ filters.truncate(output.address) }}
                        <CopyButton v-if="output?.address" x-small class="ml-1" :value="output.address" />
                      </div>
                    </td>
                    <td class="text-right">
                      <div style="color: #00dff3">
                        <v-chip pill class="pl-0" outlined color="#00DFF3" style="margin: 2px !important">
                          <v-avatar left>
                            <v-img
                              :src="networks.resolveCurrencyImage(loggedWallet.chain, loggedWallet.network)"
                              contain
                            >
                              <template v-slot:placeholder>
                                <v-row class="fill-height ma-0" align="center" justify="center">
                                  <v-progress-circular
                                    size="14"
                                    width="2"
                                    indeterminate
                                    color="grey lighten-5"
                                  ></v-progress-circular>
                                </v-row>
                              </template>
                            </v-img>
                          </v-avatar>
                          {{
                            filters.toCurrency(
                              findLovelace(output.amount),
                              false,
                              6,
                              '',
                              ' ' + networks.resolveCurrencyTicker(loggedWallet.chain, loggedWallet.network),
                              false,
                              6
                            )
                          }}
                        </v-chip>
                      </div>
                      <div>
                        <template v-for="(asset, assetIndex) in txIOAssets(output)">
                          <v-chip
                            pill
                            class="pl-0"
                            outlined
                            color="#00DFF3"
                            :key="`output${index}_asset_${assetIndex}`"
                            style="margin: 2px !important"
                          >
                            <v-avatar v-if="asset.img" left>
                              <v-img :src="asset.img" :alt="`${asset.name} Logo`" contain>
                                <template v-slot:placeholder>
                                  <v-row class="fill-height ma-0" align="center" justify="center">
                                    <v-progress-circular
                                      size="14"
                                      width="2"
                                      indeterminate
                                      color="grey lighten-5"
                                    ></v-progress-circular>
                                  </v-row>
                                </template>
                              </v-img>
                            </v-avatar>
                            {{ getAssetChip(asset) }}
                          </v-chip>
                        </template>
                      </div>
                    </td>
                  </tr>
                </tbody>
                <tfoot class="grey--text">
                  <tr>
                    <td class="text-left">Total Output</td>
                    <td class="text-right">
                      {{ filters.toCurrency(transactionInfo.receivedAmount - transactionInfo.sentAmount, true) }}
                    </td>
                  </tr>
                </tfoot>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo?.body?.certificates?.length > 0">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-certificate-outline</v-icon>
            </div>
            <h3>Certificates ({{ transactionInfo?.body?.certificates?.length }})</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card
            flat
            v-for="(certificate, index) in transactionInfo?.body?.certificates"
            :key="index"
            class="mb-2 transparent"
          >
            <v-card-title>{{ getCertificateType(certificate) }}</v-card-title>
            <v-card-text>
              <v-simple-table dense style="background-color: transparent">
                <tbody>
                  <tr v-if="certificate.stakeCredential?.hash">
                    <td class="text-left grey--text">Stake Credential Hash</td>
                    <td class="text-left">
                      {{ filters.truncate(certificate.stakeCredential.hash) }}
                      <CopyButton
                        v-if="certificate.stakeCredential.hash"
                        x-small
                        class="ml-1"
                        :value="certificate.stakeCredential.hash"
                      />
                    </td>
                  </tr>
                  <tr v-if="getCredentialType(certificate.stakeCredential?.type)">
                    <td class="text-left grey--text">Stake Credential Type</td>
                    <td class="text-left">
                      {{ getCredentialType(certificate.stakeCredential.type) }}
                    </td>
                  </tr>
                  <tr v-if="certificate.poolId">
                    <td class="text-left grey--text">Pool</td>
                    <td class="text-left">
                      <v-list-item class="px-0">
                        <v-list-item-avatar v-if="resolvePoolMeta()?.url_png_icon_64x64">
                          <v-img :src="resolvePoolMeta()?.url_png_icon_64x64" />
                        </v-list-item-avatar>
                        <v-list-item-content>
                          <v-list-item-title>
                            {{ currentPool?.ticker }}
                          </v-list-item-title>
                          <v-list-item-subtitle>
                            {{ filters.truncate(certificate.poolId) }}
                            <CopyButton v-if="certificate.poolId" x-small class="ml-1" :value="certificate.poolId" />
                          </v-list-item-subtitle>
                        </v-list-item-content>
                      </v-list-item>
                    </td>
                  </tr>
                  <tr v-if="certificate.dRep">
                    <td class="text-left grey--text">DRep</td>
                    <td class="text-left">
                      <v-list-item class="px-0">
                        <v-list-item-avatar v-if="currentDRep?.metadata?.meta_json?.body?.image?.contentUrl">
                          <v-img :src="currentDRep?.metadata?.meta_json?.body?.image?.contentUrl">
                            <template v-slot:placeholder>
                              <v-row class="fill-height ma-0" align="center" justify="center">
                                <v-progress-circular
                                  size="14"
                                  width="2"
                                  indeterminate
                                  color="grey lighten-5"
                                ></v-progress-circular>
                              </v-row>
                            </template>
                          </v-img>
                        </v-list-item-avatar>
                        <v-list-item-content>
                          <v-list-item-title>
                            {{ currentDRep?.metadata?.meta_json?.body?.givenName }}
                          </v-list-item-title>
                          <v-list-item-subtitle v-if="currentDRep?.metadata?.meta_json?.body?.givenName">
                            <a href="https://cips.cardano.org/cip/CIP-0105" target="_blank">CIP-105</a>:
                            {{ ` ${filters.truncate(currentDRep?.metadata?.meta_json?.body?.cip105)}` }}
                            <CopyButton
                              v-if="currentDRep?.metadata?.meta_json?.body?.cip105"
                              x-small
                              class="ml-1"
                              :value="currentDRep?.metadata?.meta_json?.body?.cip105"
                            />
                          </v-list-item-subtitle>
                          <v-list-item-subtitle v-if="currentDRep?.metadata?.meta_json?.body?.givenName">
                            <a href="https://cips.cardano.org/cip/CIP-0129" target="_blank">CIP-129</a>:
                            {{ ` ${filters.truncate(currentDRep?.metadata?.meta_json?.body?.cip129)}` }}
                            <CopyButton
                              v-if="currentDRep?.metadata?.meta_json?.body?.cip129"
                              x-small
                              class="ml-1"
                              :value="currentDRep?.metadata?.meta_json?.body?.cip129"
                            />
                          </v-list-item-subtitle>
                        </v-list-item-content>
                      </v-list-item>
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo['auxiliaryData']">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-code-block-tags</v-icon>
            </div>
            <h3>Metadata</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card outlined>
            <v-card-title class="pb-0" style="position: absolute; right: 0">
              <CopyButton :value="getMetadata(transactionInfo)" small></CopyButton>
            </v-card-title>
            <v-card-text class="text-left pa-2" style="font-size: 12px; font-family: monospace !important">
              <pre>{{ JSON.stringify(transactionInfo['auxiliaryData']['blob'], null, 2) }}</pre>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo['assets_minted']?.length > 0">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-code-block-tags</v-icon>
            </div>
            <h3>Assets Minted ({{ transactionInfo['assets_minted']?.length }})</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card flat class="transparent">
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
                  <tr v-for="(asset_minted, index) in transactionInfo['assets_minted']" :key="`asset_minted_${index}`">
                    <td class="text-left">
                      {{ filters.truncate(asset_minted.policy_id)
                      }}<CopyButton
                        v-if="asset_minted"
                        x-small
                        class="ml-1"
                        :value="asset_minted.policy_id"
                      ></CopyButton>
                    </td>
                    <td class="text-left">
                      {{ getAssetName(asset_minted, false) }}
                    </td>
                    <td class="text-left">
                      {{ getFingerprint(asset_minted)
                      }}<CopyButton x-small class="ml-1" :value="getFingerprint(asset_minted)"></CopyButton>
                    </td>
                    <td class="text-center">
                      {{
                        (
                          Number(asset_minted.quantity) /
                          (asset_minted.decimals ? Math.pow(10, asset_minted.decimals) : 1)
                        )?.toLocaleString('en-US', { maximumFractionDigits: 6 })
                      }}
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo?.body?.withdrawals?.length > 0">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-bank-transfer-out</v-icon>
            </div>
            <h3>Withdrawals ({{ transactionInfo?.body?.withdrawals?.length }})</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card
            flat
            class="transparent"
            v-for="(withdrawal, index) in transactionInfo?.body?.withdrawals"
            :key="`withdrawal_${index}`"
          >
            <v-card-title>Withdrawal</v-card-title>
            <v-card-text>
              <v-simple-table dense style="background-color: transparent">
                <tbody>
                  <tr>
                    <td class="text-left grey--text">Stake Address</td>
                    <td class="text-left">
                      {{ filters.truncate(withdrawal.stakeAddress) }}
                      <CopyButton v-if="withdrawal" x-small class="ml-1" :value="withdrawal.stakeAddress"></CopyButton>
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Amount</td>
                    <td class="text-left">
                      {{ filters.toCurrency(withdrawal.quantity) }}
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo.witness?.redeemers?.length > 0">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-file-sign</v-icon>
            </div>
            <h3>Contracts ({{ transactionInfo.witness?.redeemers?.length }})</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card
            flat
            v-for="(redeemer, index) in getRedeemers(transactionInfo.witness.redeemers)"
            :key="`contracts_${index}`"
            class="mb-2 transparent"
          >
            <v-card-title>{{ `Redeemer #${index + 1}` }}</v-card-title>
            <v-card-text>
              <v-simple-table dense style="background-color: transparent">
                <tbody>
                  <tr>
                    <td class="text-left grey--text">Hash</td>
                    <td class="text-left">
                      {{ filters.truncate(redeemer.hash()) }}
                      <CopyButton v-if="redeemer.hash()" x-small class="ml-1" :value="redeemer.hash()"></CopyButton>
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Purpose</td>
                    <td class="text-left">
                      {{ redeemer.toCore().purpose.toUpperCase() }}
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Memory</td>
                    <td class="text-left">
                      {{ filters.humanFileSize(redeemer.exUnits().mem().toString()) }}
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Steps</td>
                    <td class="text-left">
                      {{ Number(redeemer.exUnits().steps().toString()).toLocaleString('en-US') }}
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Data CBOR</td>
                    <td class="text-left">
                      {{ filters.truncate(redeemer.data()?.toCbor()) }}
                      <CopyButton
                        v-if="redeemer.data()?.toCbor()"
                        x-small
                        class="ml-1"
                        :value="redeemer.data()?.toCbor()"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Data Hash</td>
                    <td class="text-left">
                      {{ filters.truncate(redeemer.data().hash()) }}
                      <CopyButton
                        v-if="redeemer.data().hash()"
                        x-small
                        class="ml-1"
                        :value="redeemer.data().hash()"
                      ></CopyButton>
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Data JSON</td>
                    <td class="text-left">
                      <v-card outlined class="my-1">
                        <v-card-title class="pb-0" style="position: absolute; right: 0">
                          <CopyButton :value="getRedeemerDataJson(redeemer.data().toCore())" small></CopyButton>
                        </v-card-title>
                        <v-card-text class="text-left pa-2" style="font-size: 12px; font-family: monospace !important">
                          <pre>{{ getRedeemerDataJson(redeemer.data().toCore()) }}</pre>
                        </v-card-text>
                      </v-card>
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo.body?.collaterals">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-cash</v-icon>
            </div>
            <h3>Collateral</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card
            flat
            v-for="(collateral, index) in transactionInfo.body?.collaterals"
            :key="`collateral_${index}`"
            class="mb-2 transparent"
          >
            <v-card-title>{{ `Collateral #${index + 1}` }}</v-card-title>
            <v-card-text>
              <v-simple-table dense style="background-color: transparent">
                <tbody>
                  <tr>
                    <td class="text-left grey--text">Tx Id</td>
                    <td class="text-left">
                      {{ filters.truncate(collateral.txId) }}
                      <CopyButton v-if="collateral.txId" x-small class="ml-1" :value="collateral.txId"></CopyButton>
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
          <v-card flat class="transparent" v-if="transactionInfo.body?.collateralReturn">
            <v-card-title>{{ `Collateral Return` }}</v-card-title>
            <v-card-text>
              <v-simple-table dense style="background-color: transparent">
                <tbody>
                  <tr>
                    <td class="text-left grey--text">Address</td>
                    <td class="text-left">
                      {{ filters.truncate(transactionInfo.body.collateralReturn.address) }}
                      <CopyButton
                        v-if="transactionInfo.body.collateralReturn.address"
                        x-small
                        class="ml-1"
                        :value="transactionInfo.body.collateralReturn.address"
                      ></CopyButton>
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Amount</td>
                    <td class="text-left">
                      {{ filters.toCurrency(transactionInfo.body.collateralReturn.value.coins) }}
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel style="background-color: #1e273ab3" v-if="transactionInfo.body?.referenceInputs">
        <v-expansion-panel-header>
          <div class="header-container">
            <div class="received-arrow-container">
              <v-icon color="#333741">mdi-clipboard-list-outline</v-icon>
            </div>
            <h3>Reference Inputs</h3>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content class="content-container">
          <v-card flat class="mb-2 transparent">
            <v-card-text>
              <v-simple-table dense style="background-color: transparent">
                <tbody
                  v-for="(referenceInput, index) in transactionInfo.body?.referenceInputs"
                  :key="`reference_inputs_${index}`"
                >
                  <tr>
                    <td class="text-left grey--text">Tx Id</td>
                    <td class="text-left">
                      {{ filters.truncate(referenceInput.txId) }}
                      <CopyButton
                        v-if="referenceInput.txId"
                        x-small
                        class="ml-1"
                        :value="referenceInput.txId"
                      ></CopyButton>
                    </td>
                  </tr>
                  <tr>
                    <td class="text-left grey--text">Index</td>
                    <td class="text-left">
                      {{ referenceInput.index }}
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card-text>
          </v-card>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
    <ReportDialog :isOpen="isReportDialogOpen" @close="isReportDialogOpen = false" :reportTx="transactionInfo['id']" />
  </v-card-text>
</template>
<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import { resolveAsset } from '@/shared/utils/resolver';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Buffer } from 'buffer';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import governanceStoreActions from '@/stores/governanceStore';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import stakingStoreActions from '@/stores/stakingStore';

interface Props {
  transactionInfo: any;
}

const props = defineProps<Props>();

const { loggedWallet } = toRefs(walletStore);
const { currentDRep } = toRefs(governanceStoreActions.state);
const { currentPool } = toRefs(stakingStoreActions.state);

const residue = ref<any[]>([]);
const panels = ref<any[]>([]);
const isExpanded = ref<boolean>(false);
const isReportDialogOpen = ref<boolean>(false);

function findLovelace(io: { unit: string; quantity: number }[]) {
  const tok = io.find(t => t.unit === 'lovelace');
  return tok ? tok.quantity : 0;
}

const getRedeemers = (redeemers: Cardano.Redeemer[]) => {
  return redeemers.map(redeemer => {
    return Serialization.Redeemer.fromCore(redeemer);
  });
};

const getRedeemerDataJson = (redeemerData: Cardano.PlutusData) => {
  return JSON.stringify(
    redeemerData,
    (_key, value) => {
      if (value instanceof Map) {
        return Array.from(value.entries()).reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      } else if (typeof value === 'bigint') {
        return value.toString();
      } else {
        return value;
      }
    },
    2
  );
};

const getAssetName = (unit: string, checkAscii: boolean) => {
  const assetNameHex = Cardano.AssetId.getAssetName(Cardano.AssetId(unit));
  const policyId = Cardano.AssetId.getPolicyId(Cardano.AssetId(unit));
  try {
    return Cardano.AssetName.toUTF8(assetNameHex, true);
  } catch (e) {
    const ascii = /^[ -~\t\n\r]+$/;
    const assetName = Buffer.from(assetNameHex, 'hex').toString('ascii');
    if (checkAscii && !ascii.test(assetName)) {
      return filters.truncate(Cardano.AssetFingerprint.fromParts(policyId, assetNameHex));
    }
    return assetName;
  }
};

const getCredentialType = (type: Cardano.CredentialType) => {
  switch (type) {
    case Cardano.CredentialType.KeyHash:
      return 'Key Hash';
    case Cardano.CredentialType.ScriptHash:
      return 'Script Hash';
    default:
      return null;
  }
};

const getDRepCip129 = (drep: Cardano.DelegateRepresentative) => {
  const drepS: Serialization.DRep = Serialization.DRep.fromCore(drep);
  switch (drepS.kind()) {
    case Serialization.DRepKind.KeyHash:
      return Cardano.DRepID.cip129FromCredential({
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(drepS.toKeyHash()),
      });
    case Serialization.DRepKind.ScriptHash:
      return Cardano.DRepID.cip129FromCredential({
        type: Cardano.CredentialType.ScriptHash,
        hash: drepS.toScriptHash(),
      });
    default:
      return 'N/A';
  }
};

const txIOAssets = (io: any) => {
  return io.amount
    .filter((token: any) => token.unit !== 'lovelace')
    .map((asset: any) => {
      let resolvedAsset = txAssets.value[asset.unit];
      if (!resolvedAsset) {
        resolvedAsset = resolveAsset(asset);
      }
      resolvedAsset.quantity = asset.quantity;
      return resolvedAsset;
    });
};

const getAssetChip = (asset: any) => {
  return filters.toCurrency(
    asset.quantity,
    false,
    6,
    '',
    ` ${asset.name}`,
    false,
    asset.metadata?.decimals ? asset.metadata.decimals : 0
  );
};

const getMetadata = (transactionInfo: any) => {
  return JSON.stringify(
    Serialization.Transaction.fromCbor(transactionInfo.cbor).auxiliaryData().metadata().toCore(),
    (_key, value) => {
      if (value instanceof Map) {
        return Array.from(value.entries()).reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      } else if (typeof value === 'bigint') {
        return value.toString();
      } else {
        return value;
      }
    },
    2
  );
};

const getFingerprint = (asset: any) => {
  return filters.truncate(Cardano.AssetFingerprint.fromParts(asset.policy_id, asset.asset_name));
};

const txAssets = computed(() => {
  if (props.transactionInfo) {
    return [...props.transactionInfo['receivedAssets'], ...props.transactionInfo['sentAssets']]
      .filter((asset: any) => asset.policy_id !== '')
      .reduce((map: Record<string, any>, asset: any) => {
        map[asset.unit] = resolveAsset(asset);
        return map;
      }, {});
  } else {
    return {};
  }
});

const receivedAssets = computed(() => {
  const assts = props.transactionInfo['assets']
    .filter((asset: any) => asset.policy_id !== '')
    .map((asset: any) => {
      const res = structuredClone(txAssets.value[asset.unit]);
      if (res) {
        res.quantity = asset.quantity;
      }
      return res;
    })
    .filter((asset: any) => asset);
  const asstsResolved = !isExpanded.value ? assts.slice(0, 2) : assts;
  residue.value = assts.slice(2);
  return asstsResolved;
});

const getCertificateType = (certificate: Cardano.Certificate) => {
  const certificateType: Cardano.CertificateType = certificate.__typename;
  switch (certificateType) {
    case Cardano.CertificateType.StakeRegistration:
      return 'Stake Registration';
    case Cardano.CertificateType.StakeDeregistration:
      return 'Stake De-Registration';
    case Cardano.CertificateType.PoolRegistration:
      return 'Pool Registration';
    case Cardano.CertificateType.PoolRetirement:
      return 'Pool Retirement';
    case Cardano.CertificateType.StakeDelegation:
      return 'Stake Delegation';
    case Cardano.CertificateType.MIR:
      return 'MIR';
    case Cardano.CertificateType.GenesisKeyDelegation:
      return 'Genesis Key Delegation';
    case Cardano.CertificateType.Registration:
      return 'Registration';
    case Cardano.CertificateType.Unregistration:
      return 'Unregistration';
    case Cardano.CertificateType.VoteDelegation:
      return 'Vote Delegation';
    case Cardano.CertificateType.StakeVoteDelegation:
      return 'Stake Vote Delegation';
    case Cardano.CertificateType.StakeRegistrationDelegation:
      return 'Stake Registration Delegation';
    case Cardano.CertificateType.VoteRegistrationDelegation:
      return 'Vote Registration Delegation';
    case Cardano.CertificateType.StakeVoteRegistrationDelegation:
      return 'Stake Vote Registration Delegation';
    case Cardano.CertificateType.AuthorizeCommitteeHot:
      return 'Authorize Committee Hot';
    case Cardano.CertificateType.ResignCommitteeCold:
      return 'Resign Committee Cold';
    case Cardano.CertificateType.RegisterDelegateRepresentative:
      return 'Register Delegate Representative';
    case Cardano.CertificateType.UnregisterDelegateRepresentative:
      return 'Unregister Delegate Representative';
    case Cardano.CertificateType.UpdateDelegateRepresentative:
      return 'Update Delegate Representative';
    default:
      return 'N/A';
  }
};

const expand = () => {
  isExpanded.value = true;
};
const shrink = () => {
  isExpanded.value = false;
};

watch(
  () => props.transactionInfo,
  async () => {
    const value = props.transactionInfo;
    if (!value) return;
    const dRep = value.body?.certificates?.find((certificate: any) => certificate.dRep)?.dRep;
    const poolId = value.body?.certificates?.find((certificate: any) => certificate.poolId)?.poolId;

    if (dRep) {
      const drepId = getDRepCip129(dRep);
      await governanceStoreActions.loadDRepById(loggedWallet.value, drepId.toString());
    }
    if (poolId) {
      await stakingStoreActions.loadPoolById(loggedWallet.value, poolId);
    }
  },
  { immediate: true }
);

const resolvePoolMeta = () => {
  const pool = currentPool.value;
  if (pool) {
    return JSON.parse(pool.pool_extended_info)?.info;
  }
  return '';
};
</script>
<style scoped>
.transaction-info {
  & > div {
    font-size: 13px;
    color: #cecfd2;
  }

  .value-text {
    color: #ffffff;
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
<style scoped lang="scss">
tbody {
  tr:hover {
    background-color: transparent !important;
  }
}
.v-application--is-ltr .v-chip--pill .v-avatar--left {
  margin-left: 0;
}
</style>
