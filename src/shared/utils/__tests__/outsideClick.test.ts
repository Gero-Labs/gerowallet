import { describe, it, expect, beforeEach } from 'vitest';
import { isClickInsidePanel } from '../outsideClick';

const PANEL = '.token-detail-panel';

function evt(target: EventTarget | null) {
  return { target, composedPath: () => (target ? [target] : []) };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div data-app>
      <div class="page">
        <button id="elsewhere">elsewhere</button>
        <div class="token-detail-panel">
          <gero-swap><button id="swap-btn">Swap</button></gero-swap>
        </div>
      </div>
    </div>
  `;
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

describe('isClickInsidePanel', () => {
  it('treats a click inside the panel as inside', () => {
    expect(isClickInsidePanel(evt($('#swap-btn')), PANEL)).toBe(true);
  });

  it('treats an unrelated click as outside', () => {
    expect(isClickInsidePanel(evt($('#elsewhere')), PANEL)).toBe(false);
  });

  // <gero-swap> is registered with shadowRoot:false, so its Vuetify 3 overlays teleport
  // to document.body > .v-overlay-container — outside the panel's subtree.
  it('treats a click in the widget overlay container as inside', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="v-overlay-container"><div class="v-overlay"><button id="confirm">Confirm</button></div></div>',
    );
    expect(isClickInsidePanel(evt($('#confirm')), PANEL)).toBe(true);
  });

  // Vuetify 2 v-dialog detaches its content to [data-app] — this is how the embed's
  // spending-password / PassKey / Keystone prompts render.
  it('treats a click in a detached Vuetify 2 dialog as inside', () => {
    $('[data-app]').insertAdjacentHTML(
      'beforeend',
      '<div class="v-dialog__content"><div class="v-dialog"><input id="pw" type="password" /></div></div>',
    );
    expect(isClickInsidePanel(evt($('#pw')), PANEL)).toBe(true);
  });

  it('treats a click in a detached v-menu as inside', () => {
    $('[data-app]').insertAdjacentHTML(
      'beforeend',
      '<div class="v-menu__content"><div id="menu-item">Slippage</div></div>',
    );
    expect(isClickInsidePanel(evt($('#menu-item')), PANEL)).toBe(true);
  });

  // A global toast is unrelated chrome — clicking it must still close the panel.
  it('treats a click in a snackbar as outside', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="v-snack"><button id="snack-action">Undo</button></div>',
    );
    expect(isClickInsidePanel(evt($('#snack-action')), PANEL)).toBe(false);
  });

  // The widget re-renders the clicked node in its own handler, so by the time the event
  // reaches the document listener the target is detached and contains() says "outside".
  it('treats a detached target as inside when nothing better is known', () => {
    const gone = document.createElement('button');
    expect(isClickInsidePanel(evt(gone), PANEL)).toBe(true);
  });

  it('treats a null target as inside', () => {
    expect(isClickInsidePanel({ target: null, composedPath: () => [] }, PANEL)).toBe(true);
  });

  // The pointerdown-captured node is attached before any click handler re-renders,
  // so it can arbitrate detached click targets in both directions.
  it('closes on a detached target when the pressed node was attached outside', () => {
    const gone = document.createElement('button');
    expect(isClickInsidePanel(evt(gone), PANEL, document, $('#elsewhere'))).toBe(false);
  });

  it('stays open on a detached target when the pressed node was inside the panel', () => {
    const gone = document.createElement('button');
    expect(isClickInsidePanel(evt(gone), PANEL, document, $('#swap-btn'))).toBe(true);
  });

  it('stays open when both the target and the pressed node are detached', () => {
    const gone = document.createElement('button');
    const alsoGone = document.createElement('button');
    expect(isClickInsidePanel(evt(gone), PANEL, document, alsoGone)).toBe(true);
  });

  it('falls back to target when composedPath is unavailable', () => {
    expect(isClickInsidePanel({ target: $('#swap-btn') }, PANEL)).toBe(true);
    expect(isClickInsidePanel({ target: $('#elsewhere') }, PANEL)).toBe(false);
  });

  it('still reports outside when the panel is not in the DOM', () => {
    $(PANEL).remove();
    expect(isClickInsidePanel(evt($('#elsewhere')), PANEL)).toBe(false);
  });
});
