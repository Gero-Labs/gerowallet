<template>
  <div class="tx-details">
    <!-- Hero: what happened, how much, and whether it is final -->
    <header class="tx-hero">
      <div class="tx-hero__head">
        <TxGlyph :icon="kindIcon" :tone="kindTone" />
        <div class="tx-hero__heading">
          <div class="tx-hero__title-row">
            <span class="tx-hero__title">{{ title }}</span>
            <TxTag v-for="tag in tags" :key="tag.key" :tag="tag" />
          </div>
          <span class="t-caption">{{ absoluteTime }} · {{ relativeTime }}</span>
        </div>
        <div class="tx-hero__actions">
          <GButton
            v-if="transactionUrl"
            tier="secondary"
            compact
            :href="transactionUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <v-icon small left>mdi-open-in-new</v-icon>
            {{ $t('miniGero.viewOnExplorer') }}
          </GButton>
          <GButton v-if="isCardanoMainnet" tier="secondary" compact @click="isReportDialogOpen = true">
            <v-icon small left>mdi-flag-outline</v-icon>
            {{ $t('navigation.reportTransaction') }}
          </GButton>
        </div>
      </div>

      <div class="tx-hero__value">
        <div class="tx-hero__amount">
          <span v-if="verb" class="t-caption">{{ verb }}</span>
          <span :class="['t-display', 'g-num', 'tx-hero__amount-value', amountClass]">{{ heroAmount }}</span>
          <span v-if="fiatLine" class="t-caption g-num">{{ fiatLine }}</span>
        </div>
        <span :class="['tx-status', `tx-status--${status}`]">
          <v-icon x-small>{{ statusIcon }}</v-icon>
          {{ statusLabel }}
        </span>
      </div>

      <dl class="tx-facts">
        <div class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('transactions.transactionId') }}</dt>
          <dd>
            <a v-if="transactionUrl" class="g-mono tx-fact__link" :href="transactionUrl" target="_blank" rel="noopener noreferrer">
              {{ filters.truncate(transactionInfo.id) }}
            </a>
            <span v-else class="g-mono">{{ filters.truncate(transactionInfo.id) }}</span>
            <CopyButton x-small :value="transactionInfo.id" />
          </dd>
        </div>
        <div v-if="transactionInfo.block_height" class="tx-fact">
          <dt class="t-label">{{ $t('transactions.blockHeight') }}</dt>
          <dd class="g-num">{{ transactionInfo.block_height.toLocaleString('en-US') }}</dd>
        </div>
        <div v-if="transactionInfo.block_hash" class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('miniGero.block') }}</dt>
          <dd>
            <a v-if="blockUrl" class="g-mono tx-fact__link" :href="blockUrl" target="_blank" rel="noopener noreferrer">
              {{ filters.truncate(transactionInfo.block_hash) }}
            </a>
            <span v-else class="g-mono">{{ filters.truncate(transactionInfo.block_hash) }}</span>
            <CopyButton x-small :value="transactionInfo.block_hash" />
          </dd>
        </div>
        <div v-if="transactionInfo.epoch_no" class="tx-fact">
          <dt class="t-label">{{ $t('transactions.epoch') }}</dt>
          <dd class="g-num">{{ transactionInfo.epoch_no }}</dd>
        </div>
        <div v-if="networkFee" class="tx-fact">
          <dt class="t-label">{{ $t('signTx.networkFee') }}</dt>
          <dd class="g-num">{{ networkFee }}</dd>
        </div>
        <div v-if="transactionInfo.tx_size" class="tx-fact">
          <dt class="t-label">{{ $t('mempool.size') }}</dt>
          <dd class="g-num">{{ filters.humanFileSize(transactionInfo.tx_size) }}</dd>
        </div>
        <div v-if="ioSummary" class="tx-fact">
          <dt class="t-label">{{ $t('bitcoin.inputs') }} → {{ $t('bitcoin.outputs') }}</dt>
          <dd class="g-num">{{ ioSummary }}</dd>
        </div>
      </dl>
    </header>

    <!-- Balance change: only when tokens moved (ADA alone is the hero amount) -->
    <section v-if="ledger.length" class="tx-ledger">
      <h4 class="t-label tx-ledger__label">{{ $t('transactions.balanceChange') }}</h4>
      <div v-for="row in visibleLedger" :key="row.key" class="tx-ledger__row">
        <v-avatar size="28" class="tx-ledger__logo">
          <v-img :src="row.img" :alt="row.name" contain />
        </v-avatar>
        <span class="tx-ledger__name">{{ row.name }}</span>
        <span :class="['tx-ledger__amount', 'g-num', { 'tx-ledger__amount--in': row.positive }]">{{ row.amount }}</span>
      </div>
      <button
        v-if="ledger.length > LEDGER_LIMIT"
        type="button"
        class="tx-more tx-ledger__more"
        @click="showAllLedger = !showAllLedger"
      >
        {{ showAllLedger ? $t('governance.showLess') : $t('transactions.moreTokens', { count: ledger.length - LEDGER_LIMIT }) }}
      </button>
    </section>

    <!-- Sections: one glass container, a disclosure per part of the transaction -->
    <div v-if="sections.length" class="tx-sections glass-tier">
      <section
        v-for="section in sections"
        :key="section.key"
        :class="['tx-section', { 'tx-section--open': isOpen(section.key) }]"
      >
        <button
          type="button"
          class="tx-section__head"
          :aria-expanded="isOpen(section.key) ? 'true' : 'false'"
          @click="toggleSection(section.key)"
        >
          <span class="tx-section__icon"><v-icon small>{{ section.icon }}</v-icon></span>
          <span class="tx-section__title">{{ section.title }}</span>
          <span v-if="section.count" class="tx-count g-num">{{ section.count }}</span>
          <v-icon small class="tx-section__chevron">mdi-chevron-down</v-icon>
        </button>

        <div v-if="isOpen(section.key)" class="tx-section__body">
          <!-- UTxOs: inputs → fee → outputs -->
          <template v-if="section.key === 'utxos'">
            <div class="tx-io-head">
              <span class="t-label">{{ $t('bitcoin.inputs') }}</span>
              <span class="tx-count g-num">{{ inputCount }}</span>
            </div>
            <div v-for="utxo in inputViews" :key="utxo.key" class="tx-utxo">
              <div class="tx-utxo__top">
                <div class="tx-utxo__ids">
                  <div class="tx-utxo__line tx-utxo__line--primary">
                    <span class="g-mono">{{ filters.truncate(utxo.ref) }}</span>
                    <CopyButton v-if="utxo.ref" x-small :value="utxo.ref" />
                  </div>
                  <div class="tx-utxo__line">
                    <span class="g-mono">{{ filters.truncate(utxo.address) }}</span>
                    <CopyButton v-if="utxo.address" x-small :value="utxo.address" />
                    <span v-if="utxo.own" class="tx-you">{{ $t('governance.you') }}</span>
                  </div>
                </div>
                <span class="tx-utxo__ada g-num">{{ utxo.ada }}</span>
              </div>
              <div v-if="utxo.tokens.length" class="tx-pills">
                <span v-for="token in utxo.tokens" :key="token.key" class="tx-pill">
                  <v-avatar size="18"><v-img :src="token.img" :alt="token.name" contain /></v-avatar>
                  <span class="tx-pill__qty g-num">{{ token.quantity }}</span>
                  <span class="tx-pill__name">{{ token.name }}</span>
                </span>
                <button
                  v-if="utxo.hiddenTokens > 0 || utxo.expanded"
                  type="button"
                  class="tx-more"
                  @click="toggleTokens(utxo.key)"
                >
                  {{ utxo.expanded ? $t('governance.showLess') : $t('transactions.moreTokens', { count: utxo.hiddenTokens }) }}
                </button>
              </div>
            </div>
            <button
              v-if="inputCount > UTXO_LIMIT"
              type="button"
              class="tx-more tx-io-more"
              @click="showAllInputs = !showAllInputs"
            >
              {{ showAllInputs ? $t('governance.showLess') : $t('transactions.showAllInputs', { count: inputCount }) }}
            </button>

            <div class="tx-flow">
              <span class="tx-flow__rule"></span>
              <v-icon x-small class="tx-flow__icon">mdi-arrow-down</v-icon>
              <span v-if="networkFee">{{ $t('signTx.networkFee') }} {{ networkFee }}</span>
              <span class="tx-flow__rule"></span>
            </div>

            <div class="tx-io-head">
              <span class="t-label">{{ $t('bitcoin.outputs') }}</span>
              <span class="tx-count g-num">{{ outputCount }}</span>
            </div>
            <div v-for="utxo in outputViews" :key="utxo.key" class="tx-utxo">
              <div class="tx-utxo__top">
                <div class="tx-utxo__ids">
                  <div class="tx-utxo__line tx-utxo__line--primary">
                    <span class="g-mono">{{ filters.truncate(utxo.ref) }}</span>
                    <CopyButton v-if="utxo.ref" x-small :value="utxo.ref" />
                  </div>
                  <div class="tx-utxo__line">
                    <span class="g-mono">{{ filters.truncate(utxo.address) }}</span>
                    <CopyButton v-if="utxo.address" x-small :value="utxo.address" />
                    <span v-if="utxo.own" class="tx-you">{{ $t('governance.you') }}</span>
                  </div>
                </div>
                <span class="tx-utxo__ada g-num">{{ utxo.ada }}</span>
              </div>
              <div v-if="utxo.tokens.length" class="tx-pills">
                <span v-for="token in utxo.tokens" :key="token.key" class="tx-pill">
                  <v-avatar size="18"><v-img :src="token.img" :alt="token.name" contain /></v-avatar>
                  <span class="tx-pill__qty g-num">{{ token.quantity }}</span>
                  <span class="tx-pill__name">{{ token.name }}</span>
                </span>
                <button
                  v-if="utxo.hiddenTokens > 0 || utxo.expanded"
                  type="button"
                  class="tx-more"
                  @click="toggleTokens(utxo.key)"
                >
                  {{ utxo.expanded ? $t('governance.showLess') : $t('transactions.moreTokens', { count: utxo.hiddenTokens }) }}
                </button>
              </div>
            </div>
            <button
              v-if="outputCount > UTXO_LIMIT"
              type="button"
              class="tx-more tx-io-more"
              @click="showAllOutputs = !showAllOutputs"
            >
              {{ showAllOutputs ? $t('governance.showLess') : $t('transactions.showAllOutputs', { count: outputCount }) }}
            </button>
          </template>

          <!-- Certificates -->
          <template v-else-if="section.key === 'certificates'">
            <div v-for="(certificate, index) in certificates" :key="`certificate_${index}`" class="tx-block">
              <div class="tx-block__title">{{ getCertificateType(certificate) }}</div>
              <dl class="tx-kv">
                <template v-if="certificate.stakeCredential?.hash">
                  <dt>{{ $t('transactions.stakeCredential') }}</dt>
                  <dd>
                    <span class="g-mono">{{ filters.truncate(certificate.stakeCredential.hash) }}</span>
                    <CopyButton x-small :value="certificate.stakeCredential.hash" />
                  </dd>
                </template>
                <template v-if="getCredentialType(certificate.stakeCredential?.type)">
                  <dt>{{ $t('transactions.credentialType') }}</dt>
                  <dd>{{ getCredentialType(certificate.stakeCredential.type) }}</dd>
                </template>
                <template v-if="certificate.deposit">
                  <dt>{{ $t('poolOperator.deposit') }}</dt>
                  <dd class="g-num">{{ filters.toCurrency(certificate.deposit, false, 0, currencySymbol) }}</dd>
                </template>
                <template v-if="certificate.poolId">
                  <dt>{{ $t('swap.pool') }}</dt>
                  <dd>
                    <v-avatar v-if="currentPoolMeta?.url_png_icon_64x64" size="20">
                      <v-img :src="currentPoolMeta.url_png_icon_64x64" contain />
                    </v-avatar>
                    <span v-if="txPoolTicker" class="tx-kv__strong">{{ txPoolTicker }}</span>
                    <span class="g-mono">{{ filters.truncate(certificate.poolId) }}</span>
                    <CopyButton x-small :value="certificate.poolId" />
                  </dd>
                </template>
                <template v-if="certificate.dRep">
                  <dt>{{ $t('governance.dRep') }}</dt>
                  <dd class="tx-kv__stack">
                    <span class="tx-kv__row">
                      <v-avatar v-if="txDRep?.metadata?.meta_json?.body?.image?.contentUrl" size="20">
                        <v-img :src="txDRep.metadata.meta_json.body.image.contentUrl" contain />
                      </v-avatar>
                      <span class="tx-kv__strong">
                        {{ txDRep?.metadata?.meta_json?.body?.givenName || txDRep?.drep_id || drepIds[index].cip129 }}
                      </span>
                    </span>
                    <span v-if="drepIds[index].cip105" class="tx-kv__row">
                      <a href="https://cips.cardano.org/cip/CIP-0105" target="_blank" rel="noopener noreferrer">CIP-105</a>
                      <span class="g-mono">{{ filters.truncate(drepIds[index].cip105) }}</span>
                      <CopyButton x-small :value="drepIds[index].cip105" />
                    </span>
                    <span v-if="drepIds[index].cip105" class="tx-kv__row">
                      <a href="https://cips.cardano.org/cip/CIP-0129" target="_blank" rel="noopener noreferrer">CIP-129</a>
                      <span class="g-mono">{{ filters.truncate(drepIds[index].cip129) }}</span>
                      <CopyButton x-small :value="drepIds[index].cip129" />
                    </span>
                  </dd>
                </template>
              </dl>
            </div>
          </template>

          <!-- Metadata -->
          <div v-else-if="section.key === 'metadata'" class="tx-code">
            <pre class="tx-code__pre">{{ metadataJson }}</pre>
            <CopyButton small class="tx-code__copy" :value="metadataJson" />
          </div>

          <!-- Minted / burned -->
          <template v-else-if="section.key === 'mint'">
            <div v-for="mint in mintRows" :key="mint.assetId" class="tx-block">
              <div class="tx-block__title tx-block__title--split">
                <span>{{ mint.assetName }}</span>
                <span :class="['g-num', { 'tx-ledger__amount--in': mint.positive }]">{{ mint.quantityLabel }}</span>
              </div>
              <dl class="tx-kv">
                <dt>{{ $t('transactions.policyId') }}</dt>
                <dd>
                  <span class="g-mono">{{ filters.truncate(mint.policyId) }}</span>
                  <CopyButton x-small :value="mint.policyId" />
                </dd>
                <dt>{{ $t('assets.fingerprint') }}</dt>
                <dd>
                  <span class="g-mono">{{ filters.truncate(mint.fingerprint) }}</span>
                  <CopyButton x-small :value="mint.fingerprint" />
                </dd>
              </dl>
            </div>
          </template>

          <!-- Withdrawals -->
          <template v-else-if="section.key === 'withdrawals'">
            <dl v-for="(withdrawal, index) in withdrawals" :key="`withdrawal_${index}`" class="tx-kv tx-block">
              <dt>{{ $t('wallet.stakeAddress') }}</dt>
              <dd>
                <span class="g-mono">{{ filters.truncate(withdrawal.stakeAddress) }}</span>
                <CopyButton x-small :value="withdrawal.stakeAddress" />
              </dd>
              <dt>{{ $t('common.amount') }}</dt>
              <dd class="g-num">{{ filters.toCurrency(withdrawal.quantity, false, 0, currencySymbol) }}</dd>
            </dl>
          </template>

          <!-- Scripts & redeemers (witness set) -->
          <template v-else-if="section.key === 'witness'">
            <div v-for="(redeemer, index) in redeemerViews" :key="`redeemer_${index}`" class="tx-block">
              <div class="tx-block__title">{{ $t('transactions.redeemerN', { n: index + 1 }) }}</div>
              <dl class="tx-kv">
                <template v-if="redeemer.hash">
                  <dt>{{ $t('transactions.hash') }}</dt>
                  <dd>
                    <span class="g-mono">{{ filters.truncate(redeemer.hash) }}</span>
                    <CopyButton x-small :value="redeemer.hash" />
                  </dd>
                </template>
                <dt>{{ $t('transactions.purpose') }}</dt>
                <dd>{{ redeemer.purpose }}</dd>
                <dt>{{ $t('poolOperator.memory') }}</dt>
                <dd class="g-num">{{ redeemer.memory }}</dd>
                <dt>{{ $t('transactions.cpuSteps') }}</dt>
                <dd class="g-num">{{ redeemer.steps }}</dd>
                <template v-if="redeemer.cbor">
                  <dt>{{ $t('transactions.dataCbor') }}</dt>
                  <dd>
                    <span class="g-mono">{{ filters.truncate(redeemer.cbor) }}</span>
                    <CopyButton x-small :value="redeemer.cbor" />
                  </dd>
                </template>
                <template v-if="redeemer.dataHash">
                  <dt>{{ $t('transactions.dataHash') }}</dt>
                  <dd>
                    <span class="g-mono">{{ filters.truncate(redeemer.dataHash) }}</span>
                    <CopyButton x-small :value="redeemer.dataHash" />
                  </dd>
                </template>
              </dl>
              <div v-if="redeemer.dataJson" class="tx-code tx-block__code">
                <pre class="tx-code__pre">{{ redeemer.dataJson }}</pre>
                <CopyButton small class="tx-code__copy" :value="redeemer.dataJson" />
              </div>
            </div>
            <div v-for="(script, index) in witnessScripts" :key="`script_${index}`" class="tx-block">
              <div class="tx-block__title">{{ $t('transactions.scriptN', { n: index + 1 }) }}</div>
              <dl class="tx-kv">
                <dt>{{ $t('common.type') }}</dt>
                <dd>{{ scriptType(script.language()) }}</dd>
                <dt>{{ $t('transactions.hash') }}</dt>
                <dd>
                  <span class="g-mono">{{ filters.truncate(script.hash()) }}</span>
                  <CopyButton x-small :value="script.hash()" />
                </dd>
              </dl>
              <div v-if="Cardano.isPlutusScript(script.toCore())" class="tx-code tx-block__code">
                <pre class="tx-code__pre">{{ filters.truncate(getScriptDataBytes(script.toCore())) }}</pre>
                <CopyButton small class="tx-code__copy" :value="getScriptDataBytes(script.toCore())" />
              </div>
            </div>
          </template>

          <!-- Collateral -->
          <template v-else-if="section.key === 'collateral'">
            <div v-for="(collateral, index) in collaterals" :key="`collateral_${index}`" class="tx-ref-row">
              <span class="g-mono">{{ filters.truncate(`${collateral.txId}#${collateral.index}`) }}</span>
              <CopyButton x-small :value="`${collateral.txId}#${collateral.index}`" />
            </div>
            <div v-if="transactionInfo.body?.collateralReturn" class="tx-block">
              <div class="tx-block__title">{{ $t('transactions.collateralReturn') }}</div>
              <dl class="tx-kv">
                <dt>{{ $t('common.address') }}</dt>
                <dd>
                  <span class="g-mono">{{ filters.truncate(transactionInfo.body.collateralReturn.address) }}</span>
                  <CopyButton
                    v-if="transactionInfo.body.collateralReturn.address"
                    x-small
                    :value="transactionInfo.body.collateralReturn.address"
                  />
                </dd>
                <dt>{{ $t('common.amount') }}</dt>
                <dd class="g-num">
                  {{ filters.toCurrency(transactionInfo.body.collateralReturn.value.coins, false, 0, currencySymbol) }}
                </dd>
              </dl>
            </div>
          </template>

          <!-- Reference inputs -->
          <template v-else-if="section.key === 'referenceInputs'">
            <div v-for="(referenceInput, index) in referenceInputs" :key="`reference_input_${index}`" class="tx-ref-row">
              <span class="g-mono">{{ filters.truncate(`${referenceInput.txId}#${referenceInput.index}`) }}</span>
              <CopyButton x-small :value="`${referenceInput.txId}#${referenceInput.index}`" />
            </div>
          </template>
        </div>
      </section>
    </div>

    <ReportDialog :isOpen="isReportDialogOpen" @close="isReportDialogOpen = false" :reportTx="transactionInfo.id" />
  </div>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, ref, toRefs, watch } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import TxTag from '@/modules/transactions/components/TxTag.vue';
import filters from '@/shared/utils/filters';
import { resolveAsset } from '@/shared/utils/resolver';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Buffer } from 'buffer';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import assts from '@/utils/assets';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import stakingStoreActions from '@/stores/stakingStore';
import blockchainApi from '@/api/blockchain-api';
import { getBlockchainDb } from '@/db';
import { Blockchain, Network } from '@/models/types';
import { getExplorerUrl } from '@/shared/utils/explorer';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { getCertificateBaseStatus } from '@/modules/dashboard/utils/transactionStatus';
import {
  buildClassifyContext,
  buildTxTags,
  buildTxTitle,
  classifyTxKind,
  isPendingTooLong,
  TX_KIND_ICON,
  TX_KIND_TONE,
  withMinusSign,
} from '@/modules/dashboard/utils/transactionClassifier';

/** Koios API UTXO amount entry */
interface TxAmount {
  unit: string;
  quantity: number;
}

/** Koios API UTXO input/output (different shape from Cardano.TxIn) */
interface TxIO {
  tx_hash?: string;
  output_index?: number;
  address?: string;
  amount: TxAmount[];
}

/** Koios API asset entry */
interface TxAsset {
  unit: string;
  policy_id: string;
  quantity: number;
  name?: string;
  img?: string;
  metadata?: { decimals?: number };
}

type SectionKey =
  | 'utxos'
  | 'certificates'
  | 'metadata'
  | 'mint'
  | 'withdrawals'
  | 'witness'
  | 'collateral'
  | 'referenceInputs';

interface Props {
  // Hybrid object: Koios API fields at root + Cardano.TxBody/Witness from SDK deserialization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transactionInfo: any;
  /** Sections expanded when a transaction is first shown; all start collapsed by default. */
  initiallyOpen?: SectionKey[];
}

const props = withDefaults(defineProps<Props>(), {
  initiallyOpen: () => [],
});

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

/** Long lists collapse: UTxOs after this many, token pills per UTxO after TOKEN_LIMIT. */
const UTXO_LIMIT = 10;
const TOKEN_LIMIT = 6;
const LEDGER_LIMIT = 6;

const isReportDialogOpen = ref<boolean>(false);
const currentPoolMeta = ref<{ url_png_icon_64x64?: string } | null>(null);
const txPoolTicker = ref<string | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txDRep = ref<any>(null);

const openSections = ref<Record<string, boolean>>({});
const showAllInputs = ref(false);
const showAllOutputs = ref(false);
const showAllLedger = ref(false);
const expandedTokens = ref<Record<string, boolean>>({});

// Report Transaction routes to Cardano Shield's scam/fraud registry, which only
// covers Cardano mainnet — hide it on testnets and non-Cardano chains.
const isCardanoMainnet = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET
);

const currencySymbol = computed(() =>
  networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network)
);
const currencyTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

// ---------------------------------------------------------------------------
// Hero: title, type, status, amount
// ---------------------------------------------------------------------------
const classifyCtx = computed(() => buildClassifyContext(loggedWallet.value, walletStore.keys, walletStore.contacts));
const kind = computed(() => classifyTxKind(props.transactionInfo, classifyCtx.value));
const kindIcon = computed(() => TX_KIND_ICON[kind.value]);
const kindTone = computed(() => TX_KIND_TONE[kind.value]);
const tags = computed(() => buildTxTags(props.transactionInfo, classifyCtx.value, t, kind.value));

const DELEGATION_CERTIFICATES = new Set<string>([
  Cardano.CertificateType.StakeDelegation,
  Cardano.CertificateType.StakeRegistrationDelegation,
]);

// Same title the history row shows, including "Delegating to TICKER" once the pool resolves
const title = computed(() => {
  const tx = props.transactionInfo;
  if (isPendingTooLong(tx)) return t('transactions.failedTransaction');
  const certificates: Cardano.Certificate[] = tx.body?.certificates ?? [];
  if (txPoolTicker.value && certificates.length) {
    return certificates
      .map((certificate) => DELEGATION_CERTIFICATES.has(certificate.__typename)
        ? t('transactions.delegatingTo', { pool: txPoolTicker.value })
        : getCertificateBaseStatus(certificate.__typename, t))
      .filter(Boolean)
      .join(', ');
  }
  return buildTxTitle(tx, classifyCtx.value, t) || t('transactions.transaction');
});

const status = computed<'confirmed' | 'pending' | 'failed'>(() => {
  if (isPendingTooLong(props.transactionInfo)) return 'failed';
  return props.transactionInfo.pending ? 'pending' : 'confirmed';
});

const STATUS_ICON = {
  confirmed: 'mdi-check-circle-outline',
  pending: 'mdi-clock-outline',
  failed: 'mdi-alert-circle-outline',
};
const statusIcon = computed(() => STATUS_ICON[status.value]);
const statusLabel = computed(() => t(`transactions.${status.value}`));

const txDate = computed(() => new Date(props.transactionInfo.tx_timestamp * 1000));
const absoluteTime = computed(() => txDate.value.toLocaleString());
const relativeTime = computed(() => time.format(txDate.value));

const adaDelta = computed(() => Number(props.transactionInfo.ada ?? 0));

const verb = computed(() => {
  // A self transfer moves nothing out of the wallet but the fee
  if (kind.value === 'self') return t('signTx.networkFee');
  if (adaDelta.value > 0) return t('transactions.received');
  if (adaDelta.value < 0) return t('transactions.sent');
  return '';
});

const heroAmount = computed(() =>
  withMinusSign(filters.toCurrency(adaDelta.value, true, 0, currencySymbol.value, '', false))
);

const amountClass = computed(() => {
  if (status.value === 'failed') return 'tx-hero__amount-value--failed';
  if (status.value === 'pending') return 'tx-hero__amount-value--pending';
  return adaDelta.value > 0 ? 'tx-hero__amount-value--in' : '';
});

// The fiat line uses the live ADA price, so it says so rather than pass for the historical value
const fiatLine = computed(() => {
  const price = priceStore.adaUsd?.lastPrice || 0;
  if (!price || loggedWallet.value?.chain !== Blockchain.CARDANO || adaDelta.value === 0) return '';
  const value = filters.toCurrency(convertFiat(Math.abs(adaDelta.value) * price), false, 0, getCurrencySymbol(), '', false, 6);
  return t('transactions.fiatAtTodaysPrice', { value });
});

const networkFee = computed(() => {
  const fee = props.transactionInfo.body?.fee;
  return fee ? filters.toCurrency(fee, false, 0, currencySymbol.value) : '';
});

const inputCount = computed(() => props.transactionInfo.utxo?.inputs?.length ?? 0);
const outputCount = computed(() => props.transactionInfo.utxo?.outputs?.length ?? 0);
const ioSummary = computed(() =>
  props.transactionInfo.utxo?.inputs ? `${inputCount.value} → ${outputCount.value}` : ''
);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const txAssets = computed(() => {
  if (props.transactionInfo) {
    // Guard against missing asset arrays (pending transactions may not have these fields yet)
    const received = props.transactionInfo['receivedAssets'] || [];
    const sent = props.transactionInfo['sentAssets'] || [];

    return [...received, ...sent]
      .filter((asset: TxAsset) => asset.policy_id !== '')
      .reduce((map: Record<string, ReturnType<typeof resolveAsset>>, asset: TxAsset) => {
        // Defense-in-depth: a single asset that fails to resolve must not crash
        // the entire transaction-details view.
        try {
          map[asset.unit] = resolveAsset(asset);
        } catch (e) {
          console.warn('[TransactionDetails] resolveAsset failed for', asset?.unit, e);
        }
        return map;
      }, {});
  }
  return {};
});

// Resolved metadata for a unit, without mutating the shared txAssets entry
const assetInfo = (asset: { unit: string; quantity: number }) => {
  const cached = txAssets.value[asset.unit];
  if (cached) return cached;
  try {
    return resolveAsset(asset);
  } catch {
    return null;
  }
};

const assetDecimals = (info: { metadata?: { decimals?: number | string } } | null): number =>
  info?.metadata?.decimals ? Number(info.metadata.decimals) : 0;

interface LedgerRow {
  key: string;
  img: string;
  name: string;
  amount: string;
  positive: boolean;
}

const ledger = computed<LedgerRow[]>(() => {
  const assets: TxAsset[] = Array.isArray(props.transactionInfo.assets) ? props.transactionInfo.assets : [];
  const tokens = assets.filter((asset) => asset.policy_id !== '' && asset.unit !== 'lovelace' && Number(asset.quantity) !== 0);
  if (tokens.length === 0) return [];

  const rows: LedgerRow[] = [];
  if (adaDelta.value !== 0) {
    rows.push({
      key: 'lovelace',
      img: networks.resolveCurrencyImage(loggedWallet.value?.chain, loggedWallet.value?.network),
      name: currencyTicker.value,
      amount: withMinusSign(filters.toCurrency(adaDelta.value, true, 6, '', ` ${currencyTicker.value}`, false, 6)),
      positive: adaDelta.value > 0,
    });
  }
  for (const asset of tokens) {
    const info = assetInfo(asset);
    const name = info?.name || filters.truncate(asset.unit);
    rows.push({
      key: asset.unit,
      img: info?.img || assts.questionMarkDark,
      name,
      amount: withMinusSign(filters.toCurrency(asset.quantity, true, 6, '', ` ${name}`, false, assetDecimals(info))),
      positive: Number(asset.quantity) > 0,
    });
  }
  return rows;
});

const visibleLedger = computed(() => (showAllLedger.value ? ledger.value : ledger.value.slice(0, LEDGER_LIMIT)));

// ---------------------------------------------------------------------------
// UTxOs
// ---------------------------------------------------------------------------
interface TokenPill {
  key: string;
  img: string;
  name: string;
  quantity: string;
}

interface UtxoView {
  key: string;
  ref: string;
  address: string;
  own: boolean;
  ada: string;
  tokens: TokenPill[];
  hiddenTokens: number;
  expanded: boolean;
}

function findLovelace(io: TxAmount[] | undefined | null) {
  if (!io?.length) return 0;
  const token = io.find(item => item.unit === 'lovelace');
  return token ? token.quantity : 0;
}

const tokenPill = (amount: TxAmount): TokenPill => {
  const info = assetInfo(amount);
  return {
    key: amount.unit,
    img: info?.img || assts.questionMarkDark,
    name: info?.name || filters.truncate(amount.unit),
    quantity: filters.toCurrency(amount.quantity, false, 6, '', '', false, assetDecimals(info)),
  };
};

const utxoView = (io: TxIO, key: string, ref: string): UtxoView => {
  const tokens = io.amount?.filter((amount) => amount.unit !== 'lovelace') ?? [];
  const expanded = !!expandedTokens.value[key];
  const shown = expanded ? tokens : tokens.slice(0, TOKEN_LIMIT);
  return {
    key,
    ref,
    address: io.address ?? '',
    own: !!io.address && classifyCtx.value.walletAddresses.has(io.address),
    ada: filters.toCurrency(findLovelace(io.amount), false, 6, '', ` ${currencyTicker.value}`, false, 6),
    tokens: shown.map(tokenPill),
    hiddenTokens: tokens.length - shown.length,
    expanded,
  };
};

const inputViews = computed<UtxoView[]>(() => {
  const inputs: TxIO[] = props.transactionInfo.utxo?.inputs ?? [];
  const visible = showAllInputs.value ? inputs : inputs.slice(0, UTXO_LIMIT);
  return visible.map((input, index) =>
    utxoView(input, `in-${index}`, input.tx_hash != null ? `${input.tx_hash}#${input.output_index}` : ''));
});

const outputViews = computed<UtxoView[]>(() => {
  const outputs: TxIO[] = props.transactionInfo.utxo?.outputs ?? [];
  const visible = showAllOutputs.value ? outputs : outputs.slice(0, UTXO_LIMIT);
  return visible.map((output, index) =>
    utxoView(output, `out-${index}`, output.output_index != null ? `${props.transactionInfo.id}#${output.output_index}` : ''));
});

function toggleTokens(key: string) {
  expandedTokens.value = { ...expandedTokens.value, [key]: !expandedTokens.value[key] };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
const certificates = computed<Cardano.Certificate[]>(() => props.transactionInfo.body?.certificates ?? []);
const withdrawals = computed(() => props.transactionInfo.body?.withdrawals ?? []);
const collaterals = computed<Cardano.TxIn[]>(() => props.transactionInfo.body?.collaterals ?? []);
const referenceInputs = computed<Cardano.TxIn[]>(() => props.transactionInfo.body?.referenceInputs ?? []);

// Pre-compute DRep IDs per certificate to avoid repeated serialization in template.
// Indices align with the certificates v-for in the template.
const drepIds = computed(() => {
  return certificates.value.map((cert) => {
    if (!('dRep' in cert)) return { cip105: '', cip129: '' };
    const drep = (cert as Cardano.VoteDelegationCertificate).dRep;
    return { cip105: getDRepCip105(drep), cip129: getDRepCip129(drep) };
  });
});

const getRedeemer = (redeemer: Cardano.Redeemer): Serialization.Redeemer | null => {
  try {
    return Serialization.Redeemer.fromCore(redeemer);
  } catch {
    return null;
  }
};

const getRedeemerDataJson = (redeemerData: Cardano.PlutusData): string => {
  return JSON.stringify(
    redeemerData,
    (_key, value) => {
      if (value instanceof Map) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of value.entries()) {
          obj[k] = v;
        }
        return obj;
      } else if (typeof value === 'bigint') {
        return value.toString();
      } else {
        return value;
      }
    },
    2
  );
};

// One serialization per redeemer, not one per template binding
const redeemerViews = computed(() => {
  const redeemers: Cardano.Redeemer[] = props.transactionInfo.witness?.redeemers ?? [];
  return redeemers.map((redeemer) => {
    const serialized = getRedeemer(redeemer);
    return {
      hash: serialized?.hash() ?? '',
      purpose: String(redeemer.purpose).toUpperCase(),
      memory: filters.humanFileSize(redeemer.executionUnits.memory.toString()),
      steps: Number(redeemer.executionUnits.steps.toString()).toLocaleString('en-US'),
      cbor: redeemer.data?.cbor?.toString() ?? '',
      dataHash: serialized?.data()?.hash() ?? '',
      dataJson: redeemer.data ? getRedeemerDataJson(redeemer.data) : '',
    };
  });
});

const witnessScripts = computed<Serialization.Script[]>(() =>
  (props.transactionInfo.witness?.scripts ?? []).map((script: Cardano.Script) => Serialization.Script.fromCore(script))
);

const getScriptDataBytes = (script: Cardano.Script) => {
  return (script as Cardano.PlutusScript).bytes;
};

const scriptType = (scriptLanguage: number) => {
  switch (scriptLanguage) {
    case 0:
      return t('transactions.native');
    case 1:
      return t('transactions.plutusV1');
    case 2:
      return t('transactions.plutusV2');
    case 3:
      return t('transactions.plutusV3');
    default:
      return t('common.unknown');
  }
};

const getAssetName = (unit: string, checkAscii: boolean): string => {
  const assetId = Cardano.AssetId(unit);
  const assetNameHex = Cardano.AssetId.getAssetName(assetId);
  try {
    return Cardano.AssetName.toUTF8(assetNameHex, true);
  } catch {
    const ascii = /^[ -~\t\n\r]+$/;
    const assetName = Buffer.from(assetNameHex, 'hex').toString('ascii');
    if (checkAscii && !ascii.test(assetName)) {
      const policyId = Cardano.AssetId.getPolicyId(assetId);
      return filters.truncate(Cardano.AssetFingerprint.fromParts(policyId, assetNameHex));
    }
    return assetName;
  }
};

const getCredentialType = (type: Cardano.CredentialType): string | null => {
  switch (type) {
    case Cardano.CredentialType.KeyHash:
      return 'Key Hash';
    case Cardano.CredentialType.ScriptHash:
      return 'Script Hash';
    default:
      return null;
  }
};

const getDRepCredential = (drep: Cardano.DelegateRepresentative): Cardano.Credential | null => {
  if ('__typename' in drep) return null; // AlwaysAbstain / AlwaysNoConfidence

  const drepS: Serialization.DRep = Serialization.DRep.fromCore(drep);
  switch (drepS.kind()) {
    case Serialization.DRepKind.KeyHash:
      return { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(drepS.toKeyHash()) };
    case Serialization.DRepKind.ScriptHash:
      return { type: Cardano.CredentialType.ScriptHash, hash: drepS.toScriptHash() };
    default:
      return null;
  }
};

const getDRepCip105 = (drep: Cardano.DelegateRepresentative): string => {
  const credential = getDRepCredential(drep);
  return credential ? Cardano.DRepID.cip105FromCredential(credential) : '';
};

const getDRepCip129 = (drep: Cardano.DelegateRepresentative): string => {
  const credential = getDRepCredential(drep);
  if (!credential) {
    // credential is null for sentinel types (AlwaysAbstain/AlwaysNoConfidence) or unrecognized DRep kinds
    if ('__typename' in drep) {
      if (drep.__typename === 'AlwaysAbstain') return t('governance.alwaysAbstain');
      if (drep.__typename === 'AlwaysNoConfidence') return t('governance.alwaysNoConfidence');
    }
    return 'N/A';
  }
  return Cardano.DRepID.cip129FromCredential(credential);
};

const mintRows = computed(() => {
  const mint: Cardano.TokenMap | undefined = props.transactionInfo.body?.mint;
  if (!mint) return [];
  // Handle both Map (from CBOR deserialization) and plain object (from chrome.storage.local)
  const entries: [string, bigint][] = mint instanceof Map
    ? Array.from(mint.entries())
    : (Object.entries(mint) as [string, bigint][]);
  return entries.map(([assetId, quantity]) => {
    const policyId = Cardano.AssetId.getPolicyId(assetId as Cardano.AssetId);
    const assetNameHex = Cardano.AssetId.getAssetName(assetId as Cardano.AssetId);
    const decimals = Number(txAssets.value[assetId]?.metadata?.decimals ?? 0);
    const amount = Number(quantity) / (decimals ? Math.pow(10, decimals) : 1);
    return {
      assetId,
      assetName: getAssetName(assetId as string, true),
      policyId,
      fingerprint: Cardano.AssetFingerprint.fromParts(policyId, assetNameHex),
      positive: amount > 0,
      quantityLabel: `${amount > 0 ? '+ ' : '− '}${Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 6 })}`,
    };
  });
});

// Parsed once per transaction; the template reads it several times
const metadataJson = computed((): string | null => {
  const cbor: string | undefined = props.transactionInfo?.cbor;
  if (!cbor) {
    return null;
  }
  // Cardano Tx CBOR is array (major type 4). Skip non-array (e.g. Apex bare TxBody).
  const firstByte = parseInt(cbor.slice(0, 2), 16);
  if ((firstByte >> 5) !== 4) {
    return null;
  }
  try {
    const metadata = Serialization.Transaction.fromCbor(Serialization.TxCBOR(cbor)).auxiliaryData()?.metadata()?.toCore();
    if (!metadata) return null;
    return JSON.stringify(
      metadata,
      (_key, value) => {
        if (value instanceof Map) {
          const obj: Record<string, unknown> = {};
          for (const [k, v] of value.entries()) {
            obj[k] = v;
          }
          return obj;
        } else if (typeof value === 'bigint') {
          return value.toString();
        } else {
          return value;
        }
      },
      2
    );
  } catch {
    return null;
  }
});

interface SectionView {
  key: SectionKey;
  title: string;
  icon: string;
  count: string;
}

const sections = computed<SectionView[]>(() => {
  const tx = props.transactionInfo;
  const list: SectionView[] = [];
  if (tx.utxo?.inputs) {
    list.push({ key: 'utxos', title: t('transactions.utxos'), icon: 'mdi-cube-outline', count: ioSummary.value });
  }
  if (certificates.value.length) {
    list.push({ key: 'certificates', title: t('transactions.certificates'), icon: 'mdi-certificate-outline', count: String(certificates.value.length) });
  }
  if (metadataJson.value) {
    list.push({ key: 'metadata', title: t('assets.metadata'), icon: 'mdi-code-json', count: '' });
  }
  if (mintRows.value.length) {
    list.push({ key: 'mint', title: t('transactions.mintBurn'), icon: 'mdi-plus-minus-variant', count: String(mintRows.value.length) });
  }
  if (withdrawals.value.length) {
    list.push({ key: 'withdrawals', title: t('transactions.withdrawals'), icon: 'mdi-bank-transfer-out', count: String(withdrawals.value.length) });
  }
  if (redeemerViews.value.length) {
    list.push({ key: 'witness', title: t('transactions.scriptsAndRedeemers'), icon: 'mdi-file-sign', count: String(redeemerViews.value.length + witnessScripts.value.length) });
  }
  if (collaterals.value.length) {
    list.push({ key: 'collateral', title: t('transactions.collateral'), icon: 'mdi-shield-outline', count: String(collaterals.value.length) });
  }
  if (referenceInputs.value.length) {
    list.push({ key: 'referenceInputs', title: t('transactions.referenceInputs'), icon: 'mdi-link-variant', count: String(referenceInputs.value.length) });
  }
  return list;
});

const isOpen = (key: SectionKey): boolean => !!openSections.value[key];

function toggleSection(key: SectionKey) {
  openSections.value = { ...openSections.value, [key]: !openSections.value[key] };
}

// ---------------------------------------------------------------------------
// Explorer links
// ---------------------------------------------------------------------------
// Use the shared explorer helper, which handles both Apex chains (Prime AND
// Vector → apexscan) and Cardano networks. The previous inline branches only
// special-cased APEX_PRIME, so a Vector wallet got a null tx link / a Cardano
// cexplorer block link (bug 954).
const transactionUrl = computed(() =>
  getExplorerUrl(
    loggedWallet.value?.chain ?? '',
    props.transactionInfo['id'],
    'tx',
    loggedWallet.value?.network,
  ) || null,
);

const blockUrl = computed(() =>
  getExplorerUrl(
    loggedWallet.value?.chain ?? '',
    props.transactionInfo['block_hash'],
    'block',
    loggedWallet.value?.network,
  ) || null,
);

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

const resolveTxDRep = async (drep: Cardano.DelegateRepresentative) => {
  const credential = getDRepCredential(drep);
  if (!credential) return null; // Sentinel type (AlwaysAbstain/AlwaysNoConfidence)

  const drepId = Cardano.DRepID.cip129FromCredential(credential);
  const wallet = loggedWallet.value;
  if (!wallet) return null;

  try {
    const db = await getBlockchainDb(wallet.chain, wallet.network);
    const cached = await db['dreps'].get(drepId);
    if (cached) return cached;

    const fetched = await blockchainApi.getDRepById(drepId, wallet.chain, wallet.network);
    if (fetched) {
      await db['dreps'].put({ ...fetched, drep_id: drepId });
    }
    return fetched ?? null;
  } catch (e) {
    console.warn('[TransactionDetails] resolveTxDRep failed:', e);
    return null;
  }
};

const resolvePoolMeta = async (poolId: string | undefined) => {
  if (!poolId) return null;
  const pool = await blockchainApi.getPoolById(poolId, loggedWallet.value?.chain, loggedWallet.value?.network);
  return pool?.pool_extended_info ? JSON.parse(pool.pool_extended_info)?.info ?? null : null;
};

// A different transaction starts from the default disclosure state
watch(
  () => props.transactionInfo?.id,
  () => {
    openSections.value = Object.fromEntries(props.initiallyOpen.map((key) => [key, true]));
    showAllInputs.value = false;
    showAllOutputs.value = false;
    showAllLedger.value = false;
    expandedTokens.value = {};
  },
  { immediate: true }
);

watch(
  () => props.transactionInfo,
  async () => {
    const value = props.transactionInfo;
    if (!value) return;
    txDRep.value = null;
    currentPoolMeta.value = null;
    txPoolTicker.value = null;
    const certificates: Cardano.Certificate[] = value.body?.certificates ?? [];
    const dRepCert = certificates.find((cert): cert is Cardano.VoteDelegationCertificate => 'dRep' in cert);
    const poolCert = certificates.find((cert): cert is Cardano.StakeDelegationCertificate => 'poolId' in cert);
    const [poolMeta, resolvedDRep, pool] = await Promise.all([
      resolvePoolMeta(poolCert?.poolId).catch(() => null),
      dRepCert ? resolveTxDRep(dRepCert.dRep) : Promise.resolve(null),
      poolCert ? stakingStoreActions.loadPoolById(loggedWallet.value, poolCert.poolId) : Promise.resolve(null),
    ]);
    // The user may have moved on to another transaction while these resolved
    if (props.transactionInfo !== value) return;
    currentPoolMeta.value = poolMeta;
    txDRep.value = resolvedDRep;
    txPoolTicker.value = pool?.ticker ?? null;
  },
  { immediate: true }
);
</script>
<style scoped lang="scss">
/* Sits above BaseDialog's decorative rings, which are positioned. */
.tx-details {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-5);
  text-align: left;
}

/* ─── Hero ───────────────────────────────────────────────────── */
.tx-hero {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tx-hero__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--g-s-3);
}

.tx-hero__heading {
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.tx-hero__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
  min-height: 20px;
}

.tx-hero__title {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

.tx-hero__actions {
  display: flex;
  gap: var(--g-s-2);
  margin-left: auto;
}

.tx-hero__value {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
}

.tx-hero__amount {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-hero__amount-value {
  line-height: 1.1;
}

.tx-hero__amount-value--in {
  color: var(--g-success);
}

.tx-hero__amount-value--pending {
  color: var(--g-warning);
}

.tx-hero__amount-value--failed {
  color: var(--g-text-3);
  text-decoration: line-through;
}

.tx-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.tx-status .v-icon {
  color: inherit;
}

.tx-status--confirmed {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.tx-status--pending {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.tx-status--failed {
  background: var(--g-error-fill);
  color: var(--g-error);
}

.tx-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: var(--g-s-5);
  margin: 0;
  border-top: 1px solid var(--g-hairline-1);
}

.tx-fact {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--g-s-3) 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.tx-fact--wide {
  grid-column: span 2;
}

.tx-fact dd {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-width: 0;
  margin: 0;
  color: var(--g-text-1);
  font-size: 13px;
  white-space: nowrap;
}

.tx-fact dd .g-mono {
  color: var(--g-text-1);
}

.tx-fact .tx-fact__link {
  text-decoration: none;
}

.tx-fact .tx-fact__link:hover {
  color: var(--g-accent);
}

/* ─── Balance change ─────────────────────────────────────────── */
.tx-ledger__label {
  margin: 0 0 var(--g-s-2);
}

.tx-ledger__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: 10px 0;
  border-top: 1px solid var(--g-hairline-1);
}

.tx-ledger__logo {
  flex: 0 0 auto;
}

.tx-ledger__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-ledger__amount {
  flex: 0 0 auto;
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.tx-ledger__amount--in {
  color: var(--g-success);
}

.tx-ledger__more {
  margin-top: var(--g-s-2);
}

/* ─── Sections ───────────────────────────────────────────────── */
.tx-section + .tx-section {
  border-top: 1px solid var(--g-hairline-1);
}

.tx-section__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  height: 52px;
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}

.tx-section__head:hover {
  background: var(--g-hairline-1);
}

.tx-section__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.tx-section__icon .v-icon {
  color: var(--g-text-2);
}

.tx-section__title {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

.tx-section__head .tx-section__chevron {
  margin-left: auto;
  color: var(--g-text-3);
  transition: transform var(--g-dur-base) var(--g-ease);
}

.tx-section--open .tx-section__head .tx-section__chevron {
  transform: rotate(180deg);
}

.tx-section__body {
  padding: 0 var(--g-s-4) var(--g-s-4);
}

.tx-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 11px;
  font-weight: 600;
}

/* ─── UTxOs ──────────────────────────────────────────────────── */
.tx-io-head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: 6px 0 var(--g-s-2);
}

.tx-utxo {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--g-s-3) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.tx-utxo__top {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}

.tx-utxo__ids {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tx-utxo__line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
}

.tx-utxo__line--primary .g-mono {
  color: var(--g-text-1);
}

.tx-utxo__ada {
  flex: 0 0 auto;
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.tx-you {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--g-r-chip);
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.tx-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tx-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 26px;
  padding: 0 10px 0 4px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  color: var(--g-text-2);
  font-size: 12px;
  white-space: nowrap;
}

.tx-pill__qty {
  color: var(--g-text-1);
  font-weight: 600;
}

.tx-pill__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-more {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border: 1px dashed var(--g-hairline-3);
  border-radius: var(--g-r-pill);
  background: transparent;
  color: var(--g-accent);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.tx-more:hover {
  border-color: var(--g-accent);
}

.tx-io-more {
  margin-top: var(--g-s-1);
}

.tx-flow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--g-s-3) 0;
  color: var(--g-text-3);
  font-size: 12px;
}

.tx-flow__rule {
  flex: 1 1 auto;
  height: 1px;
  background: var(--g-hairline-1);
}

.tx-flow .tx-flow__icon {
  color: var(--g-text-3);
}

/* ─── Key/value blocks, code, references ─────────────────────── */
.tx-block + .tx-block {
  margin-top: var(--g-s-4);
}

.tx-block__title {
  padding: var(--g-s-2) 0;
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.tx-block__title--split {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.tx-block__code {
  margin-top: var(--g-s-2);
}

.tx-kv {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  margin: 0;
}

.tx-kv dt,
.tx-kv dd {
  margin: 0;
  padding: 10px 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.tx-kv dt {
  color: var(--g-text-3);
}

.tx-kv dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--g-text-1);
}

.tx-kv .tx-kv__stack {
  flex-direction: column;
  align-items: flex-start;
}

.tx-kv__row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tx-kv__strong {
  font-weight: 600;
}

.tx-code {
  position: relative;
}

/* Code blocks are a control, not a surface: a solid raised fill keeps mono text legible. */
.tx-code__pre {
  max-height: 320px;
  margin: 0;
  overflow: auto;
  padding: var(--g-s-3) 40px var(--g-s-3) var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  color: var(--g-text-2);
  font-family: var(--g-font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tx-code .tx-code__copy {
  position: absolute;
  top: 6px;
  right: 6px;
}

.tx-ref-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  border-top: 1px solid var(--g-hairline-1);
}
</style>
