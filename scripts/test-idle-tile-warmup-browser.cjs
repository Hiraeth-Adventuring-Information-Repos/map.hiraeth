// Run with PLAYWRIGHT_BROWSERS_PATH set when using an isolated browser install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright');
const app = fs.readFileSync('js/app.js', 'utf8');
const warmup = app.slice(app.indexOf('function isIdleTileWarmupAllowed('),
    app.indexOf('function scheduleIdleTileWarmup('));
const sw = fs.readFileSync('sw.js', 'utf8');

(async () => {
    const pending = new Map();
    const requests = new Map();
    const server = http.createServer((req, res) => {
        const path = req.url.split('?')[0];
        if (path === '/sw.js') {
            res.writeHead(200, { 'content-type': 'text/javascript' });
            res.end(sw);
        } else if (path === '/site.config.json') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ assets: { serviceWorker: { versionedShellAssets: [], staticShellAssets: [] } } }));
        } else if (path.startsWith('/tile/')) {
            requests.set(path, (requests.get(path) || 0) + 1);
            res.writeHead(200, { 'content-type': 'image/webp' });
            res.write('first-chunk');
            pending.set(path, () => res.end('last-chunk'));
        } else {
            res.setHeader('content-type', 'text/html');
            res.end('<!doctype html><title>Warmup cancellation</title>');
        }
    });
    let browser;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        browser = await chromium.launch({ headless: true });
        for (const controlled of [false, true]) {
            const context = await browser.newContext();
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin);
            if (controlled) {
                await page.evaluate(async () => {
                    await navigator.serviceWorker.register('/sw.js?v=warmup-test');
                    await navigator.serviceWorker.ready;
                    if (!navigator.serviceWorker.controller) await new Promise(resolve =>
                        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
                });
            }
            const path = `/tile/${controlled ? 'worker' : 'direct'}/0/0/0.webp`;
            await page.evaluate(({ warmup, path }) => {
                Object.assign(window, {
                    idleTileWarmupTimer: null, idleTileWarmupGeneration: 1, idleTileWarmupController: null,
                    idleDetailTileLayer: null, currentMapData: {}, currentImageLayer: {}, currentMapBaseLayerMode: 'tile',
                    getConfigValue: () => true, getPerformanceNumber: (_, fallback) => fallback,
                    getMapTileSource: () => ({}), getIdleTileWarmupCandidates: () => [{ url: `${path}?v=test` }],
                    scheduleIdleTask: resolve => resolve(),
                    createSimpleCrsTileLayer: () => { throw new Error('Stale detail layer created'); }
                });
                window.eval(warmup);
                window.done = false;
                window.runIdleTileWarmup(1).then(() => { window.done = true; });
            }, { warmup, path });
            await new Promise((resolve, reject) => {
                const deadline = Date.now() + 10000;
                const poll = () => pending.has(path) ? resolve() : Date.now() > deadline
                    ? reject(new Error('Tile did not reach server')) : setTimeout(poll, 10);
                poll();
            });
            await page.evaluate(() => window.cancelIdleTileWarmup());
            await page.waitForFunction(() => window.done && window.idleTileWarmupController === null);
            // The client settles while the response body is still pending. The
            // real worker's independent cache stream is allowed to complete.
            pending.get(path)();
            if (controlled) {
                await page.waitForFunction(async path => {
                    const cache = await caches.open('hag-tiles-v1');
                    const response = await cache.match(`${path}?v=test`);
                    return response && await response.text() === 'first-chunklast-chunk';
                }, path);
                const body = await page.evaluate(async path => (await fetch(`${path}?v=test`)).text(), path);
                assert.equal(body, 'first-chunklast-chunk');
                assert.equal(requests.get(path), 1, 'visible fetch reuses the completed SW tile cache');
            }
            assert.deepEqual(errors, []);
            await context.close();
            console.log(`${controlled ? 'Service-worker-controlled' : 'Direct'} warmup cancellation passed`);
        }
    } finally {
        for (const release of pending.values()) release();
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
