import { test, expect } from '@playwright/test';
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
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

async function openMap(page, id = 'The-Port-City-of-Stomion') {
    await page.goto(`${base}/index.html#${id}-s=c`);
    await page.waitForFunction(id => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === id, id);
    await expect(page.locator('#loading-indicator')).toBeHidden();
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
}

test('reselecting the active map preserves layers, search and measurements', async ({ page }) => {
    await openMap(page);
    const result = await page.evaluate(async () => {
        const image = currentImageLayer, marker = allMapMarkers[0];
        poiSearchInput.value = 'Breads';
        updateVisibleMarkersAndSearch();
        const measurement = L.polyline([[100, 100], [200, 200]]).addTo(measurementLayerGroup);
        await loadMap(currentlyLoadedMapId, false);
        return { image: image === currentImageLayer, marker: marker === allMapMarkers[0],
            query: poiSearchInput.value, measurement: measurementLayerGroup.hasLayer(measurement) };
    });
    expect(result).toEqual({ image: true, marker: true, query: 'Breads', measurement: true });
});

test('the gallery owns keyboard input without enabling hidden map tools', async ({ page }) => {
    await openMap(page);
    const before = await page.evaluate(() => ({ zoom: map.getZoom(), markers: markersVisible,
        measuring: isMeasuringMultiPoint, filters: filtersPanelVisible, sidebar: currentSidebarState }));
    await page.evaluate(() => setMapChooserVisible(true));
    await expect(page.locator('#map-chooser-close-btn')).toBeFocused();
    for (const key of ['m', 'f', '+', 's', 'h', '/']) await page.keyboard.press(key);
    expect(await page.evaluate(() => ({ zoom: map.getZoom(), markers: markersVisible,
        measuring: isMeasuringMultiPoint, filters: filtersPanelVisible, sidebar: currentSidebarState }))).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(page.locator('#map-chooser')).toBeHidden();
    await page.keyboard.press('m');
    expect(await page.evaluate(() => isMeasuringMultiPoint)).toBe(true);
});

test('mobile keyboard search hands focus to its selected location', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMap(page);
    await page.locator('#mobile-search-launcher-btn').click();
    await page.locator('#poi-search-input').fill('Breads and Dregs');
    await expect(page.locator('#search-results-container [role="option"]').first()).toContainText('Breads and Dregs');
    await page.locator('#poi-search-input').press('Enter');
    await expect(page.locator('.leaflet-popup')).toContainText('Breads and Dregs');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.leaflet-popup'))).toBe(true);
    await expect(page.locator(':focus')).toBeVisible();
});

test('search and feature focusing respect reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMap(page);
    await page.evaluate(() => {
        window.__reviewFlyCalls = [];
        const original = map.flyTo;
        map.flyTo = function (...args) { window.__reviewFlyCalls.push(structuredClone(args[2])); return original.apply(this, args); };
    });
    await page.locator('#poi-search-input').fill('Breads and Dregs');
    await expect(page.locator('#search-results-container [role="option"]').first()).toContainText('Breads and Dregs');
    await page.locator('#poi-search-input').press('Enter');
    expect(await page.evaluate(() => window.__reviewFlyCalls)).toEqual([{ animate: false }]);
    await page.getByRole('button', { name: 'Open details for Breads and Dregs', exact: true }).click();
    await page.evaluate(() => focusSidebarSelectedFeature());
    expect(await page.evaluate(() => window.__reviewFlyCalls.at(-1))).toEqual({ animate: false });
});

test('hidden coordinates do not mutate the coordinate display', async ({ page }) => {
    await openMap(page, 'main_continent');
    const result = await page.evaluate(async () => {
        setCoordsDisplayVisible(false);
        const records = [];
        const observer = new MutationObserver(changes => records.push(...changes));
        observer.observe(coordinateDisplay, { childList: true, subtree: true, characterData: true });
        for (let index = 0; index < 100; index++) map.fire('mousemove', { latlng: L.latLng(1000 + index, 2000 + index) });
        await new Promise(resolve => requestAnimationFrame(resolve));
        records.push(...observer.takeRecords());
        observer.disconnect();
        setCoordsDisplayVisible(true);
        map.fire('mousemove', { latlng: L.latLng(1200, 2300) });
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { hiddenMutations: records.length, visibleText: coordinateDisplay.querySelector('span').textContent };
    });
    expect(result.hiddenMutations).toBe(0);
    expect(result.visibleText).toMatch(/\d+\.\d{2}° [NS], \d+\.\d{2}° [EW]/);
});

test('mobile atlas search keeps visible focus through a delayed map load', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMap(page, 'Astrousia');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/maps/The-Port-City-of-Stomion.json*', async route => { await gate; await route.continue(); });
    await page.locator('#mobile-search-launcher-btn').click();
    await page.locator('#search-scope-atlas-btn').click();
    // Keep the pointer away from results so hover does not select another row.
    await page.mouse.move(0, 0);
    await page.locator('#poi-search-input').fill('Breads and Dregs');
    await expect(page.locator('#search-results-container [role="option"]').first()).toContainText('Breads and Dregs');
    await page.locator('#poi-search-input').press('Enter');
    release();
    await page.waitForFunction(() => currentlyLoadedMapId === 'The-Port-City-of-Stomion');
    await expect(page.locator('.leaflet-popup')).toContainText('Breads and Dregs');
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body &&
        !document.activeElement?.closest('[inert]'))).toBe(true);
    await expect(page.locator(':focus')).toBeVisible();
});

test('desktop Atlas keyboard focus waits for the destination raster to open its popup', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page, 'Astrousia');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const destinationRaster = /\/(?:tile\/The-Port-City-of-Stomion\/|maps\/The-Port-City-of-Stomion\.webp)/;
    await page.route(destinationRaster, async route => {
        await gate;
        await route.continue();
    });

    const search = page.locator('#poi-search-input');
    const details = page.getByRole('button', { name: 'Open details for Breads and Dregs', exact: true });
    try {
        await page.mouse.move(0, 0);
        await search.fill('Breads and Dregs');
        const broaden = page.getByRole('button', { name: 'Search the Atlas', exact: true });
        await expect(page.getByText('No matches on this map.')).toBeVisible();
        await broaden.focus();
        await broaden.press('Enter');
        await expect(page.getByRole('option')).toHaveText(/Breads and Dregs/);
        await search.press('Enter');
        await page.waitForFunction(() => currentlyLoadedMapId === 'The-Port-City-of-Stomion');
        await expect(page.locator('#loading-indicator')).toBeVisible();
        await expect(details).toHaveCount(0);
    } finally {
        release();
    }
    await expect(details).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(search).toBeFocused();
});

test('local search temporarily reveals just the selected marker when markers are hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    const toggle = page.locator('#toggle-markers-btn');
    const search = page.locator('#poi-search-input');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Show Markers & Regions');
    await search.fill('Breads and Dregs');
    await expect(page.getByRole('option')).toHaveText(/Breads and Dregs/);
    await search.press('Enter');
    await expect(page.getByRole('button', { name: 'Open details for Breads and Dregs', exact: true })).toBeFocused();
    expect(await page.evaluate(() => currentMarkerGroup.getLayers().map(layer => layer.poiData.name))).toEqual(['Breads and Dregs']);
    await page.keyboard.press('Escape');
    await expect(search).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-label', 'Show Markers & Regions');
    expect(await page.evaluate(() => currentMarkerGroup.getLayers().length)).toBe(0);
});

test('Atlas navigation expands every ancestor of a selected nested folder map', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page, 'Astrousia');
    const search = page.locator('#poi-search-input');
    await page.locator('#search-scope-atlas-btn').click();
    await page.mouse.move(0, 0);
    await search.fill('IceBeach');
    await expect(page.getByRole('option').first()).toHaveText(/Fair › IceBeach/);
    const selected = page.locator('#map-list .folder-header[data-map-id="IceBeach"]');
    const fair = page.locator('#map-list .folder-header[data-map-id="main_continent"]');
    await expect(fair.locator('.folder-main-action')).toHaveAttribute('aria-expanded', 'false');
    await search.press('Enter');
    await page.waitForFunction(() => currentlyLoadedMapId === 'IceBeach');
    await expect(selected).toHaveClass(/active/);
    await expect(fair.locator('.folder-main-action')).toHaveAttribute('aria-expanded', 'true');
    await expect(selected.locator('.folder-main-action')).toHaveAttribute('aria-expanded', 'true');
});

for (const width of [1440, 390]) {
    test(`skip link reaches search without changing the map URL at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await openMap(page);
        const link = page.getByRole('link', { name: 'Skip map to search', exact: true });
        await expect(link).not.toHaveAttribute('hidden');
        const previousUrl = page.url();
        await page.keyboard.press('Tab');
        await link.focus();
        await expect(link).toBeFocused();
        expect(await link.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        expect((await link.boundingBox()).width).toBeGreaterThan(100);
        await page.keyboard.press('Enter');
        await expect(page.locator('#poi-search-input')).toBeFocused();
        await expect(page.locator('#poi-search-input')).toBeVisible();
        expect(page.url()).toBe(previousUrl);
    });
}
