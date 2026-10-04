const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { generateAtlasIndex } = require('../scripts/generate_atlas_index.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-gen-'));
const mapsDir = path.join(tmpRoot, 'maps');
const generatedDir = path.join(mapsDir, 'generated');

fs.mkdirSync(generatedDir, { recursive: true });

fs.writeFileSync(path.join(mapsDir, 'maps.json'), `${JSON.stringify([
    {
        id: 'folder-root',
        name: 'Root',
        type: 'folder',
        order: 0
    },
    {
        id: 'file-backed-map',
        parentId: 'folder-root',
        order: 0,
        dataUrl: 'maps/file-backed-map.json',
        group: 'Countries',
        name: 'File Backed'
    },
    {
        id: 'inline-map',
        parentId: 'folder-root',
        order: 1,
        name: 'Inline Map',
        category: 'Geographic Regions',
        width: 100,
        height: 100,
        imageUrl: 'maps/inline-map.webp',
        pointsOfInterest: [
            {
                name: 'Inline POI',
                coords: [1, 2],
                type: 'Point of Interest'
            }
        ]
    },
    {
        id: 'large-file-backed-map',
        parentId: 'folder-root',
        order: 2,
        dataUrl: 'maps/large-file-backed-map.json',
        name: 'Large File Backed'
    }
], null, 2)}\n`);

fs.writeFileSync(path.join(mapsDir, 'file-backed-map.json'), `${JSON.stringify({
    id: 'file-backed-map',
    name: 'File Backed Source',
    width: 100,
    height: 100,
    imageUrl: 'maps/file-backed-map.webp',
    tileSource: {
        type: 'xyz',
        urlTemplate: 'tile/file-backed-map/{z}/{x}/{y}.webp',
        tileSize: 256,
        minZoom: 0,
        maxZoom: 1,
        leafletNativeZoom: 0,
        zoomOffset: 1
    },
    updatedAt: '2026-07-09T12:00:00.000Z',
    lines: [
        { id: 'river', name: 'River', type: 'River', coordinates: [[0, 0], [50, 50]] },
        { id: 'road-a', streetId: 'main', name: 'Main Street', travelMode: 'road', coordinates: [[10, 0], [10, 50]] },
        { id: 'road-b', streetId: 'main', name: 'Main Street', travelMode: 'road', coordinates: [[10, 50], [10, 100]] }
    ],
    regions: [
        { name: 'Harbor', points: [[0, 0], [0, 10], [10, 10]] },
        { name: 'Old Town', points: [[10, 10], [10, 20], [20, 20]] }
    ],
    pointsOfInterest: [
        {
            name: 'File POI',
            coords: [10, 20],
            type: 'Landmark',
            properties: {
                Faction: 'Harbor Guild',
                Nested: { ignored: true }
            },
            detailSections: [
                {
                    heading: 'Secret toll',
                    body: 'Collectors watch the lower quay.'
                }
            ],
            tags: ['Trade', 'Smuggling']
        }
    ]
}, null, 2)}\n`);

fs.writeFileSync(path.join(mapsDir, 'unreferenced-map.json'), `${JSON.stringify({
    id: 'unreferenced-map',
    name: 'Ignored Map',
    width: 50,
    height: 50,
    imageUrl: 'maps/unreferenced-map.webp',
    pointsOfInterest: [
        {
            name: 'Should Not Appear',
            coords: [0, 0],
            type: 'Point of Interest'
        }
    ]
}, null, 2)}\n`);

fs.writeFileSync(path.join(mapsDir, 'large-file-backed-map.webp'), '');
fs.writeFileSync(path.join(mapsDir, 'large-file-backed-map.json'), `${JSON.stringify({
    id: 'large-file-backed-map',
    name: 'Large File Backed Source',
    width: 4096,
    height: 2048,
    imageUrl: 'maps/large-file-backed-map.webp',
    pointsOfInterest: []
}, null, 2)}\n`);

const result = generateAtlasIndex({ repoRoot: tmpRoot });
const atlas = result.atlasIndex;
const atlasIndexPath = path.join(mapsDir, 'atlas-index.json');

const folder = atlas.tree.find((item) => item.id === 'folder-root');
assert.ok(folder);

const fileBacked = folder.children.find((item) => item.id === 'file-backed-map');
assert.ok(fileBacked);
assert.equal(fileBacked.dataUrl, 'maps/file-backed-map.json');
assert.equal(fileBacked.group, 'Countries');
assert.equal(fileBacked.regionCount, 2);
assert.equal(fileBacked.updatedAt, '2026-07-09T12:00:00.000Z');
assert.deepEqual(fileBacked.tileSource, {
    type: 'xyz',
    urlTemplate: 'tile/file-backed-map/{z}/{x}/{y}.webp',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 1,
    leafletNativeZoom: 0,
    zoomOffset: 1
});

const inlineMap = folder.children.find((item) => item.id === 'inline-map');
assert.ok(inlineMap);
assert.equal(inlineMap.dataUrl, 'maps/generated/inline-map.json');
assert.equal(inlineMap.category, 'Geographic Regions');
assert.equal(inlineMap.regionCount, 0);
assert.ok(fs.existsSync(path.join(mapsDir, 'generated', 'inline-map.json')));

const largeFileBacked = folder.children.find((item) => item.id === 'large-file-backed-map');
assert.ok(largeFileBacked);
assert.equal(largeFileBacked.dataUrl, 'maps/large-file-backed-map.json');
assert.deepEqual(largeFileBacked.tileSource, {
    type: 'xyz',
    urlTemplate: 'tile/large-file-backed-map/{z}/{x}/{y}.webp',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 4,
    leafletNativeZoom: 0,
    zoomOffset: 4
});

const filePoi = atlas.searchIndex.find((entry) => entry.kind === 'poi' && entry.mapId === 'file-backed-map');
assert.ok(filePoi);
assert.equal(filePoi.name, 'File POI');
assert.match(filePoi.searchText, /Secret toll/);
assert.match(filePoi.searchText, /Collectors watch the lower quay/);
assert.match(filePoi.searchText, /Trade Smuggling/);
assert.match(filePoi.searchText, /Faction Harbor Guild/);
assert.equal(filePoi.detailSections, undefined);
assert.equal(filePoi.tags, undefined);
assert.equal(filePoi.properties, undefined);
assert.deepEqual(atlas.searchIndex.filter(entry => entry.mapId === 'file-backed-map' && entry.kind === 'line').map(entry => entry.name), ['River'],
    'ordinary atlas search must not repeat internal route fragments with no focusable feature layer');

const ignored = atlas.searchIndex.find((entry) => entry.mapId === 'unreferenced-map');
assert.equal(ignored, undefined);

const stableAtlas = {
    ...JSON.parse(fs.readFileSync(atlasIndexPath, 'utf8')),
    generatedAt: 'stable-test-generated-at'
};
fs.writeFileSync(atlasIndexPath, `${JSON.stringify(stableAtlas, null, 2)}\n`);
generateAtlasIndex({ repoRoot: tmpRoot });
assert.equal(
    fs.readFileSync(atlasIndexPath, 'utf8'),
    `${JSON.stringify(stableAtlas, null, 2)}\n`,
    'unchanged atlas content should not create generatedAt-only churn'
);

console.log('generate_atlas_index file-backed fixture checks passed');
