const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    assertNewMapMetadata,
    createNewMapFromUpload,
    getNextOrder,
    metadataFromHeaders
} = require('../scripts/map_studio_maps.js');

const existing = [
    { id: 'root', name: 'Root', order: 0 },
    { id: 'child', name: 'Child', parentId: 'root', order: 4 }
];
assert.equal(getNextOrder(existing, 'root'), 5);
assert.equal(getNextOrder(existing, ''), 1);
assert.throws(() => assertNewMapMetadata({ id: '../bad', name: 'Bad' }, existing), /Map ID/);
assert.throws(() => assertNewMapMetadata({ id: 'child', name: 'Duplicate' }, existing), /already exists/);
assert.throws(() => assertNewMapMetadata({ id: 'new', name: 'New', parentId: 'missing' }, existing), /does not exist/);
assert.throws(() => assertNewMapMetadata({ id: 'new', name: 'New', scalePixels: 10 }, existing), /both be set/);

const encodedMetadata = Buffer.from(JSON.stringify({ id: 'new-map', name: 'New Map' })).toString('base64url');
assert.deepEqual(metadataFromHeaders({ 'x-map-metadata': encodedMetadata }), { id: 'new-map', name: 'New Map' });

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-studio-map-test-'));
fs.mkdirSync(path.join(repoRoot, 'maps'));
fs.writeFileSync(path.join(repoRoot, 'maps', 'maps.json'), `${JSON.stringify(existing, null, 2)}\n`);
const uploadPath = path.join(repoRoot, 'upload.webp');
fs.writeFileSync(uploadPath, 'fake-webp');
let capturedWrites = null;
const result = createNewMapFromUpload({
    repoRoot,
    uploadPath,
    metadata: {
        id: 'new-map',
        name: 'New Map',
        parentId: 'root',
        scalePixels: 100,
        scaleKilometers: 5,
        selectorDescription: 'A new map.'
    },
    readDimensions: () => ({ width: 2048, height: 1024 }),
    writeDocuments: (_repoRoot, writes) => { capturedWrites = writes; }
});
assert.equal(result.map.width, 2048);
assert.equal(result.map.height, 1024);
assert.equal(result.map.imageUrl, 'maps/new-map.webp');
assert.equal(result.manifestEntry.parentId, 'root');
assert.equal(result.manifestEntry.order, 5);
assert.equal(capturedWrites.length, 3);

fs.rmSync(repoRoot, { recursive: true, force: true });
console.log('map studio new-map checks passed');
