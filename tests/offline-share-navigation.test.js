const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('sw.js', 'utf8');

function createWorker({ basePath = '/', cached = [['index.html', 'installed shell']], fetch } = {}) {
    const workerUrl = `https://maps.hiraeth.wiki${basePath}sw.js?v=offline-share-test`;
    const keyFor = request => new URL(request.url || String(request), workerUrl).href;
    const store = new Map(cached.map(([url, body]) => [keyFor(url), new Response(body)]));
    const listeners = new Map();
    const putCalls = [];
    vm.runInNewContext(source, {
        URL, Request, Response, console, fetch,
        caches: { async open() { return {
            async match(request) { return store.get(keyFor(request))?.clone(); },
            async put(request, response) {
                putCalls.push(keyFor(request));
                store.set(keyFor(request), response.clone());
            }
        }; } },
        self: {
            location: { href: workerUrl, origin: new URL(workerUrl).origin },
            addEventListener(type, listener) { listeners.set(type, listener); }
        }
    });
    return {
        keyFor, putCalls,
        dispatch(asset) {
            let response;
            const lifetimes = [];
            // Public Request constructors cannot create navigation requests.
            listeners.get('fetch')({
                request: { url: keyFor(asset), method: 'GET', mode: 'navigate' },
                respondWith(promise) { response = Promise.resolve(promise); },
                waitUntil(promise) { lifetimes.push(Promise.resolve(promise)); }
            });
            assert.equal(lifetimes.length, 1, 'register cache lifetime during fetch dispatch');
            return { response, lifetime: Promise.all(lifetimes) };
        }
    };
}

function runShareFallback(html, href) {
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(script, 'uncached shares need a redirect document instead of the viewer shell');
    const current = new URL(href);
    let redirected;
    const anchor = {};
    vm.runInNewContext(script, {
        URL,
        window: { location: {
            href, search: current.search, hash: current.hash,
            replace(value) { redirected = value; }
        } },
        document: { getElementById(id) { assert.equal(id, 'open-map'); return anchor; } }
    });
    assert.equal(anchor.href, redirected, 'manual link and automatic redirect use the same target');
    return new URL(redirected);
}

for (const basePath of ['/', '/atlas/']) {
    for (const sharePath of ['share/IceBeach/', 'share/IceBeach/index.html', 'share/IceBeach']) {
        test(`offline uncached ${basePath}${sharePath} redirects to its viewer with all link state`, async () => {
            const worker = createWorker({ basePath, fetch: async () => { throw new TypeError('offline'); } });
            for (const query of ['', '?poi=Old%20Dock&src=share&stype=poi', '?region=North',
                '?line=Road', '?view=1.234,5.678,3&src=share&stype=view',
                '?poi=%3C%2Fscript%3E%3Cscript%3Ethrow%20new%20Error()%3C%2Fscript%3E']) {
                // Like browser navigation Requests, the worker URL has no fragment.
                const task = worker.dispatch(`${sharePath}${query}`);
                const response = await task.response;
                assert.equal(response.status, 200);
                assert.match(response.headers.get('content-type'), /^text\/html/);
                const html = await response.text();
                for (const fragment of ['', '#wrong-map', '#wrong-map-s=c']) {
                    const target = runShareFallback(html, worker.keyFor(`${sharePath}${query}${fragment}`));
                    assert.equal(target.pathname, basePath);
                    assert.equal(target.search, query);
                    assert.equal(target.hash, `#IceBeach${fragment.endsWith('-s=c') ? '-s=c' : ''}`);
                }
                await task.lifetime;
            }
            assert.deepEqual(worker.putCalls, [], 'do not cache a fallback as the healthy share page');
        });
    }

    test(`healthy, exact cached and 404 share navigations retain their responses at ${basePath}`, async () => {
        const share = 'share/IceBeach/?poi=Old%20Dock';
        for (const scenario of ['healthy', 'uncached-healthy', 'cached-offline', '404', 'uncached-404', '503', 'uncached-503']) {
            const worker = createWorker({
                basePath,
                cached: [['index.html', 'installed shell'], ...(scenario.startsWith('uncached') ? [] : [[share, 'cached share page']])],
                fetch: async () => {
                    if (scenario === 'cached-offline') throw new TypeError('offline');
                    return new Response(scenario.endsWith('healthy') ? 'fresh share page' : 'network error page', {
                        status: scenario.endsWith('404') ? 404 : scenario.endsWith('503') ? 503 : 200
                    });
                }
            });
            const task = worker.dispatch(share);
            const response = await task.response;
            assert.equal(response.status, scenario.endsWith('404') ? 404 : scenario.endsWith('503') ? 503 : 200);
            assert.equal(await response.text(), scenario.endsWith('healthy') ? 'fresh share page'
                : scenario.startsWith('cached') ? 'cached share page' : 'network error page');
            await task.lifetime;
            assert.equal(worker.putCalls.length, scenario.endsWith('healthy') ? 1 : 0);
        }
    });

    test(`uncached share without an installed shell retains network failures at ${basePath}`, async () => {
        for (const failure of ['offline', '503', '404']) {
            const worker = createWorker({ basePath, cached: [], fetch: async () => {
                if (failure === 'offline') throw new TypeError('offline');
                return new Response('network error page', { status: Number(failure) });
            } });
            const task = worker.dispatch('share/IceBeach/');
            if (failure === 'offline') await assert.rejects(task.response, /offline/);
            else assert.equal((await task.response).status, Number(failure));
            await task.lifetime;
            assert.deepEqual(worker.putCalls, []);
        }
    });

    test(`fallback redirects only safe share routes inside ${basePath}`, async () => {
        const worker = createWorker({ basePath, fetch: async () => { throw new TypeError('offline'); } });
        const paths = ['index.html', 'share/IceBeach/other', 'share/IceBeach/preview.jpg',
            'share/IceBeach%22%3E%3Cscript%3E/', '/elsewhere/share/IceBeach/'];
        if (basePath === '/atlas/') paths.push('/share/IceBeach/', '/atlas-other/share/IceBeach/');
        for (const path of paths) {
            const task = worker.dispatch(path);
            assert.equal(await (await task.response).text(), 'installed shell', path);
            await task.lifetime;
        }
    });
}
