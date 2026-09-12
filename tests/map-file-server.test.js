const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMapFileServer, getFileCatalog, writeMapFiles, recoverFileWrites } = require('../scripts/map_file_server.js');
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'map-file-server-')));
    fs.mkdirSync(path.join(root, 'maps'));
    fs.writeFileSync(path.join(root, 'file-studio.html'), '<head></head>Files login');
    fs.writeFileSync(path.join(root, 'site.config.json'), JSON.stringify({ brand: { siteName: 'Fixture maps' } }));
    fs.writeFileSync(path.join(root, 'map-editor.html'), '<head></head>Editor');
    const document = { id: 'world', name: 'World', imageUrl: 'maps/world.webp', extra: { retained: true }, pointsOfInterest: [{ id: 'p', x: 1.23456789, y: 2, extra: 'keep' }], regions: [{ id: 'r', points: [[0, 0], [1, 0], [1, 1]], custom: 'keep' }], lines: [{ id: 'l', points: [[1, 2], [3, 4]], custom: 'keep' }] };
    fs.writeFileSync(path.join(root, 'maps/world.json'), JSON.stringify(document));
    fs.writeFileSync(path.join(root, 'maps/world.webp'), 'artwork bytes');
    fs.writeFileSync(path.join(root, 'maps/atlas-index.json'), 'generated untouched');
    fs.writeFileSync(path.join(root, 'maps/maps.json'), JSON.stringify([{ id: 'world', dataUrl: 'maps/world.json', name: 'World', order: 0 }]));
    return { root, document };
}
test('password-free hosting only downloads: reads work and all mutations are rejected', async t => {
    const { root, document } = fixture();
    fs.mkdirSync(path.join(root, '.cache'));
    const journalPath = path.join(root, '.cache/map-file-transaction.json');
    const journal = JSON.stringify([{ path: 'maps/world.json', content: Buffer.from('must not restore').toString('base64') }]);
    fs.writeFileSync(journalPath, journal);
    const original = fs.readFileSync(path.join(root, 'maps/world.json'));
    // A stale journal and nonexistent password pointer must not be read or acted upon.
    const server = createMapFileServer({ repoRoot: root, allowedHosts: '127.0.0.1', passwordFile: '/does-not-exist/password' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/studio', '/studio/editor', '/site.config.json', '/maps/world.json', '/maps/world.webp']) assert.equal((await fetch(base + route)).status, 200, route);
    const session = await fetch(base + '/api/studio/session').then(r => r.json());
    assert.equal(session.authenticated, false);
    assert.equal(session.authenticationRequired, false);
    assert.equal(session.downloadOnly, true);
    assert.equal(session.csrfToken, undefined);
    const status = await fetch(base + '/api/editor/status').then(r => r.json());
    assert.equal(status.saveEnabled, false);
    assert.equal(status.downloadOnly, true);
    const workspace = await fetch(base + '/api/studio/workspace').then(r => r.json());
    assert.equal(workspace.workspace.mode, 'files');
    assert.equal(workspace.workspace.capabilities.canEdit, true);
    assert.equal(workspace.workspace.capabilities.canSave, false);
    const catalog = await fetch(base + '/api/editor/catalog').then(r => r.json());
    assert.equal(catalog.tree[0].imageUrl, 'maps/world.webp');
    assert.deepEqual(catalog.manifest, JSON.parse(fs.readFileSync(path.join(root, 'maps/maps.json'))));
    const rejectedHost = await new Promise((resolve, reject) => { require('node:http').get(base + '/studio', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
    assert.equal(rejectedHost, 421);
    const routes = ['/api/editor/save-map', '/api/editor/save-atlas', '/api/editor/save-workspace', '/api/editor/build-preview', '/api/studio/maps', '/api/studio/maps/plan', '/api/studio/login', '/api/studio/logout', '/api/studio/drafts', '/api/studio/publish', '/maps/world.json'];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const route of routes) {
            const response = await fetch(base + route, { method, headers: { origin: base, cookie: 'hiraeth_map_studio_session=old-session', 'X-CSRF-Token': 'old-token', 'content-type': 'application/json' }, body: JSON.stringify({ document: { ...document, name: 'Must never save' } }) });
            assert.equal(response.status, 405, `${method} ${route}`);
        }
    }
    for (const sensitive of ['/.secrets/password', '/.cache/map-file-transaction.json', '/package.json', '/scripts/map_file_server.js', '/site.config.json.private']) assert.equal((await fetch(base + sensitive)).status, 404);
    assert.deepEqual(fs.readFileSync(path.join(root, 'maps/world.json')), original);
    assert.equal(fs.readFileSync(journalPath, 'utf8'), journal);
    assert.equal(fs.readFileSync(path.join(root, 'maps/atlas-index.json'), 'utf8'), 'generated untouched');
    assert.equal(fs.readFileSync(path.join(root, 'maps/world.webp'), 'utf8'), 'artwork bytes');
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    assert.equal(fs.existsSync(path.join(root, '.secrets')), false);
});
test('explicit offline legacy helper rolls back interrupted writes without a Git repository', () => {
    const { root } = fixture();
    try {
        const target = path.join(root, 'maps/world.json');
        const original = fs.readFileSync(target);
        fs.mkdirSync(path.join(root, '.cache'));
        fs.writeFileSync(path.join(root, '.cache/map-file-transaction.json'), JSON.stringify([{ path: 'maps/world.json', content: original.toString('base64') }]));
        fs.writeFileSync(target, 'interrupted partial write');
        recoverFileWrites(root);
        assert.deepEqual(fs.readFileSync(target), original);
        assert.throws(() => writeMapFiles(root, [{ fullPath: path.join(root, 'index.html'), content: 'bad' }]), /Only top-level/);
        fs.symlinkSync(path.join(root, 'file-studio.html'), path.join(root, 'maps/alias.json'));
        assert.throws(() => writeMapFiles(root, [{ fullPath: path.join(root, 'maps/alias.json'), content: 'bad' }]), /symlinks/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('catalog reflects external JSON edits without generating atlas output', () => {
    const { root, document } = fixture();
    try {
        const before = getFileCatalog(root);
        document.imageUrl = 'maps/replacement.webp';
        document.name = 'Hand edited name';
        document.id = 'source-document-id';
        document.parentId = 'must-not-move-map';
        fs.writeFileSync(path.join(root, 'maps/world.json'), JSON.stringify(document));
        const after = getFileCatalog(root);
        assert.notEqual(after.versions['maps/world.json'], before.versions['maps/world.json']);
        assert.equal(after.tree[0].imageUrl, 'maps/replacement.webp');
        assert.equal(after.tree[0].name, 'Hand edited name');
        assert.equal(after.tree[0].id, 'world');
        assert.equal(after.tree[0].parentId, undefined);
        assert.deepEqual(after.manifest, JSON.parse(fs.readFileSync(path.join(root, 'maps/maps.json'))));
        assert.equal(fs.readFileSync(path.join(root, 'maps/atlas-index.json'), 'utf8'), 'generated untouched');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
