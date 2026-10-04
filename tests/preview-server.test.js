const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPreviewServer } = require('../scripts/preview_server.js');

test('source preview refreshes edits, serves cached tiles and keeps repository files read-only and private', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraeth-preview-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraeth-preview-private-'));
    const server = createPreviewServer({ repoRoot: root });
    try {
        fs.writeFileSync(path.join(root, 'index.html'), 'First version');
        fs.writeFileSync(path.join(root, 'site.config.json'), JSON.stringify({ performance: { serviceWorker: true } }));
        fs.mkdirSync(path.join(root, 'maps')); fs.writeFileSync(path.join(outside, 'secret.json'), 'secret');
        fs.symlinkSync(path.join(outside, 'secret.json'), path.join(root, 'maps/private.json'));
        fs.mkdirSync(path.join(root, 'dist/tile/test/1/0'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist/tile/test/1/0/0.webp'), 'cached tile');
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const first = await fetch(base); assert.equal(await first.text(), 'First version'); assert.equal(first.headers.get('cache-control'), 'no-store');
        fs.writeFileSync(path.join(root, 'index.html'), 'Current version');
        assert.equal(await (await fetch(base)).text(), 'Current version');
        assert.equal(await (await fetch(base + '/tile/test/1/0/0.webp')).text(), 'cached tile');
        assert.equal(await (await fetch(base + '/dist/tile/test/1/0/0.webp')).text(), 'cached tile');
        fs.mkdirSync(path.join(root, '.cache/pages-tiles/test/1/0'), { recursive: true });
        fs.writeFileSync(path.join(root, '.cache/pages-tiles/test/1/0/0.webp'), 'stable tile cache');
        fs.rmSync(path.join(root, 'dist'), { recursive: true });
        assert.equal(await (await fetch(base + '/dist/tile/test/1/0/0.webp')).text(), 'stable tile cache', 'A production rebuild must not interrupt the source preview');
        assert.equal((await (await fetch(base + '/site.config.json')).json()).performance.serviceWorker, false);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'))).performance.serviceWorker, true);
        assert.equal((await fetch(base + '/index.html', { method: 'HEAD' })).headers.get('content-length'), String('Current version'.length));
        for (const resource of ['/package.json', '/.git/config', '/maps/private.json', '/maps/%2e%2e/package.json', '/maps/.secret']) assert.equal((await fetch(base + resource)).status, 404, resource);
        assert.equal((await fetch(base + '/', { method: 'POST', body: 'replace' })).status, 405);
        assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'Current version');
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
    }
});
