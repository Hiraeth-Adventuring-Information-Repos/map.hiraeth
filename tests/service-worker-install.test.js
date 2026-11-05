const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sw.js', 'utf8');
const listeners = new Map();
const fetchCalls = [];
const addAllCalls = [];
const putCalls = [];
const cacheNames = new Set(['hag-shell-old', 'hag-data-old', 'hag-assets-old',
    'hag-shell-0.1.39', 'hag-data-0.1.39', 'hag-assets-0.1.39', 'hag-tiles-v1',
    'other-app-cache', 'hag-unrelated-cache']);
const deletedCaches = [];
let claims = 0;
const cache = {
    async addAll(assets) {
        addAllCalls.push([...assets]);
    },
    async keys() { return []; },
    async put(request, response) {
        putCalls.push({ request: String(request), response });
    }
};
const self = {
    location: { href: 'https://maps.hiraeth.wiki/sw.js?v=0.1.39' },
    addEventListener(type, listener) {
        listeners.set(type, listener);
    },
    async skipWaiting() {},
    clients: { async claim() { claims++; } }
};

vm.runInNewContext(source, {
    URL,
    Request,
    Response,
    console,
    self,
    caches: {
        async open() { return cache; },
        async keys() { return [...cacheNames]; },
        async delete(name) { deletedCaches.push(name); return cacheNames.delete(name); }
    },
    async fetch(url) {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ assets: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    }
});

async function main() {
    let installPromise = null;
    listeners.get('install')({
        waitUntil(promise) {
            installPromise = promise;
        }
    });
    await installPromise;

    assert.deepEqual(fetchCalls, ['site.config.json?v=0.1.39']);
    assert.equal(addAllCalls.length, 1);
    assert.equal(addAllCalls[0].includes('site.config.json?v=0.1.39'), false);
    assert.equal(addAllCalls[0].includes('images/hiraeth-maps-preview.png'), false);
    assert.equal(addAllCalls[0].includes('images/sky-background.webp'), false);
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].request, 'site.config.json?v=0.1.39');
    assert.equal(putCalls[0].response.ok, true);

    let activatePromise;
    listeners.get('activate')({ waitUntil(promise) { activatePromise = promise; } });
    await activatePromise;
    assert.deepEqual(deletedCaches.sort(), ['hag-assets-old', 'hag-data-old', 'hag-shell-old']);
    assert.deepEqual([...cacheNames].sort(), ['hag-assets-0.1.39', 'hag-data-0.1.39', 'hag-shell-0.1.39',
        'hag-tiles-v1', 'hag-unrelated-cache', 'other-app-cache'].sort());
    assert.equal(claims, 1);

    console.log('service worker install and activation checks passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
