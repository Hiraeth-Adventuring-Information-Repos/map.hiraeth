const VERSION = new URL(self.location.href).searchParams.get('v') || '0';
const SHELL_CACHE = `hag-shell-${VERSION}`;
const DATA_CACHE = `hag-data-${VERSION}`;
const ASSET_CACHE = `hag-assets-${VERSION}`;
const TILE_CACHE = 'hag-tiles-v1';
const MAX_TILE_CACHE_ENTRIES = 1024;
const TILE_CACHE_TRIM_INTERVAL = 32;
const ALL_CACHES = [SHELL_CACHE, DATA_CACHE, ASSET_CACHE, TILE_CACHE];
let tileWritesSinceTrim = 0;

const DEFAULT_VERSIONED_SHELL_ASSETS = [
    'css/leaflet.css',
    'css/style.css',
    'css/stars.css',
    'css/Control.MiniMap.min.css',
    'js/app-config.js',
    'js/shared-utils.js',
    'js/campaign-journeys.js',
    'js/libs/leaflet.js',
    'js/libs/lucide.min.js',
    'js/libs/purify.min.js',
    'js/app.js',
    'js/starfield.js',
    'js/libs/Control.MiniMap.min.js',
    'maps/atlas-index.json',
    'site.config.json'
];

const DEFAULT_STATIC_SHELL_ASSETS = [
    './',
    'index.html',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'favicon.png',
    'apple-touch-icon.png',
    'images/clouds.webp',
    'images/toggle.svg',
    'css/images/marker-icon.png',
    'css/images/marker-icon-2x.png',
    'css/images/marker-shadow.png',
    'images/poi-icons/settlements.webp',
    'images/poi-icons/structures.webp',
    'images/poi-icons/natural-features.webp',
    'images/poi-icons/other.webp',
    'images/poi-icons/unknown.webp'
];

function versionAsset(asset) {
    if (!asset || asset === './') return asset;
    return asset.includes('?') ? `${asset}&v=${VERSION}` : `${asset}?v=${VERSION}`;
}

async function loadShellAssetConfig() {
    try {
        const configUrl = `site.config.json?v=${VERSION}`;
        const response = await fetch(configUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Config returned ${response.status}`);
        const cacheResponse = response.clone();
        const config = await response.json();
        return {
            versioned: Array.isArray(config?.assets?.serviceWorker?.versionedShellAssets)
                ? config.assets.serviceWorker.versionedShellAssets
                : DEFAULT_VERSIONED_SHELL_ASSETS,
            static: Array.isArray(config?.assets?.serviceWorker?.staticShellAssets)
                ? config.assets.serviceWorker.staticShellAssets
                : DEFAULT_STATIC_SHELL_ASSETS,
            configAsset: { url: configUrl, response: cacheResponse }
        };
    } catch (error) {
        return {
            versioned: DEFAULT_VERSIONED_SHELL_ASSETS,
            static: DEFAULT_STATIC_SHELL_ASSETS,
            configAsset: null
        };
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const configuredAssets = await loadShellAssetConfig();
        const versionedShellAssets = configuredAssets.versioned
            .filter((asset) => asset !== 'site.config.json')
            .map(versionAsset);
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll([...configuredAssets.static, ...versionedShellAssets]);
        if (configuredAssets.configAsset) {
            await cache.put(configuredAssets.configAsset.url, configuredAssets.configAsset.response);
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => {
            if (!ALL_CACHES.includes(key)) {
                return caches.delete(key);
            }
            return Promise.resolve(false);
        }));
        await trimCache(await caches.open(TILE_CACHE), MAX_TILE_CACHE_ENTRIES);
        await self.clients.claim();
    })());
});

async function networkFirstTask(request, cacheName, fallbackRequest = null) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        const cacheDone = response && response.ok
            ? cache.put(request, response.clone())
            : Promise.resolve();
        return { response, cacheDone };
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return { response: cached, cacheDone: Promise.resolve() };
        if (fallbackRequest) {
            const fallback = await caches.match(fallbackRequest);
            if (fallback) return { response: fallback, cacheDone: Promise.resolve() };
        }
        throw error;
    }
}

async function fetchAndCacheTask(request, cache) {
    const response = await fetch(request);
    const cacheDone = response && response.ok
        ? cache.put(request, response.clone())
        : Promise.resolve();
    return { response, cacheDone };
}

async function staleWhileRevalidateTask(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (!cached) return fetchAndCacheTask(request, cache);

    const refreshTask = fetchAndCacheTask(request, cache);
    const cacheDone = refreshTask
        .then((task) => task.cacheDone)
        .catch(() => undefined);
    return { response: cached, cacheDone };
}

async function cacheFirstTask(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return { response: cached, cacheDone: Promise.resolve() };
    const response = await fetch(request);
    const cacheDone = response && response.ok
        ? cache.put(request, response.clone())
        : Promise.resolve();
    return { response, cacheDone };
}

async function trimCache(cache, maxEntries) {
    const requests = await cache.keys();
    const excessCount = Math.max(0, requests.length - maxEntries);
    if (excessCount === 0) return;
    await Promise.all(requests.slice(0, excessCount).map((request) => cache.delete(request)));
}

async function persistentTileCacheTask(request) {
    const cache = await caches.open(TILE_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return { response: cached, cacheDone: Promise.resolve() };
    }

    const response = await fetch(request);
    let cacheDone = Promise.resolve();
    if (response && response.ok) {
        cacheDone = cache.put(request, response.clone()).then(async () => {
            tileWritesSinceTrim += 1;
            if (tileWritesSinceTrim < TILE_CACHE_TRIM_INTERVAL) return;
            tileWritesSinceTrim = 0;
            await trimCache(cache, MAX_TILE_CACHE_ENTRIES);
        });
    }
    return { response, cacheDone };
}

function respondWithCacheTask(event, task) {
    const taskPromise = Promise.resolve(task);
    event.respondWith(taskPromise.then(({ response }) => response));
    event.waitUntil(taskPromise
        .then(({ cacheDone }) => cacheDone)
        .catch(() => undefined));
}

function isVersionedShellRequest(url) {
    return url.searchParams.has('v');
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        respondWithCacheTask(event, networkFirstTask(request, SHELL_CACHE, 'index.html'));
        return;
    }

    if (url.pathname.endsWith('.json')) {
        respondWithCacheTask(event, isVersionedShellRequest(url)
            ? cacheFirstTask(request, DATA_CACHE)
            : networkFirstTask(request, DATA_CACHE));
        return;
    }

    if (url.pathname.includes('/tile/') && url.pathname.endsWith('.webp') && isVersionedShellRequest(url)) {
        respondWithCacheTask(event, persistentTileCacheTask(request));
        return;
    }

    if (
        url.pathname.endsWith('.webp') ||
        url.pathname.endsWith('.png') ||
        url.pathname.endsWith('.jpeg') ||
        url.pathname.endsWith('.jpg') ||
        url.pathname.endsWith('.svg') ||
        url.pathname.endsWith('.mp3')
    ) {
        respondWithCacheTask(event, isVersionedShellRequest(url)
            ? cacheFirstTask(request, ASSET_CACHE)
            : staleWhileRevalidateTask(request, ASSET_CACHE));
        return;
    }

    if (
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.js')
    ) {
        respondWithCacheTask(event, isVersionedShellRequest(url)
            ? cacheFirstTask(request, SHELL_CACHE)
            : networkFirstTask(request, SHELL_CACHE));
        return;
    }

    if (
        url.pathname === '/' ||
        url.pathname.endsWith('.html')
    ) {
        respondWithCacheTask(event, staleWhileRevalidateTask(request, SHELL_CACHE));
    }
});
