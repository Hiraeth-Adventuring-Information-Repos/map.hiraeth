const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { generateSharePages } = require('../scripts/generate_share_pages.js');
const { resolveImageMagickBinary } = require('../scripts/generate_tiles.js');

const binary = resolveImageMagickBinary();

function image(source, color) {
    const result = spawnSync(binary, ['-size', '8x6', `xc:${color}`, source], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
}

function fixture(t) {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraeth-share-cache-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(repoRoot, 'maps'));
    image(path.join(repoRoot, 'maps/one.png'), '#4488aa');
    image(path.join(repoRoot, 'maps/two.webp'), '#ddaa44');
    const calls = [];
    const options = {
        repoRoot, outputDir: path.join(repoRoot, 'dist'),
        brand: { publicUrl: 'https://maps.example.com/', shortName: 'Hiraeth Maps' },
        tree: [
            { id: 'one', imageUrl: 'maps/one.png', name: 'Map One', summary: 'Old summary' },
            { id: 'two', imageUrl: 'maps/two.webp', name: 'Map Two' }
        ],
        commandRunner(command, args, spawnOptions) {
            calls.push(args);
            return spawnSync(command, args, spawnOptions);
        }
    };
    return {
        options, calls,
        run(overrides = {}) { return generateSharePages({ ...options, ...overrides }); },
        conversions() { return calls.filter(args => args.includes('-resize')); },
        preview(id = 'one') { return fs.readFileSync(path.join(options.outputDir, 'share', id, 'preview.jpg')); },
        html() { return fs.readFileSync(path.join(options.outputDir, 'share/one/index.html'), 'utf8'); },
        cached(name = 'preview.jpg') { return path.join(repoRoot, '.cache/pages-share-thumbnails/one', name); }
    };
}

test('cold build validates thumbnails; a clean warm build needs no ImageMagick commands', (t) => {
    const f = fixture(t);
    assert.equal(f.run(), 2);
    assert.equal(f.conversions().length, 2);
    assert.equal(f.calls.filter(args => args.includes('-regard-warnings')).length, 2);
    const previews = ['one', 'two'].map(id => f.preview(id));
    assert.equal(previews[0].readUInt16BE(0), 0xffd8);
    assert.equal(previews[0].readUInt16BE(previews[0].length - 2), 0xffd9);
    fs.rmSync(f.options.outputDir, { recursive: true });
    f.calls.length = 0;
    assert.equal(f.run(), 2);
    assert.deepEqual(f.calls, []);
    ['one', 'two'].forEach((id, index) => assert.deepEqual(f.preview(id), previews[index]));
    assert.ok(fs.existsSync(path.join(f.options.outputDir, 'share/two/index.html')));
    assert.deepEqual(fs.readdirSync(f.options.outputDir), ['share']);
});

test('source bytes invalidate only the changed map even when its mtime is preserved', (t) => {
    const f = fixture(t);
    f.run();
    const original = f.preview();
    const unchanged = f.preview('two');
    const source = path.join(f.options.repoRoot, 'maps/one.png');
    const stat = fs.statSync(source);
    image(source, '#ee3377');
    fs.utimesSync(source, stat.atime, stat.mtime);
    f.calls.length = 0;
    f.run();
    assert.equal(f.conversions().length, 1);
    assert.notDeepEqual(f.preview(), original);
    assert.deepEqual(f.preview('two'), unchanged);
});

test('each configurable rendering setting invalidates the cache and dimensions match metadata', (t) => {
    const f = fixture(t);
    f.run();
    const thumbnailSettings = {};
    for (const [key, value] of Object.entries({ quality: 72, width: 600, height: 315, background: '#224466' })) {
        thumbnailSettings[key] = value;
        f.calls.length = 0;
        f.run({ thumbnailSettings });
        assert.equal(f.conversions().length, 2, key);
        assert.match(f.html(), new RegExp(`og:image:width" content="${thumbnailSettings.width || 1200}"`));
        assert.match(f.html(), new RegExp(`og:image:height" content="${thumbnailSettings.height || 630}"`));
        assert.deepEqual(fs.readdirSync(path.dirname(f.cached())).sort(), ['manifest.json', 'preview.jpg']);
    }
    f.calls.length = 0;
    f.run({ thumbnailSettings });
    assert.deepEqual(f.calls, []);
});

test('metadata-only edits always refresh HTML without rebuilding images', (t) => {
    const f = fixture(t);
    f.run();
    const preview = f.preview();
    f.options.tree[0].name = 'Renamed Map';
    f.options.tree[0].summary = '<p>A revised &amp; fresh summary.</p>';
    f.options.brand = { publicUrl: 'https://new.example.com/atlas/', shortName: 'New Brand' };
    f.calls.length = 0;
    f.run();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.preview(), preview);
    assert.match(f.html(), /Renamed Map/);
    assert.match(f.html(), /A revised &amp; fresh summary\./);
    assert.match(f.html(), /https:\/\/new.example.com\/atlas\/share\/one\//);
    assert.match(f.html(), /New Brand/);
    assert.doesNotMatch(f.html(), /Old summary/);
});

test('missing, damaged, and replaced cache entries rebuild only their map', (t) => {
    const f = fixture(t);
    f.run();
    const original = f.preview();
    const corruptions = [
        () => fs.rmSync(f.cached()),
        () => fs.rmSync(f.cached('manifest.json')),
        () => fs.writeFileSync(f.cached('manifest.json'), '{broken'),
        () => fs.writeFileSync(f.cached(), original.subarray(0, 64)),
        () => {
            const damaged = Buffer.from(original);
            damaged[Math.floor(damaged.length / 2)] ^= 1;
            fs.writeFileSync(f.cached(), damaged);
        },
        () => image(f.cached(), '#000000'),
        () => {
            const manifest = JSON.parse(fs.readFileSync(f.cached('manifest.json'), 'utf8'));
            manifest.sha256 = 'wrong';
            fs.writeFileSync(f.cached('manifest.json'), JSON.stringify(manifest));
        }
    ];
    for (const corrupt of corruptions) {
        corrupt();
        f.calls.length = 0;
        f.run();
        assert.equal(f.conversions().length, 1);
        assert.deepEqual(f.preview(), original);
    }
});

test('failed fresh JPEG validation never publishes or caches the damaged output', (t) => {
    const f = fixture(t);
    assert.throws(() => f.run({ commandRunner(command, args, options) {
        const result = spawnSync(command, args, options);
        if (args.includes('-resize')) {
            const target = args.at(-1).slice('jpeg:'.length);
            fs.writeFileSync(target, fs.readFileSync(target).subarray(0, 64));
        }
        return result;
    } }), /Share thumbnail failed for one: Invalid JPEG/);
    assert.equal(fs.existsSync(path.join(f.options.outputDir, 'share/one/preview.jpg')), false);
    assert.equal(fs.existsSync(f.cached()), false);
    assert.deepEqual(fs.readdirSync(path.dirname(f.cached())), []);
});

test('cache stays outside generated output and settings reject invalid values', (t) => {
    const f = fixture(t);
    assert.throws(() => f.run({ cacheDir: path.join(f.options.outputDir, '.cache') }), /outside the output/);
    assert.throws(() => f.run({ thumbnailSettings: { quality: 0 } }), /Invalid share thumbnail settings/);
    assert.throws(() => f.run({ thumbnailSettings: { width: 1.5 } }), /Invalid share thumbnail settings/);
    assert.throws(() => f.run({ thumbnailSettings: { background: 'bad color' } }), /Invalid share thumbnail settings/);
    assert.deepEqual(f.calls, []);
});
