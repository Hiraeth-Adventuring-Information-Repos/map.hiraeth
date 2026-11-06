const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('sw.js', 'utf8');
const VERSION = '0.1.39';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createWorker({ basePath = '/', config = { assets: {} }, failConfigOnce = false } = {}) {
    const workerUrl = `https://maps.hiraeth.wiki${basePath}sw.js?v=${VERSION}`;
    const listeners = new Map();
    const stores = new Map();
    const fetchCalls = [];
    const writeGates = new Map();
    const writeStarted = new Map();
    let offline = false;
    let skips = 0;
    let claims = 0;
    const keyFor = (request) => new URL(request.url || String(request), workerUrl).href;
    const configUrl = keyFor(`site.config.json?v=${VERSION}`);
    const networkFetch = async (request) => {
        const key = keyFor(request);
        fetchCalls.push(key);
        if (offline) throw new TypeError('Network is offline');
        if (key === configUrl && failConfigOnce) {
            failConfigOnce = false;
            throw new TypeError('First config request failed');
        }
        const value = key === configUrl ? config : { url: key };
        return new Response(JSON.stringify(value), {
            status: 200, headers: { 'content-type': 'application/json' }
        });
    };
    const caches = {
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name);
            return {
                async match(request) { return store.get(keyFor(request))?.clone(); },
                async put(request, response) {
                    const key = keyFor(request);
                    writeStarted.get(key)?.resolve();
                    await writeGates.get(key)?.promise;
                    store.set(key, response.clone());
                },
                async addAll(assets) {
                    const responses = await Promise.all(assets.map(networkFetch));
                    await Promise.all(assets.map((asset, index) => this.put(asset, responses[index])));
                },
                async keys() { return [...store.keys()].map((url) => new Request(url)); },
                async delete(request) { return store.delete(keyFor(request)); }
            };
        },
        async keys() { return [...stores.keys()]; },
        async delete(name) { return stores.delete(name); }
    };
    vm.runInNewContext(source, {
        URL, Request, Response, console, caches, fetch: networkFetch,
        self: {
            location: { href: workerUrl, origin: new URL(workerUrl).origin },
            addEventListener(type, listener) { listeners.set(type, listener); },
            async skipWaiting() { skips++; },
            clients: { async claim() { claims++; } }
        }
    });
    return {
        stores, fetchCalls, keyFor,
        get skips() { return skips; },
        get claims() { return claims; },
        setOffline() { offline = true; },
        gateWrite(asset) {
            const gate = deferred();
            const started = deferred();
            const key = keyFor(asset);
            writeGates.set(key, gate);
            writeStarted.set(key, started);
            return { started: started.promise, release: gate.resolve };
        },
        async lifecycle(type) {
            let lifetime;
            listeners.get(type)({ waitUntil(promise) { lifetime = promise; } });
            await lifetime;
        },
        fetch(asset) {
            const lifetimes = [];
            let response;
            listeners.get('fetch')({
                request: new Request(keyFor(asset)),
                respondWith(promise) { response = Promise.resolve(promise); },
                waitUntil(promise) { lifetimes.push(Promise.resolve(promise)); }
            });
            assert.equal(lifetimes.length, 1, 'cache work must be registered during fetch dispatch');
            return { response, lifetime: Promise.all(lifetimes) };
        }
    };
}

for (const basePath of ['/', '/atlas/']) {
    test(`default installed images are available on their first offline fetch at ${basePath}`, async () => {
        const worker = createWorker({ basePath });
        const images = [
            'favicon-16x16.png', 'favicon-32x32.png', 'favicon.png', 'apple-touch-icon.png',
            'images/clouds.webp', 'images/toggle.svg',
            'css/images/marker-icon.png', 'css/images/marker-icon-2x.png', 'css/images/marker-shadow.png',
            'images/poi-icons/settlements.webp', 'images/poi-icons/structures.webp',
            'images/poi-icons/natural-features.webp', 'images/poi-icons/other.webp', 'images/poi-icons/unknown.webp'
        ];
        const gate = worker.gateWrite('images/clouds.webp');
        let installed = false;
        const install = worker.lifecycle('install').then(() => { installed = true; });
        await gate.started;
        assert.equal(installed, false, 'install must wait for image writes');
        assert.equal(worker.skips, 0);
        gate.release();
        await install;
        worker.setOffline();
        const media = worker.stores.get(`hag-assets-${VERSION}`);
        const shell = worker.stores.get(`hag-shell-${VERSION}`);
        for (const image of images) {
            assert.equal(media?.has(worker.keyFor(image)), true, `${image} must use its runtime cache`);
            assert.equal(shell.has(worker.keyFor(image)), false);
            const task = worker.fetch(image);
            assert.deepEqual(await (await task.response).json(), { url: worker.keyFor(image) });
            await task.lifetime;
        }
    });

    test(`configured media preserve static and versioned offline routes at ${basePath}`, async () => {
        const staticMedia = ['images/custom.webp', 'images/custom.png', 'images/custom.jpeg',
            'images/custom.jpg', 'images/custom.svg', 'audio/custom.mp3', 'tile/custom/0/0/0.webp'];
        const versionedMedia = ['images/release.webp', 'images/release.png', 'images/release.jpeg',
            'images/release.jpg', 'images/release.svg', 'audio/release.mp3'];
        const tile = `tile/custom/1/0/0.webp?v=${VERSION}`;
        const worker = createWorker({ basePath, config: { assets: { serviceWorker: {
            staticShellAssets: ['index.html', ...staticMedia],
            versionedShellAssets: ['js/app.js', ...versionedMedia, 'tile/custom/1/0/0.webp']
        } } } });
        worker.stores.set('hag-assets-old', new Map([
            [worker.keyFor(`images/release.webp?v=old`), new Response('obsolete image')]
        ]));
        await worker.lifecycle('install');
        worker.setOffline();
        const media = worker.stores.get(`hag-assets-${VERSION}`);
        for (const asset of [...staticMedia, ...versionedMedia.map((asset) => `${asset}?v=${VERSION}`), tile]) {
            const destination = asset === tile ? worker.stores.get('hag-tiles-v1') : media;
            assert.equal(destination?.has(worker.keyFor(asset)), true, `${asset} must use its runtime cache`);
            assert.equal(worker.stores.get(`hag-shell-${VERSION}`).has(worker.keyFor(asset)), false);
            const fetchCount = worker.fetchCalls.length;
            const task = worker.fetch(asset);
            assert.deepEqual(await (await task.response).json(), { url: worker.keyFor(asset) });
            await task.lifetime;
            assert.equal(worker.fetchCalls.length, fetchCount + (asset.includes('?v=') ? 0 : 1),
                'only static media should attempt a background refresh');
        }
        for (const asset of ['images/release.webp', 'images/release.webp?v=old']) {
            const missing = worker.fetch(asset);
            await assert.rejects(missing.response, /offline/, 'media keys must preserve version boundaries');
            await missing.lifetime;
        }
    });

    test(`installed config and atlas are available offline at ${basePath}`, async () => {
        const worker = createWorker({ basePath });
        const atlasAsset = `maps/atlas-index.json?v=${VERSION}`;
        const configAsset = `site.config.json?v=${VERSION}`;
        const gate = worker.gateWrite(atlasAsset);
        let installed = false;
        const install = worker.lifecycle('install').then(() => { installed = true; });
        await gate.started;
        assert.equal(installed, false, 'install must wait for precached data writes');
        assert.equal(worker.skips, 0, 'worker cannot activate before data is cached');
        gate.release();
        await install;
        assert.equal(worker.skips, 1);
        const data = worker.stores.get(`hag-data-${VERSION}`);
        const shell = worker.stores.get(`hag-shell-${VERSION}`);
        for (const asset of [configAsset, atlasAsset]) {
            assert.equal(data.has(worker.keyFor(asset)), true);
            assert.equal(shell.has(worker.keyFor(asset)), false);
        }
        assert.equal(shell.has(worker.keyFor(`js/app.js?v=${VERSION}`)), true);
        assert.equal(worker.fetchCalls.filter((url) => url === worker.keyFor(configAsset)).length, 1,
            'reuse the fetched config response');

        worker.stores.set('hag-shell-old', new Map());
        worker.stores.set('hag-data-old', new Map());
        worker.stores.set('hag-assets-old', new Map());
        worker.stores.set(`hag-assets-${VERSION}`, new Map());
        worker.stores.set('hag-tiles-v1', new Map());
        worker.stores.set('other-app-cache', new Map());
        worker.stores.set('hag-unrelated-cache', new Map());
        await worker.lifecycle('activate');
        assert.deepEqual([...worker.stores.keys()].sort(), [
            `hag-shell-${VERSION}`, `hag-data-${VERSION}`, `hag-assets-${VERSION}`,
            'hag-tiles-v1', 'other-app-cache', 'hag-unrelated-cache'
        ].sort());
        assert.equal(worker.claims, 1);

        const fetchCount = worker.fetchCalls.length;
        worker.setOffline();
        for (const asset of [configAsset, atlasAsset]) {
            const task = worker.fetch(asset);
            const response = await task.response;
            assert.equal(response.ok, true);
            const body = await response.json();
            assert.deepEqual(body, asset === configAsset ? { assets: {} } : { url: worker.keyFor(asset) });
            await task.lifetime;
        }
        assert.equal(worker.fetchCalls.length, fetchCount, 'offline versioned hits must use installed data');
        const otherVersion = worker.fetch('maps/atlas-index.json?v=another-release');
        await assert.rejects(otherVersion.response, /offline/, 'version keys must remain distinct');
        await otherVersion.lifetime;
    });
}

test('config fetch failure retries and precaches fallback config', async () => {
    const worker = createWorker({ failConfigOnce: true });
    await worker.lifecycle('install');
    worker.setOffline();
    const task = worker.fetch(`site.config.json?v=${VERSION}`);
    assert.deepEqual(await (await task.response).json(), { assets: {} });
    await task.lifetime;
    assert.equal(worker.fetchCalls.filter((url) => url === worker.keyFor(`site.config.json?v=${VERSION}`)).length, 2);
});

test('source bootstrap loads unversioned config offline using only the active release', async () => {
    const config = { assets: { version: VERSION }, brand: { siteName: 'Installed map settings' } };
    const staleConfig = { assets: { version: 'old' }, brand: { siteName: 'Obsolete settings' } };
    const worker = createWorker({ basePath: '/atlas/', config });
    const versionedConfig = `site.config.json?v=${VERSION}`;
    const oldEntries = new Map([
        [worker.keyFor('site.config.json'), new Response(JSON.stringify(staleConfig))],
        [worker.keyFor(versionedConfig), new Response(JSON.stringify(staleConfig))]
    ]);
    worker.stores.set('hag-data-old', oldEntries);
    worker.stores.set('hag-shell-old', new Map(oldEntries));
    await worker.lifecycle('install');
    worker.setOffline();

    async function bootSourcePage() {
        const requests = [];
        const context = {
            console,
            fetch(asset) {
                requests.push(asset);
                const task = worker.fetch(asset);
                return task.response.then(async (response) => {
                    await task.lifetime;
                    return response;
                });
            }
        };
        vm.runInNewContext(fs.readFileSync('js/app-config.js', 'utf8'), context);
        // Match index.html's default boot call rather than inventing a versioned request.
        await context.AppConfig.loadConfig();
        assert.deepEqual(requests, ['site.config.json']);
        assert.equal(context.AppConfig.get('brand.siteName'), config.brand.siteName);
        assert.equal(context.APP_ASSET_VERSION, VERSION);
    }

    await bootSourcePage();
    await worker.lifecycle('activate');
    assert.equal(worker.stores.has('hag-data-old'), false);
    assert.equal(worker.stores.has('hag-shell-old'), false);
    await bootSourcePage();

    worker.stores.get(`hag-data-${VERSION}`).delete(worker.keyFor(versionedConfig));
    worker.stores.set('hag-data-old', oldEntries);
    worker.stores.set('hag-shell-old', new Map(oldEntries));
    const missing = worker.fetch('site.config.json');
    await assert.rejects(missing.response, /offline/, 'never fall back to config from another cache version');
    await missing.lifetime;
});

test('configured JSON assets share runtime data storage and runtime writes extend fetch lifetime', async () => {
    const worker = createWorker({ config: { assets: { serviceWorker: {
        versionedShellAssets: ['maps/custom.json', 'site.config.json', 'js/app.js'],
        staticShellAssets: ['index.html', 'maps/unversioned.json']
    } } } });
    await worker.lifecycle('install');
    const data = worker.stores.get(`hag-data-${VERSION}`);
    assert.equal(data.has(worker.keyFor(`maps/custom.json?v=${VERSION}`)), true);
    assert.equal(data.has(worker.keyFor('maps/unversioned.json')), true);

    const asset = `maps/lazy-map.json?v=${VERSION}`;
    const gate = worker.gateWrite(asset);
    const task = worker.fetch(asset);
    await gate.started;
    assert.deepEqual(await (await task.response).json(), { url: worker.keyFor(asset) });
    let settled = false;
    const lifetime = task.lifetime.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, 'fetch lifetime must cover runtime cache writes');
    gate.release();
    await lifetime;
    worker.setOffline();
    for (const cachedAsset of [asset, `maps/custom.json?v=${VERSION}`, 'maps/unversioned.json']) {
        const cached = worker.fetch(cachedAsset);
        assert.deepEqual(await (await cached.response).json(), { url: worker.keyFor(cachedAsset) });
        await cached.lifetime;
    }
});
