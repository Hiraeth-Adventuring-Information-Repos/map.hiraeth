import { test, expect } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMapFileServer } = require('../scripts/map_file_server.js');
let server, base;
test.beforeAll(async () => {
    server = createMapFileServer({ repoRoot: path.resolve(import.meta.dirname, '..'), allowedHosts: '127.0.0.1' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

for (const asset of ['js/app-config.js', 'js/map-editor-fields.js', 'css/map-editor.css', 'js/map-file-editor.js']) {
    test(`failed ${asset} shows a usable error and retry preserves the browser draft`, async ({ page }) => {
        const pattern = `**/${asset}?*`;
        await page.route(pattern, route => route.abort());
        await page.goto(base + '/studio/editor', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#editor-startup-error')).toBeVisible();
        await expect(page.locator('#editor-startup-error-detail')).toContainText(asset);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#map-editor-app')).toHaveJSProperty('inert', true);
        await page.evaluate(() => sessionStorage.setItem('startup-recovery-sentinel', 'keep my draft'));
        await page.unroute(pattern);
        await page.getByRole('button', { name: 'Retry loading editor' }).click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#editor-startup-error')).toBeHidden();
        await expect(page.locator('[data-map-id="main_continent"]').first()).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem('startup-recovery-sentinel'))).toBe('keep my draft');
    });
}
for (const resource of ['site.config.json', 'api/editor/status', 'api/editor/catalog', 'maps/maps.json', 'js/libs/leaflet.js']) {
    test(`stalled ${resource} times out with its name instead of spinning forever`, async ({ page }) => {
        await page.clock.install();
        const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/' + resource);
        await page.route(`**/${resource}*`, () => {});
        await page.goto(base + '/studio/editor', { waitUntil: 'domcontentloaded' });
        await requested;
        await page.clock.fastForward(21000);
        await expect(page.locator('#editor-startup-error')).toBeVisible();
        await expect(page.locator('#editor-startup-error-detail')).toContainText('Timed out');
        await expect(page.locator('#editor-startup-error-detail')).toContainText(resource);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    });
}
test('a stalled response body is bounded too', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
        const original = window.fetch;
        window.fetch = async (...args) => {
            const response = await original(...args);
            if (String(args[0]) === '/api/editor/catalog') {
                response.json = () => new Promise(() => {});
                window.catalogBodyStarted = true;
            }
            return response;
        };
    });
    await page.goto(base + '/studio/editor', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.catalogBodyStarted);
    await page.clock.fastForward(21000);
    await expect(page.locator('#editor-startup-error-detail')).toContainText('Timed out loading /api/editor/catalog');
});
test('initialization exceptions have a visible message', async ({ page }) => {
    await page.route('**/js/map-editor-fields.js?*', route => route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("Test: browser initialization failed")' }));
    await page.goto(base + '/studio/editor', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#editor-startup-error-detail')).toContainText('Test: browser initialization failed');
    await expect(page.getByRole('button', { name: 'Retry loading editor' })).toBeVisible();
});
