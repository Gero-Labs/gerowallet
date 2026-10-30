// The credentials half of a prepared transaction (CIP-113 Send, legacy rescue): which credential
// the wallet signs with, the password handoff, the PassKey staleness epoch and the wallet-switch
// guard. The two components that host it pin their own screens (ProgrammableSendFlow.runtime.spec,
// LegacyCancelDialog.spec); this pins what they leave to it: key bytes zeroed when a PassKey
// result cannot be used, the epoch a PassKey result is checked against, and the edges of the
// switch guard. The flow is refs and spies the test owns.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, inject, nextTick, ref, type Ref } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import type { PreparedTxStage } from '@/shared/composables/usePreparedTxFlow';

const walletState = vi.hoisted(() => ({
  loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal' } as Record<string, unknown>,
}));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive(walletState) };
});

import { usePreparedTxCredentials, type PreparedTxCredentialsOptions } from './usePreparedTxCredentials';
import { authorizationScopeKey, type AuthorizationScope } from './authorizationScope';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const store = walletStore as unknown as typeof walletState;

function fakeFlow() {
  return {
    stage: ref<PreparedTxStage>('review') as Ref<PreparedTxStage>,
    prepared: ref<{ txId: string } | null>({ txId: 'aa'.repeat(32) }),
    failure: ref<{ code: string } | null>(null),
    signAndSubmit: vi.fn(async () => true),
    reset: vi.fn(),
  };
}

/** Mounts a host that calls the composable and renders a child that injects the PassKey scope below it. */
function host(options: Partial<PreparedTxCredentialsOptions> = {}) {
  const flow = fakeFlow();
  const screen = ref('review');
  const isBT = ref(false);
  const scope: { value?: AuthorizationScope } = {};
  const Probe = defineComponent({
    setup() {
      scope.value = inject(authorizationScopeKey, undefined);
      return () => h('i');
    },
  });
  let credentials!: ReturnType<typeof usePreparedTxCredentials>;
  const wrapper = mount(defineComponent({
    setup() {
      credentials = usePreparedTxCredentials(flow, { isBT, screen: () => screen.value, ...options });
      return () => h(Probe);
    },
  }));
  return { flow, screen, isBT, scope: scope.value!, credentials, wrapper };
}

describe('usePreparedTxCredentials', () => {
  beforeEach(() => {
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
  });

  describe('which credential the wallet signs with', () => {
    it('a password wallet types a password; a PRF wallet uses a PassKey, however the record says so', () => {
      expect(host().credentials.usesPassword.value).toBe(true);
      expect(host().credentials.isPrfWallet.value).toBe(false);

      store.loggedWallet = { id: 1, type: 'Normal', encryptionMethod: 'prf' };
      const byMethod = host().credentials;
      expect([byMethod.isPrfWallet.value, byMethod.usesPassword.value]).toEqual([true, false]);

      // Older records carry the PassKey blobs without the method.
      store.loggedWallet = { id: 1, type: 'Normal', prfEncryptedPrivateKey: 'aa', webAuthnCredentialId: 'bb' };
      const byBlobs = host().credentials;
      expect([byBlobs.isPrfWallet.value, byBlobs.usesPassword.value]).toEqual([true, false]);

      // Half a PassKey record is not one.
      store.loggedWallet = { id: 1, type: 'Normal', prfEncryptedPrivateKey: 'aa' };
      expect(host().credentials.isPrfWallet.value).toBe(false);
    });

    it('a Google wallet types nothing', () => {
      store.loggedWallet = { id: 1, type: 'Google', encryptionMethod: 'mpc' };
      const { credentials } = host();

      expect([credentials.usesPassword.value, credentials.isPrfWallet.value, credentials.deviceType.value]).toEqual([false, false, null]);
    });

    it('a hardware wallet signs on its device, with the icon and hint of that device', () => {
      store.loggedWallet = { id: 1, type: 'Ledger' };
      const { credentials, isBT } = host();

      expect([credentials.deviceType.value, credentials.deviceHintKey.value, credentials.deviceIcon.value]).toEqual(['Ledger', 'miniGero.connectLedger', 'mdi-usb']);
      credentials.setIsBT(true);
      expect(isBT.value).toBe(true);
      expect(credentials.deviceIcon.value).toBe('mdi-bluetooth');

      store.loggedWallet = { id: 1, type: 'Trezor' };
      expect([credentials.deviceHintKey.value, credentials.deviceIcon.value]).toEqual(['miniGero.connectTrezor', 'mdi-usb']);
      store.loggedWallet = { id: 1, type: 'Keystone' };
      expect([credentials.deviceHintKey.value, credentials.deviceIcon.value]).toEqual(['miniGero.keystoneSign', 'mdi-qrcode-scan']);
    });

    it('a device type the host does not allow is blocked, not offered', () => {
      store.loggedWallet = { id: 1, type: 'Ledger' };
      const { credentials } = host({ allowsDevice: (type) => type === 'Keystone' });
      expect([credentials.deviceType.value, credentials.deviceBlocked.value]).toEqual([null, true]);

      store.loggedWallet = { id: 1, type: 'Keystone' };
      expect([credentials.deviceType.value, credentials.deviceBlocked.value]).toEqual(['Keystone', false]);

      // Software wallets are never "blocked": the host's list is about devices.
      store.loggedWallet = { id: 1, type: 'Normal' };
      expect(credentials.deviceBlocked.value).toBe(false);
    });
  });

  describe('signing', () => {
    it('hands the typed password over and takes it out of the field first', async () => {
      const { credentials, flow } = host();
      let fieldDuringSigning: string | undefined;
      flow.signAndSubmit.mockImplementation(async () => {
        fieldDuringSigning = credentials.password.value;
        return true;
      });
      credentials.setPassword('hunter2');
      await credentials.send();

      expect(flow.signAndSubmit).toHaveBeenCalledWith({ password: 'hunter2' });
      expect(fieldDuringSigning).toBe('');
      expect(credentials.password.value).toBe('');
    });

    it('asks nothing of a password wallet that typed nothing, and signs nothing off the review screen or mid-request', async () => {
      const { credentials, flow, screen } = host();
      await credentials.send();
      expect(flow.signAndSubmit).not.toHaveBeenCalled();

      credentials.setPassword('hunter2');
      screen.value = 'form';
      await credentials.send();
      expect(flow.signAndSubmit).not.toHaveBeenCalled();

      screen.value = 'review';
      flow.stage.value = 'signing';
      await credentials.send();
      expect(flow.signAndSubmit).not.toHaveBeenCalled();
      // The password is still there for when the request settles.
      expect(credentials.password.value).toBe('hunter2');
    });

    it('a Google or hardware wallet signs with no credentials', async () => {
      store.loggedWallet = { id: 1, type: 'Google', encryptionMethod: 'mpc' };
      const { credentials, flow } = host();
      await credentials.send();

      expect(flow.signAndSubmit).toHaveBeenCalledWith();
    });

    it('passes a PassKey result on, and zeroes its key bytes when it cannot be used', async () => {
      store.loggedWallet = { id: 1, type: 'Normal', encryptionMethod: 'prf' };
      const { credentials, flow, screen } = host();

      const used = new Uint8Array([1, 2, 3]);
      await credentials.sendWithPassKey(used);
      expect(flow.signAndSubmit).toHaveBeenCalledWith({ privateKeyBytes: used });

      flow.signAndSubmit.mockClear();
      const busy = new Uint8Array([4, 5, 6]);
      flow.stage.value = 'submitting';
      await credentials.sendWithPassKey(busy);
      expect([...busy]).toEqual([0, 0, 0]);

      flow.stage.value = 'review';
      screen.value = 'done';
      const elsewhere = new Uint8Array([7, 8, 9]);
      await credentials.sendWithPassKey(elsewhere);
      expect([...elsewhere]).toEqual([0, 0, 0]);
      expect(flow.signAndSubmit).not.toHaveBeenCalled();
    });

    it('a PassKey that failed is a signing failure', () => {
      const { credentials, flow } = host();
      credentials.onPassKeyError();

      expect(flow.failure.value).toEqual({ code: 'SIGN_FAILED' });
    });
  });

  describe('the PassKey staleness epoch', () => {
    it('a PassKey result is current until the transaction, the screen or the wallet changes', async () => {
      const { scope, flow, screen } = host();

      const sameTx = scope.capture();
      expect(sameTx()).toBe(true);

      flow.prepared.value = { txId: 'bb'.repeat(32) };
      expect(sameTx()).toBe(false);

      const afterBuild = scope.capture();
      screen.value = 'done';
      expect(afterBuild()).toBe(false);

      const afterScreen = scope.capture();
      store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
      await nextTick();
      expect(afterScreen()).toBe(false);
      expect(scope.capture()()).toBe(true);
    });

    it('a PassKey result that outlives the host is stale', () => {
      const { scope, wrapper } = host();
      const check = scope.capture();
      expect(check()).toBe(true);

      wrapper.unmount();
      expect(check()).toBe(false);
    });
  });

  describe('the wallet-switch guard', () => {
    it('another wallet resets the flow, clears the password and tells the host', async () => {
      const onWalletSwitch = vi.fn();
      const { credentials, flow } = host({ onWalletSwitch });
      credentials.begin();
      credentials.setPassword('hunter2');

      store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
      await nextTick();

      expect(flow.reset).toHaveBeenCalledTimes(1);
      expect(credentials.password.value).toBe('');
      expect(onWalletSwitch).toHaveBeenCalledTimes(1);

      // Once: a further change is the host's business until it begins again.
      store.loggedWallet = { id: 3, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
      await nextTick();
      expect(flow.reset).toHaveBeenCalledTimes(1);
    });

    it('does nothing before a transaction was begun, or while the host is not showing one', async () => {
      const showing = ref(true);
      const { credentials, flow } = host({ isActive: () => showing.value });

      store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
      await nextTick();
      expect(flow.reset).not.toHaveBeenCalled();

      credentials.begin();
      showing.value = false;
      store.loggedWallet = { id: 3, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
      await nextTick();
      expect(flow.reset).not.toHaveBeenCalled();
    });

    it('waits for a request in flight to settle, then resets', async () => {
      const { credentials, flow } = host();
      credentials.begin();
      flow.stage.value = 'signing';

      store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet', type: 'Normal' };
      await nextTick();
      expect(flow.reset).not.toHaveBeenCalled();

      flow.stage.value = 'review';
      await nextTick();
      expect(flow.reset).toHaveBeenCalledTimes(1);
    });

    it('begin() leaves no password behind and binds the transaction to the wallet logged then', async () => {
      const { credentials, flow } = host();
      credentials.setPassword('left over');
      credentials.begin();
      expect(credentials.password.value).toBe('');

      store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', type: 'Normal', name: 'renamed' };
      await nextTick();
      // The same wallet, re-broadcast: not a switch.
      expect(flow.reset).not.toHaveBeenCalled();
    });
  });
});
