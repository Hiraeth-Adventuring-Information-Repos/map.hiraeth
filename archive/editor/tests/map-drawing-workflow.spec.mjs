import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMapFileServer } = require('../scripts/map_file_server.js');
let server;
let base;

test.beforeAll(async () => {
    server = createMapFileServer({ repoRoot: path.resolve(import.meta.dirname, '..'), allowedHosts: '127.0.0.1' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

for (const renderer of ['SVG', 'Canvas']) {
    test(`ruler owns clicks over visible POIs, polygons and lines with ${renderer}`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(renderer === 'Canvas' ? { userAgent: 'Mozilla/5.0 Firefox/130.0' } : {}) });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(base + '/index.html#main_continent-s=c');
            await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
            await page.waitForFunction(() => !document.getElementById('loading-overlay') || getComputedStyle(document.getElementById('loading-overlay')).display === 'none');
            const positions = await page.evaluate(() => {
                unlockAdvancedControls('test');
                setMapBlurbVisible(false);
                const center = map.getCenter();
                const rect = map.getContainer().getBoundingClientRect();
                const centerPixel = map.latLngToContainerPoint(center);
                const at = (x, y) => map.containerPointToLatLng([centerPixel.x + x, centerPixel.y + y]);
                window.testFeatures = [
                    L.marker(at(-120, 0)).bindPopup('Test place').addTo(map),
                    L.polygon([at(-55, -60), at(55, -60), at(55, 60), at(-55, 60)], { color: '#4b83dd' }).bindPopup('Test region').addTo(map),
                    L.polyline([at(80, 0), at(160, 0)], { color: '#dd5544', weight: 15 }).bindPopup('Test line').addTo(map)
                ];
                window.measurementPopupCount = 0;
                map.on('popupopen', () => window.measurementPopupCount++);
                return [-120, 0, 120].map(x => ({ x: rect.x + centerPixel.x + x, y: rect.y + centerPixel.y }));
            });
            // Confirm these targets ordinarily open popups, including Canvas hit testing.
            for (const position of positions) {
                await page.mouse.click(position.x, position.y);
                await expect(page.locator('.leaflet-popup')).toBeVisible();
                await page.evaluate(() => map.closePopup());
            }
            await page.locator('#measure-tool-btn').click();
            await expect(page.locator('#measure-tool-btn')).toHaveAttribute('aria-pressed', 'true');
            const initial = await page.evaluate(() => ({ zoom: map.getZoom(), locked: coordsLocked, popups: window.measurementPopupCount }));
            for (const position of positions) await page.mouse.click(position.x, position.y);
            await expect.poll(() => page.evaluate(() => multiPointPath.length)).toBe(3);
            await expect(page.locator('.leaflet-popup')).toHaveCount(0);
            expect(await page.evaluate(() => window.measurementPopupCount)).toBe(initial.popups);
            const total = await page.evaluate(() => cachedMultiPointPixelDistance);
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => multiPointPath.length)).toBe(2);
            expect(await page.evaluate(() => cachedMultiPointPixelDistance)).toBeCloseTo(total / 2, 5);
            await page.mouse.dblclick(positions[2].x, positions[2].y);
            await expect(page.locator('#measure-tool-btn')).toHaveAttribute('aria-pressed', 'false');
            expect(await page.evaluate(() => multiPointPath.length)).toBe(3);
            expect(await page.evaluate(() => map.getZoom())).toBe(initial.zoom);
            expect(await page.evaluate(() => coordsLocked)).toBe(initial.locked);
            expect(await page.evaluate(() => map.doubleClickZoom.enabled())).toBe(true);
            await page.screenshot({ path: testInfo.outputPath(`measurement-${renderer}.png`) });
            await page.mouse.click(positions[0].x, positions[0].y);
            await expect(page.locator('.leaflet-popup')).toBeVisible();
            await page.locator('#measure-tool-btn').click();
            await expect(page.locator('.leaflet-popup')).toHaveCount(0);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => multiPointPath.length)).toBe(0);
            await expect(page.locator('#mobile-measure-btn')).toHaveAttribute('aria-pressed', 'false');
            // Respect a map that had double-click zoom disabled before measuring.
            await page.evaluate(() => map.doubleClickZoom.disable());
            await page.locator('#measure-tool-btn').click();
            await page.mouse.click(positions[0].x, positions[0].y);
            await page.mouse.click(positions[1].x, positions[1].y);
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => map.doubleClickZoom.enabled())).toBe(false);
            await page.locator('#measure-tool-btn').click();
            await page.mouse.click(positions[0].x, positions[0].y);
            await page.mouse.click(positions[1].x, positions[1].y);
            await page.locator('#measure-tool-btn').click();
            expect(await page.evaluate(() => multiPointPath.length)).toBe(0);
            await expect(page.locator('#map')).not.toHaveClass(/measuring-cursor/);
            expect(errors).toEqual([]);
        } finally { await context.close(); }
    });
}

async function dragHandle(page, locator, dx, dy, refreshDuringDrag = false) {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (refreshDuringDrag) {
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        // Let any queued form update or layout refresh run while the handle is held.
        await page.waitForTimeout(350);
    }
    await page.mouse.up();
}

async function readDraft(page) {
    return page.evaluate(() => {
        const key = Object.keys(sessionStorage).find(key => key.startsWith('mapEditorRecovery:v2:'));
        return JSON.parse(sessionStorage.getItem(key));
    });
}

async function downloadMap(page, testInfo, filename) {
    const pending = page.waitForEvent('download');
    await page.locator('#save-current-map-btn').click();
    const download = await pending;
    const output = testInfo.outputPath(filename);
    await download.saveAs(output);
    return JSON.parse(fs.readFileSync(output));
}

async function openDrawingMap(page) {
    await page.goto(base + '/studio/editor');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-map-id="main_continent"]').first().click();
}

test('mixed Bezier polygon retains sharp corners, editable handles, recovery, downloads and undo', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openDrawingMap(page);
    await page.locator('#editor-add-region-btn').click();
    const canvas = page.locator('#editor-map');
    const points = page.locator('[title^="Drawing point "]');
    const incoming = page.locator('[title^="Incoming Bezier handle"]');
    const outgoing = page.locator('[title^="Outgoing Bezier handle"]');
    const curve = page.locator('#editor-curve-point-btn');
    await canvas.click({ position: { x: 240, y: 180 } });
    await canvas.click({ position: { x: 560, y: 180 } });
    await expect(curve).toBeDisabled();
    await expect(page.locator('#editor-finish-draw-btn')).toBeDisabled();
    await canvas.click({ position: { x: 560, y: 390 } });
    await canvas.click({ position: { x: 240, y: 390 } });
    await expect(points).toHaveCount(4);
    await points.nth(1).click();
    await expect(curve).toHaveText('Curve point');
    await curve.click();
    await expect(curve).toHaveText('Make corner');
    await expect(incoming).toHaveCount(1);
    await expect(outgoing).toHaveCount(1);
    const initial = await readDraft(page);
    expect(initial.draftHandles.map(Boolean)).toEqual([false, true, false, false]);
    await dragHandle(page, outgoing, 65, -35);
    const handleMoved = await readDraft(page);
    expect(handleMoved.draftHandles[1].out).not.toEqual(initial.draftHandles[1].out);
    expect(handleMoved.draftHandles[1].in).toEqual(initial.draftHandles[1].in);
    expect(handleMoved.draftCoordinates).toEqual(initial.draftCoordinates);
    await dragHandle(page, points.nth(1), 20, 15);
    const pointMoved = await readDraft(page);
    const delta = pointMoved.draftCoordinates[1].map((value, axis) => value - initial.draftCoordinates[1][axis]);
    for (const side of ['in', 'out']) {
        expect(pointMoved.draftHandles[1][side]).toEqual(handleMoved.draftHandles[1][side].map((value, axis) => value + delta[axis]));
    }
    // Selecting and converting another point does not affect the first curve.
    await points.first().click();
    await curve.click();
    expect((await readDraft(page)).draftHandles.map(Boolean)).toEqual([true, true, false, false]);
    await curve.click();
    expect((await readDraft(page)).draftHandles.map(Boolean)).toEqual([false, true, false, false]);
    await page.locator('#editor-undo-point-btn').click();
    await expect(points).toHaveCount(3);
    await canvas.click({ position: { x: 240, y: 390 } });
    await points.nth(1).click();
    const beforeReload = await readDraft(page);
    await page.reload();
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
    await expect(points).toHaveCount(4);
    await expect(curve).toHaveText('Make corner');
    await expect(outgoing).toHaveCount(1);
    expect((await readDraft(page)).draftHandles).toEqual(beforeReload.draftHandles);
    await page.screenshot({ path: testInfo.outputPath('bezier-polygon-desktop.png') });
    await page.locator('#editor-finish-draw-btn').click();
    await page.locator('#editor-feature-form [data-field="name"]').fill('Mixed Bezier boundary');
    await page.locator('#editor-feature-form [data-field="name"]').press('Tab');
    const document = await downloadMap(page, testInfo, 'bezier-polygon.json');
    const polygon = document.regions.find(region => region.name === 'Mixed Bezier boundary');
    expect(polygon.bezier.anchors).toEqual(beforeReload.draftCoordinates);
    expect(polygon.bezier.handles).toEqual(beforeReload.draftHandles);
    for (const point of polygon.bezier.anchors) expect(polygon.coordinates).toContainEqual(point);
    expect(polygon.coordinates.slice(-2)).toEqual(polygon.bezier.anchors.slice(-2));
    // Finishing preserves the four original control points, not dozens of sampled handles.
    await page.getByRole('button', { name: 'Edit on map', exact: true }).click();
    const savedPoints = page.locator('[title^="Shape point "]');
    await expect(savedPoints).toHaveCount(4);
    await savedPoints.nth(1).click();
    await expect(outgoing).toHaveCount(1);
    const coordinates = page.locator('#editor-feature-form [data-field="coordinates"]');
    const beforeEdit = await coordinates.inputValue();
    await dragHandle(page, outgoing, -40, 35, true);
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
    expect(await coordinates.inputValue()).not.toBe(beforeEdit);
    await page.locator('#editor-undo-btn').click();
    expect(await coordinates.inputValue()).toBe(beforeEdit);
    await page.locator('#editor-redo-btn').click();
    expect(await coordinates.inputValue()).not.toBe(beforeEdit);
    const editedDocument = await downloadMap(page, testInfo, 'bezier-polygon-edited.json');
    const editedPolygon = editedDocument.regions.find(region => region.name === 'Mixed Bezier boundary');
    expect(editedPolygon.bezier.handles).not.toEqual(polygon.bezier.handles);
    expect(editedPolygon.bezier.anchors).toEqual(polygon.bezier.anchors);
    // Reopen the actual downloaded JSON in a fresh tab without any recovery state.
    const reopened = await page.context().newPage();
    reopened.on('pageerror', error => errors.push(error.message));
    await reopened.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: editedDocument }));
    await reopened.goto(base + '/studio/editor?map=main_continent');
    await expect(reopened.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await reopened.getByRole('button', { name: 'Features', exact: true }).click();
    await reopened.locator('#editor-feature-type-select').selectOption('regions');
    await reopened.locator('#editor-feature-search').fill('Mixed Bezier boundary');
    await reopened.locator('.map-editor-feature-entry').filter({ hasText: 'Mixed Bezier boundary' }).click();
    await reopened.getByRole('button', { name: 'Edit on map', exact: true }).click();
    await expect(reopened.locator('[title^="Shape point "]')).toHaveCount(4);
    await reopened.locator('[title^="Shape point "]').nth(1).click();
    await expect(reopened.locator('[title^="Outgoing Bezier handle"]')).toHaveCount(1);
    // A detail-only edit must keep all control points, while enabling Download changes.
    await reopened.getByRole('button', { name: 'Edit details', exact: true }).click();
    await reopened.locator('#editor-feature-form [data-field="name"]').fill('Reopened mixed boundary');
    await reopened.locator('#editor-feature-form [data-field="name"]').press('Tab');
    const reopenedDocument = await downloadMap(reopened, testInfo, 'bezier-polygon-reopened.json');
    expect(reopenedDocument.regions.find(region => region.name === 'Reopened mixed boundary')).toEqual({ ...editedPolygon, name: 'Reopened mixed boundary' });
    await reopened.close();
    expect(errors).toEqual([]);
});

test('mobile Bezier route supports independent handles, sharp points and unchanged endpoints', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDrawingMap(page);
    await page.locator('#editor-add-line-btn').click();
    const canvas = page.locator('#editor-map');
    await canvas.click({ position: { x: 60, y: 150 } });
    await canvas.click({ position: { x: 180, y: 300 } });
    await page.locator('#editor-curve-point-btn').click();
    await expect(page.locator('[title^="Outgoing Bezier handle"]')).toHaveCount(0);
    await canvas.click({ position: { x: 300, y: 150 } });
    const points = page.locator('[title^="Drawing point "]');
    await points.nth(1).click();
    await expect(page.locator('#editor-curve-point-btn')).toHaveText('Make corner');
    await dragHandle(page, page.locator('[title^="Outgoing Bezier handle"]'), 25, -55);
    const draft = await readDraft(page);
    expect(draft.draftHandles.map(Boolean)).toEqual([false, true, false]);
    for (const id of ['editor-curve-point-btn', 'editor-undo-point-btn', 'editor-finish-draw-btn', 'editor-cancel-draw-btn']) {
        const box = await page.locator(`#${id}`).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.height).toBeGreaterThanOrEqual(40);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath('bezier-route-mobile.png') });
    await canvas.focus();
    await page.keyboard.press('Enter');
    await page.locator('#editor-feature-form [data-field="name"]').fill('Mixed Bezier route');
    await page.locator('#editor-feature-form [data-field="name"]').press('Tab');
    const document = await downloadMap(page, testInfo, 'bezier-route-mobile.json');
    const line = (document.lines || document.roads).find(line => line.name === 'Mixed Bezier route');
    expect(line.coordinates.length).toBeGreaterThan(3);
    expect(line.coordinates[0]).toEqual(draft.draftCoordinates[0]);
    expect(line.coordinates.at(-1)).toEqual(draft.draftCoordinates.at(-1));
    expect(line.bezier.handles).toEqual(draft.draftHandles);
});
