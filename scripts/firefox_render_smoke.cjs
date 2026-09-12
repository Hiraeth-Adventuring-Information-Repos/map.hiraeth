#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { firefox } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.mp3', 'audio/mpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp']
]);

function createStaticServer() {
    return http.createServer((request, response) => {
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
        } catch {
            response.writeHead(400).end('Bad request');
            return;
        }

        const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const filePath = path.resolve(distRoot, relativePath);
        if (!filePath.startsWith(`${distRoot}${path.sep}`)) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        fs.readFile(filePath, (error, contents) => {
            if (error) {
                response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
                return;
            }
            response.writeHead(200, {
                'Content-Type': contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            response.end(contents);
        });
    });
}

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return server.address().port;
}

async function closeServer(server) {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

async function run() {
    assert.ok(fs.existsSync(path.join(distRoot, 'index.html')), 'Build dist/ before running the Firefox smoke test.');

    const server = createStaticServer();
    const port = await listen(server);
    let browser;

    try {
        browser = await firefox.launch({ headless: true });
        const context = await browser.newContext({
            serviceWorkers: 'block',
            viewport: { width: 1440, height: 1000 }
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

        const response = await page.goto(`http://127.0.0.1:${port}/?firefoxSmoke=1`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        assert.equal(response?.status(), 200, 'Firefox should load the Pages bundle.');
        await page.waitForFunction(
            () => document.querySelectorAll('img.leaflet-tile-loaded').length > 0,
            null,
            { timeout: 30000 }
        );

        const state = await page.evaluate(() => {
            const underlayCanvas = document.querySelector('#map > .leaflet-map-pane > .leaflet-tile-pane > canvas');
            const tileLayer = document.querySelector('#map > .leaflet-map-pane > .leaflet-tile-pane > .map-tile-layer');
            const loadedTiles = Array.from(document.querySelectorAll('img.leaflet-tile-loaded'));
            const visibleTiles = loadedTiles.filter((tile) => {
                const style = getComputedStyle(tile);
                const layerStyle = tileLayer ? getComputedStyle(tileLayer) : null;
                return tile.complete &&
                    tile.naturalWidth > 0 &&
                    tile.getBoundingClientRect().width > 0 &&
                    style.display !== 'none' &&
                    style.visibility === 'visible' &&
                    Number(style.opacity) > 0 &&
                    layerStyle?.display !== 'none' &&
                    layerStyle?.visibility === 'visible' &&
                    Number(layerStyle?.opacity) > 0;
            });
            return {
                isFirefox: document.documentElement.classList.contains('is-firefox'),
                underlayTag: underlayCanvas?.tagName || '',
                underlayZIndex: underlayCanvas ? getComputedStyle(underlayCanvas).zIndex : '',
                tileLayerZIndex: tileLayer ? getComputedStyle(tileLayer).zIndex : '',
                loadedTileCount: loadedTiles.length,
                visibleTileCount: visibleTiles.length
            };
        });

        assert.deepEqual(pageErrors, [], `Firefox page errors:\n${pageErrors.join('\n')}`);
        assert.equal(state.isFirefox, true, 'The smoke test should exercise the Firefox-specific path.');
        assert.equal(state.underlayTag, 'CANVAS', 'Firefox should retain the Canvas renderer optimization.');
        assert.equal(state.underlayZIndex, '0', 'The Firefox Canvas underlay should render beneath map artwork.');
        assert.ok(Number(state.tileLayerZIndex) > Number(state.underlayZIndex), 'The map tile layer should render above the Canvas underlay.');
        assert.ok(state.loadedTileCount > 0, 'Firefox should load detailed map tiles.');
        assert.equal(state.visibleTileCount, state.loadedTileCount, 'Every loaded Firefox map tile should remain visible.');

        console.log(`Firefox map rendering smoke test passed (${state.visibleTileCount} visible tiles).`);
    } finally {
        if (browser) await browser.close();
        await closeServer(server);
    }
}

run().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
