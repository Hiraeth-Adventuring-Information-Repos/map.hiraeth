import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMapFileServer } = require('../scripts/map_file_server.js');
let server, base;
const segment = (name, from, to, coordinates, extra = {}) => ({ id: name, name, type: 'Travel', coordinates, travelMode: 'road', travelFrom: from, travelTo: to, travelSpeedKph: 5, travelFareGp: 0, ...extra });
const makeMap = () => ({ ...JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'))), scalePixels: 100, scaleKilometers: 1, travelNodes: [], transportReview: undefined, pointsOfInterest: [], lines: [
    segment('Harbor road', 'Town', 'Port', [[1000, 1000], [1000, 2000]], { travelOcclusions: [[[950, 1400], [1050, 1400], [1050, 1600], [950, 1600]]] }),
    segment('Island ferry', 'Port', 'Island', [[1000, 2000], [2000, 2000]], { travelMode: 'ferry', travelSpeedKph: 10, travelFareGp: 2 }),
    segment('Ridge trail', 'Town', 'Island', [[1000, 1000], [2000, 1000], [2000, 2000]], { travelMode: 'trail', travelSpeedKph: 3 })
] });
test.beforeAll(async () => {
    server = createMapFileServer({ repoRoot: path.resolve(import.meta.dirname, '..'), allowedHosts: '127.0.0.1' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

async function expectEndpointConnector(page) {
    const geometry = await page.locator('.travel-inputs').evaluate(inputs => {
        const labels = [...inputs.querySelectorAll('.travel-address-field')];
        const first = labels[0], line = getComputedStyle(first, '::before');
        const centers = labels.map(label => { const r = label.querySelector('.travel-field-marker').getBoundingClientRect(); return r.y + r.height / 2; });
        const start = first.getBoundingClientRect().y + parseFloat(line.top);
        return { start, end: start + parseFloat(line.height), centers };
    });
    expect(Math.abs(geometry.start - geometry.centers[0])).toBeLessThan(1);
    expect(Math.abs(geometry.end - geometry.centers[1])).toBeLessThan(1);
}

test('routing is absent by default, requires the URL flag and does not persist after it is removed', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = makeMap(); data.lines[0].travelVisible = true;
    data.buildings = [{ id: 'home', name: 'The Lantern', address: '12 Harbor Road', number: 12,
        coordinates: [1100, 1100], footprint: [[1050, 1050], [1050, 1150], [1150, 1150], [1150, 1050]],
        entrance: [1100, 1100], access: { lineId: 'Harbor road', coordinates: [1000, 1100] } }];
    data.pointsOfInterest = [{ name: 'The Lantern', type: 'Tavern', coords: [1100, 1100], buildingId: 'home', address: '12 Harbor Road' }];
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    const load = async query => {
        await page.goto(`${base}/index.html${query}#main_continent-s=o`);
        await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
        await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    };
    for (const query of ['', '?routing=0', '?routing=true']) {
        await load(query);
        await expect(page.locator('#directions-btn')).toBeHidden();
        await expect(page.locator('#mobile-directions-btn')).toBeHidden();
        await expect(page.locator('#travel-panel, .travel-network-line')).toHaveCount(0);
        expect(await page.evaluate(() => travelPlanner === null && cityAddresses === null)).toBe(true);
        expect(await page.evaluate(() => buildPopupHeader(currentMapData.pointsOfInterest[0], 'poi', ''))).not.toContain('address-directions');
    }
    await load('?routing=1');
    await expect(page.locator('#directions-btn')).toBeVisible();
    await expect(page.locator('.travel-network-line')).toHaveCount(1);
    expect(await page.evaluate(() => travelPlanner !== null && cityAddresses !== null)).toBe(true);
    expect(await page.evaluate(() => buildPopupHeader(currentMapData.pointsOfInterest[0], 'poi', ''))).toContain('address-directions');
    expect(await page.locator('#map-editor-link').getAttribute('href')).toContain('routing=1');
    expect(new URL(await page.evaluate(() => buildCurrentViewShareUrl())).searchParams.get('routing')).toBe('1');
    await page.evaluate(() => setSidebarState('c', true));
    expect(new URL(page.url()).searchParams.get('routing')).toBe('1');
    await page.evaluate(() => loadMap('Astrousia'));
    await expect(page.locator('#directions-btn')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('routing')).toBe('1');
    await load('');
    await expect(page.locator('#directions-btn')).toBeHidden();
    await expect(page.locator('#travel-panel')).toHaveCount(0);
    expect(await page.locator('#map-editor-link').getAttribute('href')).not.toContain('routing=1');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => isMobileLayoutActive);
    await page.locator('#mobile-tools-launcher-btn').click();
    await expect(page.locator('#mobile-directions-btn')).toBeHidden();
    await expect(page.locator('#travel-panel')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('editor routing tools require opt-in and ordinary downloads retain routing data', async ({ page }, testInfo) => {
    const data = makeMap();
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(`${base}/studio/editor?map=main_continent`);
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await expect(page.getByRole('button', { name: 'Travel network', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Features', exact: true }).click();
    await page.locator('#editor-feature-type-select').selectOption('lines');
    await page.getByRole('button', { name: /Harbor road/ }).first().click();
    await expect(page.locator('[data-feature-section="travel-routing"]')).toHaveCount(0);
    await page.locator('#feature-lines-name').fill('Reviewed harbor road');
    await page.locator('#feature-lines-name').press('Tab');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click();
    const download = await pending, output = testInfo.outputPath('normal-editor-routing-preserved.json');
    await download.saveAs(output); const saved = JSON.parse(fs.readFileSync(output));
    expect(saved.lines[0]).toEqual({ ...data.lines[0], name: 'Reviewed harbor road' });
    await page.goto(`${base}/studio/editor?routing=1&map=main_continent`);
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    await expect(page.locator('#editor-network-panel')).toBeVisible();
    await page.goto(`${base}/studio/editor?map=main_continent`);
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await expect(page.getByRole('button', { name: 'Travel network', exact: true })).toHaveCount(0);
    await expect(page.locator('#editor-network-panel')).toBeHidden();
});

test('directions docks beside the canvas, restores the Atlas and becomes a mobile sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: makeMap() }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=o');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    const panel = page.locator('#travel-panel'), sidebar = page.locator('#sidebar');
    for (const state of ['o', 'c']) {
        await page.evaluate(state => setSidebarState(state, false), state);
        await page.locator('#directions-btn').click();
        await expect(sidebar).toBeHidden();
        await expect(page.locator('#toggle-sidebar-btn')).toBeHidden();
        const dock = await panel.boundingBox(), canvas = await page.locator('#map').boundingBox();
        expect(dock.x).toBe(0); expect(dock.y).toBe(0); expect(dock.height).toBe(1000);
        expect(canvas.x).toBe(dock.x + dock.width); expect(canvas.width + dock.width).toBe(1440);
        expect(await page.evaluate(() => map.getSize().x)).toBe(canvas.width);
        await page.locator('#travel-from').fill('Town'); await page.locator('#travel-to').fill('Island');
        await page.getByRole('button', { name: 'Find route', exact: true }).click();
        await expect(page.locator('.travel-total')).toBeVisible();
        for (const endpoint of await page.locator('.travel-map-endpoint').all()) {
            const bounds = await endpoint.boundingBox(); expect(bounds.x).toBeGreaterThan(canvas.x);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvas.x + canvas.width);
        }
        await page.getByRole('button', { name: 'Close directions', exact: true }).click();
        await expect(panel).toBeHidden();
        expect(await page.locator('.container').evaluate(el => el.classList.contains('sidebar-collapsed'))).toBe(state === 'c');
        await expect(page.locator('#directions-btn')).toBeFocused();
        if (state === 'o') await expect(sidebar).toBeVisible();
    }
    await page.locator('#directions-btn').click();
    await page.setViewportSize({ width: 900, height: 500 });
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(320);
    await page.locator('.travel-options > summary').click();
    await panel.evaluate(el => el.scrollTop = el.scrollHeight);
    await expect(page.getByRole('button', { name: 'Close directions', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => isMobileLayoutActive);
    const sheet = await panel.boundingBox(), canvas = await page.locator('#map').boundingBox();
    expect(sheet.x).toBe(10); expect(sheet.width).toBe(370); expect(sheet.y).toBeGreaterThan(0);
    expect(canvas.x).toBe(0); expect(canvas.width).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('route cards, transport buttons and focused steps keep the map clean on desktop and mobile', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: makeMap() }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#directions-btn').click();
    await expectEndpointConnector(page);
    await expect(page.getByRole('button', { name: 'Train + walk', exact: true })).toBeHidden();
    await expect(page.locator('.travel-profile svg')).toHaveCount(4);
    await page.locator('#travel-from').fill('Town'); await page.locator('#travel-to').fill('Island');
    await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-route-card')).toHaveCount(2);
    await expectEndpointConnector(page);
    await expect(page.getByRole('button', { name: 'Fastest route', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.travel-alternative-line')).toHaveCount(1);
    await expect(page.locator('.travel-start-marker')).toHaveText('A'); await expect(page.locator('.travel-destination-marker')).toHaveText('B');
    await expect(page.locator('.travel-start-building, .travel-destination-building, .city-house-number, .city-address-key')).toHaveCount(0);
    await page.getByRole('button', { name: 'Lowest known fare route', exact: true }).click();
    await expect(page.locator('.travel-total')).toContainText('Free'); await expect(page.locator('.travel-result-line')).toHaveCount(1);
    await page.getByRole('button', { name: 'Fastest route', exact: true }).click();
    await page.locator('.travel-steps > summary').click();
    await page.locator('.travel-step').first().click();
    await expect(page.locator('.travel-active-step')).toHaveCount(1);
    await expect(page.locator('.travel-step').first()).toHaveAttribute('aria-current', 'step');
    expect((await page.locator('.travel-active-step').getAttribute('d')).match(/M/g)).toHaveLength(2);
    await page.getByRole('button', { name: 'Route overview', exact: true }).click(); await expect(page.locator('.travel-active-step')).toHaveCount(0);
    await page.getByRole('button', { name: 'Walk', exact: true }).click();
    await expect(page.locator('.travel-route-card')).toHaveCount(1); await expect(page.locator('.travel-total')).toContainText('Free');
    await expect(page.getByRole('button', { name: 'Walk', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Ferry', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Boat + walk', exact: true }).click(); await expect(page.locator('.travel-total')).toContainText('2 gp');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectEndpointConnector(page);
    for (const selector of ['.travel-close', '.travel-expand', '.travel-swap', '.travel-field-clear:not([hidden])', '.travel-options > summary', '.travel-steps > summary']) {
        for (const target of await page.locator(selector).all()) {
            const box = await target.boundingBox();
            expect(box.height, selector).toBeGreaterThanOrEqual(44);
            expect(box.width, selector).toBeGreaterThanOrEqual(44);
        }
    }
    await expect(page.getByRole('button', { name: 'Expand directions panel', exact: true })).toBeVisible();
    const small = await page.locator('#travel-panel').boundingBox();
    await page.getByRole('button', { name: 'Expand directions panel', exact: true }).click();
    const large = await page.locator('#travel-panel').boundingBox(); expect(large.height).toBeGreaterThan(small.height);
    await page.getByRole('button', { name: 'Collapse directions panel', exact: true }).click();
    await expect(page.locator('.travel-result-line')).toHaveCount(2);
    await page.locator('.travel-steps > summary').click();
    await expect(page.locator('#travel-from')).toBeHidden();
    await page.locator('.travel-step').first().click();
    await expect(page.locator('.travel-active-step')).toHaveCount(1);
    await page.getByRole('button', { name: 'Collapse directions panel', exact: true }).click();
    await expect(page.locator('.travel-steps')).not.toHaveAttribute('open', '');
    await expect(page.locator('.travel-active-step')).toHaveCount(0);
    await expect(page.locator('#travel-from')).toBeVisible();
    await expectEndpointConnector(page);
    await page.locator('.travel-steps > summary').click();
    await page.getByRole('button', { name: 'Edit journey', exact: true }).click();
    await expect(page.locator('#travel-from')).toBeVisible(); await expect(page.locator('#travel-from')).toBeFocused();
    await page.getByRole('button', { name: 'Clear route', exact: true }).click();
    await expect(page.locator('.travel-result-line, .travel-alternative-line, .travel-map-endpoint')).toHaveCount(0);
    await expect(page.locator('#travel-from')).toHaveValue('Town');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); expect(errors).toEqual([]);
});

test('hidden network, mixed routes, known fares, mode restrictions and map changes on desktop and mobile', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = makeMap();
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await expect(page.locator('.travel-network-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Plan a journey', exact: true }).click();
    await page.locator('#travel-from').fill('Town'); await page.locator('#travel-to').fill('Island');
    await page.getByRole('button', { name: 'Find route' }).click();
    await expect(page.locator('.travel-total')).toHaveText('20 km · 2 gp');
    await expect(page.locator('.travel-result-line')).toHaveCount(2);
    expect((await page.locator('.travel-result-line').first().getAttribute('d')).match(/M/g)).toHaveLength(2);
    await page.getByLabel('Show the whole travel network').check();
    await expect(page.locator('.travel-network-line')).toHaveCount(3);
    expect((await page.locator('.travel-network-line').first().getAttribute('d')).match(/M/g)).toHaveLength(2);
    await page.getByLabel('Show the whole travel network').uncheck();
    await expect(page.locator('.travel-network-line')).toHaveCount(0);
    await expect(page.locator('.travel-result-line')).toHaveCount(2);
    await page.locator('#travel-panel').evaluate(panel => panel.scrollTop = 0);
    await page.screenshot({ path: testInfo.outputPath('directions-desktop.png') });
    await page.locator('.travel-options > summary').click();
    await page.locator('#travel-preference').selectOption('cheapest');
    await expect(page.locator('.travel-result-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Find route' }).click();
    await expect(page.locator('.travel-total')).toContainText('Free');
    await expect(page.locator('.travel-results li')).toHaveCount(1);
    await page.getByLabel('Trail', { exact: true }).uncheck();
    await page.getByLabel('Ferry', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Find route' }).click();
    await expect(page.locator('.travel-results')).toContainText('No connected route');
    await expect(page.locator('.travel-result-line')).toHaveCount(0);
    await page.getByLabel('Ferry', { exact: true }).check();
    await page.getByRole('button', { name: 'Find route' }).click();
    await page.getByRole('button', { name: 'Close directions' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => isMobileLayoutActive);
    await page.locator('#mobile-tools-launcher-btn').click();
    await page.locator('#mobile-directions-btn').click();
    await expect(page.locator('#travel-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Find route' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(page.locator('#mobile-tools-card')).toHaveAttribute('aria-hidden', 'true');
    await page.locator('#travel-panel').evaluate(panel => panel.scrollTop = 0);
    await page.screenshot({ path: testInfo.outputPath('directions-mobile.png'), animations: 'disabled' });
    await page.locator('#travel-from').focus();
    if (await page.locator('#travel-from').getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('#travel-panel')).toBeHidden();
    await expect(page.locator('#mobile-tools-launcher-btn')).toBeFocused();
    await page.route('**/maps/The-Port-City-of-Stomion.json*', route => route.fulfill({ json: { ...JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/The-Port-City-of-Stomion.json'))), lines: [], roads: [], travelNodes: [], buildings: [] } }));
    await page.evaluate(() => loadMap('The-Port-City-of-Stomion'));
    await expect(page.locator('.travel-result-line')).toHaveCount(0);
    await expect(page.locator('#directions-btn')).toBeHidden();
    await page.locator('#mobile-tools-launcher-btn').click();
    await expect(page.locator('#mobile-directions-btn')).toBeHidden();
    await expect(page.locator('#travel-panel')).toBeHidden();
    expect(errors).toEqual([]);
});

test('left toolbar offers A to B on supported maps in both layouts and updates after a map change', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = makeMap();
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.route('**/maps/The-Port-City-of-Stomion.json*', route => route.fulfill({ json: { ...data, lines: [], roads: [], travelNodes: [], buildings: [] } }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await expect(page.locator('#directions-btn')).toBeVisible();
    await expect(page.locator('#directions-btn svg')).toHaveCount(1);
    await page.locator('#directions-btn').click();
    await expect(page.locator('#travel-panel')).toBeVisible();
    await expect(page.locator('#directions-btn')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#travel-from').press('Escape');
    await expect(page.locator('#directions-btn')).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => isMobileLayoutActive);
    await expect(page.locator('#directions-btn')).toBeVisible();
    const bounds = await page.locator('#directions-btn').boundingBox();
    expect(bounds.x).toBeLessThan(60); expect(bounds.width).toBeGreaterThanOrEqual(44);
    await page.locator('#directions-btn').click();
    await expect(page.locator('#travel-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Close directions' }).click();
    await expect(page.locator('#directions-btn')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('left-journey-button-mobile.png') });
    await page.evaluate(() => loadMap('The-Port-City-of-Stomion'));
    await expect(page.locator('#directions-btn')).toBeHidden();
    await expect(page.locator('#mobile-directions-btn')).toBeHidden();
    await page.evaluate(() => loadMap('main_continent'));
    await expect(page.locator('#directions-btn')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => !isMobileLayoutActive);
    await expect(page.locator('#directions-btn')).toBeVisible();
    await page.goto(base + '/index.html?embed=true&routing=1#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await expect(page.locator('#directions-btn')).toBeHidden();
    expect(errors).toEqual([]);
});

test('editor configures, connects, recovers and downloads routing without changing unrelated map data', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = makeMap();
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/studio/editor?routing=1');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-map-id="main_continent"]').first().click();
    await page.getByRole('button', { name: 'Features', exact: true }).click();
    await page.locator('#editor-feature-type-select').selectOption('lines');
    await page.getByRole('button', { name: /Harbor road/ }).first().click();
    await page.locator('[data-feature-section="travel-routing"] > summary').click();
    await expect(page.locator('[data-field="travelMode"]')).toHaveValue('road');
    await page.locator('[data-field="travelSpeedKph"]').fill('6');
    await page.locator('[data-field="travelFareGp"]').fill('1.5');
    await page.getByLabel('Show route on map by default').check();
    await page.locator('[data-field="travelFareGp"]').press('Tab');
    await page.reload();
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-feature-section="travel-routing"] > summary').click();
    await expect(page.locator('[data-field="travelSpeedKph"]')).toHaveValue('6');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click();
    const download = await pending, output = testInfo.outputPath('travel-map.json'); await download.saveAs(output);
    const result = JSON.parse(fs.readFileSync(output));
    const expected = structuredClone(data); Object.assign(expected.lines[0], { travelSpeedKph: 6, travelFareGp: 1.5, travelVisible: true, travelOneWay: false });
    expect(result).toEqual(expected);
    await page.screenshot({ path: testInfo.outputPath('travel-editor.png') });
    expect(errors).toEqual([]);
});

test('draw and connect a new route, validate missing settings, and show default-visible routes', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = makeMap(); data.lines[0].travelVisible = true;
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/studio/editor?routing=1');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-map-id="main_continent"]').first().click();
    await page.locator('#editor-add-line-btn').click();
    await page.locator('#editor-map').click({ position: { x: 340, y: 270 } });
    await page.locator('#editor-map').click({ position: { x: 460, y: 320 } });
    await page.locator('#editor-finish-draw-btn').click();
    await page.locator('#editor-feature-form [data-field="name"]').fill('Station approach');
    await page.locator('[data-feature-section="travel-routing"] > summary').click();
    await page.locator('[data-field="travelMode"]').selectOption('rail');
    await expect(page.locator('[data-field="travelSpeedKph"]')).toHaveValue('40');
    await page.locator('#save-current-map-btn').click();
    await expect(page.locator('#editor-export-status')).toContainText('name both endpoints');
    await page.locator('[data-field="travelFrom"]').fill('Town');
    await page.locator('[data-field="travelTo"]').fill('Station');
    await page.locator('[data-field="travelFareGp"]').fill('3');
    await page.getByLabel('One way: start to end').check();
    await page.locator('[data-field="travelFareGp"]').press('Tab');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click();
    const download = await pending, output = testInfo.outputPath('new-travel-map.json'); await download.saveAs(output);
    const saved = JSON.parse(fs.readFileSync(output)), line = saved.lines.find(line => line.name === 'Station approach');
    expect(line.coordinates[0]).toEqual([1000, 1000]);
    expect(line.travelMode).toBe('rail'); expect(line.travelOneWay).toBe(true); expect(line.travelFareGp).toBe(3);
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: saved }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=c');
    await expect(page.locator('.travel-network-line')).toHaveCount(1);
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#directions-btn').click();
    await page.locator('#travel-from').fill('Town'); await page.locator('#travel-to').fill('Station');
    await page.getByRole('button', { name: 'Find route' }).click();
    await expect(page.locator('.travel-results')).toContainText('Station approach');
    await page.getByRole('button', { name: 'Swap start and destination' }).click();
    await page.getByRole('button', { name: 'Find route' }).click();
    await expect(page.locator('.travel-results')).toContainText('No connected route');
    expect(errors).toEqual([]);
});
