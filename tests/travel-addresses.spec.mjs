import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMapFileServer } = require('../scripts/map_file_server.js');
const T = require('../js/travel-network.js');
let server, base;
const fixture = () => ({ ...JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'))), scalePixels: 1000, scaleKilometers: 1, regions: [], pointsOfInterest: [], travelNodes: [], transportReview: undefined, lines: [{ id: 'harbor', streetId: 'harbor-street', name: 'Harbor Street', type: 'Travel', coordinates: [[2000, 1000], [2000, 5000], [5000, 5000]], travelMode: 'road', travelFrom: 'West Gate', travelTo: 'North Gate', travelSpeedKph: 5, travelFareGp: 0 }], buildings: [
    { id: 'home', address: '12 Harbor Street', number: 12, streetId: 'harbor-street', name: 'The Lantern', aliases: ['Lantern Inn'], coordinates: [2200, 1500], footprint: [[2100, 1400], [2100, 1600], [2300, 1600], [2300, 1400]], entrance: [2200, 1500], access: { lineId: 'harbor', coordinates: [2000, 1500], custom: 'access retained' }, custom: { retained: true } },
    { id: 'shop', address: '18 Harbor Street', number: 18, streetId: 'harbor-street', coordinates: [2200, 3000], footprint: [[2100, 2900], [2100, 3100], [2300, 3100], [2300, 2900]], entrance: [2200, 3000], access: { lineId: 'harbor', coordinates: [2000, 3000] } },
    { id: 'north', address: '30 Harbor Street', number: 30, streetId: 'harbor-street', coordinates: [4500, 5200], footprint: [[4400, 5100], [4400, 5300], [4600, 5300], [4600, 5100]], entrance: [4500, 5200], access: { lineId: 'harbor', coordinates: [4500, 5000] } }
] });
test.beforeAll(async () => {
    server = createMapFileServer({ repoRoot: path.resolve(import.meta.dirname, '..'), allowedHosts: '127.0.0.1' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
async function viewer(page, data) {
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/index.html#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await page.locator('#directions-btn').click();
}
test('open courtyards stay out of roof click areas and survive editor changes and download', async ({ page }, testInfo) => {
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
    await page.goto(`${base}/studio/editor?map=main_continent`);
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    const panel = page.locator('#editor-network-panel');
    await panel.locator('.network-address-list > summary').click(); await panel.getByLabel('Find a building address').fill('1 Court');
    await panel.getByRole('button', { name: '1 Court Lane', exact: true }).click();
    await panel.locator('.network-selection details > summary').filter({ hasText: 'Open courtyards' }).click();
    const field = panel.getByLabel('Courtyard corners (X, Y; blank line between courtyards)', { exact: true });
    await expect(field).toHaveValue('2900, 2900\n3100, 2900\n3100, 3100\n2900, 3100');
    const changed = hole.map(point => point.map(value => value + 10));
    await field.fill(changed.map(point => `${point[1]}, ${point[0]}`).join('\n')); await field.press('Tab');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click();
    const file = await pending, output = testInfo.outputPath('courtyard-map.json'); await file.saveAs(output);
    const saved = JSON.parse(fs.readFileSync(output)); expect(saved.buildings).toHaveLength(1); expect(saved.buildings[0].footprintHoles).toEqual([changed]);
    expect(T.validate(saved)).toEqual([]); expect(T.route(T.build(saved), '1 Court Lane', 'Court east')).toBeTruthy(); expect(errors).toEqual([]);
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
test('building address editing preserves metadata, updates access and exports working routes; used street cannot be deleted', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = fixture(); data.pointsOfInterest = [{ id: 'lantern-place', name: 'The Lantern', type: 'Tavern', coordinates: [2200, 1500], buildingId: 'home', address: '12 Harbor Street', description: 'Keep the place.' }];
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data })); await page.goto(base + '/studio/editor');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false'); await page.locator('[data-map-id="main_continent"]').first().click(); await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    const panel = page.locator('#editor-network-panel'); await panel.locator('summary').filter({ hasText: 'Building addresses' }).click(); await panel.getByLabel('Find a building address').fill('Lantern'); await panel.getByRole('button', { name: '12 Harbor Street · The Lantern', exact: true }).click();
    await expect(panel.getByLabel('Full address')).toHaveValue('12 Harbor Street'); await panel.getByLabel('Entrance Y', { exact: true }).fill('2250'); await panel.getByLabel('Entrance Y', { exact: true }).press('Tab');
    await panel.getByLabel('House number').fill('14'); await panel.getByLabel('House number').press('Tab'); await expect(panel.getByLabel('Full address')).toHaveValue('14 Harbor Street');
    await panel.locator('summary').filter({ hasText: 'Test a journey' }).click(); await page.locator('#network-test-from').fill('14 Harbor Street'); await page.locator('#network-test-to').fill('18 Harbor Street'); await panel.getByRole('button', { name: 'Calculate journey' }).click(); await expect(panel.locator('.network-test-result')).toContainText('1.95 km');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const download = await pending, output = testInfo.outputPath('addresses-edited.json'); await download.saveAs(output); const saved = JSON.parse(fs.readFileSync(output));
    expect(saved.buildings[0].custom).toEqual({ retained: true }); expect(saved.buildings[0].access.custom).toBe('access retained'); expect(saved.buildings[0].entrance).toEqual([2250, 1500]); expect(saved.buildings[0].access.coordinates).toEqual([2000, 1500]); expect(saved.pointsOfInterest[0].address).toBe('14 Harbor Street'); expect(T.validate(saved)).toEqual([]); expect(T.route(T.build(saved), '14 Harbor Street', '18 Harbor Street').km).toBeCloseTo(1.95);
    await panel.locator('summary').filter({ hasText: 'Connection points & links' }).click(); await panel.getByRole('button', { name: 'Road · Harbor Street', exact: true }).click(); await expect(panel.getByRole('button', { name: 'Delete transport link' })).toBeDisabled();
    await panel.getByLabel('Find a building address').fill('Lantern'); await panel.getByRole('button', { name: '14 Harbor Street · The Lantern', exact: true }).click(); await panel.getByRole('button', { name: 'Delete address', exact: true }).click();
    const removedPending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const removedDownload = await removedPending, removedOutput = testInfo.outputPath('place-address-removed.json'); await removedDownload.saveAs(removedOutput); const removed = JSON.parse(fs.readFileSync(removedOutput)); expect(removed.pointsOfInterest[0].buildingId).toBeUndefined(); expect(removed.pointsOfInterest[0].address).toBeUndefined(); expect(removed.pointsOfInterest[0].description).toBe('Keep the place.');
    await page.locator('#editor-undo-btn').click(); const undoPending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const undoDownload = await undoPending, undoOutput = testInfo.outputPath('place-address-restored.json'); await undoDownload.saveAs(undoOutput); const restored = JSON.parse(fs.readFileSync(undoOutput)); expect(restored.pointsOfInterest[0].buildingId).toBe('home'); expect(restored.pointsOfInterest[0].address).toBe('14 Harbor Street'); expect(errors).toEqual([]);
});

test('bent entrance paths can be edited, retained through renaming, routed after download and cleared by a moved entrance', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = fixture(); data.buildings[0].access.path = [[2200, 1500], [2200, 1700], [2000, 1700], [2000, 1500]];
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data })); await page.goto(base + '/studio/editor');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false'); await page.locator('[data-map-id="main_continent"]').first().click(); await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    const panel = page.locator('#editor-network-panel'); await panel.locator('summary').filter({ hasText: 'Building addresses' }).click(); await panel.getByLabel('Find a building address').fill('Lantern'); await panel.getByRole('button', { name: '12 Harbor Street · The Lantern', exact: true }).click();
    await expect(page.locator('.network-address-approach')).toHaveCount(1);
    await panel.locator('summary').filter({ hasText: 'Entrance walking path' }).click();
    const approach = panel.getByLabel('Entrance walking path (X, Y per line)');
    await approach.fill('1500, 2200\n1800, 2200\n1800, 2000\n1500, 2000'); await approach.press('Tab');
    await panel.getByLabel('Building name', { exact: true }).fill('Lantern Court'); await panel.getByLabel('Building name', { exact: true }).press('Tab');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const file = await pending, output = testInfo.outputPath('bent-entrance.json'); await file.saveAs(output); const saved = JSON.parse(fs.readFileSync(output));
    expect(saved.buildings[0].access.path).toEqual([[2200, 1500], [2200, 1800], [2000, 1800], [2000, 1500]]); expect(saved.buildings[0].name).toBe('Lantern Court'); expect(T.validate(saved)).toEqual([]);
    await panel.getByLabel('Entrance Y', { exact: true }).fill('2250'); await panel.getByLabel('Entrance Y', { exact: true }).press('Tab'); await expect(approach).toHaveValue('');
    const movedPending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const movedFile = await movedPending, movedOutput = testInfo.outputPath('moved-entrance.json'); await movedFile.saveAs(movedOutput); const moved = JSON.parse(fs.readFileSync(movedOutput)); expect(moved.buildings[0].access.path).toBeUndefined(); expect(moved.buildings[0].entrance).toEqual([2250, 1500]);
    await viewer(page, saved); await page.locator('#travel-from').fill('Lantern Court'); await page.locator('#travel-to').fill('18 Harbor Street'); await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-total')).toHaveText('2.5 km · Free'); await expect(page.locator('.travel-result-line')).toHaveCount(3); expect(errors).toEqual([]);
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

test('editor creates, edits, downloads, routes and removes an address with undo and drawing safeguards', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: fixture() })); await page.goto(base + '/studio/editor');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false'); await page.locator('[data-map-id="main_continent"]').first().click(); await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    const panel = page.locator('#editor-network-panel'), canvas = page.locator('#editor-map');
    await panel.getByRole('button', { name: 'Add address', exact: true }).click(); await canvas.click({ position: { x: 240, y: 180 } });
    await expect(page.locator('#save-current-map-btn')).toBeDisabled(); await page.reload(); await expect(panel).toBeVisible(); await expect(panel.getByRole('button', { name: 'Cancel address', exact: true })).toBeVisible(); await expect(page.locator('#save-current-map-btn')).toBeDisabled();
    await panel.getByRole('button', { name: 'Cancel address', exact: true }).click(); await expect(panel.locator('.network-count')).toContainText('3 addresses');
    await panel.getByRole('button', { name: 'Add address', exact: true }).click(); await canvas.click({ position: { x: 240, y: 180 } }); await canvas.click({ position: { x: 300, y: 230 } });
    await expect(panel.getByLabel('Full address')).toHaveValue('1 Harbor Street'); await expect(panel.locator('.network-count')).toContainText('4 addresses');
    await panel.getByLabel('Full address').fill('41 Harbor Street'); await panel.getByLabel('Full address').press('Tab'); await panel.getByLabel('House number').fill('41'); await panel.getByLabel('House number').press('Tab');
    await panel.getByLabel('Building name').fill('New address'); await panel.getByLabel('Building name').press('Tab');
    await panel.locator('summary').filter({ hasText: 'Footprint corners' }).click(); const corners = panel.getByLabel('Footprint corners (X, Y per line)');
    const vertices = (await corners.inputValue()).split('\n').map(row => row.split(',').map(Number)); vertices[0][0] += 5;
    await corners.fill(vertices.map(point => point.join(', ')).join('\n')); await corners.press('Tab');
    const pending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const download = await pending, output = testInfo.outputPath('created-address.json'); await download.saveAs(output); const saved = JSON.parse(fs.readFileSync(output)), added = saved.buildings.find(building => building.address === '41 Harbor Street');
    expect(added).toBeTruthy(); expect(added.name).toBe('New address'); expect(added.footprint[0]).toEqual([vertices[0][1], vertices[0][0]]); expect(saved.buildings).toHaveLength(4); expect(T.validate(saved)).toEqual([]);
    const trip = T.route(T.build(saved), added.id, 'shop'); expect(trip).toBeTruthy(); expect(trip.km).toBeGreaterThan(0);
    await panel.locator('summary').filter({ hasText: 'Test a journey' }).click(); await page.locator('#network-test-from').fill(added.address); await page.locator('#network-test-to').fill('18 Harbor Street'); await panel.getByRole('button', { name: 'Calculate journey' }).click(); await expect(panel.locator('.network-test-result')).not.toContainText('No connected route');
    await panel.getByRole('button', { name: 'Delete address', exact: true }).click(); await expect(panel.locator('.network-count')).toContainText('3 addresses');
    await page.locator('#editor-undo-btn').click(); await expect(panel.locator('.network-count')).toContainText('4 addresses');
    await panel.locator('summary').filter({ hasText: 'Building addresses' }).click(); await panel.getByLabel('Find a building address').fill('41'); await panel.getByRole('button', { name: '41 Harbor Street · New address', exact: true }).click(); await panel.getByRole('button', { name: 'Delete address', exact: true }).click();
    const removedPending = page.waitForEvent('download'); await page.locator('#save-current-map-btn').click(); const removed = await removedPending, removedOutput = testInfo.outputPath('removed-address.json'); await removed.saveAs(removedOutput); expect(JSON.parse(fs.readFileSync(removedOutput)).buildings.some(building => building.id === added.id)).toBe(false); expect(errors).toEqual([]);
});
