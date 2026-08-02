const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    assertLoopbackBindHost,
    classifyChangedFilePath,
    compareLiveSourcesToDist,
    createEditorServer,
    getChangedFileGroups,
    getPublishReadiness,
    isAllowedEditorWriteRequest,
    isLoopbackHost,
    isSameOriginWriteRequest,
    resolvePreviewRequestPath,
    resolveMapTargetPath,
    validateAtlasManifestDocument,
    validateMapDocument
} = require('../scripts/editor_server.js');

const repoRoot = path.join(os.tmpdir(), 'map-editor-server-test');
fs.rmSync(repoRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(repoRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'dist', 'index.html'), '<!doctype html><title>Preview</title>');
fs.mkdirSync(path.join(repoRoot, 'css'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'dist', 'css'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'maps'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'dist', 'maps'), { recursive: true });

assert.equal(isLoopbackHost('127.0.0.1'), true);
assert.equal(isLoopbackHost('127.10.20.30'), true);
assert.equal(isLoopbackHost('localhost'), true);
assert.equal(isLoopbackHost('::1'), true);
assert.equal(isLoopbackHost('0.0.0.0'), false);
assert.equal(isLoopbackHost('192.168.1.20'), false);
assert.throws(() => assertLoopbackBindHost('0.0.0.0'), /Refusing to start editor server/);

assert.equal(isAllowedEditorWriteRequest({
    headers: {
        host: '127.0.0.1:8010',
        origin: 'http://127.0.0.1:8010'
    }
}), true);
assert.equal(isAllowedEditorWriteRequest({
    headers: {
        host: 'localhost:8010',
        origin: 'http://localhost:8010'
    }
}), true);
assert.equal(isAllowedEditorWriteRequest({
    headers: {
        host: 'editor.localhost:8010',
        referer: 'http://editor.localhost:8010/map-editor.html'
    }
}), true);
assert.equal(isAllowedEditorWriteRequest({
    headers: {
        host: '127.0.0.1:8010',
        origin: 'http://evil.example'
    }
}), false);
assert.equal(isAllowedEditorWriteRequest({
    headers: {
        host: '127.0.0.1:8010',
        origin: 'http://localhost:8010'
    }
}), false);
assert.equal(isAllowedEditorWriteRequest({
    headers: {
        host: '0.0.0.0:8010',
        origin: 'http://0.0.0.0:8010'
    }
}), false);
assert.equal(isAllowedEditorWriteRequest({ headers: { host: '127.0.0.1:8010' } }), false);

assert.equal(isSameOriginWriteRequest({
    headers: {
        host: 'map-studio.local',
        origin: 'https://map-studio.local',
        'x-forwarded-proto': 'https'
    }
}), true);
assert.equal(isSameOriginWriteRequest({
    headers: {
        host: 'map-studio.local',
        origin: 'http://map-studio.local',
        'x-forwarded-proto': 'https'
    }
}), false);

assert.equal(
    resolveMapTargetPath(repoRoot, { dataUrl: 'maps/IceBeach.json' }).relativePath,
    'maps/IceBeach.json'
);
assert.equal(
    resolveMapTargetPath(repoRoot, { fileName: 'IceBeach.json' }).relativePath,
    'maps/IceBeach.json'
);
assert.equal(
    resolveMapTargetPath(repoRoot, { mapId: 'IceBeach' }).relativePath,
    'maps/IceBeach.json'
);

assert.equal(
    path.relative(repoRoot, resolvePreviewRequestPath(repoRoot, '/preview/')).split(path.sep).join('/'),
    'dist/index.html'
);
assert.equal(resolvePreviewRequestPath(repoRoot, '/preview/../package.json'), null);

const readiness = getPublishReadiness(repoRoot);
assert.equal(readiness.pagesBundle.built, true);
assert.ok(Array.isArray(readiness.changedFiles));
assert.ok(Array.isArray(readiness.changedFileGroups));
assert.ok(Array.isArray(readiness.warnings));

assert.equal(classifyChangedFilePath('maps/Astrousia.json'), 'Map data');
assert.equal(classifyChangedFilePath('dist/maps/atlas-index.json'), 'Pages bundle');
assert.equal(classifyChangedFilePath('map-editor.html'), 'Editor-only');
assert.equal(classifyChangedFilePath('scripts/build_pages.js'), 'CI/scripts');
assert.equal(classifyChangedFilePath('readme.md'), 'Unrelated');

const groupedFiles = getChangedFileGroups([
    ' M maps/Astrousia.json',
    ' M dist/maps/atlas-index.json',
    ' M js/map-editor.js',
    '?? scripts/publish_check.js',
    ' D readme.md'
]);
assert.deepEqual(groupedFiles.map((group) => group.label), [
    'Map data',
    'Pages bundle',
    'Editor-only',
    'CI/scripts',
    'Unrelated'
]);

fs.writeFileSync(path.join(repoRoot, 'css', 'style.css'), 'new css');
fs.writeFileSync(path.join(repoRoot, 'dist', 'css', 'style.css'), 'old css');
let drift = compareLiveSourcesToDist(repoRoot, ['css/style.css']);
assert.equal(drift.mismatches.length, 1);
assert.equal(drift.mismatches[0].source, 'css/style.css');
fs.writeFileSync(path.join(repoRoot, 'dist', 'css', 'style.css'), 'new css');
drift = compareLiveSourcesToDist(repoRoot, ['css/style.css']);
assert.equal(drift.mismatches.length, 0);

fs.writeFileSync(path.join(repoRoot, 'maps', 'maps.json'), '[]');
fs.writeFileSync(path.join(repoRoot, 'maps', 'atlas-index.json'), '{"tree":[]}');
fs.writeFileSync(path.join(repoRoot, 'dist', 'maps', 'atlas-index.json'), '{"tree":[{"id":"old"}]}');
drift = compareLiveSourcesToDist(repoRoot, ['maps/maps.json']);
assert.equal(drift.mismatches.length, 1);
assert.equal(drift.mismatches[0].source, 'maps/atlas-index.json');

[
    { dataUrl: '../secrets.json' },
    { dataUrl: 'maps/generated/IceBeach.json' },
    { dataUrl: 'maps/maps.json' },
    { dataUrl: 'maps/atlas-index.json' },
    { dataUrl: '/tmp/IceBeach.json' }
].forEach((payload) => {
    assert.throws(() => resolveMapTargetPath(repoRoot, payload), /Map saves can only target|Use Save Atlas Structure/);
});

assert.deepEqual(validateMapDocument({ id: 'map', name: 'Map', pointsOfInterest: [], regions: [] }), []);
assert.match(validateMapDocument(null).join(' '), /Map document must be a JSON object/);
assert.match(validateMapDocument({ id: '', name: '' }).join(' '), /id is required/);
assert.match(validateMapDocument({ id: 'map', name: 'Map', regions: {} }).join(' '), /regions must be an array/);

assert.deepEqual(validateAtlasManifestDocument([
    { id: 'root', name: 'Root' },
    { id: 'child', name: 'Child', parentId: 'root' }
]), []);
assert.match(validateAtlasManifestDocument({}).join(' '), /Atlas structure must be an array/);
assert.match(validateAtlasManifestDocument([
    { id: 'root', name: 'Root' },
    { id: 'root', name: 'Duplicate' }
]).join(' '), /Duplicate id/);
assert.match(validateAtlasManifestDocument([
    { id: 'child', name: 'Child', parentId: 'missing' }
]).join(' '), /unknown parentId/);

assert.equal(typeof createEditorServer({ repoRoot }).listen, 'function');

console.log('editor server checks passed');
