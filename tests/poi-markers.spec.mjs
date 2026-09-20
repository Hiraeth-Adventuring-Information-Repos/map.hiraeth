import { test, expect } from '@playwright/test';
import fs from 'node:fs';
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

test('generated markers load at the original size in editor and viewer, including new and custom types', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/studio/editor');
    await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
    await page.locator('[data-map-id="main_continent"]').first().click();
    const marker = page.locator('#editor-map img.poi-custom-icon').first();
    await expect(marker).toBeAttached();
    expect(await marker.evaluate(img => [img.width, img.height, img.style.marginLeft, img.style.marginTop])).toEqual([36, 48, '-18px', '-47px']);
    await page.getByRole('button', { name: 'Features', exact: true }).click();
    await page.locator('#editor-unified-feature-list button').first().click();
    const type = page.locator('#feature-points-type');
    await expect(type).toBeVisible();
    await expect(page.locator('#feature-points-type-options option[value="Waterfall"]')).toHaveCount(1);
    await type.fill('Waterfall');
    await type.press('Tab');
    const waterfall = page.locator('#editor-map img.poi-custom-icon[src$="waterfall.webp"]');
    await expect(waterfall).toHaveCount(1);
    await expect(waterfall).toHaveJSProperty('naturalWidth', 72);
    await type.fill('Custom mysterious site');
    await type.press('Tab');
    await expect(type).toHaveValue('Custom mysterious site');
    await expect(page.locator('#editor-map img.poi-custom-icon[src$="unknown.webp"]')).toHaveCount(1);

    const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/Fair-Content.json'), 'utf8'));
    data.pointsOfInterest = [{ name: 'Falls', type: 'Waterfall', coords: [2000, 3000] }];
    await page.route('**/maps/Fair-Content.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/index.html#main_continent-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'main_continent');
    const options = await page.evaluate(() => getPoiIcon(getPoiGroup('Waterfall'), 'Waterfall').options);
    expect(options.iconUrl).toBe('images/poi-icons/waterfall.webp');
    expect(options.iconSize).toEqual([36, 48]);
    expect(options.iconAnchor).toEqual([18, 47]);
    expect(await page.evaluate(() => getPoiIcon(getPoiGroup('Ruins'), 'Ruins').options.iconUrl)).toBe('images/poi-icons/ruin.webp');
    const assets = await page.evaluate(async () => {
        const paths = [...new Set([...Object.values(AppConfig.get('assets.poiIcons')), ...Object.values(AppConfig.get('assets.poiTypeIcons'))])];
        return Promise.all(paths.map(async src => {
            const img = new Image();
            img.src = src;
            await img.decode();
            const width = img.naturalWidth, height = img.naturalHeight;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(img, 0, 0);
            const rgba = context.getImageData(0, 0, width, height).data;
            const alpha = (x, y) => rgba[(y * width + x) * 4 + 3];
            const spans = Array.from({ length: height }, (_, y) => {
                const xs = Array.from({ length: width }, (_, x) => x).filter(x => alpha(x, y) >= 128);
                return [xs[0] ?? width, xs.at(-1) ?? -1];
            });
            // A pin is solid inside its outline. Ignore two pixels around the
            // perimeter for antialiasing, but reject fuzzy or transparent holes.
            let interiorAlphaDefects = 0;
            for (let y = 2; y < height - 2; y++) {
                const left = Math.max(...spans.slice(y - 2, y + 3).map(span => span[0])) + 2;
                const right = Math.min(...spans.slice(y - 2, y + 3).map(span => span[1])) - 2;
                for (let x = left; x <= right; x++) {
                    if (alpha(x, y) < 250) interiorAlphaDefects++;
                }
            }
            // Detached opaque flecks must not remain outside the main marker.
            const seen = new Set();
            let components = 0;
            for (let start = 0; start < width * height; start++) {
                if (seen.has(start) || rgba[start * 4 + 3] < 128) continue;
                components++;
                const stack = [start];
                seen.add(start);
                while (stack.length) {
                    const index = stack.pop(), x = index % width, y = Math.floor(index / width);
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx, ny = y + dy, next = ny * width + nx;
                            if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen.has(next) || alpha(nx, ny) < 128) continue;
                            seen.add(next);
                            stack.push(next);
                        }
                    }
                }
            }
            return { src, width, height, interiorAlphaDefects, components,
                corners: [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)] };
        }));
    });
    expect(assets).toHaveLength(70);
    assets.forEach(({ src, width, height, interiorAlphaDefects, components, corners }) => {
        expect([width, height], src).toEqual([72, 96]);
        expect(interiorAlphaDefects, `${src} has a solid interior`).toBe(0);
        expect(components, `${src} has no detached speckles`).toBe(1);
        expect(corners, `${src} has a transparent exterior`).toEqual([0, 0, 0, 0]);
    });
    // The read-only editor server intentionally does not expose design source files.
    await page.route('**/design/poi-markers/index.html', route => route.fulfill({
        contentType: 'text/html', body: fs.readFileSync(path.join(import.meta.dirname, '../design/poi-markers/index.html'), 'utf8')
    }));
    await page.goto(base + '/design/poi-markers/index.html');
    await expect(page.getByRole('heading', { name: 'A place for every story.' })).toBeVisible();
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
    await expect(page.locator('article')).toHaveCount(70);
    await page.screenshot({ path: testInfo.outputPath('poi-marker-catalog.png'), fullPage: true });
    expect(errors).toEqual([]);
});
