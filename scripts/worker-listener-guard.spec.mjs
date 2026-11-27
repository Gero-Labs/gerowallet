import { describe, expect, it } from 'vitest';
import { analyseWorkerListeners } from './worker-listener-guard.mjs';

/**
 * Shapes taken from the real background bundle: rollup-plugin-tla's async iife,
 * the wasm `await __vite__initWasm(...)`, and terser's `!function f(){…}()`
 * inlining of a single-use function (how `installNotifyListeners` shipped).
 */
const listeners = (target = 'self') => [
  `${target}.addEventListener("push",e=>h(e));`,
  `${target}.addEventListener("notificationclick",e=>h(e));`,
  `${target}.addEventListener("pushsubscriptionchange",e=>h(e));`,
].join('');
const wasmAwait = 'const w=await __vite__initWasm({},"x.wasm");';
const tlaIife = (body) => `(function(){self.addEventListener=self.addEventListener})();(async function(){"use strict";${body}})();`;

describe('analyseWorkerListeners', () => {
  it('accepts listeners added at top level before the first await', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`if(typeof self!=="undefined"){${listeners()}}${wasmAwait}`));
    expect(problems).toEqual([]);
  });

  it('accepts a synchronous iife before the first await (terser inlining)', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`!function g(){${listeners()}}();${wasmAwait}`));
    expect(problems).toEqual([]);
  });

  it('refuses listeners that come after the first top-level await (the development bug)', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`${wasmAwait}const R=!!chrome.sidePanel;!function installNotifyListeners(){if(self.registration?.pushManager){${listeners()}}}();`));
    expect(problems.filter((p) => p.includes('after the first top-level await'))).toHaveLength(3);
    expect(problems.filter((p) => p.startsWith('No addEventListener'))).toHaveLength(3);
  });

  it('refuses a listener added inside a function that runs later, even one placed before the await', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`${listeners()}function late(){self.addEventListener("push",h)}${wasmAwait}late();`));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/'push'.*inside a function/);
  });

  it('refuses a listener in an async iife', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`${listeners()}(async()=>{self.addEventListener("notificationclick",h)})();${wasmAwait}`));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/'notificationclick'.*inside a function/);
  });

  it('reports a missing event', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`self.addEventListener("push",h);self.addEventListener("notificationclick",h);${wasmAwait}`));
    expect(problems).toEqual([expect.stringContaining("No addEventListener('pushsubscriptionchange')")]);
  });

  it('ignores other events and computed names', () => {
    const { problems } = analyseWorkerListeners(tlaIife(`${listeners()}${wasmAwait}function f(){self.addEventListener("message",h);self.addEventListener(n,h)}`));
    expect(problems).toEqual([]);
  });

  it('treats a bundle without top-level await as all first evaluation, except nested functions', () => {
    expect(analyseWorkerListeners(`(function(){${listeners()}})();`).problems).toEqual([]);
    expect(analyseWorkerListeners(`(function(){${listeners()}function f(){self.addEventListener("push",h)}})();`).problems).toHaveLength(1);
  });
});
