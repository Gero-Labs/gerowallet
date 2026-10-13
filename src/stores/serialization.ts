/**
 * Chrome storage uses JSON values. Detach Vue proxies before crossing that
 * boundary, including proxies nested in arrays or object spreads. Stores with
 * bigint/Map/Set contracts must apply their existing serializer first.
 */
export function plainStoreSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
