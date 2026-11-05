const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { validateDist, requiredPagesFiles, optimizedAssetBudgets } = require('../scripts/validate_dist.js');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-artifact-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (name, value) => {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
    };
    requiredPagesFiles.forEach(name => write(name, ''));
    write('site.config.json', {});
    write('js/app.js', 'const viewer=1;');
    write('css/style.css', 'body{color:red}');
    const tileSource = { cacheVersion: 'fingerprint', maxZoom: 0, quality: 90 };
    const map = { id: 'fixture', name: 'Fixture', width: 100, height: 100, scalePixels: 1, scaleKilometers: 1,
        tileSource, lines: [], routingDataUrl: 'maps/routing/Fair-Content.json', routingDataFields: ['lines'] };
    write('maps/Fair-Content.json', map);
    write('maps/atlas-index.json', { tree: [{ id: 'fixture', tileSource, dataUrl: 'maps/Fair-Content.json' }],
        searchIndexUrl: 'maps/atlas-search-index.json' });
    write('maps/atlas-search-index.json', { searchIndex: [{ kind: 'map', mapId: 'fixture', name: 'Fixture' }] });
    write('tile/manifest.json', { maps: [{ id: 'fixture', cacheVersion: 'fingerprint', width: 100, height: 100,
        tileSource, levels: [{ z: 0, scaledWidth: 100, scaledHeight: 100, quality: 90 }] }] });
    write('maps/routing/Fair-Content.json', { mapId: 'fixture', lines: [{ id: 'road', name: 'Road', travelMode: 'road',
        travelFrom: 'Town', travelTo: 'Port', travelSpeedKph: 5, coordinates: [[0, 0], [1, 1]] }] });
    return { root, write, validate: () => validateDist({ distDir: root }),
        change(name, change) { const value = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); change(value); write(name, value); } };
}

function snapshot(root) {
    const result = {};
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(target);
            else result[path.relative(root, target)] = {
                mtime: fs.statSync(target).mtimeMs,
                hash: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
            };
        }
    }
    visit(root);
    return result;
}

test('validating an existing artifact preserves every file and modification time', t => {
    const f = fixture(t);
    const before = snapshot(f.root);
    const result = f.validate();
    assert.ok(result.fileCount > 0);
    assert.equal(result.atlasSearchEntries, 1);
    assert.deepEqual(snapshot(f.root), before);
    f.validate();
    assert.deepEqual(snapshot(f.root), before, 'repeat validation must neither build nor rewrite the artifact');
});

const atlas = 'maps/atlas-index.json', base = 'maps/Fair-Content.json', routing = 'maps/routing/Fair-Content.json';
for (const [label, corrupt, expected] of [
    ['missing required file', f => fs.rmSync(path.join(f.root, 'index.html')), /Required Pages files missing/],
    ['forbidden file', f => f.write('map-editor.html', 'private'), /Forbidden editor/],
    ['legacy PNG', f => f.write('images/poi-icons/old.png', 'old'), /Legacy POI PNG/],
    ['wrong fingerprint', f => f.change(base, value => { value.tileSource.cacheVersion = 'stale'; }), /fingerprints/],
    ['missing manifest maps', f => f.change('tile/manifest.json', value => { value.maps = []; }), /tile manifest is missing maps/],
    ['reduced native size', f => f.change('tile/manifest.json', value => { value.maps[0].levels[0].scaledWidth = 50; }), /native map detail/],
    ['reduced native quality', f => f.change('tile/manifest.json', value => { value.maps[0].levels[0].quality = 50; }), /native map detail/],
    ['app budget', f => f.write('js/app.js', 'x'.repeat(optimizedAssetBudgets.appBytes + 1)), /budgets exceeded/],
    ['style budget', f => f.write('css/style.css', 'x'.repeat(optimizedAssetBudgets.styleBytes + 1)), /budgets exceeded/],
    ['atlas budget', f => f.change(atlas, value => { value.padding = 'x'.repeat(optimizedAssetBudgets.atlasShellBytes); }), /budgets exceeded/],
    ['inline search', f => f.change(atlas, value => { value.searchIndex = []; }), /must defer/],
    ['wrong search URL', f => f.change(atlas, value => { value.searchIndexUrl = 'wrong.json'; }), /must defer/],
    ['missing search entries', f => f.write('maps/atlas-search-index.json', { searchIndex: [] }), /missing search entries/],
    ['expanded JSON', f => f.write(routing, JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.root, routing))), null, 2)), /not compact/],
    ['missing base map', f => fs.rmSync(path.join(f.root, base)), /ENOENT/],
    ['missing routing payload', f => fs.rmSync(path.join(f.root, routing)), /ENOENT/],
    ['wrong map identity', f => f.change(routing, value => { value.mapId = 'other'; }), /mismatched routing/],
    ['missing routing fields', f => f.change(routing, value => { delete value.lines; }), /Incomplete/],
    ['missing field declaration', f => f.change(base, value => { delete value.routingDataFields; }), /Incomplete/],
    ['duplicate field declaration', f => {
        f.change(base, value => { value.routingDataFields = ['lines', 'lines']; });
        f.change(routing, value => { value.buildings = []; });
    }, /Incomplete/],
    ['invalid geometry', f => f.change(routing, value => { value.lines[0].coordinates = [[null, ''], [1, 1]]; }), /Invalid routing geometry/],
    ['missing routing reference', f => f.change(base, value => { delete value.routingDataUrl; }), /Missing routing reference/],
    ['orphan routing payload', f => f.write('maps/routing/orphan.json', { mapId: 'orphan', lines: [] }), /Unreferenced routing payload/],
    ['outside artifact reference', f => f.change(base, value => { value.routingDataUrl = 'maps/routing/../../../outside.json'; }), /escapes dist/]
]) {
    test(`corrupt artifact rejects ${label} without changing files`, t => {
        const f = fixture(t);
        corrupt(f);
        const before = snapshot(f.root);
        assert.throws(f.validate, expected);
        assert.deepEqual(snapshot(f.root), before);
    });
}

test('both workflows validate the artifact after building and before uploading', () => {
    for (const name of ['pages-build-check.yml', 'pages-deploy.yml']) {
        const workflow = fs.readFileSync(path.join('.github/workflows', name), 'utf8');
        const build = workflow.indexOf('run: npm run build:pages');
        const validate = workflow.indexOf('run: npm run validate:dist');
        const upload = workflow.indexOf('uses: actions/upload-');
        assert.ok(build >= 0 && validate > build && upload > validate, name);
    }
});
