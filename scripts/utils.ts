import { resolve } from 'node:path'
import process from 'node:process'
import { bgCyan, black } from 'kolorist'

export const port = Number(process.env['PORT'] || '') || 3303
export const r = (...args: string[]) => resolve(__dirname, '..', ...args)
export const isDev = process.env['NODE_ENV'] !== 'production'
export const isFirefox = process.env['EXTENSION'] === 'firefox'

/**
 * Output directory NAME (relative to repo root) for the built extension.
 * Firefox gets its own directory so `EXTENSION=firefox npm run build:firefox`
 * can never clobber the Chrome `extension/` output — they're written by
 * separate builds that may even run back-to-back on the same checkout.
 */
export const extensionDirName = isFirefox ? 'extension-firefox' : 'extension'

export function log(name: string, message: string) {
  console.log(black(bgCyan(` ${name} `)), message)
}
