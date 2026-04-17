# Multi-Recipient Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Send Dialog from single-recipient to multi-recipient, each with independent full multi-asset selection, while keeping the beginner flow identical to the current single-card experience.

**Architecture:** Replace `sendData.recipientAddress + selectedTokens + selectedCollectibles` with a `recipients: SendRecipient[]` array. `SendDialog.vue` aggregates all recipients into a multi-output `Cardano.TxOut[]` passed to the existing `buildCardanoTransaction()` — no changes to `builder.ts`. A new `SendRecipientCard.vue` component self-contains address input, handle resolution, contacts, QR, and inline `AssetsToSendStep.vue`. The stepper collapses from 3 steps to 2 (Recipients → Summary).

**Tech Stack:** Vue 2.7, TypeScript, Vuetify 2.7, `@cardano-sdk/core`, `adaHandleApi`, existing `rules.recipientRules()`, `isPaymentAddress()`, `buildCardanoTransaction()`, `BrowserTxConstruction.minAdaRequired()`.

---

## File Map

| File | Change |
|------|--------|
| `src/models/send-flow.types.ts` | Add `SendRecipient` interface |
| `src/plugins/i18n/us.ts` | Add 5 new keys |
| `src/plugins/i18n/de.ts` | Add 5 German translations |
| `src/modules/dashboard/components/AssetsToSendStep.vue` | Add `excludedCollectibleFingerprints` prop; filter collectibles grid |
| `src/modules/dashboard/components/SendRecipientCard.vue` | **Create** — address + handle + contacts/QR + inline assets + collapsed state + duplicate/delete |
| `src/modules/dashboard/dialogs/SendDialog.vue` | Replace single sendData with `recipients[]`; 3→2 step stepper; aggregate outputs; updated `buildTx`, `setMax`, `isValid` |
| `src/modules/dashboard/components/SummaryStep.vue` | Accept `recipients` prop; show all recipient addresses; single fee line |

**Files NOT changed:** `src/shared/utils/builder.ts`, `src/shared/composables/useTransactionSigning.ts`, `src/modules/dashboard/components/SendRecipientDetailsStep.vue`, all hardware wallet flows, `src/chrome/serialization.ts`.

---

## Task 1: i18n keys

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add English keys to `us.ts`**

Find the line `'wallet.recipient': 'Recipient',` (line ~2222). Insert after it:

```typescript
  'wallet.recipients': 'Recipients',
  'wallet.addAnotherRecipient': '+ Add another recipient',
  'wallet.duplicateRecipient': 'Duplicate recipient',
  'wallet.removeRecipient': 'Remove recipient',
  'wallet.tooManyRecipients': 'Too many recipients or assets for one transaction. Remove a recipient or reduce assets.',
```

- [ ] **Step 2: Add German keys to `de.ts`**

Find the line `'wallet.recipient': 'Empfänger',` (line ~2682). Insert after it:

```typescript
  'wallet.recipients': 'Empfänger',
  'wallet.addAnotherRecipient': '+ Weiteren Empfänger hinzufügen',
  'wallet.duplicateRecipient': 'Empfänger duplizieren',
  'wallet.removeRecipient': 'Empfänger entfernen',
  'wallet.tooManyRecipients': 'Zu viele Empfänger oder Assets für eine Transaktion. Bitte Empfänger oder Assets reduzieren.',
```

- [ ] **Step 3: TypeScript check**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet"
npx tsc --noEmit 2>&1 | grep "i18n\|us\.ts\|de\.ts" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(i18n): add multi-recipient send keys"
```

---

## Task 2: Add `SendRecipient` type

**Files:**
- Modify: `src/models/send-flow.types.ts`

- [ ] **Step 1: Add the interface**

Open `src/models/send-flow.types.ts`. Add after the existing `SendFlowData` interface (after line 45):

```typescript
export interface SendRecipient {
  /** Stable key for v-for — generated with crypto.randomUUID() */
  id: string;
  /** Raw input: payment address or $handle string */
  address: string;
  /** Resolved payment address (null when address is not yet valid or handle not yet resolved) */
  resolvedAddress: string | null;
  /** Selected tokens; first entry is always ADA (locked, cannot remove) */
  selectedTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
  /** Selected collectibles keyed by NFT name */
  selectedCollectibles: Record<string, Collectible & { unit: string }>;
  /** Min ADA required for this output (calculated from non-native assets) */
  minAda: number;
  /** > 0 when ADA in this card is less than required */
  adaShortage: number;
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "send-flow.types" | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/models/send-flow.types.ts
git commit -m "feat(types): add SendRecipient interface for multi-recipient send"
```

---

## Task 3: Add `excludedCollectibleFingerprints` prop to `AssetsToSendStep.vue`

**Files:**
- Modify: `src/modules/dashboard/components/AssetsToSendStep.vue`

This prop lets the parent tell this card which NFTs are already fully committed by other recipient cards, so they are hidden from the collectibles grid. No other logic changes.

- [ ] **Step 1: Add the prop**

In `AssetsToSendStep.vue`, find the `Props` interface (line ~166):

```typescript
interface Props {
  value: any;
  tokens: any[];
}
```

Replace with:

```typescript
interface Props {
  value: any;
  tokens: any[];
  /** Fingerprints of NFTs fully allocated to other recipient cards — hidden from picker */
  excludedCollectibleFingerprints?: Set<string>;
}
```

- [ ] **Step 2: Filter excluded collectibles in the `collections` computed**

Find the `collections` computed (line ~238). At the start of the return block, add a filter:

```typescript
const collections = computed(() => {
  const excluded = props.excludedCollectibleFingerprints ?? new Set<string>();
  let cols: any[] = Object.values(resolvedCollections.value);
  if (search.value) {
    cols = cols
      .map(collection => ({
        ...collection,
        items: collection.items.filter((item: any) =>
          item.name?.toLowerCase().includes(search.value.toLowerCase())
        ),
      }))
      .filter(collection => collection.items.length > 0);
  }
  // Filter out NFTs already committed to other recipient cards
  cols = cols.map(collection => ({
    ...collection,
    items: collection.items.filter((item: any) =>
      !excluded.has(item.fingerprint)
    ),
  })).filter(collection => collection.items.length > 0);

  if (cols) {
    return cols.map(collection => {
      collection.items.map((item: any) => {
        if (item['toSendQuantity'] === undefined) {
          item['toSendQuantity'] = 1;
        }
        return item;
      });
      return collection;
    });
  }
  return cols;
});
```

- [ ] **Step 3: ESLint + TypeScript check**

```bash
npx eslint "src/modules/dashboard/components/AssetsToSendStep.vue" --fix 2>&1 | head -20
npx tsc --noEmit 2>&1 | grep "AssetsToSendStep" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/dashboard/components/AssetsToSendStep.vue
git commit -m "feat(send): add excludedCollectibleFingerprints prop to AssetsToSendStep"
```

---

## Task 4: Create `SendRecipientCard.vue`

**Files:**
- Create: `src/modules/dashboard/components/SendRecipientCard.vue`

This is the core new component. It self-contains:
- Collapsed state (when another card is active)
- Address textarea with handle resolution (Mainnet Cardano only)
- Contact browse + save/edit + QR scan
- `AssetsToSendStep.vue` inline when address is valid
- Duplicate and delete action buttons

Props in → emits out pattern: parent controls `isExpanded`; card emits `expand`, `update:recipient`, `duplicate`, `remove`, `setMax`.

- [ ] **Step 1: Create the file**

Create `src/modules/dashboard/components/SendRecipientCard.vue` with:

```vue
<template>
  <v-card
    outlined
    class="recipient-card mb-3"
    :class="{ 'recipient-card--expanded': isExpanded }"
  >
    <!-- Collapsed view -->
    <v-card-title
      v-if="!isExpanded"
      class="recipient-card__collapsed py-2 px-3"
      @click="$emit('expand')"
      style="cursor: pointer; display: flex; align-items: center; min-height: 52px;"
    >
      <v-icon small class="mr-2" color="#00DFF3">mdi-account-outline</v-icon>
      <span class="caption font-weight-medium mr-2" style="color: #CECFD2;">
        {{ $t('wallet.recipient') }} {{ index + 1 }}
      </span>
      <span class="caption" style="color: rgba(255,255,255,0.5); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        {{ displayAddress }}
      </span>
      <v-chip x-small color="#00DFF330" text-color="#00DFF3" class="ml-2" v-if="totalAdaDisplay">
        {{ totalAdaDisplay }}
      </v-chip>
      <v-icon small class="ml-2" color="rgba(255,255,255,0.3)">mdi-pencil-outline</v-icon>
    </v-card-title>

    <!-- Expanded view -->
    <template v-if="isExpanded">
      <v-card-title class="py-2 px-3" style="display: flex; align-items: center; min-height: 52px;">
        <v-icon small class="mr-2" color="#00DFF3">mdi-account-outline</v-icon>
        <span class="caption font-weight-medium" style="color: #CECFD2;">
          {{ $t('wallet.recipient') }} {{ index + 1 }}
        </span>
        <v-spacer />
        <!-- Duplicate -->
        <v-tooltip bottom content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn icon x-small v-bind="attrs" v-on="on" @click="$emit('duplicate')" class="mr-1">
              <v-icon x-small color="rgba(255,255,255,0.4)">mdi-content-copy</v-icon>
            </v-btn>
          </template>
          <span>{{ $t('wallet.duplicateRecipient') }}</span>
        </v-tooltip>
        <!-- Delete (hidden when only 1 card) -->
        <v-tooltip bottom content-class="custom-tooltip" v-if="canDelete">
          <template v-slot:activator="{ on, attrs }">
            <v-btn icon x-small v-bind="attrs" v-on="on" @click="$emit('remove')">
              <v-icon x-small color="#F97066">mdi-trash-can-outline</v-icon>
            </v-btn>
          </template>
          <span>{{ $t('wallet.removeRecipient') }}</span>
        </v-tooltip>
      </v-card-title>

      <v-card-text class="px-3 pt-0">
        <!-- Contact buttons row -->
        <v-row no-gutters class="mb-2">
          <v-col cols="6" class="pr-1">
            <!-- Browse contacts -->
            <v-menu
              v-model="contactsMenu"
              :close-on-content-click="false"
              offset-y
              min-width="340"
              max-height="300"
              transition="fade-transition"
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="#272930" style="background-color: #0F0F0F;" class="pl-0" v-bind="attrs" v-on="on"
                  :disabled="!contacts || Object.values(contacts).length === 0">
                  <v-list-item dense class="px-0">
                    <v-avatar size="28" class="mx-0">
                      <v-icon small color="#00DFF3">mdi-book-open-variant-outline</v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: white; font-size: 11px">{{ $t('wallet.contacts') }}</v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-btn>
              </template>
              <v-card outlined style="background: #0c0e12 !important; border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 16px !important;">
                <v-card-title class="py-2">
                  {{ $t('wallet.contacts') }}
                  <v-spacer />
                  <v-btn icon small @click="contactsMenu = false"><v-icon>mdi-window-close</v-icon></v-btn>
                </v-card-title>
                <v-card-text class="pa-0">
                  <v-data-table
                    dense
                    class="transparent"
                    :headers="contactsHeaders"
                    :items="contacts ? Object.values(contacts) : []"
                    hide-default-footer
                    disable-pagination
                    @click:row="selectContact"
                  >
                    <template v-slot:[`item.address`]="{ item }">
                      {{ filters.truncate(item.address) }}
                    </template>
                  </v-data-table>
                </v-card-text>
              </v-card>
            </v-menu>
          </v-col>
          <v-col cols="6" class="pl-1">
            <!-- QR scan -->
            <v-btn outlined block color="#272930" style="background-color: #0F0F0F" class="pl-0" @click="qrScanDialog = true">
              <v-list-item dense class="px-0">
                <v-avatar size="28" class="mx-0">
                  <v-icon small color="#00DFF3">mdi-qrcode</v-icon>
                </v-avatar>
                <v-list-item-content>
                  <v-list-item-title style="color: white; font-size: 11px">{{ $t('wallet.qrScan') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-btn>
            <QRAddressScannerDialog
              :isOpen="qrScanDialog"
              :chain="loggedWallet?.chain"
              :network="loggedWallet?.network"
              @close="qrScanDialog = false"
              @scan="onQRScan"
            />
          </v-col>
        </v-row>

        <!-- Address textarea -->
        <v-textarea
          v-if="loggedWallet"
          v-model="localAddress"
          :label="$t('wallet.recipientAddress')"
          :placeholder="isMainnetCardano ? $t('wallet.enterRecipientOrHandle') : $t('wallet.enterRecipientAddress')"
          rows="2"
          outlined
          :rules="[rules.recipientRules(loggedWallet?.chain, loggedWallet?.network)]"
          class="recipient-address mb-0"
          @input="resolveAddress"
          :loading="resolving"
          hide-details="auto"
          dense
          clearable
        >
          <template v-slot:append>
            <v-progress-circular color="white" v-if="resolving" size="20" indeterminate />
            <v-icon color="#F97066" v-else-if="resolvedFailed">mdi-alert</v-icon>
          </template>
        </v-textarea>

        <!-- Handle resolution preview -->
        <v-list-item v-if="handleAsset" class="px-0 pt-1">
          <v-list-item-avatar v-if="handleAsset.img" size="40" rounded>
            <v-img :src="handleAsset.img" contain />
          </v-list-item-avatar>
          <v-list-item-subtitle style="white-space: normal; font-size: 11px">
            {{ recipient.resolvedAddress }}
          </v-list-item-subtitle>
        </v-list-item>

        <!-- Assets section (shown only when address is valid) -->
        <div v-if="isAddressValid" class="mt-3">
          <v-divider class="mb-3" />
          <AssetsToSendStep
            :value="assetsModel"
            @input="onAssetsInput"
            :tokens="availableTokens"
            :excluded-collectible-fingerprints="excludedCollectibleFingerprints"
            @setMax="onSetMax"
          />
        </div>
      </v-card-text>
    </template>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import AssetsToSendStep from './AssetsToSendStep.vue';
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import { SendRecipient, Token, Collectible } from '@/models/send-flow.types';
import rules from '@/utils/rules';
import filters from '@/shared/utils/filters';
import adaHandleApi from '@/api/ada-handle.api';
import assets from '@/utils/assets';
import debounce from 'lodash/debounce';
import { isPaymentAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';

interface Props {
  recipient: SendRecipient;
  index: number;
  isExpanded: boolean;
  canDelete: boolean;
  /** All wallet tokens with balances reduced by other cards' commitments */
  availableTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
  /** Fingerprints of NFTs fully committed by other cards */
  excludedCollectibleFingerprints?: Set<string>;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'expand'): void;
  (e: 'update:recipient', value: SendRecipient): void;
  (e: 'duplicate'): void;
  (e: 'remove'): void;
  (e: 'setMax', payload: { tokenIndex: number }): void;
}>();

const { t } = useTranslation();
const { loggedWallet, contacts } = toRefs(walletStore);

const localAddress = ref<string>(props.recipient.address);
const resolving = ref<boolean>(false);
const resolvedFailed = ref<boolean>(false);
const handleAsset = ref<{ name?: string; img?: string } | null>(null);
const contactsMenu = ref<boolean>(false);
const qrScanDialog = ref<boolean>(false);

const nativeTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

const isMainnetCardano = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO &&
  loggedWallet.value?.network === Network.MAINNET
);

const isAddressValid = computed(() => {
  const addr = props.recipient.resolvedAddress || localAddress.value;
  if (!addr) return false;
  const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
  return rule(addr) === true;
});

/** Address to display in collapsed chip (truncated) */
const displayAddress = computed(() => {
  const addr = props.recipient.address || props.recipient.resolvedAddress || '';
  return filters.truncate(addr);
});

/** ADA amount to show in collapsed chip */
const totalAdaDisplay = computed(() => {
  const adaToken = props.recipient.selectedTokens.find(t => t.ticker === nativeTicker.value);
  if (!adaToken || !Number(adaToken.quantity)) return '';
  return `${adaToken.quantity} ${nativeTicker.value}`;
});

const contactsHeaders = [
  { text: t('common.name'), value: 'name' },
  { text: t('common.address'), value: 'address' },
];

/** Shape for v-model on AssetsToSendStep */
const assetsModel = computed(() => ({
  selectedTokens: props.recipient.selectedTokens,
  selectedCollectibles: props.recipient.selectedCollectibles,
  minAda: props.recipient.minAda,
  adaShortage: props.recipient.adaShortage,
}));

function onAssetsInput(val: any) {
  emit('update:recipient', {
    ...props.recipient,
    selectedTokens: val.selectedTokens ?? props.recipient.selectedTokens,
    selectedCollectibles: val.selectedCollectibles ?? props.recipient.selectedCollectibles,
  });
}

function onSetMax(tokenIndex: number) {
  emit('setMax', { tokenIndex });
}

function emitAddress(paymentAddress: string, rawInput: string, resolved: boolean) {
  emit('update:recipient', {
    ...props.recipient,
    address: rawInput,
    resolvedAddress: resolved ? paymentAddress : (isPaymentAddress(rawInput) ? rawInput : null),
  });
}

const resolveAdaHandle = debounce(async (val: string) => {
  if (val.length <= 1) {
    resolvedFailed.value = true;
    return;
  }
  resolving.value = true;
  try {
    const res = await adaHandleApi.resolve(val.replace('$', ''));
    if (res.status === 200 && res.data?.resolved_addresses?.ada) {
      handleAsset.value = { name: res.data.name, img: assets.resolveIcon(res.data.image) };
      resolvedFailed.value = false;
      emitAddress(res.data.resolved_addresses.ada, val, true);
    } else {
      resolvedFailed.value = true;
      handleAsset.value = null;
      emitAddress('', val, false);
    }
  } catch {
    resolvedFailed.value = true;
    handleAsset.value = null;
    emitAddress('', val, false);
  } finally {
    resolving.value = false;
  }
}, 1000);

function resolveAddress(val: string | null) {
  const address = val || '';
  handleAsset.value = null;
  resolvedFailed.value = false;
  if (address.startsWith('$') && isMainnetCardano.value) {
    resolveAdaHandle(address);
  } else {
    emitAddress(address, address, false);
  }
}

function onQRScan(address: string) {
  localAddress.value = address;
  handleAsset.value = null;
  qrScanDialog.value = false;
  emitAddress(address, address, false);
}

function selectContact(item: any) {
  contactsMenu.value = false;
  if (item.handle && isMainnetCardano.value) {
    localAddress.value = item.handle;
    resolveAdaHandle(item.handle);
  } else {
    localAddress.value = item.address;
    emitAddress(item.address, item.address, false);
  }
}

// Sync localAddress when parent resets the recipient (e.g. dialog close)
watch(() => props.recipient.address, (newVal) => {
  if (newVal !== localAddress.value) {
    localAddress.value = newVal;
    if (!newVal) {
      handleAsset.value = null;
      resolvedFailed.value = false;
    }
  }
});
</script>

<style scoped>
.recipient-card {
  background-color: #0F0F0F !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 12px !important;
}
.recipient-card--expanded {
  border-color: rgba(0, 223, 243, 0.3) !important;
}
.recipient-address :deep(.v-input__control .v-input__slot) {
  background-color: #292929;
  border-radius: 6px;
}
</style>
```

- [ ] **Step 2: ESLint + TypeScript check**

```bash
npx eslint "src/modules/dashboard/components/SendRecipientCard.vue" --fix 2>&1 | head -20
npx tsc --noEmit 2>&1 | grep "SendRecipientCard" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/dashboard/components/SendRecipientCard.vue
git commit -m "feat(send): create SendRecipientCard component with address + assets + collapse"
```

---

## Task 5: Refactor `SendDialog.vue`

**Files:**
- Modify: `src/modules/dashboard/dialogs/SendDialog.vue`

This is the largest change. The orchestrator replaces the single `sendData` ref with `recipients: SendRecipient[]`, collapses the stepper from 3 to 2 steps, aggregates all recipients into a multi-output tx build, updates `setMax` to be per-recipient, and drives the accordion expand/collapse logic.

- [ ] **Step 1: Update imports and add `SendRecipient` import**

At the top of the `<script setup>` section, find:

```typescript
import { Token, Collectible } from '@/models/send-flow.types';
```

Replace with:

```typescript
import { Token, Collectible, SendRecipient } from '@/models/send-flow.types';
import SendRecipientCard from '../components/SendRecipientCard.vue';
```

Also add `SendRecipientCard` to the component imports block (after `import SummaryStep`):

```typescript
import SendRecipientCard from '../components/SendRecipientCard.vue';
```

- [ ] **Step 2: Replace `sendData` ref and steps with `recipients` + 2-step stepper**

Find the `sendData` ref and `steps` ref block (lines ~211–240). Replace the entire block:

```typescript
const expandedRecipientId = ref<string | null>(null);
const txValid = ref<boolean>(false);
const isCalculatingMax = ref<boolean>(false);

function createEmptyRecipient(): SendRecipient {
  const nativeAsset = tokens.value.find(t => t.ticker === nativeTicker.value);
  const adaToken = nativeAsset ? { ...nativeAsset, quantity: '0', verified: true } : null;
  return {
    id: crypto.randomUUID(),
    address: '',
    resolvedAddress: null,
    selectedTokens: adaToken ? [adaToken] : [],
    selectedCollectibles: {},
    minAda: 0,
    adaShortage: 0,
  };
}

const recipients = ref<SendRecipient[]>([]);

const steps = ref([
  { name: 'recipients', label: t('wallet.recipients') },
  { name: 'summary', label: t('wallet.summary') },
]);
```

- [ ] **Step 3: Update `resetData`**

Find `resetData()` (line ~337) and replace:

```typescript
const resetData = () => {
  resetState();
  currentStep.value = 1;
  tx.value = undefined;
  txValid.value = false;
  recipients.value = [createEmptyRecipient()];
  expandedRecipientId.value = recipients.value[0].id;
};
```

- [ ] **Step 4: Add recipient management helpers**

Add these functions after `resetData`:

```typescript
/** Compute per-recipient available tokens (balance reduced by other cards' commitments). */
function availableTokensFor(recipientId: string) {
  const others = recipients.value.filter(r => r.id !== recipientId);
  return tokens.value.map(token => {
    const committed = others.reduce((sum, r) => {
      const t = r.selectedTokens.find(t2 => t2.unit === token.unit);
      if (!t) return sum;
      return sum + Math.floor(Number(t.quantity) * Math.pow(10, token.decimals ?? 6));
    }, 0);
    const rawBalance = Number(token.balance ?? 0);
    const newBalance = rawBalance - committed;
    return { ...token, balance: newBalance < 0 ? 0 : newBalance };
  });
}

/** Collect fingerprints of NFTs fully committed by other cards. */
function excludedFingerprintsFor(recipientId: string): Set<string> {
  const others = recipients.value.filter(r => r.id !== recipientId);
  const fingerprints = new Set<string>();
  others.forEach(r => {
    Object.values(r.selectedCollectibles).forEach((col: any) => {
      if (col.fingerprint) fingerprints.add(col.fingerprint);
    });
  });
  return fingerprints;
}

function updateRecipient(id: string, updated: SendRecipient) {
  const idx = recipients.value.findIndex(r => r.id === id);
  if (idx !== -1) {
    recipients.value.splice(idx, 1, updated);
  }
}

function addRecipient() {
  const r = createEmptyRecipient();
  recipients.value.push(r);
  expandedRecipientId.value = r.id;
}

function duplicateRecipient(id: string) {
  const src = recipients.value.find(r => r.id === id);
  if (!src) return;
  const duped: SendRecipient = {
    ...JSON.parse(JSON.stringify(src)),
    id: crypto.randomUUID(),
    // Preserve raw address string (not resolved) so handle re-resolves
    resolvedAddress: src.resolvedAddress,
  };
  const idx = recipients.value.findIndex(r => r.id === id);
  recipients.value.splice(idx + 1, 0, duped);
  expandedRecipientId.value = duped.id;
}

function removeRecipient(id: string) {
  if (recipients.value.length <= 1) return;
  const idx = recipients.value.findIndex(r => r.id === id);
  recipients.value.splice(idx, 1);
  // Expand the card before the removed one, or the first
  expandedRecipientId.value = recipients.value[Math.max(0, idx - 1)]?.id ?? null;
}

function expandRecipient(id: string) {
  expandedRecipientId.value = id;
}

/** True when the last card's address is filled — shows "+ Add another recipient" link */
const showAddLink = computed(() => {
  const last = recipients.value[recipients.value.length - 1];
  if (!last) return false;
  return !!(last.resolvedAddress || isPaymentAddress(last.address));
});
```

- [ ] **Step 5: Replace `buildTx` with multi-output version**

Find `buildTx()` (line ~356) and replace the entire function:

```typescript
async function buildTx() {
  // Every recipient must have a valid address before building
  const allValid = recipients.value.every(r =>
    isPaymentAddress(r.resolvedAddress ?? r.address)
  );
  if (!allValid) return;

  if (!tip.value || !epochParams.value) {
    txValid.value = false;
    try {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SYNC_VIA_REST,
        data: {}
      }) as BackgroundResponse<{ success: boolean; error?: string }>;
      if (!response.data.success) return;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!tip.value || !epochParams.value) return;
    } catch { return; }
  }

  const outputs: Cardano.TxOut[] = recipients.value.map(r => {
    const address = (r.resolvedAddress ?? r.address) as Cardano.PaymentAddress;
    const assetsMap = new Map<Cardano.AssetId, bigint>();
    let coinsAmount = BigInt(0);

    r.selectedTokens
      .filter(t => t && (t.unit || t.unit === '') && t.decimals != null)
      .forEach(token => {
        const qty = BigInt(Math.floor(Number(token.quantity) * Math.pow(10, token.decimals)));
        if (token.ticker === nativeTicker.value) {
          coinsAmount = qty;
        } else {
          assetsMap.set(token.unit as Cardano.AssetId, qty);
        }
      });

    Object.values(r.selectedCollectibles).forEach((col: any) => {
      assetsMap.set(col.unit as Cardano.AssetId, BigInt(col.toSendQuantity || 0));
    });

    return {
      address,
      value: { coins: coinsAmount as Cardano.Lovelace, assets: assetsMap }
    };
  });

  try {
    tx.value = await buildCardanoTransaction({
      outputs,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: loggedWallet.value.baseAddress,
      tip: tip.value,
      walletContext: { keys: keys.value, stakeAddress: loggedWallet.value.stakeAddress, accountIndex: 0 }
    });
    txValid.value = true;
    debugLog('Built multi-output tx:', tx.value);
  } catch (e) {
    debugLog('buildTx error:', e);
    txValid.value = false;
    throw e;
  }
}
```

- [ ] **Step 6: Replace `setMax` with per-recipient version**

Find `setMax()` and `tryBuildMaxTx()` (lines ~495–637). Replace both with:

```typescript
async function setMax(recipientId: string, tokenIndex: number) {
  isCalculatingMax.value = true;
  const recipientIdx = recipients.value.findIndex(r => r.id === recipientId);
  if (recipientIdx === -1) { isCalculatingMax.value = false; return; }

  const recipient = recipients.value[recipientIdx];
  const sendTokensCopy = JSON.parse(JSON.stringify(recipient.selectedTokens));
  const selectedToken = sendTokensCopy[tokenIndex];
  if (!selectedToken) { isCalculatingMax.value = false; return; }

  // ADA committed by other recipients (in lovelace)
  const otherAda = recipients.value
    .filter(r => r.id !== recipientId)
    .reduce((sum, r) => {
      const ada = r.selectedTokens.find(t => t.ticker === nativeTicker.value);
      return sum + BigInt(Math.floor(Number(ada?.quantity || 0) * 1_000_000));
    }, BigInt(0));

  if (selectedToken.ticker !== nativeTicker.value) {
    if (selectedToken.decimals) {
      selectedToken.quantity = Number(
        filters.toCurrency(sendTokensCopy[tokenIndex].balance, false, sendTokensCopy[tokenIndex].decimals, '', '', false, sendTokensCopy[tokenIndex].decimals).replaceAll(',', '')
      );
    } else {
      selectedToken.quantity = Number(selectedToken.balance);
    }
    try {
      // Temporarily apply to recipient and rebuild
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
    } catch { /* ignore build errors during max search */ }
    isCalculatingMax.value = false;
    return;
  }

  // ADA: two-phase binary search (same algorithm as before, adjusted for otherAda)
  const totalBalance = BigInt(selectedToken.balance) - otherAda;
  if (totalBalance <= BigInt(0)) { isCalculatingMax.value = false; return; }

  const ADA_STEP = BigInt(1_000_000);
  const MAX_BUFFER = BigInt(100_000_000);
  let buffer = BigInt(0);
  let coarseAmount = BigInt(0);

  while (buffer <= MAX_BUFFER) {
    const attempt = totalBalance - buffer;
    if (attempt <= BigInt(0)) break;
    selectedToken.quantity = Number(
      filters.toCurrency(Number(attempt), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(',', '')
    );
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
      coarseAmount = attempt;
      break;
    } catch { buffer += ADA_STEP; }
  }

  if (coarseAmount === BigInt(0)) { isCalculatingMax.value = false; return; }

  let low = coarseAmount;
  let high = coarseAmount + ADA_STEP;
  if (high > totalBalance) high = totalBalance;
  let finalAmount = coarseAmount;

  for (let i = 0; i < 20 && high - low > BigInt(1); i++) {
    const mid = (low + high) / BigInt(2);
    selectedToken.quantity = Number(
      filters.toCurrency(Number(mid), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(',', '')
    );
    try {
      const updated = { ...recipient, selectedTokens: sendTokensCopy };
      recipients.value.splice(recipientIdx, 1, updated);
      await buildTx();
      finalAmount = mid;
      low = mid;
    } catch { high = mid; }
  }

  const finalQty = filters.toCurrency(Number(finalAmount), false, selectedToken.decimals, '', '', false, selectedToken.decimals).replaceAll(',', '');
  const finalRecipient = recipients.value[recipientIdx];
  const finalTokens = [...finalRecipient.selectedTokens];
  finalTokens[tokenIndex] = { ...finalTokens[tokenIndex], quantity: finalQty };
  recipients.value.splice(recipientIdx, 1, { ...finalRecipient, selectedTokens: finalTokens });

  await new Promise(resolve => setTimeout(resolve, 0));
  isCalculatingMax.value = false;
}
```

- [ ] **Step 7: Update `isValid` computed**

Find `isValid` computed (line ~310). Replace:

```typescript
const isValid = computed(() => {
  if (currentStep.value === 1) {
    if (!txValid.value) return false;
    return recipients.value.every(r => {
      const addr = r.resolvedAddress ?? r.address;
      const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
      if (rule(addr) !== true) return false;
      const hasAsset = r.selectedTokens.some(t => Number(t.quantity) > 0) ||
        Object.keys(r.selectedCollectibles).length > 0;
      if (!hasAsset) return false;
      const hasZero = [...r.selectedTokens, ...Object.values(r.selectedCollectibles)].some(
        (item: any) => Number(item.quantity ?? item.toSendQuantity) === 0
      );
      if (hasZero) return false;
      if (r.adaShortage > 0) return false;
      return true;
    });
  }
  if (currentStep.value === 2) {
    if (isSubmit.value) return true;
    if (loggedWallet.value?.type === WalletType.Normal) {
      if (isPrfWallet.value) return true;
      return !!spendingPassword.value;
    }
    return true;
  }
  return false;
});
```

- [ ] **Step 8: Update `nextStep`**

Find `nextStep()` and replace:

```typescript
async function nextStep() {
  if (currentStep.value === 1) {
    summaryRef.value?.scanTx(tx.value);
    currentStep.value++;
  } else if (currentStep.value === 2) {
    if (!isValid.value) return;
    await handleSign();
  }
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value--;
}
```

- [ ] **Step 9: Update the deep watch to watch `recipients`**

Find the existing deep watch on `sendData` fields (line ~646). Replace the entire watch block:

```typescript
watch(
  () => recipients.value,
  async () => {
    if (isCalculatingMax.value) return;

    // Update minAda per recipient
    for (const r of recipients.value) {
      if (!epochParams.value) continue;
      const addr = r.resolvedAddress ?? r.address;
      if (!addr) continue;
      const assetsMap = new Map<Cardano.AssetId, bigint>();
      Object.values(r.selectedCollectibles).forEach((col: any) => {
        assetsMap.set(col.unit as Cardano.AssetId, BigInt(col.toSendQuantity || 0));
      });
      r.selectedTokens.forEach(token => {
        if (token?.unit && token.ticker !== nativeTicker.value) {
          const qty = token.quantity ? Math.floor(Number(token.quantity) * Math.pow(10, token.decimals || 0)) : 0;
          if (qty > 0) assetsMap.set(token.unit as Cardano.AssetId, BigInt(qty));
        }
      });
      if (assetsMap.size > 0) {
        try {
          const mockOut: Cardano.TxOut = {
            address: addr as Cardano.PaymentAddress,
            value: { coins: BigInt(0) as Cardano.Lovelace, assets: assetsMap }
          };
          const minAdaLovelace = BrowserTxConstruction.minAdaRequired(mockOut, BigInt(epochParams.value.coinsPerUtxoByte));
          r.minAda = Number(minAdaLovelace) / 1_000_000;
        } catch { r.minAda = 0; }
      } else {
        r.minAda = 0;
      }
    }

    try {
      await buildTx();
      txValid.value = true;
      recipients.value.forEach(r => { r.adaShortage = 0; });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('less than the minimum UTXO value') || msg.includes('OutputTooSmallUTxO')) {
        const match = msg.match(/minimum UTXO value (\d+)/);
        if (match) {
          const errMin = Number(filters.toCurrency(parseInt(match[1], 10), false, 6, '', '', false, 6).replaceAll(',', ''));
          // Apply to the first recipient with shortage as a best-effort
          if (recipients.value[0]) recipients.value[0].minAda = Math.max(recipients.value[0].minAda, errMin);
        }
      } else if (msg.includes('Insufficient input in transaction.')) {
        const match = msg.match(/{ada in inputs: (\d+), ada in outputs: (\d+), fee (\d+)/);
        if (match) {
          const shortage = Number(filters.toCurrency(parseInt(match[2], 10) - parseInt(match[1], 10), false, 6, '', '', false, 6).replaceAll(',', ''));
          if (recipients.value[0]) recipients.value[0].adaShortage = shortage;
        }
      } else if (msg.includes('Maximum Input Count Exceeded') || msg.includes('Transaction size exceeds')) {
        // Expose tx-size error in parent UI (handled via txValid = false + error toast)
      }
      txValid.value = false;
    }
  },
  { deep: true }
);
```

- [ ] **Step 10: Update `onMounted`**

Find `onMounted` (line ~765). Replace:

```typescript
onMounted(() => {
  recipients.value = [createEmptyRecipient()];
  expandedRecipientId.value = recipients.value[0]?.id ?? null;
});
```

- [ ] **Step 11: Update the template**

Replace the entire `<!-- Normal send flow -->` `<template v-else>` block with:

```html
<!-- Normal send flow -->
<template v-else>
  <v-card-title style="display: block;" class="py-0">
    <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
      <v-stepper-header>
        <template v-for="(item, index) in steps">
          <div
            class="custom-step"
            :key="item.name"
            :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }"
          >
            <div class="icon-container">
              <v-icon
                class="step-icon"
                :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'"
                size="20"
              >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}</v-icon>
            </div>
            <span class="step-label">{{ item.label }}</span>
          </div>
          <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
               v-if="index < steps.length - 1"></div>
        </template>
      </v-stepper-header>
    </v-stepper>
  </v-card-title>

  <v-card-text class="px-3 pb-0 justify-center text-center send-dialog-content"
    :style="currentStep === 2 && loggedWallet?.type === WalletType.Normal ? { height: '442px' } : {}">
    <CustomStepper :currentStep="currentStep" :steps="steps">

      <!-- Step 1: Recipients -->
      <v-stepper-content step="1">
        <div class="recipients-container" style="max-height: 440px; overflow-y: auto; padding: 4px 2px;">
          <SendRecipientCard
            v-for="(recipient, idx) in recipients"
            :key="recipient.id"
            :recipient="recipient"
            :index="idx"
            :is-expanded="expandedRecipientId === recipient.id"
            :can-delete="recipients.length > 1"
            :available-tokens="availableTokensFor(recipient.id)"
            :excluded-collectible-fingerprints="excludedFingerprintsFor(recipient.id)"
            @expand="expandRecipient(recipient.id)"
            @update:recipient="updateRecipient(recipient.id, $event)"
            @duplicate="duplicateRecipient(recipient.id)"
            @remove="removeRecipient(recipient.id)"
            @setMax="setMax(recipient.id, $event.tokenIndex)"
          />
          <!-- Add another recipient link -->
          <div v-if="showAddLink" class="text-center mt-2">
            <v-btn text small color="#00DFF3" @click="addRecipient">
              <v-icon small class="mr-1">mdi-plus</v-icon>
              {{ $t('wallet.addAnotherRecipient') }}
            </v-btn>
          </div>
        </div>
      </v-stepper-content>

      <!-- Step 2: Summary -->
      <v-stepper-content step="2">
        <SummaryStep
          ref="summaryRef"
          :recipients="recipients"
          :tx-data="tx"
          @next="handleSign"
          @prev="prevStep"
        />
      </v-stepper-content>
    </CustomStepper>

    <!-- Keystone Sign Dialog -->
    <KeystoneSignDialog
      :isOpen="overlay && loggedWallet?.type === WalletType.Keystone"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @close="overlay = false"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @progress="onKeystoneProgress"
    />
  </v-card-text>

  <v-card-actions class="text-center justify-center"
    :style="loggedWallet?.btSupported ? { display: 'block', height: '96px', alignContent: 'end'} : { flexFlow: 'column'}">
    <div v-if="currentStep === 2">
      <TransactionAuthSection
        :wallet-type="loggedWallet?.type"
        :is-prf-wallet="isPrfWallet"
        :is-signed="isSubmit"
        :loading="txSignLoading"
        :password="spendingPassword"
        @update:password="spendingPassword = $event"
        :password-label="t('wallet.spendingPassword')"
        :password-rules="passwordRules"
        :submit-text="t('common.confirm')"
        :show-bt-toggle="isBTSupported"
        :is-b-t="isBT"
        @update:isBT="isBT = $event"
        :usb-text="t('dashboard.usb')"
        :bluetooth-text="t('dashboard.bluetooth')"
        @passkey-success="handlePassKeyAuthSuccess"
        @passkey-error="handlePassKeyAuthError"
        @autofill-success="handlePassKeySuccess"
        @autofill-error="handlePassKeyError"
        @submit="nextStep"
        @password-field-ref="setPasswordFieldRef"
        button-style="width: 295px; margin-bottom: 1px;"
        button-class="mb-2"
      />
    </div>
    <div>
      <v-btn text @click="prevStep" v-if="currentStep > 1" class="mr-2" :disabled="txSignLoading">
        <v-icon small class="mr-1">mdi-arrow-left</v-icon>{{ $t('common.back') }}
      </v-btn>
      <v-btn
        v-if="currentStep !== 2"
        class="continue-button"
        @click="nextStep"
        :disabled="!isValid || txSignLoading"
        :loading="txSignLoading"
      >{{ $t('common.continue') + ' ' }}<v-icon style="color: black!important;" small class="ml-1">mdi-arrow-right</v-icon>
      </v-btn>
      <v-btn
        v-else-if="!isPrfWallet"
        class="continue-button"
        @click="nextStep"
        :disabled="!isValid || txSignLoading"
        :loading="txSignLoading"
      >{{ isSubmit ? $t('common.confirm') : $t('wallet.sign') }}
      </v-btn>
    </div>
  </v-card-actions>
</template>
```

- [ ] **Step 12: Remove now-unused functions**

Remove `updateRecipientAddress`, `selectCollectible`, `tryBuildMaxTx` (their logic is now in the per-recipient helpers or inlined).

- [ ] **Step 13: ESLint + TypeScript check**

```bash
npx eslint "src/modules/dashboard/dialogs/SendDialog.vue" --fix 2>&1 | head -30
npx tsc --noEmit 2>&1 | grep "SendDialog" | head -10
```

Fix any reported errors before committing.

- [ ] **Step 14: Commit**

```bash
git add src/modules/dashboard/dialogs/SendDialog.vue
git commit -m "feat(send): refactor SendDialog to multi-recipient with 2-step stepper"
```

---

## Task 6: Update `SummaryStep.vue` for multi-recipient

**Files:**
- Modify: `src/modules/dashboard/components/SummaryStep.vue`

`SummaryStep` currently receives `sendData` with `recipientAddress: string`. We replace it with `recipients: SendRecipient[]` so it can list all recipient outputs. The `swapDetails` computed already works correctly for multi-output (it sums all non-change outputs). The Cardano Shield scan uses the first recipient.

- [ ] **Step 1: Update Props**

Find the `Props` interface (line ~61):

```typescript
interface Props {
  sendData: any;
  txData?: Cardano.Tx;
}
```

Replace with:

```typescript
import { SendRecipient } from '@/models/send-flow.types';

interface Props {
  recipients: SendRecipient[];
  txData?: Cardano.Tx;
}
```

- [ ] **Step 2: Update `swapDetails` — use first recipient's address for label**

In `swapDetails`, find:

```typescript
recipient: recipient.value,
```

The `recipient` computed finds the first non-change output address. That logic still works. No change needed in the computed itself.

- [ ] **Step 3: Update `scanTx` to use first recipient**

Find `scanTx()`. Replace the CardanoShield call's `toAddress` field:

```typescript
async function scanTx(txData: Cardano.Tx) {
  risks.value.score = undefined;
  loading.value = true;
  tx.value = txData;

  const cborHex = getCborHex();
  const firstRecipient = props.recipients[0];
  const toAddress = firstRecipient?.resolvedAddress ?? firstRecipient?.address ?? '';
  const fromAddress = changeAddress.value;

  const scanWithTimeout = Promise.race([
    cardanoShieldApi.scanTx({
      cborHex,
      toAddress,
      fromAddress,
      url: 'https://gerowallet.io',
    }),
    new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error('Cardano Shield scan timeout')), 5000)
    )
  ]);

  try {
    risks.value = await scanWithTimeout;
  } catch (e) {
    console.warn('Cardano Shield scan failed or timed out:', e);
    risks.value = { addressRisk: 'unknown' };
  } finally {
    loading.value = false;
  }
}
```

- [ ] **Step 4: Update template to show all recipient addresses**

Replace the `<v-col cols="6">` left column content (the `DappAddress` + `TransactionCard` block):

```html
<v-col cols="6">
  <v-card flat class="transparent">
    <v-card-title class="text-left pb-0">
      <Select
        :value="loggedWallet"
        :items="[loggedWallet]"
        :label="t('wallet.from')"
        :readonly="true"
      />
    </v-card-title>
    <v-card-text class="pt-1">
      <v-icon>mdi-arrow-down-thin</v-icon>
      <!-- Show each recipient address -->
      <div
        v-for="(r, idx) in recipients"
        :key="r.id"
        class="mb-2"
      >
        <div class="caption mb-1" style="color: rgba(255,255,255,0.4)" v-if="recipients.length > 1">
          {{ $t('wallet.recipient') }} {{ idx + 1 }}
        </div>
        <DappAddress
          :address="r.resolvedAddress ?? r.address"
          :risk="idx === 0 ? risks?.addressRisk : undefined"
          :with-bg="false"
        />
      </div>
      <v-icon>mdi-arrow-down-thin</v-icon>
      <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true" :with-bg="false">
        {{ $t('wallet.youreGiving') }}
        <v-tooltip bottom>
          <template v-slot:activator="{ on, attrs }">
            <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">mdi-information-outline</v-icon>
          </template>
          <div>
            <span v-if="loggedWallet">{{ networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network) }} {{ $t('common.andOrTokensShownHere') }}<br /></span>
            <span style="color: #FF7777">{{ $t('common.sentFromYourWallet') }}<br /></span>
            <span>{{ $t('common.toTheAddressListedAbove') }}<br /><br />{{ $t('common.onceSignedIrreversible') }}</span>
          </div>
        </v-tooltip>
      </TransactionCard>
    </v-card-text>
  </v-card>
</v-col>
```

Also add `loggedWallet` to the `toRefs` destructure in the script (it's needed for the `Select` component now):

```typescript
const { loggedWallet, utxos } = toRefs(walletStore);
```

- [ ] **Step 5: ESLint + TypeScript check**

```bash
npx eslint "src/modules/dashboard/components/SummaryStep.vue" --fix 2>&1 | head -20
npx tsc --noEmit 2>&1 | grep "SummaryStep" | head -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard/components/SummaryStep.vue
git commit -m "feat(send): update SummaryStep to display all recipient addresses"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full TypeScript check**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet"
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors.

- [ ] **Step 2: Full ESLint check on touched files**

```bash
npx eslint \
  "src/models/send-flow.types.ts" \
  "src/modules/dashboard/dialogs/SendDialog.vue" \
  "src/modules/dashboard/components/SendRecipientCard.vue" \
  "src/modules/dashboard/components/AssetsToSendStep.vue" \
  "src/modules/dashboard/components/SummaryStep.vue" \
  --fix 2>&1 | head -30
```

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: BUILD SUCCESS with no errors.

- [ ] **Step 4: Single-recipient smoke test (beginner path)**

1. `npm run dev && npm run dev:background` → reload extension
2. Open Send dialog
3. Confirm: one card, address field visible, no delete button, no duplicate button
4. Enter a valid Preprod address → assets section expands inline
5. Enter 1 ADA → tx builds (Summary button enabled)
6. Click Summary → recipient address shown, fee shown
7. Confirm flow unchanged from before this feature

- [ ] **Step 5: Multi-recipient smoke test**

1. Open Send dialog, enter valid address on card 1 + amount
2. Confirm "+ Add another recipient" link appears below card 1
3. Click link → card 2 appears expanded; card 1 collapses
4. Enter different valid address on card 2 + amount
5. Click card 1 collapsed chip → card 1 expands, card 2 collapses
6. Click Continue → Summary shows BOTH recipient addresses + combined fee
7. Confirm tx builds successfully

- [ ] **Step 6: Duplicate card smoke test (hot wallet funding path)**

1. Open Send dialog, enter `addr_test1vr9x084xftk0sq6aqgf5ghlck479vg2stq3vsltnhy37dqgdfdjss` on card 1
2. Enter 5 ADA
3. Click duplicate button on card 1 → card 2 appears with same address + 5 ADA
4. Repeat up to balance limits (or 20 times for the hot wallet funding scenario)
5. Confirm tx builds with N outputs to the same address

- [ ] **Step 7: NFT double-spend prevention check**

1. Wallet with an NFT
2. Add NFT to card 1's collectibles
3. Add card 2, open card 2's collectibles — confirm the NFT is NOT shown
4. Remove NFT from card 1 → NFT reappears in card 2

- [ ] **Step 8: No commit** — verification only
