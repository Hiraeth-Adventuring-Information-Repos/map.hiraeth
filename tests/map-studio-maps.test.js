const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    assertNewMapMetadata,
    createNewMapFromUpload,
    getArtworkType,
    getNextOrder,
    metadataFromHeaders,
    planNewMapCreation,
    prepareMapArtwork,
    prepareMapThumbnail
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
assert.equal(getArtworkType('image/png').extension, 'png');
assert.throws(() => getArtworkType('image/svg+xml'), /WebP, PNG, or JPEG/);

const encodedMetadata = Buffer.from(JSON.stringify({ id: 'new-map', name: 'New Map' })).toString('base64url');
assert.deepEqual(metadataFromHeaders({ 'x-map-metadata': encodedMetadata }), { id: 'new-map', name: 'New Map' });

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-studio-map-test-'));
fs.mkdirSync(path.join(repoRoot, 'maps'));
fs.writeFileSync(path.join(repoRoot, 'maps', 'maps.json'), `${JSON.stringify(existing, null, 2)}\n`);
const uploadPath = path.join(repoRoot, 'upload.webp');
fs.writeFileSync(uploadPath, 'fake-webp');
const plan = planNewMapCreation({
    repoRoot,
    metadata: {
        id: 'planned-map',
        name: 'Planned Map',
        parentId: 'root',
        artworkContentType: 'image/png'
    }
});
assert.equal(plan.files.length, 5);
assert.equal(plan.files[0].path, 'maps/planned-map.webp');
assert.equal(plan.files[1].path, 'maps/planned-map.mini.webp');
assert.match(plan.files[1].purpose, /preview/);
assert.equal(plan.files[3].action, 'Update');
assert.match(plan.preprocessing, /Convert PNG/);

const preservedArtwork = prepareMapArtwork({ uploadPath, contentType: 'image/webp' });
assert.equal(preservedArtwork.artworkPath, uploadPath);
assert.equal(preservedArtwork.converted, false);

const pngUploadPath = path.join(repoRoot, 'upload.png');
fs.writeFileSync(pngUploadPath, 'fake-png');
let conversionCommand = null;
const convertedArtwork = prepareMapArtwork({
    uploadPath: pngUploadPath,
    contentType: 'image/png',
    runCommand: (command, args) => {
        conversionCommand = { command, args };
        fs.writeFileSync(args.at(-1), 'converted-webp');
        return { status: 0, stdout: '', stderr: '' };
    }
});
assert.equal(convertedArtwork.converted, true);
assert.equal(path.extname(convertedArtwork.artworkPath), '.webp');
assert.equal(conversionCommand.command, 'magick');
assert.ok(conversionCommand.args.includes('-strip'));

let thumbnailCommand = null;
const preparedThumbnail = prepareMapThumbnail({
    artworkPath: uploadPath,
    runCommand: (command, args) => {
        thumbnailCommand = { command, args };
        fs.writeFileSync(args.at(-1), 'thumbnail-webp');
        return { status: 0, stdout: '', stderr: '' };
    }
});
assert.equal(path.basename(preparedThumbnail.thumbnailPath), 'upload.mini.webp');
assert.equal(preparedThumbnail.maximumDimension, 512);
assert.equal(thumbnailCommand.command, 'magick');
assert.ok(thumbnailCommand.args.includes('512x512>'));
assert.ok(thumbnailCommand.args.includes('-resize'));
assert.equal(thumbnailCommand.args[0], uploadPath);
assert.notEqual(thumbnailCommand.args.at(-1), uploadPath);
assert.throws(() => prepareMapThumbnail({
    artworkPath: uploadPath,
    maximumDimension: 1024,
    runCommand: () => ({ status: 0, stdout: '', stderr: '' })
}), /between 1 and 512/);

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
    createThumbnail: ({ artworkPath }) => ({
        thumbnailPath: preparedThumbnail.thumbnailPath,
        sourceArtworkPath: artworkPath
    }),
    writeDocuments: (_repoRoot, writes) => { capturedWrites = writes; }
});
assert.equal(result.map.width, 2048);
assert.equal(result.map.height, 1024);
assert.equal(result.map.imageUrl, 'maps/new-map.webp');
assert.equal(result.manifestEntry.parentId, 'root');
assert.equal(result.manifestEntry.order, 5);
assert.equal(result.files[1], 'maps/new-map.mini.webp');
assert.equal(capturedWrites.length, 4);
assert.equal(capturedWrites[0].sourcePath, uploadPath);
assert.equal(capturedWrites[1].fullPath, path.join(repoRoot, 'maps', 'new-map.mini.webp'));
assert.equal(capturedWrites[1].sourcePath, preparedThumbnail.thumbnailPath);

fs.rmSync(repoRoot, { recursive: true, force: true });
console.log('map studio new-map checks passed');
