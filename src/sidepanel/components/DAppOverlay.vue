<template>
  <BottomSheet
    :value="isVisible"
    variant="trust"
    :height="(currentRequest?.method === 'enable' || currentRequest?.method === 'midnight_connect' || currentRequest?.method === 'wcSessionProposal') ? '70%' : '85%'"
    @escape="onEscapeReject"
  >
    <div v-if="currentRequest" class="dapp-overlay">
      <!-- Queue indicator -->
      <div v-if="requestQueue.length > 0" class="queue-strip mb-2">
        <div class="queue-strip-header">
          <span class="grey--text text-caption">
            {{ $t('miniGero.requestQueueIndicator', { current: 1, total: requestQueue.length + 1 }) }}
          </span>
          <v-btn text x-small color="error" @click="rejectAll()">{{ $t('miniGero.rejectAll') }}</v-btn>
        </div>
        <div
          v-for="item in requestQueue"
          :key="item.requestId"
          class="queue-strip-row"
        >
          <span class="grey--text text-caption queue-strip-label">{{ queuedItemLabel(item) }}</span>
          <v-btn icon x-small :aria-label="$t('miniGero.reject')" @click="rejectQueued(item.requestId)">
            <v-icon size="14" color="var(--g-text-3)">mdi-close</v-icon>
          </v-btn>
        </div>
      </div>

      <!-- Wallet identity: which wallet/network this request acts on. Shown
           once for every method (not duplicated per-branch below). Network
           badge only appears off mainnet, so the common case stays quiet. -->
      <div v-if="loggedWallet" class="wallet-identity-strip mb-2">
        <v-icon size="13" color="rgba(255,255,255,0.45)" class="mr-1">mdi-wallet-outline</v-icon>
        <span class="grey--text text-caption">{{ loggedWallet.name }}</span>
        <span v-if="loggedWallet.network !== Network.MAINNET" class="network-badge ml-2">{{ loggedWallet.network }}</span>
      </div>

      <!-- DApp Connect -->
      <div v-if="currentRequest.method === 'enable'" class="dapp-connect">
        <!-- Favicon + domain -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="onFaviconError"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" :color="primaryColor">mdi-web</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.connectRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(enableDomain).sub }}</span><b class="dapp-root">{{ splitHost(enableDomain).root }}</b></span>
          </div>
        </div>

        <!-- Homograph / punycode warning: only when the hostname actually warrants it -->
        <div v-if="splitHost(enableDomain).suspicious" class="suspicious-host mb-3">
          <v-icon size="14" color="warning" class="mr-1">mdi-alert-outline</v-icon>
          <span class="t-caption">{{ $t('dapp.suspiciousHostname') }}</span>
        </div>

        <!-- Permissions. A checkbox here was fake agency: it gated a button the
             user had already decided to press, and taught them to click past
             consent UI. The grants are stated, not negotiated. -->
        <div class="permissions-section mb-4">
          <p class="t-label mb-2">{{ $t('navigation.allowTheSiteTo') }}</p>
          <div class="permission-row">
            <v-icon size="14" class="permission-check">mdi-check</v-icon>
            <span class="t-body-sm">{{ $t('navigation.viewAddressAndBalance') }}</span>
          </div>
          <div class="permission-row">
            <v-icon size="14" class="permission-check">mdi-check</v-icon>
            <span class="t-body-sm">{{ $t('miniGero.futureTransactionsNote') }}</span>
          </div>
        </div>

        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="approve(true)">
            {{ $t('miniGero.approve') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Transaction -->
      <div v-else-if="currentRequest.method === 'signTx'" class="dapp-sign-tx">
        <!-- Favicon + domain (same style as signData / connect) -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="onFaviconError"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" color="warning">mdi-file-document-edit-outline</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.signTxRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(signDataDomain).sub }}</span><b class="dapp-root">{{ splitHost(signDataDomain).root }}</b></span>
          </div>
        </div>

        <!-- Decoded transaction summary -->
<TransactionDetailsCard
          v-if="signTxSummary"
          :outputs="signTxSummary.outputs"
          :withdrawal="signTxSummary.withdrawal"
          :totals="signTxSummary.totals"
          :risk-badge="txRiskBadge"
          :risk-loading="txRiskLoading"
          :cbor-hex="txCborForSummary"
          class="mb-3"
        />
        <div v-if="signTxSummary && formatFiatFromAda(signTxSummary.totals.youPayAda)" class="tx-fiat-approx mb-3">
          {{ formatFiatFromAda(signTxSummary.totals.youPayAda) }}
        </div>

        <!-- Non-output intents: certificates, mint/burn, collateral, metadata.
             Rendered only when at least one is present — an ordinary payment
             shows nothing here. This is what stops a delegation/mint/vote
             transaction from presenting as just an address and an amount. -->
        <div
          v-if="signTxSummary && (signTxSummary.certificates.length || signTxSummary.mints.length || signTxSummary.collateralCount > 0 || signTxSummary.hasMetadata)"
          class="tx-intents mb-3"
        >
          <div class="tx-intents-header text-caption grey--text text-uppercase">{{ $t('signTx.thisTransactionWill') }}</div>
          <div
            v-for="(cert, i) in signTxSummary.certificates"
            :key="'cert-' + i"
            class="tx-intent-row"
          >
            <v-icon size="14" :color="primaryColor" class="mr-1">mdi-certificate-outline</v-icon>
            <div class="tx-intent-text">
              <span class="white--text text-caption">{{ cert.label }}</span>
              <span v-if="cert.poolId" class="grey--text text-caption ml-1">{{ cert.poolId }}</span>
              <span v-if="cert.depositAda" class="grey--text text-caption ml-1">({{ $t('signTx.depositAmount', { amount: cert.depositAda }) }})</span>
              <span v-if="cert.drepSentinel" class="grey--text text-caption ml-1">{{ $t(`governance.${cert.drepSentinel === 'alwaysAbstain' ? 'alwaysAbstain' : 'alwaysNoConfidence'}`) }}</span>
            </div>
          </div>
          <div
            v-for="(mint, i) in signTxSummary.mints"
            :key="'mint-' + i"
            class="tx-intent-row"
          >
            <v-icon size="14" :color="mint.isBurn ? 'error' : 'success'" class="mr-1">{{ mint.isBurn ? 'mdi-fire' : 'mdi-file-plus-outline' }}</v-icon>
            <span class="white--text text-caption">
              {{ $t(mint.isBurn ? 'signTx.burnsAsset' : 'signTx.mintsAsset', { quantity: mint.formattedQuantity, name: mint.label }) }}
            </span>
          </div>
          <div v-if="signTxSummary.collateralCount > 0" class="tx-intent-row">
            <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-shield-lock-outline</v-icon>
            <span class="white--text text-caption">{{ $tc('signTx.reservesCollateral', signTxSummary.collateralCount, { count: signTxSummary.collateralCount }) }}</span>
          </div>
          <div v-if="signTxSummary.hasMetadata" class="tx-intent-row">
            <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-tag-text-outline</v-icon>
            <span class="white--text text-caption">{{ $t('signTx.includesMetadata') }}</span>
          </div>
        </div>

        <!-- Decode-failure guard: CBOR parse failed (signTxSummary is null while
             the payload itself decoded to a tx). Blocking — the user must
             explicitly acknowledge before the Sign button below unlocks. -->
        <div v-if="signTxDecodeFailed" class="tx-decode-failed-banner mb-3">
          <v-icon color="error" size="20" class="mr-2">mdi-alert-octagon-outline</v-icon>
          <div class="tx-expired-text">
            <div class="tx-expired-title">{{ $t('signTx.decodeFailedTitle') }}</div>
            <div class="tx-expired-body">{{ $t('signTx.decodeFailedBody') }}</div>
            <v-checkbox
              v-model="decodeFailedAck"
              color="error"
              hide-details
              dark
              dense
              class="mt-2"
              :label="$t('signTx.decodeFailedAck')"
            />
          </div>
        </div>

        <!-- Network mismatch guard: an external output address belongs to a
             different network (mainnet/testnet) than the active wallet. -->
        <div v-if="signTxNetworkMismatch" class="tx-decode-failed-banner mb-3">
          <v-icon color="error" size="20" class="mr-2">mdi-swap-horizontal-circle-outline</v-icon>
          <div class="tx-expired-text">
            <div class="tx-expired-title">{{ $t('signTx.networkMismatchTitle') }}</div>
            <div class="tx-expired-body">{{ $t('signTx.networkMismatchBody') }}</div>
            <v-checkbox
              v-model="networkMismatchAck"
              color="error"
              hide-details
              dark
              dense
              class="mt-2"
              :label="$t('signTx.networkMismatchAck')"
            />
          </div>
        </div>

        <!-- Proportional risk friction: quiet when Shield says low/medium/
             unverified (the badge above is enough); blocking only on "high". -->
        <div v-if="txRiskBadge && txRiskBadge.label === 'high'" class="tx-decode-failed-banner mb-3">
          <v-icon color="error" size="20" class="mr-2">mdi-shield-alert-outline</v-icon>
          <div class="tx-expired-text">
            <div class="tx-expired-title">{{ $t('signTx.highRiskTitle') }}</div>
            <div class="tx-expired-body">{{ $t('signTx.risk.highTooltip') }}</div>
            <v-checkbox
              v-model="highRiskAck"
              color="error"
              hide-details
              dark
              dense
              class="mt-2"
              :label="$t('signTx.highRiskAck')"
            />
          </div>
        </div>

        <!-- Expired banner — shown once the live TTL countdown reaches 0. Sign buttons
             below all gate on `ttlDisplay.expired`, so the user is forced to reject. -->
        <div v-if="ttlDisplay.expired" class="tx-expired-banner">
          <v-icon color="error" size="20" class="mr-2">mdi-clock-alert-outline</v-icon>
          <div class="tx-expired-text">
            <div class="tx-expired-title">{{ $t('signTx.expiredTitle') }}</div>
            <div class="tx-expired-body">{{ $t('signTx.expiredBody') }}</div>
          </div>
        </div>

        <!-- Normal wallet: password input -->
        <template v-if="walletType === WalletType.Normal || walletType === WalletType.Google">
          <v-text-field
            v-if="!isPrfWallet && !isMpcWallet"
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signNormal"
          />
          <!-- MPC (Google) wallet: nothing to enter — signs with the session-cached
               key, so no password field and no instruction (just the Sign button). -->
          <template v-else-if="isMpcWallet">
            <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          </template>
          <!-- PRF wallet: PassKey authentication -->
          <template v-else>
            <p class="grey--text text-body-2 text-center mb-2">{{ $t('miniGero.passKeyRequired') }}</p>
            <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          </template>
        </template>

        <!-- Ledger wallet -->
        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice pa-3 mb-3">
            <v-icon :color="primaryColor" class="mb-2">{{ isBT ? 'mdi-bluetooth' : 'mdi-usb' }}</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectLedger') }}</p>
            <!-- Transport picker. Nano X over BLE never shows up in the WebUSB
                 chooser, so without this the user is stuck on "No device selected". -->
            <div v-if="loggedWallet?.btSupported" class="hw-transport-toggle">
              <ToggleSwitch
                :text-left="$t('wallet.usb')"
                icon-left="mdi-usb"
                :text-right="$t('wallet.bluetooth')"
                icon-right="mdi-bluetooth"
                :value="isBT"
                :disabled="signing"
                @input="isBT = $event"
              />
            </div>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
        </template>

        <!-- Trezor wallet -->
        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice pa-3 mb-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectTrezor') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
        </template>

        <!-- Keystone wallet -->
        <template v-else-if="walletType === WalletType.Keystone">
          <div class="hw-notice pa-3 mb-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-qrcode-scan</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.keystoneSign') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
        </template>
      </div>

      <!-- Sign Data -->
      <div v-else-if="currentRequest.method === 'signData'" class="dapp-sign-data">
        <!-- Favicon + domain (same style as connect) -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="onFaviconError"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" color="error">mdi-file-sign</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.signDataRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(signDataDomain).sub }}</span><b class="dapp-root">{{ splitHost(signDataDomain).root }}</b></span>
          </div>
        </div>

        <!-- Signing address — payload.address is signed against but was
             previously never shown, so the user couldn't see which key attests. -->
        <div v-if="signDataAddress" class="signing-address-row mb-2">
          <span class="grey--text text-caption">{{ $t('signTx.signingAddress') }}</span>
          <span class="white--text text-caption signing-address-value">{{ filters.truncate(signDataAddress) }}</span>
        </div>

        <!-- Message content -->
        <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('navigation.signData') }}</p>
        <div class="sign-data-message">
          <p v-if="signDataDecodeError" class="decode-error text-caption">
            {{ $t('signTx.malformedSignData') }}
          </p>
          <p v-else class="white--text text-caption" style="word-break: break-all;">
            {{ signDataMessage }}
          </p>
        </div>

        <!-- Normal wallet: password input -->
        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet && !isMpcWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signDataNormal"
          />
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword || signDataDecodeError" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- MPC (Google) wallet: nothing to enter — signs with the session-cached key. -->
        <template v-else-if="isMpcWallet">
          <p v-if="signError" class="error--text text-caption text-center mb-2 mt-3">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!!signDataDecodeError" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- PRF wallet: PassKey authentication -->
        <template v-else-if="isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signDataDecodeError" @click="signDataPrf">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Ledger wallet -->
        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice pa-3 mb-3 mt-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectLedger') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signDataDecodeError" @click="signDataHw">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Trezor wallet -->
        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice pa-3 mb-3 mt-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectTrezor') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signDataDecodeError" @click="signDataHw">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Fallback -->
        <template v-else>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signDataDecodeError" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>
      </div>

      <!-- Bitcoin: Sign PSBT -->
      <div v-else-if="currentRequest.method === 'btcSignPsbt'" class="dapp-sign-tx">
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img :src="faviconUrl" class="favicon-img" @error="onFaviconError" v-if="!faviconFailed" />
            <v-icon v-else size="32" color="warning">mdi-file-document-edit-outline</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('bitcoin.signPsbtRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(signDataDomain).sub }}</span><b class="dapp-root">{{ splitHost(signDataDomain).root }}</b></span>
          </div>
        </div>

        <div v-if="btcPsbtInfo" class="tx-intents mb-3">
          <div class="tx-intent-row">
            <span class="grey--text text-caption">{{ $t('bitcoin.inputs') }}</span>
            <span class="white--text text-caption ml-auto">{{ btcPsbtInfo.inputs }}</span>
          </div>
          <div class="tx-intent-row">
            <span class="grey--text text-caption">{{ $t('bitcoin.outputs') }}</span>
            <span class="white--text text-caption ml-auto">{{ btcPsbtInfo.outputs }}</span>
          </div>
        </div>

        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signBtcPsbtNormal"
          />
        </template>
        <template v-else-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
        </template>
        <!-- Hardware wallets: not yet supported for Bitcoin dApp signing in the
             panel — see the script-section comment above for why this is an
             honest deferral rather than a port of already-broken popup code. -->
        <template v-else>
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('bitcoin.walletTypeUnsupportedInPanel') }}</p>
        </template>
      </div>

      <!-- Bitcoin: Sign Message -->
      <div v-else-if="currentRequest.method === 'btcSignMessage'" class="dapp-sign-data">
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img :src="faviconUrl" class="favicon-img" @error="onFaviconError" v-if="!faviconFailed" />
            <v-icon v-else size="32" color="error">mdi-file-sign</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('bitcoin.signMessageRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(signDataDomain).sub }}</span><b class="dapp-root">{{ splitHost(signDataDomain).root }}</b></span>
          </div>
        </div>

        <v-chip x-small color="orange darken-2" text-color="white" class="mb-2">
          {{ btcMessageSigningType === 'bip322-simple' ? 'BIP-322' : 'ECDSA' }}
        </v-chip>
        <div class="sign-data-message">
          <p class="white--text text-caption" style="word-break: break-all;">{{ btcMessageText }}</p>
        </div>

        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signBtcMessageNormal"
          />
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword" @click="signBtcMessageNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>
        <template v-else-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="runBtcPrf(signBtcMessagePrf)">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>
        <!-- Hardware wallets: never supported for Bitcoin message signing —
             matches the popup's own BitcoinSignMessage.vue, which never
             offered this either. Not a scope reduction on my part. -->
        <template v-else>
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('bitcoin.hardwareMessageSigningNotSupported') }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark block @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
          </div>
        </template>
      </div>

      <!-- Midnight: Connect (DApp Connector connect()) -->
      <div v-else-if="currentRequest.method === 'midnight_connect'" class="dapp-connect">
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img :src="faviconUrl" class="favicon-img" @error="onFaviconError" v-if="!faviconFailed" />
            <v-icon v-else size="32" :color="primaryColor">mdi-web</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.connectRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(enableDomain).sub }}</span><b class="dapp-root">{{ splitHost(enableDomain).root }}</b></span>
          </div>
        </div>

        <div v-if="splitHost(enableDomain).suspicious" class="suspicious-host mb-3">
          <v-icon size="14" color="warning" class="mr-1">mdi-alert-outline</v-icon>
          <span class="t-caption">{{ $t('dapp.suspiciousHostname') }}</span>
        </div>

        <div class="permissions-section mb-4">
          <p class="t-label mb-2">{{ $t('navigation.allowTheSiteTo') }}</p>
          <div class="permission-row">
            <v-icon size="14" class="permission-check">mdi-check</v-icon>
            <span class="t-body-sm">{{ $t('midnight.connector.viewAddressAndBalance') }}</span>
          </div>
          <div class="permission-row">
            <v-icon size="14" class="permission-check">mdi-check</v-icon>
            <span class="t-body-sm">{{ $t('midnight.connector.futureRequestsNote') }}</span>
          </div>
        </div>

        <div class="action-buttons">
          <v-btn outlined rounded dark @click="rejectMidnightConnect">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="approveMidnightConnect">
            {{ $t('miniGero.approve') }}
          </v-btn>
        </div>
      </div>

      <!-- Midnight: Sign Data (DApp Connector signData()) -->
      <div v-else-if="currentRequest.method === 'midnight_signData'" class="dapp-sign-data">
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img :src="faviconUrl" class="favicon-img" @error="onFaviconError" v-if="!faviconFailed" />
            <v-icon v-else size="32" color="error">mdi-file-sign</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.signDataRequest') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(signDataDomain).sub }}</span><b class="dapp-root">{{ splitHost(signDataDomain).root }}</b></span>
          </div>
        </div>

        <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('navigation.signData') }}</p>
        <div class="sign-data-message">
          <!-- Shows the ACTUAL decoded bytes that will be signed (hex), never
               the raw un-decoded wire string — see midnightSignDataCodec.ts
               for why: a lenient decode could let a dapp show a long
               deceptive string while only a short prefix is really signed. -->
          <p v-if="midnightSignDataDecodeError" class="decode-error text-caption">
            {{ $t('midnight.connector.malformedSignData') }}
          </p>
          <p v-else class="white--text text-caption" style="word-break: break-all;">
            {{ midnightSignDataMessage }}
          </p>
        </div>

        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signMidnightDataNormal"
          />
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectMidnightSignData">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn
              class="geroButton"
              rounded
              depressed
              :loading="signing"
              :disabled="!spendingPassword || !!midnightSignDataDecodeError"
              @click="signMidnightDataNormal"
            >
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <template v-else-if="isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectMidnightSignData">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn
              class="geroButton"
              rounded
              depressed
              :loading="signing"
              :disabled="!!midnightSignDataDecodeError"
              @click="signMidnightDataPrf"
            >
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Midnight has no hardware-wallet signing support (see the July 2026
             gap analysis) — Ledger/Trezor/Keystone can only decline. -->
        <template v-else>
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('midnight.connector.walletTypeUnsupported') }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark block @click="rejectMidnightSignData">{{ $t('miniGero.reject') }}</v-btn>
          </div>
        </template>
      </div>

      <!-- Midnight: Make Transfer (DApp Connector makeTransfer()) -->
      <div v-else-if="currentRequest.method === 'midnight_makeTransfer'" class="dapp-sign-data">
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img :src="faviconUrl" class="favicon-img" @error="onFaviconError" v-if="!faviconFailed" />
            <v-icon v-else size="32" :color="primaryColor">mdi-bank-transfer</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('midnight.connector.transferTitle') }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(makeTransferDomain).sub }}</span><b class="dapp-root">{{ splitHost(makeTransferDomain).root }}</b></span>
          </div>
        </div>

        <div class="sign-data-message">
          <div v-for="(o, i) in makeTransferOutputs" :key="i" class="mb-3">
            <div class="d-flex justify-space-between">
              <span class="grey--text text-caption mr-2">{{ $t('common.recipientAddress') }}</span>
              <span class="white--text text-caption" style="word-break: break-all; text-align: right;">{{ o.recipient }}</span>
            </div>
            <div class="d-flex justify-space-between mt-1">
              <span class="grey--text text-caption">{{ $t('common.amount') }}</span>
              <span class="white--text text-caption font-weight-bold">{{ formatNightBase(o.value) }} {{ nightCurrency }}</span>
            </div>
          </div>
          <div
            v-if="makeTransferOutputs.length > 1"
            class="d-flex justify-space-between pt-2"
            style="border-top: 1px solid var(--g-hairline-1);"
          >
            <span class="white--text text-body-2 font-weight-bold">{{ $t('common.total') }}</span>
            <span class="white--text text-body-2 font-weight-bold">{{ makeTransferTotalDisplay }} {{ nightCurrency }}</span>
          </div>
          <div class="d-flex align-start mt-2">
            <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-eye-outline</v-icon>
            <span class="grey--text text-caption">{{ $t('midnight.send.publicTxNote') }}</span>
          </div>
          <div class="d-flex align-start mt-1">
            <v-icon size="14" color="warning" class="mr-1">mdi-alert-outline</v-icon>
            <span class="warning--text text-caption">{{ $t('midnight.send.dustResetWarning') }}</span>
          </div>
          <p class="grey--text text-caption mt-2 mb-0">{{ $t('midnight.connector.transferFeesNote') }}</p>
        </div>

        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signMidnightTransferNormal"
          />
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectMidnightMakeTransfer">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn
              class="geroButton"
              rounded
              depressed
              :loading="signing"
              :disabled="!spendingPassword"
              @click="signMidnightTransferNormal"
            >
              {{ $t('miniGero.approve') }}
            </v-btn>
          </div>
        </template>

        <template v-else-if="isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectMidnightMakeTransfer">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn
              class="geroButton"
              rounded
              depressed
              :loading="signing"
              @click="signMidnightTransferPrf"
            >
              {{ $t('miniGero.approve') }}
            </v-btn>
          </div>
        </template>

        <!-- Midnight has no hardware-wallet signing support — decline only. -->
        <template v-else>
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('midnight.connector.walletTypeUnsupported') }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark block @click="rejectMidnightMakeTransfer">{{ $t('miniGero.reject') }}</v-btn>
          </div>
        </template>
      </div>

      <!-- WalletConnect: session proposal (pairing) -->
      <div v-else-if="currentRequest.method === 'wcSessionProposal'" class="dapp-connect">
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img :src="faviconUrl" class="favicon-img" @error="onFaviconError" v-if="!faviconFailed" />
            <v-icon v-else size="32" :color="primaryColor">mdi-link-variant</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ wcPeerName }}</h3>
            <span class="dapp-url"><span class="dapp-sub">{{ splitHost(wcPeerUrl).sub }}</span><b class="dapp-root">{{ splitHost(wcPeerUrl).root }}</b></span>
          </div>
        </div>

        <div v-if="splitHost(wcPeerUrl).suspicious" class="suspicious-host mb-3">
          <v-icon size="14" color="warning" class="mr-1">mdi-alert-outline</v-icon>
          <span class="t-caption">{{ $t('dapp.suspiciousHostname') }}</span>
        </div>

        <div class="permissions-section mb-3">
          <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('walletConnect.requestedChains') }}</p>
          <v-chip
            v-for="chain in wcRequestedChainNames"
            :key="chain"
            small outlined :color="primaryColor"
            class="mr-1 mb-1"
          >{{ chain }}</v-chip>
          <div v-if="wcHasUnsupportedChains" class="decode-error text-caption mt-1">
            {{ $t('walletConnect.unsupportedChain') }}
          </div>
          <div class="permission-row mt-2">
            <v-icon size="14" class="permission-check">mdi-check</v-icon>
            <span class="t-body-sm">{{ $t('navigation.viewAddressAndBalance') }}</span>
          </div>
        </div>

        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('walletConnect.reject') }}</v-btn>
          <!-- The consent gate is gone, the CAPABILITY gate stays: an unsupported
               chain means we genuinely cannot honour the session. -->
          <v-btn
            class="geroButton" rounded depressed
            :disabled="wcHasUnsupportedChains"
            @click="approveWcSession"
          >{{ $t('walletConnect.approve') }}</v-btn>
        </div>
      </div>
    </div>

    <!-- Keystone QR dialog -->
    <KeystoneSignDialog
      v-if="showKeystoneDialog"
      :isOpen="showKeystoneDialog"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @close="showKeystoneDialog = false"
    />

    <!-- Sticky footer: signTx's action buttons + TTL countdown pinned below
         the scrollable review content, so the primary action and the one
         time-critical value are never scrolled out of view on a long
         decoded transaction. Other methods (enable/signData/midnight_*) have
         short enough content that this wasn't the ergonomics problem. -->
    <template v-if="currentRequest && (currentRequest.method === 'signTx' || currentRequest.method === 'btcSignPsbt')" #footer>
      <template v-if="currentRequest.method === 'signTx'">
        <template v-if="walletType === WalletType.Normal || walletType === WalletType.Google">
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn
              v-if="!isPrfWallet"
              class="geroButton" rounded depressed :loading="signing"
              :disabled="(!spendingPassword && !isMpcWallet) || signTxBlocked" @click="signNormal"
            >{{ $t('miniGero.sign') }}</v-btn>
            <v-btn
              v-else
              class="geroButton" rounded depressed :loading="signing"
              :disabled="signTxBlocked" @click="signPrf"
            >{{ $t('miniGero.sign') }}</v-btn>
          </div>
        </template>
        <div v-else-if="walletType === WalletType.Ledger" class="action-buttons">
          <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signTxBlocked" @click="signLedger">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
        <div v-else-if="walletType === WalletType.Trezor" class="action-buttons">
          <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signTxBlocked" @click="signTrezor">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
        <div v-else-if="walletType === WalletType.Keystone" class="action-buttons">
          <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="signTxBlocked" @click="signKeystone">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>

        <!-- Live TTL countdown — centered, monospaced so digits don't shift
             width as it ticks. Hidden once expired (the red banner replaces it). -->
        <v-tooltip
          v-if="ttlDisplay.relative && !ttlDisplay.expired"
          top
          content-class="custom-tooltip"
          max-width="260"
        >
          <template v-slot:activator="{ on, attrs }">
            <div class="tx-ttl-footer" v-bind="attrs" v-on="on">
              <span>{{ $t('signTx.expiresIn') }}</span>
              <span class="tx-ttl-footer-value">{{ ttlDisplay.relative }}</span>
            </div>
          </template>
          <span>{{ $t('signTx.expiresTooltip', { slot: signTxSummary?.ttlSlot }) }}</span>
        </v-tooltip>
      </template>

      <!-- Bitcoin PSBT: Normal/PRF only, matching the pane above -->
      <template v-else-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword" @click="signBtcPsbtNormal">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
      </template>
      <template v-else-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && isPrfWallet">
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :loading="signing" @click="runBtcPrf(signBtcPsbtPrf)">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
      </template>
      <div v-else class="action-buttons">
        <v-btn outlined rounded dark block @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
      </div>
    </template>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { getDomain } from 'tldts';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { useDAppOverlay, type DAppRequest } from '../composables/useDAppOverlay';
import { useChainContext } from '../composables/useChainContext';
import BottomSheet from './BottomSheet.vue';
import TransactionDetailsCard, {
  type TxDetailsWithdrawal,
  type TxDetailsTotals,
} from '@/shared/components/TransactionDetailsCard.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import WalletStore from '@/stores/walletStore';
import { networkStore, isBitcoinTip } from '@/stores/networkStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useTranslation } from '@/shared/composables/useTranslation';
import { WalletType, Network, Blockchain } from '@/models/types';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import filters from '@/shared/utils/filters';
import { friendlyTxError } from '@/shared/utils/txErrors';
import cardanoShieldApi from '@/api/cardano-shield-api';
import { DappScore, type TxScanResponse } from '@/models/cardano-shield-types';
import ledgerUtils from '@/shared/utils/ledger';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import { UR } from '@keystonehq/keystone-sdk';
import networks from '@/utils/networks';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { decodedPayloadHexPreview, decodeSignDataPayload, type MidnightSignDataEncoding } from '@/chrome/midnightSignDataCodec';
import { MidnightErrorCode } from '@/chrome/config';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { resolveGeroChain } from '@/services/walletConnect/chainUtils';

interface BackgroundResponse<T> { data: T }
interface SignTxResponse { success: boolean; error?: string; signatures?: Array<[string, string]> }

const { isVisible, currentRequest, requestQueue, approve, reject, rejectQueued, rejectAll, setOverlayReady } = useDAppOverlay();

// This overlay renders only when the wallet is unlocked + active (v-if in
// App.vue). Tell the hub when we're actually able to show a request, so a
// request delivered while locked stays queued instead of occupying the (then
// invisible) currentRequest and blocking everything behind it. Re-promotes the
// parked request on remount (unlock).
onMounted(() => setOverlayReady(true));
onBeforeUnmount(() => setOverlayReady(false));
const { t } = useTranslation();

// Domain + method label for a queued (not-yet-shown) request, for the queue
// strip below. Reuses the same URL-hostname extraction as enableDomain/
// signDataDomain (identical parsing, different source object).
function queuedItemLabel(item: DAppRequest): string {
  const payload = item.payload as { website?: string } | undefined;
  const website = payload?.website || '';
  let domain = website;
  try { domain = new URL(website).hostname; } catch { /* leave as-is */ }
  const methodKeys: Record<string, string> = {
    enable: 'miniGero.connectRequest',
    signTx: 'miniGero.signTxRequest',
    signData: 'miniGero.signDataRequest',
    midnight_connect: 'miniGero.connectRequest',
    midnight_signData: 'miniGero.signDataRequest',
    midnight_makeTransfer: 'miniGero.transferRequest',
    wcSessionProposal: 'miniGero.connectRequest',
  };
  const methodLabel = methodKeys[item.method] ? t(methodKeys[item.method]) : item.method;
  return `${domain} - ${methodLabel}`;
}
const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

// Fiat approximation for the tx total — "≈ $5,620" when you meant $56 is
// instantly visible where "12482.1 ADA" is not. Reads the already-cached
// price straight off the observable state (populated by background sync — no
// new API call here; the getAdaPrice() helper lives on the store's default
// export, not this named state import) and the existing display-currency
// conversion, so this is pure presentation over data the app already has.
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
function formatFiatFromAda(adaAmountStr: string): string | null {
  const adaPrice = networkStore.price?.lastPrice || 0;
  if (!adaPrice) return null; // no price data yet — omit rather than show a stale/zero amount
  const ada = parseFloat(adaAmountStr);
  if (!Number.isFinite(ada)) return null;
  const converted = convertFiat(ada * adaPrice);
  return `≈ ${getCurrencySymbol()}${converted.toFixed(2)}`;
}

const spendingPassword = ref('');
const showPassword = ref(false);
const signing = ref(false);
const signError = ref('');
const faviconFailed = ref(false);

const enableDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

/**
 * Split a hostname into its de-emphasized subdomain and its registrable root,
 * so the part that actually identifies the site is the part that reads loudest.
 * `suspicious` flags punycode or non-ASCII labels, the classic homograph
 * spoof (аpple.com with a Cyrillic а renders identically to apple.com).
 */
function splitHost(input: string): { sub: string; root: string; suspicious: boolean } {
  if (!input) return { sub: '', root: '', suspicious: false };
  // wcPeerUrl is a full URL; enableDomain/signDataDomain are already hostnames.
  let host = input;
  try {
    if (/^[a-z]+:\/\//i.test(input)) host = new URL(input).hostname;
  } catch { /* fall through with the raw string */ }
  const root = getDomain(host) || host;
  const sub = host.endsWith(root) ? host.slice(0, host.length - root.length) : '';
  const suspicious = host.split('.').some((l) => l.startsWith('xn--')) || /[^\x00-\x7F]/.test(host);
  return { sub, root, suspicious };
}

// Index of the favicon source currently being tried (advanced via @error).
const faviconAttempt = ref(0);

// Ordered favicon sources, best first.
const faviconSources = computed(() => {
  const domain = enableDomain.value;
  if (!domain) return [];
  const tabFavicon = currentRequest.value?.payload?.favIconUrl;
  return [
    // Source 1: the real favicon Chrome already loaded for the dApp tab.
    ...(tabFavicon ? [tabFavicon] : []),
    // Source 2: Google favicon service by domain.
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
  ];
});

const faviconUrl = computed(() => faviconSources.value[faviconAttempt.value] || '');

function onFaviconError() {
  if (faviconAttempt.value < faviconSources.value.length - 1) {
    faviconAttempt.value += 1; // try next source
  } else {
    faviconFailed.value = true; // exhausted → globe fallback
  }
}

// Sign Data — domain + decoded message
const signDataDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

// Active-wallet computeds (WalletStore-backed). Declared HERE (early) rather
// than lower down because a `watch(loggedWallet)` and several computeds below
// reference `loggedWallet` — a late declaration is a temporal-dead-zone crash
// in setup(). (They only read WalletStore.state, so an early position is safe.)
const walletType = computed(() => WalletStore.state.loggedWallet?.type);
const isPrfWallet = computed(() => WalletStore.state.loggedWallet?.encryptionMethod === 'prf');
// MPC (Sign-in-with-Google) wallets are WalletType.Google but sign with a root key
// login already reconstructed (Shamir 2-of-3) and cached for the session — no spending
// password at sign time (the background resolves it from the MPC session cache via
// resolveSignPrivateKeyBytes). Mirrors useTransactionSigning's send-flow handling; the
// dApp-sign panes must NOT show the password field for these (see PR 829).
const isMpcWallet = computed(() => WalletStore.state.loggedWallet?.encryptionMethod === 'mpc');
const loggedWallet = computed(() => WalletStore.state.loggedWallet);
const keys = computed(() => WalletStore.state.keys);
const utxos = computed(() => WalletStore.state.utxos);
// Ledger transport picker (false = WebUSB, true = WebBLE). User-selected, not
// derived: `connectionType` was never persisted on the wallet record, so the old
// computed was always false and every side-panel Ledger sign forced WebUSB —
// a Bluetooth-paired Nano X is absent from the USB chooser, so signing died on
// "requestDevice ... No device selected". Only offered when `btSupported`.
const isBT = ref(false);

// ── Midnight makeTransfer (DApp Connector) — approval preview ────────────────
// Phase 2: native-NIGHT unshielded transfers. The desiredOutputs `value`s
// arrive as base-unit decimal STRINGS (the page bridge stringifies the bigint);
// display them in NIGHT for the user.
type ConnectorDesiredOutput = { kind: string; type?: string; value: string; recipient: string };

const makeTransferDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

const makeTransferOutputs = computed<ConnectorDesiredOutput[]>(() => {
  const data = currentRequest.value?.payload?.data as { desiredOutputs?: ConnectorDesiredOutput[] } | undefined;
  return Array.isArray(data?.desiredOutputs) ? (data!.desiredOutputs as ConnectorDesiredOutput[]) : [];
});

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
// Format base-unit NIGHT (bigint or decimal string) for display. Mirrors
// MidnightSendDialog.formattedAvailable — a chain-specific unit conversion, not
// a fork of the canonical price formatters in shared/utils/format.
function formatNightBase(baseUnits: string | bigint): string {
  let value: bigint;
  try {
    value = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
  } catch {
    return '0';
  }
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const frac = remainder.toString().padStart(MIDNIGHT_DECIMALS.NIGHT, '0').replace(/0+$/, '');
  return frac ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US');
}

const makeTransferTotalDisplay = computed(() => {
  let total = 0n;
  for (const o of makeTransferOutputs.value) {
    try {
      total += BigInt(o.value);
    } catch {
      /* skip unparseable — BG already validated, this is display-only */
    }
  }
  return formatNightBase(total);
});

// Network-aware ticker — mirror MidnightSendDialog's nightCurrency (mainnet
// 'NIGHT' vs preview/testnet 'tNIGHT') rather than hardcoding, so the connector
// approval and the dashboard show the same unit for the same asset.
const nightCurrency = computed(() =>
  loggedWallet.value?.network === Network.MAINNET ? 'NIGHT' : 'tNIGHT',
);

// ── CIP-30 signData preview: strict decode, WYSIWYS ─────────────────────────
// Mirrors the Midnight signData codec's own rationale exactly: Buffer.from(x,
// 'hex') is lenient (silently truncates at the first invalid character
// instead of throwing), and the ACTUAL signing path (createSignDataBuilder in
// converter.ts) uses that same lenient decode. Gating every Sign button below
// on !signDataDecodeError means malformed input never reaches the signer, so
// by the time signing happens the lenient decode has no invalid input left to
// diverge from this preview on.
const signDataRawPayload = computed(() =>
  currentRequest.value?.payload?.message || currentRequest.value?.payload?.payload || ''
);
// payload.address is signed against (see signDataNormal/signDataPrf/signDataHw
// below) but was never shown — the user could not see which key attests.
const signDataAddress = computed(() => currentRequest.value?.payload?.address || '');

const signDataDecodeError = computed(() => {
  if (!signDataRawPayload.value) return false;
  try {
    decodeSignDataPayload(signDataRawPayload.value, 'hex');
    return false;
  } catch (e) {
    console.error('[DApp] Malformed signData payload:', e);
    return true;
  }
});

const signDataMessage = computed(() => {
  const payload = signDataRawPayload.value;
  if (!payload || signDataDecodeError.value) return '';
  const bytes = decodeSignDataPayload(payload, 'hex');
  const asUtf8 = Buffer.from(bytes).toString('utf-8');
  // Same printable-character idiom already used by decodeAssetNameHex above —
  // show hex rather than mangled/misleading text for non-printable payloads.
  const isPrintable = /^[\x20-\x7e\r\n\t]*$/.test(asUtf8);
  return isPrintable ? asUtf8 : `0x${Buffer.from(bytes).toString('hex')}`;
});

// ── Bitcoin: PSBT + message signing ────────────────────────────────────────
// Password/PRF paths mirror the popup's BitcoinSignPsbt.vue/BitcoinSignMessage.vue
// exactly (same MessageTypes.BITCOIN_DAPP_SIGN_PSBT/MESSAGE handler, proven
// correct). Hardware wallets (Ledger/Trezor/Keystone) are NOT ported here:
// the popup's own Ledger/Trezor calls pass arguments and read a
// `signedPsbtHex` field that no longer exist on the current
// bitcoinHardwareSigner.ts API (it now returns {signedPsbt, txHex, txId} from
// a unified signPsbtWithHardwareWallet, added in the same commit as the
// popup view yet never wired to it) — that path silently always throws
// "Ledger/Trezor signing failed" today regardless of whether the device
// signed successfully. Rather than port that bug or guess at the Keystone
// QR/UR bridging without hardware to verify against, hardware wallets get an
// honest "not supported here yet" decline-only state — the same pattern
// Midnight's own signData branch already uses for its unsupported wallet
// types (see below).

const btcPsbtInfo = ref<{ inputs: number; outputs: number } | null>(null);
watch(
  () => currentRequest.value?.method === 'btcSignPsbt' ? (currentRequest.value?.payload as { psbtHex?: string })?.psbtHex : undefined,
  async (psbtHex) => {
    btcPsbtInfo.value = null;
    if (!psbtHex) return;
    try {
      const bitcoin = await import('bitcoinjs-lib');
      let psbt;
      try { psbt = bitcoin.Psbt.fromHex(psbtHex); }
      catch { psbt = bitcoin.Psbt.fromBase64(psbtHex); }
      btcPsbtInfo.value = { inputs: psbt.data.inputs.length, outputs: psbt.data.outputs.length };
    } catch (e) {
      console.error('[DApp] Failed to decode Bitcoin PSBT for preview:', e);
    }
  },
  { immediate: true },
);

const btcMessageText = computed(() => {
  if (currentRequest.value?.method !== 'btcSignMessage') return '';
  return (currentRequest.value.payload as { message?: string })?.message || '';
});
const btcMessageSigningType = computed<'ecdsa' | 'bip322-simple'>(() => {
  if (currentRequest.value?.method !== 'btcSignMessage') return 'ecdsa';
  return ((currentRequest.value.payload as { type?: string })?.type as 'ecdsa' | 'bip322-simple') || 'ecdsa';
});

async function signBtcPsbtNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';
  try {
    const { psbtHex, options } = currentRequest.value.payload as { psbtHex: string; options?: unknown };
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_PSBT,
      data: { psbtHex, options, password: spendingPassword.value },
    }) as { data: { success: boolean; signedHex?: string; error?: string } };
    if (!response?.data?.success) throw new Error(response?.data?.error || 'Signing failed');
    approve(response.data.signedHex);
    spendingPassword.value = '';
  } catch (e) {
    console.error('[DApp] Bitcoin PSBT sign error:', e);
    signError.value = e instanceof Error ? e.message : 'Signing failed';
  } finally {
    signing.value = false;
  }
}

async function signBtcPsbtPrf(pkBytes: Uint8Array) {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';
  try {
    const { psbtHex, options } = currentRequest.value.payload as { psbtHex: string; options?: unknown };
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_PSBT,
      data: { psbtHex, options, privateKeyBytes: Array.from(pkBytes) },
    }) as { data: { success: boolean; signedHex?: string; error?: string } };
    if (!response?.data?.success) throw new Error(response?.data?.error || 'Signing failed');
    approve(response.data.signedHex);
  } catch (e) {
    console.error('[DApp] Bitcoin PSBT PRF sign error:', e);
    signError.value = e instanceof Error ? e.message : 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

async function signBtcMessageNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE,
      data: { message: btcMessageText.value, type: btcMessageSigningType.value, password: spendingPassword.value },
    }) as { data: { success: boolean; signature?: unknown; error?: string } };
    if (!response?.data?.success) throw new Error(response?.data?.error || 'Signing failed');
    approve(response.data.signature);
    spendingPassword.value = '';
  } catch (e) {
    console.error('[DApp] Bitcoin message sign error:', e);
    signError.value = e instanceof Error ? e.message : 'Signing failed';
  } finally {
    signing.value = false;
  }
}

async function signBtcMessagePrf(pkBytes: Uint8Array) {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BITCOIN_DAPP_SIGN_MESSAGE,
      data: { message: btcMessageText.value, type: btcMessageSigningType.value, privateKeyBytes: Array.from(pkBytes) },
    }) as { data: { success: boolean; signature?: unknown; error?: string } };
    if (!response?.data?.success) throw new Error(response?.data?.error || 'Signing failed');
    approve(response.data.signature);
  } catch (e) {
    console.error('[DApp] Bitcoin message PRF sign error:', e);
    signError.value = e instanceof Error ? e.message : 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// PRF wallets need the WebAuthn ceremony (same cross-window pattern as
// signPrf/signDataPrf above) before either Bitcoin signer can run.
async function runBtcPrf(onSuccess: (pkBytes: Uint8Array) => Promise<void>) {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';
  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });
    await onSuccess(pkBytes);
  } catch (e) {
    console.error('[DApp] Bitcoin PRF auth error:', e);
    signError.value = e instanceof Error ? e.message : 'PassKey authentication failed';
    signing.value = false;
  }
}

// ── Midnight DApp Connector: signData preview ──────────────────────────────
// Shows the ACTUAL decoded bytes that will be signed (hex-encoded), matching
// exactly what walletBg.signMidnightConnectorData signs — never the raw
// un-decoded wire string. See midnightSignDataCodec.ts: Buffer.from(str,
// 'hex'|'base64') is lenient (silently truncates/skips invalid characters
// instead of throwing), so a naive raw-string preview could show the user a
// long, plausible string while a malicious dapp gets only a short,
// attacker-chosen prefix actually signed. Malformed input blocks signing
// entirely rather than rendering a partial/misleading preview.
const midnightSignDataEncoding = computed<MidnightSignDataEncoding>(() =>
  (currentRequest.value?.payload?.data?.options?.encoding ?? 'text') as MidnightSignDataEncoding
);
const midnightSignDataRaw = computed(() => currentRequest.value?.payload?.data?.data ?? '');
// Two independent, pure computeds (rather than one computed that mutates a
// ref as a side effect) — a getter mutating unrelated state is fragile here
// specifically because the template gates on `midnightSignDataDecodeError`
// via v-if/v-else: if the mutation only happened inside the OTHER branch's
// computed, the error flag would never update while that branch is hidden.
const midnightSignDataDecodeError = computed(() => {
  if (midnightSignDataEncoding.value === 'text') return false;
  try {
    decodedPayloadHexPreview(midnightSignDataRaw.value, midnightSignDataEncoding.value);
    return false;
  } catch (e) {
    console.error('[DApp] Malformed Midnight signData payload:', e);
    return true;
  }
});
const midnightSignDataMessage = computed(() => {
  const encoding = midnightSignDataEncoding.value;
  if (encoding === 'text') return midnightSignDataRaw.value;
  try {
    return `0x${decodedPayloadHexPreview(midnightSignDataRaw.value, encoding)}`;
  } catch {
    return '';
  }
});

// ── Sign Tx — decoded summary so users see what they're signing ──

interface SignTxAssetInfo {
  unit: string;
  label: string;             // human-readable name (ticker, asset_name, or "Unknown token")
  quantity: string;          // raw quantity as string (always integer)
  formattedQuantity: string; // decimal-adjusted quantity for display (e.g. "94.07059" for 94070590 USDM @ 6 decimals)
}

type OutputKind = 'change' | 'external';

interface SignTxOutputSummary {
  address: string;
  truncatedAddress: string;
  ada: string;
  kind: OutputKind;
  isOwn: boolean; // convenience: kind !== 'external'
  assets: SignTxAssetInfo[];
  // Compact pill label: empty if no assets, single token name if one, "+N" if many
  assetPillLabel: string;
}

interface SignTxCertificateRow {
  label: string;       // human-readable certificate type (mirrors TransactionDetails.vue's getCertificateType)
  poolId?: string;      // truncated bech32 pool id, when present (delegation/registration/retirement)
  depositAda?: string;  // formatted ADA deposit, when present (registration certs)
  drepSentinel?: string; // 'alwaysAbstain' | 'alwaysNoConfidence' — only for sentinel DRep targets
}

interface SignTxMintRow {
  label: string;            // resolved asset name or 'Unknown token'
  formattedQuantity: string; // absolute value, decimal-adjusted
  isBurn: boolean;
}

interface SignTxSummary {
  outputs: SignTxOutputSummary[];
  /** Null when no withdrawals; the shared card uses this to render the row. */
  withdrawal: TxDetailsWithdrawal | null;
  totals: TxDetailsTotals;
  isInternal: boolean;
  // Non-output intents — certs/mint/collateral/metadata. All empty/falsy for
  // an ordinary payment. When any of these is present, `isInternal` is forced
  // false even if every output happens to return to the wallet: a tx that
  // delegates stake while returning all ADA to you is NOT "just moving money
  // between your own addresses".
  certificates: SignTxCertificateRow[];
  mints: SignTxMintRow[];
  collateralCount: number;
  hasMetadata: boolean;
  // TTL — only the absolute slot is computed here. The live "in Xh Ym Zs" string
  // is derived in `ttlDisplay` so the expensive CBOR parse below doesn't re-run
  // every tick of the 1-second timer.
  ttlSlot: number | null;
}

// ── Live 1-second clock for the TTL countdown ──────────────────────────────
// Only ticks while a signTx request is visible — no point burning CPU when the
// overlay is idle. Re-renders `ttlDisplay` every second by mutating `nowMs`.
const nowMs = ref(Date.now());
let ttlTickHandle: ReturnType<typeof setInterval> | null = null;

function startTtlTicker() {
  if (ttlTickHandle) return;
  nowMs.value = Date.now();
  ttlTickHandle = setInterval(() => { nowMs.value = Date.now(); }, 1000);
}

function stopTtlTicker() {
  if (ttlTickHandle) {
    clearInterval(ttlTickHandle);
    ttlTickHandle = null;
  }
}

watch(
  () => isVisible.value && currentRequest.value?.method === 'signTx',
  (active) => { if (active) startTtlTicker(); else stopTtlTicker(); },
  { immediate: true }
);

onBeforeUnmount(stopTtlTicker);

// Two separate sets so we can tell residual change apart from explicit self-outputs.
const paymentAddresses = computed<Set<string>>(() => {
  const set = new Set<string>();
  const k = WalletStore.state.keys;
  if (k?.payment) for (const p of k.payment) set.add(p.address);
  return set;
});

const changeAddresses = computed<Set<string>>(() => {
  const set = new Set<string>();
  const k = WalletStore.state.keys;
  if (k?.change) for (const p of k.change) set.add(p.address);
  return set;
});

function classifyAddress(addr: string): OutputKind {
  if (changeAddresses.value.has(addr)) return 'change';
  if (paymentAddresses.value.has(addr)) return 'payment';
  return 'external';
}

function formatLovelace(lovelace: bigint): string {
  // 6 decimals, trim trailing zeros but keep at least 2
  const ada = Number(lovelace) / 1_000_000;
  const fixed = ada.toFixed(6);
  return fixed.replace(/(\.\d*[1-9])0+$/, '$1').replace(/\.0+$/, '.00');
}

/**
 * Format a positive number of seconds as a compact "Xh Ym Zs" / "Xm Ys" /
 * "Xs" string. The "in" prefix lives on the row label ("Expires in") so the
 * value cell is just the duration. Always includes seconds for h/m/s buckets
 * so the user sees the countdown ticking once per second; days bucket omits
 * seconds because the UI ticks faster than the resolution it would show.
 * Cardano post-Shelley uses 1 slot = 1 second so the same helper works for
 * slot-difference math. Negative or zero returns "expired".
 */
function formatRelativeSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'expired';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Detect strings that look like raw hex hashes — useful for filtering out
 * "names" that are really just unresolved asset_name fields from a metadata
 * cache miss. Hex names should never reach the user.
 */
function looksLikeHex(str: string): boolean {
  if (!str || str.length < 6) return false;
  return /^[0-9a-f]+$/i.test(str);
}

/**
 * Try to decode a hex asset name into a printable UTF-8 string. Handles CIP-67
 * label prefixes (4-byte `[0x00][12-bit label][8-bit checksum][0x00]` framing
 * used by USDM and other reference-token assets) by stripping them first.
 *
 * Returns null if the result isn't a clean printable string.
 */
function decodeAssetNameHex(assetNameHex: string): string | null {
  if (!assetNameHex) return null;
  const candidates: string[] = [];

  // CIP-67 framing: first hex nibble is 0 (top nibble of byte 0) and last
  // hex nibble of the 4-byte prefix is 0 (bottom nibble of byte 3). e.g.
  // USDM ref token: `0014df10` + `5553444d`. Strip the 8-char prefix and
  // try decoding the rest.
  if (
    assetNameHex.length > 8 &&
    assetNameHex[0] === '0' &&
    assetNameHex[7] === '0'
  ) {
    candidates.push(assetNameHex.slice(8));
  }
  // Also try the raw asset name in case CIP-67 detection missed something.
  candidates.push(assetNameHex);

  for (const hex of candidates) {
    try {
      const decoded = Buffer.from(hex, 'hex').toString('utf-8');
      // Printable ASCII only — no control chars, no replacement chars
      if (decoded && /^[\x20-\x7e]+$/.test(decoded) && decoded.trim().length > 0) {
        return decoded;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

interface KnownAssetInfo {
  name: string;
  decimals: number;
}

/**
 * Build a flat unit → {name, decimals} lookup that walks both fungible tokens
 * (`walletStore.tokens`) and NFT collections (`walletStore.collections`).
 * Filters out hex-shaped "names" (cache misses) so they don't leak to the UI.
 * NFTs default to 0 decimals (they're always whole units).
 */
const assetInfoLookup = computed<Map<string, KnownAssetInfo>>(() => {
  const map = new Map<string, KnownAssetInfo>();

  // Fungible tokens — keyed by unit, with metadata.ticker / metadata.name / metadata.decimals
  const tokens = WalletStore.state.tokens as Record<string, { metadata?: { ticker?: string; name?: string; decimals?: number } }> | undefined;
  if (tokens) {
    for (const [unit, info] of Object.entries(tokens)) {
      const candidates = [info?.metadata?.ticker, info?.metadata?.name].filter(
        (n): n is string => !!n && !looksLikeHex(n)
      );
      if (candidates.length > 0) {
        const decimals = typeof info?.metadata?.decimals === 'number' ? info.metadata.decimals : 0;
        map.set(unit, { name: candidates[0], decimals });
      }
    }
  }

  // NFT collections — keyed by policy_id, with items[].unit + items[].name. NFTs have 0 decimals.
  const collections = WalletStore.state.collections as Record<string, { name?: string; items?: { unit?: string; name?: string }[] }> | undefined;
  if (collections) {
    for (const collection of Object.values(collections)) {
      const items = collection?.items || [];
      for (const item of items) {
        if (item.unit && item.name && !looksLikeHex(item.name)) {
          map.set(item.unit, { name: item.name, decimals: 0 });
        }
      }
    }
  }

  return map;
});

/**
 * Format a raw integer token quantity with decimals applied. Uses BigInt
 * arithmetic to avoid precision loss for large values. Trims trailing zeros
 * but keeps at least one digit after the decimal point for non-whole values.
 *
 * Examples:
 *   formatTokenQuantity("94070590", 6)   → "94.07059"
 *   formatTokenQuantity("1000000000", 6) → "1000"
 *   formatTokenQuantity("1", 0)          → "1"
 *   formatTokenQuantity("12345", 2)      → "123.45"
 */
function formatTokenQuantity(rawQuantity: string, decimals: number): string {
  if (!rawQuantity) return '0';
  if (decimals <= 0) return rawQuantity;
  try {
    const raw = BigInt(rawQuantity);
    const negative = raw < 0n;
    const absRaw = negative ? -raw : raw;
    const divisor = 10n ** BigInt(decimals);
    const intPart = absRaw / divisor;
    const fracPart = absRaw % divisor;
    const intStr = intPart.toString();
    if (fracPart === 0n) return negative ? `-${intStr}` : intStr;
    // Pad fractional part to full decimal width, then trim trailing zeros
    const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    const result = `${intStr}.${fracStr}`;
    return negative ? `-${result}` : result;
  } catch {
    return rawQuantity;
  }
}

/**
 * Resolve a Cardano asset unit (policy + assetName hex) to both a human-readable
 * label and its decimals. Resolution order:
 *   1. Wallet token/NFT lookup (with hex-name filtering)
 *   2. CIP-67-aware UTF-8 decode of the asset name (decimals default to 0)
 *   3. Generic "Unknown token" placeholder (decimals default to 0)
 *
 * NEVER returns raw hex.
 */
function resolveAssetInfo(unit: string): KnownAssetInfo {
  const known = assetInfoLookup.value.get(unit);
  if (known) return known;

  if (unit.length > 56) {
    const policyId = unit.slice(0, 56);
    const assetNameHex = unit.slice(56);
    const decoded = decodeAssetNameHex(assetNameHex);
    if (decoded) {
      // Recovery hack for backends that double-hex-encode asset names (e.g. an old
      // bloxbean Asset(...) call without the 0x prefix). Use the decoded value as
      // the real asset name, rebuild the proper unit, and try the wallet lookup.
      if (looksLikeHex(decoded)) {
        const recoveredUnit = policyId + decoded;
        const recovered = assetInfoLookup.value.get(recoveredUnit);
        if (recovered) return recovered;
        // Still missed — try to decode one more level (CIP-67 on the recovered name)
        const innerDecoded = decodeAssetNameHex(decoded);
        if (innerDecoded && !looksLikeHex(innerDecoded)) {
          return { name: innerDecoded, decimals: 0 };
        }
      }
      return { name: decoded, decimals: 0 };
    }
  }

  return { name: 'Unknown token', decimals: 0 };
}

/**
 * Human-readable certificate type label. Mirrors TransactionDetails.vue's
 * getCertificateType exactly (same Cardano.CertificateType enum, same
 * strings) — that mapping is already proven correct in the dashboard's own
 * transaction detail view; duplicated here rather than imported since it's
 * a private inline function there, not exported.
 */
function getCertificateLabel(certificateType: Cardano.CertificateType): string {
  switch (certificateType) {
    case Cardano.CertificateType.StakeRegistration: return 'Stake Registration';
    case Cardano.CertificateType.StakeDeregistration: return 'Stake De-Registration';
    case Cardano.CertificateType.PoolRegistration: return 'Pool Registration';
    case Cardano.CertificateType.PoolRetirement: return 'Pool Retirement';
    case Cardano.CertificateType.StakeDelegation: return 'Stake Delegation';
    case Cardano.CertificateType.MIR: return 'MIR';
    case Cardano.CertificateType.GenesisKeyDelegation: return 'Genesis Key Delegation';
    case Cardano.CertificateType.Registration: return 'Registration';
    case Cardano.CertificateType.Unregistration: return 'Unregistration';
    case Cardano.CertificateType.VoteDelegation: return 'Vote Delegation';
    case Cardano.CertificateType.StakeVoteDelegation: return 'Stake Vote Delegation';
    case Cardano.CertificateType.StakeRegistrationDelegation: return 'Stake Registration Delegation';
    case Cardano.CertificateType.VoteRegistrationDelegation: return 'Vote Registration Delegation';
    case Cardano.CertificateType.StakeVoteRegistrationDelegation: return 'Stake Vote Registration Delegation';
    case Cardano.CertificateType.AuthorizeCommitteeHot: return 'Authorize Committee Hot';
    case Cardano.CertificateType.ResignCommitteeCold: return 'Resign Committee Cold';
    case Cardano.CertificateType.RegisterDelegateRepresentative: return 'Register Delegate Representative';
    case Cardano.CertificateType.UnregisterDelegateRepresentative: return 'Unregister Delegate Representative';
    case Cardano.CertificateType.UpdateDelegateRepresentative: return 'Update Delegate Representative';
    default: return 'Unknown certificate';
  }
}

// Raw CBOR hex of the current sign request — used by the parser below.
const txCborForSummary = computed<string | null>(() => {
  if (currentRequest.value?.method !== 'signTx') return null;
  return (currentRequest.value.payload?.tx as string | undefined) || null;
});

const signTxSummary = computed<SignTxSummary | null>(() => {
  const txCbor = txCborForSummary.value;
  if (!txCbor) return null;

  try {
    const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);
    const body = tx?.body;
    if (!body) return null;

    const rawOutputs = (body.outputs || []) as Cardano.TxOut[];
    const outputs: SignTxOutputSummary[] = rawOutputs.map((o) => {
      const addr = String(o.address);
      const kind = classifyAddress(addr);

      const assets: SignTxAssetInfo[] = [];
      const pushAsset = (unit: string, quantity: unknown) => {
        const info = resolveAssetInfo(unit);
        const rawQty = String(quantity);
        assets.push({
          unit,
          label: info.name,
          quantity: rawQty,
          formattedQuantity: formatTokenQuantity(rawQty, info.decimals),
        });
      };

      const rawAssets = o.value?.assets;
      if (rawAssets) {
        if (rawAssets instanceof Map) {
          rawAssets.forEach((quantity, unit) => pushAsset(String(unit), quantity));
        } else if (typeof rawAssets === 'object') {
          for (const [unit, quantity] of Object.entries(rawAssets as Record<string, unknown>)) {
            pushAsset(unit, quantity);
          }
        }
      }

      // Always +N regardless of count — names are surfaced via the tooltip,
      // never in the compact pill. This keeps row width predictable.
      const assetPillLabel = assets.length > 0 ? `+${assets.length}` : '';

      return {
        address: addr,
        truncatedAddress: filters.truncate(addr),
        ada: formatLovelace(BigInt(o.value?.coins ?? 0n)),
        kind,
        isOwn: kind !== 'external',
        assets,
        assetPillLabel,
      };
    });

    const feeLovelace = BigInt(body.fee ?? 0n);
    const feeAda = formatLovelace(feeLovelace);

    // Stake reward withdrawals attached to the tx — come in as fresh input
    // coin from the stake account, so they offset the "You pay" total.
    const withdrawalsRaw = (body as { withdrawals?: Array<{ quantity?: unknown; stakeAddress?: unknown }> }).withdrawals;
    const withdrawalsLovelace = Array.isArray(withdrawalsRaw)
      ? withdrawalsRaw.reduce<bigint>((acc, w) => acc + BigInt(String(w?.quantity ?? '0')), 0n)
      : 0n;
    const withdrawal: TxDetailsWithdrawal | null = withdrawalsLovelace > 0n
      ? {
          truncatedStakeAddress: filters.truncate(String(withdrawalsRaw?.[0]?.stakeAddress ?? '')),
          ada: formatLovelace(withdrawalsLovelace),
        }
      : null;

    // ── Certificates: delegation/registration/DRep/vote actions. These carry
    // NO output of their own — a tx that delegates stake while returning
    // every ADA to the wallet must not read as "just an internal transfer"
    // (see isInternal below). Mirrors TransactionDetails.vue's proven
    // Cardano.CertificateType mapping via getCertificateLabel above.
    const rawCertificates = (body.certificates || []) as Cardano.Certificate[];
    const certificates: SignTxCertificateRow[] = rawCertificates.map((cert) => {
      const row: SignTxCertificateRow = {
        label: getCertificateLabel(cert.__typename as Cardano.CertificateType),
      };
      if ('poolId' in cert && cert.poolId) {
        row.poolId = filters.truncate(String(cert.poolId));
      }
      if ('deposit' in cert && cert.deposit != null) {
        row.depositAda = formatLovelace(BigInt(cert.deposit as unknown as bigint));
      }
      if ('dRep' in cert && cert.dRep && typeof cert.dRep === 'object' && '__typename' in cert.dRep) {
        const drepTypename = (cert.dRep as { __typename: string }).__typename;
        if (drepTypename === 'AlwaysAbstain') row.drepSentinel = 'alwaysAbstain';
        else if (drepTypename === 'AlwaysNoConfidence') row.drepSentinel = 'alwaysNoConfidence';
      }
      return row;
    });

    // ── Mint/burn: body.mint is a Cardano.TokenMap (Map<AssetId, bigint>);
    // negative quantity = burn, positive = mint (standard Cardano semantics).
    // Reuses the same asset-name resolution as output token pills.
    const mints: SignTxMintRow[] = [];
    const rawMint = body.mint as Map<string, bigint> | Record<string, unknown> | undefined;
    if (rawMint) {
      const mintEntries: [string, unknown][] = rawMint instanceof Map
        ? Array.from(rawMint.entries())
        : Object.entries(rawMint);
      for (const [unit, quantity] of mintEntries) {
        const qty = BigInt(String(quantity));
        const info = resolveAssetInfo(unit);
        const absQty = qty < 0n ? -qty : qty;
        mints.push({
          label: info.name,
          formattedQuantity: formatTokenQuantity(absQty.toString(), info.decimals),
          isBurn: qty < 0n,
        });
      }
    }

    // ── Collateral: count only. Resolving the reserved ADA amount would need
    // a wallet-UTxO lookup per txId#index; showing a wrong amount is worse
    // than showing none, so this stays a plain count until that's verified.
    const collateralCount = Array.isArray(body.collaterals) ? body.collaterals.length : 0;

    // ── Metadata presence flag only — content is not decoded/shown here.
    const hasMetadata = !!(body as { auxiliaryDataHash?: unknown }).auxiliaryDataHash;

    // Sum lovelace going to external addresses (excludes change AND self-payments)
    const totalSendingLovelace = outputs.reduce<bigint>((sum, o) => {
      if (o.isOwn) return sum;
      return sum + BigInt(Math.round(parseFloat(o.ada) * 1_000_000));
    }, 0n);
    const totalSendingAda = formatLovelace(totalSendingLovelace);

    // What the user is actually paying out of pocket: ADA leaving the wallet +
    // network fee, minus any rewards pulled in via withdrawals.
    const youPayLovelace = feeLovelace + totalSendingLovelace - withdrawalsLovelace;
    const youPayAda = formatLovelace(youPayLovelace < 0n ? 0n : youPayLovelace);

    // "Internal transfer" = every output address belongs to the wallet AND
    // there is no certificate/mint/collateral action attached. A tx that
    // delegates stake or mints an asset is never "just moving money between
    // your own addresses", even if every output happens to return to you.
    const isInternal = outputs.length > 0 && outputs.every(o => o.isOwn)
      && certificates.length === 0 && mints.length === 0 && collateralCount === 0;

    // TTL: invalidHereafter is the absolute slot at which this tx becomes
    // invalid. We only capture the absolute slot here — the live "in Xh Ym Zs"
    // string is computed in `ttlDisplay` so the timer can tick once per second
    // without re-running this CBOR parse.
    const invalidHereafter = body.validityInterval?.invalidHereafter;
    const ttlSlot = invalidHereafter !== undefined && invalidHereafter !== null
      ? Number(invalidHereafter)
      : null;

    return {
      outputs,
      withdrawal,
      totals: {
        totalSendingAda,
        feeAda,
        withdrawalAda: withdrawalsLovelace > 0n ? formatLovelace(withdrawalsLovelace) : undefined,
        youPayAda,
        isInternal,
      },
      isInternal,
      certificates,
      mints,
      collateralCount,
      hasMetadata,
      ttlSlot,
    };
  } catch (e) {
    console.error('[DAppOverlay] Failed to decode signTx CBOR:', e);
    return null;
  }
});

// Phase 1b: on CBOR decode failure, signTxSummary is null and the details
// card simply doesn't render (v-if="signTxSummary" below) while the
// password field and Sign button rendered normally beneath it — an
// unguarded blind-sign screen. This flag drives a blocking banner instead,
// requiring the same explicit "I understand" acknowledgment as any other
// undecodable/high-risk transaction.
const signTxDecodeFailed = computed(
  () => currentRequest.value?.method === 'signTx' && !!txCborForSummary.value && !signTxSummary.value
);
const decodeFailedAck = ref(false); // reset alongside the other per-request state, see the watcher below

// Live TTL display — re-runs every 1s tick.
//
// Projection: Cardano post-Shelley uses 1 slot = 1 second, so we extrapolate
// the chain head from the last gero-sync tip update:
//   projectedCurrentSlot = tip.slot + (now - tip.time)
// This way the countdown ticks smoothly between the ~20s block updates that
// arrive via the WebSocket.
const ttlDisplay = computed<{ relative: string | null; expired: boolean }>(() => {
  const ttlSlot = signTxSummary.value?.ttlSlot;
  if (ttlSlot == null) return { relative: null, expired: false };

  // TTL projection is Cardano-only (slot-based). A BTC tip has no slot.
  const tip = networkStore.tip;
  const tipSlot = tip && !isBitcoinTip(tip) ? tip.slot : undefined;
  const tipTimeMs = tip?.time;
  if (tipSlot == null || tipTimeMs == null) return { relative: null, expired: false };

  const elapsedSeconds = Math.max(0, Math.floor((nowMs.value - Number(tipTimeMs)) / 1000));
  const projectedSlot = Number(tipSlot) + elapsedSeconds;
  const secondsRemaining = ttlSlot - projectedSlot;
  return {
    relative: formatRelativeSeconds(secondsRemaining),
    expired: secondsRemaining <= 0,
  };
});

// Network mismatch: does any EXTERNAL output address belong to a different
// network (mainnet vs testnet) than the active wallet? Cardano addresses only
// encode mainnet-vs-testnet in their header byte, not which specific testnet
// (preprod/preview/sanchonet all read as Testnet) — so this catches "wallet
// is on mainnet but this address is testnet" and its inverse, not a
// preprod-vs-preview mixup. Own/change outputs are skipped (trivially
// correct — they came from the wallet's own key set).
const signTxNetworkMismatch = computed(() => {
  const summary = signTxSummary.value;
  const wallet = loggedWallet.value;
  if (!summary || !wallet) return false;
  const expectedNetworkId = wallet.network === Network.MAINNET
    ? Cardano.NetworkId.Mainnet
    : Cardano.NetworkId.Testnet;
  return summary.outputs.some((o) => {
    if (o.isOwn) return false;
    const parsed = Cardano.Address.fromString(o.address);
    if (!parsed) return false; // unparseable — don't false-flag on a shape we don't recognize
    return parsed.getNetworkId() !== expectedNetworkId;
  });
});
const networkMismatchAck = ref(false);

// Proportional risk friction: the Cardano Shield badge was purely
// decorative (rendered in TransactionDetailsCard's header, never gated
// anything). Quiet when safe — low/medium/unverified show only the existing
// badge, no extra friction — blocking only when Shield says "high".
const highRiskAck = ref(false);

// Single gate for every signTx Sign button: expired TTL, an unacknowledged
// decode failure, network mismatch, or high Cardano Shield risk. Kept as one
// computed so all five wallet-type branches (password/PRF/Ledger/Trezor/
// Keystone) can't drift out of sync.
const signTxBlocked = computed(() =>
  ttlDisplay.value.expired
  || (signTxDecodeFailed.value && !decodeFailedAck.value)
  || (signTxNetworkMismatch.value && !networkMismatchAck.value)
  || (txRiskBadge.value?.label === 'high' && !highRiskAck.value)
);

// Wallet-switch mid-request: background.ts already refuses to honor a
// response from a DIFFERENT wallet than the one the request was issued
// against (see the wallet-switch guard in the port layer), so a signature
// produced here can never reach the wrong dApp — but letting the user type a
// password and sign into a response that's guaranteed to be discarded is
// still a bad, confusing experience. Auto-reject as soon as the switch
// happens instead.
watch(loggedWallet, (newWallet, oldWallet) => {
  if (!currentRequest.value || !oldWallet || !newWallet) return;
  if (newWallet.id === oldWallet.id) return;
  if (currentRequest.value.method === 'midnight_connect') rejectMidnightConnect();
  else if (currentRequest.value.method === 'midnight_signData') rejectMidnightSignData();
  else if (currentRequest.value.method === 'midnight_makeTransfer') rejectMidnightMakeTransfer();
  else reject('wallet_changed');
});

// ── Cardano Shield risk scan (matches popup SignTx.vue behavior) ──

const txRisk = ref<TxScanResponse | null>(null);
const txRiskLoading = ref(false);

/**
 * Map the API score to a badge config. The score field may come back as a numeric
 * enum (0/1/2), a string ('low'/'medium'/'high'), or 'unknown' on scan failure —
 * handle all forms defensively. Always returns SOMETHING when a scan completed,
 * including a neutral "unverified" state, so the user always sees a Cardano Shield
 * indicator in the header.
 */
const txRiskBadge = computed<{ color: string; icon: string; label: string } | null>(() => {
  if (!txRisk.value) return null;
  const score = txRisk.value.score as unknown;
  const scoreStr = String(score ?? '').toLowerCase();
  const isHigh = score === DappScore.high || scoreStr === 'high' || score === 2;
  const isMedium = score === DappScore.medium || scoreStr === 'medium' || score === 1;
  const isLow = score === DappScore.low || scoreStr === 'low' || score === 0;
  // CSS var, not a Vuetify theme name: riskBadge.color feeds both a v-icon
  // :color (which accepts var(--...)) AND an inline :style color/border-color
  // on the badge, where a theme name like 'error' would be invalid CSS.
  if (isHigh) return { color: 'var(--g-error)', icon: 'mdi-shield-alert', label: 'high' };
  if (isMedium) return { color: 'var(--g-warning)', icon: 'mdi-shield-half-full', label: 'medium' };
  if (isLow) return { color: 'var(--g-success)', icon: 'mdi-shield-check', label: 'low' };
  // Scan completed but score is 'unknown' or unrecognized → show neutral state
  return { color: 'var(--g-text-3)', icon: 'mdi-shield-outline', label: 'unverified' };
});

// Watch the current request: when it becomes a signTx, kick off a Cardano Shield scan
watch(
  () => currentRequest.value,
  (req) => {
    txRisk.value = null;
    if (!req || req.method !== 'signTx') return;
    const txCbor = req.payload?.tx;
    if (!txCbor) return;

    // Cardano Shield only covers Cardano MAINNET. On preprod/testnet — or any
    // non-Cardano chain — the scan endpoint has no data and just times out, and
    // the "Unverified" badge is misleading noise. Skip the scan and leave txRisk
    // null so no badge shows (mirrors dashboard SummaryStep gate, PR 805).
    const w = WalletStore.state.loggedWallet;
    if (w?.chain !== Blockchain.CARDANO || w?.network !== Network.MAINNET) return;

    // Use the first non-own recipient if any (for external txs), otherwise own address
    // (for internal/self transfers — Cardano Shield can still scan the URL/CBOR)
    const summary = signTxSummary.value;
    const toAddress = summary?.outputs.find(o => !o.isOwn)?.address
      || WalletStore.state.loggedWallet?.baseAddress
      || '';
    const fromAddress = WalletStore.state.loggedWallet?.baseAddress || '';
    const url = req.payload?.website || '';

    // Neutral fallback used when the scan times out, errors, or returns an empty body.
    // The badge maps this to the "Unverified" state instead of hiding entirely so the
    // user always sees a Cardano Shield indicator in the header.
    const unknownRisk = {
      score: 'unknown',
      addressRisk: 'unknown',
      domainRisk: 'unknown',
      receivingRisk: false,
    } as unknown as TxScanResponse;

    txRiskLoading.value = true;
    Promise.race([
      cardanoShieldApi.scanTx({ cborHex: txCbor, toAddress, fromAddress, url }),
      new Promise<TxScanResponse>((_, reject) =>
        setTimeout(() => reject(new Error('Cardano Shield scan timeout')), 8000)
      ),
    ])
      .then((res) => {
        txRisk.value = res || unknownRisk;
      })
      .catch((e) => {
        // Soft-fail: badge falls back to "unverified". Keep the warn for ops visibility.
        console.warn('[DAppOverlay] Cardano Shield scan failed:', e);
        txRisk.value = unknownRisk;
      })
      .finally(() => {
        txRiskLoading.value = false;
      });
  },
  { immediate: true }
);

// Keystone state
const showKeystoneDialog = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneUseHash = ref(false);

// NOTE: walletType / isPrfWallet / loggedWallet / keys / utxos / isBT are
// declared EARLY (right after signDataDomain) — a `watch(loggedWallet)` and
// several computeds above reference them, so declaring them here (late) is a
// temporal-dead-zone crash in setup(). Do not move them back down.

// Reset state when request changes
watch(currentRequest, () => {
  spendingPassword.value = '';
  showPassword.value = false;
  signing.value = false;
  signError.value = '';
  faviconFailed.value = false;
  faviconAttempt.value = 0;
  decodeFailedAck.value = false;
  networkMismatchAck.value = false;
  highRiskAck.value = false;
});

function rejectSign() {
  spendingPassword.value = '';
  signError.value = '';
  reject('user_rejected');
}

function getTxCbor(): string {
  return currentRequest.value?.payload?.tx;
}

// ── Normal wallet: password signing ──
// MPC (Google) wallets reach here too — they carry no spending password (the
// background resolves the session-cached key), so only require one for non-MPC.
async function signNormal() {
  if (!currentRequest.value) return;
  if (!isMpcWallet.value && !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const payload = currentRequest.value.payload;
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: payload.tx,
        partialSign: payload.partialSign,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: payload.mergeWitnesses || false,
      }
    }) as { data: { witnesses?: string; error?: string } };

    if (witnessResult.data.error) throw new Error(witnessResult.data.error);
    approve(witnessResult.data.witnesses);
    spendingPassword.value = '';
  } catch (e: unknown) {
    console.error('[DApp] Normal sign error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── PRF wallet: PassKey signing ──
async function signPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const payload = currentRequest.value.payload;
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: payload.tx,
        partialSign: payload.partialSign,
        password: '',
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: payload.mergeWitnesses || false,
        privateKeyBytes: Array.from(pkBytes),
      }
    }) as { data: { witnesses?: string; error?: string } };

    if (witnessResult.data.error) throw new Error(witnessResult.data.error);
    approve(witnessResult.data.witnesses);
  } catch (e: unknown) {
    console.error('[DApp] PRF sign error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

/**
 * Run the Bluetooth leg of Ledger signing in its own small browser window and
 * return the witness set it produces.
 *
 * Chromium anchors the Web Bluetooth device chooser to a browser window's
 * toolbar. Where there is no toolbar the request is reported as cancelled and
 * no dialog is ever drawn — verified by hand on macOS across three surfaces:
 *
 *   side panel               no chooser
 *   window.open(popup=1)     no chooser
 *   normal browser window    chooser renders
 *
 * So this uses `type: 'normal'` — the window type that works — merely sized
 * down to feel like a dialog rather than taking over a tab. `type: 'popup'`
 * would look tidier still and would fail exactly as `popup=1` did. WebUSB's
 * chooser is unaffected, which is why only the BLE path needs this detour.
 *
 * The window asks for the transaction with LEDGER_BLE_READY and reports back
 * with LEDGER_BLE_RESULT. Only the transaction and the finished witness set
 * cross that boundary — key material never leaves the device. Every message is
 * checked to come from an extension page (not a content script on some web
 * page) and from this exact tab.
 */
async function signLedgerViaBleWindow(txCbor: string): Promise<string> {
  const url = chrome.runtime.getURL('index.html#/ledger-ble-sign');
  const win = await chrome.windows.create({
    url,
    type: 'normal', // MUST stay 'normal': 'popup' has no toolbar for the chooser to anchor to
    width: 460,
    height: 680,
    focused: true,
  });
  const tabId = win?.tabs?.[0]?.id;
  if (tabId === undefined) throw new Error(t('wallet.ledgerBleSignFailed'));

  const extensionBase = chrome.runtime.getURL('');

  return new Promise<string>((resolve, rejectPromise) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onRemoved.removeListener(onTabClosed);
      clearTimeout(timer);
    };

    const onMessage = (
      msg: { type?: string; payload?: Record<string, unknown> },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      // A content script running in any web page can also reach this listener
      // and would carry our own extension id, so identity is established by the
      // sender being an extension page AND being the tab we just opened.
      if (!sender.url?.startsWith(extensionBase) || sender.tab?.id !== tabId) return;

      if (msg?.type === 'LEDGER_BLE_READY') {
        sendResponse({ txCbor });
        return;
      }

      if (msg?.type === 'LEDGER_BLE_RESULT') {
        cleanup();
        const { success, witnessCbor, error, cancelled } = msg.payload || {};
        if (success && typeof witnessCbor === 'string') resolve(witnessCbor);
        else if (cancelled) rejectPromise(new Error(String(error || t('wallet.ledgerBleSignCancelled'))));
        else rejectPromise(new Error(String(error || t('wallet.ledgerBleSignFailed'))));
      }
    };

    // Closing the window is how the user cancels — it deliberately stays open
    // after a recoverable failure so they can fix the device state and retry
    // without a fresh round trip. tabs.onRemoved covers closing the window too,
    // since its only tab goes with it.
    const onTabClosed = (closedId: number) => {
      if (closedId !== tabId) return;
      cleanup();
      rejectPromise(new Error(t('wallet.ledgerBleSignCancelled')));
    };

    // Only a backstop against a permanently pending promise: closing the tab is
    // the real cancel signal, and the user may spend a while quitting Ledger
    // Live or re-pairing before they get a successful run.
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(t('wallet.ledgerBleSignTimeout')));
    }, 600000);

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onRemoved.addListener(onTabClosed);
  });
}

// ── Ledger wallet signing ──
async function signLedger() {
  if (!currentRequest.value || !loggedWallet.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const txCbor = getTxCbor();

    if (isBT.value) {
      approve(await signLedgerViaBleWindow(txCbor));
      return;
    }

    const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);

    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      tx,
      keys.value,
      utxos.value,
      true, // WebUSB — the BLE path returned above via the popup
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
      txCbor,
    );

    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    approve(witnessSet.toCbor());
  } catch (e: unknown) {
    ledgerUtils.ledgerErrorHandling(e);
    console.error('[DApp] Ledger sign error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Ledger signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Trezor wallet signing ──
async function signTrezor() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const data = { method: 'signTx', txCbor };
    const response = (featureFlagsStore.state.flags.isTrezorWebUsbEnabled
      ? await dispatchTrezor(data)
      : await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.TREZOR,
        data,
      })) as BackgroundResponse<SignTxResponse>;

    if (!response.data.success) {
      throw new Error(response.data.error || 'Trezor signing failed');
    }

    const signaturesArray = response.data.signatures as unknown as Array<[string, string]>;
    const signatures: Cardano.Signatures = new Map(signaturesArray);
    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    approve(witnessSet.toCbor());
  } catch (e: unknown) {
    console.error('[DApp] Trezor sign error:', e);
    const message = e instanceof Error ? e.message : '';
    if (message.includes('Failure_ActionCancelled') || message.includes('cancelled')) {
      signError.value = 'Transaction cancelled on Trezor';
    } else {
      signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Trezor signing failed';
    }
  } finally {
    signing.value = false;
  }
}

// ── Keystone wallet signing ──
function signKeystone() {
  if (!currentRequest.value || !loggedWallet.value) return;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const txSerialized = Serialization.Transaction.fromCbor(HexBlob(txCbor));
    const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(
      txSerialized, loggedWallet.value, utxos.value, keys.value
    );
    keystoneType.value = signRequestResponse.ur.type;
    keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
    keystoneUseHash.value = signRequestResponse.useHash;
    showKeystoneDialog.value = true;
  } catch (e: unknown) {
    console.error('[DApp] Keystone sign error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Failed to create Keystone sign request';
  }
}

async function onKeystoneScan(ur: UR) {
  try {
    const signature = parseSignature(ur);
    if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
      throw new Error('Invalid Keystone signature');
    }
    showKeystoneDialog.value = false;
    approve(signature.witnessSet);
  } catch (e: unknown) {
    console.error('[DApp] Keystone scan error:', e);
    signError.value = (e instanceof Error ? e.message : '') || 'Keystone QR scan error';
    showKeystoneDialog.value = false;
  }
}

function onKeystoneError(error: string) {
  signError.value = error || 'Keystone scan error';
  showKeystoneDialog.value = false;
}

// ── Sign Data: Normal wallet (password) ──
async function signDataNormal() {
  // MPC (Google) wallets reach here with no spending password (session-cached key).
  if (!currentRequest.value) return;
  if (!isMpcWallet.value && !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { address, payload } = currentRequest.value.payload;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: spendingPassword.value,
        accountIndex: 0,
        isUsb: true,
      },
    }) as { data: { key?: string; signature?: string; error?: string } };

    // The background resolves (does not reject) on failure, returning
    // { error }. Without this guard the error object was handed to the dApp as
    // the "signature", surfacing downstream as an opaque verify 401. Mirror the
    // popup path (DappSignData.vue) which only approves a real signature.
    if (res?.data?.error) throw new Error(res.data.error);
    if (!res?.data?.signature || !res?.data?.key) {
      throw new Error('Wallet returned an empty signature payload');
    }

    approve(res.data);
    spendingPassword.value = '';
  } catch (e: unknown) {
    console.error('[DApp] Sign data error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Sign Data: PRF wallet (PassKey) ──
async function signDataPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const { address, payload } = currentRequest.value.payload;
    const { buildSignatureAndCoseKey } = await import('@/shared/utils/converter');
    const { Bip32PrivateKey } = await import('@cardano-sdk/crypto');

    const rootKey = Bip32PrivateKey.fromBytes(pkBytes);

    // Resolve address to bech32
    let addressBech32: string;
    if (address.startsWith('addr') || address.startsWith('stake')) {
      addressBech32 = address;
    } else {
      addressBech32 = Cardano.Address.fromBytes(Buffer.from(address, 'hex')).toBech32();
    }

    // Find signing key
    const allKeys = [...keys.value.payment, ...keys.value.change, ...keys.value.stake];
    const foundKey = allKeys.find(k => k.address === addressBech32);
    if (!foundKey?.path) throw new Error('Address not found in wallet keys');

    const pathParts = foundKey.path.split('/');
    const role = parseInt(pathParts[4].replace("'", ""), 10);
    const index = parseInt(pathParts[5].replace("'", ""), 10);

    const accountKey = rootKey.derive([2147485500, 2147485463, 2147483648]);
    const signingKey = accountKey.derive([role, index]).toRawKey();

    // Get address bytes for COSE_Key. Address.toBytes() returns a HexBlob
    // (hex STRING) — decode to real bytes, else the emurgo WASM coerces the
    // string per-character and embeds a garbage address (verify 401).
    const addressBytes = address.startsWith('addr') || address.startsWith('stake')
      ? Buffer.from(Cardano.Address.fromBech32(address).toBytes(), 'hex')
      : Buffer.from(address, 'hex');

    const signatureData = buildSignatureAndCoseKey(addressBytes, payload, signingKey);
    approve(signatureData);
  } catch (e: unknown) {
    console.error('[DApp] PRF sign data error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Sign Data: Hardware wallet (Ledger/Trezor via background) ──
async function signDataHw() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { address, payload } = currentRequest.value.payload;

    // Trezor: route through the Trezor handler (WebUSB when isTrezorWebUsbEnabled
    // is on, else the SW bridge), exactly like the popup DappSignData view. The
    // generic SIGN_DATA path only implements Ledger and otherwise falls through to
    // a spending-password sign — which is why Trezor signData failed with
    // "Wrong password". Maps the Trezor response's signatureData -> { signature, key }.
    if (walletType.value === WalletType.Trezor) {
      const data = { method: 'signData', address, payload, accountIndex: 0 };
      const response = (featureFlagsStore.state.flags.isTrezorWebUsbEnabled
        ? await dispatchTrezor(data)
        : await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.TREZOR,
          data,
        })) as BackgroundResponse<{ signatureData?: { signatureHex: string; signingPublicKeyHex: string }; error?: string }>;

      if (!response.data.success || !response.data.signatureData) {
        throw new Error(response.data.error || 'Trezor signing failed');
      }
      approve({
        signature: response.data.signatureData.signatureHex,
        key: response.data.signatureData.signingPublicKeyHex,
      });
      return;
    }

    // Ledger (and any other USB HW handled by the SW SIGN_DATA path)
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: '',
        accountIndex: 0,
        isUsb: true,
      },
    }) as { data: { key?: string; signature?: string; error?: string } };

    if (res?.data?.error) throw new Error(res.data.error);
    if (!res?.data?.signature || !res?.data?.key) {
      throw new Error('Wallet returned an empty signature payload');
    }

    approve(res.data);
  } catch (e: unknown) {
    console.error('[DApp] HW sign data error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Midnight DApp Connector ────────────────────────────────────────────────
// `useDAppOverlay`'s reject(reason) only carries a plain string across the
// mini-gero port (background's sendToMiniGero rejects with
// `new Error(String(response.error))`), but the connector spec needs a
// structured {type, code, reason, message} shape so dapps can branch on
// `code` (Rejected vs PermissionRejected etc). JSON-encode it into that
// string; background.ts's handlers JSON.parse it back out.
function midnightError(code: string, reason: string): string {
  return JSON.stringify({ type: 'DAppConnectorAPIError', code, reason, message: reason });
}

function approveMidnightConnect() {
  // Whitelisting the origin (WalletStore.addConnectedDapp) happens in
  // background.ts's MIDNIGHT_METHOD.connect handler once it sees
  // `response.data === true` — mirrors exactly how the CIP-30 `enable` mini-
  // gero path is split (background owns the whitelist write, the panel only
  // signals approve/reject).
  approve(true);
}

function rejectMidnightConnect() {
  reject(midnightError(MidnightErrorCode.Rejected, 'User declined the connection request'));
}

function rejectMidnightSignData() {
  spendingPassword.value = '';
  signError.value = '';
  reject(midnightError(MidnightErrorCode.Rejected, 'User declined the signing request'));
}

// Escape on the trust sheet is a deliberate, recoverable reject — but
// Midnight's reject wrappers pass a JSON-shaped DAppConnectorAPIError, not
// useDAppOverlay's default plain string, so route through those instead of
// calling reject() bare for those two methods.
function onEscapeReject() {
  if (currentRequest.value?.method === 'midnight_connect') {
    rejectMidnightConnect();
  } else if (currentRequest.value?.method === 'midnight_signData') {
    rejectMidnightSignData();
  } else if (currentRequest.value?.method === 'midnight_makeTransfer') {
    rejectMidnightMakeTransfer();
  } else {
    reject();
  }
}

async function signMidnightDataNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { data, options } = currentRequest.value.payload.data;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_MIDNIGHT_CONNECTOR_DATA,
      data: { data, options, password: spendingPassword.value },
    }) as { data: { success: boolean; signature?: unknown; error?: string } };

    if (!res?.data?.success) throw new Error(res?.data?.error || 'Failed to sign data');
    approve(res.data.signature);
    spendingPassword.value = '';
  } catch (e: unknown) {
    console.error('[DApp] Midnight sign data error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

async function signMidnightDataPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    // WebAuthn doesn't reliably work from inside the side panel's own
    // window — same cross-window popup workaround as signDataPrf() above,
    // but requesting RAW PRF output (mode=rawPrf) rather than a Cardano-
    // decrypted private key, since Midnight decrypts its mnemonic from the
    // raw PRF output directly (see walletBg.signMidnightConnectorData).
    const popupUrl = chrome.runtime.getURL('index.html?mode=rawPrf#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const prfBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, prfOutput, error } = event.data.payload;
          if (success && prfOutput) resolve(new Uint8Array(prfOutput));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const { data, options } = currentRequest.value.payload.data;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_MIDNIGHT_CONNECTOR_DATA,
      data: { data, options, prfSecret: Array.from(prfBytes) },
    }) as { data: { success: boolean; signature?: unknown; error?: string } };

    if (!res?.data?.success) throw new Error(res?.data?.error || 'Failed to sign data');
    approve(res.data.signature);
  } catch (e: unknown) {
    console.error('[DApp] Midnight PRF sign data error:', e);
    signError.value = (e instanceof Error ? friendlyTxError(e) : '') || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Midnight makeTransfer (DApp Connector) ─────────────────────────────────
// Build + DUST-balance + sign (but do NOT submit) the native-NIGHT unshielded
// transfer, then hand the serialized tx back to the dapp via approve({ tx }).
// The dapp submits it with submitTransaction, which proves + binds server-side.
// Reuses the exact dashboard-send path (buildAndSignUnshieldedTransfer) so the
// tx is built identically to a normal send. The mnemonic is decrypted only in
// the background; the panel passes credentials and never sees keys.
function rejectMidnightMakeTransfer() {
  spendingPassword.value = '';
  signError.value = '';
  reject(midnightError(MidnightErrorCode.Rejected, 'User declined the transfer request'));
}

async function buildMidnightTransferTx(
  credentials: { password?: string; prfSecret?: Uint8Array },
): Promise<{ tx: string }> {
  const wallet = loggedWallet.value;
  if (!wallet) throw new Error('No wallet logged in');
  const outputs = makeTransferOutputs.value.map((o) => ({
    address: o.recipient,
    amount: o.value, // already base units (decimal string) from the connector
    token: 'NIGHT' as const,
  }));
  const { buildAndSignUnshieldedTransfer } = await import('@/services/midnight-tx.service');
  return buildAndSignUnshieldedTransfer(
    wallet.network,
    { fromAddress: wallet.baseAddress, outputs, ttlMs: Date.now() + 5 * 60_000 },
    credentials,
  );
}

async function signMidnightTransferNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  // Capture the request identity BEFORE the multi-second build round-trip. If
  // the request is settled meanwhile (Reject clicked, wallet switched → queue
  // advances), currentRequest becomes a DIFFERENT request — never deliver this
  // transfer's signed tx to it.
  const reqId = currentRequest.value.requestId;
  signing.value = true;
  signError.value = '';

  try {
    const { tx } = await buildMidnightTransferTx({ password: spendingPassword.value });
    if (currentRequest.value?.requestId !== reqId) return; // request superseded — drop
    approve({ tx });
    spendingPassword.value = '';
  } catch (e) {
    console.error('[DApp] Midnight makeTransfer error:', e);
    signError.value = (e as Error)?.message || 'Transfer failed';
  } finally {
    signing.value = false;
  }
}

async function signMidnightTransferPrf() {
  if (!currentRequest.value) return;
  // Capture identity before the PRF popup wait + build (up to ~60s) — see
  // signMidnightTransferNormal; don't deliver this tx to a superseded request.
  const reqId = currentRequest.value.requestId;
  signing.value = true;
  signError.value = '';

  try {
    // WebAuthn doesn't reliably work from inside the side panel's own window —
    // same cross-window popup workaround (mode=rawPrf) as signMidnightDataPrf.
    const popupUrl = chrome.runtime.getURL('index.html?mode=rawPrf#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const prfBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, prfOutput, error } = event.data.payload;
          if (success && prfOutput) resolve(new Uint8Array(prfOutput));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const { tx } = await buildMidnightTransferTx({ prfSecret: prfBytes });
    if (currentRequest.value?.requestId !== reqId) return; // request superseded — drop
    approve({ tx });
  } catch (e) {
    console.error('[DApp] Midnight PRF makeTransfer error:', e);
    signError.value = (e as Error)?.message || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── WalletConnect: session proposal (pairing) ──────────────────────────────
// Mirrors WCSessionProposal.vue's popup fallback exactly (same fields, same
// approve/reject payload shape) so background's onSessionProposal handler
// doesn't need to know which surface answered it. Session *requests*
// (signing) don't need their own pane — they reuse the signTx/signData/
// btcSignPsbt/btcSignMessage panes above with origin metadata swapped in.
interface WcSessionProposalPayload {
  id: number;
  proposer?: { metadata?: { name?: string; url?: string; icons?: string[] } };
  requiredNamespaces?: Record<string, { chains?: string[] }>;
  optionalNamespaces?: Record<string, { chains?: string[] }>;
}
const wcProposal = computed(() =>
  currentRequest.value?.method === 'wcSessionProposal'
    ? (currentRequest.value.payload as WcSessionProposalPayload)
    : null
);
const wcPeerName = computed(() => wcProposal.value?.proposer?.metadata?.name || 'Unknown dApp');
const wcPeerUrl = computed(() => wcProposal.value?.proposer?.metadata?.url || '');
const wcRequestedChains = computed(() => {
  if (!wcProposal.value) return [];
  const chains: string[] = [];
  const ns = { ...wcProposal.value.requiredNamespaces, ...wcProposal.value.optionalNamespaces };
  for (const namespace of Object.values(ns)) {
    if (namespace?.chains) chains.push(...namespace.chains);
  }
  return [...new Set(chains)];
});
const wcRequestedChainNames = computed(() =>
  wcRequestedChains.value.map((c) => {
    const info = resolveGeroChain(c);
    return info ? `${info.chain} ${info.network}` : c;
  })
);
const wcHasUnsupportedChains = computed(() => wcRequestedChains.value.some((c) => !resolveGeroChain(c)));

function approveWcSession() {
  if (!wcProposal.value) return;
  approve({ approved: true, proposalId: wcProposal.value.id });
}
</script>

<style scoped>
.dapp-overlay {
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.queue-strip {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 6px 10px;
}

.queue-strip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.queue-strip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 0;
}

.queue-strip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Enable / Connect ── */

.wallet-identity-strip {
  display: flex;
  align-items: center;
}

.network-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(255, 167, 38, 0.12);
  color: var(--g-warning);
  border: 1px solid rgba(255, 167, 38, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.dapp-identity {
  display: flex;
  align-items: center;
  gap: 14px;
}

.favicon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.favicon-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.dapp-domain-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* The subdomain is chrome; the registrable root is the identity. Both are always
   rendered, so nothing about the hostname is hidden from the user. */
.dapp-url {
  word-break: break-all;
  line-height: 1.3;
  font-size: 14.5px;
}
.dapp-sub { color: var(--g-text-3); }
.dapp-root { color: var(--g-text-1); font-weight: 600; }

/* Replaces the unconditional "confirm the URL" nag: it only appears when the
   hostname actually contains punycode or non-ASCII characters. */
.suspicious-host {
  display: flex;
  align-items: center;
  padding: var(--g-s-2) 10px;
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  color: var(--g-warning);
}

.permissions-section {
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.permission-row {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  line-height: 1.4;
}
.permission-row + .permission-row { margin-top: var(--g-s-2); }
.permission-check {
  color: var(--g-text-3);
  margin-top: 2px;
  flex-shrink: 0;
}

/* ── Sign ── */

.dapp-sign-tx {
  display: flex;
  flex-direction: column;
}

/* Decoded tx details panel */
.tx-details {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.tx-details-header {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.risk-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid;
  background: rgba(255, 255, 255, 0.02);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.tx-internal-banner {
  padding: 6px 12px;
  background: rgba(148, 207, 168, 0.06);
  border-bottom: 1px solid rgba(148, 207, 168, 0.15);
  text-align: center;
  color: var(--g-success);
}

.tx-internal-banner .text-caption {
  color: var(--g-success) !important;
  font-weight: 500;
}

.tx-details-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-details-divider {
  border-color: rgba(255, 255, 255, 0.06) !important;
}

.tx-output-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.tx-output-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.tx-output-addr {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 10px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-output-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.tx-asset-pill {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--chain-primary) 15%, transparent);
  color: var(--chain-primary);
  font-weight: 600;
}

.tx-asset-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  line-height: 1.3;
}

.tx-asset-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.tx-asset-qty {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--g-text-1);
}

.tx-asset-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tx-summary-total {
  margin-top: 2px;
}

.tx-ttl-expired {
  color: var(--g-error) !important;
}

/* Centered countdown footer beneath the financial card. Monospaced so digit
   width stays constant as the timer ticks (no horizontal jitter). */
.tx-ttl-footer {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--g-text-3);
  cursor: help;
}

.tx-ttl-footer-value {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Roboto Mono", monospace;
  font-variant-numeric: tabular-nums;
}

.tx-expired-banner {
  display: flex;
  align-items: flex-start;
  padding: 12px 14px;
  margin: 12px 0;
  border-radius: 10px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
}

.tx-fiat-approx {
  text-align: right;
  font-size: 11.5px;
  color: var(--g-text-3);
  font-variant-numeric: tabular-nums;
  margin-top: -6px;
}

.tx-intents {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-intents-header {
  letter-spacing: 0.5px;
}

.tx-intent-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.tx-intent-text {
  min-width: 0;
  overflow-wrap: break-word;
}

.tx-decode-failed-banner {
  display: flex;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
}

.tx-expired-text {
  flex: 1;
  min-width: 0;
}

.tx-expired-title {
  color: var(--g-error);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
}

.tx-expired-body {
  color: var(--g-text-2);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 2px;
}

.dapp-sign-data {
  display: flex;
  flex-direction: column;
}

.sign-data-message {
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  max-height: 40vh;
  overflow-y: auto;
  width: 100%;
  white-space: pre-line;
}

.signing-address-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.signing-address-value {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 11px;
}

.decode-error {
  color: var(--g-error);
  font-weight: 600;
  margin: 0;
}

.password-input {
  width: 100%;
  margin-top: 8px;
}

.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: color-mix(in srgb, var(--chain-primary) 8%, transparent);
  border-radius: 8px;
  width: 100%;
}

/* Ledger USB/BT picker sits under the connect notice, hairline-separated so it
   reads as a control rather than part of the instruction copy. */
.hw-transport-toggle {
  margin-top: var(--g-s-2);
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-1);
  width: 100%;
}

/* The specimen's action row: Decline is deliberately the narrower column. The
   destructive-looking choice should never be the easiest one to hit by reflex,
   but it must stay a first-class control, not a link. */
.action-buttons {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 10px;
  width: 100%;
  margin-top: var(--g-s-4);
}
/* A pane with a single action (some hardware-wallet branches) spans the row. */
.action-buttons > *:only-child {
  grid-column: 1 / -1;
}
.action-buttons .v-btn {
  width: 100%;
  min-width: 0;
}
</style>
