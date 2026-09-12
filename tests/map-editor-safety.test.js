const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('js/map-editor.js', 'utf8');
const pendingTests = [];

function extractFunction(name) {
    const syncStart = source.indexOf(`    function ${name}(`);
    const asyncStart = source.indexOf(`    async function ${name}(`);
    const start = syncStart === -1 ? asyncStart : syncStart;
    assert.notEqual(start, -1, `Could not locate ${name}`);
    const bodyStart = source.indexOf(') {', start) + 2;
    assert.ok(bodyStart > 1, `Could not locate ${name} body`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

{
    const document = new JSDOM(`
        <a id="live" href="/preview/">Live</a>
        <a id="export" href="/preview/">Export</a>
        <span id="command"></span>
        <span id="readiness"></span>
    `).window.document;
    const state = {
        editorDirty: true,
        publishReadiness: { previewUrl: '/preview/', items: {}, topStatus: '' }
    };
    const dom = {
        livePreviewLink: document.querySelector('#live'),
        exportOpenPreviewLink: document.querySelector('#export'),
        exportPreviewCommandStatus: document.querySelector('#command'),
        exportReadiness: document.querySelector('#readiness')
    };
    const factory = new Function('dependencies', `
        const { state, dom, getPublishTopStatus, getPublishSummary, renderBuildProgress, refreshBuildPreviewButtonState, hasUnsavedEditorWork, hasUnfinishedGeometryDraft } = dependencies;
        ${extractFunction('renderPublishReadiness')}
        return renderPublishReadiness;
    `);
    factory({
        state,
        dom,
        getPublishTopStatus: () => 'Needs Save',
        getPublishSummary: () => 'Save first.',
        renderBuildProgress: () => {},
        refreshBuildPreviewButtonState: () => {},
        hasUnsavedEditorWork: () => state.editorDirty,
        hasUnfinishedGeometryDraft: () => false
    })();

    assert.equal(dom.livePreviewLink.hidden, true);
    assert.equal(dom.livePreviewLink.getAttribute('aria-disabled'), 'true');
    assert.equal(dom.livePreviewLink.tabIndex, -1);
    assert.equal(dom.exportOpenPreviewLink.hidden, true);
    assert.equal(dom.exportOpenPreviewLink.getAttribute('aria-disabled'), 'true');
    assert.equal(dom.exportOpenPreviewLink.tabIndex, -1);
}

{
    const state = {
        editorDirty: false,
        publishReadiness: { previewUrl: '/preview/', items: {} }
    };
    const factory = new Function('dependencies', `
        const { state, setReadinessItem, renderPublishReadiness, hasUnsavedEditorWork } = dependencies;
        ${extractFunction('applyServerReadiness')}
        return applyServerReadiness;
    `);
    const applyServerReadiness = factory({
        state,
        setReadinessItem: () => {},
        renderPublishReadiness: () => {},
        hasUnsavedEditorWork: () => state.editorDirty
    });
    applyServerReadiness({ pagesBundle: { built: true, stale: true, fileCount: 3 } });
    assert.equal(state.publishReadiness.previewUrl, '');
}

{
    const factory = new Function('dependencies', `
        const { getCurrentPoints, getCurrentRegions, getCurrentLines } = dependencies;
        ${extractFunction('getIncompleteFeature')}
        return getIncompleteFeature;
    `);
    const getIncompleteFeature = factory({
        getCurrentPoints: () => [{ name: 'Named point' }],
        getCurrentRegions: () => [{ name: 'Region 2' }],
        getCurrentLines: () => [{ name: 'Trade road' }]
    });
    assert.deepEqual(getIncompleteFeature().mode, 'regions');
}

{
    const state = {
        accessChecked: true,
        localSaveAvailable: true,
        reviewOnlyRequested: false,
        saveInProgress: true
    };
    const factory = new Function('state', `
        ${extractFunction('hasWritableAccess')}
        ${extractFunction('canMutateWorkspace')}
        return { hasWritableAccess, canMutateWorkspace };
    `);
    const access = factory(state);
    assert.equal(access.hasWritableAccess(), true);
    assert.equal(access.canMutateWorkspace(), false);
}

{
    const state = {
        editorDirty: false,
        drawMode: 'region',
        draftCoordinates: [[10, 20]]
    };
    const factory = new Function('state', `
        ${extractFunction('hasUnfinishedGeometryDraft')}
        ${extractFunction('hasUnsavedEditorWork')}
        return { hasUnfinishedGeometryDraft, hasUnsavedEditorWork };
    `);
    const unsaved = factory(state);
    assert.equal(unsaved.hasUnfinishedGeometryDraft(), true);
    assert.equal(unsaved.hasUnsavedEditorWork(), true);
    state.draftCoordinates = [];
    assert.equal(unsaved.hasUnfinishedGeometryDraft(), false);
    assert.equal(unsaved.hasUnsavedEditorWork(), false);
}

{
    const document = new JSDOM('<form><input data-field="coordY" value="1"><input data-field="coordX" value="2"></form>').window.document;
    const dom = { featureForm: document.querySelector('form') };
    const factory = new Function('dependencies', `
        const {
            dom, fieldApi, roundCoordinate, parseKeyFacts, parseTags, getDetailSectionsFromForm,
            parseJsonObject, stringifyKeyFacts, parseCoordinatePairs
        } = dependencies;
        ${extractFunction('applyFeatureFieldValue')}
        return applyFeatureFieldValue;
    `);
    const applyFeatureFieldValue = factory({
        dom,
        fieldApi: {
            validateValue: (definition, value) => definition.required && !String(value).trim() ? 'Name is required.' : ''
        },
        roundCoordinate: Number,
        parseKeyFacts: () => ({}),
        parseTags: () => [],
        getDetailSectionsFromForm: () => [],
        parseJsonObject: (value) => JSON.parse(value),
        stringifyKeyFacts: () => '',
        parseCoordinatePairs: (value) => JSON.parse(value)
    });
    assert.throws(
        () => applyFeatureFieldValue({}, 'points', { key: 'name', required: true }, { value: '' }),
        /Name is required/
    );
    assert.throws(
        () => applyFeatureFieldValue({}, 'points', { key: 'properties', update: 'json' }, { value: '{' }),
        /JSON/
    );
    const curve = { coordinates: [[0, 0], [1, 1]], bezier: { version: 1 } };
    const coordinatesField = { key: 'coordinates', update: 'coordinates' };
    applyFeatureFieldValue(curve, 'lines', coordinatesField, { value: '[[0,0],[1,1]]' });
    assert.ok(curve.bezier, 'flushing unchanged coordinates preserves the handles');
    applyFeatureFieldValue(curve, 'lines', coordinatesField, { value: '[[0,0],[2,2]]' });
    assert.equal(curve.bezier, undefined, 'manual geometry replaces stale handles');
}

{
    const state = {
        recoveryWorkspaceId: 'studio:branch-a',
        currentMapId: 'map-a',
        savedWorkspaceFingerprint: 'dirty-fingerprint-a',
        recoveryBaselineHash: 'canonical-baseline-a',
        recoveryBaselineLength: 321
    };
    const factory = new Function('dependencies', `
        const { state } = dependencies;
        const RECOVERY_VERSION = 2;
        const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
        ${extractFunction('hashRecoveryValue')}
        ${extractFunction('isRecoverySnapshotValid')}
        return { hashRecoveryValue, isRecoverySnapshotValid };
    `);
    const recovery = factory({ state });
    const snapshot = {
        version: 2,
        savedAt: Date.now(),
        workspaceId: 'studio:branch-a',
        currentMapId: 'map-a',
        baselineHash: 'canonical-baseline-a',
        baselineLength: 321,
        atlasStructure: [],
        currentMap: { id: 'map-a' }
    };
    assert.equal(recovery.isRecoverySnapshotValid(snapshot), true);
    assert.equal(recovery.isRecoverySnapshotValid({ ...snapshot, workspaceId: 'studio:branch-b' }), false);
    assert.equal(recovery.isRecoverySnapshotValid({ ...snapshot, baselineHash: 'wrong' }), false);
    assert.equal(recovery.isRecoverySnapshotValid({ ...snapshot, baselineLength: 999 }), false);
    assert.equal(recovery.isRecoverySnapshotValid({ ...snapshot, savedAt: Date.now() + 1000 }), false);
    assert.equal(recovery.isRecoverySnapshotValid({
        ...snapshot,
        editorDirty: false,
        drawMode: 'region',
        draftCoordinates: [[12, 34]]
    }), true);
    assert.equal(recovery.isRecoverySnapshotValid({
        ...snapshot,
        editorDirty: false,
        drawMode: 'region',
        draftCoordinates: [['not-a-number', 34]]
    }), false);
}

{
    const state = {
        currentMap: { id: 'map-a', name: 'Map A' },
        currentMapId: 'map-a',
        currentMapDataUrl: 'maps/map-a.json',
        lineCollectionKey: 'lines',
        editorDirty: false,
        drawMode: 'line',
        draftCoordinates: [[1, 2], [3, 4]],
        savedWorkspaceFingerprint: 'saved',
        recoveryBaselineHash: 'baseline',
        recoveryBaselineLength: 8,
        recoveryWorkspaceId: 'studio:branch-a',
        libraryReturnMode: 'hub',
        selectedFeature: null,
        featureListState: { type: 'lines' },
        atlasTree: [{ id: 'map-a', name: 'Map A' }]
    };
    const document = new JSDOM('<main id="app" data-mode="draw"></main><form id="map"></form><form id="feature"></form>').window.document;
    const factory = new Function('dependencies', `
        const { state, dom, utils } = dependencies;
        const RECOVERY_VERSION = 2;
        const RECOVERY_FEATURE_KEYS = new Set(['pointsOfInterest', 'regions', 'lines', 'roads', 'filterGroups']);
        ${extractFunction('hasUnfinishedGeometryDraft')}
        ${extractFunction('hasUnsavedEditorWork')}
        ${extractFunction('captureAtlasStructure')}
        ${extractFunction('captureFormValues')}
        ${extractFunction('captureRecoverySnapshot')}
        return captureRecoverySnapshot;
    `);
    const captureRecoverySnapshot = factory({
        state,
        dom: {
            appShell: document.querySelector('#app'),
            mapSettingsForm: document.querySelector('#map'),
            featureForm: document.querySelector('#feature')
        },
        utils: { cloneJson: (value) => JSON.parse(JSON.stringify(value)) }
    });
    const snapshot = captureRecoverySnapshot();
    assert.equal(snapshot.editorDirty, false);
    assert.equal(snapshot.drawMode, 'line');
    assert.deepEqual(snapshot.draftCoordinates, [[1, 2], [3, 4]]);
}

{
    const browserWindow = new JSDOM('', { url: 'http://localhost/editor' }).window;
    const storageKey = 'recovery:map-a';
    const snapshot = {
        currentMapId: 'map-a',
        currentMapDataUrl: 'maps/map-a.json',
        lineCollectionKey: 'lines',
        editorDirty: false,
        drawMode: 'region',
        draftCoordinates: [[10, 20], [30, 40]],
        featureListState: { type: 'regions' },
        selectedFeature: null,
        libraryReturnMode: 'hub',
        mode: 'draw',
        atlasStructure: [{ id: 'map-a', dataUrl: 'maps/map-a.json' }],
        currentMap: { id: 'map-a', name: 'Map A' },
        mapFormValues: [],
        featureFormValues: []
    };
    browserWindow.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
    const state = {
        currentMap: { id: 'map-a' },
        currentMapId: 'map-a',
        currentMapDataUrl: 'maps/map-a.json',
        lineCollectionKey: 'lines',
        savedWorkspaceFingerprint: 'saved',
        featureListState: { type: 'points' },
        libraryReturnMode: 'hub',
        atlasTree: [{ id: 'map-a' }],
        drawMode: '',
        draftCoordinates: [],
        recoveryStorageKey: ''
    };
    let restoredMode = '';
    const factory = new Function('dependencies', `
        const {
            window, state, canMutateWorkspace, getRecoveryStorageKey, isRecoverySnapshotValid,
            clearRecoverySnapshot, utils, replaceNodeById, workflowModes, renderAtlasTree,
            renderMapSettingsForm, renderFeatureLists, renderFeatureInspector, setWorkflowMode,
            restoreFormValues, dom, renderMapLayers, hasUnfinishedGeometryDraft,
            invalidateLivePreview, setReadinessItem, setExportStatus, refreshSaveControls
        } = dependencies;
        const RECOVERY_MAX_BYTES = 1500000;
        ${extractFunction('restoreRecoverySnapshot')}
        return restoreRecoverySnapshot;
    `);
    const restoreRecoverySnapshot = factory({
        window: browserWindow,
        state,
        canMutateWorkspace: () => true,
        getRecoveryStorageKey: () => storageKey,
        isRecoverySnapshotValid: () => true,
        clearRecoverySnapshot: () => {},
        utils: {
            normalizeBezierHandles: require('../js/editor-shared.js').normalizeBezierHandles,
            roundGeometryCorners: require('../js/editor-shared.js').roundGeometryCorners,
            cloneJson: (value) => JSON.parse(JSON.stringify(value)),
            findMapRecursive: (items, id) => items.find((item) => item.id === id)
        },
        replaceNodeById: (items, id, next) => items.map((item) => item.id === id ? next : item),
        workflowModes: new Set(['draw', 'hub']),
        renderAtlasTree: () => {},
        renderMapSettingsForm: () => {},
        renderFeatureLists: () => {},
        renderFeatureInspector: () => {},
        setWorkflowMode: (mode) => { restoredMode = mode; },
        restoreFormValues: () => {},
        dom: { mapSettingsForm: null, featureForm: null },
        renderMapLayers: () => {},
        hasUnfinishedGeometryDraft: () => state.drawMode === 'region' && state.draftCoordinates.length > 0,
        invalidateLivePreview: () => {},
        setReadinessItem: () => {},
        setExportStatus: () => {},
        refreshSaveControls: () => {}
    });
    assert.equal(restoreRecoverySnapshot(), true);
    assert.equal(state.editorDirty, false);
    assert.equal(state.drawMode, 'region');
    assert.deepEqual(state.draftCoordinates, [[10, 20], [30, 40]]);
    assert.equal(restoredMode, 'draw');
}

{
    const factory = new Function(`
        ${extractFunction('stableJsonValue')}
        return stableJsonValue;
    `);
    const stableJsonValue = factory();
    assert.equal(
        JSON.stringify(stableJsonValue({ z: 1, a: { y: 2, b: 3 } })),
        JSON.stringify(stableJsonValue({ a: { b: 3, y: 2 }, z: 1 }))
    );
}

{
    const state = {
        currentMap: { id: 'map-a' },
        atlasTree: [{ id: 'map-a' }],
        localSaveAvailable: true,
        saveInProgress: false,
        saveError: false,
        drawMode: '',
        draftCoordinates: []
    };
    const editingAvailabilityStates = [];
    const factory = new Function('dependencies', `
        const {
            state, canMutateWorkspace, hasUnfinishedGeometryDraft, setExportStatus,
            syncEditingAvailability, refreshSaveControls, utils, readMapSettingsForm,
            saveEditorDocument, setReadinessItem, applyServerReadiness, serializePreservedManifest
        } = dependencies;
        ${extractFunction('saveAtlasStructure')}
        return saveAtlasStructure;
    `);
    const saveAtlasStructure = factory({
        state,
        canMutateWorkspace: () => !state.saveInProgress,
        hasUnfinishedGeometryDraft: () => false,
        setExportStatus: () => {},
        syncEditingAvailability: () => { editingAvailabilityStates.push(state.saveInProgress); },
        refreshSaveControls: () => {},
        utils: { serializeFlatManifestState: () => ({ maps: [] }) },
        serializePreservedManifest: () => ({ maps: [] }),
        readMapSettingsForm: () => ({}),
        saveEditorDocument: async (endpoint, payload) => { assert.equal(endpoint, '/api/editor/save-atlas'); assert.deepEqual(payload.document, { maps: [] }); return { saved: 'maps.json', atlas: 'maps/atlas-index.json' }; },
        setReadinessItem: () => {},
        applyServerReadiness: () => {}
    });
    pendingTests.push(saveAtlasStructure().then(() => {
        assert.deepEqual(editingAvailabilityStates, [true, false]);
        assert.equal(state.saveError, false);
        assert.equal(state.saveInProgress, false);
    }));
}

{
    const state = {
        savedWorkspaceSnapshot: {
            atlasTree: [{ id: 'map-a', name: 'Saved name' }],
            currentMapId: 'map-a',
            currentMapDataUrl: 'maps/map-a.json',
            lineCollectionKey: 'lines'
        },
        atlasTree: [{ id: 'map-a', name: 'Discard me' }],
        currentMapId: 'map-a',
        editorDirty: true
    };
    let recoveryCleared = false;
    const factory = new Function('dependencies', `
        const {
            state, utils, clearDrawMode, editHistory, renderAtlasTree, renderMapSettingsForm,
            renderFeatureLists, renderFeatureInspector, renderMapLayers, setReadinessItem,
            refreshSaveControls, clearRecoverySnapshot
        } = dependencies;
        ${extractFunction('restoreSavedWorkspaceBaseline')}
        return restoreSavedWorkspaceBaseline;
    `);
    const restoreSavedWorkspaceBaseline = factory({
        state,
        utils: {
            cloneJson: (value) => JSON.parse(JSON.stringify(value)),
            findMapRecursive: (items, id) => items.find((item) => item.id === id)
        },
        clearDrawMode: () => {},
        editHistory: { clear: () => {} },
        renderAtlasTree: () => {},
        renderMapSettingsForm: () => {},
        renderFeatureLists: () => {},
        renderFeatureInspector: () => {},
        renderMapLayers: () => {},
        setReadinessItem: () => {},
        refreshSaveControls: () => {},
        clearRecoverySnapshot: () => { recoveryCleared = true; }
    });
    assert.equal(restoreSavedWorkspaceBaseline(), true);
    assert.equal(state.currentMap.name, 'Saved name');
    assert.equal(state.editorDirty, false);
    assert.equal(recoveryCleared, true);
}

{
    const deferred = {};
    const makeDeferred = (id) => {
        let resolve;
        const promise = new Promise((next) => { resolve = next; });
        deferred[id] = { promise, resolve };
    };
    makeDeferred('map-a');
    makeDeferred('map-b');
    const state = {
        atlasTree: [
            { id: 'map-a', name: 'A', dataUrl: 'maps/map-a.json', imageUrl: 'a.webp', width: 10, height: 10 },
            { id: 'map-b', name: 'B', dataUrl: 'maps/map-b.json', imageUrl: 'b.webp', width: 10, height: 10 }
        ],
        fileMode: true,
        fileVersions: { 'maps/map-b.json': 'old-b', 'maps/maps.json': 'original-manifest' },
        mapSelectionRequestId: 0,
        currentMapId: '',
        currentMap: null,
        currentMapDataUrl: '',
        drawMode: '',
        draftCoordinates: [],
        selectedFeature: null,
        saveError: false
    };
    const find = (items, id) => items.find((item) => item.id === id);
    const factory = new Function('dependencies', `
        const {
            state, utils, fetch, fetchJsonAsset, clearDrawMode, deselectFeature, replaceNodeById,
            editHistory, syncHistoryControls, renderAtlasTree, renderMapSettingsForm,
            renderFeatureLists, renderFeatureInspector, setSelectionStatus,
            recordSavedWorkspaceBaseline, setExportStatus, setReadinessItem, setWorkflowMode,
            scheduleMapLayerRender, renderMapLayers, queueMapViewportReset, captureFileBaseline
        } = dependencies;
        ${extractFunction('selectMap')}
        return selectMap;
    `);
    const selectMap = factory({
        state,
        utils: {
            findMapRecursive: find,
            cloneJson: value => JSON.parse(JSON.stringify(value)),
            resolveFileBackedMapDocument: (map) => deferred[map.id].promise,
            detectLineCollectionKey: () => 'lines'
        },
        fetch: url => { const id = url.match(/map-[ab]/)[0]; return deferred[id].promise.then(value => ({ ok: true, json: async () => value, headers: { get: name => name === 'ETag' ? `fresh-${id}` : null } })); },
        fetchJsonAsset: () => {},
        clearDrawMode: () => {},
        deselectFeature: () => {},
        replaceNodeById: (items, id, next) => items.map((item) => item.id === id ? next : item),
        editHistory: { clear: () => {} },
        syncHistoryControls: () => {},
        renderAtlasTree: () => {},
        renderMapSettingsForm: () => {},
        renderFeatureLists: () => {},
        renderFeatureInspector: () => {},
        setSelectionStatus: () => {},
        recordSavedWorkspaceBaseline: () => {},
        setExportStatus: () => {},
        setReadinessItem: () => {},
        setWorkflowMode: () => {},
        scheduleMapLayerRender: () => {},
        renderMapLayers: () => {},
        queueMapViewportReset: () => {},
        captureFileBaseline: () => {}
    });
    const first = selectMap('map-a');
    const second = selectMap('map-b');
    deferred['map-b'].resolve({ id: 'map-b', name: 'Resolved B' });
    deferred['map-a'].resolve({ id: 'map-a', name: 'Resolved A' });
    pendingTests.push(Promise.all([first, second]).then(([firstResult, secondResult]) => {
        assert.equal(firstResult, false);
        assert.equal(secondResult, true);
        assert.equal(state.currentMapId, 'map-b');
        assert.equal(state.currentMap.name, 'Resolved B');
        assert.deepEqual(state.fileVersions, { 'maps/map-b.json': 'fresh-map-b', 'maps/maps.json': 'original-manifest' });
    }));
}

{
    const factory = new Function(`
        ${extractFunction('getMapLibraryGroup')}
        ${extractFunction('getMapLibraryGroupLabel')}
        return { getMapLibraryGroup, getMapLibraryGroupLabel };
    `);
    const library = factory();
    assert.equal(library.getMapLibraryGroup({ id: 'main_continent' }, []), 'active');
    assert.equal(library.getMapLibraryGroup({ id: 'DEV-2025-map' }, ['Development & Archive Maps']), 'development');
    assert.equal(library.getMapLibraryGroup({ id: 'Astrousia' }, ['Development & Archive Maps']), 'archived');
    assert.equal(library.getMapLibraryGroup({ id: 'legacy-map' }, ['Archive Maps']), 'archived');
    assert.equal(library.getMapLibraryGroup({ id: 'OLD-Fair' }, ['Development & Archive Maps']), 'archived');
    assert.equal(library.getMapLibraryGroup({ id: 'map', status: 'archived' }, []), 'archived');
    assert.equal(library.getMapLibraryGroupLabel('active'), 'Active maps');
}

{
    const factory = new Function(`
        ${extractFunction('isStudioHostedPath')}
        return isStudioHostedPath;
    `);
    const isStudioHostedPath = factory();
    assert.equal(isStudioHostedPath('/studio/editor'), true);
    assert.equal(isStudioHostedPath('/studio/editor/'), true);
    assert.equal(isStudioHostedPath('/map-editor.html'), false);
}

{
    const state = {
        currentMapId: 'map-a',
        currentMap: { id: 'map-a', pointsOfInterest: [{ name: 'Point A' }] },
        selectedFeature: { mode: 'points', index: 0 },
        featureListState: { type: 'points' },
        inspectorCollapsed: false,
        activeTool: 'select',
        libraryReturnMode: 'hub',
        libraryReturnContext: null
    };
    let restoredMode = '';
    const factory = new Function('dependencies', `
        const {
            state, workflowModes, getSelectedFeature, setWorkflowMode, setInspectorCollapsed,
            setActiveTool, renderFeatureLists, renderFeatureInspector, renderMapLayers, queueMapLayout
        } = dependencies;
        ${extractFunction('captureLibraryReturnContext')}
        ${extractFunction('restoreLibraryReturnContext')}
        return { captureLibraryReturnContext, restoreLibraryReturnContext };
    `);
    const context = factory({
        state,
        workflowModes: new Set(['library', 'hub', 'feature-browser', 'feature-edit', 'draw']),
        getSelectedFeature: () => state.currentMap.pointsOfInterest[state.selectedFeature?.index] || null,
        setWorkflowMode: (mode) => { restoredMode = mode; },
        setInspectorCollapsed: () => {},
        setActiveTool: () => {},
        renderFeatureLists: () => {},
        renderFeatureInspector: () => {},
        renderMapLayers: reset => assert.equal(reset, false),
        queueMapLayout: () => {}
    });
    context.captureLibraryReturnContext('feature-edit');
    state.selectedFeature = null;
    context.restoreLibraryReturnContext();
    assert.equal(restoredMode, 'feature-edit');
    assert.deepEqual(state.selectedFeature, { mode: 'points', index: 0 });
}

{
    const document = new JSDOM(`
        <main id="app" data-mode="draw"></main>
        <button id="poi"></button><button id="region"></button><button id="line"></button>
        <button id="reset"></button><button id="delete"></button><button id="finish"></button><button id="cancel"></button>
        <button id="export"></button><small id="note"></small>
    `).window.document;
    const state = {
        currentMap: { id: 'map-a', imageUrl: 'map.webp', width: 100, height: 100 },
        drawMode: 'region',
        draftCoordinates: [[1, 2]],
        selectedFeature: null
    };
    const dom = {
        appShell: document.querySelector('#app'),
        addPoiButton: document.querySelector('#poi'),
        addRegionButton: document.querySelector('#region'),
        addLineButton: document.querySelector('#line'),
        resetViewButton: document.querySelector('#reset'),
        deleteSelectionButton: document.querySelector('#delete'),
        finishDrawButton: document.querySelector('#finish'),
        cancelDrawButton: document.querySelector('#cancel'),
        exportCurrentMapButton: document.querySelector('#export'),
        exportCurrentMapNote: document.querySelector('#note'),
        toolButtons: []
    };
    const factory = new Function('dependencies', `
        const { state, dom, canRenderMap, canMutateWorkspace, hasUnfinishedGeometryDraft } = dependencies;
        ${extractFunction('syncToolbarState')}
        return syncToolbarState;
    `);
    const syncToolbarState = factory({
        state,
        dom,
        canRenderMap: () => true,
        canMutateWorkspace: () => true,
        hasUnfinishedGeometryDraft: () => state.draftCoordinates.length > 0
    });
    syncToolbarState();
    assert.equal(dom.exportCurrentMapButton.disabled, true);
    assert.match(dom.exportCurrentMapButton.title, /Unfinished vertices are not included/);
    assert.match(dom.exportCurrentMapNote.textContent, /finish or cancel/i);
}

// Switching tasks suspends draft editing without losing unfinished geometry.
for (const drawMode of ['region', 'line']) {
    const state = { currentMap: { id: 'map-a' }, drawMode, draftCoordinates: [[1, 2]] };
    const dom = { appShell: { dataset: { mode: 'map-details' } } };
    let unsavedUpdates = 0;
    let draftRenders = 0;
    const handleMapClick = new Function('dependencies', `
        const { state, dom, canRenderMap, canMutateWorkspace, roundLatLng,
            renderDraftGeometry, syncToolbarState, setSelectionStatus, markGeometryDraftUnsaved } = dependencies;
        ${extractFunction('handleMapClick')}
        return handleMapClick;
    `)({
        state, dom,
        canRenderMap: () => true,
        canMutateWorkspace: () => true,
        roundLatLng: coordinate => coordinate,
        renderDraftGeometry: () => { draftRenders += 1; },
        syncToolbarState: () => {},
        setSelectionStatus: () => {},
        markGeometryDraftUnsaved: () => { unsavedUpdates += 1; }
    });
    handleMapClick({ latlng: [3, 4] });
    assert.deepEqual(state.draftCoordinates, [[1, 2]], `${drawMode} must stay suspended in map settings`);
    assert.equal(unsavedUpdates, 0);
    assert.equal(draftRenders, 0);
    assert.equal(state.drawMode, drawMode);

    dom.appShell.dataset.mode = 'draw';
    handleMapClick({ latlng: [5, 6] });
    assert.deepEqual(state.draftCoordinates, [[1, 2], [5, 6]], `${drawMode} must resume from its existing vertices`);
    assert.equal(unsavedUpdates, 1);
    assert.equal(draftRenders, 1);

    dom.appShell.dataset.mode = 'map-details';
    handleMapClick({ latlng: [7, 8] });
    assert.deepEqual(state.draftCoordinates, [[1, 2], [5, 6]]);
}

// Simulate Safari withholding RAF; the timer must finish layout exactly once.
// Also cover the normal frame-first order and an already-queued late timer.
for (const firstCallback of ['timer', 'frame']) {
    let timerCallback;
    let frameCallback;
    let layoutRuns = 0;
    const clearedTimers = [];
    const scheduleMapLayout = new Function('dependencies', `
        const { setTimeout, clearTimeout, requestAnimationFrame } = dependencies;
        ${extractFunction('scheduleMapLayout')}
        return scheduleMapLayout;
    `)({
        setTimeout: (callback, delay) => {
            assert.equal(delay, 100);
            timerCallback = callback;
            return 42;
        },
        clearTimeout: timer => clearedTimers.push(timer),
        requestAnimationFrame: callback => { frameCallback = callback; }
    });
    scheduleMapLayout(() => { layoutRuns += 1; });
    assert.equal(layoutRuns, 0);
    (firstCallback === 'timer' ? timerCallback : frameCallback)();
    assert.equal(layoutRuns, 1, `${firstCallback} must complete pending layout`);
    assert.deepEqual(clearedTimers, [42]);
    (firstCallback === 'timer' ? frameCallback : timerCallback)();
    assert.equal(layoutRuns, 1, 'Late callbacks must not run layout twice');
    assert.deepEqual(clearedTimers, [42]);
}

assert.match(source, /Maps available to review/);
assert.match(source, /publishPanel\.hidden = state\.accessChecked && !accessWritable/);

Promise.all(pendingTests).then(() => {
    console.log('map editor safety regression checks passed');
}).catch((error) => {
    process.nextTick(() => { throw error; });
});
