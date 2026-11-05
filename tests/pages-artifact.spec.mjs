import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStaticServer, getFirefoxRenderingState, assertFirefoxRendering } = require('../scripts/firefox_render_smoke.cjs');
const artifactRoot = path.resolve(process.env.PAGES_TEST_ROOT || 'dist');
if (!fs.existsSync(path.join(artifactRoot, 'index.html'))) throw new Error(`Missing Pages artifact: ${artifactRoot}. Run npm run build:pages first.`);

test.describe('built routing payloads', () => {
    test.use({ serviceWorkers: 'block' });
    let builtServer, builtBase;
    test.beforeAll(async () => {
        builtServer = createStaticServer(artifactRoot);
        await new Promise(resolve => builtServer.listen(0, '127.0.0.1', resolve));
        builtBase = `http://127.0.0.1:${builtServer.address().port}`;
    });
    test.afterAll(async () => { if (builtServer) await new Promise(resolve => builtServer.close(resolve)); });

    test('built viewer renders tiles, searches, shares and navigates', async ({ page, browserName }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.stack || error.message));
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                async writeText(text) { window.__copiedArtifactShare = text; }
            } });
        });
        await page.goto(`${builtBase}/index.html#The-Port-City-of-Stomion-s=c`);
        await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
        await expect.poll(() => page.locator('img.leaflet-tile-loaded').count()).toBeGreaterThan(0);
        if (browserName === 'firefox') {
            await expect.poll(async () => {
                const state = await page.evaluate(getFirefoxRenderingState);
                return state.visibleTileCount > 0 && state.visibleTileCount === state.loadedTileCount;
            }).toBe(true);
            assertFirefoxRendering(await page.evaluate(getFirefoxRenderingState), errors);
        }
        await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
        await page.locator('#poi-search-input').fill('Breads and Dregs');
        await expect(page.locator('#search-results-container [role="option"]').first()).toContainText('Breads and Dregs');
        await page.locator('#poi-search-input').press('Enter');
        await expect(page.locator('.leaflet-popup')).toContainText('Breads and Dregs');
        await page.keyboard.press('Escape');
        await page.locator('#share-view-btn').click();
        await page.waitForFunction(() => typeof window.__copiedArtifactShare === 'string');
        const shareUrl = new URL(await page.evaluate(() => window.__copiedArtifactShare));
        expect(shareUrl.pathname).toBe('/share/The-Port-City-of-Stomion/');
        expect(shareUrl.searchParams.get('view')).toMatch(/^-?\d/);
        const localShare = `${builtBase}${shareUrl.pathname}${shareUrl.search}`;
        const preview = await page.request.get(localShare);
        expect(preview.status()).toBe(200);
        expect(await preview.text()).toContain('og:image');
        await page.goto(localShare);
        await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
        expect(new URL(page.url()).searchParams.get('view')).toBe(shareUrl.searchParams.get('view'));
        await page.locator('#toggle-sidebar-btn').click();
        await page.getByRole('button', { name: 'Load map: Astrousia', exact: true }).click();
        await page.waitForFunction(() => currentlyLoadedMapId === 'Astrousia');
        expect(new URL(page.url()).hash).toContain('Astrousia');
        expect(errors).toEqual([]);
    });

    test('default, disabled and embedded views never request routing geometry', async ({ page }) => {
        const requests = [];
        page.on('request', request => { if (request.url().includes('/maps/routing/')) requests.push(request.url()); });
        for (const query of ['', '?routing=0', '?routing=1&embed=true']) {
            await page.goto(`${builtBase}/index.html${query}#The-Port-City-of-Stomion-s=c`);
            await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
            expect(await page.evaluate(() => ({ buildings: currentMapData.buildings, nodes: currentMapData.travelNodes,
                travel: [...(currentMapData.roads || []), ...(currentMapData.lines || [])].filter(line => line.travelMode).length,
                planner: travelPlanner === null }))).toEqual({ buildings: undefined, nodes: undefined, travel: 0, planner: true });
            await expect(page.locator('#directions-btn')).toBeHidden();
        }
        expect(requests).toEqual([]);
    });

    for (const mobile of [false, true]) {
        test(`address suggestions close during pointer activation without moving submit (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
            await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
            await page.goto(`${builtBase}/index.html?routing=1#The-Port-City-of-Stomion-s=c`);
            await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
            const authored = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/The-Port-City-of-Stomion.json'), 'utf8'));
            const from = authored.buildings.find(building => building.aliases?.includes('TBD (The Best Drink)'));
            const to = authored.buildings.find(building => building.aliases?.includes("Governor's Castle"));
            await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
            await page.locator('#directions-btn').click();
            // Selecting a real suggestion must remain usable in the mobile sheet.
            await page.locator('#travel-from').fill('TBD');
            await page.locator('#travel-from-suggestions [role="option"]').filter({ hasText: from.address }).click();
            await expect(page.locator('#travel-from')).toHaveValue(from.address);
            const destination = page.locator('#travel-to');
            await destination.fill('1');
            for (let index = 0; index < 12; index++) await destination.press('ArrowDown');
            const listScroll = await page.locator('#travel-to-suggestions').evaluate(list => {
                const selected = list.querySelector('[aria-selected="true"]');
                const bounds = list.getBoundingClientRect(), option = selected.getBoundingClientRect();
                return { scrollTop: list.scrollTop, visible: option.top >= bounds.top && option.bottom <= bounds.bottom };
            });
            expect(listScroll.scrollTop).toBeGreaterThan(0);
            expect(listScroll.visible).toBe(true);
            await expect(page.locator('#travel-to-suggestions [aria-selected="true"]')).toBeInViewport();
            await page.screenshot({ path: testInfo.outputPath('address-keyboard-suggestions.png') });
            await destination.fill(to.address);
            await expect(page.locator('#travel-from-suggestions')).toBeHidden();
            await expect(page.locator('#travel-to-suggestions')).toBeVisible();
            const submit = page.getByRole('button', { name: 'Find route', exact: true });
            await submit.scrollIntoViewIfNeeded();
            const before = await submit.boundingBox();
            await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
            await page.mouse.down();
            // Wait for the real delayed blur handler between pointer down/up.
            await expect(page.locator('#travel-to-suggestions')).toBeHidden();
            const after = await submit.boundingBox();
            expect(after.y).toBeCloseTo(before.y, 1);
            await page.mouse.up();
            await expect(page.locator('.travel-total')).toBeVisible();
        });
    }

    test('enabled built city restores authored geometry and produces equivalent address directions', async ({ page }) => {
        const requests = [];
        page.on('request', request => { if (request.url().includes('/maps/routing/')) requests.push(request.url()); });
        await page.goto(`${builtBase}/index.html?routing=1#The-Port-City-of-Stomion-s=c`);
        await page.waitForFunction(() => typeof currentlyLoadedMapId !== 'undefined' && currentlyLoadedMapId === 'The-Port-City-of-Stomion');
        const authored = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../maps/The-Port-City-of-Stomion.json'), 'utf8'));
        const hydrated = await page.evaluate(() => ({ buildings: currentMapData.buildings, travelNodes: currentMapData.travelNodes,
            lines: currentMapData.lines, roads: currentMapData.roads, pointsOfInterest: currentMapData.pointsOfInterest }));
        for (const key of ['buildings', 'travelNodes', 'lines', 'roads', 'pointsOfInterest']) expect(hydrated[key]).toEqual(authored[key]);
        expect(requests).toHaveLength(1);
        const T = require('../js/travel-network.js');
        const from = authored.buildings.find(building => building.aliases?.includes('TBD (The Best Drink)'));
        const to = authored.buildings.find(building => building.aliases?.includes("Governor's Castle"));
        const expected = T.route(T.build(authored), from.address, to.address, { allowedModes: ['road', 'trail', 'ferry'] });
        expect(expected).toBeTruthy();
        await page.evaluate(() => { unlockAdvancedControls('test'); setMapBlurbVisible(false); });
        await page.locator('#directions-btn').click();
        await page.locator('#travel-from').fill(from.address);
        await page.locator('#travel-to').fill(to.address);
        await page.getByRole('button', { name: 'Find route', exact: true }).click();
        await expect(page.locator('.travel-total')).toHaveAttribute('data-hours', String(expected.hours));
        await expect.poll(() => page.evaluate(() => {
            let count = 0;
            map.eachLayer(layer => { if (layer.options?.className === 'travel-result-line') count++; });
            return count;
        })).toBe(expected.legs.length);
    });

    test('failed optional geometry shows Retry and succeeds without a partial planner', async ({ page }) => {
        let requests = 0;
        await page.route('**/maps/routing/Fair-Content.json*', route => {
            requests++;
            return requests === 1 ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue();
        });
        await page.goto(`${builtBase}/index.html?routing=1#main_continent-s=c`);
        await expect(page.locator('#loading-retry-btn')).toBeVisible();
        expect(await page.evaluate(() => currentMapData === null && travelPlanner === null)).toBe(true);
        await page.locator('#loading-retry-btn').click();
        await page.waitForFunction(() => currentlyLoadedMapId === 'main_continent' && currentMapData?.travelNodes?.length > 0);
        expect(requests).toBe(2);
        expect(await page.evaluate(() => travelPlanner !== null)).toBe(true);
    });

    test('late routing response cannot replace the newly selected map', async ({ page }) => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        let sawRouting;
        const started = new Promise(resolve => { sawRouting = resolve; });
        await page.route('**/maps/routing/Fair-Content.json*', async route => {
            sawRouting();
            await gate;
            await route.continue();
        });
        await page.goto(`${builtBase}/index.html?routing=1#main_continent-s=c`);
        await started;
        await page.evaluate(() => loadMap('Astrousia'));
        await page.waitForFunction(() => currentlyLoadedMapId === 'Astrousia');
        release();
        await page.waitForFunction(() => mapDefinitionCache.has('main_continent'));
        expect(await page.evaluate(() => ({ loaded: currentlyLoadedMapId, data: currentMapData.id }))).toEqual({ loaded: 'Astrousia', data: 'Astrousia' });
    });
});
