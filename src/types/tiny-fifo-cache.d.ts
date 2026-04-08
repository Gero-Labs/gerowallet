declare module 'tiny-fifo-cache' {
  class FIFOCache<T = unknown> {
    constructor(maxItems: number);
    put(key: string, value: T): void;
    get(key: string): T | null;
    flush(): void;
  }
  export default FIFOCache;
}
