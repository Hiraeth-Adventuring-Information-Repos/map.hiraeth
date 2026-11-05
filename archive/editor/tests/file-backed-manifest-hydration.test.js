const assert = require('node:assert/strict');

const {
    collectMapSelectionEntries,
    findMapRecursive,
    hydrateFileBackedManifestTree
} = require('../js/editor-shared.js');

(async () => {
    const rawManifest = [
        {
            id: 'main-continent',
            name: 'Content Map',
            imageUrl: 'maps/content.webp',
            width: 8192,
            height: 6144,
            children: ['IceBeach', 'BrokenMap']
        },
        {
            id: 'reference-folder',
            name: 'References',
            type: 'folder',
            children: ['IceBeach']
        }
    ];

    const fileBackedMaps = {
        IceBeach: {
            id: 'IceBeach',
            name: 'IceBeach',
            blurb: 'IceBeach blurb',
            selectorDescription: 'IceBeach selector description',
            summary: 'IceBeach summary',
            description: 'IceBeach description',
            imageUrl: 'maps/IceBeach.webp',
            width: 1000,
            height: 1000,
            children: ['castgate']
        },
        castgate: {
            id: 'castgate',
            name: 'Castgate',
            imageUrl: 'maps/castgate.webp',
            width: 500,
            height: 500,
            pointsOfInterest: [
                { name: 'Harbor', coords: [1, 2], type: 'Point of Interest' }
            ]
        }
    };

    const loadCounts = new Map();
    const hydrated = await hydrateFileBackedManifestTree(
        rawManifest,
        async (mapId) => {
            loadCounts.set(mapId, (loadCounts.get(mapId) || 0) + 1);
            if (!Object.prototype.hasOwnProperty.call(fileBackedMaps, mapId)) {
                throw new Error(`Missing fixture for ${mapId}`);
            }
            return fileBackedMaps[mapId];
        },
        {
            resolveDataUrl: (mapId) => `maps/${mapId}.json`
        }
    );

    const mainContinent = findMapRecursive(hydrated, 'main-continent');
    assert.ok(mainContinent);
    assert.equal(mainContinent.dataUrl, 'maps/main-continent.json');

    const iceBeach = findMapRecursive(hydrated, 'IceBeach');
    assert.ok(iceBeach);
    assert.equal(iceBeach.dataUrl, 'maps/IceBeach.json');
    assert.equal(iceBeach.blurb, 'IceBeach blurb');
    assert.equal(iceBeach.selectorDescription, 'IceBeach selector description');
    assert.equal(iceBeach.summary, 'IceBeach summary');
    assert.equal(iceBeach.description, 'IceBeach description');

    const castgate = findMapRecursive(hydrated, 'castgate');
    assert.ok(castgate);
    assert.equal(castgate.dataUrl, 'maps/castgate.json');
    assert.equal(castgate.pointsOfInterest.length, 1);

    const brokenMap = findMapRecursive(hydrated, 'BrokenMap');
    assert.ok(brokenMap);
    assert.equal(brokenMap.status, 'coming-soon');
    assert.match(brokenMap.error, /Missing fixture for BrokenMap/);

    const selections = collectMapSelectionEntries(hydrated);
    const selectionIds = selections.map((entry) => entry.id);
    assert.deepEqual(selectionIds, ['main-continent', 'IceBeach', 'castgate', 'BrokenMap']);
    assert.equal(selections.find((entry) => entry.id === 'BrokenMap').disabled, true);

    assert.equal(loadCounts.get('IceBeach'), 1);
    assert.equal(loadCounts.get('castgate'), 1);
    assert.equal(loadCounts.get('BrokenMap'), 1);

    const hydrationFailureTree = await hydrateFileBackedManifestTree(
        ['BadDataUrl'],
        async () => ({
            id: 'BadDataUrl',
            name: 'Bad Data URL',
            imageUrl: 'maps/bad-data-url.webp'
        }),
        {
            resolveDataUrl: () => {
                throw new Error('Could not resolve data URL');
            }
        }
    );
    const hydrationFailureMap = findMapRecursive(hydrationFailureTree, 'BadDataUrl');
    assert.ok(hydrationFailureMap);
    assert.equal(hydrationFailureMap.status, 'coming-soon');
    assert.match(hydrationFailureMap.error, /Could not resolve data URL/);

    console.log('file-backed manifest hydration regression checks passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
