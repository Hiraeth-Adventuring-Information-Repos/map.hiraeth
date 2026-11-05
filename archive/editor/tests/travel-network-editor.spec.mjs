import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMapFileServer } = require('../scripts/map_file_server.js');
const T = require('../js/travel-network.js');
let server, base;
const fixture = () => ({ ...JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'))), scalePixels: 100, scaleKilometers: 1, regions: [], pointsOfInterest: [], travelNodes: [], transportReview: undefined, lines: [], custom: { preserve: 'unchanged' } });
test.beforeAll(async () => {
    server = createMapFileServer({ repoRoot: path.resolve(import.meta.dirname, '..'), allowedHosts: '127.0.0.1' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
async function open(page, data, suffix = '') {
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/studio/editor?routing=1' + suffix.replace(/^\?/, '&'));
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-map-id="main_continent"]').first().click();
    await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    await expect(page.locator('#editor-network-panel')).toBeVisible();
}
const panel = page => page.locator('#editor-network-panel');
const marker = (page, name) => page.locator(`.network-node[title^="${name} ("]`);
async function addPoint(page, position, name, kind = 'junction') {
    await panel(page).getByRole('button', { name: 'Add point', exact: true }).click();
    await panel(page).getByLabel('New point kind').selectOption(kind);
    await page.locator('#editor-map').click({ position });
    await panel(page).getByLabel('Point name', { exact: true }).fill(name);
    await panel(page).getByLabel('Point name', { exact: true }).press('Tab');
    await expect(marker(page, name)).toBeVisible();
}
async function connect(page, from, to, mode) {
    await panel(page).getByRole('button', { name: 'Draw connection', exact: true }).click();
    await panel(page).getByLabel('New link mode').selectOption(mode);
    await marker(page, from).click();
    await marker(page, to).click();
    await expect(panel(page).getByLabel('Transport mode')).toHaveValue(mode);
}
async function download(page, testInfo, name) {
    const pending = page.waitForEvent('download');
    if (await page.locator('#save-current-map-btn').isEnabled()) await page.locator('#save-current-map-btn').click();
    else {
        await page.locator('.file-editor-more > summary').click();
        await page.locator('#editor-export-btn').click();
        await page.locator('#export-current-map-btn').click();
    }
    const file = await pending, output = testInfo.outputPath(name); await file.saveAs(output);
    return JSON.parse(fs.readFileSync(output));
}
test('covered track stays visually interrupted in the network editor and survives export', async ({ page }, testInfo) => {
    const data = fixture();
    data.lines = [{ id: 'covered-train', name: 'Covered Train', type: 'Travel', coordinates: [[1000, 1000], [1000, 2000]], travelMode: 'rail', travelSpeedKph: 40, travelFrom: 'West', travelTo: 'East', travelOcclusions: [[[950, 1400], [1050, 1400], [1050, 1600], [950, 1600]]] }];
    await open(page, data);
    await expect(page.locator('.editor-network-link')).toHaveCount(1);
    expect((await page.locator('.editor-network-link').getAttribute('d')).match(/M/g)).toHaveLength(2);
    const saved = await download(page, testInfo, 'covered-track.json');
    expect(saved.lines[0].travelOcclusions).toEqual(data.lines[0].travelOcclusions);
    expect(T.route(T.build(saved), 'West', 'East').km).toBe(10);
});
test('build a network, calculate mixed travel, move shared nodes, undo, recover and export to the viewer', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page, fixture());
    await addPoint(page, { x: 180, y: 200 }, 'Home', 'town');
    await addPoint(page, { x: 430, y: 210 }, 'Central', 'station');
    await addPoint(page, { x: 620, y: 350 }, 'Harbor', 'port');
    await connect(page, 'Home', 'Central', 'road');
    await connect(page, 'Central', 'Harbor', 'rail');
    await panel(page).getByLabel('Fare or toll (gp)', { exact: true }).fill('3');
    await panel(page).getByLabel('Fare or toll (gp)', { exact: true }).press('Tab');
    await panel(page).getByLabel('One way: from → to').check();
    await panel(page).locator('summary').filter({ hasText: 'Test a journey' }).click();
    await page.locator('#network-test-from').fill('Home');
    await page.locator('#network-test-to').fill('Harbor');
    await panel(page).getByRole('button', { name: 'Calculate journey' }).click();
    await expect(page.locator('.network-test-result')).toContainText('3 gp');
    await expect(page.locator('.network-preview-route')).toHaveCount(2);
    await page.locator('#network-test-from').fill('Harbor');
    await page.locator('#network-test-to').fill('Home');
    await panel(page).getByRole('button', { name: 'Calculate journey' }).click();
    await expect(page.locator('.network-test-result')).toContainText('No connected route');
    const before = await marker(page, 'Central').boundingBox();
    await page.mouse.move(before.x + 13, before.y + 13); await page.mouse.down();
    await page.mouse.move(before.x + 63, before.y + 73, { steps: 10 }); await page.mouse.up();
    const moved = await marker(page, 'Central').boundingBox(); expect(moved.x - before.x).toBeCloseTo(50, 0);
    await page.locator('#editor-undo-btn').click();
    expect((await marker(page, 'Central').boundingBox()).x).toBeCloseTo(before.x, 0);
    await page.locator('#editor-redo-btn').click();
    expect((await marker(page, 'Central').boundingBox()).x).toBeCloseTo(moved.x, 0);
    await marker(page, 'Central').click();
    await panel(page).getByLabel('Point name').fill('Union station');
    await panel(page).getByLabel('Point name').press('Tab');
    await page.reload();
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await expect(panel(page)).toBeVisible(); await expect(marker(page, 'Union station')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('network-desktop.png') });
    const saved = await download(page, testInfo, 'network.json');
    expect(saved.travelNodes).toHaveLength(3); expect(saved.lines).toHaveLength(2);
    expect(saved.custom).toEqual({ preserve: 'unchanged' }); expect(T.validate(saved)).toEqual([]);
    const station = saved.travelNodes.find(node => node.name === 'Union station');
    expect(saved.lines.find(line => line.travelMode === 'road').coordinates.at(-1)).toEqual(station.coordinates);
    expect(saved.lines.find(line => line.travelMode === 'rail').coordinates[0]).toEqual(station.coordinates);
    expect(saved.lines.every(line => line.travelVisible === false)).toBe(true);
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: saved }));
    await page.goto(base + '/index.html?routing=1#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    await expect(page.locator('.travel-network-line')).toHaveCount(0);
    await page.locator('#directions-btn').click();
    await page.locator('#travel-from').fill('Home'); await page.locator('#travel-to').fill('Harbor');
    await page.getByRole('button', { name: 'Find route', exact: true }).click();
    await expect(page.locator('.travel-result-line')).toHaveCount(2);
    await expect(page.locator('.travel-total')).toContainText('3 gp');
    expect(errors).toEqual([]);
});

test('existing links stay lossless until edited; inserting a junction allows a branch', async ({ page }, testInfo) => {
    const data = fixture(); data.lines.push({ id: 'old-road', name: 'Old road', type: 'Travel', coordinates: [[2000, 1500], [2000, 6500]], travelMode: 'road', travelFrom: 'West', travelTo: 'East', travelSpeedKph: 5, travelFareGp: 4, travelDelayHours: 1, custom: 'keep' });
    await open(page, data);
    await expect(page.locator('.network-node')).toHaveCount(2);
    expect(await download(page, testInfo, 'unchanged.json')).toEqual(data);
    await panel(page).getByRole('button', { name: 'Add point', exact: true }).click();
    const midpoint = await page.locator('.editor-network-link').evaluate(path => { const p = path.getPointAtLength(path.getTotalLength() / 2); const at = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()); return { x: at.x, y: at.y }; });
    await page.mouse.click(midpoint.x, midpoint.y);
    await expect(page.locator('.network-node')).toHaveCount(3);
    await expect(page.locator('.editor-network-link')).toHaveCount(2);
    await panel(page).getByLabel('Point name').fill('Crossroads'); await panel(page).getByLabel('Point name').press('Tab');
    await panel(page).getByRole('button', { name: 'Connect from here' }).click();
    await panel(page).getByLabel('New link mode').selectOption('trail');
    await page.locator('#editor-map').click({ position: { x: 550, y: 210 } });
    await panel(page).getByRole('button', { name: 'Finish connection' }).click();
    const saved = await download(page, testInfo, 'branched.json');
    expect(saved.travelNodes).toHaveLength(4); expect(saved.lines).toHaveLength(3); expect(T.validate(saved)).toEqual([]);
    const old = T.route(T.build(saved), 'West', 'East'); expect(old.km).toBeCloseTo(50); expect(old.cost).toBe(4); expect(old.hours).toBeCloseTo(11);
    const newNode = saved.travelNodes.find(node => !['West', 'East', 'Crossroads'].includes(node.name));
    expect(T.route(T.build(saved), 'West', newNode.name).legs).toHaveLength(2);
    await page.locator('#editor-undo-btn').click();
    await expect(page.locator('.network-node')).toHaveCount(3); await expect(page.locator('.editor-network-link')).toHaveCount(2);
});

test('unfinished connections recover after navigation and reload; cancellation and read-only access work', async ({ page }, testInfo) => {
    await open(page, fixture());
    await panel(page).getByRole('button', { name: 'Draw connection', exact: true }).click();
    await page.locator('#editor-map').click({ position: { x: 200, y: 220 } });
    await page.locator('#editor-map').click({ position: { x: 400, y: 270 } });
    await expect(page.locator('#save-current-map-btn')).toBeDisabled();
    await page.getByRole('button', { name: 'Features', exact: true }).click();
    await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: 'Finish connection' })).toBeEnabled();
    await page.reload(); await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Finish connection' })).toBeEnabled();
    await panel(page).getByRole('button', { name: 'Cancel connection' }).click();
    await expect(page.locator('.network-node')).toHaveCount(0);
    await addPoint(page, { x: 220, y: 200 }, 'Lonely station', 'station');
    await panel(page).getByRole('button', { name: 'Delete connection point' }).click();
    await expect(page.locator('.network-node')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath('network-mobile.png') });
    await page.goto(base + '/studio/editor?routing=1&mode=review');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-map-id="main_continent"]').first().click();
    await page.getByRole('button', { name: 'Travel network', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: 'Add point', exact: true })).toBeDisabled();
});

test('large networks keep junctions searchable and snap new links to their existing point IDs', async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = fixture();
    data.travelNodes = [
        { id: 'city-home', name: 'Home', kind: 'town', coordinates: [2000, 2000] },
        { id: 'city-target', name: 'City target', kind: 'junction', coordinates: [2000, 3000] },
        ...Array.from({ length: 100 }, (_, i) => ({ id: `city-junction-${i}`, name: `City junction ${i}`, kind: 'junction', coordinates: [4000, 5000 + i * 15] }))
    ];
    await open(page, data);
    await expect(page.locator('.network-node')).toHaveCount(1);
    const list = panel(page).locator('details').filter({ has: page.locator('summary', { hasText: 'Connection points & links' }) });
    await list.locator('summary').click();
    await expect(list).toContainText('Showing 80 of 102 matches');
    await list.getByLabel('Find a connection point or link').fill('City target');
    await list.getByRole('button', { name: 'Junction · City target', exact: true }).click();
    await expect(marker(page, 'City target')).toBeVisible();
    await expect(page.locator('.network-node')).toHaveCount(2);
    await expect(marker(page, 'City target')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.leaflet-pan-anim')).toHaveCount(0);
    const target = await marker(page, 'City target').boundingBox();
    await panel(page).getByRole('button', { name: 'Draw connection', exact: true }).click();
    await expect(marker(page, 'City target')).toHaveCount(0);
    await marker(page, 'Home').click();
    // Miss the 4px canvas dot, but remain within the existing point's 16px snap radius.
    await page.mouse.click(target.x + target.width / 2 + 8, target.y + target.height / 2);
    await expect(panel(page).getByLabel('Transport mode')).toHaveValue('road');
    await expect(panel(page).getByRole('button', { name: 'Finish connection' })).toHaveCount(0);
    const saved = await download(page, testInfo, 'city-junction-snap.json');
    expect(saved.travelNodes).toEqual(data.travelNodes);
    expect(saved.lines).toHaveLength(1);
    expect(saved.lines[0].travelFromNode).toBe('city-home');
    expect(saved.lines[0].travelToNode).toBe('city-target');
    expect(saved.lines[0].coordinates).toEqual([[2000, 2000], [2000, 3000]]);
    expect(T.validate(saved)).toEqual([]);
    expect(errors).toEqual([]);
});
