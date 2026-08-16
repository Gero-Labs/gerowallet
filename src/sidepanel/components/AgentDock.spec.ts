// src/sidepanel/components/AgentDock.spec.ts
//
// Covers the support (live chat) layer of AgentDock.vue — the DOCK's own
// behavior: which thread renders, what the header status says, when enter() /
// markSeen() / send() fire, and what the flag hides.
//
// Every collaborator is mocked even though all of them now exist for real
// (`useSupportChat`, `featureFlagsStore`, `useAgentDock`, `useSheetVisibility`,
// `SupportAuthPrompt`). That is deliberate unit isolation, not a stand-in for
// something unbuilt: importing them for real would drag in the agent provider,
// Chatwoot REST/ActionCable, Dexie and WebAuthn, making these tests slow, non-
// hermetic, and prone to failing for reasons that have nothing to do with the
// dock. Each collaborator is covered by its own spec (useSupportChat.spec.ts,
// useSupportAuthPrompt.spec.ts, SupportAuthPrompt.spec.ts). Mirrors
// GeroSwapEmbed.spec.ts's pattern of stubbing every collaborator a component
// imports.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
// Type-only import: erased at compile time, so it is unaffected by the
// vi.mock of this module below and keeps the spec pinned to the REAL contract.
import type { SupportAttachment } from '@/sidepanel/composables/useSupportChat';

type SupportConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
interface SupportMessage {
  id: number;
  // Optional stable key the real composable is expected to attach so an
  // optimistic (negative-id) message keeps the same vnode across the id swap
  // once the server confirms it — see AgentDock.vue's `:key="m.clientId ?? m.id"`.
  clientId?: number;
  role: 'user' | 'agent';
  text: string;
  agentName?: string;
  createdAt: number;
  attachments?: SupportAttachment[];
}
interface MockSupportChat {
  messages: { value: SupportMessage[] };
  busy: { value: boolean };
  connectionState: { value: SupportConnectionState };
  unread: { value: number };
  isAvailable: { value: boolean };
  errorKey: { value: string | null };
  enter: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  markSeen: ReturnType<typeof vi.fn>;
}
interface MockDock {
  isOpen: { value: boolean };
  busy: { value: boolean };
  messages: { value: Array<{ id: number; role: 'user' | 'assistant'; text: string }> };
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  toggle: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}
interface FlagsHolder {
  isLiveChatEnabled: () => boolean;
  isCopilotEnabled: () => boolean;
}
interface SheetVisibility {
  isAnySheetOpen: { value: boolean };
}
// Mirrors the one property NavigationDrawer.vue's own isApex/isMidnight
// derivation reads (walletStore.loggedWallet?.chain) — a plain mutable
// object, not a ref: the chain-accent tests below only need to set it BEFORE
// each fresh mountDock() call (a new component instance re-evaluates its
// computed from scratch), not react to it changing on an already-mounted
// instance, so the ref-based reactivity flagsHolder needed above is
// unnecessary machinery here.
interface MockWalletStore {
  loggedWallet?: { chain?: string };
}

// vi.mock(...) factories are hoisted above every import in this file — including
// `import ... from 'vue'` — so referencing plain top-level `const` bindings (or `ref()`
// itself, which only becomes available once vue's import resolves) inside them throws
// "Cannot access 'x' before initialization". vi.hoisted() runs in that same early phase
// and is the escape hatch for OUR OWN state (`vi` itself is safe to use inside it), but
// `ref()` still isn't available yet there. So: create plain placeholder objects here
// for EVERY piece of state a vi.mock(...) factory below closes over (mutated in place
// once `vue` has actually loaded, well before any test runs `mount()`), rather than
// only some of them — a factory that closures over a plain `const` declared outside
// vi.hoisted only "works" if nothing forces it to resolve before that `const` runs,
// which is a fragile accident of file order, not a guarantee.
// See https://vitest.dev/api/vi.html#vi-hoisted.
const { mockSupportChat, mockDock, flagsHolder, sheetVisibility, mockWalletStore } = vi.hoisted(() => {
  return {
    mockSupportChat: {
      enter: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(true),
      markSeen: vi.fn(),
    } as unknown as MockSupportChat,
    mockDock: {
      open: vi.fn(),
      close: vi.fn(),
      toggle: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockDock,
    // Placeholder closure, REPLACED (not merged) below once a real ref exists — a
    // plain `{ enabled: boolean }` object here would not be Vue-reactive, so
    // AgentDock's `liveChatEnabled` computed would cache its first read forever and
    // never notice setLiveChatEnabled() flipping it later (this bit a real test:
    // asserting a runtime flag-flip while already in Support mode).
    // isCopilotEnabled defaults true (see below) so every pre-existing test that
    // never touches it keeps exercising the same Assistant-enabled path it did
    // before this flag existed.
    flagsHolder: { isLiveChatEnabled: () => true, isCopilotEnabled: () => true } as FlagsHolder,
    sheetVisibility: {} as SheetVisibility,
    // Undefined by default — AgentDock's isApex/isMidnight both read this via
    // optional chaining, so no logged wallet falls through to the default
    // (Cardano) mark, matching every pre-existing test that doesn't care about
    // chain at all.
    mockWalletStore: { loggedWallet: undefined } as MockWalletStore,
  };
});

vi.mock('@/sidepanel/composables/useSupportChat', () => ({
  supportChat: mockSupportChat,
  // The component imports this VALUE from the mocked module — it must exist
  // here or the pick-time count cap silently disappears in tests.
  SUPPORT_MAX_FILES_PER_MESSAGE: 5,
}));

vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: {
    isLiveChatEnabled: () => flagsHolder.isLiveChatEnabled(),
    isCopilotEnabled: () => flagsHolder.isCopilotEnabled(),
  },
}));

vi.mock('@/sidepanel/composables/useAgentDock', () => ({
  agentDock: mockDock,
}));

vi.mock('@/sidepanel/composables/useSheetVisibility', () => ({
  useSheetVisibility: () => sheetVisibility,
}));

// Real walletStore drags in chrome.storage, auto-lock timers, and Dexie —
// mocked for the same isolation reason as useSupportChat/useAgentDock above.
// AgentDock only ever reads walletStore.loggedWallet?.chain (for the FAB's
// chain-accent mark), so the mock's surface is that one property.
vi.mock('@/stores/walletStore', () => ({
  walletStore: mockWalletStore,
}));

// The spending-auth dialog is stubbed out wholesale rather than stubbed at mount:
// its real module graph reaches PassKeyAuthButton -> webauthn-prf and
// PassKeyPasswordField -> Dexie, none of which this dock-only spec should load.
// Its own contract (registering/settling the promptAuth hook) is covered by
// useSupportAuthPrompt.spec.ts.
vi.mock('@/sidepanel/components/SupportAuthPrompt.vue', () => ({
  default: { name: 'SupportAuthPrompt', render: (h: (tag: string) => unknown) => h('div') },
}));

import Vue, { ref } from 'vue';
// Real imports (not mocked): both are pure, side-effect-free constant/asset
// data — the same category as renderMarkdown/i18n below, not a collaborator
// like useSupportChat that needs isolating. Importing the real Blockchain
// enum keeps the mocked chain values (Blockchain.APEX_PRIME, etc.) pinned to
// whatever AgentDock.vue itself compares against, instead of drifting string
// literals; importing the real assets barrel lets the chain-accent tests
// assert against the actual asset.geroNoText*/URL values the component uses.
import { Blockchain } from '@/models/types';
import assets from '@/utils/assets';

function setWalletChain(chain?: string): void {
  mockWalletStore.loggedWallet = chain ? { chain } : undefined;
}

// AgentDock.vue renders raw <v-icon> (Vuetify isn't installed/registered in this
// test's Vue instance) — ignore it as a custom element so Vue doesn't warn on every
// render, mirroring GeroSwapEmbed.spec.ts's handling of its own <gero-swap> element.
Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'v-icon'];

// `ref` is only live from this point on. Reassigning (not Object.assign-merging)
// `flagsHolder.isLiveChatEnabled` to a closure over a real ref is what makes the flag
// genuinely reactive: AgentDock's `computed(() => featureFlagsStore.isLiveChatEnabled())`
// calls through to this closure, so Vue correctly tracks `liveChatEnabledRef` as its
// dependency and recomputes whenever setLiveChatEnabled() below changes it — a plain
// mutated property on a non-reactive object cannot trigger that.
const liveChatEnabledRef = ref(true);
flagsHolder.isLiveChatEnabled = () => liveChatEnabledRef.value;

function setLiveChatEnabled(on: boolean): void {
  liveChatEnabledRef.value = on;
}

const copilotEnabledRef = ref(true);
flagsHolder.isCopilotEnabled = () => copilotEnabledRef.value;

function setCopilotEnabled(on: boolean): void {
  copilotEnabledRef.value = on;
}

// `ref` is also used to back the other mocked collaborators — attach the real reactive
// properties to the SAME objects the mocks above already returned, so any component
// that captured `agentDock`/`supportChat`/the sheet-visibility result at import time (a
// plain object reference) still sees these once Vue actually reads `.value` during a
// later render (mount() only happens inside a test's it() callback, well after this
// module has finished initializing).
Object.assign(sheetVisibility, { isAnySheetOpen: ref(false) });

Object.assign(mockSupportChat, {
  messages: ref<SupportMessage[]>([]),
  busy: ref(false),
  connectionState: ref<SupportConnectionState>('idle'),
  unread: ref(0),
  isAvailable: ref(true),
  errorKey: ref<string | null>(null),
});

Object.assign(mockDock, {
  isOpen: ref(true),
  busy: ref(false),
  messages: ref([]),
});

// @ts-ignore — tsconfig has no `*.vue` module shim, so `tsc` cannot resolve an
// SFC imported from a .ts file. Vite/vitest resolve it fine; this keeps the
// repo's typecheck error count where it was.
import AgentDock from './AgentDock.vue';

// $t stubbed as identity so assertions can target stable i18n keys instead of
// depending on translated copy (no i18n plugin is installed on the test Vue
// instance — see the CLAUDE.md guidance to check existing spec harnesses;
// none of this repo's component specs render translated text today, so this
// establishes the pattern for the new dock-only spec). Note this only stubs
// template `$t(...)` calls — AgentDock.vue's `inputPlaceholder` computed calls the
// real `i18n.t(...)` singleton directly, so its assertions below use the real
// committed us.ts copy instead of raw keys.
const $t = (key: string): string => key;

interface AgentDockVm {
  draft: string;
  submit: () => Promise<void>;
  mode: 'copilot' | 'support';
  pendingFiles: File[];
}

// Tracked so afterEach can destroy() it: AgentDock's own watchers (e.g. the
// mark-as-seen watcher) stay live against the shared mockDock/mockSupportChat
// singletons for as long as the component instance exists, so a wrapper left
// mounted from a prior test can still react to state the NEXT test mutates.
let activeWrapper: Wrapper<Vue> | null = null;

function mountDock(): Wrapper<Vue> {
  activeWrapper = mount(AgentDock, { mocks: { $t } });
  return activeWrapper;
}

function vmOf(wrapper: Wrapper<Vue>): AgentDockVm {
  return wrapper.vm as unknown as AgentDockVm;
}

// Selects a header mode-toggle button by its accessible name (its visible text —
// no aria-label duplicates it, see AgentDock.vue) rather than positional
// `buttons.at(0/1)`, so the test still finds the right button if the toggle's
// markup order ever changes.
function findModeButton(wrapper: Wrapper<Vue>, mode: 'copilot' | 'support'): Wrapper<Vue> {
  const label = mode === 'copilot' ? 'support.toggle.copilot' : 'support.toggle.support';
  const match = wrapper.findAll('.agent-dock__mode-btn').wrappers.find((w) => w.text().includes(label));
  if (!match) throw new Error(`mode toggle button not found for: ${mode}`);
  return match;
}

async function clickSupportToggle(wrapper: Wrapper<Vue>): Promise<void> {
  await findModeButton(wrapper, 'support').trigger('click');
}

async function clickCopilotToggle(wrapper: Wrapper<Vue>): Promise<void> {
  await findModeButton(wrapper, 'copilot').trigger('click');
}

// A real `File`, with `.size` pinned via defineProperty rather than sized via
// its content buffer — keeps size-cap/formatting tests exact without
// allocating megabyte-scale content just to get a round byte count.
function makeFile(name: string, size: number, type = 'text/plain'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

// Simulates picking files in the hidden <input type="file">: happy-dom (like
// jsdom) makes `.files` a read-only accessor on the real element, so tests
// shadow it with an own property before dispatching the `change` AgentDock
// listens on — the same workaround used across the ecosystem for this input.
async function pickFiles(wrapper: Wrapper<Vue>, files: File[]): Promise<void> {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: files, configurable: true });
  await input.trigger('change');
}

beforeEach(() => {
  setLiveChatEnabled(true);
  setCopilotEnabled(true);
  setWalletChain(undefined);

  mockDock.isOpen.value = true;
  mockDock.busy.value = false;
  mockDock.messages.value = [];

  mockSupportChat.messages.value = [];
  mockSupportChat.busy.value = false;
  mockSupportChat.connectionState.value = 'idle';
  mockSupportChat.unread.value = 0;
  mockSupportChat.isAvailable.value = true;
  mockSupportChat.errorKey.value = null;

  vi.clearAllMocks();
});

afterEach(() => {
  activeWrapper?.destroy();
  activeWrapper = null;
});

describe('AgentDock — flag off (isLiveChatEnabled: false)', () => {
  it('renders no mode toggle, no escalation chip, no unread dots — Copilot only, unchanged', async () => {
    setLiveChatEnabled(false);
    mockSupportChat.unread.value = 5; // must still have zero visible effect
    // Likewise a live error: without this the notice assertion below would pass
    // on a null errorKey alone and never exercise the activeMode gate.
    mockSupportChat.errorKey.value = 'support.error.sendFailed';
    const wrapper = mountDock();

    expect(wrapper.find('.agent-dock__mode-toggle').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(false);

    // Original 3 suggestion chips only — no 4th "talk to a human" chip.
    const chips = wrapper.findAll('.chip');
    expect(chips.length).toBe(3);

    // Header status still follows the original copilot busy/ready logic.
    expect(wrapper.find('.agent-dock__status').text()).toBe('copilot.status.ready');

    // Copilot content is what's on screen; support copy never renders.
    expect(wrapper.text()).toContain('copilot.greeting.line1');
    expect(wrapper.text()).not.toContain('support.intro.title');

    // mode can never reach 'support' with no toggle/chip to trigger it, so the
    // singleton's enter()/markSeen() must never fire — also proves the watcher
    // getters never subscribed to supportChat's refs (they'd have no way to
    // call these otherwise unreachable branches).
    await wrapper.vm.$nextTick();
    expect(mockSupportChat.enter).not.toHaveBeenCalled();
    expect(mockSupportChat.markSeen).not.toHaveBeenCalled();
  });

  it('flips off at runtime while already in Support mode: falls back to Copilot with no latent support state', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.text()).toContain('support.intro.title');

    // A visible banner BEFORE the flip, so the post-flip assertion proves the
    // activeMode gate hides it rather than passing on an already-null errorKey.
    mockSupportChat.errorKey.value = 'support.error.sendFailed';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(true);

    setLiveChatEnabled(false);
    await wrapper.vm.$nextTick();

    // activeMode collapses to 'copilot' the instant the flag drops, even though
    // the internal `mode` ref is still latently 'support' — no half-rendered state.
    expect(wrapper.find('.agent-dock__mode-toggle').exists()).toBe(false);
    expect(wrapper.text()).toContain('copilot.greeting.line1');
    expect(wrapper.text()).not.toContain('support.intro.title');
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(false);
  });
});

describe('AgentDock — Support (live chat) UI', () => {
  it('toggle switches the visible thread from Support (the default) to Assistant and back', async () => {
    const wrapper = mountDock();
    expect(wrapper.text()).toContain('support.intro.title');

    await clickCopilotToggle(wrapper);
    expect(wrapper.text()).toContain('copilot.greeting.line1');
    expect(wrapper.text()).not.toContain('support.intro.title');

    await clickSupportToggle(wrapper);
    expect(wrapper.text()).toContain('support.intro.title');
    expect(wrapper.text()).not.toContain('copilot.greeting.line1');
  });

  it('the escalation chip in the Assistant empty state switches to Support', async () => {
    const wrapper = mountDock();
    await clickCopilotToggle(wrapper);
    const chips = wrapper.findAll('.chip');
    expect(chips.length).toBe(4);
    await chips.at(3).trigger('click');
    expect(wrapper.text()).toContain('support.intro.title');
  });

  it('calls supportChat.enter() when clicking into support mode', async () => {
    const wrapper = mountDock();
    // Move off Support first: mounting already auto-connects into the default
    // Support tab, and enterSupportMode() no longer calls enter() directly
    // (the auto-enter watcher is the sole trigger — see AgentDock.vue), so a
    // click on an already-active Support tab is now a genuine reactive no-op.
    await clickCopilotToggle(wrapper);
    mockSupportChat.enter.mockClear();

    await clickSupportToggle(wrapper);
    expect(mockSupportChat.enter).toHaveBeenCalled();
  });

  it('enter() is idempotent-friendly: re-entering support mode calls enter() again (composable owns dedupe)', async () => {
    const wrapper = mountDock();
    // Move off Support first — mounting already auto-connects into the
    // default Support tab, so start from a clean slate for this test.
    await clickCopilotToggle(wrapper);
    mockSupportChat.enter.mockClear();

    await clickSupportToggle(wrapper);
    const afterFirstEntry = mockSupportChat.enter.mock.calls.length;
    expect(afterFirstEntry).toBeGreaterThan(0);

    await clickCopilotToggle(wrapper);
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.enter.mock.calls.length).toBeGreaterThan(afterFirstEntry);
  });

  it('marks the support thread as seen when the dock opens directly into Support (the default) — no click needed', async () => {
    mockDock.isOpen.value = false;
    const wrapper = mountDock();
    expect(mockSupportChat.markSeen).not.toHaveBeenCalled();

    // Simulates the FAB click that opens the dock (dock.isOpen false -> true) —
    // Support is already the active tab, so this alone must mark it seen.
    mockDock.isOpen.value = true;
    await wrapper.vm.$nextTick();

    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(1);
  });

  it('marks the support thread as seen when switching into it from Assistant mode', async () => {
    const wrapper = mountDock();
    // Support is already the default on mount, so bounce through Assistant first
    // to exercise a genuine mode transition — assigning a ref to its current
    // value ('support' -> 'support') is a Vue no-op and would not itself
    // re-trigger the watcher this behavior depends on.
    await clickCopilotToggle(wrapper);
    expect(mockSupportChat.markSeen).not.toHaveBeenCalled();
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(1);
  });

  it('marks the thread as seen again when the dock is closed and reopened while still in Support mode', async () => {
    const wrapper = mountDock();
    // Establish the "seen once" baseline via a genuine transition into Support
    // (see the test above for why a redundant click on the already-active
    // Support tab would not do this on its own).
    await clickCopilotToggle(wrapper);
    await clickSupportToggle(wrapper);
    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(1);

    mockDock.isOpen.value = false;
    await wrapper.vm.$nextTick();
    mockDock.isOpen.value = true;
    await wrapper.vm.$nextTick();

    expect(mockSupportChat.markSeen).toHaveBeenCalledTimes(2);
  });
});

describe('AgentDock — Support send behavior', () => {
  it('clears the draft only when supportChat.send() resolves true', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'hello';
    mockSupportChat.send.mockResolvedValueOnce(true);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello');
    expect(vm.draft).toBe('');
  });

  it('keeps the draft when supportChat.send() resolves false', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'hello';
    mockSupportChat.send.mockResolvedValueOnce(false);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello');
    expect(vm.draft).toBe('hello');
  });

  it('does not call send() for a blank/whitespace-only draft', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = '   ';

    await vm.submit();

    expect(mockSupportChat.send).not.toHaveBeenCalled();
  });

  it('does not call dock.send() when submitting from Support mode', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'hello support';

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('hello support');
    expect(mockDock.send).not.toHaveBeenCalled();
  });

  it('disables the send button while supportChat.busy is true', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const sendBtn = wrapper.find('.agent-dock__send');
    expect(sendBtn.attributes('disabled')).toBeDefined();
  });

  it('disables the attach button while supportChat.busy is true, same as the send button', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const attachBtn = wrapper.find('.agent-dock__attach-btn');
    expect(attachBtn.attributes('disabled')).toBeDefined();
  });
});

describe('AgentDock — input placeholder', () => {
  it('switches between the support and copilot placeholder text per mode', async () => {
    const wrapper = mountDock();
    // Real i18n singleton values (inputPlaceholder calls i18n.t() directly, not
    // the mocked template $t) — see us.ts for both source strings. Support is
    // the default tab, so its placeholder is what shows right after mount.
    expect(wrapper.find('.agent-dock__input input').attributes('placeholder')).toBe('Message support...');

    await clickCopilotToggle(wrapper);
    expect(wrapper.find('.agent-dock__input input').attributes('placeholder')).toBe('Ask Gero anything...');
  });
});

describe('AgentDock — wallets support chat cannot serve', () => {
  it('replaces the input with a notice when supportChat.isAvailable is false', async () => {
    mockSupportChat.isAvailable.value = false;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__input input').exists()).toBe(false);
    expect(wrapper.text()).toContain('support.unavailable.notice');
  });

  it('shows the normal input again in Assistant mode even when support is availability-gated', async () => {
    mockSupportChat.isAvailable.value = false;
    const wrapper = mountDock();
    await clickCopilotToggle(wrapper);
    expect(wrapper.find('.agent-dock__input input').exists()).toBe(true);
  });
});

describe('AgentDock — unread indicators', () => {
  it('shows a dot on the closed FAB when there are unread support messages', () => {
    mockDock.isOpen.value = false;
    mockSupportChat.unread.value = 2;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(true);
  });

  it('hides the FAB dot once the dock is open', () => {
    mockDock.isOpen.value = true;
    mockSupportChat.unread.value = 2;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(false);
  });

  it('shows a dot on the Support toggle segment while unread and viewing Assistant', async () => {
    mockSupportChat.unread.value = 1;
    const wrapper = mountDock();
    // Support is the default tab, so switch into Assistant to view the case
    // the dot is meant for: unread Support messages while looking elsewhere.
    await clickCopilotToggle(wrapper);
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(true);
  });

  it('hides the Support segment dot once the user has switched into Support mode', async () => {
    mockSupportChat.unread.value = 1;
    const wrapper = mountDock();
    await clickCopilotToggle(wrapper);
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(true);

    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__unread-dot').exists()).toBe(false);
  });
});

describe('AgentDock — status line mapping', () => {
  const cases: Array<[SupportConnectionState, string]> = [
    ['connecting', 'common.connecting'],
    ['reconnecting', 'support.status.reconnecting'],
    ['unavailable', 'support.status.unavailable'],
    ['connected', 'support.status.ready'],
    ['idle', 'support.status.ready'],
  ];

  for (const [state, key] of cases) {
    it(`maps connectionState "${state}" to $t('${key}')`, async () => {
      mockSupportChat.connectionState.value = state;
      const wrapper = mountDock();
      await clickSupportToggle(wrapper);
      expect(wrapper.find('.agent-dock__status').text()).toBe(key);
    });
  }

  it('shows copilot thinking/ready status while in Assistant mode, independent of connectionState', async () => {
    mockSupportChat.connectionState.value = 'unavailable';
    mockDock.busy.value = true;
    const wrapper = mountDock();
    await clickCopilotToggle(wrapper);
    expect(wrapper.find('.agent-dock__status').text()).toBe('copilot.status.thinking');
  });
});

describe('AgentDock — error banner', () => {
  it('renders $t(errorKey) inline when supportChat.errorKey is set', async () => {
    mockSupportChat.errorKey.value = 'support.error.sendFailed';
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__notice').text()).toBe('support.error.sendFailed');
  });

  it('renders no banner when errorKey is null', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    expect(wrapper.find('.agent-dock__notice').exists()).toBe(false);
  });
});

describe('AgentDock — support message bubbles', () => {
  it('renders agent messages with an agentName caption and falls back to support.agentFallbackName', async () => {
    mockSupportChat.messages.value = [
      { id: 1, role: 'user', text: 'hi', createdAt: 1 },
      { id: 2, role: 'agent', text: 'hello there', agentName: 'Alex', createdAt: 2 },
      { id: 3, role: 'agent', text: 'anything else?', createdAt: 3 },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    const names = wrapper.findAll('.agent-dock__agent-name');
    expect(names.length).toBe(2);
    expect(names.at(0).text()).toBe('Alex');
    expect(names.at(1).text()).toBe('support.agentFallbackName');

    // Ordered exactly as given, plain text (no markdown/intent cards).
    const bodies = wrapper.findAll('.agent-dock__text');
    expect(bodies.at(0).text()).toBe('hi');
    expect(bodies.at(1).text()).toBe('hello there');
    expect(bodies.at(2).text()).toBe('anything else?');
    expect(wrapper.find('.agent-dock__md').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__card').exists()).toBe(false);
  });

  it('shows the busy dots with a typing aria-label while supportChat.busy is true', async () => {
    mockSupportChat.busy.value = true;
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const busy = wrapper.find('.agent-dock__busy');
    expect(busy.exists()).toBe(true);
    expect(busy.attributes('aria-label')).toBe('support.status.typing');
  });
});

describe('AgentDock — support attachment bubbles', () => {
  it('renders an image attachment as a thumbnail link to the full-size original, falling back to dataUrl when no thumbUrl', async () => {
    mockSupportChat.messages.value = [
      {
        id: 1,
        role: 'agent',
        text: 'here you go',
        agentName: 'Alex',
        createdAt: 1,
        attachments: [
          { id: 101, fileType: 'image', dataUrl: 'https://cdn.example/full.png', thumbUrl: 'https://cdn.example/thumb.png' },
          { id: 102, fileType: 'image', dataUrl: 'https://cdn.example/full2.png' },
        ],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    const imgs = wrapper.findAll('.agent-dock__attach-img');
    expect(imgs.length).toBe(2);
    expect(imgs.at(0).attributes('src')).toBe('https://cdn.example/thumb.png');
    expect(imgs.at(1).attributes('src')).toBe('https://cdn.example/full2.png');
    // Decorative — the wrapping <a> is the actionable element, not the image.
    expect(imgs.at(0).attributes('alt')).toBe('');

    const link = imgs.at(0).element.closest('a');
    expect(link?.getAttribute('href')).toBe('https://cdn.example/full.png');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
  });

  it('renders a non-image attachment as a file link with its extension and human-readable size', async () => {
    mockSupportChat.messages.value = [
      {
        id: 2,
        role: 'user',
        text: 'invoice',
        createdAt: 2,
        attachments: [{ id: 103, fileType: 'file', dataUrl: 'https://cdn.example/report.pdf', extension: 'pdf', fileSize: 1536 }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    const fileLink = wrapper.find('.agent-dock__attach-file');
    expect(fileLink.exists()).toBe(true);
    expect(fileLink.attributes('href')).toBe('https://cdn.example/report.pdf');
    expect(fileLink.attributes('target')).toBe('_blank');
    expect(fileLink.attributes('rel')).toBe('noopener');
    expect(fileLink.text()).toContain('PDF');
    expect(fileLink.text()).toContain('1.5 KB');
  });

  it('omits the text <p> for an attachment-only message with empty text', async () => {
    mockSupportChat.messages.value = [
      {
        id: 3,
        role: 'agent',
        text: '',
        agentName: 'Alex',
        createdAt: 3,
        attachments: [{ id: 104, fileType: 'file', dataUrl: 'https://cdn.example/notes.txt', extension: 'txt' }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__text').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__attach-file').exists()).toBe(true);
  });

  it('swaps an image attachment to the generic file row when the thumbnail fails to load', async () => {
    mockSupportChat.messages.value = [
      {
        id: 4,
        role: 'agent',
        text: 'photo',
        agentName: 'Alex',
        createdAt: 4,
        attachments: [{ id: 105, fileType: 'image', dataUrl: 'https://cdn.example/full.png', thumbUrl: 'https://cdn.example/expired-thumb.png' }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__attach-img').exists()).toBe(true);
    expect(wrapper.find('.agent-dock__attach-file').exists()).toBe(false);

    await wrapper.find('.agent-dock__attach-img').trigger('error');

    expect(wrapper.find('.agent-dock__attach-img').exists()).toBe(false);
    const fallback = wrapper.find('.agent-dock__attach-file');
    expect(fallback.exists()).toBe(true);
    expect(fallback.attributes('href')).toBe('https://cdn.example/full.png');
  });

  it('scopes the thumbnail-error fallback to its own message: a failure in one message does not hide another message\'s identical attachment id', async () => {
    mockSupportChat.messages.value = [
      {
        id: 5,
        role: 'agent',
        text: 'first',
        agentName: 'Alex',
        createdAt: 5,
        attachments: [{ id: 999, fileType: 'image', dataUrl: 'https://cdn.example/a-full.png', thumbUrl: 'https://cdn.example/a-thumb.png' }],
      },
      {
        id: 6,
        role: 'agent',
        text: 'second',
        agentName: 'Alex',
        createdAt: 6,
        // Same attachment id (999) as the message above — ids are not
        // guaranteed globally unique across messages (optimistic echoes).
        attachments: [{ id: 999, fileType: 'image', dataUrl: 'https://cdn.example/b-full.png', thumbUrl: 'https://cdn.example/b-thumb.png' }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    await wrapper.findAll('.agent-dock__attach-img').at(0).trigger('error');

    const imgs = wrapper.findAll('.agent-dock__attach-img');
    expect(imgs.length).toBe(1);
    expect(imgs.at(0).attributes('src')).toBe('https://cdn.example/b-thumb.png');
    expect(wrapper.findAll('.agent-dock__attach-file').length).toBe(1);
  });

  it('prefers fileName over the extension/fileType label, falling back when fileName is missing', async () => {
    mockSupportChat.messages.value = [
      {
        id: 7,
        role: 'agent',
        text: '',
        agentName: 'Alex',
        createdAt: 7,
        attachments: [
          { id: 301, fileType: 'file', dataUrl: 'https://cdn.example/1', extension: 'pdf', fileName: 'invoice-march.pdf' },
          { id: 302, fileType: 'file', dataUrl: 'https://cdn.example/2', extension: 'pdf', fileName: 'invoice-april.pdf' },
          { id: 303, fileType: 'file', dataUrl: 'https://cdn.example/3', extension: 'pdf', fileName: 'invoice-may.pdf' },
          { id: 304, fileType: 'file', dataUrl: 'https://cdn.example/4', extension: 'pdf' },
        ],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    const names = wrapper.findAll('.agent-dock__attach-name').wrappers.map((w) => w.text());
    expect(names).toEqual(['invoice-march.pdf', 'invoice-april.pdf', 'invoice-may.pdf', 'PDF']);
  });

  it('falls back to the raw fileType when there is no fileName or extension', async () => {
    mockSupportChat.messages.value = [
      {
        id: 8,
        role: 'agent',
        text: '',
        agentName: 'Alex',
        createdAt: 8,
        attachments: [{ id: 305, fileType: 'archive', dataUrl: 'https://cdn.example/blob' }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__attach-name').text()).toBe('archive');
  });

  it('strips a leading dot from the extension when there is no fileName', async () => {
    mockSupportChat.messages.value = [
      {
        id: 9,
        role: 'agent',
        text: '',
        agentName: 'Alex',
        createdAt: 9,
        attachments: [{ id: 306, fileType: 'file', dataUrl: 'https://cdn.example/x', extension: '.pdf' }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__attach-name').text()).toBe('PDF');
  });

  it('rolls the size over to the next unit at >= 1000 of the current one, instead of "1024.0 KB"', async () => {
    mockSupportChat.messages.value = [
      {
        id: 10,
        role: 'agent',
        text: '',
        agentName: 'Alex',
        createdAt: 10,
        attachments: [{ id: 307, fileType: 'file', dataUrl: 'https://cdn.example/big', extension: 'zip', fileSize: 1048575 }],
      },
    ];
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    expect(wrapper.find('.agent-dock__attach-size').text()).toBe('1.0 MB');
  });
});

describe('AgentDock — attachment picker and pending chips', () => {
  it('hides the attach button, hidden file input, and pending chips when the live-chat flag is off — even with mode latently support and files pending', async () => {
    setLiveChatEnabled(false);
    const wrapper = mountDock();
    const vm = vmOf(wrapper);
    // `mode` can only reach 'support' through UI the flag hides (the header
    // toggle / escalation chip), but this proves the gate is `activeMode`
    // (flag-aware), not a bare `mode === 'support'` check — see AgentDock.vue.
    vm.mode = 'support';
    vm.pendingFiles = [makeFile('a.png', 100)];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.agent-dock__attach-btn').exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__pending').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__pending-chip').exists()).toBe(false);
  });

  it('renders the attach button and hidden file input only in Support mode', async () => {
    const wrapper = mountDock();
    // Support is the default tab, so the attach button is already present —
    // switch away to Assistant to prove it's Support-only, not just present.
    await clickCopilotToggle(wrapper);
    expect(wrapper.find('.agent-dock__attach-btn').exists()).toBe(false);

    await clickSupportToggle(wrapper);
    const attachBtn = wrapper.find('.agent-dock__attach-btn');
    expect(attachBtn.exists()).toBe(true);
    expect(attachBtn.attributes('aria-label')).toBe('support.attach.button');

    const input = wrapper.find('input[type="file"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes('multiple')).toBeDefined();
    expect(input.attributes('accept')).toBe('image/*,.pdf,.txt,.log,.json,.csv,.zip');
  });

  it('clicking the attach button opens the hidden file picker', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    await wrapper.find('.agent-dock__attach-btn').trigger('click');

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('adds picked files as pending chips above the footer', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    await pickFiles(wrapper, [makeFile('receipt.png', 2048, 'image/png')]);

    const chips = wrapper.findAll('.agent-dock__pending-chip');
    expect(chips.length).toBe(1);
    expect(chips.at(0).text()).toContain('receipt.png');
    expect(chips.at(0).text()).toContain('2.0 KB');
  });

  it('middle-truncates a long file name in its chip', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const longName = 'quarterly-financial-report-detailed-breakdown-2026.pdf';

    await pickFiles(wrapper, [makeFile(longName, 100)]);

    const shown = wrapper.find('.agent-dock__pending-name').text();
    expect(shown.length).toBeLessThan(longName.length);
    expect(shown).toContain('…');
  });

  it('removes a pending file when its chip remove button is clicked', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    await pickFiles(wrapper, [makeFile('a.png', 100), makeFile('b.png', 200)]);
    expect(wrapper.findAll('.agent-dock__pending-chip').length).toBe(2);

    const removeButtons = wrapper.findAll('.agent-dock__pending-remove');
    expect(removeButtons.at(0).attributes('aria-label')).toBe('common.remove');
    await removeButtons.at(0).trigger('click');

    const remaining = wrapper.findAll('.agent-dock__pending-chip');
    expect(remaining.length).toBe(1);
    expect(remaining.at(0).text()).toContain('b.png');
  });

  it('caps pending files at 5 total and shows a notice via the existing banner slot when more are picked', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.txt`, 10));
    await pickFiles(wrapper, files);

    expect(wrapper.findAll('.agent-dock__pending-chip').length).toBe(5);
    expect(wrapper.find('.agent-dock__notice').text()).toBe('support.error.tooManyFiles');
  });

  it('keeps the first 5 files when a later pick would exceed the cap across two picks', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);

    await pickFiles(wrapper, [makeFile('a.txt', 10), makeFile('b.txt', 10), makeFile('c.txt', 10), makeFile('d.txt', 10)]);
    await pickFiles(wrapper, [makeFile('e.txt', 10), makeFile('f.txt', 10)]);

    const names = wrapper.findAll('.agent-dock__pending-chip').wrappers.map((w) => w.find('.agent-dock__pending-name').text());
    expect(names).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']);
    expect(wrapper.find('.agent-dock__notice').text()).toBe('support.error.tooManyFiles');
  });
});

describe('AgentDock — support send with attachments', () => {
  it('submit() sends the draft with pending files in Support mode', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'see attached';
    const file = makeFile('log.txt', 512);
    await pickFiles(wrapper, [file]);
    mockSupportChat.send.mockResolvedValueOnce(true);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('see attached', [file]);
    expect(vm.draft).toBe('');
    expect(wrapper.findAll('.agent-dock__pending-chip').length).toBe(0);
  });

  it('calls send() with a single argument (no files) when there are no pending files — preserves the existing text-only contract', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'no attachments here';
    mockSupportChat.send.mockResolvedValueOnce(true);

    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('no attachments here');
  });

  it('keeps pending chips and draft when send() resolves false', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    vm.draft = 'see attached';
    await pickFiles(wrapper, [makeFile('log.txt', 512)]);
    mockSupportChat.send.mockResolvedValueOnce(false);

    await vm.submit();

    expect(vm.draft).toBe('see attached');
    expect(wrapper.findAll('.agent-dock__pending-chip').length).toBe(1);
  });

  it('sends files-only with an empty draft, and the send button stays enabled', async () => {
    const wrapper = mountDock();
    await clickSupportToggle(wrapper);
    const vm = vmOf(wrapper);
    const file = makeFile('a.png', 100);
    await pickFiles(wrapper, [file]);
    vm.draft = '';
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.agent-dock__send').attributes('disabled')).toBeUndefined();

    mockSupportChat.send.mockResolvedValueOnce(true);
    await vm.submit();

    expect(mockSupportChat.send).toHaveBeenCalledWith('', [file]);
  });
});

// Gero Companion: support is the primary experience, the Assistant (AI chat +
// proactive feed) is secondary and gated by its own flag independent of
// isLiveChatEnabled — see AgentDock.vue's `activeMode` computed and
// featureFlagsStore.isCopilotEnabled's doc block for the full matrix.
describe('AgentDock — Companion gating (isCopilotEnabled)', () => {
  it('live-on + copilot-off: opens directly in Support with no click needed', () => {
    setCopilotEnabled(false);
    const wrapper = mountDock();

    expect(wrapper.text()).toContain('support.intro.title');
    expect(wrapper.text()).not.toContain('copilot.greeting.line1');
  });

  it('live-on + copilot-off: the Assistant segment renders disabled (attr + aria)', () => {
    setCopilotEnabled(false);
    const wrapper = mountDock();

    const assistantBtn = findModeButton(wrapper, 'copilot');
    expect(assistantBtn.attributes('disabled')).toBeDefined();
    expect(assistantBtn.attributes('aria-disabled')).toBe('true');

    const supportBtn = findModeButton(wrapper, 'support');
    expect(supportBtn.attributes('disabled')).toBeUndefined();
  });

  it('live-on + copilot-off: clicking the disabled Assistant segment does nothing', async () => {
    setCopilotEnabled(false);
    const wrapper = mountDock();
    // Landing on the forced Support tab already auto-connects once (see the
    // dedicated "Support connection" describe block below) — the click itself
    // must not add to that.
    const callsBeforeClick = mockSupportChat.enter.mock.calls.length;

    await findModeButton(wrapper, 'copilot').trigger('click');

    expect(wrapper.text()).toContain('support.intro.title');
    expect(wrapper.text()).not.toContain('copilot.greeting.line1');
    expect(mockSupportChat.enter.mock.calls.length).toBe(callsBeforeClick);
  });

  it('live-on + copilot-on: both segments enabled, default is Support, and DOM order is Support then Assistant', () => {
    const wrapper = mountDock();
    const buttons = wrapper.findAll('.agent-dock__mode-btn');

    expect(buttons.length).toBe(2);
    expect(buttons.at(0).text()).toContain('support.toggle.support');
    expect(buttons.at(1).text()).toContain('support.toggle.copilot');
    expect(buttons.at(0).attributes('disabled')).toBeUndefined();
    expect(buttons.at(1).attributes('disabled')).toBeUndefined();
    expect(buttons.at(1).attributes('aria-disabled')).toBe('false');

    expect(wrapper.text()).toContain('support.intro.title');
  });
});

// Support is the default/primary tab, so a returning user must not have to
// click anything for their history to load — supportChat.enter() has to fire
// the instant Support becomes the active, visible content of an open dock,
// not only from the toggle/chip click handlers. See the watcher in
// AgentDock.vue placed right after the markSeen watcher.
describe('AgentDock — Support connection (auto-enter)', () => {
  it('calls supportChat.enter() when the dock opens with Support as the default — no interaction needed', () => {
    // beforeEach already sets isOpen=true with liveChatEnabled/copilotEnabled
    // both true — i.e. exactly "the dock opens with Support as the default."
    mountDock();
    expect(mockSupportChat.enter).toHaveBeenCalled();
  });

  it('calls supportChat.enter() when copilot-off forces Support on mount', () => {
    setCopilotEnabled(false);
    mountDock();
    expect(mockSupportChat.enter).toHaveBeenCalled();
  });

  it('does not call supportChat.enter() while the dock is closed', () => {
    mockDock.isOpen.value = false;
    mountDock();
    expect(mockSupportChat.enter).not.toHaveBeenCalled();
  });

  it('never calls supportChat.enter() when the live-chat flag is off, regardless of dock open state', () => {
    setLiveChatEnabled(false);
    mockDock.isOpen.value = true;
    mountDock();
    expect(mockSupportChat.enter).not.toHaveBeenCalled();
  });

  it('calls supportChat.enter() again after switching to Assistant and back to Support', async () => {
    const wrapper = mountDock();
    const callsAtMount = mockSupportChat.enter.mock.calls.length;
    expect(callsAtMount).toBeGreaterThan(0);

    await clickCopilotToggle(wrapper);
    await clickSupportToggle(wrapper);

    expect(mockSupportChat.enter.mock.calls.length).toBeGreaterThan(callsAtMount);
  });

  it('calls supportChat.enter() when a runtime copilotEnabled drop forces Support while the dock is already open', async () => {
    const wrapper = mountDock();
    // Move off Support first so the flag flip below is a genuine transition,
    // not a no-op on an already-active tab.
    await clickCopilotToggle(wrapper);
    mockSupportChat.enter.mockClear();

    // Before the flip: Assistant is the active, aria-selected tab. Vue 2 drops
    // a non-enumerated aria-* attribute entirely when its bound expression is
    // false (it is not in the isEnumeratedAttr list that gets a literal
    // "false" string, unlike the Assistant button's own aria-disabled, which
    // is deliberately wrapped in String(...) below for exactly that reason) —
    // so the not-selected tab has no aria-selected attribute at all, not one
    // set to "false".
    expect(findModeButton(wrapper, 'copilot').classes()).toContain('is-active');
    expect(findModeButton(wrapper, 'copilot').attributes('aria-selected')).toBe('true');
    expect(findModeButton(wrapper, 'support').classes()).not.toContain('is-active');
    expect(findModeButton(wrapper, 'support').attributes('aria-selected')).toBeUndefined();

    setCopilotEnabled(false);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('support.intro.title');
    expect(mockSupportChat.enter).toHaveBeenCalled();

    // The toggle's is-active/aria-selected state is bound to `activeMode`, not
    // the latent `mode` (still 'copilot' internally, since only activeMode
    // collapsed) — otherwise the now-disabled Assistant tab would stay marked
    // active/selected while Support is what's actually rendering.
    const supportBtn = findModeButton(wrapper, 'support');
    const assistantBtn = findModeButton(wrapper, 'copilot');
    expect(supportBtn.classes()).toContain('is-active');
    expect(supportBtn.attributes('aria-selected')).toBe('true');
    expect(assistantBtn.classes()).not.toContain('is-active');
    expect(assistantBtn.attributes('aria-selected')).toBeUndefined();
    expect(assistantBtn.attributes('disabled')).toBeDefined();
  });
});

describe('AgentDock — FAB icon (Gero Companion mark)', () => {
  it('renders the Gero logo mark image on the closed FAB, not the mdi-robot icon', () => {
    mockDock.isOpen.value = false;
    const wrapper = mountDock();

    const icon = wrapper.find('.agent-dock__fab-icon');
    expect(icon.exists()).toBe(true);
    expect(icon.element.tagName).toBe('IMG');
    expect(icon.attributes('alt')).toBe('');
    expect(wrapper.find('.agent-dock__fab').text()).not.toContain('mdi-robot-outline');
  });

  it('keeps the unread dot rendering above the logo mark on the closed FAB', () => {
    mockDock.isOpen.value = false;
    mockSupportChat.unread.value = 1;
    const wrapper = mountDock();

    expect(wrapper.find('.agent-dock__fab-icon').exists()).toBe(true);
    expect(wrapper.find('.agent-dock__fab-dot').exists()).toBe(true);
  });

  it('still renders mdi-close (not the logo mark) once the dock is open', () => {
    mockDock.isOpen.value = true;
    const wrapper = mountDock();

    expect(wrapper.find('.agent-dock__fab-icon').exists()).toBe(false);
    expect(wrapper.find('.agent-dock__fab').text()).toContain('mdi-close');
  });

  // Each gero-notext*.svg variant bakes its own fixed gradient — the wrong
  // one shows the wrong brand color on an Apex or Midnight wallet. Mirrors
  // NavigationDrawer.vue's own isApex/isMidnight -> asset switch exactly, so
  // these assert against the same `assets` barrel values that component uses.
  it('uses the default (Cardano) mark when no chain-specific wallet is logged in', () => {
    mockDock.isOpen.value = false;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-icon').attributes('src')).toBe(assets.geroNoText);
  });

  it('switches to the Apex Prime (teal) mark for an Apex Fusion Prime wallet', () => {
    setWalletChain(Blockchain.APEX_PRIME);
    mockDock.isOpen.value = false;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-icon').attributes('src')).toBe(assets.geroNoTextPrime);
  });

  it('switches to the Apex Vector (orange) mark for an Apex Fusion Vector wallet', () => {
    setWalletChain(Blockchain.APEX_VECTOR);
    mockDock.isOpen.value = false;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-icon').attributes('src')).toBe(assets.geroNoTextVector);
  });

  it('switches to the Midnight mark for a Midnight wallet', () => {
    setWalletChain(Blockchain.MIDNIGHT);
    mockDock.isOpen.value = false;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-icon').attributes('src')).toBe(assets.geroNoTextMidnight);
  });

  it('falls back to the default (Cardano) mark for a Cardano or Bitcoin wallet', () => {
    setWalletChain(Blockchain.BITCOIN);
    mockDock.isOpen.value = false;
    const wrapper = mountDock();
    expect(wrapper.find('.agent-dock__fab-icon').attributes('src')).toBe(assets.geroNoText);
  });
});
