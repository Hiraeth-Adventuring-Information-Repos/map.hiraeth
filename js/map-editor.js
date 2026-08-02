(function () {
    const utils = window.MapEditorUtils;
    const sharedUtils = window.SharedUtils;

    if (!utils || !sharedUtils || typeof L === 'undefined') {
        console.error('Map editor prerequisites are missing.');
        return;
    }

    const { debounce } = sharedUtils;

    const state = {
        atlasTree: [],
        currentMapId: '',
        currentMap: null,
        currentMapDataUrl: '',
        currentBounds: null,
        lineCollectionKey: 'lines',
        drawMode: '',
        draftCoordinates: [],
        selectedFeature: null,
        featureListState: {
            type: 'points',
            searchQuery: '',
            expanded: false,
            defaultLimit: 5
        },
        expandedFolderIds: new Set(),
        treeSearch: '',
        map: null,
        imageLayer: null,
        underlayLayer: null,
        pointLayer: null,
        regionLayer: null,
        lineLayer: null,
        vertexLayer: null,
        draftLayer: null,
        localSaveAvailable: false,
        localSaveMessage: '',
        editorDirty: false,
        publishReadiness: {
            items: {},
            changedFiles: [],
            changedFileGroups: [],
            warnings: [],
            previewUrl: '',
            topStatus: 'Needs Build',
            buildJob: null
        }
    };

    const dom = {
        appShell: document.getElementById('map-editor-app'),
        atlasTree: document.getElementById('editor-atlas-tree'),
        treeSearch: document.getElementById('editor-tree-search'),
        reloadButton: document.getElementById('reload-editor-btn'),
        selectionStatus: document.getElementById('editor-selection-status'),
        mapEmptyState: document.getElementById('editor-map-empty-state'),
        mapEmptyTitle: document.getElementById('editor-map-empty-title'),
        mapEmptyCopy: document.getElementById('editor-map-empty-copy'),
        mapEmptyDetail: document.getElementById('editor-map-empty-detail'),
        exportStatus: document.getElementById('editor-export-status'),
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
        addPoiButton: document.getElementById('editor-add-poi-btn'),
        addRegionButton: document.getElementById('editor-add-region-btn'),
        addLineButton: document.getElementById('editor-add-line-btn'),
        finishDrawButton: document.getElementById('editor-finish-draw-btn'),
        cancelDrawButton: document.getElementById('editor-cancel-draw-btn'),
        deleteSelectionButton: document.getElementById('editor-delete-selection-btn'),
        resetViewButton: document.getElementById('editor-reset-view-btn'),
        saveCurrentMapButton: document.getElementById('save-current-map-btn'),
        saveAtlasStructureButton: document.getElementById('save-atlas-structure-btn'),
        exportCurrentMapButton: document.getElementById('export-current-map-btn'),
        exportAtlasStructureButton: document.getElementById('export-atlas-structure-btn'),
        buildLivePreviewButton: document.getElementById('build-live-preview-btn'),
        livePreviewLink: document.getElementById('live-preview-link'),
        publishReadinessChip: document.getElementById('publish-readiness-chip'),
        publishReadinessTitle: document.getElementById('publish-readiness-title'),
        publishReadinessSummary: document.getElementById('publish-readiness-summary'),
        publishReadinessList: document.getElementById('publish-readiness-list'),
        publishActionList: document.getElementById('publish-action-list'),
        publishBuildProgress: document.getElementById('publish-build-progress'),
        publishChangedFileGroups: document.getElementById('publish-changed-file-groups'),
        publishChangedFiles: document.getElementById('publish-changed-files'),
        publishWarningList: document.getElementById('publish-warning-list'),
        chooseMapButton: document.getElementById('editor-choose-map-btn'),
        mapSettingsInputs: {
            name: document.getElementById('map-name-input'),
            type: document.getElementById('map-type-input'),
            status: document.getElementById('map-status-input'),
            visibility: document.getElementById('map-visibility-input'),
            group: document.getElementById('map-group-input'),
            dataUrl: document.getElementById('map-data-url-input'),
            imageUrl: document.getElementById('map-image-url-input'),
            mobileImageUrl: document.getElementById('map-mobile-image-url-input'),
            smallImageUrl: document.getElementById('map-small-image-url-input'),
            width: document.getElementById('map-width-input'),
            height: document.getElementById('map-height-input'),
            scalePixels: document.getElementById('map-scale-pixels-input'),
            scaleKilometers: document.getElementById('map-scale-kilometers-input'),
            scaleUnitName: document.getElementById('map-scale-unit-input'),
            backgroundColor: document.getElementById('map-background-color-input'),
            atmosphere: document.getElementById('map-atmosphere-input'),
            selectorDescription: document.getElementById('map-selector-description-input'),
            latNorth: document.getElementById('map-lat-north-input'),
            latSouth: document.getElementById('map-lat-south-input'),
            latEast: document.getElementById('map-lat-east-input'),
            latWest: document.getElementById('map-lat-west-input'),
            blurb: document.getElementById('map-blurb-input'),
            parentIdSelect: document.getElementById('map-parent-id-select'),
            order: document.getElementById('map-order-input')
        }
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
        const inputs = dom.mapSettingsInputs;
        return {
            name: inputs.name.value,
            type: inputs.type.value,
            status: inputs.status.value,
            visibility: inputs.visibility.value,
            group: inputs.group.value,
            dataUrl: inputs.dataUrl.value,
            imageUrl: inputs.imageUrl.value,
            mobileImageUrl: inputs.mobileImageUrl.value,
            smallImageUrl: inputs.smallImageUrl.value,
            width: inputs.width.value,
            height: inputs.height.value,
            scalePixels: inputs.scalePixels.value,
            scaleKilometers: inputs.scaleKilometers.value,
            scaleUnitName: inputs.scaleUnitName.value,
            backgroundColor: inputs.backgroundColor.value,
            atmosphere: inputs.atmosphere.value,
            selectorDescription: inputs.selectorDescription.value,
            latLonBounds: {
                north: inputs.latNorth.value,
                south: inputs.latSouth.value,
                east: inputs.latEast.value,
                west: inputs.latWest.value
            }
        };
    }

    function setSelectionStatus(message) {
        dom.selectionStatus.textContent = message;
    }

    function setExportStatus(message, isError = false) {
        dom.exportStatus.textContent = message;
        dom.exportStatus.style.color = isError ? '#dc2626' : '';
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
        if (state.editorDirty || getReadinessItem('currentMapSaved').status === 'warn') return 'Needs Save';
        if (getReadinessItem('pagesBundle').status !== 'pass') return 'Needs Build';
        return 'Ready';
    }

    function getPublishSummary(topStatus) {
        if (topStatus === 'Ready') return 'The editor changes are saved and the Pages bundle matches the live source.';
        if (topStatus === 'Needs Save') return 'Save the current editor changes before building or publishing.';
        if (topStatus === 'Needs Build') return 'Build the live preview to regenerate and verify the Pages bundle.';
        return 'Resolve the failed readiness check before publishing.';
    }

    function getPublishActions(topStatus) {
        if (topStatus === 'Ready') {
            return state.publishReadiness.previewUrl
                ? ['Open the live preview and review the public page.']
                : ['Build a live preview before opening a publish PR.'];
        }
        if (topStatus === 'Needs Save') return ['Save current map changes.'];
        if (topStatus === 'Needs Build') return ['Build live preview to refresh dist/.'];
        const failedItems = publishReadinessItems
            .map(([key, label]) => ({ label, item: getReadinessItem(key) }))
            .filter(({ item }) => item.status === 'fail');
        if (failedItems.length === 0) return ['Review the failed readiness message.'];
        return failedItems.map(({ label, item }) => `${label}: ${item.detail || 'needs attention'}`);
    }

    function renderPublishActions(topStatus) {
        if (!dom.publishActionList) return;
        dom.publishActionList.textContent = '';
        getPublishActions(topStatus).forEach((action) => {
            const row = document.createElement('li');
            row.textContent = action;
            dom.publishActionList.appendChild(row);
        });
    }

    function renderChangedFileGroups() {
        if (!dom.publishChangedFileGroups) return;
        dom.publishChangedFileGroups.textContent = '';
        const groups = Array.isArray(state.publishReadiness.changedFileGroups)
            ? state.publishReadiness.changedFileGroups
            : [];
        if (groups.length === 0) {
            const row = document.createElement('p');
            row.className = 'map-editor-placeholder';
            row.textContent = 'No changed files.';
            dom.publishChangedFileGroups.appendChild(row);
            return;
        }

        groups.forEach((group) => {
            const details = document.createElement('details');
            details.className = 'map-editor-file-group';
            details.open = group.label !== 'Unrelated';

            const summary = document.createElement('summary');
            const label = document.createElement('strong');
            const count = document.createElement('span');
            label.textContent = group.label;
            count.textContent = `${group.count} file${group.count === 1 ? '' : 's'}`;
            summary.append(label, count);

            const list = document.createElement('ul');
            (group.files || []).slice(0, 20).forEach((file) => {
                const item = document.createElement('li');
                item.textContent = `${file.status || ''} ${file.path || file.raw || ''}`.trim();
                list.appendChild(item);
            });
            if ((group.files || []).length > 20) {
                const item = document.createElement('li');
                item.textContent = `...and ${group.files.length - 20} more`;
                list.appendChild(item);
            }

            details.append(summary, list);
            dom.publishChangedFileGroups.appendChild(details);
        });
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
        if (!dom.publishReadinessList) return;

        dom.publishReadinessList.textContent = '';
        publishReadinessItems.forEach(([key, label]) => {
            const item = getReadinessItem(key);
            const row = document.createElement('li');
            const stateLabel = document.createElement('span');
            const detail = document.createElement('span');
            stateLabel.className = `map-editor-readiness-state ${item.status}`;
            stateLabel.textContent = getReadinessStateLabel(item.status);
            detail.textContent = item.detail ? `${label}: ${item.detail}` : label;
            row.append(stateLabel, detail);
            dom.publishReadinessList.appendChild(row);
        });

        const topStatus = getPublishTopStatus();
        state.publishReadiness.topStatus = topStatus;
        if (dom.publishReadinessChip) {
            dom.publishReadinessChip.textContent = topStatus;
        }
        if (dom.publishReadinessTitle) dom.publishReadinessTitle.textContent = topStatus;
        if (dom.publishReadinessSummary) dom.publishReadinessSummary.textContent = getPublishSummary(topStatus);
        renderPublishActions(topStatus);
        renderBuildProgress();
        renderChangedFileGroups();

        if (dom.publishChangedFiles) {
            const files = state.publishReadiness.changedFiles || [];
            const visibleFiles = files.slice(0, 20);
            dom.publishChangedFiles.textContent = visibleFiles.length
                ? `${visibleFiles.join('\n')}${files.length > visibleFiles.length ? `\n...and ${files.length - visibleFiles.length} more` : ''}`
                : 'No changed files.';
        }

        if (dom.publishWarningList) {
            dom.publishWarningList.textContent = '';
            const warnings = state.publishReadiness.warnings || [];
            if (warnings.length === 0) {
                const row = document.createElement('li');
                const stateLabel = document.createElement('span');
                const detail = document.createElement('span');
                stateLabel.className = 'map-editor-readiness-state pass';
                stateLabel.textContent = 'Pass';
                detail.textContent = 'No warnings.';
                row.append(stateLabel, detail);
                dom.publishWarningList.appendChild(row);
            } else {
                warnings.forEach((warning) => {
                    const row = document.createElement('li');
                    const stateLabel = document.createElement('span');
                    const detail = document.createElement('span');
                    stateLabel.className = 'map-editor-readiness-state warn';
                    stateLabel.textContent = 'Warning';
                    detail.textContent = warning;
                    row.append(stateLabel, detail);
                    dom.publishWarningList.appendChild(row);
                });
            }
        }

        if (dom.livePreviewLink) {
            dom.livePreviewLink.hidden = !state.publishReadiness.previewUrl;
            if (state.publishReadiness.previewUrl) {
                dom.livePreviewLink.href = state.publishReadiness.previewUrl;
            }
        }
        refreshBuildPreviewButtonState();
    }

    function applyServerReadiness(readiness) {
        if (!readiness || typeof readiness !== 'object') return;
        state.publishReadiness.changedFiles = Array.isArray(readiness.changedFiles) ? readiness.changedFiles : [];
        state.publishReadiness.changedFileGroups = Array.isArray(readiness.changedFileGroups) ? readiness.changedFileGroups : [];
        state.publishReadiness.warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
        state.publishReadiness.serverTopStatus = String(readiness.topStatus || '').trim();

        const bundle = readiness.pagesBundle || {};
        if (bundle.built) {
            if (!bundle.stale && !state.publishReadiness.previewUrl) {
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
            setReadinessItem('pagesBundle', 'warn', 'dist/ has not been built.');
        }
        renderPublishReadiness();
    }

    function markCurrentMapDirty(detail = 'Unsaved editor changes.') {
        if (!state.currentMap) return;
        state.editorDirty = true;
        setReadinessItem('currentMapSaved', 'warn', detail);
    }

    function refreshBuildPreviewButtonState() {
        if (!dom.buildLivePreviewButton) return;
        const runningBuild = state.publishReadiness.buildJob?.status === 'running';
        const disabled = !state.localSaveAvailable || state.editorDirty || runningBuild;
        dom.buildLivePreviewButton.disabled = disabled;
        let title = 'Build dist/ and preview the exact Pages bundle.';
        if (!state.localSaveAvailable) {
            title = state.localSaveMessage || 'Run npm run editor to enable preview builds.';
        }
        else if (state.editorDirty) title = 'Save current map changes before building preview.';
        else if (runningBuild) title = 'Preview build is running.';
        dom.buildLivePreviewButton.title = title;
        dom.buildLivePreviewButton.setAttribute('aria-disabled', String(disabled));
    }

    function setLocalSaveAvailability(available, message = '') {
        state.localSaveAvailable = Boolean(available);
        state.localSaveMessage = String(message || '').trim();
        const title = state.localSaveAvailable
            ? 'Save directly to the local map files.'
            : (state.localSaveMessage || 'Run npm run editor to enable direct saves.');
        [dom.saveCurrentMapButton, dom.saveAtlasStructureButton].forEach((button) => {
            if (!button) return;
            button.disabled = !state.localSaveAvailable;
            button.title = title;
            button.setAttribute('aria-disabled', String(!state.localSaveAvailable));
        });
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
                requestAnimationFrame(resetViewport);
                return;
            }
            state.map.invalidateSize(false);
            try {
                state.map.fitBounds(state.currentBounds, { padding: [20, 20] });
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
        requestAnimationFrame(resetViewport);
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
        return [];
    }

    function getSelectedFeature() {
        if (!state.selectedFeature) return null;
        const collection = getCurrentFeatureCollection(state.selectedFeature.mode);
        return collection[state.selectedFeature.index] || null;
    }

    function clearDrawMode() {
        state.drawMode = '';
        state.draftCoordinates = [];
        renderDraftGeometry();
        syncToolbarState();
    }

    function selectFeature(mode, index) {
        const collection = getCurrentFeatureCollection(mode);
        if (!collection[index]) {
            state.selectedFeature = null;
        } else {
            state.selectedFeature = { mode, index };
            if (mode === 'points') {
                setSelectionStatus('POI selected. Drag the marker on the map to move it.');
            } else {
                setSelectionStatus('Geometry selected. Drag the orange vertex handles to reshape it.');
            }
        }
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        syncToolbarState();
    }

    function deselectFeature() {
        state.selectedFeature = null;
        renderFeatureLists();
        renderFeatureInspector();
        renderMapLayers(false);
        syncToolbarState();
    }

    function syncToolbarState() {
        const canEditGeometry = canRenderMap(state.currentMap);
        dom.addPoiButton.disabled = !canEditGeometry;
        dom.addRegionButton.disabled = !canEditGeometry;
        dom.addLineButton.disabled = !canEditGeometry;
        dom.resetViewButton.disabled = !canEditGeometry;
        dom.deleteSelectionButton.disabled = !state.selectedFeature;
        dom.finishDrawButton.hidden = !state.drawMode;
        dom.cancelDrawButton.hidden = !state.drawMode;
        dom.exportCurrentMapButton.disabled = !canRenderMap(state.currentMap);
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
        dom.atlasTree.innerHTML = '';

        if (!Array.isArray(visibleTree) || visibleTree.length === 0) {
            dom.atlasTree.innerHTML = '<p class="map-editor-placeholder">No maps match the current search.</p>';
            return;
        }

        function renderNodes(items) {
            const list = document.createElement('ul');
            list.className = 'map-editor-tree-list';
            const sourceItems = Array.isArray(items) ? items : [];
            const hasGroupedItems = sourceItems.some((item) => getMapPresetGroupLabel(item));

            function createTreeNode(item) {
                if (!item || typeof item !== 'object') return;
                const row = document.createElement('li');
                const header = document.createElement('div');
                header.className = 'map-editor-tree-row';

                const hasChildren = Array.isArray(item.children) && item.children.length > 0;
                const toggleButton = document.createElement('button');
                toggleButton.type = 'button';
                toggleButton.className = 'map-editor-tree-toggle';
                toggleButton.textContent = hasChildren
                    ? (state.expandedFolderIds.has(item.id) ? 'v' : '>')
                    : '-';
                toggleButton.disabled = !hasChildren;
                if (hasChildren) {
                    toggleButton.setAttribute('aria-expanded', state.expandedFolderIds.has(item.id) ? 'true' : 'false');
                    toggleButton.setAttribute('aria-label', `Toggle folder: ${item.name || item.id}`);
                } else {
                    toggleButton.setAttribute('aria-hidden', 'true');
                }
                toggleButton.addEventListener('click', () => toggleFolder(item.id));
                header.appendChild(toggleButton);

                const selectButton = document.createElement('button');
                selectButton.type = 'button';
                selectButton.className = 'map-editor-tree-item';
                selectButton.setAttribute('aria-label', `Select map: ${item.name || item.id}`);
                if (item.id === state.currentMapId) {
                    selectButton.classList.add('active');
                }
                const strongTag = document.createElement('strong');
                strongTag.textContent = item.name || item.id;
                selectButton.appendChild(strongTag);
                selectButton.addEventListener('click', () => {
                    selectMap(item.id).catch((error) => {
                        console.error(error);
                        setSelectionStatus(error.message || 'Could not select the map.');
                    });
                });
                header.appendChild(selectButton);

                row.appendChild(header);

                if (hasChildren && state.expandedFolderIds.has(item.id)) {
                    row.appendChild(renderNodes(item.children));
                }

                return row;
            }

            if (!hasGroupedItems) {
                sourceItems.forEach((item) => {
                    const row = createTreeNode(item);
                    if (row) list.appendChild(row);
                });
                return list;
            }

            const renderedGroups = new Set();
            sourceItems.forEach((item) => {
                const groupLabel = getMapPresetGroupLabel(item);
                if (!groupLabel) {
                    const row = createTreeNode(item);
                    if (row) list.appendChild(row);
                    return;
                }
                if (renderedGroups.has(groupLabel)) return;
                renderedGroups.add(groupLabel);

                const groupRow = document.createElement('li');
                groupRow.className = 'map-editor-tree-group';

                const groupHeader = document.createElement('div');
                groupHeader.className = 'map-editor-tree-group-header';
                groupHeader.textContent = groupLabel;
                groupRow.appendChild(groupHeader);

                const groupList = document.createElement('ul');
                groupList.className = 'map-editor-tree-list map-editor-tree-group-list';
                sourceItems
                    .filter((candidate) => getMapPresetGroupLabel(candidate) === groupLabel)
                    .forEach((candidate) => {
                        const row = createTreeNode(candidate);
                        if (row) groupList.appendChild(row);
                    });

                groupRow.appendChild(groupList);
                list.appendChild(groupRow);
            });

            return list;
        }

        dom.atlasTree.appendChild(renderNodes(visibleTree));
    }

    function getFeatureSummaryLabel() {
        const points = getCurrentPoints().length;
        const regions = getCurrentRegions().length;
        const lines = getCurrentLines().length;
        return `${points} POIs, ${regions} regions, ${lines} lines`;
    }

    function getFeatureItems(type) {
        if (type === 'points') return getCurrentPoints();
        if (type === 'regions') return getCurrentRegions();
        if (type === 'lines') return getCurrentLines();
        return [];
    }

    function getFeatureItemMetaShort(type, item) {
        if (type === 'points') return item.type || 'Point';
        if (type === 'regions') return item.value || item.type || 'Region';
        return item.type || 'Line';
    }

    function getFeatureItemMetaFull(type, item) {
        const shortMeta = getFeatureItemMetaShort(type, item);
        if (type === 'points') {
            const coordsStr = Array.isArray(item.coords) ? item.coords.join(', ') : 'No coords';
            return `${shortMeta} - ${coordsStr}`;
        }
        const verticesCount = Array.isArray(item.coordinates) ? item.coordinates.length : 0;
        return `${shortMeta} - ${verticesCount} vertices`;
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

            if (query && !label.toLowerCase().includes(query) && !metaShort.toLowerCase().includes(query)) {
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
                sections.push({ heading, body });
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

    function setFeatureFormValues(values) {
        Object.entries(values).forEach(([field, value]) => {
            dom.featureForm.querySelector(`[data-field="${field}"]`).value = value;
        });
    }

    function renderPointFeatureInspector(feature) {
        dom.selectedFeatureChip.textContent = 'POI';
        dom.featureForm.innerHTML = `
                <label>Name<input data-field="name" type="text"></label>
                <label>Pronunciation<input data-field="pronunciation" type="text"></label>
                <label>Type<input data-field="type" type="text"></label>
                <label>Summary<textarea data-field="summary" rows="3"></textarea></label>
                <label>Description<textarea data-field="description" rows="4"></textarea></label>
                <label>Key Facts<textarea data-field="propertiesText" rows="5" placeholder="Nation: Commonwealth of Half Height&#10;Known for: Trade and white-stone terraces"></textarea></label>
                <label>Tags<textarea data-field="tags" rows="3" placeholder="One tag per line, or comma-separated"></textarea></label>
                <fieldset class="map-editor-detail-sections" data-field="detailSections">
                    <legend>Detail Sections</legend>
                    <p class="map-editor-detail-section-empty" data-detail-section-empty>No detail sections yet.</p>
                    <div class="map-editor-detail-section-list" data-detail-section-list></div>
                    <button type="button" class="map-editor-detail-section-add" data-action="add-detail-section">Add Detail Section</button>
                </fieldset>
                <label>Wiki Link<input data-field="wikiLink" type="text"></label>
                <label>Linked Map ID<input data-field="linkedMapId" type="text"></label>
                <div class="map-editor-form-grid">
                    <label>Y<input data-field="coordY" type="number"></label>
                    <label>X<input data-field="coordX" type="number"></label>
                </div>
                <details>
                    <summary>Advanced properties JSON</summary>
                    <label>Properties JSON<textarea data-field="properties" rows="5"></textarea></label>
                </details>
            `;
        setFeatureFormValues({
            name: feature.name || '',
            pronunciation: feature.pronunciation || '',
            type: feature.type || '',
            summary: feature.summary || '',
            description: feature.description || '',
            propertiesText: stringifyKeyFacts(feature.properties || {}),
            tags: stringifyTags(feature.tags || []),
            wikiLink: feature.wikiLink || '',
            linkedMapId: feature.linkedMapId || '',
            coordY: feature.coords?.[0] ?? '',
            coordX: feature.coords?.[1] ?? '',
            properties: JSON.stringify(feature.properties || {}, null, 2)
        });
        renderDetailSectionControls(feature);
    }

    function renderRegionFeatureInspector(feature) {
        dom.selectedFeatureChip.textContent = 'Region';
        dom.featureForm.innerHTML = `
                <label>ID<input data-field="id" type="text"></label>
                <label>Name<input data-field="name" type="text"></label>
                <label>Type<input data-field="type" type="text"></label>
                <label>Value<input data-field="value" type="text"></label>
                <label>Summary<textarea data-field="summary" rows="3"></textarea></label>
                <label>Description<textarea data-field="description" rows="4"></textarea></label>
                <label>Wiki Link<input data-field="wikiLink" type="text"></label>
                <label>Linked Map ID<input data-field="linkedMapId" type="text"></label>
                <div class="map-editor-form-grid">
                    <label>Stroke Color<input data-field="color" type="text"></label>
                    <label>Fill Color<input data-field="fillColor" type="text"></label>
                    <label>Fill Opacity<input data-field="fillOpacity" type="number" step="0.05"></label>
                </div>
                <label>Coordinates<textarea class="map-editor-coordinates" data-field="coordinates" rows="7"></textarea></label>
                <label>Properties JSON<textarea data-field="properties" rows="5"></textarea></label>
            `;
        setFeatureFormValues({
            id: feature.id || '',
            name: feature.name || '',
            type: feature.type || '',
            value: feature.value || '',
            summary: feature.summary || '',
            description: feature.description || '',
            wikiLink: feature.wikiLink || '',
            linkedMapId: feature.linkedMapId || '',
            color: feature.color || '',
            fillColor: feature.fillColor || '',
            fillOpacity: feature.fillOpacity ?? '',
            coordinates: stringifyCoordinates(feature.coordinates || []),
            properties: JSON.stringify(feature.properties || {}, null, 2)
        });
    }

    function renderLineFeatureInspector(feature) {
        dom.selectedFeatureChip.textContent = 'Line';
        dom.featureForm.innerHTML = `
                <label>ID<input data-field="id" type="text"></label>
                <label>Name<input data-field="name" type="text"></label>
                <label>Type<input data-field="type" type="text"></label>
                <label>Summary<textarea data-field="summary" rows="3"></textarea></label>
                <label>Description<textarea data-field="description" rows="4"></textarea></label>
                <label>Wiki Link<input data-field="wikiLink" type="text"></label>
                <label>Linked Map ID<input data-field="linkedMapId" type="text"></label>
                <div class="map-editor-form-grid">
                    <label>Color<input data-field="color" type="text"></label>
                    <label>Weight<input data-field="weight" type="number" step="1" min="1"></label>
                    <label>Dash Array<input data-field="dashArray" type="text"></label>
                </div>
                <label>Coordinates<textarea class="map-editor-coordinates" data-field="coordinates" rows="7"></textarea></label>
                <label>Properties JSON<textarea data-field="properties" rows="5"></textarea></label>
            `;
        setFeatureFormValues({
            id: feature.id || '',
            name: feature.name || '',
            type: feature.type || '',
            summary: feature.summary || '',
            description: feature.description || '',
            wikiLink: feature.wikiLink || '',
            linkedMapId: feature.linkedMapId || '',
            color: feature.color || '',
            weight: feature.weight ?? '',
            dashArray: feature.dashArray || '',
            coordinates: stringifyCoordinates(feature.coordinates || []),
            properties: JSON.stringify(feature.properties || {}, null, 2)
        });
    }

    function renderFeatureInspector() {
        const feature = getSelectedFeature();
        dom.featureForm.innerHTML = '';

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
            lines: renderLineFeatureInspector
        }[state.selectedFeature.mode] || renderLineFeatureInspector;
        renderInspector(feature);
    }

    function updateSelectedFeatureFromForm(event) {
        const feature = getSelectedFeature();
        if (!feature) return;

        const field = event.target.dataset.field;
        if (!field) return;

        try {
            if (state.selectedFeature.mode === 'points') {
                if (field === 'coordY' || field === 'coordX') {
                    const nextY = field === 'coordY' ? event.target.value : dom.featureForm.querySelector('[data-field="coordY"]').value;
                    const nextX = field === 'coordX' ? event.target.value : dom.featureForm.querySelector('[data-field="coordX"]').value;
                    feature.coords = [roundCoordinate(nextY), roundCoordinate(nextX)];
                } else if (field === 'propertiesText') {
                    feature.properties = parseKeyFacts(event.target.value);
                    const propertiesJsonField = dom.featureForm.querySelector('[data-field="properties"]');
                    if (propertiesJsonField) propertiesJsonField.value = JSON.stringify(feature.properties || {}, null, 2);
                } else if (field === 'tags') {
                    feature.tags = parseTags(event.target.value);
                } else if (field === 'detailSections') {
                    feature.detailSections = getDetailSectionsFromForm();
                } else if (field === 'properties') {
                    feature.properties = parseJsonObject(event.target.value);
                    const keyFactsField = dom.featureForm.querySelector('[data-field="propertiesText"]');
                    if (keyFactsField) keyFactsField.value = stringifyKeyFacts(feature.properties || {});
                } else {
                    feature[field] = event.target.value;
                }
            } else if (field === 'coordinates') {
                const minimumPoints = state.selectedFeature.mode === 'regions' ? 3 : 2;
                feature.coordinates = parseCoordinatePairs(event.target.value, minimumPoints);
            } else if (field === 'properties') {
                feature.properties = parseJsonObject(event.target.value);
            } else if (field === 'fillOpacity' || field === 'weight') {
                feature[field] = Number(event.target.value);
            } else {
                feature[field] = event.target.value;
            }

            setSelectionStatus(`Updated ${state.selectedFeature.mode.slice(0, -1)} fields.`);
            renderFeatureLists();
            renderMapLayers(false);
            markCurrentMapDirty('Feature fields changed.');
        } catch (error) {
            setSelectionStatus(error.message || 'Could not apply feature changes.');
        }
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

    function getMapSettingsTextValue(value) {
        return value || '';
    }

    function getMapSettingsOptionalValue(value) {
        return value ?? '';
    }

    function getMapSettingsFieldValues(currentMap, currentLocation) {
        return {
            name: getMapSettingsTextValue(currentMap?.name),
            type: getMapSettingsTextValue(currentMap?.type),
            status: getMapSettingsTextValue(currentMap?.status),
            visibility: getMapSettingsTextValue(currentMap?.visibility),
            group: getMapSettingsTextValue(currentMap?.group || currentMap?.category),
            dataUrl: getMapSettingsTextValue(currentMap?.dataUrl),
            order: currentLocation ? currentLocation.index : 0,
            imageUrl: getMapSettingsTextValue(currentMap?.imageUrl),
            mobileImageUrl: getMapSettingsTextValue(currentMap?.mobileImageUrl),
            smallImageUrl: getMapSettingsTextValue(currentMap?.smallImageUrl),
            width: getMapSettingsOptionalValue(currentMap?.width),
            height: getMapSettingsOptionalValue(currentMap?.height),
            scalePixels: getMapSettingsOptionalValue(currentMap?.scalePixels),
            scaleKilometers: getMapSettingsOptionalValue(currentMap?.scaleKilometers),
            scaleUnitName: getMapSettingsTextValue(currentMap?.scaleUnitName),
            backgroundColor: getMapSettingsTextValue(currentMap?.backgroundColor),
            atmosphere: getMapSettingsTextValue(currentMap?.atmosphere),
            latNorth: getMapSettingsOptionalValue(currentMap?.latLonBounds?.north),
            latSouth: getMapSettingsOptionalValue(currentMap?.latLonBounds?.south),
            latEast: getMapSettingsOptionalValue(currentMap?.latLonBounds?.east),
            latWest: getMapSettingsOptionalValue(currentMap?.latLonBounds?.west),
            blurb: getMapSettingsTextValue(currentMap?.blurb),
            selectorDescription: getMapSettingsTextValue(currentMap?.selectorDescription)
        };
    }

    function setMapSettingsFieldValues(inputs, fieldValues) {
        Object.entries(fieldValues).forEach(([key, value]) => {
            const input = inputs[key];
            if (input) input.value = value;
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
            dom.mapSettingsInputs.parentIdSelect,
            buildParentOptions(),
            currentLocation?.parentId || ''
        );
        dom.currentMapId.textContent = currentMap?.id || 'No map';
    }

    function updateTreeAfterSettingsChange() {
        if (!state.currentMap) return;

        const nextSettings = readMapSettingsForm();
        utils.applyMapSettings(state.currentMap, nextSettings);

        const parentId = dom.mapSettingsInputs.parentIdSelect.value;
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
        renderMapLayers(true);
        setSelectionStatus(`Updated map settings for "${state.currentMap.name || state.currentMap.id}".`);
    }

    function createVertexIcon() {
        return L.divIcon({
            className: '',
            html: '<div class="editor-vertex-icon"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
    }

    function renderDraftGeometry() {
        state.draftLayer.clearLayers();
        if (!state.drawMode || state.draftCoordinates.length === 0) return;

        const options = {
            color: '#f97316',
            weight: 3,
            dashArray: '6 4'
        };
        if (state.drawMode === 'region' && state.draftCoordinates.length >= 2) {
            state.draftLayer.addLayer(L.polygon(state.draftCoordinates, {
                ...options,
                fillOpacity: 0.12
            }));
        } else {
            state.draftLayer.addLayer(L.polyline(state.draftCoordinates, options));
        }
    }

    function renderVertexHandles() {
        state.vertexLayer.clearLayers();
        const feature = getSelectedFeature();
        if (!feature || state.selectedFeature.mode === 'points') return;

        const coordinates = Array.isArray(feature.coordinates) ? feature.coordinates : [];
        coordinates.forEach((coordinate, index) => {
            const handle = L.marker(coordinate, {
                icon: createVertexIcon(),
                draggable: true,
                keyboard: false
            });
            handle.on('drag', (event) => {
                feature.coordinates[index] = roundLatLng(event.target.getLatLng());
            });
            handle.on('dragend', () => {
                renderMapLayers(false);
                renderFeatureInspector();
                renderFeatureLists();
                markCurrentMapDirty('Geometry changed.');
                setSelectionStatus('Updated geometry vertex.');
            });
            state.vertexLayer.addLayer(handle);
        });
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

    function renderPointsLayer() {
        getCurrentPoints().forEach((point, index) => {
            if (!Array.isArray(point.coords) || point.coords.length !== 2) return;
            const markerLabel = getPointMarkerAccessibleName(point, index);
            const marker = L.marker(point.coords, {
                draggable: true,
                title: markerLabel,
                alt: markerLabel
            });
            marker.on('click', () => selectFeature('points', index));
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
            if (!Array.isArray(region.coordinates) || region.coordinates.length < 3) return;
            const layer = L.polygon(region.coordinates, {
                color: region.color || '#2563eb',
                fillColor: region.fillColor || region.color || '#2563eb',
                fillOpacity: Number(region.fillOpacity ?? 0.2),
                weight: state.selectedFeature?.mode === 'regions' && state.selectedFeature.index === index ? 3 : 2
            });
            layer.on('click', () => selectFeature('regions', index));
            state.regionLayer.addLayer(layer);
        });
    }

    function renderLinesLayer() {
        getCurrentLines().forEach((line, index) => {
            if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) return;
            const layer = L.polyline(line.coordinates, {
                color: line.color || '#0f766e',
                weight: Number(line.weight || 3),
                dashArray: line.dashArray || ''
            });
            layer.on('click', () => selectFeature('lines', index));
            state.lineLayer.addLayer(layer);
        });
    }

    function renderMapLayers(resetView) {
        state.pointLayer.clearLayers();
        state.regionLayer.clearLayers();
        state.lineLayer.clearLayers();

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

        renderVertexHandles();
        renderDraftGeometry();

        if (resetView && state.currentBounds) {
            queueMapViewportReset();
        }

        syncToolbarState();
    }

    function finishDraftGeometry() {
        if (!state.currentMap) return;
        const draft = utils.cloneJson(state.draftCoordinates);
        if (state.drawMode === 'region') {
            if (draft.length < 3) {
                setSelectionStatus('A region needs at least 3 points.');
                return;
            }
            getCurrentRegions().push({
                id: `region-${Date.now()}`,
                name: `Region ${getCurrentRegions().length + 1}`,
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
                properties: {}
            });
            clearDrawMode();
            state.featureListState.type = 'regions';
            selectFeature('regions', getCurrentRegions().length - 1);
            markCurrentMapDirty('New region not saved.');
            setSelectionStatus('Created a new region.');
            return;
        }

        if (draft.length < 2) {
            setSelectionStatus('A line needs at least 2 points.');
            return;
        }
        getCurrentLines().push({
            id: `line-${Date.now()}`,
            name: `Line ${getCurrentLines().length + 1}`,
            type: '',
            color: '#0f766e',
            weight: 3,
            dashArray: '',
            description: '',
            summary: '',
            wikiLink: '',
            linkedMapId: '',
            coordinates: draft,
            properties: {}
        });
        clearDrawMode();
        state.featureListState.type = 'lines';
        selectFeature('lines', getCurrentLines().length - 1);
        markCurrentMapDirty('New line not saved.');
        setSelectionStatus('Created a new line.');
    }

    function handleMapClick(event) {
        if (!state.currentMap || !canRenderMap(state.currentMap)) return;
        const coordinate = roundLatLng(event.latlng);

        if (state.drawMode === 'point') {
            getCurrentPoints().push({
                name: `POI ${getCurrentPoints().length + 1}`,
                coords: coordinate,
                type: 'Unknown',
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
            markCurrentMapDirty('New POI not saved.');
            setSelectionStatus('Added a new POI.');
            return;
        }

        if (state.drawMode === 'region' || state.drawMode === 'line') {
            state.draftCoordinates.push(coordinate);
            renderDraftGeometry();
            setSelectionStatus(`Draft ${state.drawMode}: ${state.draftCoordinates.length} points.`);
        }
    }

    function deleteSelectedFeature() {
        if (!state.selectedFeature) return;
        const feature = getSelectedFeature();
        const label = feature.name || feature.id || 'this feature';
        if (!window.confirm(`Are you sure you want to delete ${label}?`)) return;
        const collection = getCurrentFeatureCollection(state.selectedFeature.mode);
        collection.splice(state.selectedFeature.index, 1);
        deselectFeature();
        renderFeatureLists();
        renderMapLayers(false);
        markCurrentMapDirty('Deleted feature not saved.');
        setSelectionStatus('Deleted the selected feature.');
    }

    function beginDrawMode(mode) {
        if (!canRenderMap(state.currentMap)) return;
        state.drawMode = mode;
        state.draftCoordinates = [];
        deselectFeature();
        renderDraftGeometry();
        syncToolbarState();
        setSelectionStatus(mode === 'point'
            ? 'Click the map to place a new POI.'
            : `Click the map to add ${mode} vertices, then finish the draft.`);
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
            const exportedDocument = utils.serializeMapDocumentState({
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
            body: JSON.stringify(payload)
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
        return result;
    }

    async function saveCurrentMapJson() {
        if (!state.currentMap) return;
        try {
            const exportedDocument = utils.serializeMapDocumentState({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap.id,
                collectedPoints: getCurrentPoints(),
                collectedRegions: getCurrentRegions(),
                collectedLines: getCurrentLines(),
                lineCollectionKey: state.lineCollectionKey,
                mapSettings: readMapSettingsForm()
            });
            const currentMapDataUrl = getCurrentMapDataUrl();
            const fileName = getExportFileName(currentMapDataUrl, state.currentMap.id);
            setExportStatus(`Saving ${fileName}...`);
            const result = await saveEditorDocument('/api/editor/save-map', {
                mapId: state.currentMap.id,
                dataUrl: currentMapDataUrl,
                fileName,
                document: exportedDocument
            });
            setExportStatus(`Saved ${result.saved} and regenerated ${result.atlas}.`);
            state.editorDirty = false;
            setReadinessItem('currentMapSaved', 'pass', `Saved ${result.saved}.`);
            setReadinessItem('atlasRegenerated', 'pass', `Regenerated ${result.atlas}.`);
            setReadinessItem('dataValidation', 'pass', 'Validation passed.');
            applyServerReadiness(result.readiness);
        } catch (error) {
            console.error(error);
            setExportStatus(error.message || 'Could not save the current map.', true);
            setReadinessItem('currentMapSaved', 'fail', error.message || 'Save failed.');
        }
    }

    function exportAtlasStructure() {
        try {
            const exportedManifest = utils.serializeFlatManifestState({
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
        try {
            const exportedManifest = utils.serializeFlatManifestState({
                masterMapData: state.atlasTree,
                currentMapId: state.currentMap?.id || '',
                mapSettings: state.currentMap ? readMapSettingsForm() : {}
            });
            setExportStatus('Saving maps.json...');
            const result = await saveEditorDocument('/api/editor/save-atlas', {
                document: exportedManifest
            });
            setExportStatus(`Saved ${result.saved} and regenerated ${result.atlas}.`);
            setReadinessItem('atlasRegenerated', 'pass', `Regenerated ${result.atlas}.`);
            setReadinessItem('dataValidation', 'pass', 'Validation passed.');
            applyServerReadiness(result.readiness);
        } catch (error) {
            console.error(error);
            setExportStatus(error.message || 'Could not save maps.json.', true);
            setReadinessItem('atlasRegenerated', 'fail', error.message || 'Atlas save failed.');
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
            if (result.status === 'failed' || result.ok === false) {
                throw new Error(result.error || 'Preview build failed.');
            }
        }
    }

    async function buildLivePreview() {
        if (state.editorDirty) {
            setReadinessItem('currentMapSaved', 'warn', 'Save current map changes before building preview.');
            setExportStatus('Save current map changes before building live preview.', true);
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

    async function selectMap(mapId) {
        const atlasNode = utils.findMapRecursive(state.atlasTree, mapId);
        if (!atlasNode) {
            throw new Error(`Could not find map "${mapId}".`);
        }

        state.currentMapId = mapId;
        state.currentMapDataUrl = String(atlasNode.dataUrl || '').trim();
        clearDrawMode();
        deselectFeature();

        const canResolve = Boolean(
            String(atlasNode.dataUrl || '').trim() ||
            String(atlasNode.imageUrl || '').trim() ||
            Array.isArray(atlasNode.pointsOfInterest) ||
            Array.isArray(atlasNode.regions) ||
            Array.isArray(atlasNode.lines) ||
            Array.isArray(atlasNode.roads)
        );

        if (canResolve) {
            const resolvedMap = await utils.resolveFileBackedMapDocument(atlasNode, {
                loadJsonByPath: (relativePath) => fetchJsonAsset(relativePath)
            });
            state.atlasTree = replaceNodeById(state.atlasTree, mapId, resolvedMap);
        }

        state.currentMap = utils.findMapRecursive(state.atlasTree, mapId);
        if (!state.currentMapDataUrl) {
            state.currentMapDataUrl = String(state.currentMap?.dataUrl || '').trim();
        }
        state.lineCollectionKey = utils.detectLineCollectionKey(state.currentMap);
        renderAtlasTree();
        renderMapSettingsForm();
        renderFeatureLists();
        renderFeatureInspector();
        setSelectionStatus(`Editing "${state.currentMap.name || state.currentMap.id}".`);
        renderMapLayers(true);
        setExportStatus('');
        state.editorDirty = false;
        setReadinessItem('currentMapSaved', 'pass', 'No unsaved editor changes.');

        dom.appShell.setAttribute('data-mode', 'edit');
        queueMapViewportReset();
    }

    function initializeMap() {
        state.map = L.map('editor-map', {
            crs: L.CRS.Simple,
            minZoom: -4,
            maxZoom: 3,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            doubleClickZoom: false
        });
        state.map.setView([0, 0], 0, { animate: false });
        state.map.on('click', handleMapClick);

        state.pointLayer = L.layerGroup().addTo(state.map);
        state.regionLayer = L.layerGroup().addTo(state.map);
        state.lineLayer = L.layerGroup().addTo(state.map);
        state.vertexLayer = L.layerGroup().addTo(state.map);
        state.draftLayer = L.layerGroup().addTo(state.map);
        window.addEventListener('resize', queueMapViewportReset);
    }

    function registerEventListeners() {
        const debouncedRenderAtlasTree = debounce((value) => {
            state.treeSearch = String(value || '').trim();
            renderAtlasTree();
        }, 300);

        dom.treeSearch.addEventListener('input', (event) => {
            debouncedRenderAtlasTree(event.target.value);
        });

        dom.reloadButton.addEventListener('click', () => {
            window.location.reload();
        });

        dom.mapSettingsForm.addEventListener('change', () => {
            if (!state.currentMap) return;
            try {
                updateTreeAfterSettingsChange();
                markCurrentMapDirty('Map metadata changed.');
            } catch (error) {
                console.error(error);
                setSelectionStatus(error.message || 'Could not apply map settings.');
            }
        });

        dom.featureForm.addEventListener('change', updateSelectedFeatureFromForm);
        dom.featureForm.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target?.closest('[data-action]');
            if (!button || !dom.featureForm.contains(button)) return;

            const feature = getSelectedFeature();
            if (!feature || state.selectedFeature.mode !== 'points') return;

            if (button.dataset.action === 'add-detail-section') {
                event.preventDefault();
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
                sections.splice(index, 1);
                renderFeatureInspector();
                markCurrentMapDirty('Detail section changed.');
                setSelectionStatus('Removed detail section.');
            }
        });

        // ⚡ Bolt: Debounce input handling to prevent UI lag on every keystroke
        const debouncedUpdateSelectedFeatureFromForm = debounce((event) => {
            updateSelectedFeatureFromForm(event);
        }, 300);

        dom.featureForm.addEventListener('input', (event) => {
            const field = event.target.dataset.field;
            if (
                !field ||
                field === 'description' ||
                field === 'summary' ||
                field === 'properties' ||
                field === 'propertiesText' ||
                field === 'tags' ||
                field === 'detailSections'
            ) return;
            debouncedUpdateSelectedFeatureFromForm(event);
        });

        dom.featureTypeSelect.addEventListener('change', (event) => {
            state.featureListState.type = event.target.value;
            state.featureListState.expanded = false;
            renderFeatureLists();
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

        dom.addPoiButton.addEventListener('click', () => beginDrawMode('point'));
        dom.addRegionButton.addEventListener('click', () => beginDrawMode('region'));
        dom.addLineButton.addEventListener('click', () => beginDrawMode('line'));
        dom.finishDrawButton.addEventListener('click', finishDraftGeometry);
        dom.cancelDrawButton.addEventListener('click', () => {
            clearDrawMode();
            setSelectionStatus('Canceled the current draft.');
        });
        dom.deleteSelectionButton.addEventListener('click', deleteSelectedFeature);
        dom.resetViewButton.addEventListener('click', () => {
            if (state.currentBounds) {
                queueMapViewportReset();
            }
        });
        if (dom.chooseMapButton) {
            dom.chooseMapButton.addEventListener('click', () => {
                dom.appShell.setAttribute('data-mode', 'select');
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
        dom.exportCurrentMapButton.addEventListener('click', exportCurrentMapJson);
        dom.exportAtlasStructureButton.addEventListener('click', exportAtlasStructure);
    }

    async function detectLocalSaveApi() {
        setLocalSaveAvailability(false);
        setReadinessItem('saveServer', 'pending', 'Checking local editor server.');
        try {
            const response = await fetch('/api/editor/status', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (!payload || typeof payload.saveEnabled !== 'boolean') {
                throw new Error('Save API returned an invalid status.');
            }
            applyServerReadiness(payload.readiness);
            if (payload.saveEnabled) {
                setLocalSaveAvailability(true);
                setReadinessItem('saveServer', 'pass', 'Connected.');
                setExportStatus('Direct saves enabled.');
            } else {
                const message = payload.message || 'Start an authorized Map Studio draft to enable saves.';
                setLocalSaveAvailability(false, message);
                setReadinessItem('saveServer', 'warn', message);
                setExportStatus(message);
            }
        } catch (error) {
            setLocalSaveAvailability(false);
            setReadinessItem('saveServer', 'fail', 'Run npm run editor.');
        }
    }

    async function initializeEditor() {
        try {
            initializeMap();
            registerEventListeners();
            renderPublishReadiness();
            detectLocalSaveApi();

            const atlas = await fetchJsonAsset('maps/atlas-index.json');
            if (!atlas || !Array.isArray(atlas.tree)) {
                throw new Error('maps/atlas-index.json did not return a valid tree.');
            }

            state.atlasTree = utils.normalizeManifestTree(atlas.tree);
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
            renderAtlasTree();

            const requestedMapId = new URLSearchParams(window.location.search).get('map');
            const selectionEntries = utils.collectMapSelectionEntries(state.atlasTree);
            const initialMap = selectionEntries.find((entry) => entry.id === requestedMapId && !entry.disabled) ||
                selectionEntries.find((entry) => !entry.disabled);
            if (initialMap) {
                await selectMap(initialMap.id);
            } else {
                renderMapSettingsForm();
                renderFeatureLists();
                renderFeatureInspector();
                setSelectionStatus('No loadable maps were found in the atlas.');
            }
        } catch (error) {
            console.error(error);
            setSelectionStatus(error.message || 'Could not initialize the map editor.');
            dom.atlasTree.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'map-editor-placeholder';
            p.textContent = error.message || 'Initialization failed.';
            dom.atlasTree.appendChild(p);
        }
    }

    initializeEditor();
}());
