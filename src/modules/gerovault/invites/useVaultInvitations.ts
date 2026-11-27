/**
 * What the Vaults overview shows about invitations: this wallet's setups in progress ("Setting
 * up", each cosigner's status and the next step) and the invitations for this device, split as the
 * UX rules ask: from a contact or someone this device shares a vault with ("Invitations for you"),
 * from anyone else ("Requests"), and joined but not verified yet ("Verify with <name>").
 *
 * The client is injected so the composable runs in a test with a fake one.
 */
import { computed, ref, shallowRef } from 'vue';
import type { InviteClient, ReceivedView, SetupViewModel } from './inviteClient';
import { InviteClientError, inviteErrorCode, type InviteClientCode } from './inviteClient';

export type InvitationsState = 'idle' | 'loading' | 'ready' | 'unavailable';
/** The wait shown when gero-sync is busy and named none. */
const DEFAULT_BUSY_MS = 60_000;

export function useVaultInvitations(deps: {
  readonly client: Pick<InviteClient, 'listSetups' | 'refreshSetup' | 'listInvites' | 'remind' | 'cancelSetup' | 'decline' | 'block' | 'openLink' | 'getInvite'>;
  readonly walletId: () => number | undefined;
  readonly now?: () => number;
}) {
  const state = ref<InvitationsState>('idle');
  const setups = shallowRef<readonly SetupViewModel[]>([]);
  const invites = shallowRef<readonly ReceivedView[]>([]);
  const refused = ref(0);
  const problem = ref<InviteClientCode | null>(null);
  /** gero-sync answered 429: what is shown is what this device holds, and the next read waits until this time (ms). */
  const busyUntil = ref<number | null>(null);
  /** The setup a reminder was just sent for. */
  const reminded = ref<{ setupId: string; n: number } | null>(null);
  const now = deps.now ?? (() => Date.now());

  let loading: Promise<void> | null = null;
  /**
   * Reads the setups and the mailbox. `quiet` keeps the lists on screen while it reads (a return
   * to the page, a push); the first load shows the loading state. One read at a time.
   */
  function reload(options: { quiet?: boolean } = {}): Promise<void> {
    loading ??= load(options.quiet === true).finally(() => { loading = null; });
    return loading;
  }

  async function load(quiet: boolean): Promise<void> {
    const walletId = deps.walletId();
    if (!quiet || state.value === 'idle') state.value = 'loading';
    let wait = 0;
    const limited = (error: unknown): boolean => {
      if (inviteErrorCode(error) !== 'RATE_LIMITED') return false;
      const ms = error instanceof InviteClientError ? error.details?.['retryAfterMs'] : undefined;
      wait = Math.max(wait, typeof ms === 'number' && ms > 0 ? ms : DEFAULT_BUSY_MS);
      return true;
    };
    try {
      const listed = walletId === undefined ? [] : await deps.client.listSetups(walletId);
      // Rate limited a moment ago: the stored setups show, and nothing is asked before the wait is over.
      const held = busyUntil.value !== null && now() < busyUntil.value;
      // Each open setup reads its answers, so the chips are current when the page opens.
      setups.value = await Promise.all(listed.map(s => (s.state === 'open' && !held
        ? deps.client.refreshSetup(s.setupId).catch((error: unknown) => { limited(error); return s; })
        : s)));
      const answer = await deps.client.listInvites();
      invites.value = answer.invites;
      refused.value = answer.refused;
      if (answer.busy) wait = Math.max(wait, answer.busy.retryAfterMs);
      if (wait > 0) busyUntil.value = now() + wait;
      else if (!held) busyUntil.value = null;
      state.value = 'ready';
    } catch (error) {
      state.value = inviteErrorCode(error) === 'UNAVAILABLE' ? 'unavailable' : 'ready';
      if (state.value === 'ready' && !limited(error)) problem.value = inviteErrorCode(error);
      if (wait > 0) busyUntil.value = now() + wait;
    }
  }

  const open = (i: ReceivedView) => i.state === 'open';
  const forYou = computed(() => invites.value.filter(i => open(i) && i.known));
  const requests = computed(() => invites.value.filter(i => open(i) && !i.known));
  const toVerify = computed(() => invites.value.filter(i => (i.state === 'accepted' || i.state === 'cancelled') && i.join && !i.join.verified));
  const openSetups = computed(() => setups.value.filter(s => s.state === 'open'));

  function replaceSetup(next: SetupViewModel): void {
    setups.value = setups.value.map(s => (s.setupId === next.setupId ? next : s));
  }

  function replaceInvite(next: ReceivedView): void {
    const known = invites.value.some(i => i.ref === next.ref);
    invites.value = known ? invites.value.map(i => (i.ref === next.ref ? next : i)) : [next, ...invites.value];
  }

  async function act<T>(run: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
    problem.value = null;
    try {
      apply(await run());
      return true;
    } catch (error) {
      problem.value = inviteErrorCode(error);
      return false;
    }
  }

  return {
    state,
    setups,
    openSetups,
    invites,
    forYou,
    requests,
    toVerify,
    refused,
    problem,
    busyUntil,
    reminded,
    reload,
    replaceInvite,
    async remind(setupId: string, n: number): Promise<boolean> {
      reminded.value = null;
      const ok = await act(() => deps.client.remind(setupId, n), replaceSetup);
      if (ok) reminded.value = { setupId, n };
      return ok;
    },
    cancelSetup: (setupId: string) => act(() => deps.client.cancelSetup(setupId), next => { setups.value = setups.value.filter(s => s.setupId !== next.setupId); }),
    decline: (ref: string) => act(() => deps.client.decline(ref), replaceInvite),
    block: (ref: string) => act(() => deps.client.block(ref), replaceInvite),
    /** A pasted or scanned QR / link. Resolves with the opened invitation, or null (`problem` says why). */
    async openLink(text: string): Promise<ReceivedView | null> {
      let opened: ReceivedView | null = null;
      await act(() => deps.client.openLink(text), view => { opened = view; replaceInvite(view); });
      return opened;
    },
    async get(ref: string): Promise<ReceivedView | null> {
      let found: ReceivedView | null = null;
      await act(() => deps.client.getInvite(ref), view => { found = view; replaceInvite(view); });
      return found;
    },
  };
}

export type VaultInvitations = ReturnType<typeof useVaultInvitations>;
