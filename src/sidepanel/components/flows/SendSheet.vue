<template>
  <BottomSheet :model-value="modelValue" @update:model-value="onClose" :title="sheetTitle" height="92%" persistent :close-disabled="broadcasting">
    <div class="send-stepper" ref="stepperEl">

      <!-- ═══════ SUCCESS OVERLAY ═══════ -->
      <div v-if="txSuccess" class="success-overlay">
        <v-icon size="56" color="success">mdi-check-circle</v-icon>
        <div class="text-h6 white--text mt-3">{{ $t('miniGero.txSubmitted') }}</div>
        <div class="text-caption grey--text mt-1 text-center">{{ $t('miniGero.txSubmittedDesc') }}</div>
        <div v-if="txId" class="tx-id-box mt-4" @click="copyTxId">
          <span class="text-caption grey--text">{{ truncateAddr(txId) }}</span>
          <v-icon size="x-small" :color="primaryColor" class="ml-1">mdi-content-copy</v-icon>
        </div>
        <v-btn block :color="primaryColor" class="black--text font-weight-bold mt-6" @click="onClose(false)">
          {{ $t('miniGero.done') }}
        </v-btn>
      </div>

      <template v-else>
        <!-- ═══════ STEP 1: RECIPIENT ═══════ -->
        <div class="stepper-step" :class="{ active: step === 1, done: step > 1 }">
          <div class="step-header" @click="editStep(1)">
            <div class="step-circle" :class="step > 1 ? 'done' : step === 1 ? 'active' : ''">
              <v-icon v-if="step > 1" size="x-small" color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>1</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('miniGero.recipientAddress') }}</span>
              <span v-if="step > 1" class="step-summary">{{ handleName || truncateAddr(paymentAddress) }}</span>
            </div>
            <v-btn v-if="step > 1 && !submitting" icon variant="text" size="x-small" @click.stop="editStep(1)">
              <v-icon size="small" :color="primaryColor">mdi-pencil</v-icon>
            </v-btn>
          </div>

          <v-expand-transition>
            <div v-show="step === 1" class="step-body">
              <!-- Quick actions row -->
              <div class="quick-row">
                <v-btn size="small" variant="outlined" color="var(--g-hairline-3)" class="quick-btn" @click="showContacts = !showContacts" :disabled="!hasContacts">
                  <v-icon size="x-small" :color="primaryColor" class="mr-1">mdi-book-open-variant-outline</v-icon>
                  {{ $t('miniGero.contacts') }}
                </v-btn>
                <v-btn size="small" variant="outlined" color="var(--g-hairline-3)" class="quick-btn" @click="showQR = true">
                  <v-icon size="x-small" :color="primaryColor" class="mr-1">mdi-qrcode</v-icon>
                  {{ $t('wallet.qrScan') }}
                </v-btn>
                <v-btn size="small" variant="outlined" color="var(--g-hairline-3)" class="quick-btn" @click="pasteFromClipboard">
                  <v-icon size="x-small" :color="primaryColor" class="mr-1">mdi-content-paste</v-icon>
                  {{ $t('common.paste') }}
                </v-btn>
              </div>

              <!-- Address input -->
              <v-textarea
                v-model="address"
                :placeholder="isMainnet ? $t('wallet.enterRecipientOrHandle') : $t('wallet.enterRecipientAddress')"
                variant="outlined"
                density="compact"
                theme="dark"
                rows="2"
                no-resize
                hide-details="auto"
                :error-messages="addressError"
                class="mini-input mt-2"
                :loading="handleLoading"
                @update:model-value="onAddressInput"
              >
                <template v-slot:append-inner>
                  <v-progress-circular v-if="handleLoading" size="18" width="2" indeterminate :color="primaryColor" />
                  <v-icon v-else-if="handleResolved === false" color="error" size="small">mdi-alert</v-icon>
                  <v-icon v-else-if="handleResolved === true" color="success" size="small">mdi-check-circle</v-icon>
                </template>
              </v-textarea>

              <!-- Handle resolution display -->
              <div v-if="handleResolved && handleAsset" class="handle-display mt-2">
                <v-avatar v-if="handleAsset.img" size="28" class="mr-2">
                  <img :src="handleAsset.img" />
                </v-avatar>
                <div class="handle-info">
                  <span class="white--text text-body-2">{{ handleAsset.name }}</span>
                  <span class="grey--text text-caption">{{ truncateAddr(paymentAddress) }}</span>
                </div>
              </div>

              <!-- Contacts list -->
              <v-expand-transition>
                <div v-show="showContacts && hasContacts" class="contacts-list mt-2">
                  <div
                    v-for="contact in contactsList"
                    :key="contact.address"
                    class="contact-row"
                    @click="selectContact(contact)"
                  >
                    <v-avatar size="28" color="var(--g-hairline-1)" class="mr-2">
                      <v-icon size="14" color="var(--g-text-3)">mdi-account</v-icon>
                    </v-avatar>
                    <div class="contact-info">
                      <span class="white--text text-body-2">{{ contact.name }}</span>
                      <span class="grey--text text-caption">{{ truncateAddr(contact.address) }}</span>
                    </div>
                  </div>
                </div>
              </v-expand-transition>

              <v-btn block :color="primaryColor" class="black--text font-weight-bold mt-4" :disabled="!isAddressValid" @click="goToStep(2)">
                {{ $t('common.continue') }}
              </v-btn>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 2: ASSETS ═══════ -->
        <div class="stepper-step" :class="{ active: step === 2, done: step > 2, locked: step < 2 }">
          <div class="step-header" @click="editStep(2)">
            <div class="step-circle" :class="step > 2 ? 'done' : step === 2 ? 'active' : ''">
              <v-icon v-if="step > 2" size="x-small" color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>2</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('wallet.assetsToSend') }}</span>
              <span v-if="step > 2" class="step-summary">{{ assetsSummary }}</span>
            </div>
            <v-btn v-if="step > 2 && !submitting" icon variant="text" size="x-small" @click.stop="editStep(2)">
              <v-icon size="small" :color="primaryColor">mdi-pencil</v-icon>
            </v-btn>
          </div>

          <v-expand-transition>
            <div v-show="step === 2" class="step-body">
              <!-- ADA amount (pinned) -->
              <div class="asset-input-section ada-primary">
                <div class="asset-input-header">
                  <v-avatar size="28" class="mr-2">
                    <img :src="assetsUtil.cardanoBlueLogo" alt="ADA" />
                  </v-avatar>
                  <span class="white--text text-body-1 font-weight-bold">ADA</span>
                  <v-spacer />
                  <span class="grey--text text-caption">{{ $t('miniGero.available') }}: {{ formatBalance(adaBalance) }}</span>
                </div>
                <div class="amount-row">
                  <v-text-field
                    v-model="adaAmount"
                    type="number"
                    variant="outlined"
                    density="compact"
                    theme="dark"
                    hide-details="auto"
                    :error-messages="adaError"
                    class="mini-input amount-field"
                    placeholder="0.00"
                    step="0.1"
                    min="0"
                  />
                  <v-btn size="x-small" variant="text" :color="primaryColor" class="max-btn" @click="setAdaMax">
                    {{ $t('miniGero.max') }}
                  </v-btn>
                </div>
                <div
                  v-if="minAda > 0 && (parseFloat(adaAmount) || 0) < minAda"
                  class="text-caption mt-1 min-ada-hint"
                  @click="fillMinAda"
                >
                  {{ $t('wallet.minAdaRequired', { amount: minAda.toFixed(2) }) }}
                </div>
              </div>

              <!-- Additional tokens -->
              <div v-for="(token, idx) in extraTokens" :key="token.unit" class="asset-input-section mt-2">
                <div class="asset-input-header">
                  <v-avatar size="24" class="mr-2">
                    <img v-if="token.img" :src="getTokenImg(token)" :alt="token.ticker" />
                    <v-icon v-else size="16" color="var(--g-text-3)">mdi-circle-outline</v-icon>
                  </v-avatar>
                  <span class="white--text text-body-2 font-weight-bold">{{ token.ticker || token.name }}</span>
                  <v-spacer />
                  <span class="grey--text text-caption">{{ formatTokenBalance(token) }}</span>
                  <v-btn icon variant="text" size="x-small" class="ml-1" @click="removeExtraToken(idx)">
                    <v-icon size="small" color="error">mdi-close</v-icon>
                  </v-btn>
                </div>
                <div class="amount-row">
                  <v-text-field
                    v-model="token.sendAmount"
                    type="number"
                    variant="outlined"
                    density="compact"
                    theme="dark"
                    hide-details="auto"
                    class="mini-input amount-field"
                    placeholder="0"
                    step="1"
                    min="0"
                  />
                  <v-btn size="x-small" variant="text" :color="primaryColor" class="max-btn" @click="setTokenMax(idx)">
                    {{ $t('miniGero.max') }}
                  </v-btn>
                </div>
              </div>

              <!-- Add Token button -->
              <v-btn v-if="availableTokens.length > 0" size="small" variant="text" :color="primaryColor" class="mt-2" @click="showTokenPicker = !showTokenPicker">
                <v-icon size="small" class="mr-1">mdi-plus</v-icon>
                {{ $t('assets.addToken') }}
              </v-btn>

              <!-- Token picker -->
              <v-expand-transition>
                <div v-show="showTokenPicker" class="token-picker mt-1">
                  <v-text-field
                    v-model="tokenSearch"
                    :placeholder="$t('assets.searchAssets')"
                    variant="outlined"
                    density="compact"
                    theme="dark"
                    hide-details
                    class="mini-input mb-1"
                    prepend-inner-icon="mdi-magnify"
                    clearable
                  />
                  <div class="token-picker-list">
                    <div
                      v-for="token in filteredAvailableTokens"
                      :key="token.unit"
                      class="token-picker-item"
                      @click="addToken(token)"
                    >
                      <v-avatar size="24" class="mr-2">
                        <img v-if="token.img" :src="getTokenImg(token)" />
                        <v-icon v-else size="14" color="var(--g-text-3)">mdi-circle-outline</v-icon>
                      </v-avatar>
                      <span class="white--text text-body-2">{{ token.ticker || token.name }}</span>
                      <v-spacer />
                      <span class="grey--text text-caption">{{ formatTokenBalance(token) }}</span>
                    </div>
                    <div v-if="filteredAvailableTokens.length === 0" class="text-caption grey--text text-center pa-3">
                      {{ $t('miniGero.noTokens') }}
                    </div>
                  </div>
                </div>
              </v-expand-transition>

              <!-- NFTs/Collectibles -->
              <div v-if="collectiblesList.length > 0" class="nft-section mt-3">
                <v-btn size="small" variant="text" :color="primaryColor" @click="showNfts = !showNfts">
                  <v-icon size="small" class="mr-1">{{ showNfts ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
                  {{ $t('assets.chooseCollectibles') }} ({{ collectiblesList.length }})
                  <span v-if="selectedNfts.length > 0" class="ml-1 nft-badge">{{ selectedNfts.length }}</span>
                </v-btn>
                <v-expand-transition>
                  <div v-show="showNfts" class="nft-list-container mt-1">
                    <!-- Search -->
                    <v-text-field
                      v-model="nftSearch"
                      :placeholder="$t('assets.searchAssets')"
                      variant="outlined"
                      density="compact"
                      theme="dark"
                      hide-details
                      class="mini-input mb-1"
                      prepend-inner-icon="mdi-magnify"
                      clearable
                    />
                    <!-- Scrollable list -->
                    <div class="nft-list" ref="nftListEl">
                      <div
                        v-for="nft in visibleNfts"
                        :key="nft.unit"
                        class="nft-list-item"
                        :class="{ selected: isNftSelected(nft) }"
                        @click="toggleNft(nft)"
                      >
                        <div class="nft-thumb">
                          <img v-if="nft.img" :src="nft.img" loading="lazy" />
                          <v-icon v-else size="20" color="var(--g-text-3)">mdi-image</v-icon>
                        </div>
                        <div class="nft-item-info">
                          <span class="nft-item-name">{{ nft.name || 'NFT' }}</span>
                          <span v-if="nft.collection" class="nft-item-collection">{{ nft.collection }}</span>
                        </div>
                        <v-icon v-if="isNftSelected(nft)" size="18" :color="primaryColor">mdi-check-circle</v-icon>
                        <v-icon v-else size="18" color="var(--g-text-3)">mdi-circle-outline</v-icon>
                      </div>
                      <!-- Sentinel for infinite scroll -->
                      <div v-if="nftDisplayCount < filteredNfts.length" ref="nftSentinelEl" class="nft-sentinel">
                        <v-progress-circular indeterminate size="20" width="2" :color="primaryColor" />
                      </div>
                      <div v-if="filteredNfts.length === 0" class="text-caption grey--text text-center pa-3">
                        {{ $t('miniGero.noTokens') }}
                      </div>
                    </div>
                  </div>
                </v-expand-transition>
              </div>

              <div class="step-actions-row mt-4">
                <v-btn variant="text" size="small" color="var(--g-text-3)" @click="editStep(1)">{{ $t('miniGero.back') }}</v-btn>
                <v-btn :color="primaryColor" class="black--text font-weight-bold flex-grow-1 ml-2" :disabled="!isAssetsValid" :loading="buildingTx" @click="goToStep(3)">
                  {{ $t('miniGero.review') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 3: REVIEW ═══════ -->
        <div class="stepper-step" :class="{ active: step === 3, done: step > 3, locked: step < 3 }">
          <div class="step-header" @click="editStep(3)">
            <div class="step-circle" :class="step > 3 ? 'done' : step === 3 ? 'active' : ''">
              <v-icon v-if="step > 3" size="x-small" color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>3</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('wallet.summary') }}</span>
            </div>
          </div>

          <v-expand-transition>
            <div v-show="step === 3" class="step-body">
              <div class="review-card">
                <div class="review-row">
                  <span class="detail-label">{{ $t('miniGero.to') }}</span>
                  <span class="detail-value">{{ handleName || truncateAddr(paymentAddress) }}</span>
                </div>
                <div class="review-row">
                  <span class="detail-label">ADA</span>
                  <span class="detail-value white--text font-weight-bold">{{ adaAmount || '0' }} ₳</span>
                </div>
                <div v-for="token in extraTokens" :key="'r-' + token.unit" class="review-row">
                  <span class="detail-label">{{ token.ticker || token.name }}</span>
                  <span class="detail-value white--text">{{ token.sendAmount || '0' }}</span>
                </div>
                <div v-for="nft in selectedNfts" :key="'rn-' + nft.unit" class="review-row">
                  <span class="detail-label">{{ nft.name || 'NFT' }}</span>
                  <span class="detail-value white--text">×{{ nft.toSendQuantity || 1 }}</span>
                </div>
                <div class="review-row" style="border-top: 1px solid var(--g-hairline-1); margin-top: 4px; padding-top: 12px;">
                  <span class="detail-label">{{ $t('miniGero.fee') }}</span>
                  <span class="detail-value fee-text">{{ txFeeDisplay }}</span>
                </div>
              </div>

              <div v-if="txBuildError" class="text-caption mt-2" style="color: var(--g-error)">
                {{ txBuildError }}
              </div>

              <div class="step-actions-row mt-4">
                <v-btn variant="text" size="small" color="var(--g-text-3)" @click="editStep(2)">{{ $t('miniGero.back') }}</v-btn>
                <v-btn :color="primaryColor" class="black--text font-weight-bold flex-grow-1 ml-2" :disabled="!txBuilt" @click="goToStep(4)">
                  {{ $t('miniGero.confirmSend') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 4: CONFIRM ═══════ -->
        <div class="stepper-step" :class="{ active: step === 4, locked: step < 4 }">
          <div class="step-header">
            <div class="step-circle" :class="step === 4 ? 'active' : ''">
              <span>4</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('miniGero.confirmSend') }}</span>
            </div>
          </div>

          <v-expand-transition>
            <div v-show="step === 4" class="step-body">
              <!-- ── Normal wallet (password) ── -->
              <template v-if="isNormalWallet && !isPrfWallet">
                <div class="text-caption grey--text mb-2">{{ $t('miniGero.spendingPassword') }}</div>
                <v-text-field
                  v-model="spendingPassword"
                  :type="showPassword ? 'text' : 'password'"
                  variant="outlined"
                  density="compact"
                  theme="dark"
                  hide-details="auto"
                  :error-messages="passwordError"
                  class="mini-input"
                  :placeholder="$t('miniGero.enterPassword')"
                  :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                  @click:append-inner="showPassword = !showPassword"
                  @keydown.enter="signAndSubmit"
                />
                <v-btn
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold mt-4"
                  :disabled="!spendingPassword || submitting || requiresRemoteForSend"
                  :loading="submitting"
                  @click="signAndSubmit"
                >
                  <v-icon start size="small">mdi-send</v-icon>
                  {{ $t('miniGero.confirmSend') }}
                </v-btn>
                <div v-if="requiresRemoteForSend" class="text-caption grey--text text-center mt-2">
                  {{ $t('crossDevice.settings.policyRequireHint') }}
                </div>
                <v-btn
                  v-if="canSignOnAnotherDevice"
                  block
                  variant="outlined"
                  :color="primaryColor"
                  class="font-weight-bold mt-3"
                  :disabled="submitting"
                  :loading="submitting"
                  @click="signOnAnotherDevice()"
                >
                  <v-icon start size="small">mdi-cellphone-link</v-icon>
                  {{ $t('crossDevice.signOnAnotherDevice') }}
                </v-btn>
              </template>

              <!-- ── PRF wallet (PassKey) ── -->
              <template v-else-if="isNormalWallet && isPrfWallet">
                <div class="hw-notice">
                  <v-icon size="40" :color="primaryColor" class="mb-2">mdi-fingerprint</v-icon>
                  <div class="text-body-2 white--text text-center mb-3">{{ $t('miniGero.prfAuthPrompt') }}</div>
                </div>
                <PassKeyAuthButton
                  v-if="!txWitnesses"
                  :disabled="submitting || requiresRemoteForSend"
                  @success="onPassKeySuccess"
                  @error="onPassKeyError"
                  class="mb-2"
                  style="width: 100%"
                />
                <v-btn
                  v-else
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold"
                  :loading="submitting"
                  @click="submitSignedTx"
                >
                  <v-icon start size="small">mdi-send</v-icon>
                  {{ $t('miniGero.confirmSend') }}
                </v-btn>
                <div v-if="requiresRemoteForSend" class="text-caption grey--text text-center mt-2">
                  {{ $t('crossDevice.settings.policyRequireHint') }}
                </div>
              </template>

              <!-- ── Ledger wallet ── -->
              <template v-else-if="walletType === WalletType.Ledger">
                <div class="hw-notice">
                  <v-icon size="40" :color="primaryColor" class="mb-2">mdi-usb</v-icon>
                  <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectLedger') }}</div>
                  <div v-if="loggedWallet?.btSupported" class="d-flex align-center justify-center mb-2" style="gap: 8px;">
                    <v-btn size="x-small" :variant="isBT ? 'outlined' : 'elevated'" :color="!isBT ? primaryColor : 'var(--g-text-3)'" class="black--text" @click="isBT = false">
                      <v-icon size="x-small" class="mr-1">mdi-usb</v-icon> USB
                    </v-btn>
                    <v-btn size="x-small" :variant="!isBT ? 'outlined' : 'elevated'" :color="isBT ? primaryColor : 'var(--g-text-3)'" class="black--text" @click="isBT = true">
                      <v-icon size="x-small" class="mr-1">mdi-bluetooth</v-icon> BT
                    </v-btn>
                  </div>
                </div>
                <v-btn
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold"
                  :disabled="submitting"
                  :loading="submitting"
                  @click="signLedger"
                >
                  <v-icon start size="small">mdi-draw</v-icon>
                  {{ $t('wallet.sign') }}
                </v-btn>
              </template>

              <!-- ── Trezor wallet ── -->
              <template v-else-if="walletType === WalletType.Trezor">
                <div class="hw-notice">
                  <v-icon size="40" :color="primaryColor" class="mb-2">mdi-shield-check-outline</v-icon>
                  <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.connectTrezor') }}</div>
                </div>
                <v-btn
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold"
                  :disabled="submitting"
                  :loading="submitting"
                  @click="signTrezor"
                >
                  <v-icon start size="small">mdi-draw</v-icon>
                  {{ $t('wallet.sign') }}
                </v-btn>
              </template>

              <!-- ── Keystone wallet ── -->
              <template v-else-if="walletType === WalletType.Keystone">
                <div class="hw-notice">
                  <v-icon size="40" :color="primaryColor" class="mb-2">mdi-qrcode</v-icon>
                  <div class="text-body-2 white--text text-center mb-2">{{ $t('miniGero.keystoneSign') }}</div>
                </div>
                <v-btn
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold"
                  :disabled="submitting"
                  :loading="submitting"
                  @click="signKeystone"
                >
                  <v-icon start size="small">mdi-qrcode-scan</v-icon>
                  {{ $t('wallet.sign') }}
                </v-btn>
              </template>

              <!-- Sign error display -->
              <div v-if="passwordError" class="text-caption mt-2" style="color: var(--g-error)">
                {{ passwordError }}
              </div>

              <div class="step-actions-row mt-3">
                <v-btn variant="text" size="small" color="var(--g-text-3)" block @click="editStep(3)">{{ $t('miniGero.back') }}</v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>
      </template>
    </div>

    <!-- QR Scanner Dialog -->
    <QRAddressScannerDialog
      :isOpen="showQR"
      :chain="loggedWallet?.chain"
      :network="loggedWallet?.network"
      @close="showQR = false"
      @scan="onQRScan"
    />

    <!-- Keystone sign sheet -->
    <KeystoneSignSheet
      :isOpen="showKeystoneDialog"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @close="closeKeystone"
    />
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, toRefs, shallowRef, onScopeDispose, provide } from 'vue';
import debounce from 'lodash/debounce';
import BottomSheet from '../BottomSheet.vue';
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { nexusTxApi, walletUtxosToNexusInputs, txOutToNexusOutput, requiredAssetsFromOutputs, type BuildTxRequest } from '@/api/nexus-tx-api';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { computeMinimumCoinQuantity } from '@cardano-sdk/tx-construction';
import { Messaging, BackgroundResponse, VerifyPasswordResponse, SignTxResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { applyTokenImageOverride } from '@/shared/utils/resolver';
import { Blockchain, Network, WalletType } from '@/models/types';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import KeystoneSignSheet from '../KeystoneSignSheet.vue';
import ledgerUtils from '@/shared/utils/ledger';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import { UR } from '@keystonehq/keystone-sdk';
import adaHandleApi from '@/api/ada-handle.api';
import assetsUtil from '@/utils/assets';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import i18n from '@/plugins/i18n';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { remoteSigningStore } from '@/stores/remoteSigningStore';
import { useChainContext } from '../../composables/useChainContext';
import { useApprovalFreshness, awaitFreshApproval, StaleApprovalError } from '@/shared/composables/useApprovalFreshness';
import { authorizationScopeKey } from '@/shared/composables/authorizationScope';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { loggedWallet, utxos, tokens: resolvedAssets, keys, contacts, collections: resolvedCollections, config: _config } = toRefs(walletStore);
const { tip, epochParams } = toRefs(networkStore);

// walletStore exposes `tokens` / `collections` as untyped bags, and contacts carry
// two historical field spellings. These describe only what this flow reads.
interface WalletTokenRow {
  unit?: string;
  name?: string;
  ticker?: string;
  img?: string;
  quantity?: string | number;
  policy_id?: string;
  verified?: boolean;
  isScam?: boolean;
  metadata?: { name?: string; ticker?: string; decimals?: number };
}

/** A token as the picker and the review list render it, plus the amount being sent. */
interface SendToken extends WalletTokenRow {
  balance?: string | number;
  decimals?: number;
  sendAmount?: string;
}

interface NftRow {
  unit?: string;
  name?: string;
  img?: string;
  collection?: string;
  toSendQuantity?: number;
}

interface CollectionRow {
  name?: string;
  items?: NftRow[];
}

interface ContactRow {
  name?: string;
  label?: string;
  address?: string;
  addr?: string;
}

/** Resolved $handle shown next to the recipient field. */
interface HandleAsset {
  name: string;
  img: string;
}

// ── State ──
const step = ref(1);
const stepperEl = ref<HTMLElement | null>(null);

// Step 1: Recipient
const address = ref('');
const paymentAddress = ref('');
const addressError = ref('');
const handleLoading = ref(false);
const handleResolved = ref<boolean | undefined>(undefined);
const handleAsset = ref<HandleAsset | null>(null);
const handleName = ref('');
const showContacts = ref(false);
const showQR = ref(false);

// Step 2: Assets
const adaAmount = ref('');
const adaError = ref('');
const extraTokens = ref<SendToken[]>([]);
const selectedNfts = ref<NftRow[]>([]);
const showTokenPicker = ref(false);
const showNfts = ref(false);
const tokenSearch = ref('');
const nftSearch = ref('');
const nftDisplayCount = ref(20);
const nftListEl = ref<HTMLElement | null>(null);
const nftSentinelEl = ref<HTMLElement | null>(null);
let nftObserver: IntersectionObserver | null = null;
const minAda = ref(0);

// Step 3: Review
const tx = shallowRef<Cardano.Tx | undefined>(undefined);
const txFee = ref<bigint>(BigInt(0));
const txBuilt = ref(false);
const txBuildError = ref('');
const buildingTx = ref(false);

// Step 4: Confirm
const spendingPassword = ref('');
const passwordError = ref('');
const showPassword = ref(false);
const submitting = ref(false);
const broadcasting = ref(false);
const txSuccess = ref(false);
const txId = ref('');
const txCbor = ref('');
const txWitnesses = ref('');
const isBT = ref(false);
const privateKeyBytes = ref<Uint8Array | null>(null);

// Keystone
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneUseHash = ref(false);
const showKeystoneDialog = ref(false);

// ── Computed ──
const sheetTitle = computed(() => txSuccess.value ? '' : 'Send');

const isMainnet = computed(() =>
  loggedWallet.value?.network === Network.MAINNET && loggedWallet.value?.chain === Blockchain.CARDANO
);

const isNormalWallet = computed(() => loggedWallet.value?.type === WalletType.Normal);
const walletType = computed(() => loggedWallet.value?.type || WalletType.Normal);

const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);

// Cross-device signing: server flag + this wallet's opt-in + a trusted signer.
// Cardano software wallets only. Dark by default.
void remoteSigningStore.ensureLoaded();
const canSignOnAnotherDevice = computed(() =>
  featureFlagsStore.isCrossDeviceSigningEnabled() &&
  remoteSigningStore.isEnabled() &&
  remoteSigningStore.hasTrustedSigner() &&
  loggedWallet.value?.chain === Blockchain.CARDANO &&
  isNormalWallet.value
);

// When the policy requires remote approval, disable local signing for a Send.
const requiresRemoteForSend = computed(() =>
  featureFlagsStore.isCrossDeviceSigningEnabled() &&
  remoteSigningStore.requiresRemoteForSend() &&
  loggedWallet.value?.chain === Blockchain.CARDANO &&
  isNormalWallet.value
);

interface SendApproval {
  current: () => boolean;
  cbor: string;
  transaction: Cardano.Tx;
  inputs: typeof utxos.value;
  addresses: typeof keys.value;
  wallet: typeof loggedWallet.value;
  password: string;
  dispatched: boolean;
}
let authorizedSend: SendApproval | null = null;
let keystoneApproval: { attempt: SendApproval; requestId: string } | null = null;
const approval = useApprovalFreshness(() => [
  loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network,
  loggedWallet.value?.webAuthnCredentialId, walletStore.isLocked,
  address.value, paymentAddress.value, adaAmount.value, extraTokens.value,
  selectedNfts.value, tx.value, step.value, requiresRemoteForSend.value,
], () => props.modelValue && !!loggedWallet.value?.id && !walletStore.isLocked, () => {
  authorizedSend = null;
  keystoneApproval = null;
  txCbor.value = '';
  txWitnesses.value = '';
  privateKeyBytes.value?.fill(0);
  privateKeyBytes.value = null;
  spendingPassword.value = '';
  showKeystoneDialog.value = false;
});

// A raw SDK object can be mutated outside Vue; bind the PassKey ceremony to its
// bytes as well as the reactive form context.
provide(authorizationScopeKey, { capture: () => {
  const current = approval.capture();
  const transaction = tx.value;
  const cbor = transaction ? serializeCardanoJsSdkTx(transaction) : '';
  return () => {
    if (!current() || tx.value !== transaction) return false;
    try { return (transaction ? serializeCardanoJsSdkTx(transaction) : '') === cbor; }
    catch { return false; }
  };
} });

function captureSend(): SendApproval | null {
  if (!tx.value || txSuccess.value || !approval.capture()()) return null;
  const transaction = tx.value;
  const cbor = serializeCardanoJsSdkTx(transaction);
  const fresh = approval.capture();
  return {
    current: () => {
      if (!fresh() || tx.value !== transaction) return false;
      try { return serializeCardanoJsSdkTx(transaction) === cbor; }
      catch { return false; }
    },
    cbor,
    transaction: Serialization.Transaction.fromCbor(HexBlob(cbor)).toCore(),
    inputs: utxos.value.slice(),
    addresses: keys.value,
    wallet: { ...loggedWallet.value },
    password: spendingPassword.value,
    dispatched: false,
  };
}

async function withSigning(work: (attempt: SendApproval) => Promise<void>, attempt = captureSend()) {
  if (!attempt || !attempt.current()) return;
  await approval.run(async () => {
    if (!attempt.current()) return;
    submitting.value = true;
    passwordError.value = '';
    authorizedSend = attempt;
    txCbor.value = attempt.cbor;
    try { await work(attempt); }
    catch (error) {
      if (attempt.current() && !(error instanceof StaleApprovalError)) {
        passwordError.value = getErrorMessage(error, 'Transaction failed') || 'Transaction failed';
      }
    } finally {
      attempt.password = '';
      spendingPassword.value = '';
      submitting.value = false;
    }
  });
}

const contactsList = computed(() => {
  const c = contacts.value;
  if (!c || typeof c !== 'object') return [];
  return Object.values(c as Record<string, ContactRow>).map((item) => ({
    name: item.name || item.label || 'Contact',
    address: item.address || item.addr || '',
  })).filter((item) => item.address);
});

const hasContacts = computed(() => contactsList.value.length > 0);

const isAddressValid = computed(() => {
  const addr = paymentAddress.value || address.value.trim();
  if (!addr) return false;
  if (handleLoading.value) return false;
  if (address.value.startsWith('$') && !handleResolved.value) return false;
  const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
  return rule(addr) === true;
});

const adaBalance = computed(() => {
  const account = walletStore.account;
  return account?.controlled_amount ? Number(account.controlled_amount) : 0;
});

// All wallet tokens mapped for send flow (same as dashboard)
const allTokens = computed(() => {
  if (!resolvedAssets.value) return [];
  return Object.values(resolvedAssets.value as Record<string, WalletTokenRow>).map((token): SendToken => ({
    ...token,
    name: token.metadata?.name || token.name,
    ticker: token.metadata?.ticker || token.ticker || token.name,
    img: token.img,
    balance: token.quantity,
    decimals: token.metadata?.decimals ?? 0,
    unit: token.unit,
    verified: token.verified,
  }));
});

const nativeTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

const availableTokens = computed(() => {
  const selectedUnits = new Set(extraTokens.value.map(t => t.unit));
  return allTokens.value.filter(t => {
    if (t.policy_id === '' || t.ticker === nativeTicker.value) return false;
    if (t.isScam) return false;
    if (selectedUnits.has(t.unit)) return false;
    return true;
  });
});

const filteredAvailableTokens = computed(() => {
  if (!tokenSearch.value) return availableTokens.value;
  const q = tokenSearch.value.toLowerCase();
  return availableTokens.value.filter(t =>
    (t.ticker || '').toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)
  );
});

const collectiblesList = computed(() => {
  if (!resolvedCollections.value) return [];
  const items: NftRow[] = [];
  for (const collection of Object.values(resolvedCollections.value as Record<string, CollectionRow>)) {
    if (collection.items) {
      const collectionName = collection.name || '';
      for (const item of collection.items) {
        items.push({ ...item, collection: collectionName, toSendQuantity: item.toSendQuantity ?? 1 });
      }
    }
  }
  return items;
});

const filteredNfts = computed(() => {
  if (!nftSearch.value) return collectiblesList.value;
  const q = nftSearch.value.toLowerCase();
  return collectiblesList.value.filter((nft) =>
    (nft.name || '').toLowerCase().includes(q) ||
    (nft.collection || '').toLowerCase().includes(q)
  );
});

const visibleNfts = computed(() => filteredNfts.value.slice(0, nftDisplayCount.value));

const isAssetsValid = computed(() => {
  const ada = parseFloat(adaAmount.value);
  const hasAda = !isNaN(ada) && ada > 0;
  const hasTokens = extraTokens.value.some(t => parseFloat(t.sendAmount ?? '') > 0);
  const hasNfts = selectedNfts.value.length > 0;
  return hasAda || hasTokens || hasNfts;
});

const assetsSummary = computed(() => {
  const parts: string[] = [];
  const ada = parseFloat(adaAmount.value);
  if (!isNaN(ada) && ada > 0) parts.push(`${ada} ADA`);
  for (const t of extraTokens.value) {
    if (parseFloat(t.sendAmount ?? '') > 0) parts.push(`${t.sendAmount} ${t.ticker}`);
  }
  if (selectedNfts.value.length > 0) parts.push(`${selectedNfts.value.length} NFT${selectedNfts.value.length > 1 ? 's' : ''}`);
  return parts.join(', ') || 'No assets';
});

const txFeeDisplay = computed(() => {
  if (!txBuilt.value) return '...';
  const feeAda = Number(txFee.value) / 1_000_000;
  return `~${feeAda.toFixed(6)} ADA`;
});

// ── Step 1: Recipient logic ──
function onAddressInput(val: string) {
  const addr = val || '';
  addressError.value = '';
  handleResolved.value = undefined;
  handleAsset.value = null;
  handleName.value = '';
  handleLoading.value = false;
  paymentAddress.value = '';
  resolveAdaHandle.cancel();

  if (addr.startsWith('$') && isMainnet.value) {
    resolveAdaHandle(addr);
  } else {
    paymentAddress.value = addr.trim();
  }
}

const resolveAdaHandle = debounce(async (val: string) => {
  const current = approval.capture();
  if (!current() || address.value !== val) return;
  if (val.length <= 1) {
    handleResolved.value = false;
    return;
  }
  handleLoading.value = true;
  try {
    const res = await adaHandleApi.resolve(val.replace('$', ''));
    if (!current() || address.value !== val) return;
    if (res.status === 200 && res.data?.resolved_addresses?.ada) {
      handleAsset.value = {
        name: res.data.name,
        img: assetsUtil.resolveIcon(res.data.image),
      };
      handleName.value = val;
      paymentAddress.value = res.data.resolved_addresses.ada;
      handleResolved.value = true;
    } else {
      handleResolved.value = false;
    }
  } catch {
    if (current() && address.value === val) handleResolved.value = false;
  } finally {
    if (address.value === val) handleLoading.value = false;
  }
}, 1000);

function selectContact(contact: { address: string }) {
  address.value = contact.address;
  showContacts.value = false;
  onAddressInput(contact.address);
}

function onQRScan(addr: string) {
  address.value = addr;
  paymentAddress.value = addr;
  showQR.value = false;
}

async function pasteFromClipboard() {
  const current = approval.capture();
  try {
    const text = await navigator.clipboard.readText();
    if (!current()) return;
    address.value = text.trim();
    onAddressInput(address.value);
  } catch (e) {
    console.warn('Could not paste:', e);
  }
}

// ── Step 2: Assets logic ──
function addToken(token: SendToken) {
  extraTokens.value.push({ ...token, sendAmount: '' });
  showTokenPicker.value = false;
  tokenSearch.value = '';
}

function removeExtraToken(idx: number) {
  extraTokens.value.splice(idx, 1);
}

function setAdaMax() {
  const maxLovelace = adaBalance.value - 500_000; // Reserve for fee
  if (maxLovelace <= 0) {
    adaAmount.value = '0';
    return;
  }
  adaAmount.value = (maxLovelace / 1_000_000).toFixed(6);
}

function fillMinAda() {
  // Set the ADA amount to the exact minimum required by the protocol
  adaAmount.value = minAda.value.toFixed(6);
}

function setTokenMax(idx: number) {
  const token = extraTokens.value[idx];
  if (!token) return;
  const bal = Number(token.balance);
  const dec = token.decimals || 0;
  const amount = dec > 0 ? bal / Math.pow(10, dec) : bal;
  token.sendAmount = String(amount);
}

function isNftSelected(nft: NftRow) {
  return selectedNfts.value.some(n => n.unit === nft.unit);
}

function toggleNft(nft: NftRow) {
  const idx = selectedNfts.value.findIndex(n => n.unit === nft.unit);
  if (idx >= 0) {
    selectedNfts.value.splice(idx, 1);
  } else {
    selectedNfts.value.push({ ...nft, toSendQuantity: 1 });
  }
}

function formatBalance(lovelace: number): string {
  return filters.toCurrency(lovelace);
}

function getTokenImg(token: SendToken): string {
  return applyTokenImageOverride(token.ticker || token.name, token.img || '');
}

function formatTokenBalance(token: SendToken): string {
  const bal = Number(token.balance);
  const dec = token.decimals || 0;
  const amount = dec > 0 ? bal / Math.pow(10, dec) : bal;
  if (amount === 0) return '0';
  return amount.toLocaleString('en-US', { maximumFractionDigits: Math.min(dec, 6) });
}

// ── Step 3: Build transaction ──
async function buildTransaction() {
  if (buildingTx.value || !isAssetsValid.value || !isAddressValid.value) return false;
  const current = approval.capture();
  if (!current()) return false;
  txBuilt.value = false;
  txBuildError.value = '';
  buildingTx.value = true;

  try {
    // Sync network data if missing
    if (!tip.value || !epochParams.value) {
      const response = await awaitFreshApproval(() => Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SYNC_VIA_REST,
        data: {}
      }), current) as BackgroundResponse<{ success: boolean }>;
      if (response.data.success) {
        await awaitFreshApproval(() => new Promise(resolve => setTimeout(resolve, 200)), current);
      }
      if (!tip.value || !epochParams.value) {
        txBuildError.value = 'Network data not available. Please try again.';
        return false;
      }
    }

    const recipientAddr = paymentAddress.value as Cardano.PaymentAddress;

    // Build asset map
    const assetsMap = new Map<Cardano.AssetId, bigint>();
    let coinsAmount = BigInt(0);

    // ADA
    const ada = parseFloat(adaAmount.value);
    if (!isNaN(ada) && ada > 0) {
      coinsAmount = BigInt(Math.floor(ada * 1_000_000));
    }

    // Extra tokens
    for (const token of extraTokens.value) {
      const amt = parseFloat(token.sendAmount ?? '');
      if (isNaN(amt) || amt <= 0) continue;
      const quantity = BigInt(Math.floor(amt * Math.pow(10, token.decimals || 0)));
      assetsMap.set(token.unit as Cardano.AssetId, quantity);
    }

    // NFTs
    for (const nft of selectedNfts.value) {
      assetsMap.set(nft.unit as Cardano.AssetId, BigInt(nft.toSendQuantity || 1));
    }

    // Enforce minimum ADA for outputs with multi-assets using the same SDK function as the builder
    if (assetsMap.size > 0 && epochParams.value?.coinsPerUtxoByte) {
      const getMinCoin = computeMinimumCoinQuantity(Number(epochParams.value.coinsPerUtxoByte));
      const checkOutput: Cardano.TxOut = {
        address: recipientAddr,
        value: { coins: coinsAmount as Cardano.Lovelace, assets: assetsMap }
      };
      const minLovelace = getMinCoin(checkOutput);
      if (coinsAmount < minLovelace) {
        coinsAmount = minLovelace;
      }
    }

    const outputs: Cardano.TxOut[] = [{
      address: recipientAddr,
      value: {
        coins: coinsAmount as Cardano.Lovelace,
        assets: assetsMap
      }
    }];

    // Build the transfer server-side via Nexus (protocol params + fee always fresh,
    // upgradable without an extension release). All send flows use Nexus unconditionally.
    const nexusOutputs = outputs.map(txOutToNexusOutput);
    const request: BuildTxRequest = {
      outputs: nexusOutputs,
      changeAddress: loggedWallet.value.baseAddress,
      utxos: walletUtxosToNexusInputs(utxos.value as Cardano.Utxo[], walletStore.collateral, true, {
        requiredAssets: requiredAssetsFromOutputs(nexusOutputs),
      }),
    };
    const { tx_cbor } = await awaitFreshApproval(() => nexusTxApi.buildTransferTx(request, loggedWallet.value.network), current);
    if (!tx_cbor) throw new Error('Nexus returned an empty transaction CBOR');
    tx.value = Serialization.Transaction.fromCbor(HexBlob(tx_cbor)).toCore();

    txFee.value = tx.value.body.fee;
    txBuilt.value = true;
    return true;
  } catch (e: unknown) {
    if (!current() || e instanceof StaleApprovalError) return false;
    const msg = typeof e === 'string' ? e : (getErrorMessage(e, String(e)) || String(e));
    if (msg.includes('Insufficient input')) {
      txBuildError.value = 'Insufficient balance to cover this transaction + fees.';
    } else if (msg.includes('less than the minimum UTXO value')) {
      const match = msg.match(/minimum UTXO value (\d+)/);
      if (match) {
        const minLovelace = Number(match[1]);
        txBuildError.value = `Minimum ADA required: ${(minLovelace / 1_000_000).toFixed(2)} ADA`;
      } else {
        txBuildError.value = 'ADA amount too low for this transaction.';
      }
    } else if (msg.includes('UTxO Fully Depleted')) {
      txBuildError.value = 'Not enough UTxOs. Try reducing the amount slightly.';
    } else {
      txBuildError.value = msg;
    }
    console.error('Build tx error:', e);
    return false;
  } finally {
    buildingTx.value = false;
  }
}

// Calculate minAda when assets change — uses the same SDK function as the transaction builder
function recalcMinAda() {
  if (!epochParams.value || !paymentAddress.value) { minAda.value = 0; return; }

  const assetsMap = new Map<Cardano.AssetId, bigint>();
  for (const token of extraTokens.value) {
    const amt = parseFloat(token.sendAmount ?? '');
    if (!isNaN(amt) && amt > 0) {
      assetsMap.set(token.unit as Cardano.AssetId, BigInt(Math.floor(amt * Math.pow(10, token.decimals || 0))));
    }
  }
  for (const nft of selectedNfts.value) {
    assetsMap.set(nft.unit as Cardano.AssetId, BigInt(nft.toSendQuantity || 1));
  }

  if (assetsMap.size === 0) { minAda.value = 0; return; }

  try {
    // Use the exact same SDK function the transaction builder uses (computeMinimumCoinQuantity)
    // This is the authoritative Cardano protocol calculation for minimum UTXO value
    const getMinCoin = computeMinimumCoinQuantity(Number(epochParams.value.coinsPerUtxoByte));
    const mockOutput: Cardano.TxOut = {
      address: paymentAddress.value as Cardano.PaymentAddress,
      value: { coins: BigInt(0) as Cardano.Lovelace, assets: assetsMap }
    };
    const minLovelace = getMinCoin(mockOutput);
    minAda.value = Number(minLovelace) / 1_000_000;
  } catch {
    minAda.value = 0;
  }
}

// ── Step 4: Sign & Submit ──
async function signAndSubmit() {
  if (requiresRemoteForSend.value) {
    passwordError.value = i18n.t('crossDevice.settings.policyRequireHint') as string;
    return;
  }
  await withSigning(async attempt => {
    const pwResult = await awaitFreshApproval(() => Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: attempt.password },
    }), attempt.current) as BackgroundResponse<VerifyPasswordResponse>;
    if (!pwResult.data.success) {
      passwordError.value = 'Wrong spending password';
      return;
    }
    const signResult = await awaitFreshApproval(() => Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: attempt.cbor, partialSign: false, password: attempt.password,
        accountIndex: 0, utxos: attempt.inputs, addresses: attempt.addresses, mergeWitnesses: false,
      },
    }), attempt.current) as { data: { witnesses?: string; error?: string } };
    if (signResult.data.error) throw new Error(signResult.data.error);
    await submitApproved(attempt, signResult.data.witnesses || '');
  });
}

async function signOnAnotherDevice() {
  if (!canSignOnAnotherDevice.value) return;
  await withSigning(async attempt => {
    const result = await awaitFreshApproval(() => Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.REQUEST_CROSS_DEVICE_SIGNATURE,
      data: {
        unsignedCbor: attempt.cbor,
        intent: i18n.t('crossDevice.intentSend', { amount: adaAmount.value || '0' }) as string,
        stakeAddress: attempt.wallet.stakeAddress,
        ttlMs: 180000,
      },
    }), attempt.current) as { data: { decision?: string; witnessSetCbor?: string; reason?: string } };
    if (result.data.decision === 'approved' && result.data.witnessSetCbor) {
      await submitApproved(attempt, result.data.witnessSetCbor);
    } else {
      passwordError.value = i18n.t(result.data.reason === 'expired'
        ? 'crossDevice.requestExpired' : 'crossDevice.requestRejected') as string;
    }
  });
}

async function onPassKeySuccess(pkBytes: Uint8Array) {
  try {
    if (requiresRemoteForSend.value) {
      passwordError.value = i18n.t('crossDevice.settings.policyRequireHint') as string;
      return;
    }
    await withSigning(async attempt => {
      privateKeyBytes.value = pkBytes;
      const signResult = await awaitFreshApproval(() => Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor: attempt.cbor, partialSign: false, accountIndex: 0,
          utxos: attempt.inputs, addresses: attempt.addresses, mergeWitnesses: false,
          privateKeyBytes: Array.from(pkBytes),
        },
      }), attempt.current) as { data: { witnesses?: string; error?: string } };
      if (signResult.data.error) throw new Error(signResult.data.error);
      await submitApproved(attempt, signResult.data.witnesses || '');
    });
  } finally {
    pkBytes.fill(0);
    if (privateKeyBytes.value === pkBytes) privateKeyBytes.value = null;
  }
}

function onPassKeyError(error: Error) {
  if (approval.capture()()) passwordError.value = error.message || 'PassKey authentication failed';
  privateKeyBytes.value?.fill(0);
  privateKeyBytes.value = null;
}

async function signLedger() {
  await withSigning(async attempt => {
    hardwareLoading.begin('Ledger', i18n.t('wallet.ledgerPreparingTransaction') as string);
    try {
      const signatures = await awaitFreshApproval(() => ledgerUtils.txToLedger(
        attempt.transaction, attempt.addresses, attempt.inputs as Cardano.Utxo[], !isBT.value,
        networks.resolveNetwork(attempt.wallet.chain, attempt.wallet.network),
      ), attempt.current);
      const witness = Serialization.TransactionWitnessSet.fromCore({ signatures }).toCbor();
      await submitApproved(attempt, witness);
    } catch (error) {
      if (attempt.current() && !(error instanceof StaleApprovalError)) ledgerUtils.ledgerErrorHandling(error);
      throw error;
    } finally { hardwareLoading.end(); }
  });
}

async function signTrezor() {
  await withSigning(async attempt => {
    hardwareLoading.begin('Trezor', i18n.t('wallet.confirmOnTrezor') as string);
    try {
      const data = { method: 'signTx', txCbor: attempt.cbor };
      const response = await awaitFreshApproval(() => featureFlagsStore.state.flags.isTrezorWebUsbEnabled
        ? dispatchTrezor(data)
        : Messaging.sendToBackgroundFromOptions({ method: MessageTypes.TREZOR, data }),
      attempt.current) as BackgroundResponse<SignTxResponse>;
      if (!response.data.success) throw new Error(response.data.error || 'Trezor signing failed');
      hardwareLoading.end();
      const signatures = new Map(response.data.signatures as unknown as Array<[string, string]>) as Cardano.Signatures;
      const witness = Serialization.TransactionWitnessSet.fromCore({ signatures }).toCbor();
      await submitApproved(attempt, witness);
    } finally { hardwareLoading.end(); }
  });
}

function signKeystone() {
  if (submitting.value) return;
  const attempt = captureSend();
  if (!attempt) return;
  passwordError.value = '';
  try {
    const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(
      Serialization.Transaction.fromCbor(HexBlob(attempt.cbor)), attempt.wallet,
      attempt.inputs as Cardano.Utxo[], attempt.addresses,
    );
    authorizedSend = attempt;
    keystoneApproval = { attempt, requestId: signRequestResponse.requestId };
    txCbor.value = attempt.cbor;
    keystoneType.value = signRequestResponse.ur.type;
    keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
    keystoneUseHash.value = signRequestResponse.useHash;
    showKeystoneDialog.value = true;
  } catch (error) {
    if (attempt.current()) passwordError.value = getErrorMessage(error, 'Failed to create Keystone sign request');
  }
}

async function onKeystoneScan(ur: UR) {
  const qr = keystoneApproval;
  if (!qr || !showKeystoneDialog.value || !qr.attempt.current() || submitting.value) return;
  await withSigning(async attempt => {
    const signature = parseSignature(ur);
    if (signature.requestId !== qr.requestId || !signature.witnessSet || typeof signature.witnessSet !== 'string') {
      throw new Error('Keystone signature does not match this approval');
    }
    keystoneApproval = null;
    showKeystoneDialog.value = false;
    await submitApproved(attempt, signature.witnessSet);
  }, qr.attempt);
}

function closeKeystone() { approval.invalidate(); }

function onKeystoneError(error: string) {
  if (keystoneApproval?.attempt.current()) passwordError.value = error || 'Keystone scan error';
  closeKeystone();
}

async function submitApproved(attempt: SendApproval, witnessHex: string) {
  if (!attempt.current() || authorizedSend !== attempt || attempt.dispatched) throw new StaleApprovalError();
  if (!witnessHex) throw new Error('Missing transaction witnesses');
  txWitnesses.value = witnessHex;
  attempt.dispatched = true;
  // Dispatch cannot be cancelled. Keep its result visible, but retain normal
  // cancellation while authentication or signing is still pending.
  broadcasting.value = true;
  try {
    const result = await awaitFreshApproval(() => Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: { txCbor: attempt.cbor, witnessHex, utxos: attempt.inputs },
    }), attempt.current) as { data: { txId?: string; error?: string } };
    if (result.data.error) throw new Error(result.data.error);
    txId.value = result.data.txId || '';
    txSuccess.value = true;
    snackbar.fireSuccess(i18n.t('miniGero.txSubmitted') as string);
  } finally {
    broadcasting.value = false;
  }
}

async function submitSignedTx() {
  const attempt = authorizedSend;
  const witnesses = txWitnesses.value;
  if (attempt) await withSigning(() => submitApproved(attempt, witnesses), attempt);
}

// ── Navigation ──
function editStep(target: number) {
  if (target < step.value && !submitting.value) {
    step.value = target;
  }
}

async function goToStep(target: number) {
  if (submitting.value || buildingTx.value) return;
  if (target === 2 && !isAddressValid.value) return;
  if (target === 3) {
    if (!await buildTransaction()) return;
  }
  step.value = target;
  const current = approval.capture();
  await nextTick();
  if (current()) scrollToActiveStep();
}

function scrollToActiveStep() {
  if (!stepperEl.value) return;
  const active = stepperEl.value.querySelector('.stepper-step.active');
  if (active) {
    active.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Utils ──
function truncateAddr(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 20) return addr;
  return addr.slice(0, 12) + '...' + addr.slice(-8);
}

function copyTxId() {
  if (txId.value) navigator.clipboard.writeText(txId.value).catch(() => {});
}

function onClose(val: boolean) {
  if (!val && !broadcasting.value) {
    approval.invalidate();
    emit('update:modelValue', false);
  }
}

function resetAll() {
  approval.invalidate();
  step.value = 1;
  address.value = '';
  paymentAddress.value = '';
  addressError.value = '';
  handleLoading.value = false;
  handleResolved.value = undefined;
  handleAsset.value = null;
  handleName.value = '';
  showContacts.value = false;
  showQR.value = false;
  adaAmount.value = '';
  adaError.value = '';
  extraTokens.value = [];
  selectedNfts.value = [];
  showTokenPicker.value = false;
  showNfts.value = false;
  tokenSearch.value = '';
  nftSearch.value = '';
  nftDisplayCount.value = 20;
  teardownNftObserver();
  minAda.value = 0;
  tx.value = undefined;
  txFee.value = BigInt(0);
  txBuilt.value = false;
  txBuildError.value = '';
  buildingTx.value = false;
  spendingPassword.value = '';
  passwordError.value = '';
  showPassword.value = false;
  submitting.value = false;
  txSuccess.value = false;
  txId.value = '';
  txCbor.value = '';
  txWitnesses.value = '';
  isBT.value = false;
  privateKeyBytes.value = null;
  keystoneType.value = '';
  keystoneCbor.value = '';
  keystoneUseHash.value = false;
  showKeystoneDialog.value = false;
}

// ── Watchers ──
watch(() => props.modelValue, (val) => {
  if (val) resetAll();
});

function clearBuiltTransaction() {
  tx.value = undefined;
  txBuilt.value = false;
}
// Compare primitive sources individually so an equal wallet broadcast does not
// clear the approved transaction. Asset edits still need synchronous deep watches.
watch([
  () => loggedWallet.value?.id, () => loggedWallet.value?.chain, () => loggedWallet.value?.network,
  address, paymentAddress, adaAmount,
], clearBuiltTransaction, { flush: 'sync' });
watch([extraTokens, selectedNfts], clearBuiltTransaction, { deep: true, flush: 'sync' });
onScopeDispose(() => { resolveAdaHandle.cancel(); teardownNftObserver(); });

// Recalculate minAda when assets change
watch([extraTokens, selectedNfts], () => {
  recalcMinAda();
}, { deep: true });

// Reset NFT display count when search changes
watch(nftSearch, () => {
  nftDisplayCount.value = 20;
});

// IntersectionObserver for infinite scroll
watch(showNfts, (val) => {
  if (val) {
    nextTick(() => setupNftObserver());
  } else {
    teardownNftObserver();
  }
});

function setupNftObserver() {
  teardownNftObserver();
  if (!nftSentinelEl.value) return;
  nftObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && nftDisplayCount.value < filteredNfts.value.length) {
      nftDisplayCount.value += 20;
      nextTick(() => {
        // Re-observe new sentinel if it moved
        if (nftSentinelEl.value && nftObserver) {
          nftObserver.disconnect();
          nftObserver.observe(nftSentinelEl.value);
        }
      });
    }
  }, { root: nftListEl.value, threshold: 0.1 });
  nftObserver.observe(nftSentinelEl.value);
}

function teardownNftObserver() {
  if (nftObserver) {
    nftObserver.disconnect();
    nftObserver = null;
  }
}
</script>

<style scoped>
.send-stepper {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 16px;
}

/* ── Success ── */
.success-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
}
.tx-id-box {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

/* ── Stepper step ── */
.stepper-step {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  overflow: hidden;
  transition: border-color var(--g-dur-base), background var(--g-dur-base);
}
.stepper-step.active {
  background: var(--g-hairline-1);
  border-color: color-mix(in srgb, var(--g-accent) 20%, transparent);
}
.stepper-step.done {
  border-color: var(--g-success-line);
}
.stepper-step.locked {
  opacity: 0.5;
  pointer-events: none;
}

.step-header {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  gap: 10px;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--g-hairline-1);
  color: var(--g-text-3);
  transition: background-color var(--g-dur-base), color var(--g-dur-base);
}
.step-circle.active {
  background: var(--g-accent);
  color: var(--g-on-grad);
}
.step-circle.done {
  background: var(--g-success);
  color: var(--g-on-grad);
}

.step-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.step-label {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}
.step-summary {
  color: var(--g-text-3);
  font-size: 11px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.step-body {
  padding: 0 14px 14px;
}

/* ── Quick actions row ── */
.quick-row {
  display: flex;
  gap: 6px;
}
.quick-btn {
  flex: 1;
  font-size: 11px !important;
  letter-spacing: 0;
  text-transform: none;
  padding: 0 6px !important;
  min-width: 0 !important;
  height: 32px !important;
}
.quick-btn .v-btn__content {
  font-size: 11px;
}

/* ── Inputs ── */
.mini-input :deep(.v-field) {
  --v-input-control-height: 36px;
  --v-field-input-padding-top: 0px;
  --v-field-input-padding-bottom: 0px;
  background: var(--g-hairline-1) !important;
  min-height: 36px !important;
}
.mini-input :deep(.v-field:not(.v-field--focused):not(.v-field--error) .v-field__outline) {
  --v-field-border-opacity: 1;
  color: var(--g-hairline-2);
}
.mini-input :deep(input.v-field__input),
.mini-input :deep(textarea.v-field__input) {
  color: var(--g-text-1) !important;
  font-size: 13px;
}

/* ── Handle display ── */
.handle-display {
  display: flex;
  align-items: center;
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-control);
  padding: 8px 10px;
}
.handle-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Contacts ── */
.contacts-list {
  max-height: 180px;
  overflow-y: auto;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.contact-row {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  transition: background var(--g-dur-fast);
}
.contact-row:hover {
  background: var(--g-hairline-1);
}
.contact-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Asset inputs ── */
.asset-input-section {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px;
}
.asset-input-section.ada-primary {
  background: color-mix(in srgb, var(--g-accent) 4%, transparent);
  border-color: color-mix(in srgb, var(--g-accent) 15%, transparent);
  padding: 12px;
}
.min-ada-hint {
  color: var(--g-error);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}
.min-ada-hint:hover {
  color: var(--g-warning);
}
.asset-input-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.amount-row {
  position: relative;
}
.amount-field :deep(input.v-field__input) {
  font-size: 20px !important;
  font-weight: 600;
}
.max-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  min-width: auto !important;
  padding: 0 8px !important;
}

/* ── Token picker ── */
.token-picker {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px;
}
.token-picker-list {
  max-height: 180px;
  overflow-y: auto;
}
.token-picker-item {
  display: flex;
  align-items: center;
  padding: 8px 6px;
  cursor: pointer;
  border-radius: var(--g-r-control);
  transition: background var(--g-dur-fast);
}
.token-picker-item:hover {
  background: var(--g-hairline-1);
}

/* ── NFTs ── */
.nft-list-container {
  display: flex;
  flex-direction: column;
}
.nft-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--g-hairline-3) transparent;
}
.nft-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--g-hairline-1);
  border: 2px solid transparent;
  border-radius: var(--g-r-control);
  cursor: pointer;
  transition: background var(--g-dur-fast), border-color var(--g-dur-fast);
}
.nft-list-item:hover {
  background: var(--g-hairline-1);
}
.nft-list-item.selected {
  border-color: var(--g-accent);
  background: color-mix(in srgb, var(--g-accent) 6%, transparent);
}
.nft-thumb {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: var(--g-r-control);
  overflow: hidden;
  background: var(--g-hairline-1);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nft-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.nft-item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.nft-item-name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nft-item-collection {
  color: var(--g-text-3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nft-badge {
  background: var(--g-accent);
  color: var(--g-on-grad);
  border-radius: var(--g-r-control);
  padding: 0 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}
.nft-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

/* ── Review ── */
.review-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px 14px;
}
.review-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}
.review-row:last-child {
  border-bottom: none;
}
.detail-label {
  color: var(--g-text-3);
  font-size: 13px;
}
.detail-value {
  color: var(--g-text-1);
  font-size: 13px;
  text-align: right;
}
.fee-text {
  color: var(--g-error);
}

/* ── Step actions ── */
.step-actions-row {
  display: flex;
  align-items: center;
}

/* ── HW wallet notice ── */
.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
}

/* ── Misc ── */
.flex-grow-1 { flex: 1; }

/* Chrome number input spinners off */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
}
</style>
