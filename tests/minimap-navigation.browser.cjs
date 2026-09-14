const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

test('fixed overview supports viewport dragging, click navigation, keyboard and cleanup', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<div id="map" style="width:800px;height:600px"></div>');
        await page.addStyleTag({ path: 'css/leaflet.css' });
        await page.addScriptTag({ path: 'js/libs/leaflet.js' });
        await page.addScriptTag({ path: 'js/libs/Control.MiniMap.min.js' });
        const source = fs.readFileSync('js/app.js', 'utf8');
        await page.addScriptTag({ content: source.slice(source.indexOf('function enableMiniMapNavigation('), source.indexOf('function syncMiniMapControl(')) });
        await page.evaluate(() => {
            window.main = L.map('map', { crs: L.CRS.Simple, zoomAnimation: false }).setView([500, 500], 1);
            window.control = new L.Control.MiniMap(L.layerGroup(), {
                width: 200, height: 200, centerFixed: [500, 500], zoomLevelFixed: -3,
                mapOptions: { minZoom: -100, zoomSnap: 0 }, toggleDisplay: true
            }).addTo(main);
            enableMiniMapNavigation(control);
        });
        const box = await page.locator('.leaflet-control-minimap').boundingBox();
        const x = box.x + 100, y = box.y + 100;
        const state = () => page.evaluate(() => ({ center: main.getCenter(), zoom: main.getZoom(), overview: control._miniMap.getCenter() }));
        const before = await state();
        await page.mouse.move(x + 5, y + 5);
        await page.mouse.down();
        assert.deepEqual(await state(), before, 'grabbing within the box must not jump');
        await page.mouse.move(x + 25, y + 15);
        const during = await state();
        assert.ok(Math.abs(during.center.lng - before.center.lng - 160) < 1);
        assert.ok(Math.abs(during.center.lat - before.center.lat + 80) < 1);
        assert.deepEqual(during.overview, before.overview);
        assert.equal(during.zoom, before.zoom);
        await page.mouse.up();
        await page.mouse.click(x - 60, y - 60);
        const clicked = await state();
        assert.ok(clicked.center.lng < before.center.lng);
        await page.locator('.leaflet-control-minimap').focus();
        await page.keyboard.press('ArrowRight');
        assert.ok((await state()).center.lng > clicked.center.lng);
        await page.evaluate(() => control._disposeNavigation());
        const disposed = await state();
        await page.mouse.click(x, y);
        assert.deepEqual(await state(), disposed);
    } finally {
        await browser.close();
    }
});
