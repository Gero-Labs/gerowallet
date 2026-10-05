// Push notifications — hooks other background services call without importing the
// notify machine (keeps sync.service / walletManager free of a dependency on it).
// notifyBackground.ts installs the handlers; until then every hook is a no-op.

export interface NotifyHooks {
  /** The logged wallet's credential range grew (sync.service): re-send its link, debounced. */
  credentialsChanged: () => void;
}

export const notifyHooks: NotifyHooks = {
  credentialsChanged: () => undefined,
};
