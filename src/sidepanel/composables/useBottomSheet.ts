import { ref } from 'vue';

export function useBottomSheet() {
  const isOpen = ref(false);
  const isAnimating = ref(false);

  function open() {
    isOpen.value = true;
    isAnimating.value = true;
    setTimeout(() => {
      isAnimating.value = false;
    }, 300);
  }

  function close() {
    isAnimating.value = true;
    setTimeout(() => {
      isOpen.value = false;
      isAnimating.value = false;
    }, 300);
  }

  return { isOpen, isAnimating, open, close };
}
