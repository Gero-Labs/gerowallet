import type Dexie from 'dexie';
import { toRaw } from 'vue';

/**
 * IndexedDB cannot clone Vue proxies, including proxies nested in a shallow
 * object spread. Unwrap containers recursively, retaining structured-clone
 * values (dates, byte buffers, bigint, maps and sets) instead of JSON encoding.
 * The browser still performs the final clone and rejects unsupported values.
 */
export function unwrapForIndexedDB<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  function unwrap(input: unknown): unknown {
    if (input === null || typeof input !== 'object') return input;
    const raw = toRaw(input);
    if (seen.has(raw)) return seen.get(raw);
    if (raw instanceof Map) {
      const result = new Map();
      seen.set(raw, result);
      for (const [key, item] of raw) result.set(unwrap(key), unwrap(item));
      return result;
    }
    if (raw instanceof Set) {
      const result = new Set();
      seen.set(raw, result);
      for (const item of raw) result.add(unwrap(item));
      return result;
    }
    if (Array.isArray(raw) || Object.prototype.toString.call(raw) === '[object Object]') {
      const result = Array.isArray(raw) ? new Array(raw.length) : {};
      seen.set(raw, result);
      for (const key of Object.keys(raw)) {
        Object.defineProperty(result, key, {
          value: unwrap((raw as Record<string, unknown>)[key]),
          enumerable: true, configurable: true, writable: true,
        });
      }
      return result;
    }
    // Vue leaves native structured-clone types unproxied. Preserve their type
    // and buffer/view relationships for the browser's native cloning step.
    return raw;
  }
  return unwrap(value) as T;
}

const configured = new WeakSet<Dexie>();

/** Install once, before open(), for all writes through this database handle. */
export function configureCloneBoundary<T extends Dexie>(db: T): T {
  if (configured.has(db)) return db;
  db.use({
    stack: 'dbcore',
    name: 'vue-proxy-clone-boundary',
    // Run next to IndexedDB, after hooks and other write transformations.
    level: -2,
    create: core => ({
      ...core,
      table(name) {
        const table = core.table(name);
        return {
          ...table,
          mutate(request) {
            if (request.type === 'add' || request.type === 'put') {
              return table.mutate({ ...request, values: unwrapForIndexedDB(request.values) });
            }
            return table.mutate(request);
          },
        };
      },
    }),
  });
  configured.add(db);
  return db;
}
