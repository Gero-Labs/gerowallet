// Sanity check for a wasm-pack `--target web` build, run in Node:
//   node sanity.mjs <pkg dir> <glue .js name> <file.bzkir> <expected k>
// Loads the module, deserializes the IR and prints getK(). No proving.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const [pkgDir, glueName, irPath, expected] = process.argv.slice(2);

// The threaded glue imports wasm-bindgen-rayon's workerHelpers.js, which at
// module scope listens for messages on `self` (a browser global Node lacks).
// A stub is enough here: no thread pool is started in this check.
if (typeof globalThis.self === 'undefined') {
  globalThis.self = { addEventListener() {}, removeEventListener() {} };
}
const glue = await import(pathToFileURL(resolve(join(pkgDir, glueName))).href);
const wasmBytes = readFileSync(join(pkgDir, glueName.replace(/\.js$/, '_bg.wasm')));

console.log('exports:', Object.keys(glue).sort().join(', '));
// The web target takes bytes / a Module / a URL; hand it the compiled module.
await glue.default({ module_or_path: await WebAssembly.compile(wasmBytes) });

const ir = glue.Zkir.deserialize(new Uint8Array(readFileSync(irPath)));
const k = ir.getK();
console.log('getK() =', k);
if (expected !== undefined && k !== Number(expected)) {
  console.error(`FAIL: expected ${expected}`);
  process.exit(1);
}
console.log('OK');
