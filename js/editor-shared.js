(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.MapEditorUtils = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeManifestTree(items) {
        if (!Array.isArray(items)) return [];
        return cloneJson(items);
    }

    function getManifestEntries(manifestDocument) {
        if (Array.isArray(manifestDocument)) return cloneJson(manifestDocument);
        if (manifestDocument && Array.isArray(manifestDocument.maps)) {
            return cloneJson(manifestDocument.maps);
        }
        return null;
    }

    function isFlatManifestEntry(entry) {
        if (!entry || typeof entry !== 'object') return false;
        return Object.prototype.hasOwnProperty.call(entry, 'parentId') ||
            Object.prototype.hasOwnProperty.call(entry, 'order');
    }

    function buildManifestTreeFromFlatEntries(entries) {
        if (!Array.isArray(entries)) return [];

        const normalizedEntries = cloneJson(entries)
            .filter((entry) => entry && typeof entry === 'object' && String(entry.id || '').trim());
        const knownIds = new Set(normalizedEntries.map((entry) => String(entry.id || '').trim()));
        const childrenByParentId = new Map();

        normalizedEntries.forEach((entry, index) => {
            const normalizedId = String(entry.id || '').trim();
            const rawParentId = String(entry.parentId || '').trim();
            const normalizedParentId = rawParentId && knownIds.has(rawParentId) ? rawParentId : '';
            if (!childrenByParentId.has(normalizedParentId)) {
                childrenByParentId.set(normalizedParentId, []);
            }
            childrenByParentId.get(normalizedParentId).push({ entry, index, normalizedId });
        });

        function buildNodes(parentId = '') {
            const groupedEntries = childrenByParentId.get(parentId) || [];
            groupedEntries.sort((left, right) => {
                const leftOrder = Number.isFinite(Number(left.entry.order))
                    ? Number(left.entry.order)
                    : Number.MAX_SAFE_INTEGER;
                const rightOrder = Number.isFinite(Number(right.entry.order))
                    ? Number(right.entry.order)
                    : Number.MAX_SAFE_INTEGER;
                if (leftOrder !== rightOrder) return leftOrder - rightOrder;
                return left.index - right.index;
            });

            return groupedEntries.map(({ entry, normalizedId }) => {
                const node = cloneJson(entry);
                delete node.parentId;
                delete node.order;

                const children = buildNodes(normalizedId);
                if (children.length > 0) node.children = children;
                else delete node.children;

                return node;
            });
        }

        return buildNodes('');
    }

    function buildManifestTreeFromDocument(manifestDocument) {
        const manifestEntries = getManifestEntries(manifestDocument);
        if (!Array.isArray(manifestEntries)) return [];
        if (!manifestEntries.some(isFlatManifestEntry)) {
            return normalizeManifestTree(manifestEntries);
        }
        return buildManifestTreeFromFlatEntries(manifestEntries);
    }

    function buildFlatManifestEntries(items, options = {}) {
        if (!Array.isArray(items)) return [];

        const keysToCopy = Array.isArray(options.keysToCopy) && options.keysToCopy.length > 0
            ? options.keysToCopy
            : [
                'id',
                'name',
                'type',
                'status',
                'visibility',
                'group',
                'category',
                'blurb',
                'selectorDescription',
                'summary',
                'description',
                'dataUrl'
            ];
        const flattenedEntries = [];

        function getFlatManifestEntryId(item) {
            return String(item.id || '').trim();
        }

        function isValidManifestTreeItem(item) {
            return Boolean(item && typeof item === 'object' && getFlatManifestEntryId(item));
        }

        function shouldCopyManifestEntryKey(item, key) {
            if (item[key] === undefined) return false;
            if (typeof item[key] === 'string' && !String(item[key]).trim() && key !== 'name') return false;
            return true;
        }

        function createFlatManifestEntry(item, index, parentId) {
            const entry = keysToCopy.reduce((copiedEntry, key) => {
                if (shouldCopyManifestEntryKey(item, key)) {
                    copiedEntry[key] = cloneJson(item[key]);
                }
                return copiedEntry;
            }, {});

            entry.id = getFlatManifestEntryId(item);
            entry.order = index;
            if (parentId) entry.parentId = parentId;
            return entry;
        }

        function walkChildren(item, parentId) {
            if (!Array.isArray(item.children) || item.children.length === 0) return;
            walk(item.children, parentId);
        }

        function appendFlatManifestEntry(item, index, parentId) {
            if (!isValidManifestTreeItem(item)) return;

            const entry = createFlatManifestEntry(item, index, parentId);
            flattenedEntries.push(entry);
            walkChildren(item, entry.id);
        }

        function walk(nodes, parentId = '') {
            if (!Array.isArray(nodes)) return;
            nodes.forEach((item, index) => appendFlatManifestEntry(item, index, parentId));
        }

        walk(items);
        return flattenedEntries;
    }

    function findMapRecursive(items, id) {
        if (!Array.isArray(items) || !id) return null;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (item.id === id) return item;
            if (Array.isArray(item.children)) {
                const found = findMapRecursive(item.children, id);
                if (found) return found;
            }
        }
        return null;
    }

    function filterMapTree(items, query) {
        if (!Array.isArray(items) || !query) return items;
        const q = String(query || '').trim().toLowerCase();
        if (!q) return items;

        function filterRecursive(item) {
            if (!item || typeof item !== 'object') return null;
            const name = String(item.name || item.id || '').toLowerCase();
            const group = String(item.group || item.category || '').toLowerCase();
            const children = Array.isArray(item.children) ? item.children : [];
            const filteredChildren = children.map(filterRecursive).filter(Boolean);
            if (name.includes(q) || group.includes(q) || filteredChildren.length > 0) {
                return { ...item, children: filteredChildren };
            }
            return null;
        }

        return items.map(filterRecursive).filter(Boolean);
    }

    function normalizePoint(point) {
        const base = point && typeof point === 'object' ? cloneJson(point) : {};
        return {
            ...base,
            coords: Array.isArray(base.coords) && base.coords.length === 2
                ? base.coords.map((n) => Math.round(Number(n) || 0))
                : [0, 0],
            name: base.name || '',
            pronunciation: base.pronunciation || '',
            type: base.type || 'Unknown',
            description: base.description || '',
            summary: base.summary || '',
            wikiLink: base.wikiLink || '',
            linkedMapId: base.linkedMapId || '',
            properties: base.properties && typeof base.properties === 'object' ? cloneJson(base.properties) : {},
            detailSections: normalizeDetailSections(base.detailSections),
            tags: normalizeTags(base.tags)
        };
    }

    function normalizeDetailSections(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map((section) => {
                if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
                const heading = String(section.heading || '').trim();
                const body = String(section.body || '').trim();
                if (!heading && !body) return null;
                return { heading, body };
            })
            .filter(Boolean);
    }

    function normalizeTags(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value
            .map((tag) => String(tag || '').trim())
            .filter((tag) => {
                if (!tag || seen.has(tag.toLowerCase())) return false;
                seen.add(tag.toLowerCase());
                return true;
            });
    }

    function normalizeRegion(region) {
        const base = region && typeof region === 'object' ? cloneJson(region) : {};
        return {
            ...base,
            id: base.id || `region-${(base.name || 'untitled').toLowerCase().replace(/\s+/g, '-')}`,
            name: base.name || '',
            pronunciation: base.pronunciation || '',
            type: base.type || '',
            value: base.value || '',
            description: base.description || '',
            summary: base.summary || '',
            wikiLink: base.wikiLink || '',
            linkedMapId: base.linkedMapId || '',
            color: base.color || '#3388ff',
            fillColor: base.fillColor || '#3388ff',
            fillOpacity: base.fillOpacity ?? 0.2,
            coordinates: Array.isArray(base.coordinates)
                ? base.coordinates.map((coord) => [Math.round(Number(coord[0]) || 0), Math.round(Number(coord[1]) || 0)])
                : [],
            properties: base.properties && typeof base.properties === 'object' ? cloneJson(base.properties) : {}
        };
    }

    function normalizeLine(line) {
        const base = line && typeof line === 'object' ? cloneJson(line) : {};
        return {
            ...base,
            id: base.id || `line-${crypto.randomUUID()}`,
            name: base.name || '',
            pronunciation: base.pronunciation || '',
            type: base.type || '',
            color: base.color || '#808080',
            weight: Math.max(1, Math.round(Number(base.weight) || 3)),
            dashArray: base.dashArray || '',
            description: base.description || '',
            summary: base.summary || '',
            wikiLink: base.wikiLink || '',
            linkedMapId: base.linkedMapId || '',
            coordinates: Array.isArray(base.coordinates)
                ? base.coordinates.map((coord) => [Math.round(Number(coord[0]) || 0), Math.round(Number(coord[1]) || 0)])
                : [],
            properties: base.properties && typeof base.properties === 'object' ? cloneJson(base.properties) : {}
        };
    }

    function detectLineCollectionKey(mapData) {
        if (mapData && Object.prototype.hasOwnProperty.call(mapData, 'lines')) return 'lines';
        if (mapData && Object.prototype.hasOwnProperty.call(mapData, 'roads')) return 'roads';
        return 'lines';
    }

    function buildRegionFilterGroups(regions) {
        const filterGroups = { Regions: {} };
        const sortedRegions = Array.isArray(regions)
            ? [...regions].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            : [];

        sortedRegions.forEach((region) => {
            if (!region || !region.type || !region.value) return;
            if (!filterGroups.Regions[region.type]) filterGroups.Regions[region.type] = [];
            if (!filterGroups.Regions[region.type].includes(region.value)) {
                filterGroups.Regions[region.type].push(region.value);
            }
        });

        Object.keys(filterGroups.Regions).forEach((type) => {
            filterGroups.Regions[type].sort((a, b) => String(a).localeCompare(String(b)));
        });

        return filterGroups;
    }

    function createUnavailableMapEntry(id, error = '') {
        const normalizedId = String(id || '').trim();
        return {
            id: normalizedId,
            name: `(Unavailable: ${normalizedId || 'Unknown ID'})`,
            status: 'coming-soon',
            error: error || 'Failed to load map data.',
            unselectable: true,
        };
    }

    function buildDefaultMapDataUrl(id) {
        const normalizedId = String(id || '').trim();
        return normalizedId ? `maps/${normalizedId}.json` : '';
    }

    function hasInlineEditableMapPayload(mapData) {
        if (!mapData || typeof mapData !== 'object') return false;
        return Array.isArray(mapData.pointsOfInterest) ||
            Array.isArray(mapData.regions) ||
            Array.isArray(mapData.lines) ||
            Array.isArray(mapData.roads) ||
            (mapData.filterGroups && typeof mapData.filterGroups === 'object');
    }

    function buildFileBackedMapCandidatePaths(fallbackMap, resolveDefaultDataUrl) {
        const candidatePaths = [];
        const explicitDataUrl = String(fallbackMap.dataUrl || '').trim();
        if (explicitDataUrl) candidatePaths.push(explicitDataUrl);

        const defaultDataUrl = String(resolveDefaultDataUrl(fallbackMap.id, fallbackMap) || '').trim();
        if (defaultDataUrl && !candidatePaths.includes(defaultDataUrl)) {
            candidatePaths.push(defaultDataUrl);
        }
        return candidatePaths;
    }

    function mergeFileBackedMapDocument(fallbackMap, loadedMap) {
        if (!loadedMap || typeof loadedMap !== 'object') {
            throw new Error('returned no JSON object');
        }

        const resolvedMap = {
            ...fallbackMap,
            ...cloneJson(loadedMap)
        };
        if (resolvedMap.selectorDescription === undefined && fallbackMap.selectorDescription !== undefined) {
            resolvedMap.selectorDescription = fallbackMap.selectorDescription;
        }
        delete resolvedMap.dataUrl;
        return resolvedMap;
    }

    async function loadFileBackedMapCandidate(candidatePath, fallbackMap, loadJsonByPath) {
        const loadedMap = await loadJsonByPath(candidatePath, fallbackMap);
        return mergeFileBackedMapDocument(fallbackMap, loadedMap);
    }

    async function resolveFileBackedMapDocument(mapData, options = {}) {
        if (!mapData || typeof mapData !== 'object') {
            throw new Error('Cannot resolve map document: invalid map node.');
        }

        const fallbackMap = cloneJson(mapData);
        if (hasInlineEditableMapPayload(fallbackMap)) {
            delete fallbackMap.dataUrl;
            return fallbackMap;
        }

        const loadJsonByPath = typeof options.loadJsonByPath === 'function'
            ? options.loadJsonByPath
            : null;
        const resolveDefaultDataUrl = typeof options.resolveDefaultDataUrl === 'function'
            ? options.resolveDefaultDataUrl
            : buildDefaultMapDataUrl;
        const mapId = String(fallbackMap.id || fallbackMap.name || 'unknown-map').trim();

        if (!loadJsonByPath) {
            throw new Error(`Could not resolve full map JSON for "${mapId}": no loader configured.`);
        }

        const candidatePaths = buildFileBackedMapCandidatePaths(fallbackMap, resolveDefaultDataUrl);
        if (candidatePaths.length === 0) {
            throw new Error(`Could not resolve full map JSON for "${mapId}": no dataUrl or default path was available.`);
        }

        const candidateLoads = candidatePaths.map(async (candidatePath) => {
            try {
                return {
                    status: 'fulfilled',
                    value: await loadFileBackedMapCandidate(candidatePath, fallbackMap, loadJsonByPath)
                };
            } catch (reason) {
                return { status: 'rejected', reason };
            }
        });
        const failures = [];
        for (let index = 0; index < candidateLoads.length; index += 1) {
            const result = await candidateLoads[index];
            if (result.status === 'fulfilled') {
                return result.value;
            }
            failures.push(`${candidatePaths[index]} (${result.reason?.message || 'Unknown error.'})`);
        }

        throw new Error(`Could not resolve full map JSON for "${mapId}": tried ${failures.join('; ')}`);
    }

    function normalizeRepoEntryPath(entry) {
        if (!entry || typeof entry !== 'object') return '';
        const rawPath = entry.path || entry.relativePath || entry.webkitRelativePath || entry.name || '';
        return String(rawPath)
            .replace(/\\/g, '/')
            .replace(/^\.?\//, '')
            .replace(/\/+/g, '/')
            .trim();
    }

    function buildRepoPathAliases(pathname) {
        const normalizedPath = String(pathname || '').trim();
        if (!normalizedPath) return [];

        const parts = normalizedPath.split('/').filter(Boolean);
        const aliases = [];
        for (let index = 0; index < parts.length; index += 1) {
            aliases.push(parts.slice(index).join('/'));
        }
        return aliases;
    }

    function getRequiredMapImageUrl(mapData) {
        const imageUrl = String(mapData?.imageUrl || '').trim();
        if (imageUrl) return imageUrl;

        throw new Error(`Map "${String(mapData?.id || mapData?.name || 'unknown-map')}" is missing an imageUrl.`);
    }

    function createNormalizedRepoEntry(entry) {
        const normalizedPath = normalizeRepoEntryPath(entry);
        if (!normalizedPath) return null;

        return {
            ...entry,
            path: normalizedPath
        };
    }

    function shouldReplaceRepoPathAlias(existingEntry, normalizedEntry) {
        return !existingEntry || existingEntry.path.length > normalizedEntry.path.length;
    }

    function setRepoPathAlias(entryByAlias, alias, normalizedEntry) {
        const existingEntry = entryByAlias.get(alias);
        if (!shouldReplaceRepoPathAlias(existingEntry, normalizedEntry)) return;

        entryByAlias.set(alias, normalizedEntry);
    }

    function indexRepoEntryAliases(entryByAlias, entry) {
        const normalizedEntry = createNormalizedRepoEntry(entry);
        if (!normalizedEntry) return;

        buildRepoPathAliases(normalizedEntry.path).forEach((alias) => {
            setRepoPathAlias(entryByAlias, alias, normalizedEntry);
        });
    }

    function assertRepoFileEntries(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('No files were provided for the repo folder.');
        }
    }

    function createRepoEntryTextReader(options = {}) {
        if (typeof options.readText === 'function') return options.readText;

        return async (entry) => {
            if (!entry || typeof entry !== 'object') {
                throw new Error('Missing repo file entry.');
            }
            if (typeof entry.text === 'string') return entry.text;
            if (typeof entry.text === 'function') return entry.text();
            if (entry.file && typeof entry.file.text === 'function') return entry.file.text();
            throw new Error(`Could not read "${normalizeRepoEntryPath(entry)}".`);
        };
    }

    function buildRepoEntryAliasIndex(entries) {
        const entryByAlias = new Map();

        entries.forEach((entry) => {
            indexRepoEntryAliases(entryByAlias, entry);
        });

        return entryByAlias;
    }

    function normalizeRepoLookupPath(relativePath, missingPathMessage) {
        const normalizedPath = String(relativePath || '')
            .replace(/\\/g, '/')
            .replace(/^\.?\//, '')
            .replace(/\/+/g, '/')
            .trim();
        if (!normalizedPath) {
            throw new Error(missingPathMessage);
        }
        return normalizedPath;
    }

    function createRepoFileResolver(entryByAlias) {
        return function getFileEntry(relativePath) {
            const normalizedPath = normalizeRepoLookupPath(relativePath, 'Missing required file path.');
            const entry = entryByAlias.get(normalizedPath);
            if (!entry) {
                throw new Error(`Missing required file: ${normalizedPath}`);
            }
            return entry;
        };
    }

    function createRepoJsonLoader(getFileEntry, readText) {
        const jsonCache = new Map();

        return async function loadJsonByPath(relativePath) {
            const normalizedPath = normalizeRepoLookupPath(relativePath, 'Missing JSON file path.');

            if (!jsonCache.has(normalizedPath)) {
                jsonCache.set(normalizedPath, Promise.resolve().then(async () => {
                    const entry = getFileEntry(normalizedPath);
                    const rawText = await readText(entry);
                    try {
                        return JSON.parse(rawText);
                    } catch (error) {
                        throw new Error(`Invalid JSON in ${normalizedPath}: ${error.message}`);
                    }
                }));
            }

            return cloneJson(await jsonCache.get(normalizedPath));
        };
    }

    function assertRepoManifestDocument(manifestDocument, manifest) {
        if (
            (!Array.isArray(manifestDocument?.maps) && !Array.isArray(manifestDocument)) ||
            manifest.length === 0
        ) {
            throw new Error('maps/maps.json must contain manifest entries.');
        }
    }

    async function loadRepoManifestTree(loadJsonByPath) {
        const manifestDocument = await loadJsonByPath('maps/maps.json');
        const manifest = buildManifestTreeFromDocument(manifestDocument);
        assertRepoManifestDocument(manifestDocument, manifest);
        return manifest;
    }

    function resolveRepoManifestDataUrl(mapId, manifestNode) {
        return String(manifestNode?.dataUrl || buildDefaultMapDataUrl(mapId)).trim();
    }

    async function hydrateRepoBrowseTreeFromManifest(manifest, loadJsonByPath) {
        return hydrateFileBackedManifestTree(
            manifest,
            async (mapId, manifestNode) => loadJsonByPath(resolveRepoManifestDataUrl(mapId, manifestNode)),
            {
                resolveDataUrl: resolveRepoManifestDataUrl
            }
        );
    }

    async function loadRepoBrowseTree(manifest, loadJsonByPath) {
        try {
            const atlas = await loadJsonByPath('maps/atlas-index.json');
            return normalizeManifestTree(Array.isArray(atlas?.tree) ? atlas.tree : []);
        } catch (error) {
            return hydrateRepoBrowseTreeFromManifest(manifest, loadJsonByPath);
        }
    }

    function createRepoMapDocumentResolver(loadJsonByPath) {
        return (mapData) => resolveFileBackedMapDocument(mapData, {
            loadJsonByPath,
            resolveDefaultDataUrl: buildDefaultMapDataUrl
        });
    }

    async function createRepoFileBackedMapSource(entries, options = {}) {
        assertRepoFileEntries(entries);

        const readText = createRepoEntryTextReader(options);
        const entryByAlias = buildRepoEntryAliasIndex(entries);
        const getFileEntry = createRepoFileResolver(entryByAlias);
        const loadJsonByPath = createRepoJsonLoader(getFileEntry, readText);
        const manifest = await loadRepoManifestTree(loadJsonByPath);
        const browseTree = await loadRepoBrowseTree(manifest, loadJsonByPath);

        return {
            kind: 'repo-folder',
            baseManifest: normalizeManifestTree(manifest),
            browseTree,
            loadJsonByPath,
            resolveMapDocument: createRepoMapDocumentResolver(loadJsonByPath),
            resolveImageEntry: (mapData) => getFileEntry(getRequiredMapImageUrl(mapData))
        };
    }

    async function hydrateFileBackedManifestTree(items, loadMapById, options = {}) {
        if (!Array.isArray(items) || typeof loadMapById !== 'function') return [];

        const cache = options.cache instanceof Map ? options.cache : new Map();
        const loadPromiseCache = new Map();
        const resolveDataUrl = typeof options.resolveDataUrl === 'function'
            ? options.resolveDataUrl
            : null;

        function fetchMap(id, nodeContext) {
            if (!loadPromiseCache.has(id)) {
                loadPromiseCache.set(id, Promise.resolve().then(() => loadMapById(id, nodeContext)));
            }
            return loadPromiseCache.get(id);
        }

        async function loadHydratedMapById(normalizedId) {
            try {
                const loadedMap = await fetchMap(normalizedId, undefined);
                if (!loadedMap || typeof loadedMap !== 'object') {
                    return createUnavailableMapEntry(normalizedId, `Map "${normalizedId}" returned no data.`);
                }

                return await hydrateNode(loadedMap);
            } catch (error) {
                return createUnavailableMapEntry(normalizedId, error?.message || 'Unknown error.');
            }
        }

        async function hydrateFromId(id) {
            const normalizedId = String(id || '').trim();
            if (!normalizedId) return null;

            if (!cache.has(normalizedId)) {
                cache.set(normalizedId, loadHydratedMapById(normalizedId));
            }

            return cloneJson(await cache.get(normalizedId));
        }

        function shouldLoadFileBackedPayload(mapData, normalizedId) {
            if (!normalizedId) return false;
            if (!String(mapData.dataUrl || '').trim()) return false;
            return !hasInlineEditableMapPayload(mapData);
        }

        async function mergeFileBackedPayload(mapData, normalizedId) {
            if (!shouldLoadFileBackedPayload(mapData, normalizedId)) return mapData;

            try {
                const loadedMap = await fetchMap(normalizedId, mapData);
                if (!loadedMap || typeof loadedMap !== 'object') return mapData;

                return {
                    ...cloneJson(loadedMap),
                    ...mapData
                };
            } catch (error) {
                return createUnavailableMapEntry(normalizedId, error?.message || 'Unknown error.');
            }
        }

        async function hydrateNode(node) {
            if (!node || typeof node !== 'object') return null;

            let hydrated = cloneJson(node);
            const normalizedId = String(hydrated.id || '').trim();
            hydrated = await mergeFileBackedPayload(hydrated, normalizedId);

            if (resolveDataUrl && hydrated.id && hydrated.imageUrl && !hydrated.dataUrl) {
                hydrated.dataUrl = resolveDataUrl(hydrated.id, hydrated);
            }

            if (Array.isArray(hydrated.children)) {
                const hydratedChildren = await Promise.all(hydrated.children.map((child) => {
                    if (typeof child === 'string') return hydrateFromId(child);
                    return hydrateNode(child);
                }));
                hydrated.children = hydratedChildren.filter(Boolean);
            }

            return hydrated;
        }

        const hydratedItems = await Promise.all(items.map((item) => {
            if (typeof item === 'string') return hydrateFromId(item);
            return hydrateNode(item);
        }));

        return hydratedItems.filter(Boolean);
    }

    function collectMapSelectionEntries(items) {
        const selections = [];
        const seenIds = new Set();

        function buildSelectionEntry(item) {
            const normalizedId = String(item.id || '').trim();
            const label = String(item.name || normalizedId || '').trim();
            const isLoadable = Boolean(
                normalizedId &&
                label &&
                item.imageUrl &&
                item.status !== 'coming-soon' &&
                !item.error
            );
            const isUnavailablePlaceholder = Boolean(
                normalizedId &&
                (item.status === 'coming-soon' || item.error)
            );

            if (!isLoadable && !isUnavailablePlaceholder) return null;
            if (seenIds.has(normalizedId)) return null;

            return {
                id: normalizedId,
                name: label || normalizedId,
                disabled: !isLoadable,
                title: String(item.error || (item.status === 'coming-soon' ? 'Unavailable' : ''))
            };
        }

        function addSelectionEntry(item) {
            const selectionEntry = buildSelectionEntry(item);
            if (!selectionEntry) return;

            seenIds.add(selectionEntry.id);
            selections.push(selectionEntry);
        }

        function collectNode(item) {
            if (!item || typeof item !== 'object') return;

            addSelectionEntry(item);
            walk(item.children);
        }

        function walk(nodes) {
            if (!Array.isArray(nodes)) return;
            nodes.forEach(collectNode);
        }

        walk(items);
        return selections;
    }

    function assignStringField(target, key, value, options = {}) {
        if (!target || typeof target !== 'object' || value === undefined) return;
        const allowEmpty = options.allowEmpty === true;
        const normalizedValue = allowEmpty ? String(value ?? '') : String(value ?? '').trim();

        if (allowEmpty || normalizedValue) {
            target[key] = normalizedValue;
            return;
        }

        delete target[key];
    }

    function assignNumberField(target, key, value, options = {}) {
        if (!target || typeof target !== 'object' || value === undefined) return;
        const rawValue = String(value ?? '').trim();
        if (!rawValue) {
            delete target[key];
            return;
        }

        const parsedValue = options.integer
            ? parseInt(rawValue, 10)
            : parseFloat(rawValue);
        if (Number.isFinite(parsedValue)) {
            target[key] = parsedValue;
            return;
        }

        delete target[key];
    }

    const LAT_LON_BOUND_KEYS = ['north', 'south', 'east', 'west'];

    function parseLatLonBoundValue(value) {
        const rawValue = String(value ?? '').trim();
        if (!rawValue) return null;

        const parsedValue = parseFloat(rawValue);
        return Number.isFinite(parsedValue) ? parsedValue : null;
    }

    function buildLatLonBounds(latLonBounds) {
        const nextBounds = {};
        LAT_LON_BOUND_KEYS.forEach((key) => {
            const parsedValue = parseLatLonBoundValue(latLonBounds[key]);
            if (parsedValue !== null) {
                nextBounds[key] = parsedValue;
            }
        });

        return Object.keys(nextBounds).length > 0 ? nextBounds : null;
    }

    function assignLatLonBounds(mapToUpdate, latLonBounds) {
        if (!latLonBounds || typeof latLonBounds !== 'object') return;

        const nextBounds = buildLatLonBounds(latLonBounds);
        if (nextBounds) {
            mapToUpdate.latLonBounds = nextBounds;
            return;
        }

        delete mapToUpdate.latLonBounds;
    }

    function applyMapSettings(mapToUpdate, mapSettings = {}) {
        if (!mapToUpdate || typeof mapToUpdate !== 'object') return mapToUpdate;

        assignStringField(mapToUpdate, 'name', mapSettings.name, { allowEmpty: true });
        assignStringField(mapToUpdate, 'blurb', mapSettings.blurb, { allowEmpty: true });
        assignStringField(mapToUpdate, 'selectorDescription', mapSettings.selectorDescription, { allowEmpty: true });
        assignStringField(mapToUpdate, 'type', mapSettings.type);
        assignStringField(mapToUpdate, 'status', mapSettings.status);
        assignStringField(mapToUpdate, 'visibility', mapSettings.visibility);
        assignStringField(mapToUpdate, 'imageUrl', mapSettings.imageUrl);
        assignStringField(mapToUpdate, 'mobileImageUrl', mapSettings.mobileImageUrl);
        assignStringField(mapToUpdate, 'imageUrlMobile', mapSettings.imageUrlMobile);
        assignStringField(mapToUpdate, 'smallImageUrl', mapSettings.smallImageUrl);
        assignStringField(mapToUpdate, 'imageUrlSmall', mapSettings.imageUrlSmall);
        assignStringField(mapToUpdate, 'scaleUnitName', mapSettings.scaleUnitName);
        assignStringField(mapToUpdate, 'backgroundColor', mapSettings.backgroundColor);
        assignStringField(mapToUpdate, 'atmosphere', mapSettings.atmosphere);
        assignStringField(mapToUpdate, 'dataUrl', mapSettings.dataUrl);
        if (mapSettings.group !== undefined) {
            assignStringField(mapToUpdate, 'group', mapSettings.group);
            delete mapToUpdate.category;
        }

        assignNumberField(mapToUpdate, 'width', mapSettings.width, { integer: true });
        assignNumberField(mapToUpdate, 'height', mapSettings.height, { integer: true });
        assignNumberField(mapToUpdate, 'scalePixels', mapSettings.scalePixels, { integer: true });
        assignNumberField(mapToUpdate, 'scaleKilometers', mapSettings.scaleKilometers);

        assignLatLonBounds(mapToUpdate, mapSettings.latLonBounds);
    }

    function stripStructureFieldsFromMapDocument(mapDocument) {
        if (!mapDocument || typeof mapDocument !== 'object') return null;
        const exportedDocument = cloneJson(mapDocument);
        delete exportedDocument.children;
        delete exportedDocument.parentId;
        delete exportedDocument.order;
        delete exportedDocument.dataUrl;
        return exportedDocument;
    }

    function serializeEditorState(options) {
        const {
            masterMapData,
            currentMapId,
            collectedPoints,
            collectedRegions,
            collectedLines,
            mapSettings = {},
            lineCollectionKey = 'lines',
            selectedMapOnly = false
        } = options || {};

        if (!currentMapId) return null;

        const updatedMasterData = Array.isArray(masterMapData)
            ? cloneJson(masterMapData)
            : [];
        const mapToUpdate = findMapRecursive(updatedMasterData, currentMapId);
        if (!mapToUpdate) return null;

        applyMapSettings(mapToUpdate, mapSettings);

        const sortedPoints = (Array.isArray(collectedPoints) ? collectedPoints : [])
            .map(normalizePoint)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        const sortedRegions = (Array.isArray(collectedRegions) ? collectedRegions : [])
            .map(normalizeRegion)
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        const sortedLines = (Array.isArray(collectedLines) ? collectedLines : [])
            .map(normalizeLine)
            .sort((a, b) => String(a.name || a.id || '').localeCompare(String(b.name || b.id || '')));

        mapToUpdate.pointsOfInterest = sortedPoints.map((point) => ({
            ...point,
            coords: point.coords,
            properties: point.properties || {}
        }));

        mapToUpdate.regions = sortedRegions.map((region) => ({
            ...region,
            coordinates: region.coordinates,
            properties: region.properties || {}
        }));

        mapToUpdate.filterGroups = buildRegionFilterGroups(sortedRegions);

        mapToUpdate[lineCollectionKey] = sortedLines.map((line) => ({
            ...line,
            coordinates: line.coordinates,
            properties: line.properties || {}
        }));
        delete mapToUpdate[lineCollectionKey === 'roads' ? 'lines' : 'roads'];

        return selectedMapOnly ? mapToUpdate : updatedMasterData;
    }

    function serializeManifestState(options) {
        const {
            masterMapData,
            currentMapId,
            mapSettings = {}
        } = options || {};

        if (!currentMapId) return null;

        const updatedMasterData = Array.isArray(masterMapData)
            ? cloneJson(masterMapData)
            : [];
        const mapToUpdate = findMapRecursive(updatedMasterData, currentMapId);
        if (mapToUpdate) {
            applyMapSettings(mapToUpdate, mapSettings);
        }
        return updatedMasterData;
    }

    function serializeFlatManifestState(options) {
        const {
            masterMapData,
            currentMapId,
            mapSettings = {}
        } = options || {};

        const updatedMasterData = Array.isArray(masterMapData)
            ? cloneJson(masterMapData)
            : [];
        const mapToUpdate = currentMapId ? findMapRecursive(updatedMasterData, currentMapId) : null;
        if (mapToUpdate) {
            applyMapSettings(mapToUpdate, mapSettings);
        }
        return buildFlatManifestEntries(updatedMasterData);
    }

    function serializeMapDocumentState(options) {
        const serializedMap = serializeEditorState({
            ...options,
            selectedMapOnly: true
        });
        if (!serializedMap) return null;
        return stripStructureFieldsFromMapDocument(serializedMap);
    }

    function buildFeatureSelectionKey(mode, item) {
        if (!item || !mode) return '';
        const identity = mode === 'lines'
            ? String(item.id || item.name || '')
            : String(item.name || item.id || '');
        return JSON.stringify([mode, identity]);
    }

    function resolveFeatureIndexFromSelection(mode, items, selectionKey) {
        if (!mode || !selectionKey || !Array.isArray(items)) return -1;
        let parsed;
        try {
            parsed = JSON.parse(selectionKey);
        } catch (error) {
            return -1;
        }
        if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== mode) return -1;
        const identity = String(parsed[1] || '');
        if (!identity) return -1;
        return items.findIndex((item) => {
            if (!item) return false;
            if (mode === 'lines') return String(item.id || item.name || '') === identity;
            return String(item.name || item.id || '') === identity;
        });
    }

    // Round each corner with a quadratic curve contained by its adjacent edges.
    // Emit standard coordinates so every viewer/exporter can use the shape.
    function roundGeometryCorners(coordinates, closed = false) {
        const points = coordinates.map((point) => point.slice());
        if (points.length < 3) return points;
        const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
        const anchors = points.filter((point, index) => !index || !samePoint(point, points[index - 1]));
        if (closed && anchors.length > 1 && samePoint(anchors[0], anchors[anchors.length - 1])) anchors.pop();
        if (anchors.length < 3) return points;
        const result = [];
        const append = (point) => {
            const rounded = point.map(Math.round);
            if (!result.length || !samePoint(result[result.length - 1], rounded)) result.push(rounded);
        };
        anchors.forEach((point, index) => {
            if (!closed && (index === 0 || index === anchors.length - 1)) {
                append(point);
                return;
            }
            const previous = anchors[(index + anchors.length - 1) % anchors.length];
            const next = anchors[(index + 1) % anchors.length];
            const start = point.map((value, axis) => value + (previous[axis] - value) * 0.25);
            const end = point.map((value, axis) => value + (next[axis] - value) * 0.25);
            for (let step = 0; step <= 16; step += 1) {
                const t = step / 16;
                append(point.map((value, axis) => (1 - t) ** 2 * start[axis] + 2 * (1 - t) * t * value + t ** 2 * end[axis]));
            }
        });
        // Rounding to map pixels must not collapse a tiny but valid input shape.
        return result.length >= (closed ? 3 : 2) ? result : points;
    }

    function normalizeBezierHandles(anchors, handles = []) {
        const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
            ? value.slice() : null;
        return anchors.map((_, index) => {
            const incoming = pair(handles?.[index]?.in);
            const outgoing = pair(handles?.[index]?.out);
            return incoming || outgoing ? { in: incoming, out: outgoing } : null;
        });
    }

    function createBezierHandles(anchors, index, closed) {
        const point = anchors[index];
        const previous = index > 0 ? anchors[index - 1] : (closed ? anchors.at(-1) : null);
        const next = index < anchors.length - 1 ? anchors[index + 1] : (closed ? anchors[0] : null);
        const from = previous || point;
        const to = next || point;
        const tangent = [to[0] - from[0], to[1] - from[1]];
        const length = Math.hypot(...tangent);
        if (!length) return null;
        const handle = (neighbor, direction) => neighbor
            ? point.map((value, axis) => Math.round(value + direction * tangent[axis] / length * Math.hypot(neighbor[0] - point[0], neighbor[1] - point[1]) / 3))
            : null;
        return { in: handle(previous, -1), out: handle(next, 1) };
    }

    // Cubic Bezier segments pass through the anchors. Null handles give exact
    // straight segments. Adaptive subdivision bounds curve error to half a map
    // pixel before rounding to the editor's integer-coordinate file format.
    function sampleBezierPath(anchors, handles = [], closed = false) {
        if (anchors.length < 2) return anchors.map(point => point.slice());
        const result = [anchors[0].slice()];
        const midpoint = (a, b) => a.map((value, axis) => (value + b[axis]) / 2);
        function append(point) {
            const rounded = point.map(Math.round);
            const last = result.at(-1);
            if (last[0] !== rounded[0] || last[1] !== rounded[1]) result.push(rounded);
        }
        function subdivide(a, b, c, d, depth = 0) {
            // Distance to the chord segment also catches collinear loops and
            // controls beyond the endpoints, unlike distance to an infinite line.
            const chord = d.map((value, axis) => value - a[axis]);
            const lengthSquared = chord[0] ** 2 + chord[1] ** 2;
            const distance = point => {
                const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * chord[0] + (point[1] - a[1]) * chord[1]) / lengthSquared)) : 0;
                return Math.hypot(...point.map((value, axis) => value - a[axis] - t * chord[axis]));
            };
            if (depth >= 12 || Math.max(distance(b), distance(c)) <= 0.5) {
                append(d);
                return;
            }
            const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
            const abc = midpoint(ab, bc), bcd = midpoint(bc, cd);
            const middle = midpoint(abc, bcd);
            subdivide(a, ab, abc, middle, depth + 1);
            subdivide(middle, bcd, cd, d, depth + 1);
        }
        const count = closed ? anchors.length : anchors.length - 1;
        for (let index = 0; index < count; index += 1) {
            const next = (index + 1) % anchors.length;
            const start = anchors[index], end = anchors[next];
            const outgoing = handles[index]?.out, incoming = handles[next]?.in;
            if (outgoing || incoming) subdivide(start, outgoing || start, incoming || end, end);
            else append(end);
        }
        if (closed && result.length > 1 && result.at(-1).every((value, axis) => value === result[0][axis])) result.pop();
        return result;
    }

    function getFeatureBezierGeometry(feature, closed) {
        const geometry = feature?.bezier;
        if (geometry?.version !== 1 || !Array.isArray(geometry.anchors) || geometry.anchors.length < (closed ? 3 : 2)) return null;
        if (!geometry.anchors.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) return null;
        const handles = normalizeBezierHandles(geometry.anchors, geometry.handles);
        // Coordinates remain authoritative for old clients and manual JSON edits.
        if (JSON.stringify(sampleBezierPath(geometry.anchors, handles, closed)) !== JSON.stringify(feature.coordinates)) return null;
        return { anchors: geometry.anchors, handles };
    }

    return {
        normalizeBezierHandles,
        createBezierHandles,
        sampleBezierPath,
        getFeatureBezierGeometry,
        roundGeometryCorners,
        buildFeatureSelectionKey,
        buildFlatManifestEntries,
        buildRegionFilterGroups,
        buildManifestTreeFromDocument,
        buildManifestTreeFromFlatEntries,
        cloneJson,
        detectLineCollectionKey,
        filterMapTree,
        findMapRecursive,
        normalizeDetailSections,
        normalizeLine,
        normalizeManifestTree,
        normalizePoint,
        normalizeRegion,
        normalizeTags,
        resolveFeatureIndexFromSelection,
        createUnavailableMapEntry,
        createRepoFileBackedMapSource,
        hydrateFileBackedManifestTree,
        collectMapSelectionEntries,
        applyMapSettings,
        resolveFileBackedMapDocument,
        serializeEditorState,
        serializeManifestState,
        serializeFlatManifestState,
        serializeMapDocumentState,
        stripStructureFieldsFromMapDocument
    };
}));
