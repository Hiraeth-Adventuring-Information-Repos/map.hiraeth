(function () {

    // DM appearance is independent of the public map preference.
    function applyDmTheme(theme) {
        const dark = theme === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        document.querySelectorAll('[data-dm-theme]').forEach(button => {
            button.setAttribute('aria-pressed', String(dark));
            button.title = dark ? 'Use parchment theme' : 'Use dark theme';
        });
    }
    let dmTheme = 'light';
    try { dmTheme = localStorage.getItem('hiraethDmTheme') || 'light'; } catch (_) {}
    applyDmTheme(dmTheme);
    document.querySelectorAll('[data-dm-theme]').forEach(button => button.addEventListener('click', () => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('hiraethDmTheme', theme); } catch (_) {}
        applyDmTheme(theme);
    }));
    window.addEventListener('storage', event => {
        if (event.key === 'hiraethDmTheme') applyDmTheme(event.newValue);
    });
    const utils = window.MapEditorUtils;
    const sharedUtils = window.SharedUtils;
    const fieldApi = window.MapEditorFields;
    const historyApi = window.MapEditorHistory;
    const fileDocuments = window.MapFileDocument;

    if (!utils || !sharedUtils || !fieldApi || !historyApi || typeof L === 'undefined') {
        console.error('Map editor prerequisites are missing.');
        return;
    }

    fieldApi.renderMapFields(document);

    const { debounce } = sharedUtils;
    const editHistory = historyApi.createHistory({ limit: 24 });
    const editorSearchParams = new URLSearchParams(window.location.search);
    const reviewOnlyRequested = editorSearchParams.get('mode') === 'review';
    const RECOVERY_VERSION = 2;
    const RECOVERY_STORAGE_PREFIX = `mapEditorRecovery:v${RECOVERY_VERSION}`;
    const RECOVERY_MAX_BYTES = 1500000;
    const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const RECOVERY_FEATURE_KEYS = new Set(['pointsOfInterest', 'regions', 'lines', 'roads', 'journeys', 'filterGroups']);

    const state = {
        atlasTree: [],
        fileMode: false,
        downloadOnly: false,
        hasDownloaded: false,
        fileVersions: {},
        fileSnapshot: null,
        manifestSource: null,
        manifestSnapshots: null,
        currentMapId: '',
        currentMap: null,
        currentMapDataUrl: '',
        currentBounds: null,
        lineCollectionKey: 'lines',
        drawMode: '',
        activeTool: 'select',
        draftCoordinates: [],
        draftHandles: [],
        selectedVertexIndex: -1,
        geometryDragActive: false,
        selectedFeature: null,
        featureListState: {
            type: 'points',
            searchQuery: '',
            expanded: false,
            defaultLimit: 12
        },
        expandedFolderIds: new Set(),
        treeSearch: '',
        map: null,
        imageLayer: null,
        underlayLayer: null,
        pointLayer: null,
        regionLayer: null,
        lineLayer: null,
        journeyLayer: null,
        placingJourneyStop: false,
        vertexLayer: null,
        draftLayer: null,
        accessChecked: false,
        reviewOnlyRequested,
        localSaveAvailable: false,
        localSaveMessage: '',
        editorDirty: false,
        savedWorkspaceFingerprint: '',
        recoveryBaselineHash: '',
        recoveryBaselineLength: 0,
        savedWorkspaceSnapshot: null,
        recoveryWorkspaceId: `local:${window.location.origin}${window.location.pathname}`,
        recoveryStorageKey: '',
        saveInProgress: false,
        saveError: false,
        inspectorCollapsed: false,
        inspectorLauncherHidden: false,
        inspectorWidth: 0,
        inspectorTab: 'overview',
        openAppMenu: '',
        pendingMapId: '',
        pendingTransition: null,
        mapSelectionRequestId: 0,
        libraryReturnMode: 'hub',
        libraryReturnContext: null,
        libraryStatusFilter: 'all',
        libraryDensity: 'comfortable',
        recentMapIds: [],
        publishReadiness: {
            items: {},
            previewUrl: '',
            topStatus: 'Needs Build',
            buildJob: null
        }
    };

    const dom = {
        appShell: document.getElementById('map-editor-app'),
        loadingState: document.getElementById('editor-loading-state'),
        loadingTitle: document.getElementById('editor-loading-title'),
        loadingCopy: document.getElementById('editor-loading-copy'),
        accessNotice: document.getElementById('editor-access-notice'),
        accessTitle: document.getElementById('editor-access-title'),
        accessCopy: document.getElementById('editor-access-copy'),
        accessStudioLink: document.getElementById('editor-access-studio-link'),
        libraryTitle: document.getElementById('editor-library-title'),
        libraryCopy: document.getElementById('editor-library-copy'),
        libraryStatusFilter: document.getElementById('editor-library-status-filter'),
        libraryRecentSelect: document.getElementById('editor-library-recent-select'),
        libraryDensityButton: document.getElementById('editor-library-density-btn'),
        workspace: document.querySelector('.map-editor-workspace'),
        contextLabel: document.getElementById('editor-context-label'),
        contextName: document.getElementById('editor-context-name'),
        studioHomeLink: document.getElementById('editor-studio-home-link'),
        menuStudioLink: document.getElementById('editor-menu-studio-link'),
        mapHomeButton: document.getElementById('editor-map-home-btn'),
        mapHome: document.getElementById('editor-map-home'),
        mapHomeTitle: document.getElementById('editor-map-home-title'),
        mapHomeSummary: document.getElementById('editor-map-home-summary'),
        mapHomeImage: document.getElementById('editor-map-home-image'),
        mapHomePointsCount: document.getElementById('editor-map-home-points-count'),
        mapHomeRegionsCount: document.getElementById('editor-map-home-regions-count'),
        mapHomeLinesCount: document.getElementById('editor-map-home-lines-count'),
        mapHomeAllMapsButton: document.getElementById('editor-map-home-all-maps-btn'),
        editMapDetailsButton: document.getElementById('editor-edit-map-details-btn'),
        editMapAdvancedButton: document.getElementById('editor-edit-map-advanced-btn'),
        editPointsButton: document.getElementById('editor-edit-points-btn'),
        editRegionsButton: document.getElementById('editor-edit-regions-btn'),
        editLinesButton: document.getElementById('editor-edit-lines-btn'),
        atlasTree: document.getElementById('editor-atlas-tree'),
        treeSearch: document.getElementById('editor-tree-search'),
        reloadButton: document.getElementById('reload-editor-btn'),
        selectionStatus: document.getElementById('editor-selection-status'),
        mapEmptyState: document.getElementById('editor-map-empty-state'),
        mapEmptyTitle: document.getElementById('editor-map-empty-title'),
        mapEmptyCopy: document.getElementById('editor-map-empty-copy'),
        mapEmptyDetail: document.getElementById('editor-map-empty-detail'),
        exportStatus: document.getElementById('editor-export-status'),
        saveBar: document.getElementById('editor-save-bar'),
        saveStateChip: document.getElementById('editor-save-state-chip'),
        saveStateTitle: document.getElementById('editor-save-state-title'),
        currentMapId: document.getElementById('editor-current-map-id'),
        featureSummary: document.getElementById('editor-feature-summary'),
        selectedFeatureChip: document.getElementById('editor-selected-feature-chip'),
        mapSettingsForm: document.getElementById('map-settings-form'),
        featureForm: document.getElementById('editor-feature-form'),
        featureFormEmpty: document.getElementById('editor-feature-inspector-empty'),
        featureTypeSelect: document.getElementById('editor-feature-type-select'),
        featureSearchInput: document.getElementById('editor-feature-search'),
        unifiedFeatureList: document.getElementById('editor-unified-feature-list'),
        featureShowMoreButton: document.getElementById('editor-feature-show-more-btn'),
        createFeatureButton: document.getElementById('editor-create-feature-btn'),
        featureBrowserTitle: document.getElementById('editor-feature-browser-title'),
        featureBrowserSummary: document.getElementById('editor-feature-browser-summary'),
        addPoiButton: document.getElementById('editor-add-poi-btn'),
        addRegionButton: document.getElementById('editor-add-region-btn'),
        addLineButton: document.getElementById('editor-add-line-btn'),
        journeysButton: document.getElementById('editor-journeys-btn'),
        finishDrawButton: document.getElementById('editor-finish-draw-btn'),
        curvePointButton: document.getElementById('editor-curve-point-btn'),
        geometryHelp: document.getElementById('editor-geometry-help'),
        undoPointButton: document.getElementById('editor-undo-point-btn'),
        cancelDrawButton: document.getElementById('editor-cancel-draw-btn'),
        deleteSelectionButton: document.getElementById('editor-delete-selection-btn'),
        resetViewButton: document.getElementById('editor-reset-view-btn'),
        zoomStatus: document.getElementById('editor-zoom-status'),
        undoButton: document.getElementById('editor-undo-btn'),
        redoButton: document.getElementById('editor-redo-btn'),
        unsavedDialog: document.getElementById('editor-unsaved-dialog'),
        unsavedCopy: document.getElementById('editor-unsaved-copy'),
        cancelSwitchButton: document.getElementById('editor-cancel-switch-btn'),
        discardSwitchButton: document.getElementById('editor-discard-switch-btn'),
        saveSwitchButton: document.getElementById('editor-save-switch-btn'),
        toggleInspectorButton: document.getElementById('editor-toggle-inspector-btn'),
        collapseInspectorButton: document.getElementById('editor-collapse-inspector-btn'),
        focusEyebrow: document.getElementById('editor-focus-eyebrow'),
        focusTitle: document.getElementById('editor-focus-title'),
        focusSummary: document.getElementById('editor-focus-summary'),
        backToFeatureListButton: document.getElementById('editor-back-to-feature-list-btn'),
        canvasTaskLabel: document.getElementById('editor-canvas-task-label'),
        toolbarHint: document.querySelector('.map-editor-toolbar-hint'),
        activeToolLabel: document.getElementById('editor-active-tool-label'),
        activeToolShortcut: document.getElementById('editor-active-tool-shortcut'),
        toolRail: document.getElementById('editor-tool-rail'),
        toolButtons: Array.from(document.querySelectorAll('[data-editor-tool]')),
        inspectorLauncher: document.getElementById('editor-inspector-launcher'),
        inspectorLauncherToggle: document.getElementById('editor-inspector-launcher-toggle'),
        inspector: document.getElementById('editor-inspector'),
        inspectorResizer: document.getElementById('editor-inspector-resizer'),
        inspectorTabButtons: Array.from(document.querySelectorAll('[data-inspector-tab]')),
        inspectorPanels: Array.from(document.querySelectorAll('[data-inspector-panel]')),
        saveCurrentMapButton: document.getElementById('save-current-map-btn'),
        saveAtlasStructureButton: document.getElementById('save-atlas-structure-btn'),
        exportCurrentMapButton: document.getElementById('export-current-map-btn'),
        exportAtlasStructureButton: document.getElementById('export-atlas-structure-btn'),
        exportDialog: document.getElementById('editor-export-dialog'),
        exportButton: document.getElementById('editor-export-btn'),
        openExportButton: document.getElementById('editor-open-export-btn'),
        exportCloseButton: document.getElementById('editor-export-close-btn'),
        exportBuildPreviewButton: document.getElementById('editor-export-build-preview-btn'),
        exportOpenPreviewLink: document.getElementById('editor-export-open-preview-link'),
        exportPreviewCommandStatus: document.getElementById('editor-preview-command-status'),
        fileMenuButton: document.getElementById('editor-file-menu-btn'),
        editMenuButton: document.getElementById('editor-edit-menu-btn'),
        viewMenuButton: document.getElementById('editor-view-menu-btn'),
        appMenuButtons: Array.from(document.querySelectorAll('[data-app-menu-trigger]')),
        appMenus: Array.from(document.querySelectorAll('[data-app-menu]')),
        appMenuItems: Array.from(document.querySelectorAll('[data-menu-action]')),
        menuSaveButton: document.getElementById('editor-menu-save-btn'),
        menuUndoButton: document.getElementById('editor-menu-undo-btn'),
        menuRedoButton: document.getElementById('editor-menu-redo-btn'),
        menuPropertiesButton: document.getElementById('editor-menu-properties-btn'),
        menuAdvancedButton: document.getElementById('editor-menu-advanced-btn'),
        menuFitButton: document.getElementById('editor-menu-fit-btn'),
        menuPanButton: document.getElementById('editor-menu-pan-btn'),
        menuInspectorButton: document.getElementById('editor-menu-inspector-btn'),
        exportReadiness: document.getElementById('editor-export-readiness'),
        exportCurrentMapNote: document.getElementById('editor-export-current-map-note'),
        buildLivePreviewButton: document.getElementById('build-live-preview-btn'),
        livePreviewLink: document.getElementById('live-preview-link'),
        previewStudioLink: document.getElementById('editor-preview-studio-link'),
        publishReadinessChip: document.getElementById('publish-readiness-chip'),
        publishPanel: document.querySelector('.map-editor-publish-panel'),
        publishReadinessTitle: document.getElementById('publish-readiness-title'),
        publishReadinessSummary: document.getElementById('publish-readiness-summary'),
        publishBuildProgress: document.getElementById('publish-build-progress'),
        chooseMapButton: document.getElementById('editor-choose-map-btn'),
        mapSettingsInputs: fieldApi.collectMapInputs(document)
    };

    function roundCoordinate(value) {
        return Math.round(Number(value) || 0);
    }

    function roundLatLng(latlng) {
        return [roundCoordinate(latlng.lat), roundCoordinate(latlng.lng)];
    }



    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/`/g, '&#96;');
    }

    function getCurrentPoints() {
        if (!state.currentMap) return [];
        if (!Array.isArray(state.currentMap.pointsOfInterest)) {
            state.currentMap.pointsOfInterest = [];
        }
        return state.currentMap.pointsOfInterest;
    }

    function getCurrentJourneys() {
        if (!state.currentMap) return [];
        return state.currentMap.journeys ||= [];
    }

    function getCurrentRegions() {
        if (!state.currentMap) return [];
        if (!Array.isArray(state.currentMap.regions)) {
            state.currentMap.regions = [];
        }
        return state.currentMap.regions;
    }

    function getCurrentLines() {
        if (!state.currentMap) return [];
        if (!Array.isArray(state.currentMap[state.lineCollectionKey])) {
            state.currentMap[state.lineCollectionKey] = [];
        }
        return state.currentMap[state.lineCollectionKey];
    }

    const fetchJsonAsset = sharedUtils.fetchJsonAsset;

    function findNodeLocation(items, id, parentId = '') {
        if (!Array.isArray(items)) return null;
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (!item || typeof item !== 'object') continue;
            if (item.id === id) {
                return {
                    node: item,
                    index,
                    parentId,
                    siblings: items
                };
            }
            const nestedLocation = findNodeLocation(item.children, id, item.id);
            if (nestedLocation) return nestedLocation;
        }
        return null;
    }

    function collectDescendantIds(node, collector = new Set()) {
        if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return collector;
        node.children.forEach((child) => {
            if (!child || typeof child !== 'object' || !child.id) return;
            collector.add(child.id);
            collectDescendantIds(child, collector);
        });
        return collector;
    }

    function replaceNodeById(items, id, nextNode) {
        if (!Array.isArray(items)) return [];
        return items.map((item) => {
            if (!item || typeof item !== 'object') return item;
            if (item.id === id) return nextNode;
            if (Array.isArray(item.children)) {
                return {
                    ...item,
                    children: replaceNodeById(item.children, id, nextNode)
                };
            }
            return item;
        });
    }

    function moveNodeInTree(items, nodeId, nextParentId, nextOrder) {
        const clonedTree = utils.cloneJson(items);
        const location = findNodeLocation(clonedTree, nodeId);
        if (!location || !location.node) return clonedTree;

        const descendantIds = collectDescendantIds(location.node);
        const normalizedParentId = String(nextParentId || '').trim();
        if (normalizedParentId && (normalizedParentId === nodeId || descendantIds.has(normalizedParentId))) {
            throw new Error('A map cannot be moved inside itself or one of its descendants.');
        }

        const removedNode = location.siblings.splice(location.index, 1)[0];
        let targetSiblings = clonedTree;

        if (normalizedParentId) {
            const nextParentNode = utils.findMapRecursive(clonedTree, normalizedParentId);
            if (!nextParentNode) {
                throw new Error(`Could not find parent map "${normalizedParentId}".`);
            }
            if (!Array.isArray(nextParentNode.children)) {
                nextParentNode.children = [];
            }
            targetSiblings = nextParentNode.children;
        }

        let insertionIndex = Number.isFinite(Number(nextOrder))
            ? Number(nextOrder)
            : targetSiblings.length;
        insertionIndex = Math.max(0, Math.min(targetSiblings.length, insertionIndex));
        targetSiblings.splice(insertionIndex, 0, removedNode);

        return clonedTree;
    }

    function canRenderMap(mapInfo) {
        return Boolean(
            mapInfo &&
            Number.isFinite(Number(mapInfo.width)) &&
            Number.isFinite(Number(mapInfo.height)) &&
            String(mapInfo.imageUrl || '').trim()
        );
    }

    function getMapPresetGroupLabel(item) {
        return String(item?.group || item?.category || '').trim();
    }

    function readMapSettingsForm() {
        return fieldApi.readMapForm(dom.mapSettingsInputs);
    }

    function hasWritableAccess() {
        return Boolean(state.accessChecked && state.localSaveAvailable && !state.reviewOnlyRequested);
    }

    function canMutateWorkspace() {
        return Boolean(hasWritableAccess() && !state.saveInProgress);
    }

    function hasUnfinishedGeometryDraft() {
        return Boolean(
            (state.drawMode === 'region' || state.drawMode === 'line') &&
            Array.isArray(state.draftCoordinates) &&
            state.draftCoordinates.length > 0
        );
    }

    function hasUnsavedEditorWork() {
        return Boolean(state.editorDirty || hasUnfinishedGeometryDraft());
    }

    function getIncompleteFeature() {
        const collections = [
            ['points', getCurrentPoints(), /^POI\s+\d+$/i],
            ['regions', getCurrentRegions(), /^Region\s+\d+$/i],
            ['lines', getCurrentLines(), /^Line\s+\d+$/i]
        ];
        for (const [mode, collection, placeholderPattern] of collections) {
            for (let index = 0; index < collection.length; index += 1) {
                const feature = collection[index] || {};
                const name = String(feature.name || '').trim();
                if (!name || placeholderPattern.test(name) || /^unknown$/i.test(name)) {
                    return { mode, index, feature };
                }
            }
        }
        return null;
    }

    function syncFormAccess(form) {
        if (!form) return;
        const writable = canMutateWorkspace();
        form.setAttribute('aria-disabled', String(!writable));
        form.querySelectorAll('input, textarea, select, button').forEach((control) => {
            if (control.dataset.alwaysReadonly !== undefined) return;
            control.disabled = !writable;
        });
    }

    function syncEditingAvailability() {
        const writable = canMutateWorkspace();
        const accessWritable = hasWritableAccess();
        const accessState = state.accessChecked ? (accessWritable ? 'writable' : 'review-only') : 'checking';
        dom.appShell.dataset.access = accessState;

        if (dom.libraryTitle && dom.libraryCopy) {
            dom.libraryTitle.textContent = accessWritable ? 'Choose a map to edit' : 'Choose a map to review';
            dom.libraryCopy.textContent = accessWritable
                ? 'Open one map, then choose the kind of change you want to make.'
                : 'Open any map to inspect its details and features. Editing is locked in this workspace.';
        }
        if (dom.atlasTree) {
            dom.atlasTree.setAttribute('aria-label', accessWritable ? 'Editable maps' : 'Maps available to review');
        }

        if (dom.accessTitle && dom.accessCopy && dom.accessStudioLink) {
            if (!state.accessChecked) {
                dom.accessTitle.textContent = 'Checking editing access…';
                dom.accessCopy.textContent = 'Map browsing stays available while Studio checks for a writable workspace.';
                dom.accessStudioLink.textContent = 'Open Studio';
            } else if (accessWritable) {
                dom.accessTitle.textContent = 'Writable workspace connected';
                dom.accessCopy.textContent = 'Changes can be saved to this Studio workspace.';
                dom.accessStudioLink.textContent = 'Studio overview';
            } else {
                dom.accessTitle.textContent = 'Review-only map browser';
                dom.accessCopy.textContent = state.reviewOnlyRequested
                    ? (state.fileMode ? 'This review link cannot change files. Choose Start editing to edit the map files.' : 'You are viewing maps. Start editing to make changes in a private draft.')
                    : (state.localSaveMessage || 'No writable Studio workspace is connected. Map fields and drawing tools are locked.');
                dom.accessStudioLink.textContent = 'Start editing';
            }
        }

        [dom.mapSettingsForm, dom.featureForm].forEach(syncFormAccess);

        if (dom.createFeatureButton) dom.createFeatureButton.disabled = !writable;
        if (dom.saveBar) dom.saveBar.hidden = state.accessChecked && !accessWritable;
        if (dom.publishPanel) dom.publishPanel.hidden = state.accessChecked && !accessWritable;
        if (dom.exportBuildPreviewButton) dom.exportBuildPreviewButton.hidden = state.accessChecked && !accessWritable;
        dom.toolButtons.forEach((button) => {
            if (['point', 'region', 'line'].includes(button.dataset.editorTool)) {
                button.hidden = state.accessChecked && !accessWritable;
            }
        });
        [dom.editMapDetailsButton, dom.editMapAdvancedButton].filter(Boolean).forEach((button) => {
            const strong = button.querySelector('strong');
            if (!strong) return;
            if (button === dom.editMapDetailsButton) strong.textContent = accessWritable ? 'Map details' : 'Review map details';
            else strong.textContent = accessWritable ? 'Advanced map setup' : 'Review map setup';
        });
        if (state.atlasTree.length > 0) renderAtlasTree();
        if (state.currentMap) renderMapLayers(false);
        if (state.currentMap && ['map-details', 'map-advanced', 'feature-browser', 'feature-edit'].includes(dom.appShell.dataset.mode)) {
            const wasCollapsed = state.inspectorCollapsed;
            setWorkflowMode(dom.appShell.dataset.mode);
            if (state.fileMode) setInspectorCollapsed(wasCollapsed, false);
        }
        syncHistoryControls();
        syncToolbarState();
    }

    const workflowModes = new Set([
        'library',
        'hub',
        'map-details',
        'map-advanced',
        'feature-browser',
        'feature-edit',
        'draw'
    ]);

    function getMiniMapImageUrl(imageUrl) {
        const normalizedUrl = String(imageUrl || '').trim();
        if (!normalizedUrl) return '';
        const queryIndex = normalizedUrl.indexOf('?');
        const path = queryIndex >= 0 ? normalizedUrl.slice(0, queryIndex) : normalizedUrl;
        const query = queryIndex >= 0 ? normalizedUrl.slice(queryIndex) : '';
        const miniPath = path.replace(/(\.[^./?#]+)$/, '.mini.webp');
        return `${miniPath === path ? `${path}.mini.webp` : miniPath}${query}`;
    }

    function initializeLibraryPreferences() {
        try {
            state.libraryDensity = localStorage.getItem('mapEditorLibraryDensity') === 'compact'
                ? 'compact'
                : 'comfortable';
            const storedRecent = JSON.parse(localStorage.getItem('mapEditorRecentMaps') || '[]');
            state.recentMapIds = Array.isArray(storedRecent)
                ? storedRecent.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 5)
                : [];
        } catch (error) {
            state.libraryDensity = 'comfortable';
            state.recentMapIds = [];
        }
        if (dom.libraryDensityButton) {
            const compact = state.libraryDensity === 'compact';
            dom.libraryDensityButton.setAttribute('aria-pressed', String(compact));
            dom.libraryDensityButton.textContent = compact ? 'Comfortable view' : 'Compact view';
        }
    }

    function setLibraryDensity(density) {
        state.libraryDensity = density === 'compact' ? 'compact' : 'comfortable';
        try {
            localStorage.setItem('mapEditorLibraryDensity', state.libraryDensity);
        } catch (error) {
            // The current tab can still use the selected density when storage is unavailable.
        }
        if (dom.libraryDensityButton) {
            const compact = state.libraryDensity === 'compact';
            dom.libraryDensityButton.setAttribute('aria-pressed', String(compact));
            dom.libraryDensityButton.textContent = compact ? 'Comfortable view' : 'Compact view';
        }
        renderAtlasTree();
    }

    function recordRecentMap(mapId) {
        const normalizedId = String(mapId || '').trim();
        if (!normalizedId) return;
        state.recentMapIds = [normalizedId, ...state.recentMapIds.filter((id) => id !== normalizedId)].slice(0, 5);
        try {
            localStorage.setItem('mapEditorRecentMaps', JSON.stringify(state.recentMapIds));
        } catch (error) {
            // Recent maps remain available in the current tab when storage is unavailable.
        }
    }

    function getMapLibraryGroup(item, parentLabels = []) {
        const status = String(item?.status || '').trim().toLowerCase();
        const id = String(item?.id || '').trim().toLowerCase();
        const ancestry = parentLabels.map((label) => String(label || '').trim().toLowerCase()).join(' ');
        if (status === 'archived' || id.startsWith('old-')) {
            return 'archived';
        }
        if (status === 'draft' || status === 'coming-soon' || id.startsWith('dev-')) {
            return 'development';
        }
        if (/\barchive\b/.test(ancestry)) return 'archived';
        if (/\bdevelopment\b/.test(ancestry)) return 'development';
        return 'active';
    }

    function getMapLibraryGroupLabel(group) {
        if (group === 'development') return 'Development maps';
        if (group === 'archived') return 'Archived maps';
        return 'Active maps';
    }

    function captureLibraryReturnContext(previousMode) {
        const mode = workflowModes.has(previousMode) && previousMode !== 'library' ? previousMode : 'hub';
        state.libraryReturnMode = mode;
        state.libraryReturnContext = {
            mapId: state.currentMapId,
            mode,
            selectedFeature: state.selectedFeature ? { ...state.selectedFeature } : null,
            featureType: state.featureListState.type,
            inspectorCollapsed: state.inspectorCollapsed,
            activeTool: state.activeTool
        };
    }

    function restoreLibraryReturnContext() {
        const context = state.libraryReturnContext;
        if (!context || context.mapId !== state.currentMapId) {
            setWorkflowMode(state.libraryReturnMode || 'hub');
            renderMapLayers(true);
            return;
        }
        state.featureListState.type = context.featureType || state.featureListState.type;
        state.selectedFeature = context.selectedFeature ? { ...context.selectedFeature } : null;
        const selectedFeatureStillExists = !state.selectedFeature || Boolean(getSelectedFeature());
        if (!selectedFeatureStillExists) state.selectedFeature = null;
        const mode = context.mode === 'feature-edit' && !state.selectedFeature ? 'feature-browser' : context.mode;
        setWorkflowMode(mode || 'hub');
        setInspectorCollapsed(Boolean(context.inspectorCollapsed), false);
        if (context.activeTool) setActiveTool(context.activeTool, { render: false });
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        queueMapLayout();
    }

    function getFeatureTypeCopy(type = state.featureListState.type) {
        if (type === 'journeys') return { plural: 'Campaign journeys', singular: 'journey', create: 'New journey', summary: 'Record ordered stops, in-universe dates, and campaign memories on this map.' };
        if (type === 'regions') {
            return {
                plural: 'Regions',
                singular: 'region',
                create: 'Draw a new region',
                summary: 'Choose one boundary to edit, or draw a new region on the map.'
            };
        }
        if (type === 'lines') {
            return {
                plural: 'Lines and routes',
                singular: 'line',
                create: 'Draw a new line',
                summary: 'Choose one route to edit, or draw a new line on the map.'
            };
        }
        return {
            plural: 'Points of interest',
            singular: 'point of interest',
            create: 'Add a new point',
            summary: 'Choose one place to edit, or place a new point on the map.'
        };
    }

    function updateMapHome() {
        const currentMap = state.currentMap;
        if (!currentMap) return;
        if (dom.mapHomeTitle) dom.mapHomeTitle.textContent = currentMap.name || currentMap.id;
        if (dom.mapHomeSummary) {
            dom.mapHomeSummary.textContent = currentMap.selectorDescription || currentMap.blurb ||
                'Choose one editing menu. The next screen will contain only that task.';
        }
        if (dom.mapHomeImage) {
            const previewUrl = getMiniMapImageUrl(currentMap.imageUrl);
            dom.mapHomeImage.hidden = !previewUrl;
            if (previewUrl) dom.mapHomeImage.src = previewUrl;
        }
        if (dom.mapHomePointsCount) dom.mapHomePointsCount.textContent = String(getCurrentPoints().length);
        if (dom.mapHomeRegionsCount) dom.mapHomeRegionsCount.textContent = String(getCurrentRegions().length);
        if (dom.mapHomeLinesCount) dom.mapHomeLinesCount.textContent = String(getCurrentLines().length);
    }

    function updateFocusedSaveLabel(mode) {
        if (!dom.saveCurrentMapButton) return;
        if (state.fileMode) {
            dom.saveCurrentMapButton.textContent = state.downloadOnly ? 'Download changes' : 'Save changes';
            return;
        }
        const selected = getSelectedFeature();
        if (mode === 'feature-edit' && selected) {
            dom.saveCurrentMapButton.textContent = `Save ${selected.name || selected.id || 'item'}`;
            return;
        }
        if (mode === 'map-details' || mode === 'map-advanced') {
            dom.saveCurrentMapButton.textContent = `Save ${state.currentMap?.name || 'map'}`;
            return;
        }
        dom.saveCurrentMapButton.textContent = 'Save changes';
    }

    // Safari may suspend animation frames while its window is occluded. Map
    // initialization must still complete; run once via either frame or timer.
    function scheduleMapLayout(callback) {
        let completed = false;
        const run = () => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            callback();
        };
        const timer = setTimeout(run, 100);
        requestAnimationFrame(run);
    }

    function queueMapLayout() {
        scheduleMapLayout(() => state.map?.invalidateSize({ pan: true, animate: false }));
    }

    function syncDmTabs() {
        const mode = dom.appShell.dataset.mode;
        const active = mode === 'library' ? 'library' : ['map-details', 'map-advanced'].includes(mode) ? 'map-details' : 'feature-browser';
        document.querySelectorAll('[data-dm-tab]').forEach(button => {
            button.disabled = button.dataset.dmTab !== 'library' && !state.currentMap;
            if (button.dataset.dmTab === active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        const toggle = document.getElementById('dm-panel-toggle');
        if (toggle) {
            toggle.hidden = mode === 'library';
            toggle.textContent = state.inspectorCollapsed ? 'Show panel' : 'Hide panel';
            toggle.setAttribute('aria-expanded', String(!state.inspectorCollapsed));
        }
    }

    async function startEditingFromReview() {
        if (state.downloadOnly) {
            window.location.href = '/studio/editor' + (state.currentMapId ? `?map=${encodeURIComponent(state.currentMapId)}` : '');
            return;
        }
        const link = dom.accessStudioLink;
        if (link.dataset.pending === 'true') return;
        link.dataset.pending = 'true';
        link.setAttribute('aria-disabled', 'true');
        link.textContent = 'Preparing editor…';
        try {
            const sessionResponse = await fetch('/api/studio/session', { cache: 'no-store' });
            const session = sessionResponse.ok ? await sessionResponse.json() : null;
            if (!session?.authenticated || !session.csrfToken) throw new Error('Your session expired. Open Studio to sign in again.');
            const response = await fetch('/api/studio/workspace', { cache: 'no-store' });
            if (!response.ok) throw new Error('Could not check the editing workspace. Try again.');
            const payload = await response.json();
            let workspace = payload.workspace;
            if (!workspace?.capabilities?.canEdit) {
                if (!workspace?.capabilities?.canStartDraft) throw new Error(workspace?.recovery?.message || 'The workspace needs attention in Studio before editing.');
                const draftResponse = await fetch('/api/studio/drafts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
                    body: JSON.stringify({ title: 'Map updates' })
                });
                const draft = await draftResponse.json();
                if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || 'Could not prepare an editing draft.');
                workspace = draft.workspace;
            }
            if (!workspace?.capabilities?.canEdit) throw new Error('Editing is not available in this workspace.');
            // Explicitly leave review mode only after a writable draft is confirmed.
            window.location.href = '/studio/editor' + (state.currentMapId ? `?map=${encodeURIComponent(state.currentMapId)}` : '');
        } catch (error) {
            dom.accessCopy.textContent = error.message;
            link.textContent = 'Try starting editing again';
            link.dataset.pending = 'false';
            link.removeAttribute('aria-disabled');
        }
    }

    function registerDmTabs() {
        const tabs = [...document.querySelectorAll('[data-dm-tab]')];
        tabs.forEach(button => {
            button.addEventListener('click', () => {
                let target = button.dataset.dmTab;
                if (target === 'feature-browser') target = state.drawMode ? 'draw' : (state.selectedFeature ? 'feature-edit' : 'feature-browser');
                // A tab switch never cancels or commits an unfinished shape.
                setWorkflowMode(target);
                if (target !== 'library') setInspectorCollapsed(false, false);
            });
            button.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                const enabled = tabs.filter(tab => !tab.disabled);
                const index = enabled.indexOf(button);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
                enabled[next].focus();
                event.preventDefault();
            });
        });
        document.getElementById('dm-panel-toggle')?.addEventListener('click', () => setInspectorCollapsed(!state.inspectorCollapsed));
        const newMap = document.getElementById('dm-new-map');
        if (newMap) {
            newMap.hidden = !isStudioHostedPath(window.location.pathname);
            newMap.addEventListener('click', event => { event.preventDefault(); requestExternalNavigation(newMap.href); });
        }
    }

    function setWorkflowMode(mode) {
        const nextMode = mode === 'hub' ? 'map-details' : (workflowModes.has(mode) ? mode : 'library');
        const previousMode = dom.appShell.dataset.mode;
        if (nextMode === 'library' && !state.inspectorCollapsed) {
            setInspectorCollapsed(true, false);
        } else if (nextMode !== 'library' && state.inspectorCollapsed) {
            setInspectorCollapsed(false, false);
        }
        if (nextMode === 'library' && previousMode !== 'library' && state.currentMap) {
            captureLibraryReturnContext(previousMode);
        }
        dom.appShell.dataset.mode = nextMode;
        if (previousMode !== nextMode && dom.workspace) {
            dom.workspace.scrollTop = 0;
            dom.workspace.scrollLeft = 0;
        }
        if (previousMode !== nextMode && dom.inspector) {
            dom.inspector.scrollTop = 0;
        }
        const currentName = state.currentMap?.name || state.currentMapId || 'Choose a map';
        const featureCopy = getFeatureTypeCopy();
        const selected = getSelectedFeature();

        if (dom.chooseMapButton) dom.chooseMapButton.hidden = nextMode === 'library';
        if (dom.mapHomeButton) {
            const canContinueEditing = nextMode === 'library' && state.currentMap && hasUnsavedEditorWork();
            const canOpenMapMenu = Boolean(state.currentMap && !['library', 'hub'].includes(nextMode));
            dom.mapHomeButton.hidden = !canContinueEditing && !canOpenMapMenu;
            const mapHomeLabel = canContinueEditing ? 'Continue editing' : 'Map overview';
            dom.mapHomeButton.textContent = mapHomeLabel;
            dom.mapHomeButton.setAttribute('aria-label', mapHomeLabel);
            dom.mapHomeButton.title = mapHomeLabel;
        }
        const libraryHasActiveEdits = nextMode === 'library' && state.currentMap && hasUnsavedEditorWork();
        if (dom.contextLabel) dom.contextLabel.textContent = libraryHasActiveEdits
            ? 'Unsaved map'
            : (nextMode === 'library' ? 'Map library' : 'Current map');
        if (dom.contextName) dom.contextName.textContent = libraryHasActiveEdits ? currentName : (nextMode === 'library' ? 'All maps' : currentName);
        if (nextMode === 'library' && state.atlasTree.length > 0) renderAtlasTree();

        if (nextMode === 'hub') {
            updateMapHome();
            setActiveTool('pan', { render: false });
            setSelectionStatus('Choose an editing task.');
        } else if (nextMode === 'map-details') {
            setActiveTool('details', { render: false });
            setInspectorTab('overview', false);
            dom.focusEyebrow.textContent = currentName;
            dom.focusTitle.textContent = canMutateWorkspace() ? 'Map & Scale' : 'Review map & scale';
            dom.focusSummary.textContent = canMutateWorkspace()
                ? 'Visitor-facing name, grouping, and descriptions.'
                : 'Visitor-facing map information. Open a writable Studio workspace to change it.';
            dom.collapseInspectorButton.setAttribute('aria-label', 'Hide map properties');
            dom.collapseInspectorButton.title = 'Hide map properties';
            setSelectionStatus('Edit the visitor-facing map details in the panel.');
        } else if (nextMode === 'map-advanced') {
            setActiveTool('advanced', { render: false });
            setInspectorTab('advanced', false);
            dom.focusEyebrow.textContent = currentName;
            dom.focusTitle.textContent = canMutateWorkspace() ? 'Advanced setup' : 'Review map setup';
            dom.focusSummary.textContent = canMutateWorkspace()
                ? 'Artwork, dimensions, calibration, and atlas placement.'
                : 'Artwork, dimensions, calibration, and placement are locked in review-only mode.';
            dom.collapseInspectorButton.setAttribute('aria-label', 'Hide advanced settings');
            dom.collapseInspectorButton.title = 'Hide advanced settings';
            setSelectionStatus('Review atlas placement, artwork, scale, and calibration.');
        } else if (nextMode === 'feature-browser') {
            setActiveTool('features', { render: false });
            setInspectorTab('features', false);
            dom.focusEyebrow.textContent = currentName;
            dom.focusTitle.textContent = featureCopy.plural;
            dom.focusSummary.textContent = featureCopy.summary;
            dom.featureBrowserTitle.textContent = featureCopy.plural;
            dom.featureBrowserSummary.textContent = featureCopy.summary;
            dom.createFeatureButton.textContent = canMutateWorkspace() ? featureCopy.create : 'Editing locked';
            dom.collapseInspectorButton.setAttribute('aria-label', `Hide ${featureCopy.plural.toLowerCase()} panel`);
            dom.collapseInspectorButton.title = `Hide ${featureCopy.plural.toLowerCase()} panel`;
            setSelectionStatus(`Browse ${featureCopy.plural.toLowerCase()} or create a new ${featureCopy.singular}.`);
        } else if (nextMode === 'feature-edit') {
            setActiveTool('select', { render: false });
            setInspectorTab('features', false);
            dom.focusEyebrow.textContent = `${currentName} / ${featureCopy.plural}`;
            dom.focusTitle.textContent = `${canMutateWorkspace() ? 'Edit' : 'Review'} ${selected?.name || selected?.id || featureCopy.singular}`;
            dom.focusSummary.textContent = canMutateWorkspace()
                ? (state.selectedFeature?.mode === 'points'
                    ? 'Edit the fields below. Drag the marker on the map to move this POI.'
                    : (state.selectedFeature?.mode === 'journeys' ? 'Add and reorder stops below. Drag numbered pins to move them.' : 'Edit the fields below. Drag the orange corner handles to reshape this feature.'))
                : `This ${featureCopy.singular} is read-only. You can inspect its content and position.`;
            dom.collapseInspectorButton.setAttribute('aria-label', `Hide ${featureCopy.singular} properties`);
            dom.collapseInspectorButton.title = `Hide ${featureCopy.singular} properties`;
            dom.backToFeatureListButton.textContent = 'Back to list';
            dom.backToFeatureListButton.setAttribute('aria-label', `Back to ${featureCopy.plural.toLowerCase()}`);
            dom.canvasTaskLabel.textContent = selected?.name || selected?.id || 'Position';
            if (dom.toolbarHint) {
                dom.toolbarHint.textContent = canMutateWorkspace()
                    ? (state.selectedFeature?.mode === 'points'
                        ? 'Drag the selected marker to update its position.'
                        : (state.selectedFeature?.mode === 'journeys' ? 'Drag numbered stops to move them. Use Add stop to record the next moment.' : 'Drag the orange vertex handles to reshape the selected geometry.'))
                    : 'Position and geometry are shown for review. Open a writable Studio workspace to move them.';
            }
            queueMapLayout();
        } else if (nextMode === 'draw') {
            setActiveTool(state.drawMode || 'point', { render: false });
            dom.backToFeatureListButton.textContent = 'Cancel drawing';
            dom.backToFeatureListButton.setAttribute('aria-label', `Cancel drawing and return to ${featureCopy.plural.toLowerCase()}`);
            dom.canvasTaskLabel.textContent = `Create ${featureCopy.singular}`;
            if (dom.toolbarHint) {
                dom.toolbarHint.textContent = state.featureListState.type === 'points'
                    ? 'Click the map once to place the new point.'
                    : `Place ${featureCopy.singular} vertices. Select Finish when done.`;
            }
            queueMapLayout();
        }

        if (['map-details', 'map-advanced', 'feature-browser', 'feature-edit', 'draw'].includes(nextMode)) {
            queueMapLayout();
        }
        // Refresh interaction affordances when the active task changes without
        // moving the camera or discarding the selected feature and draft.
        if (previousMode !== nextMode && state.currentMap && state.pointLayer) {
            renderMapLayers(previousMode === 'library' && !state.libraryReturnContext);
        }
        updateFocusedSaveLabel(nextMode);
        syncToolbarState();
        refreshAppMenuState();
        syncDmTabs();
    }

    function setActiveTool(tool, options = {}) {
        const allowedTools = new Set(['select', 'pan', 'point', 'region', 'line', 'features', 'details', 'advanced']);
        const nextTool = allowedTools.has(tool) ? tool : 'select';
        const toolCopy = {
            select: { label: 'Select', shortcut: 'V' },
            pan: { label: 'Move', shortcut: 'H' },
            point: { label: 'Point', shortcut: 'P' },
            region: { label: 'Region', shortcut: 'R' },
            line: { label: 'Route', shortcut: 'L' },
            features: { label: 'Layers', shortcut: '' },
            details: { label: 'Properties', shortcut: '' },
            advanced: { label: 'Setup', shortcut: '' }
        }[nextTool];
        state.activeTool = nextTool;
        dom.appShell.dataset.tool = nextTool;
        dom.toolButtons.forEach((button) => {
            const selected = button.dataset.editorTool === nextTool;
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('active', selected);
        });
        if (dom.activeToolLabel) dom.activeToolLabel.textContent = toolCopy.label;
        if (dom.activeToolShortcut) {
            dom.activeToolShortcut.textContent = toolCopy.shortcut;
            dom.activeToolShortcut.hidden = !toolCopy.shortcut;
        }
        if (state.map?.dragging) {
            if (nextTool === 'pan') state.map.dragging.enable();
            else state.map.dragging.disable();
        }
        if (options.render !== false && state.currentMap) renderMapLayers(false);
    }

    function getAppMenuItems(menuName) {
        const menu = dom.appMenus.find((candidate) => candidate.dataset.appMenu === menuName);
        if (!menu) return [];
        return Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((item) => !item.disabled);
    }

    function closeAppMenus(options = {}) {
        const previousMenu = state.openAppMenu;
        dom.appMenus.forEach((menu) => {
            menu.hidden = true;
        });
        dom.appMenuButtons.forEach((button) => {
            button.setAttribute('aria-expanded', 'false');
        });
        state.openAppMenu = '';
        if (options.restoreFocus && previousMenu) {
            dom.appMenuButtons.find((button) => button.dataset.appMenuTrigger === previousMenu)?.focus();
        }
    }

    function openAppMenu(menuName, focusPosition = '') {
        const menu = dom.appMenus.find((candidate) => candidate.dataset.appMenu === menuName);
        const trigger = dom.appMenuButtons.find((candidate) => candidate.dataset.appMenuTrigger === menuName);
        if (!menu || !trigger) return;
        closeAppMenus();
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        state.openAppMenu = menuName;
        if (focusPosition) {
            const items = getAppMenuItems(menuName);
            const target = focusPosition === 'last' ? items.at(-1) : items[0];
            target?.focus();
        }
    }

    function toggleAppMenu(menuName) {
        if (state.openAppMenu === menuName) {
            closeAppMenus({ restoreFocus: true });
            return;
        }
        openAppMenu(menuName);
    }

    function refreshAppMenuState() {
        const hasMap = Boolean(state.currentMap);
        if (dom.menuSaveButton) dom.menuSaveButton.disabled = !hasMap || !state.editorDirty || !state.localSaveAvailable || Boolean(getIncompleteFeature()) || hasUnfinishedGeometryDraft() || state.saveInProgress;
        if (dom.menuPropertiesButton) dom.menuPropertiesButton.disabled = !hasMap;
        if (dom.menuAdvancedButton) dom.menuAdvancedButton.disabled = !hasMap;
        if (dom.menuFitButton) dom.menuFitButton.disabled = !hasMap || !state.currentBounds;
        if (dom.menuPanButton) dom.menuPanButton.disabled = !hasMap;
        if (dom.menuInspectorButton) {
            dom.menuInspectorButton.disabled = !hasMap || dom.appShell.dataset.mode === 'draw';
            const label = dom.menuInspectorButton.querySelector('span');
            if (label) label.textContent = state.inspectorCollapsed ? 'Show properties' : 'Hide properties';
        }
    }

    async function runAppMenuAction(action) {
        if (action === 'save') {
            if (!dom.saveCurrentMapButton.disabled) await saveCurrentMapJson();
        } else if (action === 'all-maps') {
            setWorkflowMode('library');
        } else if (action === 'export') {
            openExportDialog();
        } else if (action === 'undo') {
            undoEditorChange();
        } else if (action === 'redo') {
            redoEditorChange();
        } else if (action === 'properties' && state.currentMap) {
            setInspectorCollapsed(false);
            setWorkflowMode('map-details');
        } else if (action === 'advanced' && state.currentMap) {
            setInspectorCollapsed(false);
            setWorkflowMode('map-advanced');
        } else if (action === 'fit' && state.currentBounds) {
            queueMapViewportReset();
            setSelectionStatus('Fit the map artwork to the canvas.');
        } else if (action === 'pan' && state.currentMap) {
            setActiveTool('pan');
            setSelectionStatus('Move tool active. Drag the canvas to pan; use the wheel or controls to zoom.');
        } else if (action === 'inspector' && state.currentMap) {
            setInspectorCollapsed(!state.inspectorCollapsed);
        }
        closeAppMenus({ restoreFocus: action !== 'export' });
    }

    function openExportDialog() {
        if (!dom.exportDialog || dom.exportDialog.open) return;
        closeAppMenus();
        syncToolbarState();
        dom.exportDialog.showModal();
    }

    function closeExportDialog() {
        if (dom.exportDialog?.open) dom.exportDialog.close();
    }

    function openFeatureBrowser(type) {
        state.placingJourneyStop = false;
        state.featureListState.type = ['points', 'regions', 'lines', 'journeys'].includes(type) ? type : 'points';
        state.featureListState.searchQuery = '';
        state.featureListState.expanded = false;
        if (dom.featureTypeSelect) dom.featureTypeSelect.value = state.featureListState.type;
        if (dom.featureSearchInput) dom.featureSearchInput.value = '';
        state.selectedFeature = null;
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        setInspectorCollapsed(false);
        setWorkflowMode('feature-browser');
    }

    function startFocusedFeatureCreation() {
        if (!canMutateWorkspace()) {
            setSelectionStatus('Editing is locked. Start or open a writable workspace in Studio.');
            return;
        }
        const type = state.featureListState.type;
        if (type === 'journeys') { createJourney(); return; }
        setWorkflowMode('draw');
        beginDrawMode(type === 'points' ? 'point' : (type === 'regions' ? 'region' : 'line'));
    }

    function setLoadingStage(title, copy) {
        if (dom.loadingTitle) dom.loadingTitle.textContent = title;
        if (dom.loadingCopy) dom.loadingCopy.textContent = copy;
    }

    function setSelectionStatus(message) {
        dom.selectionStatus.textContent = message;
    }

    function updateZoomStatus() {
        if (!dom.zoomStatus || !state.map || typeof state.map.getZoom !== 'function') return;
        const zoom = Number(state.map.getZoom());
        const percentage = Number.isFinite(zoom) ? Math.round((2 ** zoom) * 100) : 100;
        dom.zoomStatus.value = `${percentage}%`;
        dom.zoomStatus.textContent = `${percentage}%`;
        dom.zoomStatus.title = `Canvas zoom: ${percentage}%`;
    }

    function setExportStatus(message, isError = false) {
        dom.exportStatus.textContent = message;
        dom.exportStatus.style.color = isError ? '#dc2626' : '';
        state.saveError = Boolean(isError);
        refreshSaveControls();
    }

    function refreshSaveControls() {
        if (!dom.saveBar) return;
        const incompleteFeature = state.currentMap ? getIncompleteFeature() : null;
        const unfinishedDraft = hasUnfinishedGeometryDraft();
        let saveState = 'clean';
        let chip = 'Saved';
        let title = 'All changes saved';

        if (state.saveInProgress) {
            saveState = 'saving';
            chip = 'Saving';
            title = 'Validating and saving both files';
        } else if (state.saveError) {
            saveState = 'error';
            chip = 'Attention';
            title = 'The last action needs attention';
        } else if (!state.currentMap) {
            saveState = 'clean';
            chip = 'No map';
            title = 'Choose a map to begin editing';
        } else if (unfinishedDraft) {
            saveState = 'dirty';
            chip = 'Drawing';
            title = `Finish or cancel the current ${state.drawMode} before saving`;
        } else if (state.editorDirty) {
            saveState = 'dirty';
            chip = 'Unsaved';
            const currentName = state.currentMap?.name || state.currentMapId || 'this map';
            title = incompleteFeature
                ? `Complete the new feature on ${currentName} before saving`
                : (state.localSaveAvailable
                    ? `Unsaved changes to ${currentName}`
                    : 'Changes are unsaved; start a Studio draft to save them');
        } else if (!state.localSaveAvailable) {
            saveState = 'locked';
            chip = 'Read only';
            title = 'Start a Studio draft to enable saving';
        }

        if (state.downloadOnly && !state.editorDirty && !unfinishedDraft && !state.saveError && !state.saveInProgress) {
            chip = 'Browser copy';
            title = state.hasDownloaded ? 'Download requested' : 'Editing a browser copy';
        }
        dom.saveBar.dataset.state = saveState;
        dom.appShell.dataset.dirty = String(hasUnsavedEditorWork());
        dom.saveStateChip.textContent = chip;
        dom.saveStateTitle.textContent = title;

        const canSaveWorkspace = Boolean(
            state.localSaveAvailable &&
            state.currentMap &&
            state.editorDirty &&
            !incompleteFeature &&
            !unfinishedDraft &&
            !state.saveInProgress
        );
        dom.saveCurrentMapButton.disabled = !canSaveWorkspace;
        dom.saveCurrentMapButton.setAttribute('aria-disabled', String(!canSaveWorkspace));
        dom.saveCurrentMapButton.title = canSaveWorkspace
            ? 'Save the current map and atlas structure together.'
            : (unfinishedDraft
                ? 'Finish or cancel the current drawing before saving.'
                : (incompleteFeature ? 'Give the new feature an intentional name before saving.' : (state.localSaveMessage || title)));

        const canSaveAtlas = Boolean(state.localSaveAvailable && !incompleteFeature && !unfinishedDraft && !state.saveInProgress);
        dom.saveAtlasStructureButton.disabled = !canSaveAtlas;
        dom.saveAtlasStructureButton.setAttribute('aria-disabled', String(!canSaveAtlas));

        if (dom.appShell.dataset.mode === 'library' && dom.mapHomeButton) {
            dom.mapHomeButton.hidden = !state.currentMap || !hasUnsavedEditorWork();
            dom.mapHomeButton.textContent = 'Continue editing';
        }
        refreshAppMenuState();
    }

    const publishReadinessItems = [
        ['saveServer', 'Save server connected'],
        ['currentMapSaved', 'Editor changes saved'],
        ['atlasRegenerated', 'Atlas regenerated'],
        ['dataValidation', 'Data validation passed'],
        ['pagesBundle', 'Pages bundle built']
    ];

    function getReadinessItem(key) {
        if (!state.publishReadiness.items[key]) {
            state.publishReadiness.items[key] = {
                status: 'pending',
                detail: 'Not checked.'
            };
        }
        return state.publishReadiness.items[key];
    }

    function setReadinessItem(key, status, detail = '') {
        state.publishReadiness.items[key] = {
            status,
            detail: String(detail || '').trim()
        };
        renderPublishReadiness();
    }

    function getReadinessStateLabel(status) {
        if (status === 'pass') return 'Pass';
        if (status === 'warn') return 'Warning';
        if (status === 'fail') return 'Fail';
        if (status === 'running') return 'Running';
        return 'Pending';
    }

    function getPublishTopStatus() {
        const statuses = publishReadinessItems.map(([key]) => getReadinessItem(key).status);
        if (statuses.includes('fail')) return 'Failed';
        if (hasUnsavedEditorWork() || getReadinessItem('currentMapSaved').status === 'warn') return 'Needs Save';
        if (getReadinessItem('pagesBundle').status !== 'pass') return 'Needs Build';
        return 'Ready';
    }

    function getPublishSummary(topStatus) {
        if (topStatus === 'Ready') return 'Preview is current and ready to inspect.';
        if (topStatus === 'Needs Save') return 'Save the current map before rebuilding its preview.';
        if (topStatus === 'Needs Build') return 'Build a fresh preview after saving.';
        return 'Open Studio for validation and repository details.';
    }

    function renderBuildProgress() {
        if (!dom.publishBuildProgress) return;
        const job = state.publishReadiness.buildJob;
        dom.publishBuildProgress.hidden = !job;
        dom.publishBuildProgress.textContent = '';
        if (!job) return;

        const title = document.createElement('strong');
        title.textContent = job.status === 'complete'
            ? 'Live preview ready'
            : (job.status === 'failed' ? 'Preview build failed' : `Building: ${job.step || 'Queued'}`);

        const steps = document.createElement('ol');
        (job.steps || []).forEach((step) => {
            const row = document.createElement('li');
            row.textContent = `${getReadinessStateLabel(step.status)}: ${step.label}`;
            steps.appendChild(row);
        });

        dom.publishBuildProgress.append(title, steps);
        const recentOutput = Array.isArray(job.recentOutput) ? job.recentOutput.slice(-2).join(' ') : '';
        if (recentOutput) {
            const output = document.createElement('span');
            output.textContent = recentOutput;
            dom.publishBuildProgress.appendChild(output);
        }
    }

    function renderPublishReadiness() {
        const topStatus = getPublishTopStatus();
        state.publishReadiness.topStatus = topStatus;
        if (dom.publishReadinessChip) {
            dom.publishReadinessChip.textContent = topStatus;
        }
        if (dom.publishReadinessTitle) dom.publishReadinessTitle.textContent = topStatus;
        if (dom.publishReadinessSummary) dom.publishReadinessSummary.textContent = getPublishSummary(topStatus);
        renderBuildProgress();

        if (dom.livePreviewLink) {
            const previewReady = Boolean(state.publishReadiness.previewUrl && !hasUnsavedEditorWork());
            dom.livePreviewLink.hidden = !previewReady;
            dom.livePreviewLink.setAttribute('aria-disabled', String(!previewReady));
            dom.livePreviewLink.tabIndex = previewReady ? 0 : -1;
            if (previewReady) {
                dom.livePreviewLink.href = state.publishReadiness.previewUrl;
            }
        }
        if (dom.exportOpenPreviewLink) {
            const previewReady = Boolean(state.publishReadiness.previewUrl && !hasUnsavedEditorWork());
            dom.exportOpenPreviewLink.hidden = !previewReady;
            dom.exportOpenPreviewLink.href = state.publishReadiness.previewUrl || '/preview/';
            dom.exportOpenPreviewLink.setAttribute('aria-disabled', String(!previewReady));
            dom.exportOpenPreviewLink.tabIndex = previewReady ? 0 : -1;
            if (dom.exportPreviewCommandStatus) {
                const needsSave = topStatus === 'Needs Save';
                dom.exportPreviewCommandStatus.textContent = previewReady
                    ? 'Ready'
                    : (needsSave ? 'Save first' : 'Build first');
                dom.exportPreviewCommandStatus.dataset.state = previewReady ? 'ready' : 'blocked';
            }
        }
        if (dom.exportReadiness) {
            dom.exportReadiness.textContent = hasUnfinishedGeometryDraft()
                ? 'Finish or cancel the drawing first. Unfinished vertices are omitted from saved JSON.'
                : (topStatus === 'Ready'
                    ? 'Preview is built and ready to inspect.'
                    : (topStatus === 'Needs Save'
                        ? 'Save current changes before building the preview.'
                        : (topStatus === 'Needs Build'
                            ? 'The preview needs a fresh build.'
                            : 'Resolve the readiness issue before previewing.')));
            dom.exportReadiness.dataset.state = topStatus.toLowerCase().replace(/\s+/g, '-');
        }
        refreshBuildPreviewButtonState();
    }

    function applyServerReadiness(readiness) {
        if (!readiness || typeof readiness !== 'object') return;
        if (readiness.fileMode) state.fileMode = true;
        state.publishReadiness.serverTopStatus = String(readiness.topStatus || '').trim();

        const bundle = readiness.pagesBundle || {};
        if (bundle.built) {
            if (bundle.stale || hasUnsavedEditorWork()) {
                state.publishReadiness.previewUrl = '';
            } else if (!state.publishReadiness.previewUrl) {
                state.publishReadiness.previewUrl = '/preview/';
            }
            setReadinessItem(
                'pagesBundle',
                bundle.stale ? 'warn' : 'pass',
                bundle.stale
                    ? `Built, but dist/ does not match live source (${bundle.fileCount || 0} files).`
                    : `Built (${bundle.fileCount || 0} files).`
            );
        } else {
            state.publishReadiness.previewUrl = '';
            setReadinessItem('pagesBundle', 'warn', 'dist/ has not been built.');
        }
        renderPublishReadiness();
    }

    function invalidateLivePreview() {
        state.publishReadiness.previewUrl = '';
        renderPublishReadiness();
    }

    function markCurrentMapDirty(detail = 'Unsaved editor changes.') {
        if (!state.currentMap || !canMutateWorkspace()) return;
        state.editorDirty = true;
        state.saveError = false;
        invalidateLivePreview();
        dom.exportStatus.textContent = detail;
        dom.exportStatus.style.color = '';
        setReadinessItem('currentMapSaved', 'warn', detail);
        refreshSaveControls();
        persistRecoverySnapshot();
    }

    function markGeometryDraftUnsaved() {
        if (!state.currentMap || !canMutateWorkspace() || !hasUnfinishedGeometryDraft()) return;
        state.saveError = false;
        invalidateLivePreview();
        dom.exportStatus.textContent = `Unfinished ${state.drawMode} drawing has not been saved.`;
        dom.exportStatus.style.color = '';
        setReadinessItem('currentMapSaved', 'warn', `Finish or cancel the current ${state.drawMode} drawing.`);
        refreshSaveControls();
        persistRecoverySnapshot();
    }

    function getWorkspaceFingerprint() {
        if (!state.currentMap) return '';
        return JSON.stringify({
            atlasTree: state.atlasTree,
            currentMapId: state.currentMapId,
            currentMapDataUrl: state.currentMapDataUrl,
            lineCollectionKey: state.lineCollectionKey
        });
    }

    function stableJsonValue(value) {
        if (Array.isArray(value)) return value.map(stableJsonValue);
        if (!value || typeof value !== 'object') return value;
        return Object.keys(value).sort().reduce((result, key) => {
            const nextValue = value[key];
            if (nextValue !== undefined) result[key] = stableJsonValue(nextValue);
            return result;
        }, Object.create(null));
    }

    function serializePreservedManifest(options) {
        const edited = utils.serializeFlatManifestState(options);
        if (!fileDocuments || !state.manifestSnapshots || !state.manifestSource) return edited;
        const entries = edited.map(entry => {
            const snapshot = state.manifestSnapshots[entry.id];
            return snapshot ? fileDocuments.buildDocument(snapshot, entry) : entry;
        });
        if (Array.isArray(state.manifestSource)) return entries;
        return { ...utils.cloneJson(state.manifestSource), maps: entries };
    }

    function serializePreservedMap(options) {
        const edited = utils.serializeMapDocumentState(options);
        // Shared normalization strips section metadata. Carry the DM session's
        // stable row identities through to the lossless document merger.
        if (state.fileSnapshot) {
            const key = state.fileSnapshot.identityKey;
            const sourcePoints = options.collectedPoints || [];
            (edited.pointsOfInterest || []).forEach(point => {
                const source = sourcePoints.find(candidate => candidate[key] && candidate[key] === point[key]);
                if (source && Array.isArray(source.detailSections)) point.detailSections = utils.cloneJson(source.detailSections);
            });
        }
        return fileDocuments && state.fileSnapshot
            ? fileDocuments.buildDocument(state.fileSnapshot, edited)
            : edited;
    }

    function captureFileBaseline(rawDocument) {
        if (!fileDocuments || !rawDocument || !state.currentMap) return;
        const normalized = utils.serializeMapDocumentState({
            masterMapData: state.atlasTree, currentMapId: state.currentMap.id,
            collectedPoints: getCurrentPoints(), collectedRegions: getCurrentRegions(),
            collectedLines: getCurrentLines(), lineCollectionKey: state.lineCollectionKey,
            mapSettings: readMapSettingsForm()
        });
        // The serializer sorts collections. Identity assignment requires source order.
        normalized.pointsOfInterest = getCurrentPoints().map(utils.normalizePoint);
        normalized.regions = getCurrentRegions().map(utils.normalizeRegion);
        normalized[state.lineCollectionKey] = getCurrentLines().map(utils.normalizeLine);
        const session = fileDocuments.createSession(rawDocument, normalized);
        state.fileSnapshot = session.snapshot;
        for (const key of ['pointsOfInterest', 'regions', state.lineCollectionKey, 'journeys']) {
            state.currentMap[key] = session.editableDocument[key];
        }
    }

    function getCanonicalRecoveryBaseline() {
        if (!state.currentMap) return '';
        const mapSettings = readMapSettingsForm();
        const mapDocument = serializePreservedMap({
            masterMapData: state.atlasTree,
            currentMapId: state.currentMap.id,
            collectedPoints: getCurrentPoints(),
            collectedRegions: getCurrentRegions(),
            collectedLines: getCurrentLines(),
            lineCollectionKey: state.lineCollectionKey,
            mapSettings
        });
        const atlasDocument = serializePreservedManifest({
            masterMapData: state.atlasTree,
            currentMapId: state.currentMap.id,
            mapSettings
        });
        return JSON.stringify(stableJsonValue({ mapDocument, atlasDocument }));
    }

    function recordSavedWorkspaceBaseline(options = {}) {
        if (options.clearRecovery) clearRecoverySnapshot();
        state.savedWorkspaceFingerprint = getWorkspaceFingerprint();
        const recoveryBaseline = getCanonicalRecoveryBaseline();
        state.recoveryBaselineHash = hashRecoveryValue(recoveryBaseline);
        state.recoveryBaselineLength = recoveryBaseline.length;
        state.savedWorkspaceSnapshot = captureEditorSnapshot();
        state.editorDirty = false;
    }

    function reconcileCurrentMapDirty(detail = 'Editor changes restored.') {
        if (!state.currentMap) return;
        state.editorDirty = !state.savedWorkspaceFingerprint ||
            getWorkspaceFingerprint() !== state.savedWorkspaceFingerprint;
        state.saveError = false;
        dom.exportStatus.style.color = '';
        if (state.editorDirty) {
            invalidateLivePreview();
            dom.exportStatus.textContent = detail;
            setReadinessItem('currentMapSaved', 'warn', detail);
        } else {
            dom.exportStatus.textContent = 'All changes are saved.';
            setReadinessItem('currentMapSaved', 'pass', 'No unsaved editor changes.');
        }
        refreshSaveControls();
        refreshBuildPreviewButtonState();
        if (hasUnsavedEditorWork()) persistRecoverySnapshot();
        else clearRecoverySnapshot();
    }

    function hashRecoveryValue(value) {
        let hash = 2166136261;
        const source = String(value || '');
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function getRecoveryStorageKey() {
        if (!state.currentMapId || !state.recoveryWorkspaceId) return '';
        return `${RECOVERY_STORAGE_PREFIX}:${hashRecoveryValue(state.recoveryWorkspaceId)}:${encodeURIComponent(state.currentMapId)}`;
    }

    function clearRecoverySnapshot() {
        const keys = new Set([state.recoveryStorageKey, getRecoveryStorageKey()].filter(Boolean));
        keys.forEach((key) => {
            try {
                window.sessionStorage.removeItem(key);
            } catch (error) {
                // Storage can be unavailable in hardened browser contexts.
            }
        });
        state.recoveryStorageKey = '';
    }

    function captureAtlasStructure(items) {
        if (!Array.isArray(items)) return [];
        return items.map((item) => {
            if (!item || typeof item !== 'object') return item;
            const next = {};
            Object.entries(item).forEach(([key, value]) => {
                if (RECOVERY_FEATURE_KEYS.has(key)) return;
                next[key] = key === 'children'
                    ? captureAtlasStructure(value)
                    : utils.cloneJson(value);
            });
            return next;
        });
    }

    function captureFormValues(form) {
        if (!form) return [];
        return Array.from(form.querySelectorAll('[data-field]')).map((control) => ({
            field: String(control.dataset.field || ''),
            detailSectionField: String(control.dataset.detailSectionField || ''),
            detailSectionRow: String(control.closest('[data-detail-section-row]')?.dataset.detailSectionRow || ''),
            value: String(control.value || ''),
            ...(control.type === 'checkbox' ? { checked: control.checked } : {})
        }));
    }

    function restoreFormValues(form, values) {
        if (!form || !Array.isArray(values)) return;
        values.forEach((entry) => {
            const controls = Array.from(form.querySelectorAll('[data-field]'))
                .filter((candidate) => candidate.dataset.field === String(entry.field || ''));
            const control = controls.find((candidate) => {
                if (!entry.detailSectionField) return !candidate.dataset.detailSectionField;
                return candidate.dataset.detailSectionField === entry.detailSectionField &&
                    String(candidate.closest('[data-detail-section-row]')?.dataset.detailSectionRow || '') === entry.detailSectionRow;
            });
            if (control) {
                control.value = String(entry.value || '');
                if (control.type === 'checkbox' && typeof entry.checked === 'boolean') control.checked = entry.checked;
            }
        });
    }

    function captureRecoverySnapshot() {
        if (!state.currentMap || !hasUnsavedEditorWork() || !state.savedWorkspaceFingerprint || !state.recoveryBaselineHash || !state.recoveryBaselineLength) return null;
        const currentMap = utils.cloneJson(state.currentMap);
        delete currentMap.children;
        return {
            version: RECOVERY_VERSION,
            fileSnapshot: state.fileSnapshot ? utils.cloneJson(state.fileSnapshot) : null,
            manifestSource: state.manifestSource ? utils.cloneJson(state.manifestSource) : null,
            manifestSnapshots: state.manifestSnapshots ? utils.cloneJson(state.manifestSnapshots) : null,
            savedAt: Date.now(),
            workspaceId: state.recoveryWorkspaceId,
            baselineHash: state.recoveryBaselineHash,
            baselineLength: state.recoveryBaselineLength,
            currentMapId: state.currentMapId,
            currentMapDataUrl: state.currentMapDataUrl,
            lineCollectionKey: state.lineCollectionKey,
            editorDirty: state.editorDirty,
            drawMode: hasUnfinishedGeometryDraft() ? state.drawMode : '',
            draftCoordinates: hasUnfinishedGeometryDraft() ? utils.cloneJson(state.draftCoordinates) : [],
            draftHandles: utils.cloneJson(state.draftHandles || []),
            selectedVertexIndex: state.selectedVertexIndex,
            mode: dom.appShell.dataset.mode,
            libraryReturnMode: state.libraryReturnMode,
            selectedFeature: state.selectedFeature ? { ...state.selectedFeature } : null,
            featureListState: { ...state.featureListState },
            atlasStructure: captureAtlasStructure(state.atlasTree),
            currentMap,
            mapFormValues: captureFormValues(dom.mapSettingsForm),
            featureFormValues: captureFormValues(dom.featureForm)
        };
    }

    function persistRecoverySnapshot() {
        if (!canMutateWorkspace()) return false;
        const snapshot = captureRecoverySnapshot();
        const storageKey = getRecoveryStorageKey();
        if (!snapshot || !storageKey) return false;
        try {
            const serialized = JSON.stringify(snapshot);
            if (serialized.length > RECOVERY_MAX_BYTES) {
                window.sessionStorage.removeItem(storageKey);
                state.recoveryStorageKey = '';
                return false;
            }
            window.sessionStorage.setItem(storageKey, serialized);
            state.recoveryStorageKey = storageKey;
            return true;
        } catch (error) {
            return false;
        }
    }

    function restoreSavedWorkspaceBaseline() {
        const snapshot = state.savedWorkspaceSnapshot;
        if (!snapshot || !Array.isArray(snapshot.atlasTree)) return false;
        clearDrawMode();
        state.atlasTree = utils.cloneJson(snapshot.atlasTree);
        state.currentMapId = snapshot.currentMapId;
        state.currentMapDataUrl = snapshot.currentMapDataUrl;
        state.lineCollectionKey = snapshot.lineCollectionKey;
        state.currentMap = utils.findMapRecursive(state.atlasTree, state.currentMapId);
        state.selectedFeature = null;
        state.editorDirty = false;
        editHistory.clear();
        renderAtlasTree();
        renderMapSettingsForm();
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        setReadinessItem('currentMapSaved', 'pass', 'Discarded unsaved changes.');
        refreshSaveControls();
        clearRecoverySnapshot();
        return true;
    }

    function isRecoverySnapshotValid(snapshot) {
        const recoveredDrawMode = String(snapshot?.drawMode || '');
        const recoveredDraftCoordinates = Array.isArray(snapshot?.draftCoordinates) ? snapshot.draftCoordinates : [];
        const hasRecoveredDraft = Boolean(recoveredDrawMode && recoveredDraftCoordinates.length > 0);
        const draftIsValid = (!recoveredDrawMode && recoveredDraftCoordinates.length === 0) ||
            (['region', 'line'].includes(recoveredDrawMode) && recoveredDraftCoordinates.every((coordinate) => (
                Array.isArray(coordinate) && coordinate.length >= 2 &&
                Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1]))
            )));
        return Boolean(
            snapshot?.version === RECOVERY_VERSION &&
            snapshot.workspaceId === state.recoveryWorkspaceId &&
            snapshot.currentMapId === state.currentMapId &&
            snapshot.baselineHash === state.recoveryBaselineHash &&
            snapshot.baselineLength === state.recoveryBaselineLength &&
            Number.isFinite(snapshot.savedAt) &&
            snapshot.savedAt > 0 && snapshot.savedAt <= Date.now() &&
            Date.now() - snapshot.savedAt <= RECOVERY_MAX_AGE_MS &&
            Array.isArray(snapshot.atlasStructure) &&
            snapshot.currentMap && typeof snapshot.currentMap === 'object' &&
            !Array.isArray(snapshot.currentMap) && snapshot.currentMap.id === state.currentMapId &&
            draftIsValid &&
            (snapshot.editorDirty !== false || hasRecoveredDraft)
        );
    }

    function restoreRecoverySnapshot() {
        if (!canMutateWorkspace() || !state.currentMap || !state.savedWorkspaceFingerprint) return false;
        const storageKey = getRecoveryStorageKey();
        if (!storageKey) return false;
        let snapshot = null;
        try {
            const serialized = window.sessionStorage.getItem(storageKey);
            if (!serialized || serialized.length > RECOVERY_MAX_BYTES) return false;
            snapshot = JSON.parse(serialized);
        } catch (error) {
            clearRecoverySnapshot();
            return false;
        }
        if (!isRecoverySnapshotValid(snapshot)) {
            clearRecoverySnapshot();
            return false;
        }

        if (snapshot.fileSnapshot && fileDocuments) state.fileSnapshot = utils.cloneJson(snapshot.fileSnapshot);
        if (snapshot.manifestSource && snapshot.manifestSnapshots && fileDocuments) {
            state.manifestSource = utils.cloneJson(snapshot.manifestSource);
            state.manifestSnapshots = utils.cloneJson(snapshot.manifestSnapshots);
        }
        const structureNode = utils.findMapRecursive(snapshot.atlasStructure, state.currentMapId);
        if (!structureNode) {
            clearRecoverySnapshot();
            return false;
        }
        const recoveredMap = {
            ...utils.cloneJson(snapshot.currentMap),
            dataUrl: structureNode.dataUrl || state.currentMapDataUrl
        };
        if (Array.isArray(structureNode.children)) recoveredMap.children = structureNode.children;
        state.atlasTree = replaceNodeById(snapshot.atlasStructure, state.currentMapId, recoveredMap);
        state.currentMap = utils.findMapRecursive(state.atlasTree, state.currentMapId);
        state.currentMapDataUrl = String(snapshot.currentMapDataUrl || state.currentMapDataUrl);
        state.lineCollectionKey = String(snapshot.lineCollectionKey || state.lineCollectionKey);
        state.featureListState = { ...state.featureListState, ...(snapshot.featureListState || {}) };
        state.selectedFeature = snapshot.selectedFeature ? { ...snapshot.selectedFeature } : null;
        state.libraryReturnMode = workflowModes.has(snapshot.libraryReturnMode) ? snapshot.libraryReturnMode : 'hub';
        state.editorDirty = snapshot.editorDirty !== false;
        state.drawMode = ['region', 'line'].includes(snapshot.drawMode) ? snapshot.drawMode : '';
        state.draftCoordinates = state.drawMode && Array.isArray(snapshot.draftCoordinates)
            ? utils.cloneJson(snapshot.draftCoordinates)
            : [];
        // Preserve the outline of drafts made with the old all-corners option.
        if (snapshot.draftRounded === true) state.draftCoordinates = utils.roundGeometryCorners(state.draftCoordinates, state.drawMode === 'region');
        state.draftHandles = utils.normalizeBezierHandles(state.draftCoordinates, snapshot.draftHandles);
        state.selectedVertexIndex = Number.isInteger(snapshot.selectedVertexIndex) ? snapshot.selectedVertexIndex : state.draftCoordinates.length - 1;
        renderAtlasTree();
        renderMapSettingsForm();
        renderFeatureLists();
        renderFeatureInspector();
        setWorkflowMode(hasUnfinishedGeometryDraft()
            ? 'draw'
            : (workflowModes.has(snapshot.mode) ? snapshot.mode : 'hub'));
        restoreFormValues(dom.mapSettingsForm, snapshot.mapFormValues);
        restoreFormValues(dom.featureForm, snapshot.featureFormValues);
        renderMapLayers(false);
        state.recoveryStorageKey = storageKey;
        invalidateLivePreview();
        const recoveryMessage = hasUnfinishedGeometryDraft()
            ? `Recovered an unfinished ${state.drawMode} drawing from this tab.`
            : 'Recovered unsaved changes from this tab.';
        setReadinessItem('currentMapSaved', 'warn', recoveryMessage);
        setExportStatus(recoveryMessage);
        refreshSaveControls();
        return true;
    }

    function captureEditorSnapshot() {
        if (!state.currentMap) return null;
        return {
            atlasTree: utils.cloneJson(state.atlasTree),
            currentMapId: state.currentMapId,
            currentMapDataUrl: state.currentMapDataUrl,
            lineCollectionKey: state.lineCollectionKey,
            selectedFeature: state.selectedFeature ? { ...state.selectedFeature } : null,
            featureListState: { ...state.featureListState }
        };
    }

    function syncHistoryControls() {
        const historyState = editHistory.getState();
        const writable = canMutateWorkspace();
        if (dom.undoButton) {
            dom.undoButton.disabled = !writable || !historyState.canUndo;
            dom.undoButton.title = !writable ? 'Editing is locked in review-only mode.' : (historyState.canUndo ? `Undo ${historyState.undoLabel}` : 'Nothing to undo');
        }
        if (dom.menuUndoButton) {
            dom.menuUndoButton.disabled = !writable || !historyState.canUndo;
            const label = dom.menuUndoButton.querySelector('span');
            if (label) label.textContent = historyState.canUndo ? `Undo ${historyState.undoLabel}` : 'Undo';
        }
        if (dom.redoButton) {
            dom.redoButton.disabled = !writable || !historyState.canRedo;
            dom.redoButton.title = !writable ? 'Editing is locked in review-only mode.' : (historyState.canRedo ? `Redo ${historyState.redoLabel}` : 'Nothing to redo');
        }
        if (dom.menuRedoButton) {
            dom.menuRedoButton.disabled = !writable || !historyState.canRedo;
            const label = dom.menuRedoButton.querySelector('span');
            if (label) label.textContent = historyState.canRedo ? `Redo ${historyState.redoLabel}` : 'Redo';
        }
    }

    function checkpointHistory(label) {
        if (!canMutateWorkspace()) return false;
        const snapshot = captureEditorSnapshot();
        if (!snapshot) return false;
        const recorded = editHistory.record(snapshot, label);
        syncHistoryControls();
        return recorded;
    }

    function restoreEditorSnapshot(snapshot, actionLabel) {
        if (!snapshot || !Array.isArray(snapshot.atlasTree)) return;
        clearDrawMode();
        state.atlasTree = utils.cloneJson(snapshot.atlasTree);
        state.currentMapId = String(snapshot.currentMapId || '');
        state.currentMapDataUrl = String(snapshot.currentMapDataUrl || '');
        state.lineCollectionKey = String(snapshot.lineCollectionKey || 'lines');
        state.featureListState = {
            ...state.featureListState,
            ...(snapshot.featureListState || {})
        };
        state.currentMap = utils.findMapRecursive(state.atlasTree, state.currentMapId);
        state.selectedFeature = snapshot.selectedFeature ? { ...snapshot.selectedFeature } : null;
        renderAtlasTree();
        renderMapSettingsForm();
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        if (state.selectedFeature) setInspectorTab('features');
        reconcileCurrentMapDirty(actionLabel);
        syncHistoryControls();
    }

    function undoEditorChange() {
        if (!canMutateWorkspace()) return;
        const result = editHistory.undo(captureEditorSnapshot());
        if (!result) return;
        restoreEditorSnapshot(result.snapshot, `Undid ${result.label}.`);
    }

    function redoEditorChange() {
        if (!canMutateWorkspace()) return;
        const result = editHistory.redo(captureEditorSnapshot());
        if (!result) return;
        restoreEditorSnapshot(result.snapshot, `Redid ${result.label}.`);
    }

    function refreshBuildPreviewButtonState() {
        if (!dom.buildLivePreviewButton) return;
        const runningBuild = state.publishReadiness.buildJob?.status === 'running';
        const disabled = state.downloadOnly || !state.localSaveAvailable || hasUnsavedEditorWork() || runningBuild;
        dom.buildLivePreviewButton.disabled = disabled;
        let title = 'Build dist/ and preview the exact Pages bundle.';
        if (!state.localSaveAvailable) {
            title = state.localSaveMessage || 'Run npm run editor to enable preview builds.';
        }
        else if (hasUnfinishedGeometryDraft()) title = 'Finish or cancel the current drawing before building preview.';
        else if (state.editorDirty) title = 'Save current map changes before building preview.';
        else if (runningBuild) title = 'Preview build is running.';
        dom.buildLivePreviewButton.title = title;
        dom.buildLivePreviewButton.setAttribute('aria-disabled', String(disabled));
        if (dom.exportBuildPreviewButton) {
            dom.exportBuildPreviewButton.disabled = disabled;
            dom.exportBuildPreviewButton.title = title;
            dom.exportBuildPreviewButton.setAttribute('aria-disabled', String(disabled));
        }
    }

    function setLocalSaveAvailability(available, message = '') {
        state.localSaveAvailable = Boolean(available) && !state.reviewOnlyRequested;
        state.localSaveMessage = state.reviewOnlyRequested
            ? 'This review link is intentionally read-only.'
            : String(message || '').trim();
        syncEditingAvailability();
        refreshSaveControls();
        refreshBuildPreviewButtonState();
    }

    function setMapEmptyState({ hidden, title = '', copy = '', detail = '' }) {
        dom.mapEmptyState.hidden = hidden;

        if (!hidden) {
            dom.mapEmptyTitle.textContent = title || 'No Renderable Map Selected';
            dom.mapEmptyCopy.textContent = copy || 'Select a map with image data to edit points, regions, and lines.';
        }

        const normalizedDetail = String(detail || '').trim();
        dom.mapEmptyDetail.hidden = !normalizedDetail;
        dom.mapEmptyDetail.textContent = normalizedDetail;
    }

    function getMapContainerSize() {
        if (!state.map) return { width: 0, height: 0 };
        const container = state.map.getContainer();
        if (!container) return { width: 0, height: 0 };
        const rect = container.getBoundingClientRect();
        return {
            width: rect.width || 0,
            height: rect.height || 0
        };
    }

    function queueMapViewportReset() {
        if (!state.map || !state.currentBounds) return;
        let attempts = 0;
        const resetViewport = () => {
            if (!state.map || !state.currentBounds) return;
            const { width, height } = getMapContainerSize();
            if ((width < 16 || height < 16) && attempts < 8) {
                attempts += 1;
                scheduleMapLayout(resetViewport);
                return;
            }
            state.map.invalidateSize(false);
            try {
                if (width < 16 || height < 16) return;
                state.map.fitBounds(state.currentBounds, { padding: [10, 10], animate: false });
            } catch (error) {
                console.error('Map editor viewport reset failed.', {
                    bounds: state.currentBounds,
                    width,
                    height,
                    error
                });
                if (Array.isArray(state.currentBounds) && state.currentBounds[1]) {
                    const mapHeight = Number(state.currentBounds[1][0]) || 0;
                    const mapWidth = Number(state.currentBounds[1][1]) || 0;
                    state.map.setView([mapHeight / 2, mapWidth / 2], -2, { animate: false });
                }
            }
        };
        scheduleMapLayout(resetViewport);
    }

    function clampInspectorWidth(value) {
        const workspaceWidth = dom.workspace?.getBoundingClientRect().width || window.innerWidth;
        const responsiveMaximum = Math.max(320, Math.min(560, workspaceWidth * 0.52));
        return Math.round(Math.min(responsiveMaximum, Math.max(280, Number(value) || 280)));
    }

    function applyInspectorWidth(value, persist = true) {
        if (!dom.workspace) return;
        state.inspectorWidth = clampInspectorWidth(value);
        dom.workspace.style.setProperty('--editor-inspector-width', `${state.inspectorWidth}px`);
        dom.appShell.style.setProperty('--editor-inspector-width', `${state.inspectorWidth}px`);
        if (dom.inspectorResizer) {
            dom.inspectorResizer.setAttribute('aria-valuemin', '280');
            dom.inspectorResizer.setAttribute('aria-valuemax', String(clampInspectorWidth(Infinity)));
            dom.inspectorResizer.setAttribute('aria-valuenow', String(state.inspectorWidth));
            dom.inspectorResizer.setAttribute('aria-valuetext', `${state.inspectorWidth} pixels wide`);
        }
        if (persist) {
            try {
                localStorage.setItem('mapEditorInspectorWidth', String(state.inspectorWidth));
            } catch (error) {
                // Storage is optional; the layout still works for this session.
            }
        }
        queueMapLayout();
    }

    function setInspectorCollapsed(collapsed, persist = true) {
        state.inspectorCollapsed = Boolean(collapsed);
        if (dom.workspace) {
            dom.workspace.dataset.inspectorCollapsed = String(state.inspectorCollapsed);
        }
        if (dom.toggleInspectorButton) {
            dom.toggleInspectorButton.textContent = state.inspectorCollapsed ? 'Show details' : 'Hide details';
            dom.toggleInspectorButton.setAttribute('aria-expanded', String(!state.inspectorCollapsed));
        }
        if (dom.collapseInspectorButton) {
            dom.collapseInspectorButton.setAttribute('aria-label', 'Close editing panel');
            dom.collapseInspectorButton.title = 'Close editing panel';
        }
        syncInspectorLauncherState();
        syncDmTabs();
        if (persist) {
            try {
                localStorage.setItem('mapEditorDrawerCollapsed', String(state.inspectorCollapsed));
            } catch (error) {
                // Storage is optional; the layout still works for this session.
            }
        }
        refreshAppMenuState();
        queueMapLayout();
    }

    function syncInspectorLauncherState() {
        dom.inspectorTabButtons.forEach((button) => {
            const selected = button.dataset.inspectorTab === state.inspectorTab;
            const expanded = selected && !state.inspectorCollapsed;
            button.classList.toggle('active', expanded);
            button.setAttribute('aria-expanded', String(expanded));
        });
    }

    function setInspectorLauncherHidden(hidden, persist = true) {
        state.inspectorLauncherHidden = Boolean(hidden);
        if (state.inspectorLauncherHidden && !state.inspectorCollapsed) {
            setInspectorCollapsed(true, persist);
        }
        if (dom.inspectorLauncher) {
            dom.inspectorLauncher.dataset.launcherHidden = String(state.inspectorLauncherHidden);
        }
        if (dom.inspectorLauncherToggle) {
            const label = state.inspectorLauncherHidden
                ? 'Show editing panel buttons'
                : 'Hide editing panel buttons';
            dom.inspectorLauncherToggle.setAttribute('aria-label', label);
            dom.inspectorLauncherToggle.title = label;
            dom.inspectorLauncherToggle.setAttribute('aria-expanded', String(!state.inspectorLauncherHidden));
            const text = dom.inspectorLauncherToggle.querySelector('span');
            if (text) text.textContent = label;
        }
        if (persist) {
            try {
                localStorage.setItem('mapEditorLauncherHidden', String(state.inspectorLauncherHidden));
            } catch (error) {
                // Storage is optional; the launcher still works for this session.
            }
        }
    }

    function setInspectorTab(tabName, persist = true) {
        const availableTabs = new Set(['overview', 'features', 'advanced']);
        const nextTab = availableTabs.has(tabName) ? tabName : 'overview';
        state.inspectorTab = nextTab;
        syncInspectorLauncherState();
        dom.inspectorPanels.forEach((panel) => {
            panel.hidden = nextTab === 'features' ? panel.dataset.inspectorPanel !== 'features' : panel.dataset.inspectorPanel === 'features';
        });
        if (persist) {
            try {
                localStorage.setItem('mapEditorInspectorTab', nextTab);
            } catch (error) {
                // Storage is optional; the inspector still works for this session.
            }
        }
    }

    function initializeInspectorTabs() {
        let storedTab = 'overview';
        try {
            storedTab = localStorage.getItem('mapEditorInspectorTab') || 'overview';
        } catch (error) {
            storedTab = 'overview';
        }
        setInspectorTab(storedTab, false);
    }

    function registerInspectorTabs() {
        const activateTab = (tabName) => {
            if (state.inspectorTab === tabName && !state.inspectorCollapsed) {
                setInspectorCollapsed(true);
                return;
            }
            setInspectorTab(tabName);
            setInspectorCollapsed(false);
            if (tabName === 'overview') {
                setWorkflowMode('map-details');
            } else if (tabName === 'advanced') {
                setWorkflowMode('map-advanced');
            } else {
                openFeatureBrowser(state.featureListState.type);
            }
        };
        dom.inspectorTabButtons.forEach((button, index) => {
            button.addEventListener('click', () => {
                activateTab(button.dataset.inspectorTab);
            });
            button.addEventListener('keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
                const nextIndex = (index + direction + dom.inspectorTabButtons.length) % dom.inspectorTabButtons.length;
                const nextButton = dom.inspectorTabButtons[nextIndex];
                activateTab(nextButton.dataset.inspectorTab);
                nextButton.focus();
                event.preventDefault();
            });
        });
    }

    function initializeInspectorLayout() {
        let storedWidth = 0;
        let storedCollapsed = null;
        let storedLauncherHidden = null;
        try {
            storedWidth = Number(localStorage.getItem('mapEditorInspectorWidth') || 0);
            storedCollapsed = localStorage.getItem('mapEditorDrawerCollapsed');
            storedLauncherHidden = localStorage.getItem('mapEditorLauncherHidden');
        } catch (error) {
            storedWidth = 0;
            storedCollapsed = null;
            storedLauncherHidden = null;
        }
        applyInspectorWidth(storedWidth || 360, false);
        setInspectorCollapsed(storedCollapsed === null ? true : storedCollapsed === 'true', false);
        setInspectorLauncherHidden(storedLauncherHidden === 'true', false);
    }

    function registerInspectorResize() {
        if (!dom.inspectorResizer || !dom.inspector) return;
        let startX = 0;
        let startWidth = 0;

        const finishResize = () => {
            dom.inspectorResizer.dataset.resizing = 'false';
            try {
                localStorage.setItem('mapEditorInspectorWidth', String(state.inspectorWidth));
            } catch (error) {
                // Storage is optional; the layout still works for this session.
            }
        };

        dom.inspectorResizer.addEventListener('pointerdown', (event) => {
            if (window.matchMedia('(max-width: 900px)').matches) return;
            startX = event.clientX;
            startWidth = dom.inspector.getBoundingClientRect().width;
            dom.inspectorResizer.dataset.resizing = 'true';
            dom.inspectorResizer.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        dom.inspectorResizer.addEventListener('pointermove', (event) => {
            if (dom.inspectorResizer.dataset.resizing !== 'true') return;
            applyInspectorWidth(startWidth + (event.clientX - startX), false);
        });
        dom.inspectorResizer.addEventListener('pointerup', finishResize);
        dom.inspectorResizer.addEventListener('pointercancel', finishResize);
        dom.inspectorResizer.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const delta = event.key === 'ArrowRight' ? 24 : -24;
            applyInspectorWidth((state.inspectorWidth || dom.inspector.getBoundingClientRect().width) + delta);
            event.preventDefault();
        });
    }

    function clearMapVisualLayers() {
        if (state.imageLayer) {
            state.map.removeLayer(state.imageLayer);
            state.imageLayer = null;
        }
        if (state.underlayLayer) {
            state.map.removeLayer(state.underlayLayer);
            state.underlayLayer = null;
        }
    }

    function getCurrentFeatureCollection(mode) {
        if (mode === 'points') return getCurrentPoints();
        if (mode === 'regions') return getCurrentRegions();
        if (mode === 'lines') return getCurrentLines();
        if (mode === 'journeys') return getCurrentJourneys();
        return [];
    }

    function getSelectedFeature() {
        if (!state.selectedFeature) return null;
        const collection = getCurrentFeatureCollection(state.selectedFeature.mode);
        return collection[state.selectedFeature.index] || null;
    }

    function clearDrawMode() {
        state.placingJourneyStop = false;
        const discardedUnfinishedDraft = hasUnfinishedGeometryDraft();
        state.geometryDragActive = false;
        state.drawMode = '';
        state.draftCoordinates = [];
        state.draftHandles = [];
        state.selectedVertexIndex = -1;
        renderDraftGeometry();
        syncToolbarState();
        if (discardedUnfinishedDraft) {
            if (state.editorDirty) {
                persistRecoverySnapshot();
            } else {
                clearRecoverySnapshot();
                setReadinessItem('currentMapSaved', 'pass', 'No unsaved editor changes.');
            }
            refreshSaveControls();
            refreshBuildPreviewButtonState();
        }
    }

    function selectFeature(mode, index) {
        state.placingJourneyStop = false;
        if (state.selectedFeature?.mode !== mode || state.selectedFeature?.index !== index) state.selectedVertexIndex = -1;
        const collection = getCurrentFeatureCollection(mode);
        if (!collection[index]) {
            state.selectedFeature = null;
        } else {
            state.selectedFeature = { mode, index };
            if (mode === 'points') {
                setSelectionStatus(canMutateWorkspace() ? 'Drag the marker to reposition.' : 'Reviewing point position.');
            } else {
                setSelectionStatus(canMutateWorkspace() ? 'Drag the orange handles to reshape.' : 'Reviewing feature geometry.');
            }
        }
        if (state.selectedFeature) {
            state.featureListState.type = mode;
            setWorkflowMode('feature-edit');
        }
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        syncToolbarState();
    }

    function deselectFeature() {
        state.selectedFeature = null;
        state.selectedVertexIndex = -1;
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        syncToolbarState();
    }

    function syncToolbarState() {
        const canViewMap = canRenderMap(state.currentMap);
        const canEditGeometry = canViewMap && canMutateWorkspace();
        dom.addPoiButton.disabled = !canEditGeometry;
        dom.addRegionButton.disabled = !canEditGeometry;
        dom.addLineButton.disabled = !canEditGeometry;
        if (dom.journeysButton) dom.journeysButton.disabled = !canViewMap;
        dom.resetViewButton.disabled = !canViewMap;
        dom.deleteSelectionButton.disabled = !canMutateWorkspace() || !state.selectedFeature;
        const requiredDraftPoints = state.drawMode === 'region' ? 3 : (state.drawMode === 'line' ? 2 : 0);
        const remainingDraftPoints = Math.max(0, requiredDraftPoints - state.draftCoordinates.length);
        if (dom.curvePointButton) syncCurvePointControl();
        if (dom.undoPointButton) {
            dom.undoPointButton.hidden = !requiredDraftPoints;
            dom.undoPointButton.disabled = !canEditGeometry || !state.draftCoordinates.length;
        }
        dom.finishDrawButton.hidden = !state.drawMode || state.drawMode === 'point';
        dom.finishDrawButton.disabled = !canMutateWorkspace() || !state.drawMode || remainingDraftPoints > 0;
        dom.finishDrawButton.title = remainingDraftPoints > 0
            ? `Add ${remainingDraftPoints} more ${remainingDraftPoints === 1 ? 'point' : 'points'} to finish.`
            : 'Finish this shape.';
        dom.cancelDrawButton.hidden = !state.drawMode && !state.placingJourneyStop;
        dom.cancelDrawButton.textContent = state.placingJourneyStop ? 'Cancel stop' : 'Cancel drawing';
        dom.appShell.dataset.placingJourneyStop = String(state.placingJourneyStop || false);
        const unfinishedDraft = hasUnfinishedGeometryDraft();
        const canExportCurrentMap = canRenderMap(state.currentMap) && dom.appShell.dataset.mode !== 'library' && !unfinishedDraft;
        dom.exportCurrentMapButton.disabled = !canExportCurrentMap;
        dom.exportCurrentMapButton.title = canExportCurrentMap
            ? 'Download the saved current map JSON.'
            : (unfinishedDraft
                ? 'Finish or cancel the drawing before exporting. Unfinished vertices are not included.'
                : (state.currentMap ? 'Open the map before exporting it.' : 'Choose a map before exporting it.'));
        if (dom.exportCurrentMapNote) {
            dom.exportCurrentMapNote.textContent = unfinishedDraft
                ? 'Unavailable until you finish or cancel the drawing; unfinished vertices are omitted.'
                : 'Download the selected saved map as JSON.';
        }
        dom.toolButtons.forEach((button) => {
            if (['point', 'region', 'line'].includes(button.dataset.editorTool)) {
                button.disabled = !canEditGeometry;
            } else if (button.dataset.editorTool !== 'select') {
                button.disabled = !state.currentMap;
            }
        });
    }

    function buildTreeSearchItems() {
        if (!state.treeSearch) return state.atlasTree;
        return utils.filterMapTree(state.atlasTree, state.treeSearch);
    }

    function toggleFolder(id) {
        if (state.expandedFolderIds.has(id)) {
            state.expandedFolderIds.delete(id);
        } else {
            state.expandedFolderIds.add(id);
        }
        renderAtlasTree();
    }

    function renderAtlasTree() {
        const visibleTree = buildTreeSearchItems();
        const newMapTile = document.getElementById('dm-new-map');
        const expandedGroups = new Set([...dom.atlasTree.querySelectorAll('details[open]')].map(section => section.dataset.libraryGroup));
        // Keep the same link (and navigation guard) as the gallery re-renders.
        if (newMapTile) dom.atlasTree.before(newMapTile);
        dom.atlasTree.innerHTML = '';

        if (!Array.isArray(visibleTree) || visibleTree.length === 0) {
            dom.atlasTree.innerHTML = '<p class="map-editor-placeholder">No maps match the current search.</p>';
            return;
        }

        const maps = [];
        (function collectEditableMaps(items, parentLabels = []) {
            if (!Array.isArray(items)) return;
            items.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                if (String(item.id || '').trim() && String(item.imageUrl || '').trim()) {
                    maps.push({ item, parentLabels });
                }
                const nextParents = String(item.name || item.id || '').trim()
                    ? [...parentLabels, String(item.name || item.id).trim()]
                    : parentLabels;
                collectEditableMaps(item.children, nextParents);
            });
        }(visibleTree));

        if (maps.length === 0) {
            dom.atlasTree.innerHTML = '<p class="map-editor-placeholder">No editable maps match this search.</p>';
            return;
        }

        const entries = maps.map((entry) => ({
            ...entry,
            libraryGroup: getMapLibraryGroup(entry.item, entry.parentLabels)
        }));
        renderRecentMapControl(entries);
        dom.atlasTree.dataset.density = state.libraryDensity;

        const visibleEntries = state.libraryStatusFilter === 'all'
            ? entries
            : entries.filter((entry) => entry.libraryGroup === state.libraryStatusFilter);
        if (visibleEntries.length === 0) {
            dom.atlasTree.innerHTML = '<p class="map-editor-placeholder">No maps are in this group.</p>';
            return;
        }

        ['active', 'development', 'archived'].forEach((group) => {
            const groupEntries = visibleEntries.filter((entry) => entry.libraryGroup === group);
            if (groupEntries.length === 0) return;
            const section = document.createElement(group === 'active' ? 'section' : 'details');
            if (group !== 'active') section.open = Boolean(state.treeSearch) || state.libraryStatusFilter !== 'all' || expandedGroups.has(group);
            section.className = 'map-editor-library-group';
            section.dataset.libraryGroup = group;
            section.setAttribute('aria-labelledby', `editor-library-group-${group}`);

            const heading = document.createElement(group === 'active' ? 'h2' : 'summary');
            heading.id = `editor-library-group-${group}`;
            heading.textContent = `${getMapLibraryGroupLabel(group)} (${groupEntries.length})`;
            const list = document.createElement('ul');
            list.className = 'map-editor-library-grid';
            groupEntries.forEach(({ item, parentLabels }) => {
            const row = document.createElement('li');
            row.className = 'map-editor-library-card';
            const isCurrent = item.id === state.currentMapId;
            if (isCurrent) row.dataset.current = 'true';

            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.mapId = item.id;
            const interaction = canMutateWorkspace() ? 'Open' : 'Review';
            const cardContext = [getMapPresetGroupLabel(item), parentLabels.at(-1), item.status, item.id]
                .map((value) => String(value || '').trim())
                .filter((value, index, values) => value && values.indexOf(value) === index)
                .join(', ');
            button.setAttribute('aria-label', `${interaction} map: ${item.name || item.id}${cardContext ? `, ${cardContext}` : ''}`);

            const previewUrl = getMiniMapImageUrl(item.imageUrl);
            if (previewUrl) {
                const image = document.createElement('img');
                image.src = previewUrl;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.addEventListener('error', () => {
                    const placeholder = document.createElement('span');
                    placeholder.className = 'map-editor-library-card-placeholder';
                    placeholder.textContent = 'H';
                    image.replaceWith(placeholder);
                }, { once: true });
                button.appendChild(image);
            } else {
                const placeholder = document.createElement('span');
                placeholder.className = 'map-editor-library-card-placeholder';
                placeholder.textContent = 'H';
                button.appendChild(placeholder);
            }

            const copy = document.createElement('span');
            copy.className = 'map-editor-library-card-copy';
            const title = document.createElement('strong');
            title.textContent = item.name || item.id;
            copy.appendChild(title);
            button.appendChild(copy);
            button.title = [item.name || item.id, parentLabels.join(' / '), item.selectorDescription || item.blurb].filter(Boolean).join(' — ');

            button.addEventListener('click', () => {
                requestMapSelection(item.id).catch((error) => {
                    console.error(error);
                    setSelectionStatus(error.message || 'Could not open the map.');
                });
            });
            row.appendChild(button);
            list.appendChild(row);
            });
            section.append(heading, list);
            dom.atlasTree.appendChild(section);
        });
        if (newMapTile && !newMapTile.hidden) {
            const tile = document.createElement('li');
            tile.className = 'dm-new-map-tile';
            tile.appendChild(newMapTile);
            dom.atlasTree.querySelector('.map-editor-library-grid')?.appendChild(tile);
        }
    }

    function renderRecentMapControl(entries) {
        if (!dom.libraryRecentSelect) return;
        const entriesById = new Map(entries.map((entry) => [entry.item.id, entry.item]));
        const recentMaps = state.recentMapIds.map((id) => entriesById.get(id)).filter(Boolean);
        dom.libraryRecentSelect.textContent = '';
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = recentMaps.length > 0 ? 'Open a recent map…' : 'No recently opened maps';
        dom.libraryRecentSelect.appendChild(prompt);
        recentMaps.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name || item.id;
            dom.libraryRecentSelect.appendChild(option);
        });
        dom.libraryRecentSelect.disabled = recentMaps.length === 0;
        dom.libraryRecentSelect.value = '';
    }

    function getFeatureSummaryLabel() {
        const points = getCurrentPoints().length;
        const regions = getCurrentRegions().length;
        const lines = getCurrentLines().length;
        return String(points + regions + lines + getCurrentJourneys().length);
    }

    function getFeatureItems(type) {
        if (type === 'points') return getCurrentPoints();
        if (type === 'regions') return getCurrentRegions();
        if (type === 'lines') return getCurrentLines();
        if (type === 'journeys') return getCurrentJourneys();
        return [];
    }

    function getFeatureItemMetaShort(type, item) {
        if (type === 'journeys') return `${item.campaign || 'Campaign'} · ${(item.stops || []).length} stops`;
        if (type === 'points') return item.type || 'Point';
        if (type === 'regions') return item.value || item.type || 'Region';
        return item.type || 'Line';
    }

    function getFeatureItemMetaFull(type, item) {
        const shortMeta = getFeatureItemMetaShort(type, item);
        const editorialContext = String(item.summary || item.description || '').trim().replace(/\s+/g, ' ');
        if (editorialContext) return `${shortMeta} · ${editorialContext}`;
        if (type === 'journeys') return shortMeta;
        if (item.linkedMapId) return `${shortMeta} · Opens ${item.linkedMapId}`;
        if (type === 'points') return `${shortMeta} · No card summary yet`;
        const verticesCount = Array.isArray(item.coordinates) ? item.coordinates.length : 0;
        return `${shortMeta} · ${verticesCount} ${verticesCount === 1 ? 'vertex' : 'vertices'} · No card summary yet`;
    }

    function createFeatureButton(type, item, index, label, metaFull) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-editor-feature-entry';

        if (state.selectedFeature && state.selectedFeature.mode === type && state.selectedFeature.index === index) {
            button.classList.add('active');
        }

        button.textContent = label;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'map-editor-feature-meta';
        metaSpan.textContent = metaFull;
        button.appendChild(metaSpan);

        button.addEventListener('click', () => selectFeature(type, index));
        return button;
    }

    function renderFeatureLists() {
        const { type, searchQuery, expanded, defaultLimit } = state.featureListState;
        if (state.currentMap) updateMapHome();
        dom.featureTypeSelect.value = type;
        dom.unifiedFeatureList.innerHTML = '';
        dom.featureShowMoreButton.hidden = true;

        const items = getFeatureItems(type);

        if (!Array.isArray(items) || items.length === 0) {
            dom.unifiedFeatureList.innerHTML = '<p class="map-editor-placeholder">No entries yet.</p>';
            dom.featureSummary.textContent = getFeatureSummaryLabel();
            return;
        }

        const query = searchQuery.toLowerCase();
        const limit = expanded ? items.length : defaultLimit;
        let filteredCount = 0;

        // ⚡ Bolt: Use DocumentFragment for batched DOM insertions and replace .map().filter() with a for loop
        const fragment = document.createDocumentFragment();

        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const label = item.name || item.id || `${type.slice(0, -1)} ${index + 1}`;
            const metaShort = getFeatureItemMetaShort(type, item);

            const searchText = [label, metaShort, item.summary, item.description, item.linkedMapId, ...(Array.isArray(item.tags) ? item.tags : [])]
                .map((value) => String(value || '').toLowerCase())
                .join(' ');
            if (query && !searchText.includes(query)) {
                continue;
            }

            filteredCount++;
            if (filteredCount > limit && !expanded) continue;

            const metaFull = getFeatureItemMetaFull(type, item);
            const button = createFeatureButton(type, item, index, label, metaFull);
            fragment.appendChild(button);
        }

        if (filteredCount === 0) {
            dom.unifiedFeatureList.innerHTML = '<p class="map-editor-placeholder">No matching entries found.</p>';
            dom.featureSummary.textContent = getFeatureSummaryLabel();
            return;
        }

        dom.unifiedFeatureList.appendChild(fragment);

        if (filteredCount > defaultLimit) {
            dom.featureShowMoreButton.hidden = false;
            dom.featureShowMoreButton.textContent = expanded ? 'Show Less' : `Show All (${filteredCount})`;
        }

        dom.featureSummary.textContent = getFeatureSummaryLabel();
    }

    function stringifyCoordinates(coordinates) {
        if (!Array.isArray(coordinates)) return '';
        return coordinates.map((pair) => {
            if (!Array.isArray(pair) || pair.length !== 2) return '';
            return `${roundCoordinate(pair[0])}, ${roundCoordinate(pair[1])}`;
        }).filter(Boolean).join('\n');
    }

    function parseCoordinatePairs(value, minimumPoints) {
        const lines = String(value || '').split('\n');
        const parsedRows = [];

        for (let i = 0; i < lines.length; i++) {
            const row = lines[i].trim();
            if (!row) continue;

            const commaIndex = row.indexOf(',');
            if (commaIndex === -1) {
                throw new Error('Each coordinate row must contain exactly two values.');
            }

            const part1 = row.slice(0, commaIndex).trim();
            const part2 = row.slice(commaIndex + 1).trim();

            if (part2.indexOf(',') !== -1) {
                throw new Error('Each coordinate row must contain exactly two values.');
            }

            const first = roundCoordinate(part1);
            const second = roundCoordinate(part2);

            parsedRows.push([first, second]);
        }

        if (parsedRows.length < minimumPoints) {
            throw new Error(`At least ${minimumPoints} coordinate rows are required.`);
        }
        return parsedRows;
    }

    function parseJsonObject(value) {
        const source = String(value || '').trim();
        if (!source) return {};
        const parsed = JSON.parse(source);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Properties must be a JSON object.');
        }
        return parsed;
    }

    function stringifyKeyFacts(properties) {
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return '';
        return Object.entries(properties)
            .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join('\n');
    }

    function parseKeyFacts(value) {
        const rows = String(value || '')
            .split('\n')
            .map((row) => row.trim())
            .filter(Boolean);
        return rows.reduce((properties, row) => {
            const separatorIndex = row.indexOf(':');
            if (separatorIndex === -1) {
                throw new Error('Key facts must use "Label: Value" rows.');
            }
            const key = row.slice(0, separatorIndex).trim();
            const factValue = row.slice(separatorIndex + 1).trim();
            if (!key) {
                throw new Error('Key facts require a label before the colon.');
            }
            if (factValue) properties[key] = factValue;
            return properties;
        }, {});
    }

    function stringifyTags(tags) {
        return Array.isArray(tags)
            ? tags.map((tag) => String(tag || '').trim()).filter(Boolean).join('\n')
            : '';
    }

    function parseTags(value) {
        const seen = new Set();
        return String(value || '')
            .split(/[\n,]/)
            .map((tag) => tag.trim())
            .filter((tag) => {
                const key = tag.toLowerCase();
                if (!tag || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function stringifyDetailSections(sections) {
        return Array.isArray(sections)
            ? sections
                .map((section) => {
                    const heading = String(section?.heading || '').trim();
                    const body = String(section?.body || '').trim();
                    if (!heading && !body) return '';
                    return [heading, body].filter(Boolean).join('\n');
                })
                .filter(Boolean)
                .join('\n\n')
            : '';
    }

    function parseDetailSections(value) {
        return String(value || '')
            .split(/\n\s*\n/)
            .map((block) => block.trim())
            .filter(Boolean)
            .map((block) => {
                const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
                const heading = lines.shift() || '';
                const body = lines.join('\n');
                if (!heading && !body) return null;
                return { heading, body };
            })
            .filter(Boolean);
    }

    function getDetailSections(feature) {
        if (!Array.isArray(feature.detailSections)) feature.detailSections = [];
        return feature.detailSections;
    }

    // ⚡ Bolt: Replaced chained array methods (.map, .filter, Array.from) with for loops to eliminate redundant array allocations during feature serialization and DOM parsing
    function getDetailSectionsFromForm() {
        const rows = dom.featureForm.querySelectorAll('[data-detail-section-row]');
        const sections = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const heading = row.querySelector('[data-detail-section-field="heading"]')?.value.trim() || '';
            const body = row.querySelector('[data-detail-section-field="body"]')?.value.trim() || '';
            if (heading || body) {
                const feature = getSelectedFeature();
                const previous = feature?.detailSections?.[Number(row.dataset.detailSectionRow)];
                sections.push({ ...(previous || {}), heading, body });
            }
        }
        return sections;
    }

    function createDetailSectionControl(section, index) {
        const row = document.createElement('div');
        row.className = 'map-editor-detail-section-row';
        row.dataset.detailSectionRow = String(index);

        const headingId = `detail-section-${index}-heading`;
        const bodyId = `detail-section-${index}-body`;
        const titleId = `detail-section-${index}-title`;

        const header = document.createElement('div');
        header.className = 'map-editor-detail-section-header';

        const title = document.createElement('h4');
        title.id = titleId;
        title.textContent = `Section ${index + 1}`;
        header.appendChild(title);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'map-editor-detail-section-remove';
        removeButton.dataset.action = 'remove-detail-section';
        removeButton.dataset.detailSectionIndex = String(index);
        removeButton.setAttribute('aria-label', `Remove detail section ${index + 1}`);
        removeButton.textContent = 'Remove';
        header.appendChild(removeButton);
        row.appendChild(header);

        const headingLabel = document.createElement('label');
        headingLabel.setAttribute('for', headingId);
        headingLabel.textContent = 'Section Heading';
        const headingInput = document.createElement('input');
        headingInput.id = headingId;
        headingInput.type = 'text';
        headingInput.dataset.field = 'detailSections';
        headingInput.dataset.detailSectionField = 'heading';
        headingInput.value = section.heading || '';
        headingLabel.appendChild(headingInput);
        row.appendChild(headingLabel);

        const bodyLabel = document.createElement('label');
        bodyLabel.setAttribute('for', bodyId);
        bodyLabel.textContent = 'Section Body';
        const bodyTextarea = document.createElement('textarea');
        bodyTextarea.id = bodyId;
        bodyTextarea.rows = 4;
        bodyTextarea.dataset.field = 'detailSections';
        bodyTextarea.dataset.detailSectionField = 'body';
        bodyTextarea.value = section.body || '';
        bodyLabel.appendChild(bodyTextarea);
        row.appendChild(bodyLabel);

        row.setAttribute('role', 'group');
        row.setAttribute('aria-labelledby', titleId);
        return row;
    }

    function renderDetailSectionControls(feature) {
        const list = dom.featureForm.querySelector('[data-detail-section-list]');
        const empty = dom.featureForm.querySelector('[data-detail-section-empty]');
        if (!list || !empty) return;

        const sections = getDetailSections(feature);
        list.innerHTML = '';
        empty.hidden = sections.length > 0;
        sections.forEach((section, index) => {
            list.appendChild(createDetailSectionControl(section, index));
        });
    }

    function getPointMarkerAccessibleName(point, index) {
        const name = String(point?.name || point?.id || `POI ${index + 1}`).trim();
        return `${name || `POI ${index + 1}`} marker`;
    }

    function renderFeatureSchema(mode, label, feature) {
        dom.selectedFeatureChip.textContent = label;
        fieldApi.renderFeatureFields(document, dom.featureForm, mode, feature, {
            stringifyCoordinates,
            stringifyKeyFacts,
            stringifyTags,
            poiTypes: Object.values(window.AppConfig?.get('taxonomy.poiTypeGroups', {}) || {}).flat().sort()
        });
        if (mode === 'points') renderDetailSectionControls(feature);
    }

    function renderPointFeatureInspector(feature) {
        renderFeatureSchema('points', 'POI', feature);
    }

    function renderRegionFeatureInspector(feature) {
        renderFeatureSchema('regions', 'Region', feature);
    }

    function renderLineFeatureInspector(feature) {
        renderFeatureSchema('lines', 'Line', feature);
    }

    function createJourney() {
        if (!canMutateWorkspace() || !canRenderMap(state.currentMap)) return;
        checkpointHistory('Create journey');
        getCurrentJourneys().push({ id: CampaignJourneys.createId(), name: 'New journey', campaign: '', color: CampaignJourneys.defaultColor, visibleByDefault: false, stops: [] });
        selectFeature('journeys', getCurrentJourneys().length - 1);
        markCurrentMapDirty('New journey needs a campaign and at least one stop.');
    }

    function focusJourneyStop(index) {
        const row = dom.featureForm.querySelector(`[data-journey-stop="${index}"]`);
        if (!row) return;
        row.open = true;
        row.querySelector('input')?.focus();
    }

    function updateJourneyStopField(control) {
        const journey = getSelectedFeature();
        const stop = journey?.stops?.[Number(control.dataset.stopIndex)];
        if (!stop) return false;
        const key = control.dataset.stopField;
        if (!['name', 'date', 'session', 'description', 'wikiLink'].includes(key)) return false;
        const value = control.value;
        const error = key === 'name' && !value.trim() ? 'Give this stop a name.'
            : key === 'wikiLink' && value.trim() && !CampaignJourneys.safeWikiLink(value.trim()) ? 'Use a full http or https wiki URL.' : '';
        control.setCustomValidity(error);
        if (error) { setSelectionStatus(error); return false; }
        stop[key] = value;
        const summary = control.closest('details').querySelector('summary');
        summary.textContent = `${Number(control.dataset.stopIndex) + 1}. ${stop.name}${stop.date ? ` · ${stop.date}` : ''}`;
        markCurrentMapDirty('Journey stop details changed.');
        return true;
    }

    function renderJourneyInspector(journey) {
        renderFeatureSchema('journeys', 'Journey', journey);
        dom.featureForm.querySelector('details').open = !journey.stops?.length;
        const heading = document.createElement('h3');
        heading.textContent = 'Stops in travel order';
        const help = document.createElement('p');
        help.className = 'map-editor-field-help';
        help.textContent = 'Dotted lines connect stops in this order. Dates can use any in-universe calendar; order is controlled below.';
        dom.featureForm.append(heading, help);
        const button = (label, action, parent = dom.featureForm, disabled = false) => {
            const control = document.createElement('button');
            control.type = 'button';
            control.textContent = label;
            control.disabled = disabled || !canMutateWorkspace();
            if (disabled) control.dataset.alwaysReadonly = '';
            control.addEventListener('click', () => { if (canMutateWorkspace()) action(); });
            parent.append(control);
            return control;
        };
        button('Add stop on map', () => {
            if (!flushSelectedFeatureForm()) return;
            state.placingJourneyStop = true;
            syncToolbarState();
            setInspectorCollapsed(true, false);
            setSelectionStatus('Click the map to place the next journey stop, or choose Cancel stop.');
        }).id = 'editor-add-journey-stop-btn';
        (journey.stops || []).forEach((stop, index) => {
            const row = document.createElement('details');
            row.className = 'map-editor-feature-section journey-stop-editor';
            row.dataset.journeyStop = index;
            const summary = document.createElement('summary');
            summary.textContent = `${index + 1}. ${stop.name}${stop.date ? ` · ${stop.date}` : ''}`;
            row.append(summary);
            const body = document.createElement('div');
            body.className = 'map-editor-feature-section-body';
            for (const [key, label, placeholder] of [
                ['name', 'Stop name', 'Arrival, discovery, battle…'],
                ['date', 'In-universe date', 'Any calendar, approximate date, or date range'],
                ['session', 'Session', 'Session number or title (optional)'],
                ['description', 'What happened', 'Notes about this moment'],
                ['wikiLink', 'Stop wiki link', 'https://…']
            ]) {
                const field = document.createElement('label');
                const labelText = document.createElement('span');
                labelText.textContent = label;
                const input = document.createElement(key === 'description' ? 'textarea' : 'input');
                input.value = stop[key] || '';
                input.placeholder = placeholder;
                input.dataset.stopField = key;
                input.dataset.stopIndex = index;
                if (key === 'name') input.required = true;
                field.append(labelText, input);
                body.append(field);
            }
            const actions = document.createElement('div');
            actions.className = 'journey-stop-actions';
            const move = delta => {
                if (!flushSelectedFeatureForm()) return;
                checkpointHistory('Reorder journey stops');
                journey.stops.splice(index + delta, 0, journey.stops.splice(index, 1)[0]);
                renderFeatureInspector();
                renderMapLayers(false);
                markCurrentMapDirty('Journey stop order changed.');
                focusJourneyStop(index + delta);
            };
            button('Move earlier', () => move(-1), actions, index === 0);
            button('Move later', () => move(1), actions, index === journey.stops.length - 1);
            button('Locate', () => state.map.panTo(stop.coords), actions);
            button('Remove stop', () => {
                checkpointHistory('Remove journey stop');
                journey.stops.splice(index, 1);
                renderFeatureInspector();
                renderFeatureLists();
                renderMapLayers(false);
                markCurrentMapDirty('Journey stop removed. Undo restores it.');
            }, actions);
            body.append(actions);
            row.append(body);
            dom.featureForm.append(row);
        });
    }

    function renderJourneysLayer() {
        if (dom.appShell.dataset.mode === 'draw') return;
        getCurrentJourneys().forEach((journey, index) => {
            if (dom.appShell.dataset.mode === 'feature-edit' &&
                (state.selectedFeature?.mode !== 'journeys' || state.selectedFeature.index !== index)) return;
            const selected = state.selectedFeature?.mode === 'journeys' && state.selectedFeature.index === index;
            const group = CampaignJourneys.createLayer(L, document, journey, {
                draggable: selected && canMutateWorkspace(),
                onSelect: stopIndex => {
                    if (state.placingJourneyStop) return;
                    selectFeature('journeys', index);
                    if (Number.isInteger(stopIndex)) focusJourneyStop(stopIndex);
                },
                onDragStart: () => { checkpointHistory('Move journey stop'); state.geometryDragActive = true; },
                onDragEnd: (stopIndex, latlng) => {
                    journey.stops[stopIndex].coords = roundLatLng(latlng);
                    state.geometryDragActive = false;
                    renderMapLayers(false);
                    markCurrentMapDirty('Journey stop moved.');
                }
            });
            group.addTo(state.journeyLayer);
        });
    }

    function renderFeatureInspector() {
        const feature = getSelectedFeature();
        dom.featureForm.innerHTML = '';
        dom.featureForm.dataset.featureMode = feature ? state.selectedFeature.mode : '';

        if (!feature) {
            dom.featureForm.hidden = true;
            dom.featureFormEmpty.hidden = false;
            dom.selectedFeatureChip.textContent = 'None';
            return;
        }

        dom.featureForm.hidden = false;
        dom.featureFormEmpty.hidden = true;

        const renderInspector = {
            points: renderPointFeatureInspector,
            regions: renderRegionFeatureInspector,
            lines: renderLineFeatureInspector,
            journeys: renderJourneyInspector
        }[state.selectedFeature.mode] || renderLineFeatureInspector;
        renderInspector(feature);
        syncFormAccess(dom.featureForm);
    }

    function applyFeatureFieldValue(feature, mode, definition, control) {
        const field = definition.key;
        const rawValue = definition.control === 'detailSections' ? '' : control?.value;
        const validationError = fieldApi.validateValue(definition, rawValue);
        if (validationError) throw new Error(validationError);
        const updateKind = definition.update || 'text';

        if (updateKind === 'boolean') {
            feature[field] = control.checked;
        } else if (updateKind === 'pointCoordinate') {
            const nextY = field === 'coordY' ? rawValue : dom.featureForm.querySelector('[data-field="coordY"]').value;
            const nextX = field === 'coordX' ? rawValue : dom.featureForm.querySelector('[data-field="coordX"]').value;
            feature.coords = [roundCoordinate(nextY), roundCoordinate(nextX)];
        } else if (updateKind === 'keyFacts') {
            feature.properties = parseKeyFacts(rawValue);
            const propertiesJsonField = dom.featureForm.querySelector('[data-field="properties"]');
            if (propertiesJsonField) propertiesJsonField.value = JSON.stringify(feature.properties || {}, null, 2);
        } else if (updateKind === 'tags') {
            feature.tags = parseTags(rawValue);
        } else if (updateKind === 'detailSections') {
            feature.detailSections = getDetailSectionsFromForm();
        } else if (updateKind === 'json') {
            feature.properties = parseJsonObject(rawValue);
            const keyFactsField = dom.featureForm.querySelector('[data-field="propertiesText"]');
            if (keyFactsField) keyFactsField.value = stringifyKeyFacts(feature.properties || {});
        } else if (updateKind === 'coordinates') {
            const minimumPoints = mode === 'regions' ? 3 : 2;
            const coordinates = parseCoordinatePairs(rawValue, minimumPoints);
            if (JSON.stringify(coordinates) !== JSON.stringify(feature.coordinates)) delete feature.bezier;
            feature.coordinates = coordinates;
        } else if (updateKind === 'number') {
            feature[field] = Number(rawValue);
        } else {
            feature[field] = rawValue;
        }
    }

    function updateSelectedFeatureFromForm(event, options = {}) {
        if (!canMutateWorkspace()) return false;
        const selection = state.selectedFeature ? { ...state.selectedFeature } : null;
        const feature = getSelectedFeature();
        if (!feature || !selection) return false;

        if (selection.mode === 'journeys' && !event.target.dataset.journeyHistory) {
            checkpointHistory('Edit journey details');
            event.target.dataset.journeyHistory = 'true';
        }
        if (selection.mode === 'journeys' && event.target.dataset.stopField) return updateJourneyStopField(event.target);
        const field = event.target.dataset.field;
        if (!field) return false;
        const definition = fieldApi.getFeatureFields(selection.mode)
            .find((candidate) => candidate.key === field);
        if (!definition) {
            setSelectionStatus(`Unknown ${selection.mode.slice(0, -1)} field: ${field}.`);
            return false;
        }

        try {
            applyFeatureFieldValue(feature, selection.mode, definition, event.target);
            setSelectionStatus(`Updated ${selection.mode.slice(0, -1)} fields.`);
            if (options.render !== false) {
                renderFeatureLists();
                renderMapLayers(false);
            }
            markCurrentMapDirty('Feature fields changed.');
            return true;
        } catch (error) {
            setSelectionStatus(error.message || 'Could not apply feature changes.');
            return false;
        }
    }

    function flushSelectedFeatureForm() {
        const feature = getSelectedFeature();
        const selection = state.selectedFeature;
        if (!feature || !selection || dom.featureForm.hidden) return true;
        if (selection.mode === 'journeys') {
            for (const control of dom.featureForm.querySelectorAll('[data-stop-field]')) {
                if (!updateJourneyStopField(control)) { control.closest('details').open = true; control.focus(); return false; }
            }
        }
        const definitions = fieldApi.getFeatureFields(selection.mode);
        for (const definition of definitions) {
            const control = definition.control === 'detailSections'
                ? dom.featureForm.querySelector('[data-detail-section-list]')
                : dom.featureForm.querySelector(`[data-field="${definition.key}"]`);
            if (!control && definition.control !== 'detailSections') continue;
            try {
                applyFeatureFieldValue(feature, selection.mode, definition, control);
            } catch (error) {
                const focusTarget = control?.matches?.('input, textarea, select') ? control : null;
                focusTarget?.closest('details')?.setAttribute('open', '');
                focusTarget?.focus();
                setSelectionStatus(error.message || 'Fix the highlighted feature field before saving.');
                setExportStatus(error.message || 'Fix the feature form before saving.', true);
                return false;
            }
        }
        renderFeatureLists();
        renderMapLayers(false);
        return true;
    }

    function buildParentOptions() {
        if (!state.currentMapId) return [];

        const currentNode = utils.findMapRecursive(state.atlasTree, state.currentMapId);
        const excludedIds = new Set([state.currentMapId]);
        collectDescendantIds(currentNode, excludedIds);

        const options = [{ id: '', label: 'Root' }];
        (function walk(items) {
            if (!Array.isArray(items)) return;
            items.forEach((item) => {
                if (!item || typeof item !== 'object' || !item.id) return;
                if (!excludedIds.has(item.id)) {
                    options.push({
                        id: item.id,
                        label: item.name || item.id
                    });
                }
                walk(item.children);
            });
        }(state.atlasTree));

        return options;
    }

    function getMapSettingsFieldValues(currentMap, currentLocation) {
        return fieldApi.getMapFieldValues(currentMap, {
            currentLocation,
            currentMapDataUrl: state.currentMapDataUrl
        });
    }

    function setMapSettingsFieldValues(inputs, fieldValues) {
        Object.entries(fieldValues).forEach(([key, value]) => {
            const input = inputs[key];
            if (!input) return;
            if (input.tagName === 'SELECT') {
                Array.from(input.options)
                    .filter((option) => option.hasAttribute('data-current-value'))
                    .forEach((option) => option.remove());
                if (value !== '' && !Array.from(input.options).some((option) => option.value === String(value))) {
                    const currentOption = document.createElement('option');
                    currentOption.value = value;
                    currentOption.textContent = `${value} (current value)`;
                    currentOption.dataset.currentValue = '';
                    input.appendChild(currentOption);
                }
            }
            input.value = value;
        });
    }

    function renderMapParentOptions(parentSelect, options, currentParentId) {
        if (!parentSelect) return;

        parentSelect.innerHTML = '';
        options.forEach((option) => {
            const optionElement = document.createElement('option');
            optionElement.value = option.id;
            optionElement.textContent = option.label;
            optionElement.selected = option.id === currentParentId;
            parentSelect.appendChild(optionElement);
        });
    }

    function renderMapSettingsForm() {
        const currentMap = state.currentMap;
        const currentLocation = currentMap ? findNodeLocation(state.atlasTree, currentMap.id) : null;
        const fieldValues = getMapSettingsFieldValues(currentMap, currentLocation);

        setMapSettingsFieldValues(dom.mapSettingsInputs, fieldValues);
        renderMapParentOptions(
            dom.mapSettingsInputs.parentId,
            buildParentOptions(),
            currentLocation?.parentId || ''
        );
        dom.currentMapId.textContent = currentMap?.id || 'No map';
        if (dom.contextName) dom.contextName.textContent = currentMap?.name || currentMap?.id || 'Choose a map';
        syncFormAccess(dom.mapSettingsForm);
    }

    function updateTreeAfterSettingsChange() {
        if (!state.currentMap || !canMutateWorkspace()) return;

        const nextSettings = readMapSettingsForm();
        utils.applyMapSettings(state.currentMap, nextSettings);

        const parentId = dom.mapSettingsInputs.parentId.value;
        const orderValue = dom.mapSettingsInputs.order.value;
        const currentLocation = findNodeLocation(state.atlasTree, state.currentMap.id);
        const nextOrder = Number.isFinite(Number(orderValue)) ? Number(orderValue) : currentLocation?.index || 0;
        const currentParentId = currentLocation?.parentId || '';
        const currentOrder = currentLocation?.index || 0;

        if (parentId !== currentParentId || nextOrder !== currentOrder) {
            state.atlasTree = moveNodeInTree(state.atlasTree, state.currentMap.id, parentId, nextOrder);
            if (parentId) state.expandedFolderIds.add(parentId);
            state.currentMap = utils.findMapRecursive(state.atlasTree, state.currentMap.id);
        }

        renderAtlasTree();
        renderMapSettingsForm();
        updateMapHome();
        renderMapLayers(true);
        setSelectionStatus(`Updated map settings for "${state.currentMap.name || state.currentMap.id}".`);
    }

    function getGeometryEditingContext() {
        if (dom.appShell.dataset.mode === 'draw' && ['region', 'line'].includes(state.drawMode)) {
            state.draftHandles = utils.normalizeBezierHandles(state.draftCoordinates, state.draftHandles);
            return { isDraft: true, anchors: state.draftCoordinates, handles: state.draftHandles, closed: state.drawMode === 'region' };
        }
        const feature = getSelectedFeature();
        if (!feature || !['regions', 'lines'].includes(state.selectedFeature?.mode) || state.activeTool !== 'select') return null;
        const closed = state.selectedFeature.mode === 'regions';
        const geometry = utils.getFeatureBezierGeometry(feature, closed);
        const anchors = geometry?.anchors || feature.coordinates || [];
        return { feature, anchors, handles: geometry?.handles || anchors.map(() => null), closed };
    }

    function storeGeometry(context) {
        if (context.isDraft) {
            state.draftCoordinates = context.anchors;
            state.draftHandles = context.handles;
            return;
        }
        context.feature.coordinates = utils.sampleBezierPath(context.anchors, context.handles, context.closed);
        if (context.handles.some(handle => handle?.in || handle?.out)) {
            context.feature.bezier = { version: 1, anchors: context.anchors, handles: context.handles };
        } else {
            delete context.feature.bezier;
        }
    }

    function syncCurvePointControl() {
        const context = getGeometryEditingContext();
        const index = state.selectedVertexIndex;
        const selected = context && index >= 0 && index < context.anchors.length;
        const curved = Boolean(selected && (context.handles[index]?.in || context.handles[index]?.out));
        dom.curvePointButton.hidden = !context;
        dom.curvePointButton.disabled = !selected || context.anchors.length < (context.closed ? 3 : 2) || !canMutateWorkspace();
        dom.curvePointButton.textContent = curved ? 'Make corner' : 'Curve point';
        dom.curvePointButton.setAttribute('aria-pressed', String(curved));
        dom.curvePointButton.title = curved ? 'Remove the selected point’s Bezier handles' : 'Add Bezier handles to the selected point';
        if (dom.geometryHelp) {
            dom.geometryHelp.hidden = !context;
            dom.geometryHelp.textContent = selected
                ? (curved ? `Point ${index + 1}: curve. Drag the blue handles independently to shape each side.` : `Point ${index + 1}: sharp corner. Choose Curve point to add blue handles.`)
                : 'Click to place points. Select an orange point, then Curve point to add Bezier handles.';
        }
    }

    function updateGeometryPreview(context) {
        storeGeometry(context);
        const coordinates = utils.sampleBezierPath(context.anchors, context.handles, context.closed);
        const group = context.isDraft ? state.draftLayer : (context.closed ? state.regionLayer : state.lineLayer);
        group.eachLayer(layer => {
            if (context.isDraft ? layer.editorGeometryOutline : layer.editorFeature === context.feature) layer.setLatLngs(coordinates);
        });
    }

    function finishGeometryEdit(context) {
        state.geometryDragActive = false;
        storeGeometry(context);
        if (context.isDraft) {
            renderDraftGeometry();
            markGeometryDraftUnsaved();
        } else {
            renderMapLayers(false);
            renderFeatureInspector();
            renderFeatureLists();
            markCurrentMapDirty('Geometry changed.');
        }
        syncToolbarState();
    }

    function toggleSelectedPointCurve() {
        const context = getGeometryEditingContext();
        const index = state.selectedVertexIndex;
        if (!context || !context.anchors[index] || context.anchors.length < 2 || !canMutateWorkspace()) return;
        const current = context.handles[index];
        const next = current?.in || current?.out ? null : utils.createBezierHandles(context.anchors, index, context.closed);
        if (!next && !current) return;
        if (!context.isDraft) checkpointHistory(next ? 'Curve geometry point' : 'Make sharp corner');
        context.handles[index] = next;
        finishGeometryEdit(context);
    }

    function renderGeometryHandles(context, group) {
        const selected = state.selectedVertexIndex;
        const controlDisplays = [];
        const refreshGuides = () => controlDisplays.forEach(({ side, marker, guide }) => {
            const point = context.handles[selected]?.[side];
            if (!point) return;
            marker.setLatLng(point);
            guide.setLatLngs([context.anchors[selected], point]);
        });
        const icon = (control, active = false) => L.divIcon({
            className: `editor-draft-vertex-handle${control ? ' editor-bezier-control' : ''}${active ? ' is-selected' : ''}`,
            html: '<div class="editor-vertex-icon"></div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        const choosePoint = index => {
            state.selectedVertexIndex = index;
            if (context.isDraft) {
                renderDraftGeometry();
                persistRecoverySnapshot();
            } else renderVertexHandles();
            syncToolbarState();
        };
        context.anchors.forEach((coordinate, index) => {
            const marker = L.marker(coordinate, {
                icon: icon(false, index === selected),
                draggable: true,
                keyboard: true,
                title: `${context.isDraft ? 'Drawing' : 'Shape'} point ${index + 1}: select or drag`
            });
            marker.on('click', () => choosePoint(index));
            marker.on('dragstart', () => {
                state.geometryDragActive = true;
                if (!context.isDraft) checkpointHistory('Move geometry point');
                state.selectedVertexIndex = index;
            });
            marker.on('drag', event => {
                const next = roundLatLng(event.target.getLatLng());
                const previous = context.anchors[index];
                const handles = context.handles[index];
                for (const side of ['in', 'out']) {
                    if (handles?.[side]) handles[side] = handles[side].map((value, axis) => value + next[axis] - previous[axis]);
                }
                context.anchors[index] = next;
                refreshGuides();
                updateGeometryPreview(context);
            });
            marker.on('dragend', () => finishGeometryEdit(context));
            group.addLayer(marker);
        });
        for (const side of ['in', 'out']) {
            const coordinate = context.handles[selected]?.[side];
            if (!coordinate || (!context.closed && ((side === 'in' && selected === 0) || (side === 'out' && selected === context.anchors.length - 1)))) continue;
            const guide = L.polyline([context.anchors[selected], coordinate], { color: '#2563eb', weight: 1.5, dashArray: '4 4', interactive: false });
            const marker = L.marker(coordinate, {
                icon: icon(true), draggable: true, keyboard: false,
                title: `${side === 'in' ? 'Incoming' : 'Outgoing'} Bezier handle for point ${selected + 1}`
            });
            marker.on('dragstart', () => {
                state.geometryDragActive = true;
                if (!context.isDraft) checkpointHistory('Move Bezier handle');
            });
            marker.on('drag', event => {
                context.handles[selected][side] = roundLatLng(event.target.getLatLng());
                refreshGuides();
                updateGeometryPreview(context);
            });
            marker.on('dragend', () => finishGeometryEdit(context));
            group.addLayer(guide);
            group.addLayer(marker);
            controlDisplays.push({ side, marker, guide });
        }
    }

    function renderDraftGeometry() {
        state.draftLayer.clearLayers();
        if (!state.drawMode || !state.draftCoordinates.length) return;
        const context = getGeometryEditingContext();
        if (!context?.isDraft) return;
        const coordinates = utils.sampleBezierPath(context.anchors, context.handles, context.closed);
        const options = { color: '#f97316', weight: 3, dashArray: '6 4', interactive: false, fillOpacity: 0.12 };
        const outline = context.closed && coordinates.length >= 2 ? L.polygon(coordinates, options) : L.polyline(coordinates, options);
        outline.editorGeometryOutline = true;
        state.draftLayer.addLayer(outline);
        if (canMutateWorkspace()) renderGeometryHandles(context, state.draftLayer);
    }

    function undoDraftPoint() {
        if (!canMutateWorkspace() || !state.draftCoordinates.length) return;
        state.draftCoordinates.pop();
        state.draftHandles?.pop();
        state.selectedVertexIndex = state.draftCoordinates.length - 1;
        renderDraftGeometry();
        syncToolbarState();
        if (hasUnfinishedGeometryDraft()) markGeometryDraftUnsaved();
        else reconcileCurrentMapDirty('Removed the last drawing point.');
        setSelectionStatus(`${state.draftCoordinates.length} points. Click to add points; Enter finishes, Esc cancels.`);
    }

    function renderVertexHandles() {
        state.vertexLayer.clearLayers();
        if (state.drawMode || !canMutateWorkspace()) return;
        const context = getGeometryEditingContext();
        if (context && !context.isDraft) renderGeometryHandles(context, state.vertexLayer);
    }

    function handleUnrenderableMap() {
        clearMapVisualLayers();
        state.currentBounds = null;
        setMapEmptyState({
            hidden: false,
            title: 'No Renderable Map Selected',
            copy: 'Select a map with image data to edit points, regions, and lines.',
            detail: state.currentMap
                ? `Image URL: ${state.currentMap.imageUrl || 'Missing imageUrl'}`
                : ''
        });
        setSelectionStatus('This map does not have renderable image data yet.');
        renderVertexHandles();
        renderDraftGeometry();
        syncToolbarState();
    }

    function setupImageUnderlay(mapHeight, mapWidth, nextBounds) {
        clearMapVisualLayers();
        state.currentBounds = nextBounds;
        state.underlayLayer = L.rectangle(nextBounds, {
            stroke: false,
            fill: true,
            fillOpacity: 1,
            fillColor: state.currentMap.backgroundColor || '#0f172a',
            interactive: false,
            pane: 'tilePane'
        }).addTo(state.map);
        setMapEmptyState({
            hidden: false,
            title: 'Loading Map Image',
            copy: `Loading "${state.currentMap.name || state.currentMap.id}" into the editor canvas...`,
            detail: `Image URL: ${state.currentMap.imageUrl}`
        });
        setSelectionStatus(`Loading image for "${state.currentMap.name || state.currentMap.id}"...`);

        const imageLayer = L.imageOverlay(state.currentMap.imageUrl, nextBounds);
        imageLayer.once('load', () => {
            if (state.imageLayer !== imageLayer) return;
            setMapEmptyState({ hidden: true });
            setSelectionStatus(`Image loaded for "${state.currentMap.name || state.currentMap.id}".`);
            queueMapViewportReset();
        });
        imageLayer.once('error', () => {
            if (state.imageLayer !== imageLayer) return;
            state.map.removeLayer(imageLayer);
            state.imageLayer = null;
            setMapEmptyState({
                hidden: false,
                title: 'Image Failed To Load',
                copy: `The editor could not render "${state.currentMap.name || state.currentMap.id}".`,
                detail: `Image URL: ${state.currentMap.imageUrl}`
            });
            setSelectionStatus(`Image failed to load for "${state.currentMap.name || state.currentMap.id}".`);
        });
        state.imageLayer = imageLayer;
        state.imageLayer.addTo(state.map);
    }

    const pointIconCache = new Map();
    function getEditorPointIcon(type) {
        const normalized = String(type || '').trim().toLowerCase();
        const typeIcons = window.AppConfig?.get('assets.poiTypeIcons', {}) || {};
        const groups = window.AppConfig?.get('taxonomy.poiTypeGroups', {}) || {};
        const groupIcons = window.AppConfig?.get('assets.poiIcons', {}) || {};
        const typeKey = Object.keys(typeIcons).find(key => key.trim().toLowerCase() === normalized);
        const group = Object.keys(groups).find(key => groups[key].some(value => value.trim().toLowerCase() === normalized));
        const iconUrl = typeIcons[typeKey] || groupIcons[group] || groupIcons.Unknown || 'images/poi-icons/unknown.webp';
        if (!pointIconCache.has(iconUrl)) {
            pointIconCache.set(iconUrl, L.icon({ iconUrl, iconSize: [36, 48], iconAnchor: [18, 47], popupAnchor: [0, -40], className: 'poi-custom-icon' }));
        }
        return pointIconCache.get(iconUrl);
    }

    function renderPointsLayer() {
        getCurrentPoints().forEach((point, index) => {
            if (dom.appShell.dataset.mode === 'draw') return;
            if (dom.appShell.dataset.mode === 'feature-edit' &&
                (state.selectedFeature?.mode !== 'points' || state.selectedFeature.index !== index)) return;
            if (!Array.isArray(point.coords) || point.coords.length !== 2) return;
            const markerLabel = getPointMarkerAccessibleName(point, index);
            const marker = L.marker(point.coords, {
                icon: getEditorPointIcon(point.type),
                draggable: canMutateWorkspace() && state.activeTool === 'select',
                title: markerLabel,
                alt: markerLabel
            });
            marker.on('click', () => {
                if (state.activeTool === 'select' || state.activeTool === 'features') selectFeature('points', index);
            });
            marker.on('dragstart', () => checkpointHistory(`Move ${point.name || `POI ${index + 1}`}`));
            marker.on('drag', (event) => {
                point.coords = roundLatLng(event.target.getLatLng());
            });
            marker.on('dragend', () => {
                renderFeatureInspector();
                renderFeatureLists();
                markCurrentMapDirty('POI position changed.');
                setSelectionStatus(`Moved POI "${point.name || `POI ${index + 1}`}".`);
            });
            state.pointLayer.addLayer(marker);
        });
    }

    function renderRegionsLayer() {
        getCurrentRegions().forEach((region, index) => {
            if (dom.appShell.dataset.mode === 'draw') return;
            if (dom.appShell.dataset.mode === 'feature-edit' &&
                (state.selectedFeature?.mode !== 'regions' || state.selectedFeature.index !== index)) return;
            if (!Array.isArray(region.coordinates) || region.coordinates.length < 3) return;
            const layer = L.polygon(region.coordinates, {
                color: region.color || '#2563eb',
                fillColor: region.fillColor || region.color || '#2563eb',
                fillOpacity: Number(region.fillOpacity ?? 0.2),
                weight: state.selectedFeature?.mode === 'regions' && state.selectedFeature.index === index ? 3 : 2
            });
            layer.on('click', () => {
                if (state.activeTool === 'select' || state.activeTool === 'features') selectFeature('regions', index);
            });
            layer.editorFeature = region;
            state.regionLayer.addLayer(layer);
        });
    }

    function renderLinesLayer() {
        getCurrentLines().forEach((line, index) => {
            if (dom.appShell.dataset.mode === 'draw') return;
            if (dom.appShell.dataset.mode === 'feature-edit' &&
                (state.selectedFeature?.mode !== 'lines' || state.selectedFeature.index !== index)) return;
            if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) return;
            const layer = L.polyline(line.coordinates, {
                color: line.color || '#0f766e',
                weight: Number(line.weight || 3),
                dashArray: line.dashArray || ''
            });
            layer.on('click', () => {
                if (state.activeTool === 'select' || state.activeTool === 'features') selectFeature('lines', index);
            });
            layer.editorFeature = line;
            state.lineLayer.addLayer(layer);
        });
    }

    function renderMapLayers(resetView) {
        // A deferred form or layout refresh must not remove the active marker before dragend,
        // which records the edit and refreshes the inspector and save controls.
        if (state.geometryDragActive) return;
        state.pointLayer.clearLayers();
        state.regionLayer.clearLayers();
        state.lineLayer.clearLayers();
        state.journeyLayer.clearLayers();

        const mapIsRenderable = canRenderMap(state.currentMap);

        if (!mapIsRenderable) {
            handleUnrenderableMap();
            return;
        }

        const mapHeight = Number(state.currentMap.height);
        const mapWidth = Number(state.currentMap.width);
        const nextBounds = [[0, 0], [mapHeight, mapWidth]];
        const needsImageReset = !state.currentBounds ||
            state.currentBounds[1][0] !== mapHeight ||
            state.currentBounds[1][1] !== mapWidth ||
            !state.imageLayer ||
            state.imageLayer._url !== state.currentMap.imageUrl;

        if (needsImageReset) {
            setupImageUnderlay(mapHeight, mapWidth, nextBounds);
        } else if (state.underlayLayer) {
            // ⚡ Bolt: Check existing options before applying setStyle to prevent costly redundant Leaflet DOM updates
            const targetColor = state.currentMap.backgroundColor || '#0f172a';
            if (state.underlayLayer.options.fillColor !== targetColor || state.underlayLayer.options.color !== targetColor) {
                state.underlayLayer.setStyle({
                    fillColor: targetColor,
                    color: targetColor
                });
            }
            setMapEmptyState({ hidden: true });
        }

        renderPointsLayer();
        renderRegionsLayer();
        renderLinesLayer();
        renderJourneysLayer();

        renderVertexHandles();
        renderDraftGeometry();

        if (resetView && state.currentBounds) {
            queueMapViewportReset();
        }

        syncToolbarState();
    }

    function scheduleMapLayerRender(resetView, mapId = state.currentMapId) {
        scheduleMapLayout(() => {
            if (state.currentMapId !== mapId) return;
            renderMapLayers(resetView);
        });
    }

    function finishDraftGeometry() {
        if (!state.currentMap || !canMutateWorkspace()) return;
        const draft = utils.sampleBezierPath(state.draftCoordinates, state.draftHandles, state.drawMode === 'region');
        const bezier = state.draftHandles?.some(handle => handle?.in || handle?.out)
            ? { bezier: { version: 1, anchors: utils.cloneJson(state.draftCoordinates), handles: utils.cloneJson(state.draftHandles) } }
            : {};
        if (state.drawMode === 'region') {
            if (draft.length < 3) {
                setSelectionStatus('A region needs at least 3 points.');
                return;
            }
            checkpointHistory('Create region');
            getCurrentRegions().push({
                id: `region-${Date.now()}`,
                name: '',
                type: '',
                value: '',
                description: '',
                summary: '',
                wikiLink: '',
                linkedMapId: '',
                color: '#2563eb',
                fillColor: '#60a5fa',
                fillOpacity: 0.2,
                coordinates: draft,
                ...bezier,
                properties: {}
            });
            clearDrawMode();
            state.featureListState.type = 'regions';
            selectFeature('regions', getCurrentRegions().length - 1);
            markCurrentMapDirty('New region needs a name before it can be saved.');
            setSelectionStatus('Region created. Give it an intentional name before saving.');
            requestAnimationFrame(() => dom.featureForm.querySelector('[data-field="name"]')?.focus());
            return;
        }

        if (draft.length < 2) {
            setSelectionStatus('A line needs at least 2 points.');
            return;
        }
        checkpointHistory('Create line');
        getCurrentLines().push({
            id: `line-${Date.now()}`,
            name: '',
            type: '',
            color: '#0f766e',
            weight: 3,
            dashArray: '',
            description: '',
            summary: '',
            wikiLink: '',
            linkedMapId: '',
            coordinates: draft,
            ...bezier,
            properties: {}
        });
        clearDrawMode();
        state.featureListState.type = 'lines';
        selectFeature('lines', getCurrentLines().length - 1);
        markCurrentMapDirty('New line needs a name before it can be saved.');
        setSelectionStatus('Line created. Give it an intentional name before saving.');
        requestAnimationFrame(() => dom.featureForm.querySelector('[data-field="name"]')?.focus());
    }

    function handleMapClick(event) {
        if (!state.currentMap || !canRenderMap(state.currentMap) || !canMutateWorkspace()) return;
        if (state.placingJourneyStop && state.selectedFeature?.mode === 'journeys') {
            const journey = getSelectedFeature();
            checkpointHistory('Add journey stop');
            journey.stops.push({ id: CampaignJourneys.createId(), name: `Stop ${journey.stops.length + 1}`, coords: roundLatLng(event.latlng), date: '', session: '', description: '', wikiLink: '' });
            const index = state.selectedFeature.index;
            selectFeature('journeys', index);
            markCurrentMapDirty('Journey stop added.');
            focusJourneyStop(journey.stops.length - 1);
            return;
        }
        // Drafts survive task navigation but accept vertices only in drawing mode.
        if (dom.appShell.dataset.mode !== 'draw') return;
        const coordinate = roundLatLng(event.latlng);

        if (state.drawMode === 'point') {
            checkpointHistory('Create POI');
            getCurrentPoints().push({
                name: '',
                coords: coordinate,
                type: '',
                description: '',
                summary: '',
                wikiLink: '',
                linkedMapId: '',
                detailSections: [],
                tags: [],
                properties: {}
            });
            clearDrawMode();
            state.featureListState.type = 'points';
            selectFeature('points', getCurrentPoints().length - 1);
            markCurrentMapDirty('New point needs a name before it can be saved.');
            setSelectionStatus('Point placed. Complete its name and type before saving.');
            requestAnimationFrame(() => {
                const nameInput = dom.featureForm.querySelector('[data-field="name"]');
                nameInput?.focus();
            });
            return;
        }

        if (state.drawMode === 'region' || state.drawMode === 'line') {
            state.draftCoordinates.push(coordinate);
            (state.draftHandles ||= []).push(null);
            const previousIndex = state.draftCoordinates.length - 2;
            const previousHandles = state.draftHandles[previousIndex];
            if (state.drawMode === 'line' && previousHandles?.in && !previousHandles.out) {
                previousHandles.out = utils.createBezierHandles(state.draftCoordinates, previousIndex, false)?.out || null;
            }
            state.selectedVertexIndex = state.draftCoordinates.length - 1;
            renderDraftGeometry();
            syncToolbarState();
            const minimumPoints = state.drawMode === 'region' ? 3 : 2;
            const remainingPoints = Math.max(0, minimumPoints - state.draftCoordinates.length);
            const draftLabel = state.drawMode === 'region' ? 'Region' : 'Route';
            setSelectionStatus(remainingPoints > 0
                ? `${draftLabel}: ${state.draftCoordinates.length} points. Add ${remainingPoints} more.`
                : `${draftLabel}: ${state.draftCoordinates.length} points. Select Finish when done.`);
            markGeometryDraftUnsaved();
        }
    }

    function deleteSelectedFeature() {
        if (!state.selectedFeature || !canMutateWorkspace()) return;
        const feature = getSelectedFeature();
        const label = feature.name || feature.id || 'this feature';
        if (!window.confirm(`Are you sure you want to delete ${label}?`)) return;
        checkpointHistory(`Delete ${label}`);
        const collection = getCurrentFeatureCollection(state.selectedFeature.mode);
        collection.splice(state.selectedFeature.index, 1);
        deselectFeature();
        renderFeatureLists();
        renderMapLayers(false);
        markCurrentMapDirty('Deleted feature not saved.');
        setSelectionStatus('Deleted the selected feature.');
        openFeatureBrowser(state.featureListState.type);
    }

    function beginDrawMode(mode) {
        if (!canRenderMap(state.currentMap) || !canMutateWorkspace()) {
            setSelectionStatus('Drawing is locked. Start or open a writable workspace in Studio.');
            return;
        }
        if (hasUnfinishedGeometryDraft()) {
            if (mode === state.drawMode) {
                setWorkflowMode('draw');
                renderDraftGeometry();
                setSelectionStatus(`Continue the current ${state.drawMode}, then finish or cancel the drawing.`);
                return;
            }
            setSelectionStatus(`Finish or cancel the current ${state.drawMode} before starting another drawing.`);
            return;
        }
        state.drawMode = mode;
        state.draftCoordinates = [];
        state.draftHandles = [];
        state.selectedVertexIndex = -1;
        setWorkflowMode('draw');
        deselectFeature();
        renderDraftGeometry();
        syncToolbarState();
        setSelectionStatus(mode === 'point'
            ? 'Click the map to place a new point.'
            : `Place ${mode} points. Select a point and choose Curve point for Bezier handles. Enter finishes; Esc cancels.`);
    }

    function getExportFileName(url, fallbackId) {
        const normalizedUrl = String(url || '').trim();
        if (normalizedUrl) {
            const parts = normalizedUrl.split('/');
            return parts[parts.length - 1];
        }
        return `${String(fallbackId || 'map').trim() || 'map'}.json`;
    }

    function downloadJsonFile(fileName, value) {
        const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
    }

    function getCurrentMapDataUrl() {
        const formDataUrl = dom.mapSettingsInputs?.dataUrl
            ? String(dom.mapSettingsInputs.dataUrl.value || '').trim()
            : '';
        return formDataUrl || String(state.currentMapDataUrl || state.currentMap?.dataUrl || '').trim();
    }

    function exportCurrentMapJson() {
        if (!state.currentMap) return;
        try {
            const journeyErrors = CampaignJourneys.validate(state.currentMap.journeys);
            if (journeyErrors.length) throw new Error(journeyErrors[0]);
            const exportedDocument = serializePreservedMap({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap.id,
                collectedPoints: getCurrentPoints(),
                collectedRegions: getCurrentRegions(),
                collectedLines: getCurrentLines(),
                lineCollectionKey: state.lineCollectionKey,
                mapSettings: readMapSettingsForm()
            });
            const fileName = getExportFileName(getCurrentMapDataUrl(), state.currentMap.id);
            downloadJsonFile(fileName, exportedDocument);
            setExportStatus(`Exported ${fileName}.`);
        } catch (error) {
            console.error(error);
            setExportStatus(error.message || 'Could not export the current map.', true);
        }
    }

    async function saveEditorDocument(endpoint, payload) {
        if (state.downloadOnly) throw new Error('Server writes are disabled. Download your changes instead.');
        if (!state.localSaveAvailable) {
            throw new Error('Direct saves require the local editor server. Run npm run editor.');
        }

        const headers = {
            'Content-Type': 'application/json'
        };
        if (window.location.pathname === '/studio/editor') {
            const sessionResponse = await fetch('/api/studio/session', { cache: 'no-store' });
            const session = sessionResponse.ok ? await sessionResponse.json() : null;
            if (!session || session.authenticated !== true || !session.csrfToken) {
                throw new Error('Your Map Studio session has expired. Sign in again.');
            }
            headers['X-CSRF-Token'] = session.csrfToken;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(state.fileMode ? { ...payload, expectedVersions: state.fileVersions } : payload)
        });
        let result = null;
        try {
            result = await response.json();
        } catch (error) {
            result = null;
        }
        if (!response.ok || !result || result.ok !== true) {
            throw new Error(result?.error || `Save failed with HTTP ${response.status}.`);
        }
        if (result.versions) Object.assign(state.fileVersions, result.versions);
        return result;
    }

    async function saveCurrentMapJson() {
        if (!state.currentMap || !state.editorDirty || state.saveInProgress || !canMutateWorkspace()) return;
        if (hasUnfinishedGeometryDraft()) {
            setExportStatus(`Finish or cancel the current ${state.drawMode} drawing before saving.`, true);
            return;
        }
        if (!dom.mapSettingsForm.checkValidity()) {
            dom.mapSettingsForm.reportValidity();
            setExportStatus('Fix the map form before saving.', true);
            return;
        }
        if (!flushSelectedFeatureForm()) return;
        try {
            updateTreeAfterSettingsChange();
        } catch (error) {
            setExportStatus(error.message || 'Fix the map settings before saving.', true);
            return;
        }
        const incompleteFeature = getIncompleteFeature();
        if (incompleteFeature) {
            state.featureListState.type = incompleteFeature.mode;
            state.selectedFeature = { mode: incompleteFeature.mode, index: incompleteFeature.index };
            setInspectorCollapsed(false);
            setWorkflowMode('feature-edit');
            renderFeatureInspector();
            const nameInput = dom.featureForm.querySelector('[data-field="name"]');
            nameInput?.focus();
            setExportStatus('Give the new feature an intentional name before saving.', true);
            return;
        }
        state.saveInProgress = true;
        state.saveError = false;
        dom.exportStatus.style.color = '';
        syncEditingAvailability();
        refreshSaveControls();
        try {
            const journeyErrors = CampaignJourneys.validate(state.currentMap.journeys);
            if (journeyErrors.length) throw new Error(journeyErrors[0]);
            const exportedDocument = serializePreservedMap({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap.id,
                collectedPoints: getCurrentPoints(),
                collectedRegions: getCurrentRegions(),
                collectedLines: getCurrentLines(),
                lineCollectionKey: state.lineCollectionKey,
                mapSettings: readMapSettingsForm()
            });
            const exportedManifest = serializePreservedManifest({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap.id,
                mapSettings: readMapSettingsForm()
            });
            const currentMapDataUrl = getCurrentMapDataUrl();
            const fileName = getExportFileName(currentMapDataUrl, state.currentMap.id);
            if (state.downloadOnly) {
                const downloads = window.MapFileDownload;
                if (JSON.stringify(exportedManifest) === JSON.stringify(state.manifestSource)) {
                    downloadJsonFile(fileName, exportedDocument);
                } else {
                    const archive = await downloads.archive([
                        { name: `maps/${fileName}`, data: downloads.json(exportedDocument) },
                        { name: 'maps/maps.json', data: downloads.json(exportedManifest) }
                    ]);
                    downloads.download(`${state.currentMap.id}-changes.zip`, archive);
                }
                state.hasDownloaded = true;
                recordSavedWorkspaceBaseline({ clearRecovery: true });
                setExportStatus('Download requested. Server files and the website are unchanged.');
                return;
            }
            dom.exportStatus.textContent = `Saving ${fileName} and maps.json...`;
            const result = await saveEditorDocument('/api/editor/save-workspace', {
                map: {
                    mapId: state.currentMap.id,
                    dataUrl: currentMapDataUrl,
                    fileName,
                    document: exportedDocument
                },
                atlas: {
                    document: exportedManifest
                }
            });
            recordSavedWorkspaceBaseline({ clearRecovery: true });
            state.saveError = false;
            dom.exportStatus.style.color = '';
            const savedFiles = Array.isArray(result.saved) ? result.saved.join(' and ') : String(result.saved || fileName);
            dom.exportStatus.textContent = state.fileMode ? 'Saved to map files on this computer.' : `Saved ${savedFiles}; validation passed.`;
            setReadinessItem('currentMapSaved', 'pass', `Saved ${savedFiles}.`);
            setReadinessItem('atlasRegenerated', 'pass', state.fileMode ? 'Source JSON files saved.' : `Regenerated ${result.atlas}.`);
            setReadinessItem('dataValidation', 'pass', 'Validation passed.');
            applyServerReadiness(result.readiness);
        } catch (error) {
            console.error(error);
            state.saveError = true;
            dom.exportStatus.textContent = error.message || 'Could not save editor changes.';
            dom.exportStatus.style.color = '#dc2626';
            setReadinessItem('currentMapSaved', 'fail', error.message || 'Save failed.');
        } finally {
            state.saveInProgress = false;
            syncEditingAvailability();
            refreshSaveControls();
            refreshBuildPreviewButtonState();
        }
    }

    function exportAtlasStructure() {
        try {
            const exportedManifest = serializePreservedManifest({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap?.id || '',
                mapSettings: state.currentMap ? readMapSettingsForm() : {}
            });
            downloadJsonFile('maps.json', exportedManifest);
            setExportStatus('Exported maps.json.');
        } catch (error) {
            console.error(error);
            setExportStatus(error.message || 'Could not export maps.json.', true);
        }
    }

    async function saveAtlasStructure() {
        if (state.downloadOnly) {
            if (!canMutateWorkspace() || hasUnfinishedGeometryDraft()) return;
            exportAtlasStructure();
            return;
        }
        if (state.saveInProgress || !canMutateWorkspace()) return;
        if (hasUnfinishedGeometryDraft()) {
            setExportStatus(`Finish or cancel the current ${state.drawMode} drawing before saving maps.json.`, true);
            return;
        }
        state.saveInProgress = true;
        state.saveError = false;
        syncEditingAvailability();
        refreshSaveControls();
        try {
            const exportedManifest = serializePreservedManifest({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap?.id || '',
                mapSettings: state.currentMap ? readMapSettingsForm() : {}
            });
            setExportStatus('Saving maps.json...');
            const result = await saveEditorDocument('/api/editor/save-atlas', {
                document: exportedManifest
            });
            setExportStatus(`Saved ${result.saved} and regenerated ${result.atlas}.`);
            setReadinessItem('atlasRegenerated', 'pass', state.fileMode ? 'Source JSON files saved.' : `Regenerated ${result.atlas}.`);
            setReadinessItem('dataValidation', 'pass', 'Validation passed.');
            applyServerReadiness(result.readiness);
        } catch (error) {
            console.error(error);
            setExportStatus(error.message || 'Could not save maps.json.', true);
            setReadinessItem('atlasRegenerated', 'fail', error.message || 'Atlas save failed.');
        } finally {
            state.saveInProgress = false;
            syncEditingAvailability();
            refreshSaveControls();
        }
    }

    function delay(milliseconds) {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }

    async function fetchPreviewBuildStatus(statusUrl) {
        const response = await fetch(statusUrl, { cache: 'no-store' });
        let result = null;
        try {
            result = await response.json();
        } catch (error) {
            result = null;
        }
        if (!response.ok || !result) {
            throw new Error(result?.error || `Preview status failed with HTTP ${response.status}.`);
        }
        return result;
    }

    async function waitForPreviewBuild(statusUrl) {
        let lastResult = null;
        for (;;) {
            await delay(900);
            const result = await fetchPreviewBuildStatus(statusUrl);
            lastResult = result;
            state.publishReadiness.buildJob = result;
            renderPublishReadiness();
            if (result.status === 'complete') return result;
            if (result.status === 'interrupted') {
                throw new Error(result.error || 'Preview build was interrupted. Start the build again.');
            }
            if (result.status === 'failed' || result.ok === false) {
                throw new Error(result.error || 'Preview build failed.');
            }
        }
    }

    async function buildLivePreview() {
        if (hasUnsavedEditorWork()) {
            const message = hasUnfinishedGeometryDraft()
                ? 'Finish or cancel the current drawing before building live preview.'
                : 'Save current map changes before building live preview.';
            setReadinessItem('currentMapSaved', 'warn', message);
            setExportStatus(message, true);
            return;
        }
        try {
            setExportStatus('Building live preview...');
            setReadinessItem('pagesBundle', 'pending', 'Building dist/...');
            if (dom.buildLivePreviewButton) dom.buildLivePreviewButton.disabled = true;
            const initialJob = await saveEditorDocument('/api/editor/build-preview', {});
            state.publishReadiness.buildJob = {
                status: initialJob.status || 'running',
                step: initialJob.step || 'Queued',
                steps: initialJob.steps || [],
                recentOutput: []
            };
            renderPublishReadiness();
            const statusUrl = initialJob.statusUrl || `/api/editor/build-preview-status?id=${encodeURIComponent(initialJob.jobId || '')}`;
            const result = await waitForPreviewBuild(statusUrl);
            state.publishReadiness.previewUrl = result.previewUrl || '/preview/';
            setReadinessItem('atlasRegenerated', 'pass', 'Regenerated for preview.');
            setReadinessItem('dataValidation', 'pass', 'Validation passed for preview.');
            applyServerReadiness(result.readiness);
            setExportStatus(`Built live preview at ${state.publishReadiness.previewUrl}`);
        } catch (error) {
            console.error(error);
            setReadinessItem('pagesBundle', 'fail', error.message || 'Preview build failed.');
            setExportStatus(error.message || 'Could not build live preview.', true);
        } finally {
            refreshBuildPreviewButtonState();
        }
    }

    async function selectMap(mapId, options = {}) {
        const selectionRequestId = ++state.mapSelectionRequestId;
        const atlasNode = utils.findMapRecursive(state.atlasTree, mapId);
        if (!atlasNode) {
            throw new Error(`Could not find map "${mapId}".`);
        }
        let resolvedMap = atlasNode;
        let rawDocument = null;
        let rawRevision = null;
        const resolvedDataUrl = String(atlasNode.dataUrl || '').trim();

        const canResolve = Boolean(
            String(atlasNode.dataUrl || '').trim() ||
            String(atlasNode.imageUrl || '').trim() ||
            Array.isArray(atlasNode.pointsOfInterest) ||
            Array.isArray(atlasNode.regions) ||
            Array.isArray(atlasNode.lines) ||
            Array.isArray(atlasNode.roads)
        );

        if (canResolve) {
            try {
                if (resolvedDataUrl) {
                    const response = await fetch(resolvedDataUrl.startsWith('/') ? resolvedDataUrl : '/' + resolvedDataUrl, { cache: 'no-store' });
                    if (!response.ok) throw new Error(`Could not load map JSON (HTTP ${response.status}).`);
                    rawDocument = await response.json();
                    rawRevision = response.headers.get('ETag');
                    resolvedMap = { ...atlasNode, ...utils.cloneJson(rawDocument) };
                } else {
                    resolvedMap = await utils.resolveFileBackedMapDocument(atlasNode, {
                        loadJsonByPath: async relativePath => {
                            const value = await fetchJsonAsset(relativePath);
                            rawDocument = utils.cloneJson(value);
                            return value;
                        }
                    });
                    rawDocument ||= utils.cloneJson(resolvedMap);
                }
            } catch (error) {
                if (selectionRequestId !== state.mapSelectionRequestId) return false;
                throw error;
            }
        }
        if (selectionRequestId !== state.mapSelectionRequestId) return false;

        if (resolvedDataUrl && resolvedMap && typeof resolvedMap === 'object') {
            resolvedMap = { ...resolvedMap, dataUrl: resolvedDataUrl };
        }

        if (state.fileMode && rawRevision && resolvedDataUrl) state.fileVersions[resolvedDataUrl.replace(/^\//, '')] = rawRevision;
        state.fileSnapshot = null;
        state.hasDownloaded = false;
        state.currentMapId = mapId;
        state.currentMapDataUrl = resolvedDataUrl;
        if (options.deferMapRender) {
            state.drawMode = '';
            state.draftCoordinates = [];
            state.selectedFeature = null;
        } else {
            clearDrawMode();
            deselectFeature();
        }
        state.atlasTree = replaceNodeById(state.atlasTree, mapId, resolvedMap);

        state.currentMap = utils.findMapRecursive(state.atlasTree, mapId);
        if (!state.currentMapDataUrl) {
            state.currentMapDataUrl = String(state.currentMap?.dataUrl || '').trim();
        }
        state.lineCollectionKey = utils.detectLineCollectionKey(state.currentMap);
        if (options.recordRecent) recordRecentMap(mapId);
        editHistory.clear();
        syncHistoryControls();
        renderAtlasTree();
        renderMapSettingsForm();
        renderFeatureLists();
        renderFeatureInspector();
        captureFileBaseline(rawDocument);
        setSelectionStatus(`Editing "${state.currentMap.name || state.currentMap.id}".`);
        recordSavedWorkspaceBaseline();
        state.saveError = false;
        setExportStatus('All changes are saved.');
        setReadinessItem('currentMapSaved', 'pass', 'No unsaved editor changes.');

        setWorkflowMode(options.openMode || 'hub');
        if (options.deferMapRender) {
            scheduleMapLayerRender(true, mapId);
        } else {
            renderMapLayers(true);
            queueMapViewportReset();
        }
        return true;
    }

    function closeUnsavedDialog(clearTransition = true) {
        state.pendingMapId = '';
        if (clearTransition) state.pendingTransition = null;
        if (dom.unsavedDialog?.open) dom.unsavedDialog.close();
    }

    function openUnsavedTransition(transition) {
        state.pendingTransition = {
            originMode: dom.appShell.dataset.mode,
            ...transition
        };
        const incompleteFeature = getIncompleteFeature();
        const unfinishedDraft = hasUnfinishedGeometryDraft();
        const canSaveAndContinue = state.localSaveAvailable && state.editorDirty && !incompleteFeature && !unfinishedDraft;
        dom.saveSwitchButton.disabled = !canSaveAndContinue;
        dom.saveSwitchButton.title = canSaveAndContinue
            ? `Save the current map and ${transition.type === 'map' ? 'switch maps' : 'leave the editor'}.`
            : (unfinishedDraft
                ? 'Finish or cancel the current drawing before saving.'
                : (incompleteFeature
                ? 'Complete the new feature before saving.'
                : (state.localSaveMessage || 'Direct saves are not available in this workspace.')));
        dom.discardSwitchButton.textContent = transition.type === 'map' ? 'Discard and switch' : 'Discard and leave';
        if (state.downloadOnly) document.getElementById('editor-unsaved-copy').textContent = 'Download your edits before leaving, discard them, or keep editing. Server files will not change.';
        dom.saveSwitchButton.textContent = state.downloadOnly ? (transition.type === 'map' ? 'Download and switch' : 'Download and leave') : (transition.type === 'map' ? 'Save and switch' : 'Save and leave');
        dom.unsavedDialog.showModal();
        dom.cancelSwitchButton.focus();
    }

    async function completePendingTransition(transition) {
        if (!transition) return;
        if (transition.type === 'map') {
            await selectMap(transition.mapId, { recordRecent: true });
            return;
        }
        if (transition.type === 'url' && transition.url) {
            window.location.assign(transition.url);
        }
    }

    function requestExternalNavigation(url) {
        if (!url) return;
        if (!hasUnsavedEditorWork()) {
            window.location.assign(url);
            return;
        }
        dom.unsavedCopy.textContent = `Save changes to ${state.currentMap?.name || state.currentMapId} before leaving the editor, discard them, or keep editing.`;
        openUnsavedTransition({ type: 'url', url });
    }

    function isStudioHostedPath(pathname) {
        return String(pathname || '').replace(/\/+$/, '') === '/studio/editor';
    }

    function configureStudioNavigation() {
        const studioHosted = isStudioHostedPath(window.location.pathname);
        [dom.studioHomeLink, dom.menuStudioLink, dom.accessStudioLink, dom.previewStudioLink]
            .filter(Boolean)
            .forEach((link) => {
                link.hidden = !studioHosted;
            });
    }

    async function requestMapSelection(mapId) {
        if (!mapId) return;
        if (mapId === state.currentMapId) {
            if (dom.appShell.dataset.mode === 'library' || dom.appShell.dataset.mode === 'hub') {
                setInspectorCollapsed(true);
                recordRecentMap(mapId);
                if (dom.appShell.dataset.mode === 'library') restoreLibraryReturnContext();
                else {
                    setWorkflowMode('hub');
                    renderMapLayers(true);
                }
            } else {
                openFeatureBrowser(state.featureListState.type);
            }
            return;
        }
        if (!hasUnsavedEditorWork()) {
            await selectMap(mapId, { recordRecent: true });
            return;
        }
        const targetMap = utils.findMapRecursive(state.atlasTree, mapId);
        state.pendingMapId = mapId;
        dom.unsavedCopy.textContent = `Save changes to ${state.currentMap?.name || state.currentMapId} before switching to ${targetMap?.name || mapId}, discard them, or keep editing.`;
        openUnsavedTransition({ type: 'map', mapId });
    }

    function initializeMap() {
        state.map = L.map('editor-map', {
            crs: L.CRS.Simple,
            minZoom: -6,
            maxZoom: 3,
            zoomSnap: 0,
            zoomDelta: 0.25,
            doubleClickZoom: false
        });
        state.map.setView([0, 0], 0, { animate: false });
        state.map.on('click', handleMapClick);
        state.map.on('zoomend', updateZoomStatus);
        updateZoomStatus();

        state.pointLayer = L.layerGroup().addTo(state.map);
        state.regionLayer = L.layerGroup().addTo(state.map);
        state.lineLayer = L.layerGroup().addTo(state.map);
        state.journeyLayer = L.layerGroup().addTo(state.map);
        state.vertexLayer = L.layerGroup().addTo(state.map);
        state.draftLayer = L.layerGroup().addTo(state.map);
        window.addEventListener('resize', () => {
            applyInspectorWidth(state.inspectorWidth, false);
            queueMapLayout();
        });
    }

    function registerEventListeners() {
        dom.journeysButton?.addEventListener('click', () => {
            if (hasUnfinishedGeometryDraft()) { setSelectionStatus('Finish or cancel the drawing first.'); return; }
            clearDrawMode();
            openFeatureBrowser('journeys');
        });
        const debouncedRenderAtlasTree = debounce((value) => {
            state.treeSearch = String(value || '').trim();
            renderAtlasTree();
        }, 300);

        dom.treeSearch.addEventListener('input', (event) => {
            debouncedRenderAtlasTree(event.target.value);
        });

        if (dom.libraryStatusFilter) {
            dom.libraryStatusFilter.addEventListener('change', (event) => {
                const requestedGroup = String(event.target.value || 'all');
                state.libraryStatusFilter = ['active', 'development', 'archived'].includes(requestedGroup)
                    ? requestedGroup
                    : 'all';
                renderAtlasTree();
            });
        }
        if (dom.libraryRecentSelect) {
            dom.libraryRecentSelect.addEventListener('change', (event) => {
                const mapId = String(event.target.value || '').trim();
                event.target.value = '';
                if (!mapId) return;
                requestMapSelection(mapId).catch((error) => {
                    console.error(error);
                    setSelectionStatus(error.message || 'Could not open the recent map.');
                });
            });
        }
        if (dom.libraryDensityButton) {
            dom.libraryDensityButton.addEventListener('click', () => {
                setLibraryDensity(state.libraryDensity === 'compact' ? 'comfortable' : 'compact');
            });
        }

        dom.reloadButton.addEventListener('click', () => {
            window.location.reload();
        });

        dom.mapSettingsForm.addEventListener('change', () => {
            if (!state.currentMap || !canMutateWorkspace()) return;
            try {
                updateTreeAfterSettingsChange();
                markCurrentMapDirty('Map metadata changed.');
            } catch (error) {
                console.error(error);
                setSelectionStatus(error.message || 'Could not apply map settings.');
            }
        });
        dom.mapSettingsForm.addEventListener('input', () => {
            if (!canMutateWorkspace()) return;
            markCurrentMapDirty('Map metadata changed.');
        });
        dom.mapSettingsForm.addEventListener('focusin', () => {
            if (!canMutateWorkspace()) return;
            checkpointHistory('Edit map details');
        });

        dom.featureForm.addEventListener('change', updateSelectedFeatureFromForm);
        dom.featureForm.addEventListener('focusin', () => {
            if (state.selectedFeature?.mode !== 'journeys') checkpointHistory('Edit feature details');
        });
        dom.featureForm.addEventListener('focusout', (event) => {
            if (event.target.dataset) delete event.target.dataset.journeyHistory;
        });
        dom.featureForm.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target?.closest('[data-action]');
            if (!button || !dom.featureForm.contains(button)) return;
            if (!canMutateWorkspace()) return;

            const feature = getSelectedFeature();
            if (!feature || state.selectedFeature.mode !== 'points') return;

            if (button.dataset.action === 'add-detail-section') {
                event.preventDefault();
                checkpointHistory('Add detail section');
                const sections = getDetailSections(feature);
                sections.push({ heading: '', body: '' });
                renderFeatureInspector();
                const newIndex = sections.length - 1;
                const headingInput = dom.featureForm.querySelector(`[data-detail-section-row="${newIndex}"] [data-detail-section-field="heading"]`);
                if (headingInput) headingInput.focus();
                markCurrentMapDirty('Detail section changed.');
                setSelectionStatus('Added detail section.');
            } else if (button.dataset.action === 'remove-detail-section') {
                event.preventDefault();
                const label = feature.name || feature.id || 'this feature';
                const index = Number.parseInt(button.dataset.detailSectionIndex, 10);
                if (!window.confirm(`Are you sure you want to remove detail section ${index + 1} from ${label}?`)) return;
                const sections = getDetailSections(feature);
                if (!Number.isInteger(index) || index < 0 || index >= sections.length) return;
                checkpointHistory('Remove detail section');
                sections.splice(index, 1);
                renderFeatureInspector();
                markCurrentMapDirty('Detail section changed.');
                setSelectionStatus('Removed detail section.');
            }
        });

        const debouncedRenderSelectedFeatureUpdate = debounce((selection) => {
            if (
                selection.mapId !== state.currentMapId ||
                selection.mode !== state.selectedFeature?.mode ||
                selection.index !== state.selectedFeature?.index
            ) return;
            renderFeatureLists();
            renderMapLayers(false);
        }, 300);

        dom.featureForm.addEventListener('input', (event) => {
            if (!canMutateWorkspace()) return;
            const field = event.target.dataset.field;
            if (!field && !event.target.dataset.stopField) return;
            const selection = state.selectedFeature ? {
                mapId: state.currentMapId,
                mode: state.selectedFeature.mode,
                index: state.selectedFeature.index
            } : null;
            const updated = updateSelectedFeatureFromForm(event, { render: false });
            if (!updated) markCurrentMapDirty('Feature fields need attention.');
            if (selection && updated) debouncedRenderSelectedFeatureUpdate(selection);
        });

        dom.featureTypeSelect.addEventListener('change', (event) => {
            openFeatureBrowser(event.target.value);
        });

        const debouncedRenderFeatureLists = debounce((value) => {
            state.featureListState.searchQuery = value;
            state.featureListState.expanded = false;
            renderFeatureLists();
        }, 300);

        dom.featureSearchInput.addEventListener('input', (event) => {
            debouncedRenderFeatureLists(event.target.value);
        });

        dom.featureShowMoreButton.addEventListener('click', () => {
            state.featureListState.expanded = !state.featureListState.expanded;
            renderFeatureLists();
        });
        if (dom.createFeatureButton) dom.createFeatureButton.addEventListener('click', startFocusedFeatureCreation);

        dom.toolButtons.forEach((button) => {
            button.addEventListener('click', () => {
                if (!state.currentMap || button.disabled) return;
                const tool = button.dataset.editorTool;
                if (tool === 'point' || tool === 'region' || tool === 'line') {
                    beginDrawMode(tool);
                    return;
                }
                if (hasUnfinishedGeometryDraft()) {
                    setSelectionStatus(`Finish or cancel the current ${state.drawMode} before switching tools.`);
                    return;
                }
                clearDrawMode();
                if (tool === 'details') {
                    setInspectorCollapsed(false);
                    setWorkflowMode('map-details');
                    return;
                }
                if (tool === 'advanced') {
                    setInspectorCollapsed(false);
                    setWorkflowMode('map-advanced');
                    return;
                }
                if (tool === 'features') {
                    setInspectorCollapsed(false);
                    openFeatureBrowser(state.featureListState.type);
                    return;
                }
                if (dom.appShell.dataset.mode === 'library' || dom.appShell.dataset.mode === 'hub') {
                    setWorkflowMode('feature-browser');
                }
                setActiveTool(tool === 'pan' ? 'pan' : 'select');
                setSelectionStatus(tool === 'pan'
                    ? 'Move tool active. Drag the canvas to pan; use the wheel or controls to zoom.'
                    : 'Select tool active. Click a feature to edit it.');
            });
        });

        dom.addPoiButton.addEventListener('click', () => beginDrawMode('point'));
        dom.addRegionButton.addEventListener('click', () => beginDrawMode('region'));
        dom.addLineButton.addEventListener('click', () => beginDrawMode('line'));
        dom.finishDrawButton.addEventListener('click', finishDraftGeometry);
        dom.undoPointButton?.addEventListener('click', undoDraftPoint);
        dom.curvePointButton?.addEventListener('click', toggleSelectedPointCurve);
        dom.cancelDrawButton.addEventListener('click', () => {
            if (state.placingJourneyStop) {
                clearDrawMode();
                setInspectorCollapsed(false);
                setSelectionStatus('Stop placement cancelled.');
                return;
            }
            clearDrawMode();
            setSelectionStatus('Canceled the current drawing.');
            openFeatureBrowser(state.featureListState.type);
        });
        dom.deleteSelectionButton.addEventListener('click', deleteSelectedFeature);
        if (dom.undoButton) dom.undoButton.addEventListener('click', undoEditorChange);
        if (dom.redoButton) dom.redoButton.addEventListener('click', redoEditorChange);
        if (dom.cancelSwitchButton) {
            dom.cancelSwitchButton.addEventListener('click', () => {
                const transition = state.pendingTransition;
                closeUnsavedDialog();
                if (transition?.type === 'map' && transition.originMode === 'library') {
                    restoreLibraryReturnContext();
                }
            });
        }
        if (dom.discardSwitchButton) {
            dom.discardSwitchButton.addEventListener('click', async () => {
                const transition = state.pendingTransition;
                restoreSavedWorkspaceBaseline();
                closeUnsavedDialog();
                completePendingTransition(transition).catch((error) => {
                    console.error(error);
                    setSelectionStatus(error.message || 'Could not complete navigation.');
                });
            });
        }
        if (dom.saveSwitchButton) {
            dom.saveSwitchButton.addEventListener('click', async () => {
                const transition = state.pendingTransition;
                await saveCurrentMapJson();
                if (hasUnsavedEditorWork()) return;
                closeUnsavedDialog();
                await completePendingTransition(transition);
            });
        }
        dom.resetViewButton.addEventListener('click', () => {
            if (state.currentBounds) {
                queueMapViewportReset();
            }
        });
        if (dom.toggleInspectorButton) {
            dom.toggleInspectorButton.addEventListener('click', () => {
                setInspectorCollapsed(!state.inspectorCollapsed);
            });
        }
        if (dom.collapseInspectorButton) {
            dom.collapseInspectorButton.addEventListener('click', () => {
                setInspectorCollapsed(true);
                dom.inspectorTabButtons.find((button) => button.dataset.inspectorTab === state.inspectorTab)?.focus();
            });
        }
        if (dom.inspectorLauncherToggle) {
            dom.inspectorLauncherToggle.addEventListener('click', () => {
                setInspectorLauncherHidden(!state.inspectorLauncherHidden);
            });
        }
        registerInspectorResize();
        registerInspectorTabs();
        if (dom.chooseMapButton) {
            dom.chooseMapButton.addEventListener('click', () => {
                setWorkflowMode('library');
            });
        }
        if (dom.mapHomeButton) {
            dom.mapHomeButton.addEventListener('click', () => {
                if (dom.appShell.dataset.mode === 'library') {
                    restoreLibraryReturnContext();
                    return;
                }
                setWorkflowMode('hub');
            });
        }
        if (dom.mapHomeAllMapsButton) dom.mapHomeAllMapsButton.addEventListener('click', () => setWorkflowMode('library'));
        [dom.studioHomeLink, dom.menuStudioLink, dom.accessStudioLink, dom.previewStudioLink].filter(Boolean).forEach((link) => {
            link.addEventListener('click', (event) => {
                const modifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
                if (modifiedClick && !hasUnsavedEditorWork()) return;
                event.preventDefault();
                closeAppMenus();
                if (link === dom.accessStudioLink && isStudioHostedPath(window.location.pathname) && !canMutateWorkspace() && !hasUnsavedEditorWork()) {
                    startEditingFromReview();
                    return;
                }
                requestExternalNavigation(link.href);
            });
        });
        if (dom.editMapDetailsButton) {
            dom.editMapDetailsButton.addEventListener('click', () => {
                setInspectorCollapsed(false);
                setWorkflowMode('map-details');
            });
        }
        if (dom.editMapAdvancedButton) {
            dom.editMapAdvancedButton.addEventListener('click', () => {
                setInspectorCollapsed(false);
                setWorkflowMode('map-advanced');
            });
        }
        if (dom.editPointsButton) dom.editPointsButton.addEventListener('click', () => openFeatureBrowser('points'));
        if (dom.editRegionsButton) dom.editRegionsButton.addEventListener('click', () => openFeatureBrowser('regions'));
        if (dom.editLinesButton) dom.editLinesButton.addEventListener('click', () => openFeatureBrowser('lines'));
        if (dom.backToFeatureListButton) {
            dom.backToFeatureListButton.addEventListener('click', () => {
                clearDrawMode();
                openFeatureBrowser(state.featureListState.type);
            });
        }
        if (dom.saveCurrentMapButton) {
            dom.saveCurrentMapButton.addEventListener('click', saveCurrentMapJson);
        }
        if (dom.saveAtlasStructureButton) {
            dom.saveAtlasStructureButton.addEventListener('click', saveAtlasStructure);
        }
        if (dom.buildLivePreviewButton) {
            dom.buildLivePreviewButton.addEventListener('click', buildLivePreview);
        }
        if (dom.exportBuildPreviewButton) dom.exportBuildPreviewButton.addEventListener('click', buildLivePreview);
        [dom.exportButton, dom.openExportButton].filter(Boolean).forEach((button) => {
            button.addEventListener('click', openExportDialog);
        });
        dom.appMenuButtons.forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleAppMenu(button.dataset.appMenuTrigger);
            });
            button.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                openAppMenu(button.dataset.appMenuTrigger, event.key === 'ArrowUp' ? 'last' : 'first');
            });
        });
        dom.appMenus.forEach((menu) => {
            menu.addEventListener('click', (event) => event.stopPropagation());
            menu.addEventListener('keydown', (event) => {
                const items = getAppMenuItems(menu.dataset.appMenu);
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeAppMenus({ restoreFocus: true });
                    return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) return;
                event.preventDefault();
                const currentIndex = Math.max(0, items.indexOf(document.activeElement));
                if (event.key === 'Home') items[0].focus();
                else if (event.key === 'End') items.at(-1).focus();
                else if (event.key === 'ArrowDown') items[(currentIndex + 1) % items.length].focus();
                else items[(currentIndex - 1 + items.length) % items.length].focus();
            });
        });
        dom.appMenuItems.forEach((item) => {
            item.addEventListener('click', () => {
                if (!item.disabled) runAppMenuAction(item.dataset.menuAction);
            });
        });
        document.addEventListener('click', (event) => {
            if (state.openAppMenu && !(event.target instanceof Element && event.target.closest('.map-editor-top-menu'))) {
                closeAppMenus();
            }
        });
        document.addEventListener('focusin', (event) => {
            if (state.openAppMenu && !(event.target instanceof Element && event.target.closest('.map-editor-top-menu'))) {
                closeAppMenus();
            }
        });
        if (dom.exportCloseButton) dom.exportCloseButton.addEventListener('click', closeExportDialog);
        if (dom.exportDialog) {
            dom.exportDialog.addEventListener('click', (event) => {
                if (event.target === dom.exportDialog) closeExportDialog();
            });
        }
        dom.exportCurrentMapButton.addEventListener('click', () => {
            exportCurrentMapJson();
            closeExportDialog();
        });
        dom.exportAtlasStructureButton.addEventListener('click', () => {
            exportAtlasStructure();
            closeExportDialog();
        });
        if (dom.exportOpenPreviewLink) {
            dom.exportOpenPreviewLink.addEventListener('click', (event) => {
                if (dom.exportOpenPreviewLink.getAttribute('aria-disabled') !== 'true') return;
                event.preventDefault();
                setExportStatus('Build the live preview before opening it.');
            });
        }
        document.addEventListener('keydown', async (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const isTyping = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
            if (dom.appShell.dataset.mode === 'draw' && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey && !dom.exportDialog?.open) {
                if (event.key === 'Backspace' || event.key === 'Delete') {
                    event.preventDefault();
                    undoDraftPoint();
                    return;
                }
                if (event.key === 'Enter' && !target?.closest('button, a, summary')) {
                    event.preventDefault();
                    if (!dom.finishDrawButton.disabled && !dom.finishDrawButton.hidden) finishDraftGeometry();
                    return;
                }
            }
            if (event.key === 'Escape' && state.placingJourneyStop) {
                clearDrawMode();
                setInspectorCollapsed(false);
                setSelectionStatus('Stop placement cancelled.');
                return;
            }
            if (event.key === 'Escape' && state.openAppMenu) {
                event.preventDefault();
                closeAppMenus({ restoreFocus: true });
                return;
            }
            if (event.key === 'Escape' && !dom.exportDialog?.open && dom.appShell.dataset.mode === 'draw' && !isTyping) {
                event.preventDefault();
                clearDrawMode();
                setSelectionStatus('Canceled the current drawing.');
                openFeatureBrowser(state.featureListState.type);
                return;
            }
            if (!isTyping && !event.metaKey && !event.ctrlKey && !event.altKey && state.currentMap) {
                const shortcut = event.key.toLowerCase();
                if (shortcut === 'v' || shortcut === 'h' || shortcut === 'p' || shortcut === 'r' || shortcut === 'l') {
                    event.preventDefault();
                    const tool = { v: 'select', h: 'pan', p: 'point', r: 'region', l: 'line' }[shortcut];
                    const button = dom.toolButtons.find((candidate) => candidate.dataset.editorTool === tool);
                    if (button && !button.disabled) button.click();
                    return;
                }
            }
            if (!(event.metaKey || event.ctrlKey)) return;
            const key = event.key.toLowerCase();
            if (key === 's') {
                event.preventDefault();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                await delay(350);
                if (!dom.saveCurrentMapButton.disabled) await saveCurrentMapJson();
                return;
            }
            const wantsUndo = key === 'z' && !event.shiftKey;
            const wantsRedo = (key === 'z' && event.shiftKey) || key === 'y';
            if (!wantsUndo && !wantsRedo) return;
            event.preventDefault();
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            await delay(350);
            if (wantsUndo) undoEditorChange();
            else redoEditorChange();
        });
        window.addEventListener('beforeunload', (event) => {
            if (!hasUnsavedEditorWork()) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    async function detectLocalSaveApi() {
        state.accessChecked = false;
        setLocalSaveAvailability(false);
        setReadinessItem('saveServer', 'pending', 'Checking local editor server.');
        try {
            const response = await fetch('/api/editor/status', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (!payload || typeof payload.saveEnabled !== 'boolean') {
                throw new Error('Save API returned an invalid status.');
            }
            state.downloadOnly = Boolean(payload.downloadOnly);
            state.fileMode = Boolean(payload.fileMode || payload.readiness?.fileMode);
            dom.appShell.dataset.downloadOnly = String(state.downloadOnly);
            dom.appShell.dataset.fileMode = String(state.fileMode);
            applyServerReadiness(payload.readiness);
            state.accessChecked = true;
            if (payload.saveEnabled || state.downloadOnly) {
                if (window.location.pathname === '/studio/editor') {
                    try {
                        const workspaceResponse = await fetch('/api/studio/workspace', { cache: 'no-store' });
                        const workspacePayload = workspaceResponse.ok ? await workspaceResponse.json() : null;
                        const workspace = workspacePayload?.workspace;
                        const workspaceIdentity = String(
                            workspace?.draft?.id || workspace?.draft?.branch || workspace?.branch || ''
                        ).trim();
                        state.fileMode ||= workspace?.mode === 'files';
                        state.recoveryWorkspaceId = workspaceIdentity ? `${state.fileMode ? 'files' : 'studio'}:${workspaceIdentity}` : '';
                    } catch (error) {
                        state.recoveryWorkspaceId = '';
                    }
                }
                setLocalSaveAvailability(true);
                if (canMutateWorkspace()) {
                    setReadinessItem('saveServer', 'pass', 'Connected.');
                    setExportStatus(state.downloadOnly ? 'Edits stay in this browser. Download changes to keep a copy.' : 'Direct saves enabled.');
                } else {
                    setReadinessItem('saveServer', 'warn', state.localSaveMessage);
                    setExportStatus(state.localSaveMessage);
                }
            } else {
                const message = payload.message || 'Start an authorized Map Studio draft to enable saves.';
                setLocalSaveAvailability(false, message);
                setReadinessItem('saveServer', 'warn', message);
                setExportStatus(message);
            }
        } catch (error) {
            state.accessChecked = true;
            setLocalSaveAvailability(false);
            setReadinessItem('saveServer', 'fail', 'Run npm run editor.');
            setExportStatus('Review-only mode: connect through Map Studio to edit.');
        }
    }

    async function initializeEditor() {
        try {
            setLoadingStage('Loading atlas workspace', 'Preparing the editor shell…');
            initializeLibraryPreferences();
            configureStudioNavigation();
            initializeMap();
            initializeInspectorLayout();
            initializeInspectorTabs();
            registerDmTabs();
            registerEventListeners();
            renderPublishReadiness();
            const accessPromise = detectLocalSaveApi();

            setLoadingStage('Loading atlas index', 'Reading the map catalog…');
            await accessPromise;
            const atlas = state.fileMode
                ? await fetch('/api/editor/catalog', { cache: 'no-store' }).then(response => {
                    if (!response.ok) throw new Error('Could not load the source file catalog.');
                    return response.json();
                })
                : await fetchJsonAsset('maps/atlas-index.json');
            if (atlas.versions) state.fileVersions = { ...atlas.versions };
            if (!atlas || !Array.isArray(atlas.tree)) {
                throw new Error('maps/atlas-index.json did not return a valid tree.');
            }

            state.atlasTree = utils.normalizeManifestTree(atlas.tree);
            if (fileDocuments) {
                const manifestResponse = await fetch('/maps/maps.json', { cache: 'no-store' });
                if (!manifestResponse.ok) throw new Error('Could not read the source map index.');
                state.manifestSource = await manifestResponse.json();
                const sourceEntries = Array.isArray(state.manifestSource) ? state.manifestSource : state.manifestSource.maps;
                const editableEntries = utils.serializeFlatManifestState({ masterMapData: state.atlasTree });
                state.manifestSnapshots = Object.create(null);
                for (const entry of editableEntries) {
                    const original = sourceEntries?.find(candidate => candidate.id === entry.id);
                    if (original) state.manifestSnapshots[entry.id] = fileDocuments.createSession(original, entry).snapshot;
                }
            }
            state.expandedFolderIds = new Set();
            (function expandAllFolders(items) {
                if (!Array.isArray(items)) return;
                items.forEach((item) => {
                    if (!item || typeof item !== 'object') return;
                    if (Array.isArray(item.children) && item.children.length > 0) {
                        state.expandedFolderIds.add(item.id);
                        expandAllFolders(item.children);
                    }
                });
            }(state.atlasTree));
            const requestedMapId = editorSearchParams.get('map');
            const selectionEntries = utils.collectMapSelectionEntries(state.atlasTree);
            const initialMap = selectionEntries.find((entry) => entry.id === requestedMapId && !entry.disabled) ||
                selectionEntries.find((entry) => !entry.disabled);
            if (initialMap) {
                setLoadingStage(`Opening ${initialMap.name || initialMap.id}`, 'Preparing fields now; map artwork will finish in the canvas.');
                await selectMap(initialMap.id, {
                    deferMapRender: true,
                    recordRecent: Boolean(requestedMapId),
                    openMode: requestedMapId ? 'hub' : 'library'
                });
                await accessPromise;
                restoreRecoverySnapshot();
            } else {
                await accessPromise;
                renderAtlasTree();
                renderMapSettingsForm();
                renderFeatureLists();
                renderFeatureInspector();
                setSelectionStatus('No loadable maps were found in the atlas.');
                setWorkflowMode('library');
            }
        } catch (error) {
            console.error(error);
            setSelectionStatus(error.message || 'Could not initialize the map editor.');
            dom.atlasTree.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'map-editor-placeholder';
            p.textContent = error.message || 'Initialization failed.';
            dom.atlasTree.appendChild(p);
        } finally {
            dom.appShell.dataset.loading = 'false';
        }
    }

    initializeEditor();
}());
