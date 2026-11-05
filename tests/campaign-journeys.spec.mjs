import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPreviewServer } = require('../scripts/preview_server.js');
let server, base;
test.beforeAll(async () => {
    server = createPreviewServer({ repoRoot: path.resolve(import.meta.dirname, '..') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

test('viewer displays a journey and preserves its filters', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const document = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'), 'utf8'));
    document.journeys = [{ id: 'road', name: 'A road remembered', campaign: 'Test campaign', wikiLink: 'https://example.org/campaign', stops: [
        { id: 'arrival', name: 'Arrival', coords: [1000, 2000], date: 'Late autumn, 58 BEC', wikiLink: 'https://example.org/arrival' },
        { id: 'crossing', name: 'The crossing', coords: [2000, 3000] }
    ] }];
    // Supply journey data without changing server files.
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: document }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(base + '/index.html#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(0);
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#toggle-filters-btn').click();
    await page.locator('.journey-filter').check();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(2);
    await expect(page.locator('.campaign-journey-route')).toHaveAttribute('stroke-dasharray', '1 9');
    await page.evaluate(() => map.fitBounds(currentJourneyLayers.values().next().value.getBounds(), { paddingTopLeft: [370, 180], paddingBottomRight: [280, 300], maxZoom: -1, animate: false }));
    await page.locator('.campaign-journey-pin').first().click();
    await expect(page.locator('.journey-popup')).toContainText('Late autumn, 58 BEC');
    await expect(page.getByRole('link', { name: 'Read about this stop' })).toHaveAttribute('href', 'https://example.org/arrival');
    await expect(page.getByRole('link', { name: 'Open campaign wiki' })).toHaveAttribute('href', 'https://example.org/campaign');
    await page.screenshot({ path: testInfo.outputPath('journey-viewer-desktop.png') });
    await page.locator('#filter-journeys-all').uncheck();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(0);
    await page.locator('#filter-toggle-all').check();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(2);
    await page.locator('#filter-toggle-all').uncheck();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(0);
    await page.locator('.journey-filter').check();
    await page.reload();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => isMobileLayoutActive);
    await expect(page.locator('#mobile-filters-btn')).toHaveJSProperty('hidden', false);
    await page.reload();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(2);
    await page.waitForFunction(() => isMobileLayoutActive);
    await page.evaluate(() => { closeMobileSheet({ restoreFocus: false }); if (filtersPanelVisible) toggleFilterPanel(); });
    await page.locator('#mobile-tools-launcher-btn').click();
    await page.locator('#mobile-filters-btn').click();
    await page.locator('.journey-filter').uncheck();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(0);
    await page.locator('.journey-filter').check();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('journey-viewer-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(errors).toEqual([]);
});

test('default visibility, independent journeys, empty feature maps, and map switching', async ({ page }) => {
    const document = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'), 'utf8'));
    document.pointsOfInterest = [];
    document.regions = [];
    document.lines = [];
    document.roads = [];
    document.journeys = [
        { id: 'first', name: 'First trail', campaign: 'Campaign A', visibleByDefault: true, stops: [{ id: 'a', name: 'Camp', coords: [1000, 2000] }] },
        { id: 'second', name: 'Second trail', campaign: 'Campaign B', visibleByDefault: false, stops: [{ id: 'b', name: 'Port', coords: [2000, 3000] }] }
    ];
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: document }));
    await page.goto(base + '/index.html#main_continent-s=c');
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(1);
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#toggle-filters-btn').click();
    await expect(page.locator('#filter-journeys-all')).toHaveJSProperty('indeterminate', true);
    await expect(page.locator('#filter-toggle-all')).toHaveJSProperty('indeterminate', true);
    await page.locator('[data-journey-id="second"]').check();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(2);
    await page.locator('[data-journey-id="first"]').uncheck();
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(1);
    await expect(page.locator('.campaign-journey-pin')).toHaveAttribute('title', /Second trail/);
    await page.evaluate(() => loadMap('The-Port-City-of-Stomion'));
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(0);
    await expect(page.locator('.journey-filter')).toHaveCount(0);
    await page.evaluate(() => loadMap('main_continent'));
    await expect(page.locator('.campaign-journey-pin')).toHaveCount(1);
    await expect(page.locator('.campaign-journey-pin')).toHaveAttribute('title', /Second trail/);
});
