// generate stub index.html files for dev entry
import { execSync } from 'node:child_process'
import fs from 'fs-extra'
import chokidar from 'chokidar'
import { isDev, log, port, r } from './utils'

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

/**
 * Copy PNG files from src/assets/public to extension/public
 */
async function copyPublicAssets() {
  const srcDir = r('src/assets/public')
  const destDir = r('extension/public')
  
  await fs.ensureDir(destDir)
  
  try {
    const files = await fs.readdir(srcDir)
    const pngFiles = files.filter(file => file.endsWith('.png'))
    
    for (const file of pngFiles) {
      const srcPath = r(`src/assets/public/${file}`)
      const destPath = r(`extension/public/${file}`)
      await fs.copy(srcPath, destPath)
      log('PRE', `copied ${file}`)
    }
  } catch (error) {
    log('PRE', `Error copying public assets: ${error}`)
  }
}

function writeManifest() {
  execSync('npx esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

writeManifest()

if (isDev) {
  stubIndexHtml()
  copyPublicAssets()
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
    await copyPublicAssets()
  })();
}
