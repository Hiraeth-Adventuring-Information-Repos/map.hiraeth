const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { generateAtlasIndex } = require('../scripts/generate_atlas_index.js');

const folder = (id, extra = {}) => ({ id, name: id, type: 'folder', ...extra });

function fixture(t, manifest, atlas = { tree: [], searchIndex: [] }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-hierarchy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'maps'));
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const file of ['validate_map_data.js', 'manifest_hierarchy.js', 'generate_atlas_index.js']) {
        fs.copyFileSync(path.join(__dirname, '../scripts', file), path.join(root, 'scripts', file));
    }
    fs.symlinkSync(path.join(__dirname, '../js'), path.join(root, 'js'), 'dir');
    fs.writeFileSync(path.join(root, 'site.config.json'), '{}');
    fs.writeFileSync(path.join(root, 'maps/maps.json'), JSON.stringify(manifest));
    const atlasPath = path.join(root, 'maps/atlas-index.json');
    fs.writeFileSync(atlasPath, JSON.stringify(atlas));
    return {
        root, atlasPath,
        validate() {
            const result = spawnSync(process.execPath, [path.join(root, 'scripts/validate_map_data.js')], { encoding: 'utf8' });
            if (result.error) throw result.error;
            return result;
        },
        generate() { return generateAtlasIndex({ repoRoot: root }).atlasIndex; }
    };
}

for (const [label, entries, error] of [
    ['disconnected cycle', [folder('root', { order: 0 }), folder('a', { parentId: 'b' }), folder('b', { parentId: 'a' })], /parent cycle/],
    ['rootless cycle', [folder('a', { parentId: 'b' }), folder('b', { parentId: 'a' })], /parent cycle/],
    ['self-parent', [folder('a', { parentId: 'a' })], /self-parent cycle/],
    ['unknown parent', [folder('a', { parentId: 'missing' })], /unknown parent/],
    ['duplicate normalized ID', [folder('a', { order: 0 }), folder(' a ')], /duplicate id/],
    ['invalid entry', [folder('root', { order: 0 }), null], /expected an object/],
    ['missing ID', [folder('root', { order: 0 }), { name: 'Missing' }], /non-empty string/],
    ['numeric ID', [folder('root', { order: 0 }), folder(12)], /non-empty string/],
    ['mixed hierarchy', [folder('root', { order: 0, children: [folder('hidden')] })], /use parentId/],
    ['malformed nested child', [folder('root', { children: [null] })], /expected an object/],
    ['duplicate nested ID', [folder('root', { children: [folder('child')] }), folder('child')], /duplicate id or cycle/]
]) {
    test(`generator and validator reject ${label} without rewriting atlas`, t => {
        const f = fixture(t, entries);
        const previous = fs.readFileSync(f.atlasPath, 'utf8');
        assert.throws(() => f.generate(), error);
        assert.equal(fs.readFileSync(f.atlasPath, 'utf8'), previous);
        const result = f.validate();
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, error);
    });
}

test('valid flat hierarchy preserves authored order, normalizes IDs and covers every entry', t => {
    const manifest = { maps: [
        folder('late', { parentId: 'root', order: 3 }),
        folder(' root ', { order: 1 }),
        folder('first', { parentId: ' root ', order: 1 }),
        folder('peer', { parentId: 'root', order: 1 }),
        folder('other', { order: 0 }),
        folder('deep', { parentId: 'first', order: 0 })
    ] };
    const f = fixture(t, manifest);
    const atlas = f.generate();
    assert.deepEqual(atlas.tree.map(node => node.id), ['other', 'root']);
    assert.deepEqual(atlas.tree[1].children.map(node => node.id), ['first', 'peer', 'late']);
    assert.equal(atlas.tree[1].children[0].children[0].id, 'deep');
    assert.equal(f.validate().status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'maps/maps.json'), 'utf8')), manifest,
        'normalization must not rewrite authoring data');
});

for (const wrapper of [false, true]) {
    test(`legacy nested hierarchy and file child reference survive (wrapper=${wrapper})`, t => {
        const entries = [folder('root', { children: [folder('inline'), 'file-child'] })];
        const f = fixture(t, wrapper ? { maps: entries } : entries);
        fs.writeFileSync(path.join(f.root, 'maps/file-child.json'), JSON.stringify(folder('file-child')));
        const atlas = f.generate();
        assert.deepEqual(atlas.tree[0].children.map(node => node.id), ['inline', 'file-child']);
        assert.equal(atlas.tree[0].children[1].dataUrl, 'maps/file-child.json');
        assert.equal(f.validate().status, 0);
    });
}

test('legacy file-backed parent supplies its nested children without omission', t => {
    const f = fixture(t, [folder('parent', { dataUrl: 'maps/parent.json' })]);
    fs.writeFileSync(path.join(f.root, 'maps/parent.json'), JSON.stringify(folder('parent', { children: ['child'] })));
    fs.writeFileSync(path.join(f.root, 'maps/child.json'), JSON.stringify(folder('child')));
    assert.deepEqual(f.generate().tree[0].children.map(node => node.id), ['child']);
    assert.equal(f.validate().status, 0);
});

test('legacy image-backed child keeps its referenced filename when basename differs from ID', t => {
    const f = fixture(t, [folder('root', { children: ['capital-file'] })]);
    fs.writeFileSync(path.join(f.root, 'maps/capital-file.json'), JSON.stringify({
        id: 'capital', name: 'Capital', width: 100, height: 100, imageUrl: 'maps/capital.webp'
    }));
    fs.writeFileSync(path.join(f.root, 'maps/capital.webp'), '');
    const atlas = f.generate();
    assert.equal(atlas.tree[0].children[0].id, 'capital');
    assert.equal(atlas.tree[0].children[0].dataUrl, 'maps/capital-file.json');
    assert.equal(fs.existsSync(path.join(f.root, 'maps/capital.json')), false);
    const validation = f.validate();
    assert.equal(validation.status, 0, validation.stderr);
});

test('legacy file-backed reference cycles fail before generation writes', t => {
    const f = fixture(t, [folder('parent', { dataUrl: 'maps/parent.json' })]);
    fs.writeFileSync(path.join(f.root, 'maps/parent.json'), JSON.stringify(folder('parent', { children: ['child'] })));
    fs.writeFileSync(path.join(f.root, 'maps/child.json'), JSON.stringify(folder('child', { children: ['parent'] })));
    const previous = fs.readFileSync(f.atlasPath, 'utf8');
    assert.throws(() => f.generate(), /duplicate id or cycle/);
    assert.equal(fs.readFileSync(f.atlasPath, 'utf8'), previous);
    assert.match(f.validate().stderr, /duplicate id or cycle/);
});

for (const [label, tree, error] of [
    ['omission', [folder('root')], /missing manifest id "child"/],
    ['wrong parent', [folder('root'), folder('child')], /incorrect parent/],
    ['duplicate atlas entry', [folder('root', { children: [folder('child'), folder('child')] })], /duplicate id or cycle/],
    ['unexpected atlas entry', [folder('root', { children: [folder('child')] }), folder('ghost')], /unexpected id/]
]) {
    test(`validator catches atlas ${label}`, t => {
        const f = fixture(t, [folder('root', { order: 0 }), folder('child', { parentId: 'root' })], { tree, searchIndex: [] });
        const result = f.validate();
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, error);
    });
}
