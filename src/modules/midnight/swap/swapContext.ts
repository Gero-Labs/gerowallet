import { inject, provide, type InjectionKey } from 'vue';
import { useMidnightSwap } from './useMidnightSwap';

export type MidnightSwapContext = ReturnType<typeof useMidnightSwap>;

const KEY: InjectionKey<MidnightSwapContext> = Symbol('midnightSwap');

/** Create the swap state once per page and share it with the swap components below. */
export function provideMidnightSwap(): MidnightSwapContext {
  const context = useMidnightSwap();
  provide(KEY, context);
  return context;
}

export function injectMidnightSwap(): MidnightSwapContext {
  const context = inject(KEY);
  if (!context) throw new Error('The Midnight swap components need provideMidnightSwap() above them');
  return context;
}
