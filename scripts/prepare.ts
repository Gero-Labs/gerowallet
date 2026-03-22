// generate stub index.html files for dev entry
import { execSync } from 'node:child_process'
import fs from 'fs-extra'
import chokidar from 'chokidar'
import { isDev, log, port, r } from './utils'

/**
 * Copy assets that are needed during development
 */
async function copyDevAssets() {
  // Ensure directories exist
  await fs.ensureDir(r('extension/public'))

  // Copy public assets
  const publicAssets = r('src/assets/public')
  if (await fs.pathExists(publicAssets)) {
    try {
      await fs.copy(publicAssets, r('extension/public'), { overwrite: true })
      log('PRE', 'copied public assets')
    } catch (error) {
      console.warn('Failed to copy public assets:', error)
    }
  }

  // Copy notification assets
  const notificationAssets = r('src/assets/notifications')
  if (await fs.pathExists(notificationAssets)) {
    try {
      await fs.copy(notificationAssets, r('extension/public/'), { overwrite: true })
      log('PRE', 'copied notification assets')
    } catch (error) {
      console.warn('Failed to copy notification assets:', error)
    }
  }
}

/**
 * Stub index.html to use Vite in development
 */
async function stubIndexHtml() {
  const views = [
    'options',
    // 'popup',
    // 'sidepanel'
  ]

  for (const view of views) {
    await fs.ensureDir(r(`extension/${view}`))
    let data = await fs.readFile(r(`src/${view}/index.html`), 'utf-8')
    data = data
      .replace('"./main.ts"', `"http://localhost:${port}/${view}/main.ts"`)
      .replace('<div id="app"></div>', '<div id="app">Vite server did not start</div>')
    if (view === 'options') {
      await fs.writeFile(r(`extension/index.html`), data, 'utf-8')
      await fs.remove(r(`extension/${view}`))
    } else {
      await fs.writeFile(r(`extension/${view}/index.html`), data, 'utf-8')
    }
    log('PRE', `stub ${view}`)
  }
}

function writeManifest() {
  execSync('npx esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

writeManifest()

if (isDev) {
  copyDevAssets()
  stubIndexHtml()
  chokidar.watch(r('src/**/*.html'))
    .on('change', () => {
      stubIndexHtml()
    })
  chokidar.watch([r('src/manifest.ts'), r('package.json')])
    .on('change', () => {
      writeManifest()
    })
} else {
  (async () => {
    log('PRE', 'stub options')
    await fs.ensureDir(r(`extension/options`))
    let data = await fs.readFile(r(`extension/options/index.html`), 'utf-8')
    await fs.writeFile(r(`extension/index.html`), data, 'utf-8')
    await fs.remove(r(`extension/options`))
  })();
}
