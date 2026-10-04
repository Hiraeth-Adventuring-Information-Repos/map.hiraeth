#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const defaultTileSize = 256;
const generatedTileMinImageSize = 2048;
const generatedTileMaxLevelSpan = 4;

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPrimitivePropertyText(properties) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return '';
    return Object.entries(properties)
        .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
        .map(([key, value]) => `${key} ${String(value)}`)
        .join(' ');
}

function getDetailSectionText(sections) {
    if (!Array.isArray(sections)) return '';
    return sections
        .map((section) => {
            if (!section || typeof section !== 'object' || Array.isArray(section)) return '';
            return `${section.heading || ''} ${section.body || ''}`;
        })
        .join(' ');
}

function getTagText(tags) {
    return Array.isArray(tags) ? tags.join(' ') : '';
}

function buildFeatureSearchText(feature) {
    return stripHtml([
        getDetailSectionText(feature?.detailSections),
        getTagText(feature?.tags),
        getPrimitivePropertyText(feature?.properties)
    ].join(' '));
}

function hasInlinePayload(item) {
    return Boolean(
        item &&
        (
            item.blurb ||
            item.filterGroups ||
            item.gmNotes ||
            item.gmOverview ||
            (Array.isArray(item.pointsOfInterest) && item.pointsOfInterest.length) ||
            (Array.isArray(item.points) && item.points.length) ||
            (Array.isArray(item.regions) && item.regions.length) ||
            (Array.isArray(item.roads) && item.roads.length) ||
            (Array.isArray(item.lines) && item.lines.length) ||
            (Array.isArray(item.encounterTables) && item.encounterTables.length)
        )
    );
}

function hasInlineChildObjects(item) {
    return Boolean(
        item &&
        Array.isArray(item.children) &&
        item.children.some((child) => child && typeof child === 'object')
    );
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
        return manifestEntries;
    }
    return buildManifestTreeFromFlatEntries(manifestEntries);
}

function buildGeneratorContext(repoRoot) {
    const mapsDir = path.join(repoRoot, 'maps');
    return {
        repoRoot,
        mapsDir,
        generatedDir: path.join(mapsDir, 'generated'),
        sourceIndexPath: path.join(mapsDir, 'maps.json'),
        atlasIndexPath: path.join(mapsDir, 'atlas-index.json'),
        writtenGeneratedFiles: new Set(),
        searchEntries: [],
        seenSearchKeys: new Set()
    };
}

function readJsonFile(fullPath) {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function readJsonFileIfExists(fullPath) {
    if (!fs.existsSync(fullPath)) return null;
    try {
        return readJsonFile(fullPath);
    } catch (error) {
        return null;
    }
}

function getAtlasComparablePayload(atlasIndex) {
    if (!atlasIndex || typeof atlasIndex !== 'object' || Array.isArray(atlasIndex)) {
        return null;
    }
    return {
        tree: atlasIndex.tree,
        searchIndex: atlasIndex.searchIndex
    };
}

function stringifyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function isExternalUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
}

function normalizePublicAssetPath(assetPath) {
    const rawPath = String(assetPath || '').trim();
    if (!rawPath || isExternalUrl(rawPath) || rawPath.startsWith('#') || rawPath.startsWith('mailto:')) {
        return '';
    }

    const withoutHash = rawPath.split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    if (!withoutQuery || path.isAbsolute(withoutQuery)) return '';

    const normalized = path.posix.normalize(withoutQuery);
    if (!normalized || normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized)) {
        return '';
    }
    return normalized;
}

function canUseGeneratedTilePath(mapId) {
    return /^[A-Za-z0-9._-]+$/.test(String(mapId || '').trim());
}

function buildGeneratedTileSource(context, mapItem) {
    if (!mapItem || Object.prototype.hasOwnProperty.call(mapItem, 'tileSource')) return null;
    const mapId = String(mapItem.id || '').trim();
    if (!mapId || !canUseGeneratedTilePath(mapId)) return null;

    const width = Number(mapItem.width);
    const height = Number(mapItem.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    const maxDimension = Math.max(width, height);
    if (maxDimension < generatedTileMinImageSize) return null;

    const imagePath = normalizePublicAssetPath(mapItem.imageUrl);
    if (!imagePath || !fs.existsSync(path.join(context.repoRoot, imagePath))) return null;

    const maxZoom = Math.max(0, Math.ceil(Math.log2(maxDimension / defaultTileSize)));
    const minZoom = Math.max(0, maxZoom - generatedTileMaxLevelSpan);
    return {
        type: 'xyz',
        urlTemplate: `tile/${mapId}/{z}/{x}/{y}.webp`,
        tileSize: defaultTileSize,
        minZoom,
        maxZoom,
        leafletNativeZoom: 0,
        zoomOffset: maxZoom
    };
}

function getGeneratedAtForNextAtlas(atlasIndexPath, nextComparablePayload) {
    const previousAtlas = readJsonFileIfExists(atlasIndexPath);
    const previousComparablePayload = getAtlasComparablePayload(previousAtlas);
    if (
        previousAtlas &&
        previousAtlas.generatedAt &&
        JSON.stringify(previousComparablePayload) === JSON.stringify(nextComparablePayload)
    ) {
        return previousAtlas.generatedAt;
    }
    return new Date().toISOString();
}

function addSearchEntry(context, entry) {
    const key = `${entry.kind}:${entry.mapId}:${entry.itemId || entry.name}`;
    if (context.seenSearchKeys.has(key)) return;
    context.seenSearchKeys.add(key);
    context.searchEntries.push(entry);
}

function buildSearchEntriesForMap(context, item) {
    if (!item || item.status === 'coming-soon' || !item.id || !item.name) return;

    addSearchEntry(context, {
        kind: 'map',
        id: `map:${item.id}`,
        mapId: item.id,
        mapName: item.name,
        name: item.name,
        summary: stripHtml(item.selectorDescription || item.summary || item.description || item.blurb || ''),
        description: stripHtml(item.description || ''),
        typeLabel: 'Map',
        visibility: String(item.visibility || 'public').toLowerCase()
    });

    const points = Array.isArray(item.pointsOfInterest) ? item.pointsOfInterest :
        (Array.isArray(item.points) ? item.points : []);
    points.forEach((point, index) => {
        if (!point || !point.name) return;
        const searchText = buildFeatureSearchText(point);
        const searchEntry = {
            kind: 'poi',
            id: `poi:${item.id}:${point.id || index}`,
            itemId: point.id || point.name,
            mapId: item.id,
            mapName: item.name,
            name: point.name,
            summary: stripHtml(point.summary || ''),
            description: stripHtml(point.description || ''),
            typeLabel: point.type || 'POI',
            visibility: String(point.visibility || 'public').toLowerCase()
        };
        if (searchText) searchEntry.searchText = searchText;
        addSearchEntry(context, searchEntry);
    });

    const regions = Array.isArray(item.regions) ? item.regions : [];
    regions.forEach((region, index) => {
        if (!region || !region.name) return;
        addSearchEntry(context, {
            kind: 'region',
            id: `region:${item.id}:${region.id || index}`,
            itemId: region.id || region.name,
            mapId: item.id,
            mapName: item.name,
            name: region.name,
            summary: stripHtml(region.summary || ''),
            description: stripHtml(region.description || ''),
            typeLabel: region.value || region.type || 'Region',
            visibility: String(region.visibility || 'public').toLowerCase()
        });
    });

    const lines = [
        ...(Array.isArray(item.roads) ? item.roads : []),
        ...(Array.isArray(item.lines) ? item.lines : [])
    ];
    lines.forEach((line, index) => {
        // Travel fragments belong to the directions graph. They have no
        // ordinary feature layer to focus and would repeat one street many times.
        if (line?.travelMode) return;
        const lineName = line && (line.name || line.type);
        if (!lineName) return;
        addSearchEntry(context, {
            kind: 'line',
            id: `line:${item.id}:${line.id || index}`,
            itemId: line.id || lineName,
            mapId: item.id,
            mapName: item.name,
            name: lineName,
            summary: stripHtml(line.summary || ''),
            description: stripHtml(line.description || ''),
            typeLabel: line.type || 'Line',
            visibility: String(line.visibility || 'public').toLowerCase()
        });
    });

}

function writeGeneratedMapData(context, item, force = false) {
    if (!item || !item.id || (!force && !hasInlinePayload(item))) return '';
    const relativeUrl = `maps/generated/${item.id}.json`;
    const absolutePath = path.join(context.repoRoot, relativeUrl);
    if (!context.writtenGeneratedFiles.has(absolutePath)) {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, `${JSON.stringify(item, null, 2)}\n`);
        context.writtenGeneratedFiles.add(absolutePath);
    }
    return relativeUrl;
}

function mergeMapDefinitions(indexItem, sourceItem) {
    const merged = cloneJson(sourceItem);
    const overlayKeys = [
        'type',
        'id',
        'name',
        'status',
        'width',
        'height',
        'imageUrl',
        'mobileImageUrl',
        'imageUrlMobile',
        'smallImageUrl',
        'imageUrlSmall',
        'imageVariants',
        'tileSource',
        'latLonBounds',
        'scalePixels',
        'scaleKilometers',
        'scaleUnitName',
        'backgroundColor',
        'atmosphere',
        'visibility',
        'group',
        'category',
        'blurb',
        'selectorDescription',
        'summary',
        'description',
        'updatedAt',
        'lastEdited',
        'modifiedAt',
        'children'
    ];

    overlayKeys.forEach((key) => {
        if (indexItem[key] !== undefined) {
            merged[key] = cloneJson(indexItem[key]);
        }
    });

    return merged;
}

function loadFileBackedMap(context, relativePath, indexItem) {
    const normalizedPath = String(relativePath || '').trim();
    const absolutePath = path.join(context.repoRoot, normalizedPath);
    const sourceItem = readJsonFile(absolutePath);
    return {
        sourceItem: mergeMapDefinitions(indexItem, sourceItem),
        dataUrl: normalizedPath
    };
}

function resolveMapSource(context, item, origin) {
    if (origin.kind === 'file') {
        return {
            sourceItem: cloneJson(item),
            dataUrl: origin.path
        };
    }

    const explicitDataUrl = String(item.dataUrl || '').trim();
    if (explicitDataUrl) {
        return loadFileBackedMap(context, explicitDataUrl, item);
    }

    if (item.type === 'folder') {
        if (item.id) {
            const defaultFilePath = `maps/${item.id}.json`;
            const absoluteDefaultPath = path.join(context.repoRoot, defaultFilePath);
            if (fs.existsSync(absoluteDefaultPath)) {
                return loadFileBackedMap(context, defaultFilePath, item);
            }
        }
        return {
            sourceItem: cloneJson(item),
            dataUrl: ''
        };
    }

    if (hasInlineChildObjects(item) || hasInlinePayload(item)) {
        return {
            sourceItem: cloneJson(item),
            dataUrl: writeGeneratedMapData(context, item, hasInlineChildObjects(item))
        };
    }

    if (item.id) {
        return loadFileBackedMap(context, `maps/${item.id}.json`, item);
    }

    return {
        sourceItem: cloneJson(item),
        dataUrl: ''
    };
}

function toManifestItem(context, item, origin) {
    const { sourceItem, dataUrl } = resolveMapSource(context, item, origin);
    const manifestItem = {};
    const keysToCopy = [
        'type',
        'id',
        'name',
        'status',
        'width',
        'height',
        'imageUrl',
        'mobileImageUrl',
        'imageUrlMobile',
        'smallImageUrl',
        'imageUrlSmall',
        'imageVariants',
        'tileSource',
        'latLonBounds',
        'scalePixels',
        'scaleKilometers',
        'scaleUnitName',
        'backgroundColor',
        'atmosphere',
        'visibility',
        'group',
        'category',
        'blurb',
        'selectorDescription',
        'summary',
        'description',
        'updatedAt',
        'lastEdited',
        'modifiedAt'
    ];

    keysToCopy.forEach((key) => {
        if (sourceItem[key] !== undefined) {
            manifestItem[key] = sourceItem[key];
        }
    });
    manifestItem.regionCount = Array.isArray(sourceItem.regions) ? sourceItem.regions.length : 0;

    const generatedTileSource = buildGeneratedTileSource(context, sourceItem);
    if (generatedTileSource) {
        manifestItem.tileSource = generatedTileSource;
    }

    if (dataUrl) {
        manifestItem.dataUrl = dataUrl;
    }

    if (Array.isArray(sourceItem.children) && sourceItem.children.length > 0) {
        manifestItem.children = sourceItem.children.map((child) => {
            if (typeof child === 'string') {
                const childPath = `maps/${child}.json`;
                const childData = readJsonFile(path.join(context.repoRoot, childPath));
                return toManifestItem(context, childData, { kind: 'file', path: childPath });
            }
            return toManifestItem(context, child, { kind: 'inline' });
        });
    }

    buildSearchEntriesForMap(context, sourceItem);
    return manifestItem;
}

function generateAtlasIndex(options = {}) {
    const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..'));
    const context = buildGeneratorContext(repoRoot);
    const manifestDocument = readJsonFile(context.sourceIndexPath);
    const rawIndex = buildManifestTreeFromDocument(manifestDocument);
    if (!Array.isArray(rawIndex) || rawIndex.length === 0) {
        throw new Error('maps/maps.json must contain manifest entries.');
    }
    const atlasTree = rawIndex.map((item) => toManifestItem(context, item, { kind: 'inline' }));
    const comparablePayload = {
        tree: atlasTree,
        searchIndex: context.searchEntries
    };
    const atlasIndex = {
        generatedAt: getGeneratedAtForNextAtlas(context.atlasIndexPath, comparablePayload),
        ...comparablePayload
    };

    const nextAtlasContent = stringifyJson(atlasIndex);
    const previousAtlasContent = fs.existsSync(context.atlasIndexPath)
        ? fs.readFileSync(context.atlasIndexPath, 'utf8')
        : '';
    if (nextAtlasContent !== previousAtlasContent) {
        fs.writeFileSync(context.atlasIndexPath, nextAtlasContent);
    }
    return {
        atlasIndex,
        atlasIndexPath: context.atlasIndexPath,
        searchEntryCount: context.searchEntries.length
    };
}

if (require.main === module) {
    const result = generateAtlasIndex();
    const repoRoot = path.resolve(__dirname, '..');
    console.log(`Wrote ${path.relative(repoRoot, result.atlasIndexPath)} with ${result.searchEntryCount} search entries.`);
}

module.exports = {
    generateAtlasIndex
};
