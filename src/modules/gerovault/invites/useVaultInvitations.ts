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
import { inviteErrorCode, type InviteClientCode } from './inviteClient';

export type InvitationsState = 'idle' | 'loading' | 'ready' | 'unavailable';

export function useVaultInvitations(deps: {
  readonly client: Pick<InviteClient, 'listSetups' | 'refreshSetup' | 'listInvites' | 'remind' | 'cancelSetup' | 'decline' | 'block' | 'openLink' | 'getInvite'>;
  readonly walletId: () => number | undefined;
}) {
  const state = ref<InvitationsState>('idle');
  const setups = shallowRef<readonly SetupViewModel[]>([]);
  const invites = shallowRef<readonly ReceivedView[]>([]);
  const refused = ref(0);
  const problem = ref<InviteClientCode | null>(null);

  async function reload(): Promise<void> {
    const walletId = deps.walletId();
    state.value = 'loading';
    try {
      const listed = walletId === undefined ? [] : await deps.client.listSetups(walletId);
      // Each open setup reads its answers, so the chips are current when the page opens.
      setups.value = await Promise.all(listed.map(s => (s.state === 'open' ? deps.client.refreshSetup(s.setupId).catch(() => s) : s)));
      const answer = await deps.client.listInvites();
      invites.value = answer.invites;
      refused.value = answer.refused;
      state.value = 'ready';
    } catch (error) {
      state.value = inviteErrorCode(error) === 'UNAVAILABLE' ? 'unavailable' : 'ready';
      if (state.value === 'ready') problem.value = inviteErrorCode(error);
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
    reload,
    replaceInvite,
    remind: (setupId: string, n: number) => act(() => deps.client.remind(setupId, n), replaceSetup),
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
