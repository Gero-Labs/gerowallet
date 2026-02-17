import Vue from 'vue';

type QuickActionDialog = 'BUY' | 'SEND' | 'RECEIVE' | 'SWAP' | 'PERPETUALS' | null;

// Vue.observable ensures reactivity works across component boundaries (Vue 2 pattern)
const state = Vue.observable({ activeDialog: null as QuickActionDialog });

export function useQuickActionDialogs() {
  const openDialog = (dialog: QuickActionDialog) => {
    state.activeDialog = dialog;
  };

  const closeDialog = () => {
    state.activeDialog = null;
  };

  const openBuyDialog = () => openDialog('BUY');
  const openSendDialog = () => openDialog('SEND');
  const openReceiveDialog = () => openDialog('RECEIVE');
  const openSwapDialog = () => openDialog('SWAP');

  return {
    state,
    openDialog,
    closeDialog,
    openBuyDialog,
    openSendDialog,
    openReceiveDialog,
    openSwapDialog,
  };
}