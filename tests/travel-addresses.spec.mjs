import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPreviewServer } = require('../scripts/preview_server.js');
const T = require('../js/travel-network.js');
let server, base;
const fixture = () => ({ ...JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'))), scalePixels: 1000, scaleKilometers: 1, regions: [], pointsOfInterest: [], travelNodes: [], transportReview: undefined, lines: [{ id: 'harbor', streetId: 'harbor-street', name: 'Harbor Street', type: 'Travel', coordinates: [[2000, 1000], [2000, 5000], [5000, 5000]], travelMode: 'road', travelFrom: 'West Gate', travelTo: 'North Gate', travelSpeedKph: 5, travelFareGp: 0 }], buildings: [
    { id: 'home', address: '12 Harbor Street', number: 12, streetId: 'harbor-street', name: 'The Lantern', aliases: ['Lantern Inn'], coordinates: [2200, 1500], footprint: [[2100, 1400], [2100, 1600], [2300, 1600], [2300, 1400]], entrance: [2200, 1500], access: { lineId: 'harbor', coordinates: [2000, 1500], custom: 'access retained' }, custom: { retained: true } },
    { id: 'shop', address: '18 Harbor Street', number: 18, streetId: 'harbor-street', coordinates: [2200, 3000], footprint: [[2100, 2900], [2100, 3100], [2300, 3100], [2300, 2900]], entrance: [2200, 3000], access: { lineId: 'harbor', coordinates: [2000, 3000] } },
    { id: 'north', address: '30 Harbor Street', number: 30, streetId: 'harbor-street', coordinates: [4500, 5200], footprint: [[4400, 5100], [4400, 5300], [4600, 5300], [4600, 5100]], entrance: [4500, 5200], access: { lineId: 'harbor', coordinates: [4500, 5000] } }
] });
test.beforeAll(async () => {
    server = createPreviewServer({ repoRoot: path.resolve(import.meta.dirname, '..') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
async function viewer(page, data) {
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#directions-btn').click();
}
test('open courtyards stay out of roof click areas', async ({ page }, testInfo) => {
    const data = fixture();
    const outer = [[2800, 2800], [2800, 3200], [3200, 3200], [3200, 2800]], hole = [[2900, 2900], [2900, 3100], [3100, 3100], [3100, 2900]];
    data.lines = [{ id: 'court', name: 'Court Lane', travelMode: 'road', travelFrom: 'Court west', travelTo: 'Court east', coordinates: [[3000, 2950], [3000, 3050]], travelSpeedKph: 5, travelFareGp: 0 }];
    data.buildings = [{ id: 'hall', address: '1 Court Lane', number: 1, coordinates: [2850, 3000], entrance: [2900, 3000], footprint: outer, footprintHoles: [hole], access: { lineId: 'court', coordinates: [3000, 3000], path: [[2900, 3000], [3000, 3000]] } }];
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 }); await viewer(page, data);
    await page.getByRole('button', { name: 'Close directions', exact: true }).click();
    await page.evaluate(() => map.setView([3000, 3000], 0, { animate: false }));
    const clickMap = async point => {
        const p = await page.evaluate(point => { const p = map.latLngToContainerPoint(point), box = map.getContainer().getBoundingClientRect(); return { x: p.x + box.x, y: p.y + box.y }; }, point);
        await page.mouse.click(p.x, p.y);
    };
    await clickMap([2850, 3000]); await expect(page.locator('.city-address-popup')).toContainText('1 Court Lane');
    await page.evaluate(() => map.closePopup()); await clickMap([3000, 3000]); await expect(page.locator('.city-address-popup')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('typed addresses, keyboard suggestions, aliases, reverse routes and unknown address feedback on desktop/mobile', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await viewer(page, fixture());
    const from = page.locator('#travel-from'), to = page.locator('#travel-to');
    await expect(page.getByRole('button', { name: 'Find route', exact: true })).toBeDisabled();
    await expect(page.locator('.travel-field-marker')).toHaveText(['A', 'B']);
    await from.fill('Lantern'); await expect(from).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#travel-from-suggestions')).toContainText('12 Harbor Street');
    await expect(page.locator('#travel-from-suggestions strong')).toHaveText('The Lantern');
    await from.press('ArrowDown'); await expect(from).toHaveAttribute('aria-activedescendant', 'travel-from-option-0'); await from.press('Enter'); await expect(from).toHaveValue('12 Harbor Street');
    await expect(to).toBeFocused();
    await expect(page.locator('#travel-from-hint')).toHaveText('The Lantern');
    await to.fill('18 harbor st.'); await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-total')).toHaveText('1.9 km · Free');
    await expect(page.locator('.travel-result-line')).toHaveCount(3); await expect(page.locator('.travel-start-building, .travel-destination-building, .city-house-number, .city-address-key')).toHaveCount(0); await expect(page.locator('.travel-start-marker, .travel-destination-marker')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('address-directions-desktop.png') });
    await page.getByRole('button', { name: 'Swap start and destination' }).click(); await page.getByRole('button', { name: 'Find route', exact: true }).click(); await expect(page.locator('.travel-total')).toHaveText('1.9 km · Free');
    await from.fill('Unknown house'); await expect(page.locator('#travel-from-hint')).toContainText('No mapped places');
    await page.getByRole('button', { name: 'Find route', exact: true }).click(); await expect(page.locator('.travel-results')).toContainText('Choose a mapped address'); await expect(page.locator('.travel-result-line')).toHaveCount(0);
    await expect(from).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Clear start', exact: true }).click();
    await expect(from).toHaveValue(''); await expect(from).toBeFocused();
    await expect(from).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByRole('button', { name: 'Find route', exact: true })).toBeDisabled();
    await from.fill('Lantern Inn'); await to.fill('30 Harbor Street'); await page.getByRole('button', { name: 'Find route', exact: true }).click(); await expect(page.locator('.travel-total')).toContainText('6.4 km');
    await page.getByRole('button', { name: 'Close directions' }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForFunction(() => isMobileLayoutActive);
    await page.locator('#mobile-tools-launcher-btn').click(); await page.locator('#mobile-directions-btn').click(); await expect(page.locator('#travel-panel')).toBeVisible();
    await from.fill('12 Harbor'); await from.press('ArrowDown'); await from.press('Enter'); await to.fill('18 Harbor Street'); await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-total')).toHaveText('1.9 km · Free'); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.locator('#travel-panel').evaluate(panel => panel.scrollTop = 0); await page.screenshot({ path: testInfo.outputPath('address-directions-mobile.png') }); expect(errors).toEqual([]);
});
test('address maps enable existing ferries and explain when walking-only travel cannot reach an island', async ({ page }) => {
    const data = fixture();
    data.lines.push({ id: 'island-ferry', name: 'Island ferry', type: 'Travel', coordinates: [[5000, 5000], [6000, 6000]], travelMode: 'ferry', travelFrom: 'North Gate', travelTo: 'Island Landing', travelSpeedKph: 8, travelFareGp: 2 });
    data.lines.push({ id: 'island-road', name: 'Island Lane', type: 'Travel', coordinates: [[6000, 6000], [6000, 7000]], travelMode: 'road', travelFrom: 'Island Landing', travelTo: 'East Landing', travelSpeedKph: 5, travelFareGp: 0 });
    data.buildings.push({ id: 'island-house', address: '1 Island Lane', number: 1, coordinates: [6200, 6600], entrance: [6200, 6600], access: { lineId: 'island-road', coordinates: [6000, 6600] }, footprint: [[6100, 6500], [6100, 6700], [6300, 6700], [6300, 6500]] });
    await viewer(page, data);
    await expect(page.getByLabel('Ferry', { exact: true })).toBeChecked(); await expect(page.getByLabel('Train', { exact: true })).not.toBeChecked();
    await page.locator('#travel-from').fill('12 Harbor Street'); await page.locator('#travel-to').fill('1 Island Lane'); await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-total')).toContainText('2 gp'); await expect(page.locator('.travel-results')).toContainText('Island ferry');
    await page.locator('.travel-options > summary').click(); await page.getByLabel('Ferry', { exact: true }).uncheck(); await page.getByRole('button', { name: 'Find route', exact: true }).click(); await expect(page.locator('.travel-results')).toContainText('This journey needs a ferry. Enable Ferry');
});


test('city inputs stay above the itinerary and contiguous street sections hide internal junction names', async ({ page }) => {
    const data = fixture(); T.splitLink(data, data.lines[0], 0, [2000, 3000], data.lines);
    await viewer(page, data); await page.locator('#travel-from').fill('12 Harbor Street'); await page.locator('#travel-to').fill('30 Harbor Street'); await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-results li')).toHaveCount(3); await expect(page.locator('.travel-results')).toContainText('Continue along Harbor Street'); await expect(page.locator('.travel-results')).not.toContainText('Junction');
    const from = await page.locator('#travel-from').boundingBox(), results = await page.locator('.travel-results').boundingBox(); expect(from.y).toBeLessThan(results.y); expect(from.y).toBeLessThan(300);
});

test('city suggestions include named landmark entrances and exclude technical junctions', async ({ page }) => {
    const data = fixture(); T.ensureNodes(data);
    const landmark = data.travelNodes.find(node => node.name === 'North Gate'); landmark.name = 'The Waterlock'; landmark.kind = 'landmark';
    await viewer(page, data); await page.locator('#travel-from').fill('12 Harbor Street'); await page.locator('#travel-to').fill('Waterlock');
    await expect(page.locator('#travel-to-suggestions')).toContainText('The Waterlock'); await expect(page.locator('#travel-to-suggestions')).not.toContainText('West Gate');
    await page.locator('#travel-to').press('ArrowDown'); await page.locator('#travel-to').press('Enter');
    await expect(page.locator('#travel-to')).toHaveValue('The Waterlock'); await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-total')).toContainText('6.7 km'); await expect(page.locator('.travel-endpoints')).toContainText('The Waterlock');
});

test('a coordinate-only address has a clickable hit area at a usable zoom', async ({ page }) => {
    const data = fixture();
    data.buildings = [{ id: 'simple', address: '12 Harbor Street', number: 12, coordinates: [2200, 1500], access: { lineId: 'harbor', coordinates: [2000, 1500] } }];
    await page.setViewportSize({ width: 1440, height: 1000 });
    await viewer(page, data);
    await page.getByRole('button', { name: 'Close directions', exact: true }).click();
    const lowZoomPoint = await page.evaluate(() => {
        map.setView([2200, 1500], map.getMinZoom(), { animate: false });
        const point = map.latLngToContainerPoint([2200, 1500]);
        const box = map.getContainer().getBoundingClientRect();
        return { x: box.x + point.x, y: box.y + point.y };
    });
    await page.mouse.click(lowZoomPoint.x, lowZoomPoint.y);
    await expect(page.locator('.city-address-popup')).toHaveCount(0);
    const geometry = await page.evaluate(() => {
        map.setView([2200, 1500], map.getMaxZoom(), { animate: false });
        const bounds = CityAddresses.boundsOf(currentMapData.buildings[0]);
        const point = map.latLngToContainerPoint([2200, 1500]);
        const box = map.getContainer().getBoundingClientRect();
        return { bounds, point: { x: box.x + point.x, y: box.y + point.y } };
    });
    expect(geometry.bounds[0][0]).toBeLessThan(geometry.bounds[1][0]);
    expect(geometry.bounds[0][1]).toBeLessThan(geometry.bounds[1][1]);
    await page.mouse.click(geometry.point.x, geometry.point.y);
    await expect(page.locator('.city-address-popup')).toContainText('12 Harbor Street');
});
