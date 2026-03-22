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
  // Stub options → extension/index.html
  let optionsData = await fs.readFile(r(`src/options/index.html`), 'utf-8')
  optionsData = optionsData
    .replace('"./main.ts"', `"http://localhost:${port}/options/main.ts"`)
    .replace('<div id="app"></div>', '<div id="app">Vite server did not start</div>')
  await fs.writeFile(r(`extension/index.html`), optionsData, 'utf-8')
  log('PRE', `stub options`)

  // Stub sidepanel → extension/sidepanel/index.html
  await fs.ensureDir(r('extension/sidepanel'))
  let sidepanelData = await fs.readFile(r(`src/sidepanel/index.html`), 'utf-8')
  sidepanelData = sidepanelData
    .replace('"./main.ts"', `"http://localhost:${port}/sidepanel/main.ts"`)
    .replace('<div id="app"></div>', '<div id="app">Vite server did not start</div>')
  await fs.writeFile(r(`extension/sidepanel/index.html`), sidepanelData, 'utf-8')
  log('PRE', `stub sidepanel`)
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
    // Fix broken Vite asset paths on Windows (resolves to deep absolute-like relative paths)
    const fixBrokenPaths = (html: string, correctPrefix: string) =>
      html.replace(/(?:\.\.\/)+(?:[A-Za-z]:\/)?(?:[^"']*\/)*(?=(?:assets|js)\/)/g, correctPrefix)

    // Move options/index.html to extension root and fix paths
    log('PRE', 'stub options')
    await fs.ensureDir(r(`extension/options`))
    let data = await fs.readFile(r(`extension/options/index.html`), 'utf-8')
    data = fixBrokenPaths(data, './')  // root-level: ./assets/, ./js/
    await fs.writeFile(r(`extension/index.html`), data, 'utf-8')
    await fs.remove(r(`extension/options`))

    // Fix sidepanel asset paths (stays in subdirectory)
    const sidepanelHtml = r('extension/sidepanel/index.html')
    if (await fs.pathExists(sidepanelHtml)) {
      let spData = await fs.readFile(sidepanelHtml, 'utf-8')
      spData = fixBrokenPaths(spData, '../')  // subdirectory: ../assets/, ../js/
      await fs.writeFile(sidepanelHtml, spData, 'utf-8')
      log('PRE', 'fix sidepanel paths')
    }
  })();
}
