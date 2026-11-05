const assert = require('node:assert/strict');

const {
    applyMapSettings,
    buildFeatureSelectionKey,
    buildFlatManifestEntries,
    buildManifestTreeFromFlatEntries,
    createRepoFileBackedMapSource,
    detectLineCollectionKey,
    filterMapTree,
    findMapRecursive,
    normalizeDetailSections,
    normalizeManifestTree,
    normalizePoint,
    normalizeTags,
    createUnavailableMapEntry,
    resolveFileBackedMapDocument,
    resolveFeatureIndexFromSelection,
    serializeEditorState,
    serializeFlatManifestState,
    serializeManifestState,
    serializeMapDocumentState,
    stripStructureFieldsFromMapDocument
} = require('../js/editor-shared.js');

const manifest = [
    {
        id: 'folder-root',
        name: 'Root',
        type: 'folder',
        children: [
            {
                id: 'main-map',
                name: 'Main Map',
                category: 'Legacy Regions',
                imageUrl: 'maps/main.webp',
                width: 100,
                height: 100,
                scalePixels: 3,
                scaleKilometers: 1,
                blurb: 'Original blurb',
                pointsOfInterest: [
                    {
                        id: 'poi-1',
                        name: 'Old Dock',
                        coords: [10, 20],
                        type: 'Harbor',
                        summary: 'Original summary',
                        linkedMapId: 'harbor-map',
                        customFlag: true
                    }
                ],
                regions: [
                    {
                        id: 'region-1',
                        name: 'North Ward',
                        type: 'Political',
                        value: 'District',
                        coordinates: [[0, 0], [0, 10], [10, 10]],
                        linkedMapId: 'ward-map'
                    }
                ],
                roads: [
                    {
                        id: 'road-1',
                        name: 'Old Road',
                        type: 'main_road',
                        coordinates: [[1, 1], [2, 2]],
                        linkedMapId: 'road-map'
                    }
                ]
            }
        ]
    }
];

const clonedManifest = normalizeManifestTree(manifest);
assert.notEqual(clonedManifest, manifest);
assert.equal(findMapRecursive(clonedManifest, 'main-map').name, 'Main Map');

const filtered = filterMapTree(clonedManifest, 'main');
assert.equal(filtered.length, 1);
assert.equal(filtered[0].children.length, 1);
assert.equal(filtered[0].children[0].id, 'main-map');

const filteredByCategory = filterMapTree(clonedManifest, 'legacy regions');
assert.equal(filteredByCategory.length, 1);
assert.equal(filteredByCategory[0].children.length, 1);
assert.equal(filteredByCategory[0].children[0].id, 'main-map');

// Edge cases for filterMapTree
assert.equal(filterMapTree(null, 'query'), null);
assert.equal(filterMapTree(undefined, 'query'), undefined);
assert.equal(filterMapTree('string', 'query'), 'string');
assert.equal(filterMapTree(123, 'query'), 123);
assert.deepEqual(filterMapTree({ a: 1 }, 'query'), { a: 1 });

const normalizedPoint = normalizePoint({
    name: 'Round Trip',
    coords: ['11.7', '9.2'],
    linkedMapId: 'linked-map',
    detailSections: [
        { heading: 'At a glance', body: 'Busy harbor.' },
        { heading: '', body: '' },
        'invalid'
    ],
    tags: ['Harbor', 'trade', 'Harbor']
});
assert.deepEqual(normalizedPoint.coords, [12, 9]);
assert.equal(normalizedPoint.linkedMapId, 'linked-map');
assert.deepEqual(normalizedPoint.detailSections, [{ heading: 'At a glance', body: 'Busy harbor.' }]);
assert.deepEqual(normalizedPoint.tags, ['Harbor', 'trade']);
assert.deepEqual(normalizeDetailSections(null), []);
assert.deepEqual(normalizeTags(['  One  ', '', 'one', 'Two']), ['One', 'Two']);

assert.equal(detectLineCollectionKey(findMapRecursive(clonedManifest, 'main-map')), 'roads');
assert.equal(detectLineCollectionKey({ lines: [] }), 'lines');
assert.equal(detectLineCollectionKey({}), 'lines');

const serializedManifest = serializeEditorState({
    masterMapData: clonedManifest,
    currentMapId: 'main-map',
    collectedPoints: [
        {
            id: 'poi-1',
            name: 'Old Dock',
            coords: [10, 20],
            type: 'Harbor',
            summary: 'Updated summary',
            linkedMapId: 'harbor-map',
            detailSections: [{ heading: 'Dockside', body: 'Old pilings and fish markets.' }],
            tags: ['Harbor', 'Trade'],
            customFlag: true
        },
        {
            name: 'New Plaza',
            coords: [15, 30],
            type: 'Point of Interest',
            linkedMapId: 'plaza-map',
            properties: { mood: 'busy' },
            detailSections: [{ heading: 'Foot traffic', body: 'Crowded on market days.' }],
            tags: ['Market']
        }
    ],
    collectedRegions: [
        {
            id: 'region-1',
            name: 'North Ward',
            type: 'Political',
            value: 'District',
            coordinates: [[0, 0], [0, 10], [10, 10]],
            linkedMapId: 'ward-map'
        },
        {
            name: 'South Ward',
            type: 'Political',
            value: 'District',
            coordinates: [[10, 10], [20, 20], [10, 20]],
            linkedMapId: 'south-map'
        }
    ],
    collectedLines: [
        {
            id: 'road-1',
            name: 'Old Road',
            type: 'main_road',
            coordinates: [[1, 1], [2, 2]],
            linkedMapId: 'road-map'
        }
    ],
    mapSettings: {
        name: 'Main Map',
        group: 'Countries',
        scalePixels: 5,
        scaleKilometers: 2.5,
        blurb: 'Updated blurb'
    },
    lineCollectionKey: 'roads'
});

const serializedMap = findMapRecursive(serializedManifest, 'main-map');
assert.equal(serializedMap.scalePixels, 5);
assert.equal(serializedMap.scaleKilometers, 2.5);
assert.equal(serializedMap.blurb, 'Updated blurb');
assert.equal(serializedMap.group, 'Countries');
assert.equal(serializedMap.category, undefined);
assert.equal(serializedMap.pointsOfInterest.find((point) => point.name === 'Old Dock').customFlag, true);
assert.equal(serializedMap.pointsOfInterest.find((point) => point.name === 'Old Dock').linkedMapId, 'harbor-map');
assert.deepEqual(serializedMap.pointsOfInterest.find((point) => point.name === 'Old Dock').detailSections, [{ heading: 'Dockside', body: 'Old pilings and fish markets.' }]);
assert.deepEqual(serializedMap.pointsOfInterest.find((point) => point.name === 'Old Dock').tags, ['Harbor', 'Trade']);
assert.equal(serializedMap.pointsOfInterest.find((point) => point.name === 'New Plaza').linkedMapId, 'plaza-map');
assert.deepEqual(serializedMap.pointsOfInterest.find((point) => point.name === 'New Plaza').detailSections, [{ heading: 'Foot traffic', body: 'Crowded on market days.' }]);
assert.deepEqual(serializedMap.pointsOfInterest.find((point) => point.name === 'New Plaza').tags, ['Market']);
assert.equal(serializedMap.regions.find((region) => region.name === 'South Ward').linkedMapId, 'south-map');
assert.equal(serializedMap.roads.find((line) => line.id === 'road-1').linkedMapId, 'road-map');
assert.equal(serializedMap.lines, undefined);
assert.deepEqual(serializedMap.filterGroups, {
    Regions: {
        Political: ['District']
    }
});

const selectedMapOnly = serializeEditorState({
    masterMapData: clonedManifest,
    currentMapId: 'main-map',
    collectedPoints: [],
    collectedRegions: [],
    collectedLines: [],
    mapSettings: {},
    lineCollectionKey: 'lines',
    selectedMapOnly: true
});
assert.equal(selectedMapOnly.id, 'main-map');
assert.deepEqual(selectedMapOnly.lines, []);
assert.equal(selectedMapOnly.roads, undefined);

const slimManifest = [
    {
        id: 'main-map',
        name: 'Main Map',
        category: 'Legacy Regions',
        children: ['child-map']
    }
];

const updatedSlimManifest = serializeManifestState({
    masterMapData: slimManifest,
    currentMapId: 'main-map',
    mapSettings: {
        name: 'Updated Main Map',
        scalePixels: 9,
        scaleKilometers: 4,
        group: 'Geographic Regions',
        blurb: 'Slim manifest blurb',
        selectorDescription: 'Slim selector description'
    }
});
assert.equal(updatedSlimManifest[0].name, 'Updated Main Map');
assert.equal(updatedSlimManifest[0].scalePixels, 9);
assert.equal(updatedSlimManifest[0].scaleKilometers, 4);
assert.equal(updatedSlimManifest[0].group, 'Geographic Regions');
assert.equal(updatedSlimManifest[0].category, undefined);
assert.equal(updatedSlimManifest[0].blurb, 'Slim manifest blurb');
assert.equal(updatedSlimManifest[0].selectorDescription, 'Slim selector description');

const flattenedManifest = buildFlatManifestEntries([
    {
        id: 'root-folder',
        name: 'Root Folder',
        type: 'folder',
        summary: 'Folder summary',
        description: 'Folder description',
        selectorDescription: 'Folder selector description',
        category: 'Countries',
        children: [
            {
                id: 'child-map',
                name: 'Child Map',
                blurb: 'Child blurb',
                selectorDescription: 'Child selector description',
                group: 'Geographic Regions',
                dataUrl: 'maps/child-map.json'
            }
        ]
    }
]);
assert.deepEqual(flattenedManifest, [
    {
        id: 'root-folder',
        name: 'Root Folder',
        type: 'folder',
        summary: 'Folder summary',
        description: 'Folder description',
        selectorDescription: 'Folder selector description',
        category: 'Countries',
        order: 0
    },
    {
        id: 'child-map',
        name: 'Child Map',
        blurb: 'Child blurb',
        selectorDescription: 'Child selector description',
        group: 'Geographic Regions',
        dataUrl: 'maps/child-map.json',
        order: 0,
        parentId: 'root-folder'
    }
]);

const flatManifestExport = serializeFlatManifestState({
    masterMapData: [
        {
            id: 'root-folder',
            name: 'Root Folder',
            type: 'folder',
            children: [
                {
                    id: 'child-map',
                    name: 'Child Map',
                    dataUrl: 'maps/child-map.json'
                }
            ]
        }
    ],
    currentMapId: 'child-map',
    mapSettings: {
        name: 'Updated Child Map',
        dataUrl: 'maps/updated-child-map.json',
        width: 600
    }
});
assert.equal(flatManifestExport[1].name, 'Updated Child Map');
assert.equal(flatManifestExport[1].dataUrl, 'maps/updated-child-map.json');
assert.equal(flatManifestExport[1].width, undefined);

const strippedMapDocument = stripStructureFieldsFromMapDocument({
    id: 'current-map',
    name: 'Current Map',
    dataUrl: 'maps/current-map.json',
    parentId: 'root-folder',
    order: 1,
    children: [{ id: 'nested-child' }],
    pointsOfInterest: []
});
assert.equal(strippedMapDocument.dataUrl, undefined);
assert.equal(strippedMapDocument.parentId, undefined);
assert.equal(strippedMapDocument.order, undefined);
assert.equal(strippedMapDocument.children, undefined);

const serializedMapDocument = serializeMapDocumentState({
    masterMapData: clonedManifest,
    currentMapId: 'main-map',
    collectedPoints: [],
    collectedRegions: [],
    collectedLines: [],
    mapSettings: {
        name: 'Serialized Main Map',
        width: 640,
        imageUrl: 'maps/serialized-main-map.webp',
        selectorDescription: 'Serialized selector description'
    },
    lineCollectionKey: 'roads'
});
assert.equal(serializedMapDocument.name, 'Serialized Main Map');
assert.equal(serializedMapDocument.width, 640);
assert.equal(serializedMapDocument.imageUrl, 'maps/serialized-main-map.webp');
assert.equal(serializedMapDocument.selectorDescription, 'Serialized selector description');
assert.equal(serializedMapDocument.dataUrl, undefined);

const mapSettingsTarget = {};
mapSettingsTarget.category = 'Legacy Regions';
applyMapSettings(mapSettingsTarget, {
    name: 'Settings Map',
    type: 'folder',
    status: 'draft',
    visibility: 'private',
    group: 'Countries',
    imageUrl: 'maps/settings-map.webp',
    mobileImageUrl: 'maps/settings-map-mobile.webp',
    smallImageUrl: 'maps/settings-map-small.webp',
    width: '800',
    height: '600',
    scalePixels: '3',
    scaleKilometers: '1.5',
    scaleUnitName: 'miles',
    backgroundColor: '#111827',
    atmosphere: 'night',
    dataUrl: 'maps/settings-map.json',
    selectorDescription: 'Settings selector description',
    latLonBounds: {
        north: '10.5',
        south: '1.5',
        east: '20',
        west: '-5'
    }
});
assert.equal(mapSettingsTarget.name, 'Settings Map');
assert.equal(mapSettingsTarget.type, 'folder');
assert.equal(mapSettingsTarget.group, 'Countries');
assert.equal(mapSettingsTarget.category, undefined);
assert.equal(mapSettingsTarget.mobileImageUrl, 'maps/settings-map-mobile.webp');
assert.equal(mapSettingsTarget.width, 800);
assert.equal(mapSettingsTarget.scaleKilometers, 1.5);
assert.equal(mapSettingsTarget.selectorDescription, 'Settings selector description');
assert.deepEqual(mapSettingsTarget.latLonBounds, {
    north: 10.5,
    south: 1.5,
    east: 20,
    west: -5
});

const partialLatLonBoundsTarget = {
    latLonBounds: {
        north: 1,
        south: 0
    }
};
applyMapSettings(partialLatLonBoundsTarget, {
    latLonBounds: {
        north: ' 42 ',
        south: '',
        east: 'not-a-number',
        west: '0'
    }
});
assert.deepEqual(partialLatLonBoundsTarget.latLonBounds, {
    north: 42,
    west: 0
});

const emptyLatLonBoundsTarget = {
    latLonBounds: {
        north: 1
    }
};
applyMapSettings(emptyLatLonBoundsTarget, {
    latLonBounds: {
        north: '',
        south: 'not-a-number',
        east: null
    }
});
assert.equal(emptyLatLonBoundsTarget.latLonBounds, undefined);

const ignoredLatLonBoundsTarget = {
    latLonBounds: {
        north: 1
    }
};
applyMapSettings(ignoredLatLonBoundsTarget, {
    latLonBounds: null
});
assert.deepEqual(ignoredLatLonBoundsTarget.latLonBounds, {
    north: 1
});

// applyMapSettings edge cases
assert.equal(applyMapSettings(null), null);
assert.equal(applyMapSettings(undefined), undefined);
assert.equal(applyMapSettings('string'), 'string');
assert.equal(applyMapSettings(123), 123);

const unchangedNestedStringManifest = serializeManifestState({
    masterMapData: slimManifest,
    currentMapId: 'child-map',
    mapSettings: {
        name: 'Child Override'
    }
});
assert.deepEqual(unchangedNestedStringManifest, slimManifest);

const entryWithBoth = createUnavailableMapEntry('test-id', 'Test error message');
assert.equal(entryWithBoth.id, 'test-id');
assert.equal(entryWithBoth.name, '(Unavailable: test-id)');
assert.equal(entryWithBoth.status, 'coming-soon');
assert.equal(entryWithBoth.error, 'Test error message');
assert.equal(entryWithBoth.unselectable, true);

const entryWithIdOnly = createUnavailableMapEntry('only-id');
assert.equal(entryWithIdOnly.id, 'only-id');
assert.equal(entryWithIdOnly.name, '(Unavailable: only-id)');
assert.equal(entryWithIdOnly.error, 'Failed to load map data.');

const entryWithEmptyId = createUnavailableMapEntry('');
assert.equal(entryWithEmptyId.id, '');
assert.equal(entryWithEmptyId.name, '(Unavailable: Unknown ID)');
assert.equal(entryWithEmptyId.error, 'Failed to load map data.');

const entryWithNullId = createUnavailableMapEntry(null);
assert.equal(entryWithNullId.id, '');
assert.equal(entryWithNullId.name, '(Unavailable: Unknown ID)');

const entryWithEmptyError = createUnavailableMapEntry('test-id', '');
assert.equal(entryWithEmptyError.error, 'Failed to load map data.');

const pointSelection = buildFeatureSelectionKey('points', { name: 'Old Dock' });
assert.equal(
    resolveFeatureIndexFromSelection(
        'points',
        [{ name: 'Old Dock' }, { name: 'New Plaza' }],
        pointSelection
    ),
    0
);

const lineSelection = buildFeatureSelectionKey('lines', { id: 'road-1', name: 'Old Road' });
assert.equal(
    resolveFeatureIndexFromSelection(
        'lines',
        [{ id: 'road-1', name: 'Old Road' }, { id: 'road-2', name: 'North Track' }],
        lineSelection
    ),
    0
);

(async () => {
    let inlineLoadCount = 0;
    const inlineResolved = await resolveFileBackedMapDocument(
        {
            id: 'inline-map',
            name: 'Inline Map',
            imageUrl: 'maps/inline-map.webp',
            pointsOfInterest: [{ name: 'Dock', coords: [1, 2], type: 'Harbor' }]
        },
        {
            loadJsonByPath: async () => {
                inlineLoadCount += 1;
                return {};
            }
        }
    );
    assert.equal(inlineResolved.pointsOfInterest.length, 1);
    assert.equal(inlineLoadCount, 0);

    let blurbLoadCount = 0;
    const blurbResolved = await resolveFileBackedMapDocument(
        {
            id: 'blurb-map',
            name: 'Blurb Map',
            imageUrl: 'maps/blurb-map.webp',
            blurb: 'Short chooser copy'
        },
        {
            loadJsonByPath: async () => {
                blurbLoadCount += 1;
                return {
                    id: 'blurb-map',
                    pointsOfInterest: [{ name: 'Gate', coords: [9, 10], type: 'City' }]
                };
            }
        }
    );
    assert.equal(blurbResolved.pointsOfInterest[0].name, 'Gate');
    assert.equal(blurbLoadCount, 1);

    let selectorLoadCount = 0;
    const selectorResolved = await resolveFileBackedMapDocument(
        {
            id: 'selector-map',
            name: 'Selector Map',
            imageUrl: 'maps/selector-map.webp',
            selectorDescription: 'Selector copy only'
        },
        {
            loadJsonByPath: async () => {
                selectorLoadCount += 1;
                return {
                    id: 'selector-map',
                    pointsOfInterest: [{ name: 'Plaza', coords: [7, 8], type: 'City' }]
                };
            }
        }
    );
    assert.equal(selectorResolved.pointsOfInterest[0].name, 'Plaza');
    assert.equal(selectorResolved.selectorDescription, 'Selector copy only');
    assert.equal(selectorLoadCount, 1);

    const dataUrlResolved = await resolveFileBackedMapDocument(
        {
            id: 'data-url-map',
            name: 'Data URL Map',
            imageUrl: 'maps/data-url-map.webp',
            dataUrl: 'maps/custom-map.json'
        },
        {
            loadJsonByPath: async (path) => {
                assert.equal(path, 'maps/custom-map.json');
                return {
                    id: 'data-url-map',
                    pointsOfInterest: [{ name: 'Gate', coords: [3, 4], type: 'City' }]
                };
            }
        }
    );
    assert.equal(dataUrlResolved.pointsOfInterest[0].name, 'Gate');

    let releaseExplicitDataUrl;
    const explicitDataUrlGate = new Promise((resolve) => {
        releaseExplicitDataUrl = resolve;
    });
    const precedenceRequests = [];
    const precedenceResolution = resolveFileBackedMapDocument(
        {
            id: 'precedence-map',
            name: 'Precedence Map',
            imageUrl: 'maps/precedence-map.webp',
            dataUrl: 'maps/custom-precedence-map.json'
        },
        {
            loadJsonByPath: async (path) => {
                precedenceRequests.push(path);
                if (path === 'maps/custom-precedence-map.json') {
                    await explicitDataUrlGate;
                    return {
                        id: 'precedence-map',
                        pointsOfInterest: [{ name: 'Explicit Gate', coords: [11, 12], type: 'City' }]
                    };
                }
                return {
                    id: 'precedence-map',
                    pointsOfInterest: [{ name: 'Default Gate', coords: [13, 14], type: 'City' }]
                };
            }
        }
    );
    assert.deepEqual(precedenceRequests, [
        'maps/custom-precedence-map.json',
        'maps/precedence-map.json'
    ]);
    releaseExplicitDataUrl();
    const precedenceResolved = await precedenceResolution;
    assert.equal(precedenceResolved.pointsOfInterest[0].name, 'Explicit Gate');

    const fallbackResolved = await resolveFileBackedMapDocument(
        {
            id: 'fallback-map',
            name: 'Fallback Map',
            imageUrl: 'maps/fallback-map.webp'
        },
        {
            loadJsonByPath: async (path) => {
                assert.equal(path, 'maps/fallback-map.json');
                return {
                    id: 'fallback-map',
                    pointsOfInterest: [{ name: 'Harbor', coords: [5, 6], type: 'Harbor' }]
                };
            }
        }
    );
    assert.equal(fallbackResolved.pointsOfInterest[0].name, 'Harbor');

    await assert.rejects(
        () => resolveFileBackedMapDocument(
            {
                id: 'missing-map',
                name: 'Missing Map',
                imageUrl: 'maps/missing-map.webp'
            },
            {
                loadJsonByPath: async (path) => {
                    throw new Error(`Not found: ${path}`);
                }
            }
        ),
        /Could not resolve full map JSON for "missing-map": tried maps\/missing-map\.json/
    );

    const rootSelectionSource = await createRepoFileBackedMapSource([
        {
            path: 'repo/maps/maps.json',
            text: JSON.stringify([
                {
                    id: 'root-map',
                    order: 0,
                    dataUrl: 'maps/root-map.json'
                }
            ])
        },
        {
            path: 'repo/maps/atlas-index.json',
            text: JSON.stringify({
                tree: [
                    {
                        id: 'root-map',
                        name: 'Root Map',
                        imageUrl: 'maps/root-map.webp',
                        dataUrl: 'maps/root-map.json'
                    }
                ]
            })
        },
        {
            path: 'repo/maps/root-map.json',
            text: JSON.stringify({
                id: 'root-map',
                name: 'Root Map',
                imageUrl: 'maps/root-map.webp',
                pointsOfInterest: [{ name: 'Root Harbor', coords: [1, 1], type: 'Harbor' }]
            })
        },
        {
            path: 'repo/maps/root-map.webp',
            text: 'unused'
        }
    ]);
    assert.equal(rootSelectionSource.baseManifest[0].id, 'root-map');
    assert.equal(rootSelectionSource.browseTree[0].id, 'root-map');
    assert.equal((await rootSelectionSource.resolveMapDocument(rootSelectionSource.browseTree[0])).pointsOfInterest[0].name, 'Root Harbor');

    const mapsFolderSource = await createRepoFileBackedMapSource([
        {
            path: 'maps/maps.json',
            text: JSON.stringify([
                {
                    id: 'folder-map',
                    order: 0,
                    dataUrl: 'maps/folder-map.json'
                },
                {
                    id: 'child-map',
                    parentId: 'folder-map',
                    order: 0,
                    dataUrl: 'maps/child-map.json'
                }
            ])
        },
        {
            path: 'maps/folder-map.json',
            text: JSON.stringify({
                id: 'folder-map',
                name: 'Folder Map',
                imageUrl: 'maps/folder-map.webp',
                children: ['child-map']
            })
        },
        {
            path: 'maps/child-map.json',
            text: JSON.stringify({
                id: 'child-map',
                name: 'Child Map',
                imageUrl: 'maps/child-map.webp',
                pointsOfInterest: [{ name: 'Child Harbor', coords: [9, 9], type: 'Harbor' }]
            })
        },
        {
            path: 'maps/folder-map.webp',
            text: 'unused'
        },
        {
            path: 'maps/child-map.webp',
            text: 'unused'
        }
    ]);
    const hydratedChild = findMapRecursive(mapsFolderSource.browseTree, 'child-map');
    assert.ok(hydratedChild);
    assert.equal(hydratedChild.dataUrl, 'maps/child-map.json');
    assert.equal((await mapsFolderSource.resolveMapDocument(hydratedChild)).pointsOfInterest[0].name, 'Child Harbor');

    await assert.rejects(
        () => mapsFolderSource.resolveMapDocument({
            id: 'missing-child',
            name: 'Missing Child',
            imageUrl: 'maps/missing-child.webp'
        }),
        /Missing required file: maps\/missing-child\.json/
    );

    assert.throws(
        () => mapsFolderSource.resolveImageEntry({
            id: 'missing-child',
            imageUrl: 'maps/missing-child.webp'
        }),
        /Missing required file: maps\/missing-child\.webp/
    );

    assert.throws(
        () => mapsFolderSource.resolveImageEntry({
            id: 'missing-image-url'
        }),
        /Map "missing-image-url" is missing an imageUrl\./
    );

    const repoReadCounts = new Map();
    const cachedJsonSource = await createRepoFileBackedMapSource([
        {
            path: 'maps/maps.json',
            text: JSON.stringify([
                {
                    id: 'cached-map',
                    order: 0,
                    dataUrl: 'maps/cached-map.json'
                }
            ])
        },
        {
            path: 'maps/atlas-index.json',
            text: JSON.stringify({
                tree: [
                    {
                        id: 'cached-map',
                        name: 'Cached Map',
                        imageUrl: 'maps/cached-map.webp',
                        dataUrl: 'maps/cached-map.json'
                    }
                ]
            })
        },
        {
            path: 'maps/cached-map.json',
            text: JSON.stringify({
                id: 'cached-map',
                name: 'Cached Map',
                imageUrl: 'maps/cached-map.webp'
            })
        },
        {
            path: 'maps/cached-map.webp',
            text: 'unused'
        }
    ], {
        readText: async (entry) => {
            repoReadCounts.set(entry.path, (repoReadCounts.get(entry.path) || 0) + 1);
            return entry.text;
        }
    });
    const firstCachedMap = await cachedJsonSource.loadJsonByPath('maps/cached-map.json');
    firstCachedMap.name = 'Mutated Map';
    const secondCachedMap = await cachedJsonSource.loadJsonByPath('./maps/cached-map.json');
    assert.equal(secondCachedMap.name, 'Cached Map');
    assert.equal(repoReadCounts.get('maps/cached-map.json'), 1);

    assert.deepEqual(buildManifestTreeFromFlatEntries(null), []);
    assert.deepEqual(buildManifestTreeFromFlatEntries(undefined), []);
    assert.deepEqual(buildManifestTreeFromFlatEntries({}), []);
    assert.deepEqual(buildManifestTreeFromFlatEntries('not an array'), []);
    assert.deepEqual(buildManifestTreeFromFlatEntries(123), []);

    console.log('editor shared helper regression checks passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
