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

test('generated markers load at the original size in the viewer', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
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
    // The preview server intentionally does not expose design source files.
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

test('rapid search Enter uses the current query and Escape cancels pending results', async ({ page }) => {
    await page.goto(base + '/index.html#The-Port-City-of-Stomion-s=c');
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
    await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
    const entered = await page.evaluate(() => {
        poiSearchInput.value = 'Breads and Dregs';
        updateVisibleMarkersAndSearch();
        const previous = renderedSearchResults[0]?.title;
        poiSearchInput.value = 'Baths of the Devine Mother';
        poiSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        poiSearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return { previous, selected: map._popup?._source?.poiData?.name, query: poiSearchInput.value };
    });
    expect(entered.previous).toBe('Breads and Dregs');
    expect(entered.selected).toBe('Baths of the Devine Mother');
    expect(entered.query).toBe('');
    await page.evaluate(() => {
        poiSearchInput.value = 'Northgate';
        poiSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        poiSearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await page.waitForTimeout(450);
    await expect(page.locator('#search-results-container')).toBeHidden();
    await expect(page.locator('#poi-search-input')).toHaveAttribute('aria-expanded', 'false');
});

test('failed startup script shows retry and reload recovers', async ({ page }) => {
    let blockScript = true;
    await page.route('**/js/libs/lucide.min.js*', route => blockScript ? route.abort() : route.continue());
    await page.goto(base + '/index.html#The-Port-City-of-Stomion-s=c');
    await expect(page.locator('#loading-indicator .loading-text')).toContainText(/unable|could not|failed|error/i);
    await expect(page.locator('#loading-retry-btn')).toBeVisible();
    blockScript = false;
    await page.locator('#loading-retry-btn').click();
    await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
    await expect(page.locator('#loading-indicator')).toBeHidden();
});

test('feature shares and atlas links distinguish same-name features by stable ID', async ({ page }) => {
    const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/The-Port-City-of-Stomion.json'), 'utf8'));
    const template = [...(data.roads || []), ...(data.lines || [])].find(line => line.coordinates?.length > 1);
    data.lines = [...(data.lines || []),
        { id: 'test-line-1', name: 'Repeated test line', coordinates: template.coordinates },
        { id: 'test-line-2', name: 'Repeated test line', coordinates: template.coordinates.map(([y, x]) => [y + 20, x + 20]) }
    ];
    await page.route('**/maps/The-Port-City-of-Stomion.json*', route => route.fulfill({ json: data }));
    await page.goto(base + '/index.html#The-Port-City-of-Stomion-s=c');
    await page.waitForFunction(() => typeof allMapLines !== 'undefined' && allMapLines.some(line => line.roadData.id === 'test-line-2'));
    const result = await page.evaluate(() => {
        const share = new URL(buildFeatureShareUrl('line', 'Repeated test line', 'test-line-2'));
        const atlas = buildScopedSearchParams({ kind: 'line', name: 'Repeated test line', itemId: 'test-line-2' });
        const focus = params => {
            history.replaceState({}, '', `?${params}#The-Port-City-of-Stomion-s=c`);
            checkAndFocusFeature();
            return map._popup?._source?.roadData?.id;
        };
        const poi = currentMapData.pointsOfInterest.find(point => !point.id && point.name);
        const poiShare = new URL(buildFeatureShareUrl('poi', poi.name, poi.id));
        return { share: share.searchParams.get('line'), shareFocus: focus(share.searchParams),
            atlas: atlas.get('line'), atlasFocus: focus(atlas), legacyFocus: focus('line=Repeated%20test%20line'),
            poiName: poi.name, poiTarget: poiShare.searchParams.get('poi') };
    });
    expect(result.share).toBe('test-line-2');
    expect(result.shareFocus).toBe('test-line-2');
    expect(result.atlas).toBe('test-line-2');
    expect(result.atlasFocus).toBe('test-line-2');
    expect(result.legacyFocus).toBe('test-line-1');
    expect(result.poiTarget).toBe(result.poiName);
    const popupAndRelay = await page.evaluate(async () => {
        const captured = [];
        executeShareAction = async ({ shareUrl }) => { captured.push(new URL(shareUrl).searchParams.get('line')); };
        focusLine('test-line-2');
        const button = document.querySelector('.leaflet-popup [data-popup-action="share-feature"]');
        const popupId = button?.dataset.featureId;
        button?.click();
        history.replaceState({}, '', '?line=test-line-2&src=share&stype=line#The-Port-City-of-Stomion-s=c');
        checkAndFocusFeature();
        await relaySharedContext(document.getElementById('share-relay-action-btn'));
        return { popupId, captured };
    });
    expect(popupAndRelay.popupId).toBe('test-line-2');
    expect(popupAndRelay.captured).toEqual(['test-line-2', 'test-line-2']);
});
