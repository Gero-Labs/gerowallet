<template>
  <!-- Hardware wallets sign on the device, in the page. -->
  <div v-if="credentials.deviceType.value" class="prepared-tx-credentials__device glass-tier mt-4" :data-testid="`${testid}-device`">
    <v-icon size="20" color="var(--g-accent)">{{ credentials.deviceIcon.value }}</v-icon>
    <p class="t-body-sm">{{ t(credentials.deviceHintKey.value) }}</p>
    <!-- `btSupported` says the Ledger CAN use Bluetooth, not that it is connected that
         way, so USB stays the default and the user picks. -->
    <ToggleSwitch
      v-if="credentials.deviceType.value === WalletType.Ledger && credentials.wallet.value?.btSupported"
      class="prepared-tx-credentials__transport"
      :text-left="t('wallet.usb')"
      icon-left="mdi-usb"
      :text-right="t('wallet.bluetooth')"
      icon-right="mdi-bluetooth"
      :model-value="credentials.isBT.value"
      :disabled="credentials.busy.value"
      @update:model-value="credentials.setIsBT($event)"
    />
  </div>
  <v-alert
    v-if="credentials.deviceType.value === WalletType.Keystone"
    type="warning"
    variant="tonal"
    density="compact"
    class="mt-3"
    :data-testid="`${testid}-keystone-hash`"
  >
    {{ t('programmableTokens.send.keystoneHashOnly') }}
    <span class="d-block t-caption g-mono mt-1">{{ txId }}</span>
  </v-alert>

  <div class="mt-4">
    <PassKeyPasswordField
      v-if="credentials.usesPassword.value"
      :model-value="credentials.password.value"
      dense
      outlined
      hide-details
      :label="t('wallet.spendingPassword')"
      :placeholder="t('navigation.typeYourSpendingPassword')"
      :disabled="credentials.busy.value"
      required
      @update:model-value="credentials.setPassword($event)"
      @enter="credentials.send()"
      @passkey-autofill-success="credentials.send()"
    />
  </div>
</template>

<script setup lang="ts">
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { PreparedTxCredentialsState } from '@/shared/composables/usePreparedTxCredentials';
import { WalletType } from '@/models/types';

/**
 * What the user gives to sign a transaction the worker prepared, from usePreparedTxCredentials:
 * the device hint (with the Ledger's USB / Bluetooth choice) for a hardware wallet, the Keystone
 * notice that its screen may show only a hash, and the spending password field. The confirm
 * and PassKey buttons are not here: they differ per host (label, button, test id, what sits
 * beside them), so each host lays out its own actions row with the composable's handlers.
 *
 * `testid` prefixes the device and Keystone-hash test ids (`<testid>-device`,
 * `<testid>-keystone-hash`); `txId` is the transaction id the Keystone may show instead of its
 * details.
 */
defineProps<{
  credentials: PreparedTxCredentialsState;
  testid: string;
  txId: string;
}>();

const { t } = useTranslation();
</script>

<style scoped lang="scss">
.prepared-tx-credentials__device {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  text-align: center;

  p {
    margin: 0;
    color: var(--g-text-2);
  }
}

.prepared-tx-credentials__transport {
  width: 100%;
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-1);
}
</style>
