import { reactive } from 'vue';

/**
 * Which device the user is being asked to look at. Mirrors the hardware members
 * of `WalletType` as a plain string union so this module stays free of the
 * models barrel (it is imported by `shared/utils/ledger.ts`, which the
 * background bundle pulls in).
 */
export type HardwareDevice = 'Ledger' | 'Trezor' | 'Keystone';

/**
 * Shared state for "the device is waiting on you" UI.
 *
 * `shared/utils/ledger.ts` writes a step label here for every stage of a signing
 * run (connecting → verifying app → confirm on device). Several of those stages
 * are the device sitting on a confirmation prompt with no browser-side progress
 * at all, so without surfacing this the user just sees a spinner that never
 * resolves. `HardwareSignPrompt.vue` renders it; call `begin()` before any call
 * that hands control to a device and `end()` in the matching `finally`.
 *
 * Exported reactive so component templates track the writes — `ledger.ts` and
 * the signing composables mutate the singleton directly from plain async code.
 */
export class HardwareLoadingPlugin {

  text: string = '';
  loading: boolean = false;
  device: HardwareDevice | null = null;

  setText(text: string) {
    this.text = text;
  }

  setLoading(val: boolean) {
    this.loading = val;
    if (!val) {
      // Drop the last step label with the overlay. Leaving it behind made a
      // retry open showing the stage that had just failed.
      this.text = '';
      this.device = null;
    }
  }

  /**
   * Show the prompt for `device`. `text` is the opening step label; `ledger.ts`
   * overwrites it as the run progresses, while Trezor/Keystone paths (which
   * publish no intermediate stages) keep whatever is passed here.
   */
  begin(device: HardwareDevice, text: string = '') {
    this.device = device;
    this.text = text;
    this.loading = true;
  }

  /** Hide the prompt. Safe to call when it was never shown. */
  end() {
    this.setLoading(false);
  }
}

export default reactive(new HardwareLoadingPlugin());
