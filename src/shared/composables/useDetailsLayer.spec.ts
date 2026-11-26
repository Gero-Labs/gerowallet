import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';

type Module = typeof import('./useDetailsLayer');

// The layer keeps module state (the remembered toggles, the shared peek and its
// listeners), so every test loads a fresh copy.
let mod: Module;
const scopes: EffectScope[] = [];

function use(screen: string) {
  const scope = effectScope();
  scopes.push(scope);
  const layer = scope.run(() => mod.useDetailsLayer(screen))!;
  return { layer, scope };
}

function key(type: 'keydown' | 'keyup', name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  mod = await import('./useDetailsLayer');
});

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.restoreAllMocks();
});

describe('useDetailsLayer: the toggle', () => {
  it('starts on the simple layer and toggles the technical layer on and off', () => {
    const { layer } = use('gerovault.overview');
    expect(layer.enabled.value).toBe(false);
    expect(layer.visible.value).toBe(false);

    layer.toggle();
    expect(layer.enabled.value).toBe(true);
    expect(layer.visible.value).toBe(true);

    layer.enabled.value = false;
    expect(layer.visible.value).toBe(false);
  });

  it('keeps the toggle per screen and remembers it for the next visit', async () => {
    use('gerovault.overview').layer.toggle();
    expect(use('gerovault.vault').layer.enabled.value).toBe(false);
    expect(JSON.parse(localStorage.getItem(mod.DETAILS_LAYER_STORAGE_KEY)!)).toEqual({ 'gerovault.overview': true });

    // A new page load reads it back.
    vi.resetModules();
    mod = await import('./useDetailsLayer');
    expect(use('gerovault.overview').layer.enabled.value).toBe(true);
    expect(use('gerovault.vault').layer.enabled.value).toBe(false);
  });

  it('shares one screen\'s toggle between the components that use it', () => {
    const page = use('gerovault.vault').layer;
    const toggle = use('gerovault.vault').layer;
    toggle.enabled.value = true;
    expect(page.visible.value).toBe(true);
  });

  it('starts every screen on the simple layer when the stored value is unreadable', async () => {
    localStorage.setItem(mod.DETAILS_LAYER_STORAGE_KEY, '{not json');
    vi.resetModules();
    mod = await import('./useDetailsLayer');
    expect(use('gerovault.overview').layer.enabled.value).toBe(false);

    localStorage.setItem(mod.DETAILS_LAYER_STORAGE_KEY, JSON.stringify({ 'gerovault.overview': 'yes', 'gerovault.vault': true }));
    vi.resetModules();
    mod = await import('./useDetailsLayer');
    expect(use('gerovault.overview').layer.enabled.value).toBe(false);
    expect(use('gerovault.vault').layer.enabled.value).toBe(true);
  });

  it('still toggles when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { layer } = use('gerovault.overview');
    layer.toggle();
    expect(layer.visible.value).toBe(true);
  });
});

describe('useDetailsLayer: peeking with Alt', () => {
  it('shows the technical layer while Alt is held and hides it on release', () => {
    const { layer } = use('gerovault.overview');
    key('keydown', 'Alt');
    expect(layer.peeking.value).toBe(true);
    expect(layer.visible.value).toBe(true);
    expect(layer.enabled.value).toBe(false);

    key('keydown', 'Alt', { repeat: true });
    expect(layer.visible.value).toBe(true);

    key('keyup', 'Alt');
    expect(layer.peeking.value).toBe(false);
    expect(layer.visible.value).toBe(false);
  });

  it('keeps the technical layer on after a peek when the toggle is on', () => {
    const { layer } = use('gerovault.overview');
    layer.enabled.value = true;
    key('keydown', 'Alt');
    key('keyup', 'Alt');
    expect(layer.visible.value).toBe(true);
  });

  it('ends the peek when the window loses focus or the page is hidden', () => {
    const { layer } = use('gerovault.overview');
    key('keydown', 'Alt');
    window.dispatchEvent(new Event('blur'));
    expect(layer.peeking.value).toBe(false);

    key('keydown', 'Alt');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(layer.peeking.value).toBe(false);
    visibility.mockRestore();
  });

  it('keeps the browser from taking focus on a bare Alt, and leaves other keys alone', () => {
    use('gerovault.overview');
    expect(key('keydown', 'Alt').defaultPrevented).toBe(true);
    expect(key('keyup', 'Alt').defaultPrevented).toBe(true);
    // AltGr types characters on many layouts; it is not a peek.
    expect(key('keydown', 'AltGraph').defaultPrevented).toBe(false);
    expect(key('keydown', 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
    expect(key('keydown', 'a').defaultPrevented).toBe(false);
  });

  it('does not peek on AltGr', () => {
    const { layer } = use('gerovault.overview');
    key('keydown', 'AltGraph');
    expect(layer.peeking.value).toBe(false);
  });

  it('shares one peek between screens and listens only while a screen holds the layer', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const first = use('gerovault.overview');
    const second = use('gerovault.vault');
    expect(add.mock.calls.filter(([type]) => String(type) === 'keydown')).toHaveLength(1);

    key('keydown', 'Alt');
    expect(second.layer.visible.value).toBe(true);

    first.scope.stop();
    expect(remove.mock.calls.filter(([type]) => String(type) === 'keydown')).toHaveLength(0);
    expect(second.layer.peeking.value).toBe(true);

    second.scope.stop();
    expect(remove.mock.calls.filter(([type]) => String(type) === 'keydown')).toHaveLength(1);
    // No screen left: a bare Alt is the browser's again, and a held peek is over.
    expect(key('keydown', 'Alt').defaultPrevented).toBe(false);
    expect(second.layer.peeking.value).toBe(false);
  });
});
