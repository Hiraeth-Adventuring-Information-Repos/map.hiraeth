import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMapFileServer } = require('../scripts/map_file_server.js');
const T = require('../js/travel-network.js');
const root = path.resolve(import.meta.dirname, '..');
let server, base;
test.beforeAll(async () => {
    server = createMapFileServer({ repoRoot: root, allowedHosts: '127.0.0.1' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => new Promise(resolve => server.close(resolve)));
const data = name => JSON.parse(fs.readFileSync(path.join(root, `maps/${name}.json`)));
async function viewer(page, id) {
    await page.goto(`${base}/index.html?routing=1#${id}-s=c`);
    await page.waitForFunction(id => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === id, id);
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#directions-btn').click();
    if (await page.locator('#travel-preference').inputValue() !== 'fastest') {
        await page.locator('.travel-options > summary').click(); await page.locator('#travel-preference').selectOption('fastest'); await page.locator('.travel-options > summary').click();
    }
}
async function trip(page, from, to) {
    await page.locator('#travel-from').fill(from); await page.locator('#travel-to').fill(to);
    await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-total')).toBeVisible();
}
test('real world networks expose proposed services, mode counts, hidden geometry and known-fare restrictions', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const [file, id, from, to] of [['Fair-Content', 'main_continent', 'Apsley', 'Stomion'], ['Astrousia', 'Astrousia', 'Djeskar', 'Isethra'], ['IceBeach', 'IceBeach', 'Whitedrift', 'Thrawbreak']]) {
        const mapData = data(file); await viewer(page, id);
        await expect(page.locator('.travel-review-note')).toContainText('Proposed atlas network');
        await expect(page.locator('.travel-network-line')).toHaveCount(0);
        await trip(page, from, to); await expect(page.locator('.travel-summary')).toContainText('proposed services');
        await page.getByLabel('Show the whole travel network').check();
        await expect(page.locator('.travel-network-line')).toHaveCount(mapData.lines.filter(T.active).length);
        await expect(page.locator('.travel-mode-legend')).toBeVisible();
        await page.locator('.travel-options > summary').click();
        if (file === 'IceBeach') await expect(page.getByLabel('Train', { exact: true })).toBeDisabled();
        await page.locator('#travel-preference').selectOption('cheapest');
        await page.getByRole('button', { name: 'Find route', exact: true }).click();
        await expect(page.locator('.travel-results')).toContainText('No connected route with known fares');
        await page.screenshot({ path: path.join(root, `design/transport-ux/${file}-viewer.png`) });
    }
    expect(errors).toEqual([]);
});
test('real Castgate city directions use corrected scale and keep inputs visible on mobile', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const city = data('castgate'), graph = T.build(city);
    await viewer(page, 'castgate'); await trip(page, "Chai en' Steep Inn", 'School for Adventures');
    const calculated = T.route(graph, "Chai en' Steep Inn", 'School for Adventures'); expect(calculated.km).toBeLessThan(5);
    await expect(page.locator('.travel-review-note')).toContainText('2 km');
    await expect(page.locator('.travel-start-building, .travel-destination-building, .city-house-number, .city-address-key')).toHaveCount(0); await expect(page.locator('.travel-start-marker, .travel-destination-marker')).toHaveCount(2);
    await page.screenshot({ path: path.join(root, 'design/transport-ux/castgate-viewer-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#travel-panel').evaluate(panel => panel.scrollTop = 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const panel = await page.locator('#travel-panel').boundingBox(), to = await page.locator('#travel-to').boundingBox();
    expect(to.y + to.height).toBeLessThan(panel.y + panel.height);
    await page.screenshot({ path: path.join(root, 'design/transport-ux/castgate-viewer-mobile.png') }); expect(errors).toEqual([]);
});
test('mobile printed trail endpoints stay clear of the directions toolbar and sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await viewer(page, 'IceBeach');
    await page.getByRole('button', { name: 'Walk', exact: true }).click();
    await trip(page, 'Castgate', 'Icemoor');
    await expect(page.locator('.travel-map-endpoint')).toHaveCount(2);
    const toolbar = await page.locator('#directions-btn').boundingBox(), panel = await page.locator('#travel-panel').boundingBox();
    for (const endpoint of await page.locator('.travel-map-endpoint').all()) {
        const box = await endpoint.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThan(panel.y);
        expect(box.x >= toolbar.x + toolbar.width || box.x + box.width <= toolbar.x || box.y >= toolbar.y + toolbar.height || box.y + box.height <= toolbar.y).toBe(true);
    }
    await expect(page.locator('.travel-total')).toContainText('Free');
});
test('Firefox keeps a calculated city route when the destination loses focus', async ({ playwright }) => {
    const browser = await playwright.firefox.launch();
    try {
        const page = await browser.newPage(); await viewer(page, 'castgate');
        await trip(page, "Chai en' Steep Inn", 'School for Adventures');
        await page.locator('#travel-to').focus(); await page.getByRole('button', { name: 'Find route', exact: true }).click();
        await expect(page.locator('.travel-total')).toBeVisible();
        await page.screenshot({ path: path.join(root, 'design/transport-ux/castgate-viewer-firefox.png') });
    } finally { await browser.close(); }
});
test('real city draft restores, mode filtering is display-only and export retains geometry and custom review metadata', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/studio/editor?routing=1&map=castgate`);
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    const panel = page.locator('#editor-network-panel'), city = data('castgate'), building = city.buildings.find(b => b.aliases?.includes("Chai en' Steep Inn"));
    await panel.locator('.network-address-list > summary').click(); await panel.getByLabel('Find a building address').fill("Chai en' Steep Inn");
    await panel.getByRole('button', { name: `${building.address} · ${building.name}`, exact: true }).click();
    await panel.getByLabel('Building name', { exact: true }).fill('Castgate draft review'); await panel.getByLabel('Building name', { exact: true }).press('Tab');
    expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('mapEditorRecovery:')))).toBe(true);
    await page.reload(); await expect(panel).toBeVisible();
    await panel.locator('.network-address-list > summary').click(); await panel.getByLabel('Find a building address').fill('Castgate draft review');
    await panel.getByRole('button', { name: `${building.address} · Castgate draft review`, exact: true }).click();
    await expect(panel.getByLabel('Building name', { exact: true })).toHaveValue('Castgate draft review');
    await panel.locator('.network-mode-filters').getByRole('button', { name: /^Road/ }).click();
    await expect(page.locator('.editor-network-link')).toHaveCount(city.lines.filter(line => line.travelMode === 'road').length);
    await page.screenshot({ path: path.join(root, 'design/transport-ux/castgate-editor-desktop.png') });
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click();
    const download = await pending, file = testInfo.outputPath('castgate-export.json'); await download.saveAs(file); const saved = JSON.parse(fs.readFileSync(file));
    expect(saved.buildings.length).toBe(city.buildings.length); expect(saved.lines).toEqual(city.lines); expect(saved.addressReview).toEqual(city.addressReview);
    expect(saved.buildings.find(b => b.id === building.id).name).toBe('Castgate draft review'); expect(T.validate(saved)).toEqual([]);
    expect(T.route(T.build(saved), building.address, 'School for Adventures')).toBeTruthy();
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: path.join(root, 'design/transport-ux/castgate-editor-mobile.png') }); expect(errors).toEqual([]);
});
