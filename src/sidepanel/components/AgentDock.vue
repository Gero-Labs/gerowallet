<!-- src/sidepanel/components/AgentDock.vue -->
<template>
  <div class="agent-dock">
    <button
      class="agent-dock__fab"
      :class="{ 'is-open': dock.isOpen.value, 'is-hidden': isAnySheetOpen }"
      :aria-label="dock.isOpen.value ? $t('copilot.close') : $t('copilot.open')"
      :tabindex="isAnySheetOpen ? -1 : 0"
      @click="dock.toggle()"
    >
      <img
        v-if="!dock.isOpen.value"
        :src="geroMark"
        alt=""
        class="agent-dock__fab-icon"
      />
      <v-icon v-else size="22" color="var(--g-accent)">mdi-close</v-icon>
      <span
        v-if="liveChatEnabled && !dock.isOpen.value && supportChat.unread.value > 0"
        class="agent-dock__fab-dot"
        aria-hidden="true"
      ></span>
    </button>

    <transition name="dock-panel">
      <div v-if="dock.isOpen.value" class="agent-dock__panel">
        <header class="agent-dock__head" :class="{ 'agent-dock__head--with-toggle': liveChatEnabled }">
          <div class="agent-dock__head-text">
            <span class="agent-dock__title">{{ $t('copilot.title') }}</span>
            <span class="agent-dock__status">{{ $t(statusKey) }}</span>
          </div>

          <!-- Support-first: Support is the default/leftmost tab (see `mode`'s
               initial value below); Agent (copilot) is second and disabled whenever
               copilotEnabled is off — visible so the capability is discoverable,
               but neither clickable (real `disabled`) nor announced as
               actionable (`aria-disabled`) to assistive tech. -->
          <div v-if="liveChatEnabled" class="agent-dock__mode-toggle" role="tablist">
            <button
              type="button"
              class="agent-dock__mode-btn"
              :class="{ 'is-active': activeMode === 'support' }"
              role="tab"
              :aria-selected="activeMode === 'support'"
              aria-controls="agent-dock-thread"
              @click="enterSupportMode()"
            >
              {{ $t('support.toggle.support') }}
              <span
                v-if="activeMode === 'copilot' && supportChat.unread.value > 0"
                class="agent-dock__unread-dot"
                aria-hidden="true"
              ></span>
            </button>
            <button
              type="button"
              class="agent-dock__mode-btn"
              :class="{ 'is-active': activeMode === 'copilot' }"
              role="tab"
              :aria-selected="activeMode === 'copilot'"
              aria-controls="agent-dock-thread"
              :disabled="!copilotEnabled"
              :aria-disabled="String(!copilotEnabled)"
              @click="enterCopilotMode()"
            >{{ $t('support.toggle.copilot') }}</button>
          </div>

          <button
            class="agent-dock__close"
            :aria-label="$t('copilot.close')"
            @click="dock.close()"
          >
            <v-icon size="18" color="var(--g-text-2)">mdi-close</v-icon>
          </button>
        </header>

        <div
          ref="scroll"
          class="agent-dock__messages"
          :id="liveChatEnabled ? 'agent-dock-thread' : undefined"
          :role="liveChatEnabled ? 'tabpanel' : undefined"
        >
          <template v-if="activeMode === 'copilot'">
            <div
              v-if="dock.messages.value.length === 0 && !dock.busy.value"
              class="agent-dock__empty"
            >
              <div class="agent-dock__empty-orb">G</div>
              <p class="agent-dock__empty-h">{{ $t('copilot.greeting.line1') }}</p>
              <p class="agent-dock__empty-sub">{{ $t('copilot.greeting.line2') }}</p>
              <div class="agent-dock__chips">
                <button class="chip" @click="quickSend($t('copilot.suggest.portfolio'))">
                  {{ $t('copilot.suggest.portfolio') }}
                </button>
                <button class="chip" @click="quickSend($t('copilot.suggest.staking'))">
                  {{ $t('copilot.suggest.staking') }}
                </button>
                <button class="chip" @click="quickSend($t('copilot.suggest.swap'))">
                  {{ $t('copilot.suggest.swap') }}
                </button>
                <button v-if="liveChatEnabled" class="chip" @click="enterSupportMode()">
                  {{ $t('support.chip.talkToHuman') }}
                </button>
              </div>
            </div>

            <transition-group name="msg" tag="div" class="agent-dock__list">
              <div
                v-for="m in dock.messages.value"
                :key="m.id"
                :class="['agent-dock__msg', m.role]"
              >
                <div v-if="m.role === 'assistant'" class="agent-dock__avatar">G</div>
                <div class="agent-dock__bubble">
                  <!-- assistant replies are markdown (escaped-first, then rendered); user text stays plain -->
                  <div
                    v-if="m.role === 'assistant'"
                    class="agent-dock__md"
                    v-html="renderMarkdown(m.text)"
                  ></div>
                  <p v-else class="agent-dock__text">{{ m.text }}</p>
                  <div v-if="m.intent" class="agent-dock__card">
                    <ChartCard
                      v-if="m.intent.type === 'chart-token'"
                      :symbol="m.intent.symbol"
                      :asset-id="m.intent.assetId"
                    />
                    <SwapCard
                      v-else-if="m.intent.type === 'swap'"
                      :intent="m.intent.swap"
                    />
                    <StakingCard
                      v-else-if="m.intent.type === 'staking'"
                      :intent="m.intent.staking"
                    />
                    <AllowanceCard v-else-if="m.intent.type === 'allowance'" />
                  </div>
                </div>
              </div>
            </transition-group>

            <div v-if="dock.busy.value" class="agent-dock__msg assistant">
              <div class="agent-dock__avatar">G</div>
              <div class="agent-dock__busy" :aria-label="$t('copilot.status.thinking')">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </template>

          <!-- Support (live chat) thread: same bubble layout as Assistant, but plain
               text only (no markdown, no intent cards) and agent bubbles carry an
               agentName caption. Only reachable when liveChatEnabled — `mode`
               defaults to 'support' (see below), and otherwise only ever moves
               there via the header toggle or the escalation chip above. -->
          <template v-else>
            <div
              v-if="supportChat.messages.value.length === 0 && !supportChat.busy.value"
              class="agent-dock__empty"
            >
              <div class="agent-dock__empty-orb">G</div>
              <p class="agent-dock__empty-h">{{ $t('support.intro.title') }}</p>
              <p class="agent-dock__empty-sub">{{ $t('support.intro.line') }}</p>
              <p class="agent-dock__empty-status">{{ $t(statusKey) }}</p>
            </div>

            <transition-group name="msg" tag="div" class="agent-dock__list">
              <div
                v-for="m in supportChat.messages.value"
                :key="m.clientId ?? m.id"
                :class="['agent-dock__msg', m.role === 'user' ? 'user' : 'assistant']"
              >
                <div v-if="m.role === 'agent'" class="agent-dock__avatar">{{ agentInitial(m.agentName) }}</div>
                <div class="agent-dock__bubble">
                  <span v-if="m.role === 'agent'" class="agent-dock__agent-name">
                    {{ m.agentName || $t('support.agentFallbackName') }}
                  </span>
                  <p v-if="m.text" class="agent-dock__text">{{ m.text }}</p>
                  <div v-if="m.attachments && m.attachments.length" class="agent-dock__attachments">
                    <div v-for="a in m.attachments" :key="a.id">
                      <a
                        v-if="a.fileType === 'image' && !attachmentFailed(m.id, a.id)"
                        :href="a.dataUrl"
                        target="_blank"
                        rel="noopener"
                      >
                        <img
                          class="agent-dock__attach-img"
                          :src="a.thumbUrl ?? a.dataUrl"
                          alt=""
                          @error="onAttachImgError(m.id, a.id)"
                        />
                      </a>
                      <a
                        v-else
                        class="agent-dock__attach-file"
                        :href="a.dataUrl"
                        target="_blank"
                        rel="noopener"
                      >
                        <v-icon size="14" color="var(--g-accent)">mdi-paperclip</v-icon>
                        <span class="agent-dock__attach-name">{{ attachmentLabel(a) }}</span>
                        <span v-if="a.fileSize" class="agent-dock__attach-size">{{ formatAttachmentSize(a.fileSize) }}</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </transition-group>

            <div v-if="supportChat.busy.value" class="agent-dock__msg assistant">
              <div class="agent-dock__avatar">{{ agentInitial() }}</div>
              <div class="agent-dock__busy" :aria-label="$t('support.status.typing')">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </template>
        </div>

        <!-- Kept outside the scrollable thread so a new error/notice is never
             scrolled out of view by the busy→false scroll-to-bottom watcher.
             One slot for two sources: the composable's own errorKey (server-
             side failures) and the too-many-files cap below, which is a
             purely local, UI-side notice — it never touches errorKey. -->
        <div
          v-if="activeMode === 'support' && noticeKey"
          class="agent-dock__notice"
          role="alert"
        >
          {{ $t(noticeKey) }}
        </div>

        <div
          v-if="activeMode === 'support' && pendingFiles.length"
          class="agent-dock__pending"
        >
          <div
            v-for="(file, idx) in pendingFiles"
            :key="file.name + file.size + file.lastModified"
            class="agent-dock__pending-chip"
          >
            <span class="agent-dock__pending-name">{{ middleTruncate(file.name) }}</span>
            <span class="agent-dock__pending-size">{{ formatAttachmentSize(file.size) }}</span>
            <button
              type="button"
              class="agent-dock__pending-remove"
              :aria-label="$t('common.remove')"
              @click="removePendingFile(idx)"
            >
              <v-icon size="12" color="var(--g-text-2)">mdi-close</v-icon>
            </button>
          </div>
        </div>

        <footer
          v-if="activeMode === 'support' && !supportChat.isAvailable.value"
          class="agent-dock__input agent-dock__input--notice"
        >
          <p class="agent-dock__unavailable">{{ $t('support.unavailable.notice') }}</p>
        </footer>
        <footer v-else class="agent-dock__input">
          <button
            v-if="activeMode === 'support'"
            type="button"
            class="agent-dock__attach-btn"
            :disabled="sendDisabled"
            :aria-label="$t('support.attach.button')"
            @click="triggerFilePicker()"
          >
            <v-icon size="16" color="var(--g-text-2)">mdi-paperclip</v-icon>
          </button>
          <input
            v-model="draft"
            :placeholder="inputPlaceholder"
            @keyup.enter="submit()"
          />
          <!-- Kept AFTER the draft input (not just visually via the attach
               button above) so `.agent-dock__input input` still resolves to
               the draft field first — several pre-existing tests query it by
               that generic selector. -->
          <input
            v-if="activeMode === 'support'"
            ref="fileInputRef"
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.log,.json,.csv,.zip"
            class="agent-dock__file-input"
            @change="onFilesPicked"
          />
          <button
            class="agent-dock__send"
            :disabled="sendDisabled"
            :aria-label="$t('copilot.send')"
            @click="submit()"
          >
            <v-icon size="16" color="var(--g-on-grad)">mdi-send</v-icon>
          </button>
        </footer>
        <p v-if="activeMode === 'copilot'" class="agent-dock__disclaimer">{{ $t('copilot.disclaimer') }}</p>
      </div>
    </transition>

    <!-- Spending-auth prompt for the support chat's one-time identity handshake.
         Mounted here (not inside the panel) so the hook it registers stays wired
         for the dock's whole lifetime, and mounted at all only behind the flag,
         so a flag-off context never registers a prompt it can never show. -->
    <SupportAuthPrompt v-if="liveChatEnabled" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, watch } from 'vue';
import { agentDock } from '@/sidepanel/composables/useAgentDock';
import { renderMarkdown } from '@/services/agent/renderMarkdown';
import { useSheetVisibility } from '@/sidepanel/composables/useSheetVisibility';
import {
  supportChat,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  type SupportAttachment,
} from '@/sidepanel/composables/useSupportChat';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { debugWarn } from '@/utils/debug';
import i18n from '@/plugins/i18n';
import ChartCard from '@/sidepanel/components/agent/ChartCard.vue';
import SwapCard from '@/sidepanel/components/agent/SwapCard.vue';
import StakingCard from '@/sidepanel/components/agent/StakingCard.vue';
import AllowanceCard from '@/sidepanel/components/agent/AllowanceCard.vue';
import SupportAuthPrompt from '@/sidepanel/components/SupportAuthPrompt.vue';
// The text-free Gero mark (antler icon, no wordmark) — same three-way asset
// NavigationDrawer.vue uses for its own small-size logo rendering
// (geroNoText/geroNoTextApex/geroNoTextMidnight). Chosen over gero-logo.svg
// (also mark-only, but a heavier raster PNG embedded in an SVG wrapper)
// because it is a single scalable vector path per variant, which stays crisp
// at the FAB's ~22px render size and costs a fraction of the bytes. Each
// variant bakes its own fixed gradient (the default is Cardano cyan/blue),
// so which one renders has to track the active chain via the geroMark
// computed below, mirroring NavigationDrawer.vue's derivation exactly.
import assets from '@/utils/assets';

type DockMode = 'copilot' | 'support';

// Only the COUNT cap is this component's job — the size cap is enforced by
// the composable itself and surfaces through supportChat.errorKey.
const MAX_PENDING_FILES = SUPPORT_MAX_FILES_PER_MESSAGE;

export default defineComponent({
  name: 'AgentDock',
  components: { ChartCard, SwapCard, StakingCard, AllowanceCard, SupportAuthPrompt },
  setup() {
    const draft = ref('');
    const dock = agentDock;
    const scroll = ref<HTMLElement | null>(null);
    const { isAnySheetOpen } = useSheetVisibility();

    // Mirrors NavigationDrawer.vue's navLogo derivation exactly (same
    // walletStore.loggedWallet?.chain source, same Blockchain members) so the
    // FAB always shows the same chain-accented mark the nav drawer does. Each
    // gero-notext*.svg variant bakes its own fixed gradient rather than
    // reading --g-accent, so picking the wrong one shows the wrong brand
    // color — e.g. Cardano cyan on an Apex or Midnight wallet. Apex Prime and
    // Vector each get their own variant (teal vs orange).
    const geroMark = computed(() => {
      switch (walletStore.loggedWallet?.chain) {
        case Blockchain.APEX_PRIME:
          return assets.geroNoTextPrime;
        case Blockchain.APEX_VECTOR:
          return assets.geroNoTextVector;
        case Blockchain.MIDNIGHT:
          return assets.geroNoTextMidnight;
        default:
          return assets.geroNoText;
      }
    });

    // ── Support attachments: pending picker state + sent-attachment bubbles ──
    const pendingFiles = ref<File[]>([]);
    const fileInputRef = ref<HTMLInputElement | null>(null);
    // Attachment ids whose thumbnail failed to load (signed URLs can expire) —
    // those bubbles fall back to the generic file row instead. Keyed
    // `${messageId}:${attachmentId}`, not the bare attachment id: ids arriving
    // from optimistic echoes are not guaranteed unique across messages, so a
    // bare-id key could make one message's failure hide another's thumbnail.
    const attachErrored = ref<string[]>([]);
    // Local, UI-side notice for the file-count cap. Deliberately separate from
    // supportChat.errorKey — that ref belongs to the composable and this
    // component only ever reads it, never writes it.
    const tooManyFilesNotice = ref(false);

    function attachKey(messageId: number, attachmentId: number): string {
      return `${messageId}:${attachmentId}`;
    }

    function attachmentFailed(messageId: number, attachmentId: number): boolean {
      return attachErrored.value.includes(attachKey(messageId, attachmentId));
    }

    function onAttachImgError(messageId: number, attachmentId: number): void {
      const key = attachKey(messageId, attachmentId);
      if (!attachErrored.value.includes(key)) attachErrored.value.push(key);
    }

    function middleTruncate(name: string, max = 24): string {
      if (name.length <= max) return name;
      const keep = max - 1; // reserve one char for the ellipsis
      const head = Math.ceil(keep / 2);
      const tail = keep - head;
      return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
    }

    // Prefers the real filename (added to the frozen contract after this was
    // first built) over the derived extension/fileType label, since it's more
    // useful and matches what a native file picker would show. Falls back to
    // the extension/fileType derivation when fileName is absent — some
    // sources (e.g. older Chatwoot attachments) never had one.
    function attachmentLabel(a: SupportAttachment): string {
      if (a.fileName) return middleTruncate(a.fileName);
      const ext = (a.extension || '').replace(/^\./, '').toUpperCase();
      return ext || a.fileType;
    }

    // A shared `humanFileSize` filter already exists (src/shared/utils/filters.ts,
    // used by TransactionDetails.vue) but is deliberately not reused here: it
    // defaults to SI units (1000-based kB/MB/...) and renders '—' for a null
    // value. Attachment sizes want binary units (1024-based KB/MB, matching
    // what OS file pickers show) and a missing fileSize is simply omitted
    // (`v-if="a.fileSize"`), never shown as an em-dash — different enough
    // rendering that reusing it would change behavior, not just call sites.
    function formatAttachmentSize(bytes?: number): string {
      if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      const kb = bytes / 1024;
      // Roll over at >= 1000 of the CURRENT unit, not at the raw 1024*1024
      // byte boundary — otherwise e.g. 1048575 B (1 byte short of 1 MiB)
      // renders as "1024.0 KB" instead of "1.0 MB".
      if (kb < 1000) return `${kb.toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function triggerFilePicker(): void {
      fileInputRef.value?.click();
    }

    function onFilesPicked(event: Event): void {
      const input = event.target as HTMLInputElement;
      const picked = input.files ? Array.from(input.files) : [];
      input.value = ''; // allow re-picking the same file(s) later
      if (!picked.length) return;
      const combined = [...pendingFiles.value, ...picked];
      if (combined.length > MAX_PENDING_FILES) {
        pendingFiles.value = combined.slice(0, MAX_PENDING_FILES);
        tooManyFilesNotice.value = true;
      } else {
        pendingFiles.value = combined;
        tooManyFilesNotice.value = false;
      }
    }

    function removePendingFile(index: number): void {
      pendingFiles.value.splice(index, 1);
      tooManyFilesNotice.value = false;
    }

    // Everything support-related is gated behind the live-chat flag: `mode` can
    // only ever flip to 'support' via UI this flag hides (the header toggle and
    // the escalation chip). But the flag can drop at RUNTIME (a live gero-sync
    // push) while `mode` is still latently 'support' from before it did, so `mode`
    // alone is not "what's on screen" — `activeMode` is, and every branch below
    // reads it instead of re-deriving `mode === 'support' && liveChatEnabled.value`.
    // That is what makes flag-off leave the dock's rendered output and behavior
    // identical to before this feature existed, and makes a mid-session flip
    // incapable of leaving the dock half-rendered in support state.
    const liveChatEnabled = computed(() => featureFlagsStore.isLiveChatEnabled());
    // Gates the Assistant (AI chat + proactive feed) tab, independent of
    // liveChatEnabled — see featureFlagsStore.isCopilotEnabled's doc block for
    // the full mount-gate matrix this and liveChatEnabled together produce.
    const copilotEnabled = computed(() => featureFlagsStore.isCopilotEnabled());
    // Support-first: the dock opens on the Support tab by default whenever the
    // toggle exists. `mode` only ever moves to 'copilot' through UI activeMode
    // gates when copilotEnabled is off (the toggle renders that segment
    // disabled), so a copilot-off session can never actually land there.
    const mode = ref<DockMode>('support');
    // Live-chat-off is byte-identical to the dock's pre-support-chat existence:
    // always 'copilot', regardless of `mode`/copilotEnabled. Live-chat-on with
    // the Assistant tab off (copilotEnabled false) forces 'support' even if
    // `mode` is latently 'copilot' from a prior copilotEnabled=true session, so
    // a runtime flag drop can't strand the dock on a now-disabled tab.
    const activeMode = computed<DockMode>(() => {
      if (!liveChatEnabled.value) return 'copilot';
      return copilotEnabled.value ? mode.value : 'support';
    });

    function enterCopilotMode(): void {
      // Belt-and-suspenders alongside the toggle button's real `disabled`
      // attribute: a disabled native button already blocks user-driven clicks,
      // but this guard keeps the guarantee even if something else ever calls
      // this function directly (e.g. a future keyboard shortcut).
      if (!copilotEnabled.value) return;
      mode.value = 'copilot';
    }

    function enterSupportMode(): void {
      // The auto-enter watcher below is the SOLE supportChat.enter() trigger —
      // it reacts to this assignment (activeMode flips to 'support') and
      // covers this click along with every other path into Support. This
      // function does not call enter() itself: it used to, but that made a
      // single click call enter() twice (this direct call plus the watcher),
      // and the composable's idempotency guard can't short-circuit a call
      // that's still mid-flight from the first one — so every toggle click
      // was firing a redundant loadHistory REST round-trip.
      mode.value = 'support';
    }

    // The support thread counts as "seen" whenever it is the visible content of
    // an open dock — covers switching into support mode, re-opening the dock
    // while already in support mode, and new unread messages arriving while it's
    // on screen (keyed on `unread`, not message count, so a same-length mutation —
    // e.g. an existing message's status changing — still clears the badge).
    // The getter only reads supportChat.unread when support is actually active, so
    // with the flag off (or in copilot mode) this watcher never subscribes to the
    // singleton's refs at all.
    watch(
      () =>
        activeMode.value === 'support'
          ? [activeMode.value, dock.isOpen.value, supportChat.unread.value]
          : [activeMode.value, dock.isOpen.value],
      () => {
        if (activeMode.value === 'support' && dock.isOpen.value) {
          supportChat.markSeen();
        }
      },
    );

    // Kicks off (or resumes) the live connection whenever Support is the
    // ACTIVE, VISIBLE content of an OPEN dock — not just on an explicit toggle
    // click. Support-first means a returning user can land here without ever
    // clicking anything (the default `mode`, or a runtime copilotEnabled drop
    // forcing `activeMode` to 'support'), and without this watcher that user's
    // history would never load until they happened to interact. `immediate:
    // true` covers the case where the dock is already open in Support the
    // moment this component mounts; the reactive watch covers the FAB later
    // opening into that same default, a runtime flag flip, and toggle/chip
    // switches. This is the ONLY supportChat.enter() trigger — enterSupportMode()
    // above deliberately does not call it too: enter()'s idempotency guard
    // (see useSupportChat.ts) can't short-circuit a call that's still
    // mid-flight from a first one, so a direct call alongside this watcher
    // was firing loadHistory twice per toggle click, not harmlessly deduping.
    // Guarded exactly like the markSeen watcher above: no supportChat ref is
    // read here, so flag-off never reads into the singleton either.
    watch(
      () => [activeMode.value, dock.isOpen.value],
      () => {
        if (activeMode.value === 'support' && dock.isOpen.value) {
          void supportChat.enter().catch((err: unknown) => debugWarn('[AgentDock] supportChat.enter() failed', err));
        }
      },
      { immediate: true },
    );

    // Single source for the header status text (and the support empty-state's
    // status line, which shows the same connection state) — copilot's
    // thinking/ready pair outside support mode, the live-chat connection state inside it.
    const statusKey = computed(() => {
      if (activeMode.value === 'support') {
        const state = supportChat.connectionState.value;
        if (state === 'connecting') return 'common.connecting';
        if (state === 'reconnecting') return 'support.status.reconnecting';
        if (state === 'unavailable') return 'support.status.unavailable';
        return 'support.status.ready'; // 'connected' or 'idle'
      }
      return dock.busy.value ? 'copilot.status.thinking' : 'copilot.status.ready';
    });

    const sendDisabled = computed(() =>
      activeMode.value === 'support' ? supportChat.busy.value : dock.busy.value,
    );

    // Single source for the notice banner: the composable's own errorKey
    // (server-side failures) takes priority since it's the more authoritative
    // signal, falling back to the local too-many-files notice. Read (never
    // written) here — see tooManyFilesNotice above for why the count-cap
    // notice stays local instead of writing into errorKey.
    const noticeKey = computed<string | null>(() => {
      if (supportChat.errorKey.value) return supportChat.errorKey.value;
      if (tooManyFilesNotice.value) return 'support.error.tooManyFiles';
      return null;
    });

    const inputPlaceholder = computed(() =>
      activeMode.value === 'support'
        ? (i18n.t('support.placeholder') as string)
        : (i18n.t('copilot.placeholder') as string),
    );

    function agentInitial(agentName?: string): string {
      const name = (agentName || (i18n.t('support.agentFallbackName') as string)).trim();
      // Spread (not .charAt/[0]) so a surrogate-pair agent name (e.g. an emoji)
      // yields a whole character instead of half of one.
      return [...name][0]?.toUpperCase() ?? 'S';
    }

    // Nothing may compete for attention while the user is mid-flow —
    // signing above all. Close the chat panel the instant a sheet opens
    // (the FAB itself just fades out via the is-hidden class below), and
    // reopening it is one tap away once the sheet closes.
    watch(isAnySheetOpen, (open) => {
      if (open && dock.isOpen.value) dock.close();
    });

    async function submit(): Promise<void> {
      if (activeMode.value === 'support') {
        const text = draft.value;
        const files = pendingFiles.value;
        if ((!text.trim() && files.length === 0) || supportChat.busy.value) return;
        // The composable owns the draft (and the pending files) on failure:
        // only clear either once send() confirms the message actually went
        // out, so a dropped connection never silently discards what the user
        // typed or attached. A throwing contract impl is treated the same as
        // a resolved-false send (draft+files kept, no unhandled rejection) —
        // the failure still surfaces via supportChat.errorKey.
        //
        // Called with ONE argument when there are no pending files (not a
        // second `undefined` arg) — send(text) and send(text, undefined) are
        // equivalent to the composable, but keeping the text-only call shape
        // exactly as it was before attachments existed avoids changing the
        // call signature for every existing text-only send.
        let sent = false;
        try {
          sent = files.length ? await supportChat.send(text, [...files]) : await supportChat.send(text);
        } catch (err) {
          debugWarn('[AgentDock] supportChat.send() threw', err);
        }
        if (sent) {
          draft.value = '';
          pendingFiles.value = [];
          tooManyFilesNotice.value = false;
        }
        return;
      }
      const text = draft.value;
      draft.value = '';
      await dock.send(text);
    }

    function quickSend(text: string): void {
      draft.value = text;
      void submit();
    }

    // activeMode is a dep (and the guard's subject) for the same reason it is in
    // the support watcher below: switching INTO a mode must pin that thread to its
    // latest message, not just new messages arriving once already there — so coming
    // BACK to copilot from a long support thread scrolls too. The dock's own refs
    // are read unconditionally, unlike supportChat's: they belong to a singleton
    // this component always uses, in either mode.
    watch(
      () => [activeMode.value, dock.messages.value.length, dock.busy.value],
      () => {
        if (activeMode.value !== 'copilot') return;
        void nextTick(() => {
          const el = scroll.value;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      },
    );

    // Mirrors the watcher above for the support thread, kept separate so the
    // copilot scroll behavior stays independently readable. The difference: this
    // getter only reads supportChat.messages/busy when support is actually
    // active, so flag-off (or copilot mode) never subscribes to the singleton's
    // refs at all.
    watch(
      () =>
        activeMode.value === 'support'
          ? [activeMode.value, supportChat.messages.value.length, supportChat.busy.value]
          : [activeMode.value],
      () => {
        if (activeMode.value !== 'support') return;
        void nextTick(() => {
          const el = scroll.value;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      },
    );

    return {
      draft,
      dock,
      submit,
      quickSend,
      scroll,
      renderMarkdown,
      isAnySheetOpen,
      mode,
      activeMode,
      liveChatEnabled,
      copilotEnabled,
      geroMark,
      supportChat,
      statusKey,
      sendDisabled,
      inputPlaceholder,
      enterCopilotMode,
      enterSupportMode,
      agentInitial,
      noticeKey,
      pendingFiles,
      fileInputRef,
      attachmentFailed,
      onAttachImgError,
      attachmentLabel,
      formatAttachmentSize,
      middleTruncate,
      triggerFilePicker,
      onFilesPicked,
      removePendingFile,
    };
  },
});
</script>

<style scoped>
.agent-dock {
  --surface: var(--g-overlay);
  --surface-border: color-mix(in srgb, var(--g-accent) 22%, transparent);
  --text-primary: var(--g-text-1);
  --text-muted: var(--g-text-3);
  --text-placeholder: var(--g-text-3);
  --accent: var(--g-accent);
  --accent-08: color-mix(in srgb, var(--g-accent) 8%, transparent);
  --accent-12: color-mix(in srgb, var(--g-accent) 12%, transparent);
  --accent-14: color-mix(in srgb, var(--g-accent) 14%, transparent);
  --accent-18: color-mix(in srgb, var(--g-accent) 18%, transparent);
  --accent-30: color-mix(in srgb, var(--g-accent) 30%, transparent);
  --accent-35: color-mix(in srgb, var(--g-accent) 35%, transparent);
  --accent-60: color-mix(in srgb, var(--g-accent) 60%, transparent);
  --accent-80: color-mix(in srgb, var(--g-accent) 80%, transparent);
  --user-bubble-bg: color-mix(in srgb, var(--g-accent) 14%, transparent);
  --asst-bubble-bg: var(--g-hairline-1);
  --asst-bubble-border: var(--g-hairline-1);
  --input-bg: var(--g-hairline-1);
  --input-border: var(--g-hairline-2);
  --divider: var(--g-hairline-1);
  --panel-shadow: var(--g-shadow-menu);
  --fab-bg: var(--g-overlay);
  --fab-shadow: var(--g-shadow-menu);
  --gradient-send: var(--g-grad);
}

/* ── FAB ──────────────────────────────────────────────────────────────── */
.agent-dock__fab {
  position: fixed;
  bottom: 80px;
  right: 16px;
  z-index: var(--g-z-dock);
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  background: var(--fab-bg);
  border: 1.5px solid var(--accent-35);
  box-shadow: var(--fab-shadow);
  transition: box-shadow 150ms ease, border-color 150ms ease;
}

.agent-dock__fab:hover {
  box-shadow: var(--fab-shadow), 0 0 0 3px color-mix(in srgb, var(--g-accent) 20%, transparent);
}

.agent-dock__fab.is-open {
  border: 1.5px solid var(--accent-80);
}

/* Nothing may compete for attention while the user reviews a sheet — most of
   all a signing request. Faded rather than unmounted so it resumes exactly
   where it was the instant the sheet closes. */
.agent-dock__fab.is-hidden {
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

/* Matches the mdi icon's former size="22" so the FAB's footprint is unchanged. */
.agent-dock__fab-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.agent-dock__fab-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--g-accent);
  border: 1px solid var(--fab-bg);
}

/* ── Panel ────────────────────────────────────────────────────────────── */
.agent-dock__panel {
  position: fixed;
  bottom: 140px;
  right: 16px;
  z-index: var(--g-z-dock);
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--g-r-sheet);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--surface-border);
  box-shadow: var(--panel-shadow);
}

.agent-dock__head,
.agent-dock__messages,
.agent-dock__notice,
.agent-dock__input,
.agent-dock__disclaimer {
  position: relative;
  z-index: 1;
}

/* ── Header ───────────────────────────────────────────────────────────── */
.agent-dock__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--g-accent) 6%, transparent);
  border-bottom: 1px solid var(--divider);
}

/* Only applied when the mode toggle renders (liveChatEnabled) — the flag-off
   header keeps the original two-item space-between layout untouched above. */
.agent-dock__head--with-toggle {
  justify-content: flex-start;
  gap: 8px;
}

.agent-dock__head-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.agent-dock__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

/* min-width:0 above lets this actually shrink and truncate instead of forcing
   the 320px header wider/narrower (e.g. a longer connection-status string). */
.agent-dock__status {
  font-size: 11px;
  color: var(--g-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Mode toggle (Copilot / Support) ─────────────────────────────────── */
.agent-dock__mode-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--g-r-pill);
  background: var(--accent-08);
  border: 1px solid var(--divider);
}

.agent-dock__mode-btn {
  position: relative;
  height: 22px;
  padding: 0 8px;
  border: none;
  background: transparent;
  border-radius: var(--g-r-pill);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;
}

.agent-dock__mode-btn.is-active {
  color: var(--g-accent);
  background: var(--accent-14);
}

/* Assistant segment when copilotEnabled is off: visible (discoverable) but not
   interactive. Deliberately a higher opacity than the send/attach buttons'
   own :disabled state (0.35) — this is a TEXT LABEL rather than an icon, and
   0.35 over --g-overlay landed at ~1.6:1 contrast, nearly illegible, which
   fought the "visible so it's discoverable" intent. 0.55 keeps it legible
   while still reading as clearly non-interactive; verified this doesn't move
   scripts/design/audit.mjs's lowAlphaText metric or fail contrast.mjs. */
.agent-dock__mode-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.agent-dock__unread-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--g-accent);
}

.agent-dock__close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--g-r-control);
  cursor: pointer;
  transition: color 150ms ease;
}

/* With the toggle in play the header is a flex-start row (see
   .agent-dock__head--with-toggle above), so the close button needs its own
   push-to-the-end instead of relying on justify-content: space-between. */
.agent-dock__head--with-toggle .agent-dock__close {
  margin-left: auto;
  flex-shrink: 0;
}

.agent-dock__close:hover :deep(.v-icon) {
  color: var(--g-text-1) !important;
}

/* ── Messages ─────────────────────────────────────────────────────────── */
.agent-dock__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-dock__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-dock__messages::-webkit-scrollbar {
  width: 4px;
}

.agent-dock__messages::-webkit-scrollbar-track {
  background: transparent;
}

.agent-dock__messages::-webkit-scrollbar-thumb {
  background: var(--accent-30);
  border-radius: 4px;
}

/* ── Support error banner ─────────────────────────────────────────────── */
/* A sibling of .agent-dock__messages (not nested inside its scroll area) —
   see the template comment where it's placed — so margin (not the messages
   flex-column's gap) provides the spacing on each side. */
.agent-dock__notice {
  flex-shrink: 0;
  margin: 0 12px 10px;
  padding: 8px 10px;
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 12px;
  line-height: 1.5;
}

/* ── Support agent-name caption ───────────────────────────────────────── */
.agent-dock__agent-name {
  display: block;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.agent-dock__msg {
  display: flex;
}

.agent-dock__msg.user {
  justify-content: flex-end;
}

.agent-dock__msg.assistant {
  justify-content: flex-start;
}

.agent-dock__avatar {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-self: flex-start;
  margin-right: 6px;
  margin-top: 2px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--g-accent) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 30%, transparent);
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.agent-dock__bubble {
  max-width: 88%;
}

.agent-dock__msg.user .agent-dock__bubble {
  background: var(--user-bubble-bg);
  border: 1px solid var(--accent-35);
  border-radius: var(--g-r-sheet) var(--g-r-sheet) var(--g-r-chip) var(--g-r-sheet);
  padding: 9px 13px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}

.agent-dock__msg.assistant .agent-dock__bubble {
  background: var(--asst-bubble-bg);
  border: 1px solid var(--asst-bubble-border);
  border-radius: var(--g-r-chip) var(--g-r-sheet) var(--g-r-sheet) var(--g-r-sheet);
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}

.agent-dock__text {
  margin: 0;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ── Rendered markdown (assistant replies; v-html, so children need :deep) ─ */
.agent-dock__md {
  margin: 0;
  word-break: break-word;
}

.agent-dock__md :deep(p) {
  margin: 0 0 8px;
}

.agent-dock__md :deep(p:last-child) {
  margin-bottom: 0;
}

.agent-dock__md :deep(strong) {
  font-weight: 700;
  color: var(--g-text-1);
}

.agent-dock__md :deep(ul),
.agent-dock__md :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 18px;
}

.agent-dock__md :deep(ul:last-child),
.agent-dock__md :deep(ol:last-child) {
  margin-bottom: 0;
}

.agent-dock__md :deep(li) {
  margin: 3px 0;
}

.agent-dock__md :deep(li::marker) {
  color: var(--accent-60);
}

.agent-dock__md :deep(code) {
  font-family: var(--g-font-mono);
  font-size: 12px;
  background: var(--accent-12);
  color: var(--g-accent);
  padding: 1px 5px;
  border-radius: var(--g-r-chip);
  word-break: break-all;
}

.agent-dock__md :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-dock__md :deep(.md-h) {
  font-weight: 700;
  color: var(--g-text-1);
  margin: 8px 0 4px;
}

.agent-dock__md :deep(.md-h:first-child) {
  margin-top: 0;
}

.agent-dock__md :deep(.md-h1) {
  font-size: 16px;
}

.agent-dock__md :deep(.md-h2) {
  font-size: 14px;
}

.agent-dock__md :deep(.md-h3) {
  font-size: 13px;
}

.agent-dock__card {
  margin-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--g-accent) 12%, transparent);
  padding-top: 8px;
}

/* ── Support attachment bubbles ───────────────────────────────────────── */
.agent-dock__attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.agent-dock__attach-img {
  display: block;
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
}

.agent-dock__attach-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--text-primary);
  text-decoration: none;
  font-size: 12px;
}

.agent-dock__attach-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.agent-dock__attach-size {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ── Thinking indicator ───────────────────────────────────────────────── */
.agent-dock__busy {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--asst-bubble-bg);
  border: 1px solid var(--asst-bubble-border);
  border-radius: var(--g-r-chip) var(--g-r-sheet) var(--g-r-sheet) var(--g-r-sheet);
  padding: 10px 14px;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--g-accent);
  display: inline-block;
  margin: 0 2px;
  animation: dot-pulse 1.1s ease-in-out infinite;
}

.dot:nth-child(2) {
  animation-delay: 160ms;
}

.dot:nth-child(3) {
  animation-delay: 320ms;
}

@keyframes dot-pulse {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  30% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* ── Empty state ──────────────────────────────────────────────────────── */
.agent-dock__empty {
  padding: 8px 6px 4px;
  animation: msg-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.agent-dock__empty-orb {
  width: 32px;
  height: 32px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--accent-12);
  border: 1px solid var(--accent-30);
  font-size: 16px;
  font-weight: 700;
  color: var(--g-accent);
  line-height: 32px;
  text-align: center;
}

.agent-dock__empty-h {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  text-align: center;
}

.agent-dock__empty-sub {
  font-size: 12px;
  color: var(--g-text-2);
  margin: 0;
  text-align: center;
}

.agent-dock__empty-status {
  font-size: 11px;
  color: var(--g-accent);
  margin: 10px 0 0;
  text-align: center;
}

.agent-dock__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 16px;
}

.chip {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  background: var(--accent-08);
  border: 1px solid var(--accent-30);
  font-size: 11px;
  font-weight: 500;
  color: var(--g-accent);
  cursor: pointer;
  transition: background 120ms ease;
}

.chip:hover {
  background: var(--accent-18);
}

/* ── Input footer ─────────────────────────────────────────────────────── */
.agent-dock__input {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid var(--divider);
  background: transparent;
}

.agent-dock__input--notice {
  justify-content: center;
}

.agent-dock__unavailable {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.agent-dock__input input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  caret-color: var(--accent);
  outline: none;
  transition: border-color 180ms ease;
}

.agent-dock__input input::placeholder {
  color: var(--text-placeholder);
}

.agent-dock__input input:focus {
  border-color: var(--accent-60);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-accent) 15%, transparent);
}

.agent-dock__send {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-control);
  border: none;
  cursor: pointer;
  background: var(--gradient-send);
  transition: opacity 150ms ease, box-shadow 150ms ease;
}

.agent-dock__send:disabled {
  opacity: 0.35;
  cursor: default;
}

.agent-dock__send:hover:not(:disabled) {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-accent) 25%, transparent);
}

/* ── Attach picker (Support mode only) ───────────────────────────────── */
.agent-dock__attach-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-control);
  border: 1px solid var(--input-border);
  background: transparent;
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease;
}

.agent-dock__attach-btn:hover:not(:disabled) {
  border-color: var(--accent-60);
}

.agent-dock__attach-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.agent-dock__file-input {
  display: none;
}

/* ── Pending attachment chips ─────────────────────────────────────────── */
.agent-dock__pending {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 12px 8px;
}

.agent-dock__pending-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px 5px 10px;
  border-radius: var(--g-r-chip);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  font-size: 11px;
  color: var(--text-primary);
}

/* Truncation is done in JS (middleTruncate — deterministic and
   extension-preserving); no CSS overflow/max-width here, or the two would
   fight and the chip could double-truncate an already-short string. */
.agent-dock__pending-name {
  white-space: nowrap;
}

.agent-dock__pending-size {
  color: var(--text-muted);
  flex-shrink: 0;
}

.agent-dock__pending-remove {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
}

.agent-dock__pending-remove:hover {
  background: var(--accent-14);
}

/* ── Disclaimer ───────────────────────────────────────────────────────── */
.agent-dock__disclaimer {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 14px 10px;
  margin: 0;
  text-align: center;
}

/* ── Panel open/close transition ──────────────────────────────────────── */
.dock-panel-enter-active {
  animation: panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.dock-panel-leave-active {
  animation: panel-out 160ms cubic-bezier(0.4, 0, 1, 1) both;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes panel-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

/* ── Message entrance transition ──────────────────────────────────────── */
.msg-enter-active {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.msg-enter {
  opacity: 0;
}

.agent-dock__msg.assistant.msg-enter {
  transform: translateX(-16px);
}

.agent-dock__msg.user.msg-enter {
  transform: translateX(16px);
}

.msg-enter-to {
  transform: translateX(0);
  opacity: 1;
}
</style>
