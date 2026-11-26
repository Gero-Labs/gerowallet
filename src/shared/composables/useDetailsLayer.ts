import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  onActivated,
  onDeactivated,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  type ComputedRef,
  type Ref,
  type WritableComputedRef,
} from 'vue';

/**
 * The Details layer: a screen shows its simple layer by default and its technical
 * layer (addresses, key hashes, derivation paths, state versions) on demand.
 *
 * Two ways in:
 * - the toggle, kept per screen (a screen key) for the next visit;
 * - a transient peek while Alt (Option on a Mac) is held. Releasing Alt hides it
 *   again, and losing window focus (Alt+Tab, a click in another window) ends it,
 *   so a peek never outlives the key press that started it.
 *
 * While any screen using the layer is shown, a bare Alt press has its default
 * prevented: on Windows and Linux, pressing and releasing Alt alone moves focus to
 * the browser's menu, which would take keyboard focus off the page mid-peek. Alt
 * chords (Alt+Left and the like) are untouched, and AltGr (key "AltGraph") is not
 * Alt, so typing with it is unaffected.
 *
 * The peek and the keyboard listeners are shared by every user on the page: the
 * listeners are added once, while at least one active component holds the layer,
 * and removed when the last one is unmounted or kept alive off screen.
 */

/** localStorage key of the per-screen toggle state: a JSON object of screen key to boolean. */
export const DETAILS_LAYER_STORAGE_KEY = 'gero.detailsLayer.v1';

const toggles = reactive<Record<string, boolean>>({});
let loaded = false;
const peeking = ref(false);
let holders = 0;

function loadToggles(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(DETAILS_LAYER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    for (const [screen, on] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof on === 'boolean') toggles[screen] = on;
    }
  } catch {
    // Unreadable or unavailable storage: every screen starts on its simple layer.
  }
}

function saveToggles(): void {
  try {
    localStorage.setItem(DETAILS_LAYER_STORAGE_KEY, JSON.stringify(toggles));
  } catch {
    // The toggle still works for this page; it is just not remembered.
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Alt') return;
  event.preventDefault();
  peeking.value = true;
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key !== 'Alt') return;
  event.preventDefault();
  peeking.value = false;
}

function endPeek(): void {
  peeking.value = false;
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') endPeek();
}

function acquire(): void {
  holders += 1;
  if (holders !== 1 || typeof window === 'undefined') return;
  // Capture phase: a component that stops propagation must not leave a peek stuck on.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', endPeek);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function release(): void {
  if (holders === 0) return;
  holders -= 1;
  if (holders !== 0) return;
  endPeek();
  if (typeof window === 'undefined') return;
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('blur', endPeek);
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

export interface DetailsLayer {
  /** The screen's toggle, remembered for the next visit. Bind the toggle's v-model to it. */
  enabled: WritableComputedRef<boolean>;
  /** True while Alt is held. Not remembered. */
  peeking: Readonly<Ref<boolean>>;
  /** Show the technical layer: the toggle is on, or a peek is in progress. */
  visible: ComputedRef<boolean>;
  toggle(): void;
}

/**
 * The Details layer of one screen. Call it in a component's setup (or an effect
 * scope); `screen` names the screen whose toggle is remembered, for example
 * `gerovault.overview`.
 */
export function useDetailsLayer(screen: string): DetailsLayer {
  loadToggles();

  let held = false;
  const hold = (): void => {
    if (held) return;
    held = true;
    acquire();
  };
  const drop = (): void => {
    if (!held) return;
    held = false;
    release();
  };

  hold();
  if (getCurrentInstance()) {
    // A page kept alive off screen must not keep swallowing Alt on other pages.
    onActivated(hold);
    onDeactivated(drop);
  }
  if (getCurrentScope()) onScopeDispose(drop);

  const enabled = computed<boolean>({
    get: () => toggles[screen] === true,
    set: (value: boolean) => {
      toggles[screen] = value;
      saveToggles();
    },
  });

  return {
    enabled,
    peeking: readonly(peeking),
    visible: computed(() => enabled.value || peeking.value),
    toggle: () => {
      enabled.value = !enabled.value;
    },
  };
}
