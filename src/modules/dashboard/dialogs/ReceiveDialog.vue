<template>
  <BaseDialog
    size="lg"
    :isOpen="isOpen"
    @close="emit('close')"
    :title="t('wallet.receive')"
    :subtitle="t('receive.subtitle')"
    :min-height="0"
    :persistent="false"
    :img="assets.qrCodeSvg"
    img-color="var(--g-accent)"
  >
    <v-card-text class="receive-body pa-0 pt-2">
      <!-- Which address: Cardano payment/stake/DRep, Bitcoin address type, or
           Midnight public/private/DUST. -->
      <div
        role="tablist"
        class="receive-segments"
        :aria-label="t('receive.addressType')"
        :style="{ '--receive-cols': segments.length }"
      >
        <button
          v-for="segment in segments"
          :key="segment.id"
          type="button"
          role="tab"
          class="receive-segment"
          :class="{ 'receive-segment--active': segment.id === activeSegment }"
          :aria-selected="segment.id === activeSegment ? 'true' : 'false'"
          @click="selectSegment(segment.id)"
        >
          <span v-if="segment.id === activeSegment" class="receive-segment__dot" aria-hidden="true"></span>
          <span>{{ segment.label }}</span>
        </button>
      </div>

      <section class="receive-hero">
        <div
          class="receive-qr"
          :class="{ 'receive-qr--empty': !qrData }"
          :role="qrData ? 'img' : undefined"
          :aria-label="qrData ? t('receive.qrLabel') : undefined"
        >
          <div v-show="!!qrData" ref="qrEl" class="receive-qr__code"></div>
          <p v-if="!qrData" class="receive-qr__empty t-caption">{{ t('midnight.receive.pendingSdk') }}</p>
        </div>

        <div class="receive-hero__info">
          <div class="receive-address">
            <!-- The DRep format pills share the label's line, so the DRep tab is
                 no taller than the others. -->
            <div class="receive-address__top">
              <span class="receive-address__label">{{ target.label }}</span>
              <div
                v-if="activeSegment === 'drep' && drepFormats.length > 1"
                class="receive-formats"
                role="group"
                :aria-label="t('receive.format')"
              >
                <button
                  v-for="format in drepFormats"
                  :key="format"
                  type="button"
                  class="receive-format"
                  :class="{ 'receive-format--active': format === activeDrepFormat }"
                  :aria-pressed="format === activeDrepFormat ? 'true' : 'false'"
                  @click="drepFormat = format"
                >
                  {{ DREP_FORMAT_LABELS[format] }}
                </button>
              </div>
            </div>
            <p
              v-if="target.value"
              class="receive-address__value"
              :class="{ 'receive-address__value--full': showFull }"
            ><span>{{ addressParts.head }}</span><span class="receive-address__mid">{{ addressParts.mid }}</span><span>{{ addressParts.tail }}</span></p>
            <button
              v-if="canExpandAddress"
              type="button"
              class="receive-link"
              :aria-expanded="showFull ? 'true' : 'false'"
              @click="showFull = !showFull"
            >
              {{ showFull ? t('governance.showLess') : t('receive.showFullAddress') }}
            </button>
          </div>

          <div class="receive-actions">
            <GButton tier="primary" :disabled="!target.value" @click="copyTarget()">
              <v-icon small left>{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
              {{ copied ? t('common.copied') : copyLabel }}
            </GButton>
            <GButton tier="secondary" :disabled="!qrData" @click="saveQr()">
              <v-icon small left>mdi-tray-arrow-down</v-icon>
              {{ t('receive.saveQr') }}
            </GButton>
          </div>

          <p v-if="target.hint" class="receive-hint">
            <v-icon small color="var(--g-info)" class="receive-hint__icon">mdi-information-outline</v-icon>
            <span>{{ target.hint }}</span>
          </p>
        </div>
      </section>

      <!-- Derivation details: HD path, credential, and the Bitcoin address index. -->
      <section v-if="target.path" class="receive-card">
        <button
          type="button"
          class="receive-card__toggle"
          aria-controls="receive-details"
          :aria-expanded="detailsOpen ? 'true' : 'false'"
          @click="detailsOpen = !detailsOpen"
        >
          <v-icon small color="var(--g-text-2)">mdi-file-tree-outline</v-icon>
          <span class="receive-card__title receive-card__title--quiet">{{ t('receive.derivationDetails') }}</span>
          <span class="receive-card__meta">{{ target.path }}</span>
          <v-icon small class="receive-chevron" :class="{ 'receive-chevron--open': detailsOpen }">mdi-chevron-down</v-icon>
        </button>
        <v-expand-transition>
          <div v-show="detailsOpen" id="receive-details" class="receive-details">
            <div class="receive-details__item">
              <span class="t-caption">{{ t('navigation.hdPath') }}</span>
              <span class="receive-mono">{{ target.path }}</span>
            </div>
            <div v-if="target.cred" class="receive-details__item">
              <span class="t-caption">{{ t('receive.credential') }}</span>
              <span class="receive-mono">
                {{ filters.truncate(target.cred) }}
                <CopyButton x-small :value="target.cred" />
              </span>
            </div>
            <div v-if="isBitcoinWallet" class="receive-details__item">
              <span class="t-caption">{{ t('receive.addressIndex') }}</span>
              <div class="receive-stepper">
                <GButton
                  compact
                  :aria-label="t('common.previous')"
                  :disabled="bitcoinAddressIndex === 0"
                  @click="previousBitcoinAddress()"
                >
                  <v-icon small>mdi-chevron-left</v-icon>
                </GButton>
                <span class="receive-mono g-num">{{ bitcoinAddressIndex }}</span>
                <GButton compact :aria-label="t('common.next')" @click="nextBitcoinAddress()">
                  <v-icon small>mdi-chevron-right</v-icon>
                </GButton>
              </div>
            </div>
          </div>
        </v-expand-transition>
      </section>

      <!-- Bitcoin: optional BIP21 amount and label, encoded into the QR. -->
      <section v-if="isBitcoinWallet" class="receive-card">
        <button
          type="button"
          class="receive-card__toggle"
          aria-controls="receive-request"
          :aria-expanded="requestOpen ? 'true' : 'false'"
          @click="requestOpen = !requestOpen"
        >
          <v-icon small color="var(--g-text-2)">mdi-tag-outline</v-icon>
          <span class="receive-card__title receive-card__title--quiet">
            {{ t('receive.specifyAmount') }} ({{ t('common.optional') }})
          </span>
          <v-icon small class="receive-chevron" :class="{ 'receive-chevron--open': requestOpen }">mdi-chevron-down</v-icon>
        </button>
        <v-expand-transition>
          <div v-show="requestOpen" id="receive-request" class="receive-request">
            <v-text-field
              v-model="bitcoinAmount"
              :label="t('receive.amount') + ' (BTC)'"
              type="number"
              step="0.00000001"
              outlined
              dense
              hide-details
            >
              <template v-slot:append>
                <span class="t-caption">BTC</span>
              </template>
            </v-text-field>
            <v-text-field
              v-model="bitcoinLabel"
              :label="t('receive.label')"
              outlined
              dense
              counter="50"
              maxlength="50"
            ></v-text-field>
          </div>
        </v-expand-transition>
      </section>

      <!-- Cardano: addresses this wallet has already used. Shown on every tab so
           switching tabs never changes the dialog's height. -->
      <section v-if="isCardanoWallet" class="receive-card">
        <div class="receive-card__head">
          <button
            type="button"
            class="receive-card__toggle"
            aria-controls="receive-used"
            :aria-expanded="usedOpen ? 'true' : 'false'"
            @click="usedOpen = !usedOpen"
          >
            <span class="receive-card__icon">
              <v-icon small color="var(--g-accent)">mdi-wallet-outline</v-icon>
            </span>
            <span class="receive-card__title">{{ t('wallet.usedAddresses') }}</span>
            <span class="receive-count g-num">{{ usedAddresses.length }}</span>
          </button>
          <label for="receive-include-change" class="receive-switch-label">{{ t('receive.includeChange') }}</label>
          <v-switch
            id="receive-include-change"
            v-model="includeChange"
            class="receive-switch mt-0 pt-0"
            color="var(--g-accent)"
            inset
            dense
            hide-details
          />
          <button
            type="button"
            class="receive-icon-btn"
            aria-controls="receive-used"
            :aria-label="t('wallet.usedAddresses')"
            :aria-expanded="usedOpen ? 'true' : 'false'"
            @click="usedOpen = !usedOpen"
          >
            <v-icon small class="receive-chevron" :class="{ 'receive-chevron--open': usedOpen }">mdi-chevron-down</v-icon>
          </button>
        </div>
        <v-expand-transition>
          <div v-show="usedOpen" id="receive-used" class="receive-used">
            <p v-if="!usedAddresses.length" class="receive-used__empty t-body-sm">{{ t('receive.noUsedAddresses') }}</p>
            <ul v-else class="receive-used__list">
              <li v-for="row in visibleUsedAddresses" :key="row.path" class="receive-used__row">
                <span class="receive-mono receive-used__address" :title="row.address">{{ shortAddress(row.address) }}</span>
                <span v-if="row.isChange" class="receive-chip">{{ t('receive.changeChip') }}</span>
                <span class="receive-used__path">{{ row.path }}</span>
                <CopyButton x-small :value="row.address" />
              </li>
            </ul>
            <button
              v-if="usedAddresses.length > USED_PREVIEW_COUNT"
              type="button"
              class="receive-link receive-used__more"
              @click="showAllUsed = !showAllUsed"
            >
              {{ showAllUsed ? t('governance.showLess') : `${t('common.showAll')} (${usedAddresses.length})` }}
            </button>
          </div>
        </v-expand-transition>
      </section>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, toRefs, computed, onBeforeUnmount } from 'vue';
import QRCodeStyling, { type Options as QrOptions } from 'qr-code-styling';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import networks from '@/utils/networks';
import { Blockchain, type Key } from '@/models/types';
import { useTranslation } from '@/shared/composables/useTranslation';
import { debugLog } from '@/utils/debug';

interface Segment {
  id: string;
  label: string;
}

interface ReceiveTarget {
  label: string;
  value: string;
  hint: string;
  path?: string;
  cred?: string;
}

interface UsedAddressRow {
  address: string;
  path: string;
  isChange: boolean;
}

type DrepFormat = 'cip129' | 'cip105';

const { t } = useTranslation();

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close']);

const { loggedWallet, keys } = toRefs(walletStore);

const isBitcoinWallet = computed(() => loggedWallet.value?.chain === Blockchain.BITCOIN);
const isMidnightWallet = computed(() => loggedWallet.value?.chain === Blockchain.MIDNIGHT);
const isCardanoWallet = computed(() => !isBitcoinWallet.value && !isMidnightWallet.value);

const ticker = computed(() => networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));

// Spec identifiers, the same in every language.
const DREP_FORMAT_LABELS: Record<DrepFormat, string> = { cip129: 'CIP-129', cip105: 'CIP-105' };
const USED_PREVIEW_COUNT = 6;
const QR_SIZE = 192;
const QR_EXPORT_SIZE = 1024;
const QR_BACKGROUND = '#ffffff';
const COPIED_FEEDBACK_MS = 1600;

const selected = ref('payment');
const drepFormat = ref<DrepFormat>('cip129');
const showFull = ref(false);
const detailsOpen = ref(false);
const requestOpen = ref(false);
const usedOpen = ref(false);
const includeChange = ref(false);
const showAllUsed = ref(false);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

// Bitcoin state
const bitcoinAddressType = ref('segwit');
const bitcoinAddressIndex = ref(0);
const bitcoinAddress = ref('');
const bitcoinAmount = ref('');
const bitcoinLabel = ref('');

// ---- Segments ----------------------------------------------------------------

// Watch wallets have no DRep keys: walletBg returns `drep105: []` and
// `drep129: []` for WalletType.Watch, so every access is guarded.
const drepKeys = computed<Record<DrepFormat, Key | undefined>>(() => ({
  cip129: keys.value?.drep129?.[0],
  cip105: keys.value?.drep105?.[0],
}));

const drepFormats = computed<DrepFormat[]>(() =>
  (['cip129', 'cip105'] as DrepFormat[]).filter((format) => !!drepKeys.value[format]?.address),
);

const activeDrepFormat = computed<DrepFormat | undefined>(() =>
  drepFormats.value.includes(drepFormat.value) ? drepFormat.value : drepFormats.value[0],
);

const segments = computed<Segment[]>(() => {
  if (isBitcoinWallet.value) {
    return [
      { id: 'segwit', label: t('receive.segwit') },
      { id: 'legacy', label: t('receive.legacy') },
      { id: 'taproot', label: t('receive.taproot') },
    ];
  }
  if (isMidnightWallet.value) {
    return [
      { id: 'public', label: t('midnight.common.public') },
      { id: 'private', label: t('midnight.common.private') },
      { id: 'dust', label: t('midnight.receive.tabDust') },
    ];
  }
  const list: Segment[] = [
    { id: 'payment', label: t('wallet.payment') },
    { id: 'stake', label: t('receive.tabStake') },
  ];
  const governanceSupported = networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  if (governanceSupported && drepFormats.value.length) {
    list.push({ id: 'drep', label: t('receive.tabDrep') });
  }
  return list;
});

const activeSegment = computed(() => (isBitcoinWallet.value ? bitcoinAddressType.value : selected.value));

function selectSegment(id: string): void {
  if (isBitcoinWallet.value) {
    if (bitcoinAddressType.value === id) return;
    bitcoinAddressType.value = id;
    updateBitcoinAddress();
    return;
  }
  selected.value = id;
}

// A tab can disappear while the dialog is open (the wallet's DRep keys go away,
// or the wallet switches). Fall back to the first tab rather than keep a
// selection nothing on screen represents.
watch(segments, (list) => {
  if (isBitcoinWallet.value || !list.length) return;
  if (!list.some((segment) => segment.id === selected.value)) {
    selected.value = list[0].id;
  }
});

// ---- The selected address ----------------------------------------------------

const bitcoinAddressTypeLabel = computed(() => {
  switch (bitcoinAddressType.value) {
    case 'segwit':
      return `${t('receive.segwit')} ${t('wallet.address')}`;
    case 'legacy':
      return `${t('receive.legacy')} ${t('wallet.address')}`;
    case 'taproot':
      return `${t('receive.taproot')} ${t('wallet.address')}`;
    default:
      return t('wallet.address');
  }
});

const bitcoinAddressTypeDescription = computed(() => {
  switch (bitcoinAddressType.value) {
    case 'segwit':
      return t('receive.segwitDescription');
    case 'legacy':
      return t('receive.legacyDescription');
    case 'taproot':
      return t('receive.taprootDescription');
    default:
      return '';
  }
});

const bitcoinDerivationPurpose = computed(() => {
  switch (bitcoinAddressType.value) {
    case 'legacy':
      return 44;
    case 'taproot':
      return 86;
    default:
      return 84;
  }
});

function cardanoTarget(): ReceiveTarget {
  if (selected.value === 'stake') {
    const key = keys.value?.stake?.[0];
    return { label: t('wallet.stakeAddress'), value: key?.address ?? '', hint: t('receive.stakeInfo'), path: key?.path, cred: key?.cred };
  }
  if (selected.value === 'drep') {
    const format = activeDrepFormat.value;
    const key = format ? drepKeys.value[format] : undefined;
    const legacy = format === 'cip105';
    return {
      label: legacy ? t('wallet.drepId105') : t('wallet.drepId129'),
      value: key?.address ?? '',
      hint: legacy ? t('receive.drepLegacyInfo') : t('receive.drepInfo', { ticker: ticker.value }),
      path: key?.path,
      cred: key?.cred,
    };
  }
  const key = keys.value?.payment?.[0];
  return {
    label: t('wallet.paymentAddress'),
    value: key?.address ?? '',
    hint: t('receive.paymentInfo', { ticker: ticker.value }),
    path: key?.path,
    cred: key?.cred,
  };
}

function midnightTarget(): ReceiveTarget {
  // Populated by the SDK at login; empty until derived, which renders the
  // "not available yet" state instead of a QR.
  const addrs = midnightStore.addresses;
  switch (selected.value) {
    case 'private':
      return { label: t('midnight.receive.privateLabel'), value: addrs.shielded ?? '', hint: t('midnight.receive.privateInfo') };
    case 'dust':
      return { label: t('midnight.receive.dustLabel'), value: addrs.dust ?? '', hint: t('midnight.receive.dustInfo') };
    default:
      return { label: t('midnight.receive.publicLabel'), value: addrs.unshielded ?? '', hint: t('midnight.receive.publicInfo') };
  }
}

const target = computed<ReceiveTarget>(() => {
  if (isBitcoinWallet.value) {
    return {
      label: bitcoinAddressTypeLabel.value,
      value: bitcoinAddress.value,
      hint: bitcoinAddressTypeDescription.value,
      path: `m/${bitcoinDerivationPurpose.value}'/0'/0'/0/${bitcoinAddressIndex.value}`,
    };
  }
  return isMidnightWallet.value ? midnightTarget() : cardanoTarget();
});

const copyLabel = computed(() => (activeSegment.value === 'drep' ? t('receive.copyDrepId') : t('dashboard.copyAddress')));

// Head and tail stay bright: they are what people compare when they check an
// address, so the middle is muted even when it is shown in full.
const canExpandAddress = computed(() => target.value.value.length > 24);
const addressParts = computed(() => {
  const value = target.value.value;
  if (!canExpandAddress.value) return { head: value, mid: '', tail: '' };
  if (showFull.value) return { head: value.slice(0, 8), mid: value.slice(8, -8), tail: value.slice(-8) };
  return { head: value.slice(0, 12), mid: '…', tail: value.slice(-8) };
});

function shortAddress(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

// ---- Used addresses (Cardano) ------------------------------------------------

const usedAddresses = computed<UsedAddressRow[]>(() => {
  const k = keys.value;
  if (!k) return [];
  const toRow = (key: Key, isChange: boolean): UsedAddressRow => ({ address: key.address ?? '', path: key.path, isChange });
  const rows = (k.payment ?? []).filter((key) => key.used && key.address).map((key) => toRow(key, false));
  if (includeChange.value) {
    rows.push(...(k.change ?? []).filter((key) => key.used && key.address).map((key) => toRow(key, true)));
  }
  return rows;
});

const visibleUsedAddresses = computed(() =>
  showAllUsed.value ? usedAddresses.value : usedAddresses.value.slice(0, USED_PREVIEW_COUNT),
);

// ---- Copy ---------------------------------------------------------------------

async function copyTarget(): Promise<void> {
  const value = target.value.value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
    }, COPIED_FEEDBACK_MS);
  } catch (error) {
    debugLog('Receive: clipboard write failed', error);
  }
}

// ---- Bitcoin --------------------------------------------------------------------

async function deriveBitcoinAddress(): Promise<void> {
  if (!loggedWallet.value || !loggedWallet.value.publicKey) {
    console.error('No logged wallet or public key');
    return;
  }

  try {
    const { deriveBitcoinAddress: deriveAddress } = await import('@/chains/bitcoin/bitcoinKeyManager');
    bitcoinAddress.value = deriveAddress(
      loggedWallet.value.publicKey, // xpub
      loggedWallet.value.network,
      bitcoinAddressType.value,
      0, // External chain (receive addresses)
      bitcoinAddressIndex.value,
    );
  } catch (error) {
    console.error('Failed to derive Bitcoin address:', error);
    // Empty renders the "not available" state rather than a QR of an error string.
    bitcoinAddress.value = '';
  }
}

function generateBitcoinUri(): string {
  let uri = `bitcoin:${bitcoinAddress.value}`;
  const params: string[] = [];

  const amount = parseFloat(bitcoinAmount.value);
  if (!isNaN(amount) && amount > 0) {
    params.push(`amount=${amount.toFixed(8)}`);
  }

  if (bitcoinLabel.value) {
    params.push(`label=${encodeURIComponent(bitcoinLabel.value)}`);
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}

async function updateBitcoinAddress(): Promise<void> {
  await deriveBitcoinAddress();
}

function previousBitcoinAddress(): void {
  if (bitcoinAddressIndex.value > 0) {
    bitcoinAddressIndex.value--;
    updateBitcoinAddress();
  }
}

function nextBitcoinAddress(): void {
  bitcoinAddressIndex.value++;
  updateBitcoinAddress();
}

// ---- QR -------------------------------------------------------------------------

// QR-center Gero logo, tinted per chain (Apex Prime teal / Vector orange).
const qrLogo = computed(() => assets.resolveChainLogo(loggedWallet.value?.chain));

// Bitcoin encodes a BIP21 URI so the optional amount and label travel with it.
const qrData = computed(() => {
  if (!target.value.value) return '';
  return isBitcoinWallet.value ? generateBitcoinUri() : target.value.value;
});

function qrOptions(size: number, data: string): Partial<QrOptions> {
  return {
    width: size,
    height: size,
    type: 'svg',
    data,
    image: qrLogo.value,
    margin: 2,
    qrOptions: { typeNumber: 0, mode: 'Byte', errorCorrectionLevel: 'Q' },
    imageOptions: { hideBackgroundDots: true, imageSize: 0.5, margin: Math.round(size * 0.05), crossOrigin: 'anonymous' },
    backgroundOptions: { color: QR_BACKGROUND },
    cornersSquareOptions: { type: 'extra-rounded' },
    cornersDotOptions: { type: 'dot' },
  };
}

const qrEl = ref<HTMLElement | null>(null);
let qrCode: QRCodeStyling | null = null;
let qrHost: HTMLElement | null = null;

// One instance, re-pointed at whichever address is selected. update() redraws
// into the container it was last appended to, so only a new host needs append().
function renderQr(): void {
  const host = qrEl.value;
  const data = qrData.value;
  if (!host || !data) return;
  if (!qrCode) {
    qrCode = new QRCodeStyling(qrOptions(QR_SIZE, data));
  } else {
    qrCode.update({ data, image: qrLogo.value });
  }
  if (qrHost !== host) {
    host.innerHTML = '';
    qrCode.append(host);
    qrHost = host;
  }
}

// Saves a print-size PNG rather than the 192px on-screen render.
function saveQr(): void {
  if (!qrData.value) return;
  const chain = isBitcoinWallet.value ? 'bitcoin' : isMidnightWallet.value ? 'midnight' : 'cardano';
  new QRCodeStyling(qrOptions(QR_EXPORT_SIZE, qrData.value))
    .download({ name: `gero-${chain}-${activeSegment.value}-qr`, extension: 'png' })
    .catch((error) => debugLog('Receive: QR download failed', error));
}

watch([qrData, qrEl], () => nextTick(renderQr));

// A new address resets the transient states that belonged to the old one.
watch(() => target.value.value, () => {
  copied.value = false;
  showFull.value = false;
});

watch(includeChange, () => {
  showAllUsed.value = false;
});

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return;
    copied.value = false;
    showFull.value = false;

    if (isBitcoinWallet.value) {
      bitcoinAddressType.value = loggedWallet.value?.addressType || 'segwit';
      bitcoinAddressIndex.value = 0;
      bitcoinAmount.value = '';
      bitcoinLabel.value = '';
      await deriveBitcoinAddress();
    } else {
      selected.value = segments.value[0]?.id ?? 'payment';
    }

    await nextTick();
    renderQr();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTimeout(copiedTimer);
});
</script>

<style scoped lang="scss">
.receive-body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  color: var(--g-text-2);
}

/* ---- Segmented control ---- */
.receive-segments {
  display: grid;
  grid-template-columns: repeat(var(--receive-cols, 3), minmax(0, 1fr));
  gap: var(--g-s-1);
  padding: var(--g-s-1);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-1);
  background: rgba(255, 255, 255, 0.04);
}

.receive-segment {
  height: var(--g-btn-h-compact);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-2);
  border-radius: var(--g-r-control);
  border: 1px solid transparent;
  background: transparent;
  color: var(--g-text-2);
  font-family: var(--g-font-ui);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--g-dur-fast) var(--g-ease),
    border-color var(--g-dur-fast) var(--g-ease),
    color var(--g-dur-fast) var(--g-ease);

  &:hover {
    color: var(--g-text-1);
  }
}

/* The selected segment is a control, not a surface: a solid chip keeps the
   choice legible on any backdrop behind the glass. */
.receive-segment--active {
  background: var(--g-overlay);
  border-color: var(--g-hairline-2);
  color: var(--g-text-1);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.receive-segment__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-accent);
}

/* ---- Hero: QR + address ---- */
.receive-hero {
  @include g-glass-tier(false);
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-5);
  padding: var(--g-s-5);
}

/* Justified solid: a QR needs a white quiet zone to scan. */
.receive-qr {
  flex: 0 0 auto;
  width: 212px;
  height: 212px;
  box-sizing: border-box;
  padding: 10px;
  border-radius: var(--g-r-card);
  background: rgb(255, 255, 255);
  display: flex;
  align-items: center;
  justify-content: center;
}

.receive-qr--empty {
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed var(--g-hairline-2);
}

.receive-qr__code {
  width: 192px;
  height: 192px;
  line-height: 0;
}

.receive-qr__empty {
  margin: 0;
  padding: 0 var(--g-s-3);
  text-align: center;
}

.receive-hero__info {
  flex: 1 1 240px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.receive-address {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

/* Fixed to the pills' height whether or not they show, so the label row is
   the same on every tab. */
.receive-address__top {
  min-height: 26px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.receive-address__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--g-text-2);
}

.receive-address__value {
  margin: 0;
  font-family: var(--g-font-mono);
  font-size: 18px;
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: var(--g-text-1);
  word-break: break-all;
}

.receive-address__mid {
  color: var(--g-text-3);
}

.receive-address__value--full {
  font-size: 14px;
  line-height: 1.6;

  .receive-address__mid {
    color: var(--g-text-2);
  }
}

.receive-link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-accent);
  font-family: var(--g-font-ui);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.receive-formats {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.receive-format {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-1);
  background: transparent;
  color: var(--g-text-3);
  font-family: var(--g-font-ui);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--g-dur-fast) var(--g-ease),
    border-color var(--g-dur-fast) var(--g-ease),
    color var(--g-dur-fast) var(--g-ease);
}

.receive-format--active {
  color: var(--g-text-1);
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--g-hairline-3);
}

.receive-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.receive-hint {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--g-text-2);
}

.receive-hint__icon {
  flex-shrink: 0;
  margin-top: 1px;
}

/* ---- Collapsible cards ---- */
.receive-card {
  @include g-glass-tier(false);
  overflow: hidden;
}

.receive-card__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding-right: var(--g-s-2);
}

.receive-card__toggle {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  min-height: var(--g-row-h-panel);
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-4);
  border: 0;
  background: transparent;
  color: var(--g-text-2);
  font-family: var(--g-font-ui);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.receive-card__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--g-text-1);
}

.receive-card__title--quiet {
  flex: 1 1 auto;
  font-size: 14px;
  font-weight: 500;
  color: var(--g-text-2);
}

.receive-card__meta {
  font-family: var(--g-font-mono);
  font-size: 12px;
  color: var(--g-text-3);
}

.receive-card__icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-control);
  background: rgba(255, 255, 255, 0.05);
}

.receive-count {
  min-width: 24px;
  height: 22px;
  box-sizing: border-box;
  padding: 0 var(--g-s-2);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-pill);
  background: rgba(255, 255, 255, 0.06);
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
}

.receive-chevron {
  transition: transform var(--g-dur-fast) var(--g-ease);
}

.receive-chevron--open {
  transform: rotate(180deg);
}

.receive-icon-btn {
  width: var(--g-btn-h);
  height: var(--g-btn-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--g-r-control);
  background: transparent;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease);

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
}

.receive-switch-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--g-text-2);
  cursor: pointer;
}

.receive-switch {
  flex: 0 0 auto;
}

.receive-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--g-s-3);
  padding: var(--g-s-1) var(--g-s-4) var(--g-s-4);
}

.receive-details__item {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.receive-mono {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  font-family: var(--g-font-mono);
  font-size: 13px;
  color: var(--g-text-1);
}

.receive-stepper {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.receive-request {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-1) var(--g-s-4) var(--g-s-2);
}

/* ---- Used addresses ---- */
.receive-used {
  display: flex;
  flex-direction: column;
  padding: 0 var(--g-s-2) var(--g-s-2);
  border-top: 1px solid var(--g-hairline-1);
}

.receive-used__empty {
  margin: 0;
  padding: var(--g-s-4);
  text-align: center;
}

.receive-used__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.receive-used__row {
  min-height: var(--g-row-h-table);
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: 0 var(--g-s-2);
  border-bottom: 1px solid var(--g-hairline-1);

  &:last-child {
    border-bottom: 0;
  }
}

.receive-used__address {
  min-width: 0;
}

.receive-used__path {
  margin-left: auto;
  font-family: var(--g-font-mono);
  font-size: 12px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.receive-chip {
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--g-r-chip);
  background: rgba(255, 255, 255, 0.06);
  font-size: 11px;
  font-weight: 500;
  color: var(--g-text-2);
}

.receive-used__more {
  align-self: center;
  margin-top: var(--g-s-2);
}
</style>
