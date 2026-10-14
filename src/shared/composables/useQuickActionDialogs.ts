import { reactive } from 'vue';

export type QuickActionDialog ='BUY' | 'SEND' | 'RECEIVE' | 'SWAP' | 'PERPETUALS' | null;

const state = reactive({ activeDialog: null as QuickActionDialog });

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
