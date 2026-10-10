// Browser-side helpers shared by the Help scenarios. Nothing here touches wallet data or the network.

/** Heights by which scroll containers (and the page) overflow their box right now; the largest one. */
function overflowOf(page) {
  return page.evaluate(() => {
    let max = Math.max(0, (document.scrollingElement?.scrollHeight ?? 0) - innerHeight);
    for (const el of document.querySelectorAll('*')) {
      if (/auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) max = Math.max(max, el.scrollHeight - el.clientHeight);
    }
    return max;
  });
}

/**
 * Full-page screenshot of a view that scrolls inside a container (Help does, and so does the wallet shell):
 * grow the viewport until nothing overflows, capture, then restore the original size.
 */
async function fitShot(page, file, limit = 9000) {
  const base = page.viewportSize();
  for (let pass = 0; pass < 3; pass++) {
    const extra = await overflowOf(page);
    if (extra <= 0) break;
    await page.setViewportSize({ width: base.width, height: Math.min(page.viewportSize().height + extra, limit) });
    await page.waitForTimeout(250);
  }
  const size = page.viewportSize();
  await page.screenshot({ path: file, fullPage: true });
  await page.setViewportSize(base);
  return size;
}

/** Resolves once the image has decoded with a real size; lazy images are scrolled into view first. */
async function imageLoaded(locator) {
  await locator.scrollIntoViewIfNeeded();
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction(img => img.complete && img.naturalWidth > 0, handle, { timeout: 10000 });
  return locator.evaluate(img => ({ src: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight }));
}

/** True when the page can be scrolled sideways at the current viewport width. */
const scrollsSideways = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

const EVENT_KEYS = ['type', 'surface', 'locale', 'chain', 'subject'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

/**
 * Fulfils the anonymous usage endpoint (202, and 204 for its CORS preflight) instead of aborting it, and
 * records each posted body. Returns false for any other request so the caller can route it as usual.
 */
async function acceptHelpEvents(route, bodies) {
  const request = route.request();
  if (new URL(request.url()).pathname !== '/api/help/events') return false;
  const post = request.method() === 'POST';
  if (post) bodies.push(request.postData() ?? '');
  await route.fulfill({ status: post ? 202 : 204, headers: CORS });
  return true;
}

/**
 * Checks the recorded bodies carry counters only: `{ events: [...] }` batches of 1-25 events whose keys are
 * type/surface/locale/chain/subject, and none of the `forbidden` values (ids, addresses, typed text) anywhere.
 * Returns the flattened events.
 */
function anonymousEvents(assert, bodies, forbidden = []) {
  const events = bodies.flatMap(body => {
    const batch = JSON.parse(body);
    assert.deepEqual(Object.keys(batch), ['events'], 'A batch holds nothing but its events');
    assert.ok(batch.events.length >= 1 && batch.events.length <= 25, `Batch size ${batch.events.length}`);
    return batch.events;
  });
  for (const event of events) {
    assert.ok(Object.keys(event).every(key => EVENT_KEYS.includes(key)), `Unexpected keys in ${JSON.stringify(event)}`);
    for (const key of ['type', 'surface', 'locale', 'chain']) assert.equal(typeof event[key], 'string', `${key} in ${JSON.stringify(event)}`);
    assert.ok(!('subject' in event) || typeof event.subject === 'string', `subject in ${JSON.stringify(event)}`);
  }
  const text = bodies.join('\n').toLowerCase();
  for (const value of forbidden) assert.ok(!text.includes(String(value).toLowerCase()), `Usage events must not contain "${value}"`);
  return events;
}

module.exports = { fitShot, imageLoaded, scrollsSideways, acceptHelpEvents, anonymousEvents };
