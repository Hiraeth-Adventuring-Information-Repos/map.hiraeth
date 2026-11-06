const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const config = require('../js/app-config.js');
const html = fs.readFileSync('index.html', 'utf8');
const optional = ['js/travel-network.js', 'js/city-addresses.js', 'css/city-addresses.css'];
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const preload = inline.find(source => source.includes('function preloadRuntimeAssets()'));
const bootstrap = inline.find(source => source.includes('function loadVersionedLocalScripts()'));
const hydrate = inline.find(source => source.includes('function loadConfigAndHydrateShell()'));

for (const search of ['', '?routing=0', '?routing=true', '?routing=1', '?routing=1&embed=true', '?routing=1&hideUI=true', '?routing=1&embed=false&embed=true', '?routing=1&embed=true&embed=false']) {
    for (const mode of ['default', 'configured', 'rejected']) {
        test(`routing assets and ordered bootstrap: ${search || 'normal'} / ${mode}`, async () => {
            const dom = new JSDOM(html, { url: `https://maps.example/atlas/${search}`, runScripts: 'outside-only' });
            const { window } = dom;
            const scripts = [];
            const originalAppend = window.document.body.appendChild.bind(window.document.body);
            window.document.body.appendChild = element => {
                originalAppend(element);
                if (element.tagName === 'SCRIPT') {
                    scripts.push(new URL(element.src).pathname.replace('/atlas/', ''));
                    element.onload?.();
                }
                return element;
            };
            if (mode !== 'default') {
                window.AppConfig = {
                    ready: mode === 'rejected' ? Promise.reject(new Error('config unavailable')) : Promise.resolve(),
                    get(key, fallback) { return config.get(key, fallback); },
                    loadConfig: () => Promise.resolve(),
                    hydrateStaticDom() {}, applyDocumentMetadata() {}, applyThemeTokens() {}, injectFont() {}
                };
            }
            window.eval(preload);
            window.eval(hydrate);
            window.eval(bootstrap);
            await new Promise(resolve => setImmediate(resolve));
            const enabled = search === '?routing=1' || search === '?routing=1&embed=true&embed=false';
            const requests = [...window.document.querySelectorAll('link[href]')].map(link => new URL(link.href).pathname.replace('/atlas/', ''));
            for (const asset of optional) {
                assert.equal(requests.includes(asset) || scripts.includes(asset), enabled, asset);
            }
            assert.equal(scripts.at(-1), 'js/app.js');
            if (enabled) {
                assert.ok(scripts.indexOf('js/travel-network.js') < scripts.indexOf('js/city-addresses.js'));
                assert.ok(scripts.indexOf('js/city-addresses.js') < scripts.indexOf('js/app.js'));
                assert.ok(requests.includes('css/city-addresses.css'));
            }
            dom.window.close();
        });
    }
}

test('configured service worker shell excludes optional routing code', () => {
    const shell = config.get('assets.serviceWorker.versionedShellAssets');
    for (const asset of optional) assert.equal(shell.includes(asset), false, asset);
});
