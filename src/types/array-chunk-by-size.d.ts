declare module 'array-chunk-by-size' {
  export function chunkArray<T>(opts: {
    input: T[];
    bytesSize?: number;
    failOnOversize?: boolean;
  }): T[][];
}
