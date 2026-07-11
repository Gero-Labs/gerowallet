import { ref, computed } from 'vue';

// Shared across every BottomSheet instance in the panel: how many are
// currently open. Lets other chrome (AgentDock's FAB) know to get out of the
// way while ANY sheet is open — nothing should compete for attention while
// the user is mid-flow, and this matters most of all during signing.
const openSheetCount = ref(0);

export function useSheetVisibility() {
  return {
    isAnySheetOpen: computed(() => openSheetCount.value > 0),
    markSheetOpened() { openSheetCount.value += 1; },
    markSheetClosed() { openSheetCount.value = Math.max(0, openSheetCount.value - 1); },
  };
}
