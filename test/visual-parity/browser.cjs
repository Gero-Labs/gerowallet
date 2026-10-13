// Run: node test/visual-parity/browser.cjs
// Starts its own Vite server and fresh headless browser; no extension/profile,
// wallet state, production build, remote requests, or additional packages.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const output = process.env.VISUAL_PARITY_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'gero-visual-parity-'));
const transparent = 'rgba(0, 0, 0, 0)';
const report = { passed: false, measurements: {}, pageErrors: [], externalRequests: [] };

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: path.join(__dirname, 'vite.config.mts'), logLevel: 'error' });
  let browser;
  let page;
  const pendingRequests = new Set();
  fs.mkdirSync(output, { recursive: true });
  try {
    await server.listen();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      report.externalRequests.push(url.origin);
      return route.abort();
    });
    page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('request', request => pendingRequests.add(request.url()));
    page.on('requestfinished', request => pendingRequests.delete(request.url()));
    page.on('requestfailed', request => pendingRequests.delete(request.url()));
    await page.goto(`${origin}/test/visual-parity/index.html`, { timeout: 60000 });
    await page.getByTestId('avatar-empty').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId('avatar-image').locator('img').waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="avatar-image"] img');
      return image?.complete && image.naturalWidth > 0;
    });

    const measure = async id => {
      const value = await page.getByTestId(id).evaluate(element => {
        const css = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { background: css.backgroundColor, color: css.color, width: box.width, height: box.height,
          fontWeight: css.fontWeight, fontSize: css.fontSize, padding: css.padding, margin: css.margin,
          letterSpacing: css.letterSpacing, textTransform: css.textTransform, radius: css.borderRadius,
          borderWidth: css.borderWidth, outlineWidth: css.outlineWidth, outlineStyle: css.outlineStyle };
      });
      report.measurements[id] = value;
      return value;
    };
    const currentThemeColor = async name => page.evaluate(name => {
      const channels = getComputedStyle(document.querySelector('.v-application')).getPropertyValue(`--v-theme-${name}`).trim();
      return `rgb(${channels.split(',').map(value => value.trim()).join(', ')})`;
    }, name);
    const measureFieldFocus = async (id, themeColor = 'primary') => {
      const editor = page.getByTestId(id).locator('input, textarea').first();
      await editor.focus();
      await page.getByTestId(id).locator('.v-field--focused').waitFor();
      const color = await currentThemeColor(themeColor);
      await page.waitForFunction(({ id, color }) => getComputedStyle(document.querySelector(`[data-testid="${id}"] .v-field__outline`)).color === color, { id, color });
      const value = await editor.evaluate(element => {
        const field = element.closest('.v-field');
        const outline = field.querySelector('.v-field__outline');
        const css = getComputedStyle(outline);
        const fieldBox = field.getBoundingClientRect();
        const outlineBox = outline.getBoundingClientRect();
        return { innerOutline: getComputedStyle(element).outlineStyle, focusVisible: element.matches(':focus-visible'),
          shadow: css.boxShadow, color: css.color, radius: css.borderRadius, fieldRadius: getComputedStyle(field).borderRadius,
          fieldBox: { x: fieldBox.x, y: fieldBox.y, width: fieldBox.width, height: fieldBox.height },
          outlineBox: { x: outlineBox.x, y: outlineBox.y, width: outlineBox.width, height: outlineBox.height } };
      });
      report.measurements[id] = value;
      assert.equal(value.innerOutline, 'none', `${id}: no rectangle around the inner editor`);
      assert.equal(value.focusVisible, true);
      return value;
    };
    const assertBorderlessFocus = async (id, themeColor = 'primary') => {
      const value = await measureFieldFocus(id, themeColor);
      assert.equal(value.color, await currentThemeColor(themeColor), `${id}: preserve theme and error colors`);
      assert.match(value.shadow, /0px 0px 0px 2px inset/, `${id}: visible keyboard focus on the field boundary`);
      assert.equal(value.radius, value.fieldRadius, `${id}: ring follows the existing corners`);
      assert.deepEqual(value.outlineBox, value.fieldBox, `${id}: ring covers the complete field including adornments`);
    };
    const assertForcedColorsFocus = async id => {
      const editor = page.getByTestId(id).locator('input, textarea').first();
      await editor.focus();
      await page.getByTestId(id).locator('.v-field--focused').waitFor();
      const value = await editor.evaluate(element => {
        const field = element.closest('.v-field');
        const boundary = field.querySelector('.v-field__outline');
        const css = getComputedStyle(boundary);
        return { forcedColors: matchMedia('(forced-colors: active)').matches,
          focusVisible: element.matches(':focus-visible'), innerOutline: getComputedStyle(element).outlineStyle,
          shadow: css.boxShadow, outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth,
          outlineOffset: css.outlineOffset, radius: css.borderRadius, fieldRadius: getComputedStyle(field).borderRadius };
      });
      report.measurements[`${id}-forced-colors`] = value;
      assert.equal(value.forcedColors, true);
      assert.equal(value.focusVisible, true);
      assert.equal(value.shadow, 'none', 'Forced colors removes box shadows, so they cannot provide the focus indicator');
      assert.equal(value.innerOutline, 'none', 'High contrast must not restore the rectangle around the inner editor');
      assert.equal(value.outlineStyle, 'solid', `${id}: retain visible field focus in high contrast`);
      assert.equal(value.outlineWidth, '2px');
      assert.equal(value.outlineOffset, '-2px');
      assert.equal(value.radius, value.fieldRadius, `${id}: high contrast focus follows the existing corners`);
    };

    const measureAvatarImage = async id => {
      const avatar = page.getByTestId(id);
      await avatar.locator('img').evaluate(image => image.decode());
      const dimensions = await avatar.evaluate(element => {
        const image = element.querySelector('img');
        const box = image.getBoundingClientRect();
        const wrapper = element.getBoundingClientRect();
        const css = getComputedStyle(image);
        return { width: box.width, height: box.height, avatarWidth: wrapper.width, avatarHeight: wrapper.height,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, objectFit: css.objectFit };
      });
      report.measurements[id] = dimensions;
      return dimensions;
    };
    await page.getByTestId('token-avatars').locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.getByTestId('token-avatars').screenshot({ path: path.join(output, 'token-avatars.png') });
    for (const size of [26, 30, 32, 40]) {
      const token = await measureAvatarImage(`token-avatar-${size}`);
      assert.equal(token.avatarWidth, size);
      assert.equal(token.avatarHeight, size);
      assert.equal(token.width, size, 'A raw token logo must scale to its requested avatar width, not be clipped at its intrinsic size');
      assert.equal(token.height, size, 'A raw token logo must scale to its requested avatar height');
    }
    const customImage = await measureAvatarImage('token-avatar-custom');
    assert.equal(customImage.width, 16, 'Explicit per-image sizing must retain precedence');
    assert.equal(customImage.height, 16);
    const nativeCover = await measureAvatarImage('token-avatar-cover');
    assert.equal(nativeCover.objectFit, 'cover', 'Native VImg cover behavior must be unchanged');
    assert.equal(nativeCover.width, 32);
    assert.equal(nativeCover.height, 32);
    const nativeContain = await measureAvatarImage('token-avatar-contain');
    assert.equal(nativeContain.objectFit, 'contain', 'Native VImg contain behavior must be unchanged');

    for (const id of ['avatar-empty', 'avatar-glyph', 'avatar-image', 'avatar-mask']) {
      const avatar = await measure(id);
      assert.equal(avatar.background, transparent, `${id}: an uncolored wrapper must not paint a surface`);
      assert.equal(avatar.width, 18, `${id}: preserve the requested icon dimensions`);
      assert.equal(avatar.height, 18);
    }
    const mask = await page.getByTestId('avatar-mask').locator('[role="img"]').evaluate(element => {
      const css = getComputedStyle(element);
      return { image: css.maskImage, repeat: css.maskRepeat, size: css.maskSize, background: css.backgroundColor };
    });
    report.measurements.mask = mask;
    assert.match(mask.image, /url\("data:image\/svg\+xml,/, 'The actual inline SVG must remain a valid CSS mask URL');
    assert.equal(mask.repeat, 'no-repeat');
    assert.equal(mask.size, 'contain');
    assert.notEqual(mask.background, transparent, 'The SVG mask itself must retain its painted glyph');
    const urlCases = await page.evaluate(async () => {
      const { cssUrl } = await import('/src/shared/utils/cssUrl.ts');
      return ['/assets/icon.svg', '/assets/an icon "double" \'single\'.svg'].map(source => {
        const element = document.createElement('span');
        element.style.maskImage = cssUrl(source);
        return element.style.maskImage;
      });
    });
    assert.ok(urlCases.every(value => value.startsWith('url("')), 'Ordinary URLs and URLs containing spaces/quotes must parse');
    assert.equal((await measure('avatar-primary')).background, await currentThemeColor('primary'));
    assert.equal((await measure('avatar-hex')).background, 'rgb(253, 176, 34)');
    assert.equal((await measure('avatar-inline')).background, 'rgb(122, 167, 255)');
    assert.equal((await measure('avatar-transparent')).background, transparent);
    assert.equal((await measure('avatar-elevated')).background, await currentThemeColor('surface'));
    assert.equal((await measure('chip-neutral')).background, 'rgb(85, 85, 85)');
    assert.equal((await measure('chip-primary')).background, await currentThemeColor('primary'));
    assert.equal((await measure('chip-hex')).background, 'rgb(253, 176, 34)');
    assert.equal((await measure('chip-inline')).background, 'rgb(122, 167, 255)');
    assert.equal((await measure('chip-outlined')).background, transparent);
    assert.equal((await measure('chip-tonal')).background, transparent);

    for (const id of ['icon-button', 'icon-button-primary', 'small-icon-button']) {
      assert.equal((await measure(id)).background, transparent, `${id}: bare icon buttons must not be filled`);
      const glyph = await page.getByTestId(id).locator('.v-icon').evaluate(element => ({
        background: getComputedStyle(element).backgroundColor,
        content: getComputedStyle(element, '::before').content,
        font: getComputedStyle(element, '::before').fontFamily,
      }));
      assert.equal(glyph.background, transparent);
      assert.notEqual(glyph.content, 'none');
      assert.notEqual(glyph.content, 'normal');
      assert.match(glyph.font, /Material Design Icons/);
    }
    for (const [id, size] of [['icon-button', 36], ['small-icon-button', 28], ['sized-icon-button', 24], ['styled-icon-button', 22]]) {
      const button = await measure(id);
      assert.equal(button.height, size);
      assert.equal(button.width, size);
    }
    await page.getByRole('button', { name: 'Refresh fixture', exact: true }).click();
    assert.equal(await page.getByRole('status').textContent(), '1 clicks');
    await page.getByRole('button', { name: 'Favorite fixture', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('status').textContent(), '2 clicks');

    for (const id of ['plain-button', 'disabled-plain-button']) {
      const button = await measure(id);
      assert.equal(button.background, transparent, 'Plain wallet buttons must not acquire browser-default gray fills');
      assert.equal(button.borderWidth, '0px', 'Plain wallet buttons must not acquire browser-default borders');
    }
    await page.getByTestId('plain-button').focus();
    assert.equal((await measure('plain-button')).outlineStyle, 'solid', 'Keyboard focus must remain visible');
    assert.equal((await measure('plain-button')).outlineWidth, '2px');
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('status').textContent(), '3 clicks');
    const styledButton = await measure('styled-plain-button');
    assert.notEqual(styledButton.background, transparent, 'Explicit native button fills must remain intact');
    assert.equal(styledButton.borderWidth, '1px');
    assert.equal((await measure('filled-button')).background, await currentThemeColor('primary'));
    assert.equal((await measure('outlined-button')).borderWidth, '1px', 'Native Vuetify outlined buttons must retain their borders');

    assert.equal((await measure('heading')).margin, '0px');
    assert.equal((await measure('paragraph')).margin, '0px 0px 16px');
    assert.equal((await measure('list')).padding, '0px 0px 0px 24px');
    assert.equal((await measure('spacing')).padding, '12px');
    assert.equal((await measure('spacing')).margin, '8px');
    for (const id of ['caption-bold', 'body-bold']) assert.equal((await measure(id)).fontWeight, '700');
    assert.equal((await measure('heading-regular')).fontWeight, '400');

    const profile = page.getByRole('tab', { name: 'Profile', exact: true });
    const tab = await profile.evaluate(element => {
      const css = getComputedStyle(element);
      return { height: element.getBoundingClientRect().height, fontSize: css.fontSize, fontWeight: css.fontWeight,
        letterSpacing: css.letterSpacing, textTransform: css.textTransform, radius: css.borderRadius, padding: css.padding };
    });
    report.measurements.tab = tab;
    assert.equal(tab.height, 48);
    assert.equal(tab.fontSize, '12px');
    assert.equal(tab.fontWeight, '500');
    assert.equal(tab.textTransform, 'uppercase');
    assert.equal(tab.radius, '0px');
    assert.equal(tab.padding, '0px 16px');
    assert.ok(Math.abs(parseFloat(tab.letterSpacing) - 1.07143) < 0.001);
    assert.equal(await profile.getAttribute('aria-selected'), 'true');
    const tabLayout = await page.getByTestId('tabs').evaluate(element => {
      const title = element.parentElement;
      const titleCss = getComputedStyle(title);
      const clip = element.querySelector('.v-slide-group__container').getBoundingClientRect();
      const slider = element.querySelector('.v-tab--selected .v-tab__slider').getBoundingClientRect();
      return { width: element.getBoundingClientRect().width, available: title.clientWidth - parseFloat(titleCss.paddingLeft) - parseFloat(titleCss.paddingRight), sliderBottom: slider.bottom, clipBottom: clip.bottom };
    });
    assert.ok(Math.abs(tabLayout.width - tabLayout.available) < 1, 'Tabs must fill the card header');
    assert.ok(tabLayout.sliderBottom <= tabLayout.clipBottom, 'The bottom border must not clip the active tab slider');
    await page.getByRole('tab', { name: 'Security', exact: true }).click();
    await page.getByText('Security panel', { exact: true }).waitFor({ state: 'visible' });
    const custom = await measure('custom-tab');
    assert.equal(custom.height, 32);
    assert.equal(custom.padding, '0px 12px');
    assert.equal(custom.textTransform, 'none');

    for (const [id, themeColor] of [['field-default', 'primary'], ['field-explicit', 'success'], ['field-error', 'error']]) {
      await page.getByTestId(id).locator('input').focus();
      const color = await currentThemeColor(themeColor);
      await page.waitForFunction(({ id, color }) => getComputedStyle(document.querySelector(`[data-testid="${id}"] .v-field__outline`)).color === color, { id, color });
      const inputOutline = await page.getByTestId(id).locator('input').evaluate(element => getComputedStyle(element).outlineStyle);
      report.measurements[`${id}-outline`] = inputOutline;
      assert.equal(inputOutline, 'none',
        'Native fields must highlight their existing border, without an extra rectangle around the inner input');
    }
    for (const variant of ['solo', 'solo-filled', 'solo-inverted', 'plain']) await assertBorderlessFocus(`field-${variant}`);
    await assertBorderlessFocus('field-solo-explicit', 'success');
    await assertBorderlessFocus('field-solo-error', 'error');
    for (const variant of ['filled', 'underlined', 'textarea', 'select', 'autocomplete']) {
      const field = await measureFieldFocus(`field-${variant}`);
      assert.equal(field.shadow, 'none', 'Native bordered variants must not acquire another ring');
      assert.equal(field.color, await currentThemeColor('primary'));
    }
    await page.getByTestId('plain-input').focus();
    assert.equal((await measure('plain-input')).outlineWidth, '2px', 'Plain inputs still need their own keyboard focus ring');
    await assertBorderlessFocus('field-solo');
    await page.getByTestId('focus-variants').screenshot({ path: path.join(output, 'field-focus.png') });
    await page.emulateMedia({ forcedColors: 'active' });
    for (const variant of ['solo', 'solo-filled', 'solo-inverted', 'plain']) await assertForcedColorsFocus(`field-${variant}`);
    await assertForcedColorsFocus('field-solo-explicit');
    await assertForcedColorsFocus('field-solo-error');
    await page.getByTestId('focus-variants').screenshot({ path: path.join(output, 'field-focus-forced-colors.png') });
    await page.emulateMedia({ forcedColors: 'none' });
    const otp = page.getByTestId('numeric-otp');
    const slots = await otp.locator('[data-otp-index]').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, width: box.width, height: box.height };
    }));
    assert.equal(slots.length, 4);
    for (let i = 0; i < slots.length; i++) {
      assert.equal(slots[i].width, 56);
      assert.equal(slots[i].height, 56);
      if (i) assert.equal(slots[i].x - slots[i - 1].x - slots[i - 1].width, 12);
    }
    report.measurements.otpSlots = slots;
    await otp.locator('[data-otp-index="0"]').click();
    assert.equal(await otp.locator('.v-otp-input__input').evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'The hidden OTP input must not draw a stray rectangle');
    assert.equal(await otp.locator('.v-field--focused').count(), 1, 'The active OTP digit retains its own field focus');
    await page.keyboard.type('x1234');
    assert.equal(await page.getByTestId('pin-finished').textContent(), 'complete');
    assert.equal(await otp.locator('.v-otp-input__input').inputValue(), '1234', 'The real shared component must reject nonnumeric keys');
    assert.ok((await otp.locator('.v-otp-input__field').allTextContents()).every(value => !/[0-9]/.test(value)), 'Password slots must display masked glyphs');
    await page.getByRole('button', { name: 'Show PIN error', exact: true }).click();
    await page.getByText('Synthetic validation error', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await otp.locator('.v-field--error').count(), 4);

    const primaryBefore = (await measure('avatar-primary')).background;
    await page.getByRole('button', { name: 'Midnight theme', exact: true }).click();
    const expectedPrimary = await currentThemeColor('primary');
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('[data-testid="avatar-primary"]')).backgroundColor === expected, expectedPrimary);
    const primaryAfter = (await measure('avatar-primary')).background;
    assert.notEqual(primaryAfter, primaryBefore, 'Explicit fills must still follow the active chain theme');
    assert.equal(primaryAfter, await currentThemeColor('primary'));
    assert.equal((await measure('avatar-empty')).background, transparent);
    await page.screenshot({ path: path.join(output, 'controls.png'), fullPage: true });
    await page.getByRole('button', { name: 'Open overlay', exact: true }).click();
    await page.getByTestId('overlay-avatar').waitFor({ state: 'visible' });
    const blur = await page.locator('.v-dialog.v-overlay--active').evaluate(element => ({
      root: getComputedStyle(element).backdropFilter,
      scrim: getComputedStyle(element.querySelector('.v-overlay__scrim')).backdropFilter,
    }));
    assert.equal(blur.root, 'blur(8px)');
    assert.equal(blur.scrim, 'none');
    assert.equal((await measure('overlay-avatar')).background, transparent);
    assert.equal((await measure('overlay-primary')).background, primaryAfter);
    assert.equal((await measure('overlay-heading')).margin, '0px');
    const overlayToken = await measureAvatarImage('overlay-token-avatar');
    assert.equal(overlayToken.width, 26, 'The same token sizing must apply inside teleported dialogs');
    assert.equal(overlayToken.height, 26);
    const overlayButton = await measure('overlay-plain-button');
    assert.equal(overlayButton.background, transparent);
    assert.equal(overlayButton.borderWidth, '0px');
    await assertBorderlessFocus('overlay-field-solo');
    await page.screenshot({ path: path.join(output, 'overlay.png'), fullPage: true });
    await page.emulateMedia({ forcedColors: 'active' });
    await assertForcedColorsFocus('overlay-field-solo');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.getByRole('button', { name: 'Close overlay', exact: true }).click();
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.externalRequests, []);
    report.passed = true;
    console.log(`Visual parity browser checks passed. Evidence: ${output}`);
  } finally {
    report.pendingRequests = [...pendingRequests];
    if (page && !report.passed) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report.sourceHashes = Object.fromEntries(['src/options/index.html', 'src/options/main.ts', 'src/options/App.vue',
      'src/plugins/vuetify.ts', 'src/shared/styles/vuetify-compat.css', 'src/shared/styles/baseline.css',
      'src/modules/dashboard/dialogs/SettingsDialog.vue'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
