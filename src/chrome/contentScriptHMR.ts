import { isForbiddenUrl } from '@/env'

browser.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  // Filter out non-main window events.
  if (frameId !== 0)
    return

  if (isForbiddenUrl(url))
    return

  // inject the latest scripts
  browser.tabs.executeScript(tabId, {
    file: './dist/contentScripts/index.global.js',
    runAt: 'document_end',
  }).catch(error => console.error(error))
})
