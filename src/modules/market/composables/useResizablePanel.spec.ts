import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NAV_DRAWER_WIDTH,
  PANEL_KEY_STEP,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
  maxPanelWidth,
  useResizablePanel,
} from './useResizablePanel';

const STORAGE_KEY = 'gero.tokenDetailPanel.width';
const VIEWPORT = 1440;
const MAX = VIEWPORT - NAV_DRAWER_WIDTH;

/** A handle inside a panel of the given rendered width. */
function handleIn(panelWidth: number): HTMLElement {
  const panel = document.createElement('div');
  panel.getBoundingClientRect = () => ({ width: panelWidth } as DOMRect);
  const handle = document.createElement('div');
  handle.setPointerCapture = () => undefined;
  panel.appendChild(handle);
  return handle;
}

function pointer(type: string, clientX: number, target: HTMLElement, button = 0): PointerEvent {
  const event = new MouseEvent(type, { clientX, button }) as unknown as PointerEvent;
  Object.defineProperty(event, 'currentTarget', { value: target });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function key(name: string, target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
  Object.defineProperty(event, 'currentTarget', { value: target });
  return event;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: VIEWPORT, configurable: true });
});

afterEach(() => localStorage.clear());

describe('clampPanelWidth', () => {
  it('keeps a width between the minimum and the area beside the nav drawer', () => {
    expect(clampPanelWidth(100, VIEWPORT)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(900, VIEWPORT)).toBe(900);
    expect(clampPanelWidth(5000, VIEWPORT)).toBe(MAX);
  });

  it('never goes below the minimum on a narrow window', () => {
    expect(clampPanelWidth(900, 600)).toBe(PANEL_MIN_WIDTH);
  });

  it('reports the maximum the handle can reach', () => {
    expect(maxPanelWidth(VIEWPORT)).toBe(MAX);
    expect(maxPanelWidth(600)).toBe(PANEL_MIN_WIDTH);
  });
});

describe('useResizablePanel', () => {
  it('starts at the CSS default with no saved width', () => {
    const panel = useResizablePanel();
    expect(panel.width.value).toBeNull();
    expect(panel.panelStyle.value).toEqual({});
  });

  it('widens when the left-edge handle is dragged left, and remembers the width', () => {
    const panel = useResizablePanel();
    const handle = handleIn(800);
    panel.startResize(pointer('pointerdown', 500, handle));
    expect(panel.resizing.value).toBe(true);
    panel.moveResize(pointer('pointermove', 300, handle));
    expect(panel.width.value).toBe(1000);
    panel.endResize();
    expect(panel.resizing.value).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1000');
    expect(panel.panelStyle.value).toEqual({ width: `min(1000px, calc(100vw - ${NAV_DRAWER_WIDTH}px))` });
    expect(useResizablePanel().width.value).toBe(1000);
  });

  it('clamps a drag to the minimum and to the content area', () => {
    const panel = useResizablePanel();
    const handle = handleIn(800);
    panel.startResize(pointer('pointerdown', 500, handle));
    panel.moveResize(pointer('pointermove', 1400, handle));
    expect(panel.width.value).toBe(PANEL_MIN_WIDTH);
    panel.moveResize(pointer('pointermove', -2000, handle));
    expect(panel.width.value).toBe(MAX);
  });

  it('ignores pointer moves outside a drag and non-primary buttons', () => {
    const panel = useResizablePanel();
    const handle = handleIn(800);
    panel.moveResize(pointer('pointermove', 100, handle));
    panel.startResize(pointer('pointerdown', 500, handle, 2));
    expect(panel.resizing.value).toBe(false);
    expect(panel.width.value).toBeNull();
  });

  it('resizes from the keyboard and Home restores the default', () => {
    const panel = useResizablePanel();
    const handle = handleIn(800);
    panel.resizeByKey(key('ArrowLeft', handle));
    expect(panel.width.value).toBe(800 + PANEL_KEY_STEP);
    panel.resizeByKey(key('ArrowRight', handle));
    expect(panel.width.value).toBe(800);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('800');
    panel.resizeByKey(key('Home', handle));
    expect(panel.width.value).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('leaves other keys alone', () => {
    const panel = useResizablePanel();
    const event = key('Tab', handleIn(800));
    panel.resizeByKey(event);
    expect(event.defaultPrevented).toBe(false);
    expect(panel.width.value).toBeNull();
  });

  it('ignores an unreadable saved width', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-number');
    expect(useResizablePanel().width.value).toBeNull();
  });
});
