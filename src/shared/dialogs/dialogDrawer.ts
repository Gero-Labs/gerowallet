import type { InjectionKey, Ref } from 'vue';

/** Width of a drawer beside a dialog, and the gap between them, in pixels (mirrored in BaseDialog's styles). */
export const DIALOG_DRAWER_WIDTH = 320;
export const DIALOG_DRAWER_GAP = 12;

/**
 * What BaseDialog offers a DialogDrawer inside it: the element beside its right edge that
 * the drawer opens into, whether the window has room for both side by side, and a count of
 * open drawers, so the dialog moves aside to keep the pair centred.
 */
export interface DialogDrawerHost {
  el: Ref<HTMLElement | null>;
  roomBeside: Ref<boolean>;
  setOpen: (id: symbol, open: boolean) => void;
}

export const DIALOG_DRAWER_HOST: InjectionKey<DialogDrawerHost> = Symbol('dialogDrawerHost');
