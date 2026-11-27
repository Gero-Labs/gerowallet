/**
 * The background worker must add its push listeners in its FIRST evaluation.
 *
 * Chrome delivers a push (and a notification click, and a subscription change)
 * to a stopped MV3 worker by starting it and dispatching the event once the
 * script's first evaluation is over. A listener added later never sees that
 * event: Chrome logs "Event handler of 'push' event must be added on the
 * initial evaluation of worker script" and the push is lost.
 *
 * The background is one iife, and rollup-plugin-tla turns it into an ASYNC
 * function so the wasm modules can `await __vite__initWasm(...)` at top level.
 * The first evaluation therefore ends at the first top-level `await`, and every
 * module Rollup places after it runs in a later turn. `installNotifyListeners()`
 * sat ~5 MB after that await, so every push that woke the worker was dropped,
 * although its source line was top level and synchronous.
 *
 * The listeners now live in `src/chrome/workerEventGate.ts`, imported first by
 * `background.ts`. This fails a build where any `addEventListener('<event>')`
 * for these events is not reached before that first await: inside a function,
 * or after it.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rollup/parseAst';

/** Events Chrome only delivers to a woken worker when their listener was added in the first evaluation. */
export const FIRST_EVALUATION_EVENTS = ['push', 'notificationclick', 'pushsubscriptionchange'];

/** The shipped background entry, relative to the repository root. */
export const BACKGROUND_BUNDLE = 'extension/background/index.js';

const isFunction = (node) => node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';

/**
 * The function a call runs immediately and synchronously: `(function(){…})()`,
 * `!function(){…}()` (terser inlines a single-use function that way),
 * `(()=>{…})()` and `(function(){…}).call(this)`. Async ones are left out: their
 * body stops at its own first await.
 */
function immediatelyInvoked(node) {
  if (node.type !== 'CallExpression') return undefined;
  let callee = node.callee;
  if (callee?.type === 'MemberExpression' && !callee.computed && (callee.property?.name === 'call' || callee.property?.name === 'apply')) callee = callee.object;
  return callee && (callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') && !callee.async ? callee : undefined;
}

/** Child nodes in source order. */
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') out.push(item);
    } else if (value && typeof value.type === 'string') {
      out.push(value);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The event name when `node` is `<anything>.addEventListener('<event>', …)`, else undefined. */
function listenerEvent(node) {
  if (node.type !== 'CallExpression') return undefined;
  const callee = node.callee;
  if (callee?.type !== 'MemberExpression') return undefined;
  const name = callee.computed ? callee.property?.value : callee.property?.name;
  if (name !== 'addEventListener') return undefined;
  const first = node.arguments?.[0];
  return first?.type === 'Literal' && typeof first.value === 'string' ? first.value : undefined;
}

/**
 * The function the bundle's code runs in: the async top-level function when
 * rollup-plugin-tla made one, else the largest top-level function (a plain
 * iife), else none (code at program level).
 */
function entryFunction(program) {
  const topLevel = [];
  const stack = [program];
  while (stack.length) {
    const node = stack.pop();
    if (isFunction(node)) { topLevel.push(node); continue; }
    stack.push(...children(node));
  }
  const size = (fn) => fn.end - fn.start;
  const largest = (list) => list.reduce((a, b) => (size(b) > size(a) ? b : a), list[0]);
  const asyncFns = topLevel.filter((fn) => fn.async);
  if (asyncFns.length) return largest(asyncFns);
  return topLevel.length ? largest(topLevel) : undefined;
}

/**
 * Where each listener for FIRST_EVALUATION_EVENTS is added, and whether that is
 * inside the first evaluation. `problems` is empty when the bundle is safe.
 */
export function analyseWorkerListeners(code, events = FIRST_EVALUATION_EVENTS) {
  const program = parseAst(code);
  const entry = entryFunction(program);
  const wanted = new Set(events);

  // depth: 0 = program level, 1 = the entry function's own body, 2+ = any other function.
  // A synchronous iife runs in its caller's turn, so its body keeps the caller's depth.
  const calls = [];
  const inline = new Set();
  let firstAwait = Infinity;
  const stack = [{ node: program, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    let childDepth = depth;
    if (isFunction(node) && !inline.has(node)) childDepth = node === entry ? 1 : Math.max(depth, 1) + 1;
    const invoked = immediatelyInvoked(node);
    if (invoked && invoked !== entry) inline.add(invoked);
    if (childDepth <= 1) {
      if (node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await)) {
        firstAwait = Math.min(firstAwait, node.start);
      }
    }
    const event = listenerEvent(node);
    if (event && wanted.has(event)) calls.push({ event, start: node.start, depth });
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: childDepth });
  }

  const problems = [];
  const early = Object.fromEntries(events.map((e) => [e, 0]));
  for (const call of calls) {
    if (call.depth >= 2) {
      problems.push(`addEventListener('${call.event}') at offset ${call.start} is inside a function: it is added after the worker's first evaluation, so a push that wakes the worker never reaches it.`);
    } else if (call.start > firstAwait) {
      problems.push(`addEventListener('${call.event}') at offset ${call.start} comes after the first top-level await (offset ${firstAwait}): it is added after the worker's first evaluation.`);
    } else {
      early[call.event] += 1;
    }
  }
  for (const event of events) {
    if (!early[event]) problems.push(`No addEventListener('${event}') in the worker's first evaluation (see src/chrome/workerEventGate.ts).`);
  }
  return { problems, firstAwait: Number.isFinite(firstAwait) ? firstAwait : null, calls };
}

/** Vite plugin for the background build: fails a build whose worker adds these listeners late. */
export const workerListenersFirstEvaluation = {
  name: 'gero-worker-listeners-first-evaluation',
  apply: 'build',
  writeBundle(_options, bundle) {
    const chunk = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry);
    if (!chunk) return;
    const { problems } = analyseWorkerListeners(chunk.code);
    if (problems.length) this.error(`Worker listener guard failed (scripts/worker-listener-guard.mjs):\n- ${problems.join('\n- ')}`);
  },
};

function isMain() {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  const file = process.argv[2] ?? BACKGROUND_BUNDLE;
  const { problems, firstAwait, calls } = analyseWorkerListeners(readFileSync(file, 'utf8'));
  if (problems.length) {
    console.error(`worker-listener-guard: FAILED for ${file}`);
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(`worker-listener-guard: OK, ${calls.length} listener(s) added before the first top-level await (offset ${firstAwait ?? 'none'}) in ${file}`);
}
