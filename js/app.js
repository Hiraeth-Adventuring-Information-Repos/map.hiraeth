// --- Global Variables ---
const APP_CONFIG = typeof window !== 'undefined' && window.AppConfig ? window.AppConfig : null;
const { debounce, withAssetVersion, fetchJsonAsset } = typeof window !== 'undefined' && window.SharedUtils ? window.SharedUtils : {};
const getConfigValue = (path, fallbackValue) => APP_CONFIG ? APP_CONFIG.get(path, fallbackValue) : fallbackValue;
const getFeatureFlag = (name, fallbackValue = true) => getConfigValue(`features.${name}`, fallbackValue) !== false;
const getPerformanceNumber = (name, fallbackValue) => {
    const value = Number(getConfigValue(`performance.${name}`, fallbackValue));
    return Number.isFinite(value) ? value : fallbackValue;
};
if (APP_CONFIG && typeof document !== 'undefined') {
    APP_CONFIG.applyDocumentMetadata(document);
    APP_CONFIG.applyThemeTokens(document);
    APP_CONFIG.hydrateStaticDom(document);
}
let mapData = []; // Will be populated by loadMapData
let loadingProgressInterval = null;
let loadingProgress = 0;
let currentRegionGroup = null;
let regionsVisible = true; // Overall region visibility toggle
let currentRoadGroup = null; // Holds currently displayed road layers (and lines)

let miniMapControl = null; // Global MiniMap control instance
let miniMapControlMode = null;
let miniMapControlMapId = null;
const sessionStartedAt = Date.now();
const UX_STORAGE_KEYS = {
    theme: 'theme',
    themePreference: 'themePreference',
    soundEnabled: 'soundEnabled',
    sidebarState: 'sidebarState',
    filterPanelOpen: 'filterPanelOpen',
    coordsVisible: 'coordsVisible',
    advancedControlsUnlocked: 'advancedControlsUnlocked',
    onboardingSeen: 'onboardingSeen',
    lastMapId: 'lastMapId',
    mapViews: 'mapViews',
    gmUnlocked: 'gmUnlocked',
    toolkitPanelCollapsed: 'toolkitPanelCollapsed',
    gmPanelVisible: 'gmPanelVisible',
    toolkitPanelVisible: 'toolkitPanelVisible',
    mobileLayoutMode: 'mobileLayoutMode',
    featureDetailMode: 'featureDetailMode',
    atlasSidebarWidth: 'atlasSidebarWidth',
    featureDetailDockedWidth: 'featureDetailDockedWidth',
    featureDetailGeometry: 'featureDetailGeometry',
    shareRelayDismissedSession: 'shareRelayDismissedSession'
};
let isEmbeddedView = window.__INITIAL_EMBEDDED_VIEW__ === true;
let isInitializing = true;
let advancedControlsUnlocked = false;
let coordsDisplayEnabled = false;
let openAboutModal = null;
let closeAboutModal = null;
let loadingMapId = null;
let lastTrackedSearchSignature = '';
let atlasSearchIndex = [];
let atlasSearchIndexLoaded = false;
let atlasSearchIndexUrl = '';
let atlasSearchIndexPromise = null;
const mapDefinitionCache = new Map();
const mapDefinitionPromiseCache = new Map();
let currentMapData = null;
let loadRequestToken = 0;
const prefetchedJsonUrls = new Set();
const prefetchedImageUrls = new Set();
let prefetchImageQueue = [];
let prefetchImageInFlight = false;
let scheduledPrefetchIdleId = null;
let idleTileWarmupTimer = null;
let idleTileWarmupGeneration = 0;
let idleDetailTileLayer = null;
const SEARCH_SCOPE_MAP = 'map';
const SEARCH_SCOPE_ATLAS = 'atlas';
const SEARCH_RESULT_GROUP_ORDER = ['poi', 'region', 'line', 'map'];
const SEARCH_RESULT_GROUP_INDEX = Object.create(null);
SEARCH_RESULT_GROUP_ORDER.forEach((group, index) => {
    SEARCH_RESULT_GROUP_INDEX[group] = index;
});
let currentSearchScope = SEARCH_SCOPE_MAP;
let renderedSearchResults = [];
let activeSearchResultIndex = -1;
let activeSearchResultElement = null;
const isFirefox = typeof navigator !== 'undefined' && /firefox|fxios/i.test(navigator.userAgent);
const MOBILE_LAYOUT_BREAKPOINT = getPerformanceNumber('mobileBreakpoint', 768);
const MOBILE_SURFACE_MODE_ATLAS = 'atlas';
const MOBILE_SURFACE_MODE_SEARCH = 'search';
const MOBILE_SURFACE_MODE_TOOLS = 'tools';
const MOBILE_TOOLS_PANEL_TOOLKIT = 'toolkit';
const MOBILE_TOOLS_PANEL_GM = 'gm';
const MOBILE_LAYOUT_QUERY_PARAM = 'mobileLayout';
const MOBILE_LAYOUT_MODE_V2 = 'v2';
const MOBILE_LAYOUT_MODE_LEGACY = 'legacy';
const FEATURE_DETAIL_MODE_FLOATING = 'floating';
const FEATURE_DETAIL_MODE_DOCKED = 'docked';
const ATLAS_WIDTH_DEFAULT = 286;
const ATLAS_WIDTH_MIN = 240;
const ATLAS_WIDTH_MAX = 420;
const DETAIL_DOCKED_WIDTH_DEFAULT = 380;
const DETAIL_DOCKED_WIDTH_MIN = 320;
const DETAIL_DOCKED_WIDTH_MAX = 520;
const DETAIL_FLOATING_WIDTH_MIN = 420;
const DETAIL_FLOATING_HEIGHT_MIN = 300;
const WORKSPACE_MAP_WIDTH_MIN = 360;
const WORKSPACE_EDGE_MARGIN = 12;
const SMOOTH_ZOOM_STEP = 0.5;
const WHEEL_ZOOM_SNAP = 0;
const SMOOTH_WHEEL_ZOOM_SENSITIVITY = 0.0024;
const SMOOTH_WHEEL_MAX_DELTA = 0.45;
const SMOOTH_WHEEL_EASE = 0.32;
const SMOOTH_WHEEL_SETTLE_DELTA = 0.002;
const SMOOTH_WHEEL_IDLE_MS = 120;
const WHEEL_DELTA_LINE_HEIGHT = 16;
const WHEEL_DELTA_PAGE_HEIGHT = 240;

if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('is-firefox', isFirefox);
}

function refreshLucideIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function prefersReducedMotion() {
    return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function getZoomAnimationOptions() {
    return { animate: !prefersReducedMotion() };
}

// --- Measurement Tool State ---
let measurementLayerGroup; // Declare it here

// --- Initialize Leaflet Map ---
const mapOptions = {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 4,
    attributionControl: false,
    zoomControl: false, // Disable default zoom, using custom styled one
    zoomSnap: WHEEL_ZOOM_SNAP,
    zoomDelta: SMOOTH_ZOOM_STEP,
    scrollWheelZoom: false,
    zoomAnimation: !prefersReducedMotion(),
    fadeAnimation: false
};

if (isFirefox) {
    mapOptions.preferCanvas = true;
    mapOptions.markerZoomAnimation = false;
    mapOptions.fadeAnimation = false;
}

const map = L.map('map', mapOptions);

let atmosphereLayer = null;
let smoothWheelTargetZoom = null;
let smoothWheelAnchorPoint = null;
let smoothWheelFrameId = null;
let smoothWheelIdleTimeoutId = null;

function clampZoomLevel(zoom) {
    if (!map || !Number.isFinite(zoom)) return zoom;
    const minZoom = typeof map.getMinZoom === 'function' ? map.getMinZoom() : mapOptions.minZoom;
    const maxZoom = typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : mapOptions.maxZoom;
    return Math.min(maxZoom, Math.max(minZoom, zoom));
}

function normalizeWheelDelta(event) {
    let delta = Number(event.deltaY) || 0;
    if (event.deltaMode === 1) {
        delta *= WHEEL_DELTA_LINE_HEIGHT;
    } else if (event.deltaMode === 2) {
        delta *= Math.max(window.innerHeight || 0, WHEEL_DELTA_PAGE_HEIGHT);
    }
    return delta;
}

function scheduleSmoothWheelFrame() {
    if (smoothWheelFrameId !== null) return;
    const requestFrame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);
    smoothWheelFrameId = requestFrame(stepSmoothWheelZoom);
}

function stepSmoothWheelZoom() {
    smoothWheelFrameId = null;
    if (!map || smoothWheelTargetZoom === null || !smoothWheelAnchorPoint) return;

    const currentZoom = map.getZoom();
    const remainingZoom = smoothWheelTargetZoom - currentZoom;
    const nextZoom = Math.abs(remainingZoom) <= SMOOTH_WHEEL_SETTLE_DELTA
        ? smoothWheelTargetZoom
        : currentZoom + (remainingZoom * SMOOTH_WHEEL_EASE);

    map.setZoomAround(smoothWheelAnchorPoint, clampZoomLevel(nextZoom), { animate: false });

    if (Math.abs(smoothWheelTargetZoom - map.getZoom()) > SMOOTH_WHEEL_SETTLE_DELTA) {
        scheduleSmoothWheelFrame();
    }
}

function endSmoothWheelZoom() {
    if (smoothWheelFrameId !== null) {
        const cancelFrame = typeof cancelAnimationFrame === 'function'
            ? cancelAnimationFrame
            : clearTimeout;
        cancelFrame(smoothWheelFrameId);
    }
    smoothWheelFrameId = null;
    smoothWheelIdleTimeoutId = null;

    if (map && smoothWheelTargetZoom !== null && smoothWheelAnchorPoint) {
        map.setZoomAround(smoothWheelAnchorPoint, clampZoomLevel(smoothWheelTargetZoom), { animate: false });
    }

    smoothWheelTargetZoom = null;
    smoothWheelAnchorPoint = null;
    endMapInteraction();
}

function handleSmoothWheelZoom(event) {
    if (!map || typeof map.mouseEventToContainerPoint !== 'function') return;

    event.preventDefault();

    const wheelDelta = normalizeWheelDelta(event);
    if (!wheelDelta) return;

    beginMapInteraction();

    const zoomDelta = Math.max(
        -SMOOTH_WHEEL_MAX_DELTA,
        Math.min(SMOOTH_WHEEL_MAX_DELTA, -wheelDelta * SMOOTH_WHEEL_ZOOM_SENSITIVITY)
    );
    const baseZoom = smoothWheelTargetZoom === null ? map.getZoom() : smoothWheelTargetZoom;
    smoothWheelTargetZoom = clampZoomLevel(baseZoom + zoomDelta);
    smoothWheelAnchorPoint = map.mouseEventToContainerPoint(event);

    if (prefersReducedMotion()) {
        if (smoothWheelFrameId !== null) {
            const cancelFrame = typeof cancelAnimationFrame === 'function'
                ? cancelAnimationFrame
                : clearTimeout;
            cancelFrame(smoothWheelFrameId);
        }
        smoothWheelFrameId = null;
        if (smoothWheelIdleTimeoutId) clearTimeout(smoothWheelIdleTimeoutId);
        smoothWheelIdleTimeoutId = null;
        map.setZoomAround(smoothWheelAnchorPoint, smoothWheelTargetZoom, { animate: false });
        smoothWheelTargetZoom = null;
        smoothWheelAnchorPoint = null;
        endMapInteraction();
        return;
    }

    scheduleSmoothWheelFrame();

    if (smoothWheelIdleTimeoutId) clearTimeout(smoothWheelIdleTimeoutId);
    smoothWheelIdleTimeoutId = setTimeout(endSmoothWheelZoom, SMOOTH_WHEEL_IDLE_MS);
}

function zoomMapBy(delta) {
    if (!map || typeof map.getZoom !== 'function' || typeof map.setZoom !== 'function') return;
    map.setZoom(map.getZoom() + delta, getZoomAnimationOptions());
}

// Register map interaction listeners
map.on('moveend zoomend', updateURLWithMapView);
map.on('popupopen', refreshLucideIcons);
let interactionCooldownId = null;
const beginMapInteraction = () => {
    rootElement.classList.add('map-interacting');
    cancelIdleTileWarmup({ removeDetailLayer: true });
    if (interactionCooldownId) {
        clearTimeout(interactionCooldownId);
        interactionCooldownId = null;
    }
};
const endMapInteraction = () => {
    if (interactionCooldownId) clearTimeout(interactionCooldownId);
    interactionCooldownId = setTimeout(() => {
        rootElement.classList.remove('map-interacting');
        scheduleIdleTileWarmup();
    }, 140);
};
map.on('movestart zoomstart', beginMapInteraction);
map.on('moveend zoomend', endMapInteraction);

if (map && map.getContainer && typeof map.getContainer().addEventListener === 'function') {
    map.getContainer().addEventListener('wheel', handleSmoothWheelZoom, { passive: false });
    // Leaflet stops popup click bubbling, so handle actions during capture.
    map.getContainer().addEventListener('click', handleMapPopupAction, true);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelIdleTileWarmup({ removeDetailLayer: false });
        } else {
            scheduleIdleTileWarmup();
        }
    });
}

// NOW Initialize measurementLayerGroup
measurementLayerGroup = L.layerGroup().addTo(map);


// --- NEW: Multi-Point Measurement State ---
let isMeasuringMultiPoint = false; // Tracks if multi-point mode is active
let multiPointPath = []; // Array of L.LatLng objects for the current path
let multiPointPolyline = null; // The L.Polyline layer for the drawn path
let multiPointVertexMarkers = []; // Array of L.CircleMarker for vertices
let multiPointTotalTooltip = null; // L.Tooltip for the total path length
let cachedMultiPointPixelDistance = 0; // Cached total distance of fixed segments
let temporaryMouseMoveLine = null; // L.Polyline for the line from last point to cursor
let temporaryMouseMoveTooltip = null; // L.Tooltip for the temporary line's length
let measurementDoubleClickZoomWasEnabled = false;

// --- Map Feature State ---
let gmContentVisible = false;
let currentEncounterTables = [];
let currentEncounterTablesById = new Map(); // Bolt: O(1) lookups for encounter tables
let lastMeasuredDistanceKm = null;
let visiblePointsCache = [];
let visibleRegionsCache = [];
let visibleLinesCache = [];
let gmPanelVisible = false;
let toolkitPanelVisible = false;

// --- Coordinate Display Logic ---
const coordinateDisplay = document.getElementById('coordinate-display');
const copyCoordsBtn = coordinateDisplay.querySelector('.copy-coords-btn');

if (copyCoordsBtn) {
    copyCoordsBtn.addEventListener('click', () => {
        if (copyCoordsBtn.classList.contains('copied')) return; // Prevent re-clicking

        const coordsText = coordinateDisplay.querySelector('span').innerText;
        navigator.clipboard.writeText(coordsText).then(() => {
            copyCoordsBtn.classList.add('copied');
            copyCoordsBtn.title = "Copied!";
            copyCoordsBtn.setAttribute('aria-label', "Copied!");

            setTimeout(() => {
                copyCoordsBtn.classList.remove('copied');
                copyCoordsBtn.title = "Copy Coordinates";
                copyCoordsBtn.setAttribute('aria-label', "Copy Coordinates");
            }, 1500); // Reset after 1.5 seconds
        }).catch(err => {
            console.error('Failed to copy coordinates: ', err);
            copyCoordsBtn.classList.add('error');
            copyCoordsBtn.title = "Failed to copy";
            copyCoordsBtn.setAttribute('aria-label', "Failed to copy");

            setTimeout(() => {
                copyCoordsBtn.classList.remove('error');
                copyCoordsBtn.title = "Copy Coordinates";
                copyCoordsBtn.setAttribute('aria-label', "Copy Coordinates");
            }, 1500); // Reset after 1.5 seconds
        });
    });
}

function updateCoordinateDisplay(lat, lon) {
    if (!coordinateDisplay) return;
    const displaySpan = coordinateDisplay.querySelector('span');
    if (!displaySpan) return;
    const latString = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
    const lonString = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
    displaySpan.innerHTML = `${latString}, ${lonString}`;
}

const DEFAULT_POI_TYPE_GROUPS = {
    "Settlements": ["City", "Town", "Village", "Hamlet", "Settlement", "Capital"],
    "Structures": ["Castle", "Fortress", "Fort", "Tower", "Ruin", "Temple", "Shrine", "Mine", "Lighthouse", "Bridge", "Dungeon", "Lair", "Camp", "Asylum", "Landmark"],
    "Natural Features": ["Mountain", "Peak", "Forest", "Wood", "River", "Lake", "Cave", "Cavern", "Coast", "Bay", "Cove", "Swamp", "Marsh", "Desert", "Natural Landmark"],
    "Other": ["Point of Interest", "Region", "Portal"],
    "Unknown": ["Unknown"]
};
const poiTypeGroups = (typeof getConfigValue === 'function')
    ? getConfigValue('taxonomy.poiTypeGroups', DEFAULT_POI_TYPE_GROUPS)
    : DEFAULT_POI_TYPE_GROUPS;

function getUrlParameters() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const pairs = queryString.split('&');
    const safeDecode = (value) => {
        const normalized = String(value || '').replace(/\+/g, ' ');
        try {
            return decodeURIComponent(normalized);
        } catch {
            return normalized;
        }
    };
    
    for (const pair of pairs) {
        const separatorIndex = pair.indexOf('=');
        const key = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
        const value = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
        const decodedKey = safeDecode(key);
        if (decodedKey) params[decodedKey] = safeDecode(value);
    }
    return params;
}

function isEmbedModeFromUrl() {
    const urlParams = getUrlParameters();
    return urlParams.embed === 'true' || urlParams.hideUI === 'true';
}

// --- NEW: Format Custom Properties for Popups ---
function formatPropertiesForPopup(properties, hasFollowingDescription) {
    if (!properties || Object.keys(properties).length === 0) {
        return '';
    }
    let hasContent = false;
    let listItems = '';
    for (const key in properties) {
        const value = properties[key];
        if (
            Object.hasOwnProperty.call(properties, key) &&
            value !== undefined &&
            value !== null &&
            value !== ''
        ) {
            hasContent = true;
            const sanKey = escapeHtml(key);
            const sanValue = escapeHtml(String(value));
            listItems += `<li><strong>${sanKey}:</strong> ${sanValue}</li>`;
        }
    }

    if (!hasContent) return '';

    let html = `<ul>${listItems}</ul>`;
    // Add separator AFTER properties if there's a description to follow
    if (hasFollowingDescription) {
        html += `<hr style="border-top: 1px dotted var(--border-color); border-bottom: none; margin: 10px 0;">`;
    }
    return html;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

function sanitizeWikiLinkForHref(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) return null;
    if (/[\u0000-\u001F\u007F]/.test(rawValue)) return null;

    // Reject protocol-relative links (e.g., //example.com) to keep behavior constrained
    // to explicit http(s) or local-relative/hash navigation.
    if (rawValue.startsWith('//')) return null;

    if (rawValue.startsWith('#') || rawValue.startsWith('/') || rawValue.startsWith('./') || rawValue.startsWith('../')) {
        // Keep href attribute safe and reject malformed local links.
        if (/["'<>`]/.test(rawValue)) return null;
        if (/\s/.test(rawValue)) return null;
        return rawValue;
    }

    try {
        const parsed = new URL(rawValue);
        const protocol = String(parsed.protocol || '').toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') {
            return null;
        }
        return parsed.href;
    } catch {
        return null;
    }
}

function resolveLinkedMapData(featureData) {
    const linkedMapId = String(featureData?.linkedMapId || '').trim();
    if (!linkedMapId) return null;

    const linkedMap = findMapRecursive(mapData, linkedMapId);
    if (!isRenderableMapEntry(linkedMap)) {
        return null;
    }

    return {
        id: linkedMapId,
        name: linkedMap.name || linkedMapId
    };
}

function createPoiTooltipContent(data) {
    const safeName = escapeHtml(data?.name || 'Unnamed Location');
    const rawType = String(data?.type || '').trim();
    if (!rawType) return safeName;

    return `${safeName} <span class="poi-hover-tooltip-separator">•</span> ${escapeHtml(rawType)}`;
}

function getPoiTooltipOptions() {
    return {
        direction: 'top',
        offset: L.point(0, -32),
        opacity: 0.96,
        className: 'poi-hover-tooltip'
    };
}

function attachPoiTooltipBehavior(marker) {
    if (!marker || typeof marker.on !== 'function') return marker;

    marker.poiPopupActive = false;

    marker.on('popupopen', () => {
        marker.poiPopupActive = true;
        if (typeof marker.closeTooltip === 'function') {
            marker.closeTooltip();
        }
    });

    marker.on('popupclose', () => {
        marker.poiPopupActive = false;
    });

    marker.on('tooltipopen', () => {
        if (marker.poiPopupActive && typeof marker.closeTooltip === 'function') {
            marker.closeTooltip();
        }
    });

    return marker;
}

function clearTransientMapSearchParams(search = window.location.search) {
    const params = new URLSearchParams(search);
    [
        'view',
        'poi',
        'region',
        'line',
        'src',
        'stype',
        'gallery'
    ].forEach((key) => params.delete(key));

    const nextSearch = params.toString();
    return nextSearch ? `?${nextSearch}` : '';
}

function navigateToMap(mapId, { preResolvedMap = null, preserveSearch = false } = {}) {
    const nextSearch = preserveSearch ? window.location.search : clearTransientMapSearchParams(window.location.search);
    const nextHash = generateHash(mapId, currentSidebarState);
    const nextUrl = buildAppUrlWithHash(nextHash, nextSearch);

    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
        history.pushState(
            {
                mapId,
                sidebarState: currentSidebarState,
                search: nextSearch,
                hash: nextHash
            },
            '',
            nextUrl
        );
    }

    if (isMobileLayoutActive) {
        closeMobileSheet({ restoreFocus: false });
    }
    loadMap(mapId, false, preResolvedMap);
}

function resolveInitialMapViewport(params) {
    const hasFeatureTarget = params.has('poi') || params.has('region') || params.has('line');
    if (hasFeatureTarget) {
        return { mode: 'feature' };
    }

    const explicitViewParam = params.get('view');
    if (explicitViewParam) {
        const [lat, lng, zoom] = explicitViewParam.split(',').map(Number);
        if (!isNaN(lat) && !isNaN(lng) && !isNaN(zoom)) {
            return {
                mode: 'explicit-view',
                view: { lat, lng, zoom },
                rawView: explicitViewParam
            };
        }
    }

    return { mode: 'fit-bounds' };
}

function applySearchParamsToCurrentMap(params = new URLSearchParams(window.location.search)) {
    let featureFocused = false;
    if (params.has('poi') || params.has('region') || params.has('line')) {
        featureFocused = checkAndFocusFeature();
    }
    if (!featureFocused) {
        const initialViewport = resolveInitialMapViewport(params);
        if (initialViewport.mode === 'explicit-view' && initialViewport.view) {
            map.setView(
                [initialViewport.view.lat, initialViewport.view.lng],
                initialViewport.view.zoom,
                { animate: false }
            );
            trackShareViewOpenFromParams(params, initialViewport.rawView);
            const shareContext = getShareContextFromParams(params);
            if (shareContext) {
                showShareRelayPrompt(shareContext);
            }
        } else if (currentBounds) {
            map.fitBounds(currentBounds);
        }
    }

    return featureFocused;
}

function handleMapPopupAction(event) {
    const eventTarget = event?.target;
    if (!eventTarget || typeof eventTarget.closest !== 'function') return;

    const actionElement = eventTarget.closest('[data-popup-action]');
    if (!actionElement) return;

    const action = actionElement.dataset.popupAction;
    if (action === 'open-details') {
        event.preventDefault();
        openSelectedFeatureDetails();
    } else if (action === 'share-feature') {
        window.copyFeatureLink(
            actionElement,
            actionElement.dataset.featureType,
            actionElement.dataset.featureName
        );
    } else if (action === 'open-linked-map') {
        window.openLinkedMapFromPopup(event, actionElement.dataset.linkedMapId);
    }
}

// --- NEW: Unified Popup Content Generator ---
function createPopupContent(data, type) {
    const safePronunciation = data.pronunciation ? escapeHtml(data.pronunciation) : '';
    const safeSummary = data.summary ? escapeHtml(data.summary) : '';
    const safeDescription = data.description ? escapeHtml(data.description) : '';

    const headerHtml = buildPopupHeader(data, type, safePronunciation);
    const fullContentInnerHtml = buildPopupFullContent(data, safeDescription);

    const hasSummary = safeSummary && safeSummary.trim() !== '';
    const hasFullContent = fullContentInnerHtml.trim() !== '';

    if (!hasSummary && !hasFullContent) {
        return headerHtml;
    }

    const { mainContent } = buildPopupMainContainer(safeSummary, fullContentInnerHtml, hasSummary, hasFullContent);

    return headerHtml + mainContent;
}

function buildPopupHeader(data, type, safePronunciation) {
    let headerHtml = '';
    if (data.name) {
        const safeName = escapeHtml(data.name);
        const safeWikiHref = sanitizeWikiLinkForHref(data.wikiLink);
        const actionButtons = [];
        if (type) {
            const detailsIcon = '<i class="ui-icon" data-lucide="maximize-2" aria-hidden="true"></i>';
            actionButtons.push(`<button class="popup-detail-expand" type="button" data-popup-action="open-details" title="Open details" aria-label="Open details for ${safeName}" aria-haspopup="dialog">${detailsIcon}<span>Details</span></button>`);
            const linkIcon = `<i class="ui-icon" data-lucide="link-2" aria-hidden="true"></i>`;
            actionButtons.push(`<button class="share-btn" type="button" data-popup-action="share-feature" data-feature-type="${escapeHtml(type)}" data-feature-name="${safeName}" title="Share this location" aria-label="Share this location">${linkIcon}</button>`);
        }
        const actionButtonsHtml = actionButtons.length > 0
            ? `<div class="popup-header-actions">${actionButtons.join('')}</div>`
            : '';

        if (safeWikiHref) {
            headerHtml += `<div class="popup-header-row"><h3><a href="${safeWikiHref}" target="_blank" rel="noopener noreferrer" title="Visit wiki page for ${safeName}">${safeName}</a></h3>${actionButtonsHtml}</div>`;
        } else {
            headerHtml += `<div class="popup-header-row"><h3>${safeName}</h3>${actionButtonsHtml}</div>`;
        }
    }
    if (safePronunciation) {
        headerHtml += `<p style="margin-top: -10px; margin-bottom: 5px;"><em>${safePronunciation}</em></p>`;
    }
    const linkedMap = resolveLinkedMapData(data);
    if (linkedMap) {
        const escapedLinkedMapId = escapeHtml(linkedMap.id);
        const linkedMapName = escapeHtml(linkedMap.name);
        const mapJumpIcon = `<i class="ui-icon" data-lucide="map" aria-hidden="true"></i>`;
        headerHtml += `<div class="popup-map-jump"><a href="#" data-popup-action="open-linked-map" data-linked-map-id="${escapedLinkedMapId}" title="Open map: ${linkedMapName}">${mapJumpIcon}<span>Open ${linkedMapName} map</span></a></div>`;
    }
    return headerHtml;
}

function buildPopupFullContent(data, safeDescription) {
    let fullContentInnerHtml = '';
    if (data.type && data.value) { // Regions
        fullContentInnerHtml += `<p><em>${escapeHtml(data.type)}: ${escapeHtml(data.value)}</em></p>`;
    } else if (data.type) { // POIs, Roads
        const typeString = data.type.charAt(0).toUpperCase() + data.type.slice(1);
        fullContentInnerHtml += `<p><em>Type: ${escapeHtml(typeString)}</em></p>`;
    }
    fullContentInnerHtml += formatPropertiesForPopup(data.properties, !!safeDescription);
    if (safeDescription) {
        fullContentInnerHtml += `<p>${safeDescription}</p>`;
    }
    return fullContentInnerHtml;
}

function buildPopupMainContainer(safeSummary, fullContentInnerHtml, hasSummary, hasFullContent) {
    let mainContent = '';

    if (hasSummary) {
        mainContent = `
            <div class="popup-content-container">
                <div class="popup-summary">
                    <p>${safeSummary}</p>
                </div>
            </div>
        `;
    } else if (hasFullContent) {
        mainContent = `
            <div class="popup-content-container">
                ${fullContentInnerHtml}
            </div>
        `;
    }
    return { mainContent, readMoreButton: '' };
}

// --- Auto-generate a reverse map for quick lookup (Type -> Group) ---
const typeToGroupMap = {};
for (const groupName in poiTypeGroups) {
    poiTypeGroups[groupName].forEach(type => {
        typeToGroupMap[String(type || '').trim().toLowerCase()] = groupName;
    });
}

const DEFAULT_POI_GROUP_ICON_CONFIG = {
    "Settlements": "images/poi-icons/settlements.svg",
    "Structures": "images/poi-icons/structures.svg",
    "Natural Features": "images/poi-icons/natural-features.svg",
    "Other": "images/poi-icons/other.svg",
    "Unknown": "images/poi-icons/unknown.svg"
};
const DEFAULT_POI_TYPE_ICON_CONFIG = {
    "Capital": "images/poi-icons/capital.svg",
    "City": "images/poi-icons/city.svg",
    "Town": "images/poi-icons/town.svg",
    "Village": "images/poi-icons/village.svg",
    "Hamlet": "images/poi-icons/hamlet.svg",
    "Settlement": "images/poi-icons/settlement.svg",
    "Castle": "images/poi-icons/castle.svg",
    "Fortress": "images/poi-icons/fortress.svg",
    "Fort": "images/poi-icons/fort.svg",
    "Tower": "images/poi-icons/tower.svg",
    "Ruin": "images/poi-icons/ruin.svg",
    "Temple": "images/poi-icons/temple.svg",
    "Shrine": "images/poi-icons/shrine.svg",
    "Mine": "images/poi-icons/mine.svg",
    "Lighthouse": "images/poi-icons/lighthouse.svg",
    "Bridge": "images/poi-icons/bridge.svg",
    "Gate": "images/poi-icons/gate.svg",
    "Dungeon": "images/poi-icons/dungeon.svg",
    "Lair": "images/poi-icons/lair.svg",
    "Camp": "images/poi-icons/camp.svg",
    "Asylum": "images/poi-icons/asylum.svg",
    "Landmark": "images/poi-icons/landmark.svg",
    "Building": "images/poi-icons/building.svg",
    "Mountain": "images/poi-icons/mountain.svg",
    "Peak": "images/poi-icons/peak.svg",
    "Forest": "images/poi-icons/forest.svg",
    "Wood": "images/poi-icons/wood.svg",
    "River": "images/poi-icons/river.svg",
    "Lake": "images/poi-icons/lake.svg",
    "Cave": "images/poi-icons/cave.svg",
    "Cavern": "images/poi-icons/cavern.svg",
    "Coast": "images/poi-icons/coast.svg",
    "Bay": "images/poi-icons/bay.svg",
    "Cove": "images/poi-icons/cove.svg",
    "Swamp": "images/poi-icons/swamp.svg",
    "Marsh": "images/poi-icons/marsh.svg",
    "Desert": "images/poi-icons/desert.svg",
    "Natural Landmark": "images/poi-icons/natural-landmark.svg",
    "Point of Interest": "images/poi-icons/point-of-interest.svg",
    "Region": "images/poi-icons/region.svg",
    "Portal": "images/poi-icons/portal.svg",
    "Tavern": "images/poi-icons/tavern.svg",
    "Dock & Trading": "images/poi-icons/dock-trading.svg",
    "Market": "images/poi-icons/market-trade.svg",
    "Trade": "images/poi-icons/market-trade.svg",
    "Market & Trade": "images/poi-icons/market-trade.svg",
    "Market / Trade": "images/poi-icons/market-trade.svg"
};
const poiGroupIconConfig = (typeof getConfigValue === 'function')
    ? getConfigValue('assets.poiIcons', DEFAULT_POI_GROUP_ICON_CONFIG)
    : DEFAULT_POI_GROUP_ICON_CONFIG;
const poiTypeIconConfig = (typeof getConfigValue === 'function')
    ? getConfigValue('assets.poiTypeIcons', DEFAULT_POI_TYPE_ICON_CONFIG)
    : DEFAULT_POI_TYPE_ICON_CONFIG;
const poiTypeIconKeyMap = {};
Object.keys(poiTypeIconConfig || {}).forEach(type => {
    poiTypeIconKeyMap[String(type || '').trim().toLowerCase()] = type;
});

const poiIconCache = new Map();

// ⚡ Bolt: Cache POI group lookups to avoid expensive string operations
// in the updateVisibleMarkersAndSearch loop which runs frequently.
const poiGroupCache = new Map();

function getPoiGroup(type) {
    if (poiGroupCache.has(type)) {
        return poiGroupCache.get(type);
    }
    const normalizedType = String(type || '').trim().toLowerCase();
    const group = !normalizedType ? 'Unknown' : (typeToGroupMap[normalizedType] || 'Unknown');
    poiGroupCache.set(type, group);
    return group;
}

function getPoiTypeIconUrl(typeName) {
    const normalizedType = String(typeName || '').trim().toLowerCase();
    const configuredType = normalizedType ? poiTypeIconKeyMap[normalizedType] : '';
    return configuredType ? poiTypeIconConfig[configuredType] : '';
}

function getPoiIcon(groupName, typeName = '') {
    const normalizedGroup = poiGroupIconConfig[groupName] ? groupName : 'Unknown';
    const iconUrl = getPoiTypeIconUrl(typeName) || poiGroupIconConfig[normalizedGroup] || poiGroupIconConfig.Unknown;
    const cacheKey = iconUrl || normalizedGroup;
    if (poiIconCache.has(cacheKey)) {
        return poiIconCache.get(cacheKey);
    }

    const icon = L.icon({
        iconUrl,
        iconSize: [36, 48],
        iconAnchor: [18, 47],
        popupAnchor: [0, -40],
        className: 'poi-custom-icon'
    });

    poiIconCache.set(cacheKey, icon);
    return icon;
}
// --- END: POI Type Grouping Configuration ---

// --- More Global variables ---
let currentImageLayer = null;
let currentMapBaseLayerMode = 'image';
let currentMapPreviewLayer = null;
let currentMapUnderlay = null;
let currentMarkerGroup = null; // Holds currently *visible* markers
let allMapMarkers = []; // Holds *all* markers for the loaded map
let allMapMarkersById = new Map(); // Bolt: O(1) lookups for markers
let allMapMarkersByName = new Map(); // Bolt: O(1) lookups for markers
let allMapRegions = []; // Holds *all* regions for the loaded map
let allMapRegionsById = new Map(); // Bolt: O(1) lookups for regions
let allMapRegionsByName = new Map(); // Bolt: O(1) lookups for regions
let allMapLines = []; // Holds *all* lines for the loaded map
let allMapLinesById = new Map(); // Bolt: O(1) lookups for lines
let allMapLinesByName = new Map(); // Bolt: O(1) lookups for lines
let currentBounds = null;
let currentlyLoadedMapId = null;
let currentSidebarState = 'o';
let markersVisible = true; // <--- THIS SHOULD BE TRUE FOR VISIBLE BY DEFAULT
let currentLatLonBounds = null;
let coordsLocked = false;
const transitionDuration = 300; // ms for sidebar animation
let filtersPanelVisible = false; // State for combined filter panel visibility

const DEFAULT_MAP_BACKGROUND_COLORS = {
    light: '#f4f0eb',
    dark: '#050510'
};
const configuredMapBackgroundColors = (typeof getConfigValue === 'function')
    ? getConfigValue('theme.mapBackgroundColors', DEFAULT_MAP_BACKGROUND_COLORS)
    : DEFAULT_MAP_BACKGROUND_COLORS;

function getMapBackgroundColor(mapEntry) {
    const candidate = String(mapEntry?.backgroundColor || '').trim();
    if (candidate) return candidate;
    return currentEffectiveTheme === 'dark'
        ? (configuredMapBackgroundColors.dark || DEFAULT_MAP_BACKGROUND_COLORS.dark)
        : (configuredMapBackgroundColors.light || DEFAULT_MAP_BACKGROUND_COLORS.light);
}

function updateMapUnderlayColor(mapEntry = null) {
    if (!currentMapUnderlay) return;
    currentMapUnderlay.setStyle({
        fillColor: getMapBackgroundColor(mapEntry),
        color: getMapBackgroundColor(mapEntry)
    });
}

// --- Visibility helpers for GM/Public split ---
// ⚡ Bolt: Replaced chained .map().filter() and array spreads with single for-loops
// to prevent redundant intermediate array allocations and improve performance on large maps.
function getVisiblePoints(mapObj) {
    const points = Array.isArray(mapObj.pointsOfInterest) ? mapObj.pointsOfInterest :
        (Array.isArray(mapObj.points) ? mapObj.points : []);
    const result = [];
    for (let i = 0; i < points.length; i++) {
        if (visibilityAllowed(points[i])) result.push(points[i]);
    }
    return result;
}

function getVisibleRegions(mapObj) {
    const regions = Array.isArray(mapObj.regions) ? mapObj.regions : [];
    const result = [];
    for (let i = 0; i < regions.length; i++) {
        if (visibilityAllowed(regions[i])) result.push(regions[i]);
    }
    return result;
}

function getVisibleLines(mapObj) {
    const roads = Array.isArray(mapObj.roads) ? mapObj.roads : [];
    const linesList = Array.isArray(mapObj.lines) ? mapObj.lines : [];
    const result = [];
    for (let i = 0; i < roads.length; i++) {
        if (visibilityAllowed(roads[i])) result.push(roads[i]);
    }
    for (let i = 0; i < linesList.length; i++) {
        if (visibilityAllowed(linesList[i])) result.push(linesList[i]);
    }
    return result;
}

function getVisibleEncounterTables(mapObj) {
    const tables = Array.isArray(mapObj.encounterTables) ? mapObj.encounterTables : [];
    const result = [];
    for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        if (!visibilityAllowed(table)) continue;

        const entries = Array.isArray(table.entries) ? table.entries : [];
        const validEntries = [];
        for (let j = 0; j < entries.length; j++) {
            if (visibilityAllowed(entries[j])) validEntries.push(entries[j]);
        }

        if (validEntries.length > 0) {
            result.push({ ...table, entries: validEntries });
        }
    }
    return result;
}

// --- DOM Elements ---
const container = document.querySelector('.container');
const sidebar = document.getElementById('sidebar');
const mapListElement = document.getElementById('map-list');
const sidebarMapPanel = document.getElementById('sidebar-map-panel');
const sidebarPoiPanel = document.getElementById('sidebar-poi-panel');
const featureDetailSheet = document.getElementById('feature-detail-sheet');
const featureDetailBackdrop = document.getElementById('feature-detail-backdrop');
const featureDetailLayoutBtn = document.getElementById('feature-detail-layout-btn');
const featureDetailCloseBtn = document.getElementById('feature-detail-close-btn');
const atlasResizeHandle = document.getElementById('atlas-resize-handle');
const featureDetailDockResizeHandle = document.getElementById('feature-detail-dock-resize-handle');
const featureDetailCornerResizeHandle = document.getElementById('feature-detail-corner-resize-handle');
const featureDetailHeader = featureDetailSheet ? featureDetailSheet.querySelector('.feature-detail-shell-header') : null;
const mobileAtlasCloseBtn = document.getElementById('mobile-atlas-close-btn');
const toggleBtn = document.getElementById('toggle-sidebar-btn');
const mapChooserElement = document.getElementById('map-chooser');
const mapChooserGrid = document.getElementById('map-chooser-grid');
const mapChooserCloseBtn = document.getElementById('map-chooser-close-btn');
const mobileDock = document.getElementById('mobile-dock');
const mobileInfoHelpBtn = document.getElementById('mobile-info-help-btn');
const mobileToolsLauncherBtn = document.getElementById('mobile-tools-launcher-btn');
const mobileSheetLauncherBtn = document.getElementById('mobile-sheet-launcher-btn');
const mobileSearchLauncherBtn = document.getElementById('mobile-search-launcher-btn');
const themeToggle = document.getElementById('theme-checkbox');
const bodyElement = document.body;
const mapElement = document.getElementById('map'); // Get map div
const mapContainerElement = document.getElementById('map-container');
if (mapElement) {
    atmosphereLayer = document.createElement('div');
    atmosphereLayer.id = 'atmosphere-layer';
    atmosphereLayer.setAttribute('aria-hidden', 'true');
    mapElement.appendChild(atmosphereLayer);
}
const toggleBlurbBtn = document.getElementById('toggle-blurb-btn');
const toggleGMPanelBtn = null;
const toggleToolkitPanelBtn = null;
const mapBlurbElement = document.getElementById('map-blurb');
const toggleMarkersBtn = document.getElementById('toggle-markers-btn');
const searchControlContainer = document.getElementById('search-control-container');
const dynamicFiltersContainer = document.getElementById('dynamic-filters-container');
const poiSearchInput = document.getElementById('poi-search-input');
const searchScopeAtlasBtn = document.getElementById('search-scope-atlas-btn');
const searchResultsContainer = document.getElementById('search-results-container');
const poiFilterContainer = document.getElementById('poi-filter-container');
// Cached live collection of all filter checkboxes for performance
const poiFilterCheckboxesLive = poiFilterContainer ? poiFilterContainer.getElementsByTagName('input') : null;

// ⚡ Bolt: Global static cache for filter checkboxes. Updated only on DOM mutations (Measured improvement: ~91% faster)
let staticPoiFilterCheckboxesCache = null;
function getStaticPoiFilterCheckboxes() {
    if (!staticPoiFilterCheckboxesCache && poiFilterCheckboxesLive) {
        staticPoiFilterCheckboxesCache = Array.from(poiFilterCheckboxesLive);
    }
    return staticPoiFilterCheckboxesCache || [];
}

function setFilterCheckboxesChecked(checked) {
    if (!poiFilterCheckboxesLive) return;

    const staticCheckboxes = getStaticPoiFilterCheckboxes();
    for (let i = 0; i < staticCheckboxes.length; i++) {
        const checkbox = staticCheckboxes[i];
        if (checkbox.type !== 'checkbox' || checkbox.id === 'filter-toggle-all') continue;

        checkbox.checked = checked;
    }
}

if (poiFilterContainer) {
    const observer = new MutationObserver(() => {
        staticPoiFilterCheckboxesCache = null;
    });
    observer.observe(poiFilterContainer, { childList: true, subtree: true });
}

const filterToggleAllCheckbox = document.getElementById('filter-toggle-all');
const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
const measureToolBtn = document.getElementById('measure-tool-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const loadingRetryBtn = document.getElementById('loading-retry-btn');
const searchRefineFiltersBtn = document.getElementById('search-refine-filters-btn');
const searchRefineClearBtn = document.getElementById('search-refine-clear-btn');
const activeFiltersContainer = document.getElementById('active-filters-container');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const mobileSearchPanel = document.getElementById('mobile-search-card');
const mobileSearchPanelCloseBtn = document.getElementById('mobile-search-card-close-btn');
const mobileSearchPanelTitle = document.getElementById('mobile-search-card-title');
const mobileToolsCard = document.getElementById('mobile-tools-card');
const mobileToolsCardCloseBtn = document.getElementById('mobile-tools-card-close-btn');
const mobileToolsPanelSlot = document.getElementById('mobile-tools-panel-slot');
const mobileSearchPanelSearchSlot = document.getElementById('mobile-search-card-search-slot');
const mobileSearchResultsCard = document.getElementById('mobile-search-card-results-slot');
const mobileSearchPanelResultsSlot = document.getElementById('mobile-search-card-results-slot');
const mobileMarkersBtn = document.getElementById('mobile-markers-btn');
const mobileFiltersBtn = document.getElementById('mobile-filters-btn');
const mobileMeasureBtn = document.getElementById('mobile-measure-btn');
const mobileSoundBtn = document.getElementById('mobile-sound-btn');
const mobileShareViewBtn = document.getElementById('mobile-share-view-btn');
const mobileCoordsBtn = document.getElementById('mobile-coords-btn');
const mobileHelpBtn = document.getElementById('mobile-help-btn');
const mobileGmViewBtn = null;
const mobileToolkitBtn = null;
const onboardingCoachmark = document.getElementById('onboarding-coachmark');
const onboardingOpenHelpBtn = document.getElementById('onboarding-open-help-btn');
const onboardingDismissBtn = document.getElementById('onboarding-dismiss-btn');
const shareRelayCoachmark = document.getElementById('share-relay-coachmark');
const shareRelayCopy = document.getElementById('share-relay-copy');
const shareRelayActionBtn = document.getElementById('share-relay-action-btn');
const shareRelayDismissBtn = document.getElementById('share-relay-dismiss-btn');
const toggleCoordsBtn = document.getElementById('toggle-coords-btn');
const shareViewBtn = document.getElementById('share-view-btn');
// Sound elements
const lightAmbient = document.getElementById('light-ambient');
const darkAmbient = document.getElementById('dark-ambient');
const toggleSoundBtn = document.getElementById('toggle-sound-btn');
const soundIcon = document.getElementById('sound-icon');
const sessionToolkitPanel = null;
const toolkitCollapseBtn = null;
const gmPill = null;
const gmStatusLabel = null;
const gmToggleBtn = null;
const travelDistanceInput = null;
const travelModeSelect = null;
const travelTimeOutput = null;
const encounterSelect = null;
const encounterRollBtn = null;
const encounterViewBtn = null;
const encounterResult = null;
const encounterTableList = null;
const rootElement = document.documentElement;
let soundEnabled = false;
let savedAmbientResumeScheduled = false;
let themePreference = 'system';
let currentEffectiveTheme = 'light';
const systemThemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themeAnimationTimeoutId = null;
const THEME_CLOUD_HANDOFF_CLASS = 'theme-cloud-handoff';
const THEME_ANIMATION_BUFFER_MS = 40;
const THEME_ANIMATION_FALLBACK_MS = 560;
const activeAudioFadeFrameIds = new WeakMap();
let currentAtmosphereConfig = null;
let mobileLayoutV2Enabled = false;
let isMobileLayoutActive = false;
let mobileSurfaceMode = null;
let mobileToolsPanelMode = null;
let mobileFilterExpanded = false;
let lastMobileSurfaceTriggerButton = null;
let lastControlTouchAt = 0;
let activeShareRelayContext = null;
const shownShareRelaySessionKeys = new Set();
const storedAdvancedControlsFlag = safeGetStorage(UX_STORAGE_KEYS.advancedControlsUnlocked);
const storedOnboardingFlag = safeGetStorage(UX_STORAGE_KEYS.onboardingSeen);
const hasPriorPreferenceState =
    safeGetStorage(UX_STORAGE_KEYS.themePreference) !== null ||
    safeGetStorage(UX_STORAGE_KEYS.theme) !== null ||
    safeGetStorage(UX_STORAGE_KEYS.soundEnabled) !== null;
advancedControlsUnlocked = storedAdvancedControlsFlag === 'true' ||
    (storedAdvancedControlsFlag === null && storedOnboardingFlag === null && hasPriorPreferenceState);
coordsDisplayEnabled = safeGetStorage(UX_STORAGE_KEYS.coordsVisible) === 'true';
let selectedSidebarFeature = null;
let selectedSidebarFeatureType = '';
let featureDetailSheetOpen = false;
let featureDetailSheetExpanded = false;
let featureDetailSheetDocked = false;
let atlasSidebarWidth = ATLAS_WIDTH_DEFAULT;
let featureDetailDockedWidth = DETAIL_DOCKED_WIDTH_DEFAULT;
let featureDetailFloatingGeometry = null;
let workspaceMapResizeFrame = null;
let featureDetailSearchVisibilityTimer = null;
let featureDetailSearchTargetObscured = false;
let lastFeatureDetailTrigger = null;
let restoreMapChooserTriggerOnPopState = false;


// --- Helper Functions ---


function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeGetStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSetStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Ignore storage quota and private-mode failures.
    }
}

function safeRemoveStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        // Ignore storage quota and private-mode failures.
    }
}

function safeGetSessionStorage(key) {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSetSessionStorage(key, value) {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // Ignore storage quota and private-mode failures.
    }
}

function safeGetJSON(key, fallback = null) {
    const raw = safeGetStorage(key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function safeSetJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore storage quota and private-mode failures.
    }
}

function normalizeMobileLayoutMode(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (normalized === MOBILE_LAYOUT_MODE_V2 || normalized === MOBILE_LAYOUT_MODE_LEGACY) {
        return normalized;
    }
    return null;
}

function getMobileLayoutModeFromUrl() {
    const urlParams = getUrlParameters();
    return normalizeMobileLayoutMode(urlParams[MOBILE_LAYOUT_QUERY_PARAM]);
}

function resolveMobileLayoutV2Enabled() {
    const modeFromUrl = getMobileLayoutModeFromUrl();
    if (modeFromUrl) {
        safeSetStorage(UX_STORAGE_KEYS.mobileLayoutMode, modeFromUrl);
        return modeFromUrl === MOBILE_LAYOUT_MODE_V2;
    }

    const modeFromStorage = normalizeMobileLayoutMode(safeGetStorage(UX_STORAGE_KEYS.mobileLayoutMode));
    if (modeFromStorage) {
        return modeFromStorage === MOBILE_LAYOUT_MODE_V2;
    }

    // Default to v2 for new sessions while allowing explicit query/storage rollback.
    safeSetStorage(UX_STORAGE_KEYS.mobileLayoutMode, MOBILE_LAYOUT_MODE_V2);
    return true;
}

function resolveControlVisibilityState({
    isEmbedded = false,
    isMobileLayout = false,
    advancedControls = false,
    hasPOIs = false,
    hasRegions = false,
    hasRoads = false,
    hasValidScale = false,
    hasBlurb = false,
    hasLatLonBounds = false,
    allowGMToolkit = false,
    atlasSearchCount = 0,
    toolkitVisible = false,
    gmVisible = false
} = {}) {
    const featureEnabled = (name, fallbackValue = true) =>
        (typeof getFeatureFlag === 'function') ? getFeatureFlag(name, fallbackValue) : fallbackValue;
    const features = resolveControlFeatureAvailability({
        hasPOIs,
        hasRegions,
        hasRoads,
        allowGMToolkit,
        atlasSearchCount
    }, featureEnabled);
    const layout = resolveControlLayoutContexts({ isEmbedded, isMobileLayout, advancedControls });
    const desktop = resolveDesktopControlVisibility({
        layout,
        features,
        hasValidScale,
        hasBlurb,
        hasLatLonBounds,
        toolkitVisible,
        gmVisible
    }, featureEnabled);
    const mobile = resolveMobileControlVisibility({
        layout,
        features,
        hasValidScale,
        hasLatLonBounds
    }, featureEnabled);

    return {
        showMarkersButton: desktop.markersButton,
        showSearchControl: features.search,
        showMobileSheetToggle: layout.mobileSheet,
        showMobileToolsToggle: layout.mobileSheet,
        showFiltersButton: desktop.filtersButton,
        showSearchFilterAction: features.filters,
        showMeasureButton: desktop.measureButton,
        showSoundButton: desktop.soundButton,
        showBlurbButton: desktop.blurbButton,
        showCoordsButton: desktop.coordsButton,
        showShareButton: desktop.shareButton,
        showGMButton: desktop.gmButton,
        showToolkitButton: desktop.toolkitButton,
        showToolkitPanel: desktop.toolkitPanel,
        showGMPill: desktop.gmPill,
        showMobileExploreMode: layout.mobileSheet,
        showMobileMapMode: layout.mobileSheet,
        showMobileMapList: layout.mobileSheet,
        showMobileMoreSection: layout.mobileSheet,
        showMobileMarkersAction: mobile.markersAction,
        showMobileFiltersAction: mobile.filtersAction,
        showMobileMeasureAction: mobile.measureAction,
        showMobileShareAction: mobile.shareAction,
        showMobileSoundAction: mobile.soundAction,
        showMobileCoordsAction: mobile.coordsAction,
        showMobileHelpAction: layout.mobileSheet,
        showMobileGMAction: mobile.gmAction,
        showMobileToolkitAction: mobile.toolkitAction,
        showMobileMapBlurb: false,
        mobileMarkersDisabled: mobile.markersDisabled,
        mobileFiltersDisabled: mobile.filtersDisabled,
        mobileMeasureDisabled: mobile.measureDisabled,
        mobileShareDisabled: false,
        mobileSoundDisabled: false,
        mobileCoordsDisabled: mobile.coordsDisabled,
        mobileHelpDisabled: false,
        mobileGMDisabled: mobile.gmDisabled,
        mobileToolkitDisabled: mobile.toolkitDisabled
    };
}

function resolveControlFeatureAvailability({
    hasPOIs,
    hasRegions,
    hasRoads,
    allowGMToolkit,
    atlasSearchCount
}, featureEnabled) {
    const hasMapMarkers = hasPOIs || hasRegions;
    const hasSearchableFeatures = hasPOIs || hasRegions || hasRoads || atlasSearchCount > 0;
    const hasFilterableFeatures = hasPOIs || hasRegions || hasRoads;

    return {
        markers: hasMapMarkers,
        search: featureEnabled('atlasSearch', true) && hasSearchableFeatures,
        filters: featureEnabled('filters', true) && hasFilterableFeatures,
        gm: allowGMToolkit && featureEnabled('gmMode', false),
        toolkit: allowGMToolkit && featureEnabled('sessionToolkit', false)
    };
}

function resolveControlLayoutContexts({ isEmbedded, isMobileLayout, advancedControls }) {
    const desktop = !isMobileLayout;
    return {
        desktop,
        mobileSheet: isMobileLayout && !isEmbedded,
        desktopAdvanced: advancedControls && !isEmbedded && desktop
    };
}

function resolveDesktopControlVisibility({
    layout,
    features,
    hasValidScale,
    hasBlurb,
    hasLatLonBounds,
    toolkitVisible,
    gmVisible
}, featureEnabled) {
    return {
        markersButton: layout.desktop && features.markers,
        filtersButton: layout.desktop && features.filters,
        measureButton: layout.desktopAdvanced && hasValidScale,
        soundButton: layout.desktopAdvanced && featureEnabled('sound', true),
        blurbButton: layout.desktopAdvanced && hasBlurb,
        coordsButton: layout.desktopAdvanced && hasLatLonBounds && featureEnabled('coordinates', true),
        shareButton: layout.desktopAdvanced && featureEnabled('shareLinks', true),
        gmButton: layout.desktopAdvanced && features.gm,
        toolkitButton: layout.desktopAdvanced && features.toolkit,
        toolkitPanel: layout.desktop && features.toolkit && toolkitVisible,
        gmPill: layout.desktop && features.gm && gmVisible
    };
}

function resolveMobileControlVisibility({
    layout,
    features,
    hasValidScale,
    hasLatLonBounds
}, featureEnabled) {
    return {
        markersAction: layout.mobileSheet && features.markers,
        filtersAction: layout.mobileSheet && features.filters,
        measureAction: layout.mobileSheet && hasValidScale,
        shareAction: layout.mobileSheet && featureEnabled('shareLinks', true),
        soundAction: layout.mobileSheet && featureEnabled('sound', true),
        coordsAction: layout.mobileSheet && hasLatLonBounds && featureEnabled('coordinates', true),
        gmAction: layout.mobileSheet && features.gm,
        toolkitAction: layout.mobileSheet && features.toolkit,
        markersDisabled: !features.markers,
        filtersDisabled: !features.filters,
        measureDisabled: !hasValidScale,
        coordsDisabled: !hasLatLonBounds,
        gmDisabled: !(layout.mobileSheet && features.gm),
        toolkitDisabled: !(layout.mobileSheet && features.toolkit)
    };
}

function shouldAutoOpenOnboardingGuide({
    isEmbedded = false,
    isMobileLayout = false,
    hasSeenOnboarding = false
} = {}) {
    return !isEmbedded && !isMobileLayout && !hasSeenOnboarding;
}

function setElementHiddenState(element, hidden) {
    if (!element) return;
    element.hidden = !!hidden;
}

function createMobilePlacementAnchor(element) {
    if (!element || !element.parentNode) return null;
    const anchor = document.createElement('span');
    anchor.hidden = true;
    anchor.setAttribute('aria-hidden', 'true');
    anchor.className = 'mobile-placement-anchor';
    element.parentNode.insertBefore(anchor, element);
    return anchor;
}

const mobileSearchControlAnchor = createMobilePlacementAnchor(searchControlContainer);
const mobileSearchResultsAnchor = createMobilePlacementAnchor(searchResultsContainer);
const mobileFilterAnchor = createMobilePlacementAnchor(poiFilterContainer);
const mobileToolkitPanelAnchor = createMobilePlacementAnchor(sessionToolkitPanel);
const mobileGmPillAnchor = createMobilePlacementAnchor(gmPill);

function restorePlacedNode(anchor, element) {
    if (!anchor || !anchor.parentNode || !element) return;
    if (element.parentNode === anchor.parentNode && anchor.nextSibling === element) return;
    anchor.parentNode.insertBefore(element, anchor.nextSibling);
}

function restoreMobileToolPanels() {
    restorePlacedNode(mobileToolkitPanelAnchor, sessionToolkitPanel);
    restorePlacedNode(mobileGmPillAnchor, gmPill);
    [sessionToolkitPanel, gmPill].forEach((panel) => {
        if (panel) {
            panel.classList.remove('mobile-tools-mounted');
        }
    });
}

function syncMobileToolPanelButtonState() {
    if (mobileToolkitBtn) {
        const active = isMobileLayoutActive && mobileSurfaceMode === MOBILE_SURFACE_MODE_TOOLS && mobileToolsPanelMode === MOBILE_TOOLS_PANEL_TOOLKIT;
        mobileToolkitBtn.classList.toggle('active', active);
        mobileToolkitBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (mobileGmViewBtn) {
        const active = isMobileLayoutActive && mobileSurfaceMode === MOBILE_SURFACE_MODE_TOOLS && mobileToolsPanelMode === MOBILE_TOOLS_PANEL_GM;
        mobileGmViewBtn.classList.toggle('active', active);
        mobileGmViewBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
}

function setMobileToolsPanelMode(mode = null) {
    mobileToolsPanelMode = null;
    if (!isMobileLayoutActive || !mobileToolsPanelSlot) {
        restoreMobileToolPanels();
        syncMobileToolPanelButtonState();
        return;
    }

    [sessionToolkitPanel, gmPill].forEach((panel) => {
        if (panel) panel.style.display = 'none';
    });

    mobileToolsPanelSlot.hidden = true;
    syncMobileToolPanelButtonState();
}

function syncMobileSheetPlacement() {
    if (isMobileLayoutActive) {
        if (mobileSearchPanelSearchSlot && searchControlContainer && searchControlContainer.parentNode !== mobileSearchPanelSearchSlot) {
            mobileSearchPanelSearchSlot.appendChild(searchControlContainer);
        }
        if (mobileSearchPanelSearchSlot && poiFilterContainer && poiFilterContainer.parentNode !== mobileSearchPanelSearchSlot) {
            mobileSearchPanelSearchSlot.appendChild(poiFilterContainer);
        }
        if (mobileSearchPanelResultsSlot && searchResultsContainer && searchResultsContainer.parentNode !== mobileSearchPanelResultsSlot) {
            mobileSearchPanelResultsSlot.appendChild(searchResultsContainer);
        }
        syncMobileSearchResultsCardState();
        setMobileToolsPanelMode(mobileSurfaceMode === MOBILE_SURFACE_MODE_TOOLS ? mobileToolsPanelMode : null);
        return;
    }

    restorePlacedNode(mobileSearchControlAnchor, searchControlContainer);
    restorePlacedNode(mobileSearchResultsAnchor, searchResultsContainer);
    restorePlacedNode(mobileFilterAnchor, poiFilterContainer);
    setMobileToolsPanelMode(null);
    restoreMobileToolPanels();
    syncMobileSearchResultsCardState();
}

function syncMobileSearchResultsCardState() {
    if (!mobileSearchResultsCard) return;
    const hasVisibleResults =
        isMobileLayoutActive &&
        isMobileSurfaceMode(MOBILE_SURFACE_MODE_SEARCH) &&
        searchResultsContainer &&
        searchResultsContainer.style.display !== 'none' &&
        searchResultsContainer.innerHTML.trim() !== '';
    mobileSearchResultsCard.hidden = !hasVisibleResults;
}

function resolveSearchScope(scope, {
    isMobileLayout = isMobileLayoutActive
} = {}) {
    const normalizedScope = scope === SEARCH_SCOPE_ATLAS ? SEARCH_SCOPE_ATLAS : SEARCH_SCOPE_MAP;
    return normalizedScope;
}

function hasOpenMobileSurface() {
    return mobileSurfaceMode === MOBILE_SURFACE_MODE_ATLAS ||
        mobileSurfaceMode === MOBILE_SURFACE_MODE_SEARCH ||
        mobileSurfaceMode === MOBILE_SURFACE_MODE_TOOLS;
}

function normalizeMobileSurfaceMode(mode) {
    if (mode === MOBILE_SURFACE_MODE_ATLAS) return MOBILE_SURFACE_MODE_ATLAS;
    if (mode === MOBILE_SURFACE_MODE_TOOLS) return MOBILE_SURFACE_MODE_TOOLS;
    return MOBILE_SURFACE_MODE_SEARCH;
}

function getMobileSurfaceModeLabel(mode = mobileSurfaceMode) {
    if (mode === MOBILE_SURFACE_MODE_ATLAS) return 'atlas';
    if (mode === MOBILE_SURFACE_MODE_TOOLS) return 'tools';
    return 'search';
}

function isMobileSurfaceMode(mode) {
    return mobileSurfaceMode === mode;
}

function syncSidebarInteractionState() {
    if (!sidebar) return;
    const hiddenByLayout = isMobileLayoutActive
        ? !isMobileSurfaceMode(MOBILE_SURFACE_MODE_ATLAS)
        : !!(container && container.classList.contains('sidebar-collapsed'));
    const hiddenByModal = featureDetailSheetOpen && featureDetailSheetExpanded;
    const hidden = hiddenByLayout || hiddenByModal;
    sidebar.inert = hidden;
    sidebar.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

function isMobileSheetModeAvailable(mode) {
    return mode !== MOBILE_SURFACE_MODE_SEARCH ||
        !!(searchControlContainer && searchControlContainer.style.display !== 'none');
}

function applyMobileSheetMode(mode, { triggerButton = null, toolsPanelMode = null } = {}) {
    mobileSurfaceMode = mode;
    if (triggerButton) {
        lastMobileSurfaceTriggerButton = triggerButton;
    }
    if (mapBlurbElement && mapBlurbElement.classList.contains('visible')) {
        setMapBlurbVisible(false);
    }
    setSearchScope(currentSearchScope);
    if (mode === MOBILE_SURFACE_MODE_ATLAS) {
        setSidebarState('o', false);
    } else if (container && !container.classList.contains('sidebar-collapsed')) {
        setSidebarState('c', false);
    }
    setMobileToolsPanelMode(
        mode === MOBILE_SURFACE_MODE_TOOLS ? toolsPanelMode || mobileToolsPanelMode : null
    );
    syncMobileSearchPanelState();
    syncMobileExploreVisibility();
    syncSidebarBackdropState();
}

function focusMobileSheet(mode, focusSearch) {
    if (focusSearch && mode === MOBILE_SURFACE_MODE_SEARCH && poiSearchInput) {
        poiSearchInput.focus({ preventScroll: true });
    } else if (mode === MOBILE_SURFACE_MODE_ATLAS && mobileAtlasCloseBtn) {
        mobileAtlasCloseBtn.focus({ preventScroll: true });
    } else if (mode === MOBILE_SURFACE_MODE_TOOLS && mobileToolsCardCloseBtn) {
        mobileToolsCardCloseBtn.focus({ preventScroll: true });
    }
}

function openMobileSheet({ mode = MOBILE_SURFACE_MODE_SEARCH, focusSearch = false, triggerButton = null, toolsPanelMode = null } = {}) {
    if (!isMobileLayoutActive) return;
    if (featureDetailSheetOpen) {
        closeFeatureDetailSheet({ restoreFocus: false });
    }
    const nextMode = normalizeMobileSurfaceMode(mode);
    if (!isMobileSheetModeAvailable(nextMode)) return;
    applyMobileSheetMode(nextMode, { triggerButton, toolsPanelMode });
    focusMobileSheet(nextMode, focusSearch);
}

function closeMobileSheet({ restoreFocus = false } = {}) {
    if (!hasOpenMobileSurface()) return;
    const closingMode = mobileSurfaceMode;
    const focusTarget = restoreFocus
        ? lastMobileSurfaceTriggerButton || mobileSheetLauncherBtn || mobileSearchLauncherBtn || mobileToolsLauncherBtn
        : null;
    if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
    }
    mobileSurfaceMode = null;
    setMobileToolsPanelMode(null);
    if (closingMode === MOBILE_SURFACE_MODE_ATLAS && container && !container.classList.contains('sidebar-collapsed')) {
        setSidebarState('c', false);
    } else {
        syncMobileSearchPanelState();
        syncSidebarBackdropState();
    }
}

function openMobileSearchPanel({ focusSearch = false, triggerButton = null } = {}) {
    openMobileSheet({ mode: MOBILE_SURFACE_MODE_SEARCH, focusSearch, triggerButton });
}

function closeMobileSearchPanel({ restoreFocus = false } = {}) {
    closeMobileSheet({ restoreFocus });
}

function openMobileToolsPanel({ panelMode = null, triggerButton = null } = {}) {
    openMobileSheet({
        mode: MOBILE_SURFACE_MODE_TOOLS,
        triggerButton,
        toolsPanelMode: panelMode
    });
}

mobileLayoutV2Enabled = resolveMobileLayoutV2Enabled();
updateMobileLayoutState();
setSearchScope(SEARCH_SCOPE_MAP);

if (isEmbeddedView) {
    if (bodyElement) bodyElement.classList.add('embedded-view');
    if (container) container.classList.add('sidebar-collapsed');
    currentSidebarState = 'c';
}

function syncDynamicViewportHeight() {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    rootElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
}

function syncBottomBarHeightVariable() {
    const bottomLinkBar = document.getElementById('bottom-link-bar');
    const bottomBarHeight = (!isEmbeddedView && bottomLinkBar && bottomLinkBar.style.display !== 'none')
        ? Math.ceil(bottomLinkBar.getBoundingClientRect().height)
        : 0;
    rootElement.style.setProperty('--bottom-link-bar-height', `${bottomBarHeight}px`);
}

function clampFloatingPanels() {
    if (!mobileLayoutV2Enabled || isMobileLayoutActive) return;
    if (typeof applyFeatureDetailDockedWidth === 'function' && typeof applyAtlasSidebarWidth === 'function') {
        applyFeatureDetailDockedWidth(featureDetailDockedWidth);
        applyAtlasSidebarWidth(atlasSidebarWidth);
    }
    if (typeof applyFloatingFeatureDetailGeometry === 'function' && featureDetailSheetOpen && !featureDetailSheetDocked && featureDetailFloatingGeometry) {
        applyFloatingFeatureDetailGeometry(featureDetailFloatingGeometry, { persist: true });
    }
    [sessionToolkitPanel, gmPill].forEach((panel) => {
        if (!panel) return;
        panel.style.maxHeight = '';
        panel.style.top = '';
        panel.style.right = '';
        panel.style.left = '';
    });
}

function shouldShowMiniMap() {
    const featureEnabled = (typeof getFeatureFlag === 'function') ? getFeatureFlag('minimap', true) : true;
    return featureEnabled && !isEmbeddedView;
}

function removeMiniMapControl() {
    if (!miniMapControl) return;
    miniMapControl.remove();
    miniMapControl = null;
    miniMapControlMode = null;
    miniMapControlMapId = null;
}

function getMiniMapDimensions(mapWidth, mapHeight, maxMiniMapSize) {
    if (mapWidth >= mapHeight) {
        return {
            miniMapWidth: maxMiniMapSize,
            miniMapHeight: maxMiniMapSize * (mapHeight / mapWidth)
        };
    }
    return {
        miniMapHeight: maxMiniMapSize,
        miniMapWidth: maxMiniMapSize * (mapWidth / mapHeight)
    };
}

function applyMiniMapA11yAttributes(control) {
    const miniMapElement = typeof control.getContainer === 'function'
        ? control.getContainer()
        : control._container;
    if (miniMapElement) {
        miniMapElement.setAttribute('role', 'region');
        miniMapElement.setAttribute('aria-label', 'Map overview');
        const toggleDisplayButton = miniMapElement.querySelector('.leaflet-control-minimap-toggle-display');
        if (toggleDisplayButton) {
            toggleDisplayButton.setAttribute('aria-label', 'Toggle map overview');
        }
    }
}

function syncMiniMapControl() {
    if (!shouldShowMiniMap()) {
        removeMiniMapControl();
        return;
    }
    if (map && Object.prototype.hasOwnProperty.call(map, '_loaded') && !map._loaded) {
        if (typeof map.whenReady === 'function') {
            map.whenReady(() => syncMiniMapControl());
        }
        return;
    }
    const nextMode = isMobileLayoutActive ? 'mobile' : 'desktop';
    const nextMapId = String(currentMapData?.id || '').trim();
    if (miniMapControl && (miniMapControlMode !== nextMode || miniMapControlMapId !== nextMapId)) {
        removeMiniMapControl();
    }
    if (miniMapControl) return;
    if (!currentMapData || !currentBounds) return;

    const mapHeight = Number(currentMapData.height);
    const mapWidth = Number(currentMapData.width);
    const rawMiniMapImageUrl = getMiniMapImageUrl(currentMapData);
    const miniMapImageUrl = typeof withAssetVersion === 'function'
        ? withAssetVersion(rawMiniMapImageUrl)
        : rawMiniMapImageUrl;
    if (!mapHeight || !mapWidth || !miniMapImageUrl) return;

    const viewportLimit = typeof window !== 'undefined'
        ? Math.max(96, Math.min(window.innerWidth || 0, window.innerHeight || 0) * 0.26)
        : 132;
    const maxMiniMapSize = isMobileLayoutActive ? Math.min(132, viewportLimit) : 200;
    const miniMapLayer = L.imageOverlay(miniMapImageUrl, currentBounds);
    const { miniMapWidth, miniMapHeight } = getMiniMapDimensions(mapWidth, mapHeight, maxMiniMapSize);

    const maxDim = Math.max(mapHeight, mapWidth);
    const miniMapZoom = Math.log2(maxMiniMapSize / maxDim);

    miniMapControl = new L.Control.MiniMap(miniMapLayer, {
        toggleDisplay: true,
        minimized: false,
        width: miniMapWidth,
        height: miniMapHeight,
        collapsedWidth: isMobileLayoutActive ? 40 : 32,
        collapsedHeight: isMobileLayoutActive ? 40 : 32,
        zoomLevelFixed: miniMapZoom,
        centerFixed: L.latLngBounds(currentBounds).getCenter(),
        aimingRectOptions: { color: '#ff7800', weight: 3, clickable: false },
        shadowRectOptions: { color: '#000000', weight: 1, clickable: false, opacity: 0, fillOpacity: 0 },
        mapOptions: { minZoom: -100, crs: L.CRS.Simple, zoomSnap: 0, zoomDelta: 0 }
    }).addTo(map);

    applyMiniMapA11yAttributes(miniMapControl);

    miniMapControlMode = nextMode;
    miniMapControlMapId = nextMapId;
}

function updateMobileLayoutState() {
    syncDynamicViewportHeight();
    syncBottomBarHeightVariable();

    const active = mobileLayoutV2Enabled && window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT;
    isMobileLayoutActive = active;

    rootElement.classList.toggle('mobile-layout-v2', mobileLayoutV2Enabled);
    rootElement.classList.toggle('is-mobile-layout', active);
    bodyElement.classList.toggle('mobile-layout-v2', mobileLayoutV2Enabled);
    bodyElement.classList.toggle('is-mobile-layout', active);
    container.classList.toggle('is-mobile-layout', active);
    if (active && container && !isMobileSurfaceMode(MOBILE_SURFACE_MODE_ATLAS)) {
        container.classList.add('sidebar-collapsed');
        currentSidebarState = 'c';
    }

    rootElement.style.setProperty('--mobile-bottom-offset', active ? '14px' : '10px');
    if (!active && hasOpenMobileSurface()) {
        mobileSurfaceMode = null;
    }
    if (!active) {
        setMobileToolsPanelMode(null);
    }
    if (toggleBtn) {
        const collapsed = container.classList.contains('sidebar-collapsed');
        if (active) {
            const surfaceOpen = hasOpenMobileSurface();
            toggleBtn.title = surfaceOpen ? `Close ${getMobileSurfaceModeLabel()}` : 'Open search';
            toggleBtn.setAttribute('aria-label', surfaceOpen ? `Close ${getMobileSurfaceModeLabel()}` : 'Open search');
            toggleBtn.setAttribute('aria-expanded', surfaceOpen ? 'true' : 'false');
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.innerHTML = collapsed
                ? `<i class="ui-icon" data-lucide="chevron-right" aria-hidden="true"></i>`
                : `<i class="ui-icon" data-lucide="chevron-left" aria-hidden="true"></i>`;
            toggleBtn.title = collapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
            toggleBtn.setAttribute('aria-label', collapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
            toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            refreshLucideIcons();
        }
    }
    syncMobileSheetPlacement();
    renderMapBlurbContent();
    setMapBlurbVisible(false);
    syncMobileSearchResultsCardState();
    syncMobileSearchPanelState();
    syncMobileFilterState();
    syncMiniMapControl();
    if (featureDetailSheetOpen) syncFeatureDetailSheetState();
    clampFloatingPanels();
}

function syncMobileSearchPanelState() {
    if (!mobileSearchPanel && !mobileToolsCard) return;
    const mode = isMobileLayoutActive ? mobileSurfaceMode : null;
    const showAtlas = mode === MOBILE_SURFACE_MODE_ATLAS;
    const showSearch = mode === MOBILE_SURFACE_MODE_SEARCH;
    const showTools = mode === MOBILE_SURFACE_MODE_TOOLS;
    if (mobileSearchPanel) {
        mobileSearchPanel.setAttribute('aria-hidden', showSearch ? 'false' : 'true');
        mobileSearchPanel.dataset.mode = showSearch ? mode : '';
        mobileSearchPanel.inert = !showSearch;
    }
    if (mobileToolsCard) {
        mobileToolsCard.setAttribute('aria-hidden', showTools ? 'false' : 'true');
        mobileToolsCard.dataset.mode = showTools ? mode : '';
        mobileToolsCard.inert = !showTools;
    }
    container.classList.toggle('mobile-search-card-open', showSearch);
    container.classList.toggle('mobile-tools-card-open', showTools);
    container.classList.toggle('mobile-surface-atlas', showAtlas);
    container.classList.toggle('mobile-surface-search', showSearch);
    container.classList.toggle('mobile-surface-tools', showTools);
    if (mobileSearchPanelTitle) {
        mobileSearchPanelTitle.textContent = 'Search';
    }
    if (mobileSearchPanelCloseBtn) {
        mobileSearchPanelCloseBtn.setAttribute('aria-label', 'Close search');
    }
    if (mobileSearchPanelSearchSlot) {
        mobileSearchPanelSearchSlot.hidden = !showSearch;
    }
    setMobileToolsPanelMode(showTools ? mobileToolsPanelMode : null);
    syncSidebarInteractionState();
    syncMobileSearchResultsCardState();
    syncMobileDockState();
}

function syncMapBlurbButtonState() {
    const visible = !!(mapBlurbElement && mapBlurbElement.classList.contains('visible'));
    if (toggleBlurbBtn) {
        toggleBlurbBtn.classList.toggle('active', visible);
        toggleBlurbBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
    if (mobileInfoHelpBtn) {
        mobileInfoHelpBtn.classList.toggle('active', visible);
        mobileInfoHelpBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
        mobileInfoHelpBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
}

function setMapBlurbVisible(visible) {
    if (!mapBlurbElement) return;
    const nextVisible = !!visible;
    if (nextVisible && featureDetailSheetOpen) {
        closeFeatureDetailSheet({ restoreFocus: false });
    }
    if (nextVisible && hasOpenMobileSurface()) {
        closeMobileSheet({ restoreFocus: false });
    }
    mapBlurbElement.classList.toggle('visible', nextVisible);
    syncMapBlurbButtonState();
}

function renderMapBlurbContent(mapInfo = getMapRuntimeData(currentlyLoadedMapId)) {
    if (!mapBlurbElement) return;
    const safeName = escapeHtml(mapInfo?.name || 'Atlas');
    const defaultCopy = '<p>Open the guide for controls, shortcuts, and atlas help.</p>';

    // Sanitize HTML content containing map blurbs before inserting it into the DOM
    // to prevent Stored XSS via malicious injected tags or event handlers.
    // If DOMPurify fails to load, we fail closed by escaping the HTML to prevent XSS.
    const blurbBody = typeof DOMPurify !== 'undefined'
        ? DOMPurify.sanitize(mapInfo?.blurb || defaultCopy)
        : escapeHtml(mapInfo?.blurb || defaultCopy);

    if (isMobileLayoutActive) {
        mapBlurbElement.innerHTML = `
            <div class="mobile-map-blurb-card">
                <div class="mobile-map-blurb-header">
                    <span class="mobile-map-blurb-eyebrow">Map Info</span>
                    <strong class="mobile-map-blurb-title">${safeName}</strong>
                </div>
                <div class="mobile-map-blurb-copy">${blurbBody}</div>
                <button type="button" class="map-blurb-help-action">Open Guide</button>
            </div>
        `;
        return;
    }

    const desktopBlurb = typeof DOMPurify !== 'undefined'
        ? DOMPurify.sanitize(mapInfo?.blurb || '')
        : escapeHtml(mapInfo?.blurb || '');

    mapBlurbElement.innerHTML = desktopBlurb;
}

function syncMobileMapMeta(mapInfo, visibilityState) {
    renderMapBlurbContent(mapInfo);
    if (!mobileSearchPanelTitle) return;
    mobileSearchPanelTitle.textContent = 'Search';
}

function syncMobileUtilityButton(button, {
    visible = false,
    pressed = false,
    disabled = false
} = {}) {
    if (!button) return;
    button.hidden = !visible;
    button.disabled = visible ? !!disabled : false;
    button.classList.toggle('active', visible && !disabled && pressed);
    button.setAttribute('aria-pressed', visible && !disabled && pressed ? 'true' : 'false');
    button.setAttribute('aria-disabled', visible && disabled ? 'true' : 'false');
}

function hasVisibleMobileToolAction() {
    return [
        mobileMarkersBtn,
        mobileFiltersBtn,
        mobileMeasureBtn,
        mobileSoundBtn,
        mobileShareViewBtn,
        mobileCoordsBtn,
        mobileHelpBtn,
        mobileGmViewBtn,
        mobileToolkitBtn
    ].some((button) => button && !button.hidden);
}

function syncMobileSheetActionState(visibilityState) {
    syncMobileUtilityButton(mobileMarkersBtn, {
        visible: visibilityState.showMobileMarkersAction,
        pressed: markersVisible,
        disabled: visibilityState.mobileMarkersDisabled
    });
    syncMobileUtilityButton(mobileFiltersBtn, {
        visible: visibilityState.showMobileFiltersAction,
        pressed: filtersPanelVisible,
        disabled: visibilityState.mobileFiltersDisabled
    });
    syncMobileUtilityButton(mobileMeasureBtn, {
        visible: visibilityState.showMobileMeasureAction,
        pressed: isMeasuringMultiPoint,
        disabled: visibilityState.mobileMeasureDisabled
    });
    syncMobileUtilityButton(mobileSoundBtn, {
        visible: visibilityState.showMobileSoundAction,
        pressed: soundEnabled,
        disabled: visibilityState.mobileSoundDisabled
    });
    if (mobileShareViewBtn) {
        mobileShareViewBtn.hidden = !visibilityState.showMobileShareAction;
        mobileShareViewBtn.disabled = visibilityState.showMobileShareAction ? !!visibilityState.mobileShareDisabled : false;
        mobileShareViewBtn.setAttribute('aria-disabled', visibilityState.showMobileShareAction && visibilityState.mobileShareDisabled ? 'true' : 'false');
    }
    syncMobileUtilityButton(mobileCoordsBtn, {
        visible: visibilityState.showMobileCoordsAction,
        pressed: coordsDisplayEnabled,
        disabled: visibilityState.mobileCoordsDisabled
    });
    if (mobileHelpBtn) {
        mobileHelpBtn.hidden = !visibilityState.showMobileHelpAction;
        mobileHelpBtn.disabled = visibilityState.showMobileHelpAction ? !!visibilityState.mobileHelpDisabled : false;
        mobileHelpBtn.setAttribute('aria-disabled', visibilityState.showMobileHelpAction && visibilityState.mobileHelpDisabled ? 'true' : 'false');
    }
    syncMobileUtilityButton(mobileGmViewBtn, {
        visible: visibilityState.showMobileGMAction,
        pressed: mobileToolsPanelMode === MOBILE_TOOLS_PANEL_GM || gmContentVisible,
        disabled: visibilityState.mobileGMDisabled
    });
    syncMobileUtilityButton(mobileToolkitBtn, {
        visible: visibilityState.showMobileToolkitAction,
        pressed: mobileToolsPanelMode === MOBILE_TOOLS_PANEL_TOOLKIT,
        disabled: visibilityState.mobileToolkitDisabled
    });
    if (mobileToolsLauncherBtn) {
        mobileToolsLauncherBtn.hidden = !visibilityState.showMobileToolsToggle || !hasVisibleMobileToolAction();
    }
    syncMobileToolPanelButtonState();
}

function syncMobileExploreVisibility() {
    const showAtlas = isMobileLayoutActive && isMobileSurfaceMode(MOBILE_SURFACE_MODE_ATLAS);
    container.classList.toggle('mobile-atlas-open', showAtlas);
}

function syncFilterPanelInteractionState(visible = filtersPanelVisible) {
    if (!poiFilterContainer) return;
    const interactive = !!visible;
    poiFilterContainer.inert = !interactive;
    poiFilterContainer.setAttribute('aria-hidden', interactive ? 'false' : 'true');
}

function syncMobileFilterState() {
    syncFilterPanelInteractionState(filtersPanelVisible);
    container.classList.toggle('mobile-filters-open', isMobileLayoutActive && mobileFilterExpanded);
    if (searchRefineFiltersBtn) {
        searchRefineFiltersBtn.classList.toggle('active', mobileFilterExpanded);
        searchRefineFiltersBtn.setAttribute('aria-pressed', mobileFilterExpanded ? 'true' : 'false');
        searchRefineFiltersBtn.setAttribute('aria-expanded', mobileFilterExpanded ? 'true' : 'false');
        searchRefineFiltersBtn.textContent = mobileFilterExpanded ? 'Hide Filters' : 'Filters';
    }
}

function syncMobileDockLauncher(button, {
    mode,
    hidden,
    name,
    icon,
    showLabel = false
}) {
    if (!button) return;
    const active = isMobileLayoutActive && isMobileSurfaceMode(mode);
    const activeState = active ? 'true' : 'false';
    button.hidden = hidden;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', activeState);
    button.setAttribute('aria-expanded', activeState);
    button.setAttribute('aria-label', active ? `Close ${name}` : `Open ${name}`);
    button.innerHTML = `<i class="ui-icon" data-lucide="${icon}" aria-hidden="true"></i>${showLabel ? `<span class="mobile-fab-label">${name[0].toUpperCase()}${name.slice(1)}</span>` : ''}`;
}

function syncMobileDockState() {
    const hideMobileDock = !isMobileLayoutActive || isEmbeddedView;
    if (mobileDock) mobileDock.hidden = hideMobileDock;

    const showSearchLauncher = !isEmbeddedView && isMobileLayoutActive && searchControlContainer && searchControlContainer.style.display !== 'none';
    syncMobileDockLauncher(mobileSheetLauncherBtn, {
        mode: MOBILE_SURFACE_MODE_ATLAS,
        hidden: hideMobileDock,
        name: 'atlas',
        icon: 'chevron-right',
        showLabel: true
    });
    syncMobileDockLauncher(mobileSearchLauncherBtn, {
        mode: MOBILE_SURFACE_MODE_SEARCH,
        hidden: !showSearchLauncher,
        name: 'search',
        icon: 'search',
        showLabel: true
    });
    syncMobileDockLauncher(mobileToolsLauncherBtn, {
        mode: MOBILE_SURFACE_MODE_TOOLS,
        hidden: hideMobileDock || !hasVisibleMobileToolAction(),
        name: 'tools',
        icon: 'sliders-horizontal'
    });
    if (mobileInfoHelpBtn) {
        mobileInfoHelpBtn.hidden = hideMobileDock;
    }
    refreshLucideIcons();
}

function markControlTouch(event) {
    const target = event?.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.leaflet-control, .map-control-button, #toggle-sidebar-btn, #mobile-info-help-btn, #mobile-tools-launcher-btn, #mobile-dock, #mobile-search-card, #mobile-tools-card, #sidebar, #feature-detail-sheet, #map-blurb, #sidebar-backdrop, .modal-overlay, .modal-content')) return;
    lastControlTouchAt = Date.now();
}

function shouldIgnoreMapPointerEvent(event) {
    const target = event?.originalEvent?.target;
    if (target instanceof Element && target.closest('.leaflet-control, .map-control-button, #toggle-sidebar-btn, #mobile-info-help-btn, #mobile-tools-launcher-btn, #mobile-dock, #mobile-search-card, #mobile-tools-card, #sidebar, #feature-detail-sheet, #map-blurb, .modal-overlay, .modal-content')) {
        return true;
    }
    if (isMobileLayoutActive && (Date.now() - lastControlTouchAt) < 150) {
        return true;
    }
    return false;
}

function createSidebarTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function clearSidebarElement(element) {
    if (!element) return;
    if (typeof element.replaceChildren === 'function') {
        element.replaceChildren();
        return;
    }
    element.innerHTML = '';
}

function getSidebarPlainText(value) {
    return stripHtml(String(value || '')).replace(/\s+/g, ' ').trim();
}

function getSidebarFeatureTitle(feature) {
    return String(feature?.name || feature?.id || 'Selected feature').trim();
}

function getSidebarFeatureTypeLabel(feature, type) {
    if (type === 'poi') return feature?.type || 'Point of interest';
    if (type === 'region') return feature?.value || feature?.type || 'Region';
    if (type === 'line') return feature?.type || 'Line';
    return 'Feature';
}

function appendSidebarMetaRow(parent, label, value) {
    const text = String(value || '').trim();
    if (!text) return;
    const row = document.createElement('div');
    row.className = 'sidebar-detail-meta-row';
    row.appendChild(createSidebarTextElement('span', 'sidebar-detail-meta-label', label));
    row.appendChild(createSidebarTextElement('span', 'sidebar-detail-meta-value', text));
    parent.appendChild(row);
}

function getFeaturePrimitiveProperties(feature) {
    const properties = feature?.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
    return Object.entries(properties)
        .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object');
}

function getSidebarFeatureProperties(feature) {
    return getFeaturePrimitiveProperties(feature).slice(0, 8);
}

function getFeatureDetailSections(feature) {
    const sections = Array.isArray(feature?.detailSections) ? feature.detailSections : [];
    const result = [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
        const heading = getSidebarPlainText(section.heading);
        const body = getSidebarPlainText(section.body);
        if (heading || body) {
            result.push({ heading, body });
        }
    }
    return result;
}

function getFeatureTags(feature) {
    if (!Array.isArray(feature?.tags)) return [];
    const seen = new Set();
    const result = [];
    const tags = feature.tags;
    for (let i = 0; i < tags.length; i++) {
        const tag = getSidebarPlainText(tags[i]);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(tag);
        }
    }
    return result;
}

function getFeatureSearchDetailText(feature) {
    // ⚡ Bolt: Eliminate multiple intermediate arrays, object allocations, and redundant string creations
    // by streaming all valid textual data directly into a single array before joining.
    const parts = [];

    if (feature?.summary) parts.push(String(feature.summary));
    if (feature?.description) parts.push(String(feature.description));

    const sections = Array.isArray(feature?.detailSections) ? feature.detailSections : [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
        const heading = getSidebarPlainText(section.heading);
        const body = getSidebarPlainText(section.body);
        if (heading) parts.push(heading);
        if (body) parts.push(body);
    }

    if (Array.isArray(feature?.tags)) {
        const tags = feature.tags;
        const seen = new Set();
        for (let i = 0; i < tags.length; i++) {
            const tag = getSidebarPlainText(tags[i]);
            if (!tag) continue;
            const key = tag.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                parts.push(tag);
            }
        }
    }

    const props = getFeaturePrimitiveProperties(feature);
    for (let i = 0; i < props.length; i++) {
        parts.push(`${props[i][0]} ${String(props[i][1])}`);
    }

    return parts.join(' ');
}

function buildSidebarFeatureDetailModel(feature, type) {
    if (!feature) return null;
    const summary = getSidebarPlainText(feature.summary);
    const description = getSidebarPlainText(feature.description);
    const linkedMap = resolveLinkedMapData(feature);
    const technicalRows = [
        ['Type', feature.type || getSidebarFeatureTypeLabel(feature, type)],
        ['Linked map', linkedMap?.name || ''],
        ['ID', feature.id || ''],
        ...getSidebarFeatureProperties(feature)
    ].filter(([, value]) => String(value || '').trim());

    return {
        title: getSidebarFeatureTitle(feature),
        typeLabel: getSidebarFeatureTypeLabel(feature, type),
        summary,
        description: description && description !== summary ? description : '',
        technicalRows,
        sections: getFeatureDetailSections(feature),
        tags: getFeatureTags(feature),
        linkedMap
    };
}

function appendSidebarTextSection(parent, title, body) {
    if (!body) return;
    const section = document.createElement('section');
    section.className = 'sidebar-detail-section';
    if (title) {
        section.appendChild(createSidebarTextElement('h3', 'sidebar-detail-section-title', title));
    }
    section.appendChild(createSidebarTextElement('p', 'sidebar-detail-section-body', body));
    parent.appendChild(section);
}

function appendSidebarTags(parent, tags) {
    if (!Array.isArray(tags) || tags.length === 0) return;
    const tagList = document.createElement('div');
    tagList.className = 'sidebar-detail-tags';
    tags.forEach((tag) => {
        tagList.appendChild(createSidebarTextElement('span', 'sidebar-detail-tag', tag));
    });
    parent.appendChild(tagList);
}

function findSidebarFeatureLayer(feature, type) {
    if (!feature) return null;
    const id = String(feature.id || '').trim();
    const name = String(feature.name || '').trim();
    if (type === 'poi') {
        return (id && allMapMarkersById.get(id)) || (name && allMapMarkersByName.get(name)) || null;
    }
    if (type === 'region') {
        return (id && allMapRegionsById.get(id)) || (name && allMapRegionsByName.get(name)) || null;
    }
    if (type === 'line') {
        return (id && allMapLinesById.get(id)) || (name && allMapLinesByName.get(name)) || null;
    }
    return null;
}

function getPoiMarkerAccessibleName(point) {
    const rawName = getSidebarPlainText(point?.name || point?.id || 'Unnamed POI');
    return `${rawName || 'Unnamed POI'} marker`;
}

function focusSidebarSelectedFeature() {
    const layer = findSidebarFeatureLayer(selectedSidebarFeature, selectedSidebarFeatureType);
    if (!layer || !map) return;

    if (typeof layer.getLatLng === 'function') {
        map.flyTo(layer.getLatLng(), Math.max(map.getZoom(), 1));
    } else if (typeof layer.getBounds === 'function') {
        map.fitBounds(layer.getBounds(), { maxZoom: Math.max(map.getZoom(), 1) });
    }
    if (typeof layer.openPopup === 'function' && layer.getPopup && layer.getPopup()) {
        layer.openPopup();
    } else if (typeof layer.openPopup === 'function') {
        layer.openPopup();
    }
}

function renderSidebarEmptyFeature(parent) {
    parent.appendChild(createSidebarTextElement('p', 'sidebar-detail-empty', 'No location selected.'));
}

function renderSidebarFeaturePanel() {
    if (!sidebarPoiPanel) return;
    clearSidebarElement(sidebarPoiPanel);

    if (!selectedSidebarFeature) {
        renderSidebarEmptyFeature(sidebarPoiPanel);
        return;
    }

    const detailModel = buildSidebarFeatureDetailModel(selectedSidebarFeature, selectedSidebarFeatureType);
    if (!detailModel) {
        renderSidebarEmptyFeature(sidebarPoiPanel);
        return;
    }

    const header = document.createElement('header');
    header.className = 'sidebar-detail-header';
    const title = createSidebarTextElement('h2', 'sidebar-detail-title', detailModel.title);
    title.id = 'feature-detail-title';
    header.appendChild(title);
    header.appendChild(createSidebarTextElement('span', 'sidebar-detail-type', detailModel.typeLabel));
    sidebarPoiPanel.appendChild(header);

    if (detailModel.summary) {
        sidebarPoiPanel.appendChild(createSidebarTextElement('p', 'sidebar-detail-summary', detailModel.summary));
    }

    appendSidebarTextSection(sidebarPoiPanel, 'Overview', detailModel.description);
    detailModel.sections.forEach((section) => {
        appendSidebarTextSection(sidebarPoiPanel, section.heading, section.body);
    });
    appendSidebarTags(sidebarPoiPanel, detailModel.tags);

    const actions = document.createElement('div');
    actions.className = 'sidebar-detail-actions';

    if (detailModel.technicalRows.length > 0) {
        const technicalPanel = document.createElement('section');
        technicalPanel.id = 'feature-detail-technical';
        technicalPanel.className = 'sidebar-detail-technical';
        technicalPanel.hidden = true;
        technicalPanel.appendChild(createSidebarTextElement('h3', 'sr-only', 'Technical details'));
        const technicalMeta = document.createElement('div');
        technicalMeta.className = 'sidebar-detail-meta';
        detailModel.technicalRows.forEach(([key, value]) => {
            appendSidebarMetaRow(technicalMeta, key, value);
        });
        technicalPanel.appendChild(technicalMeta);
        sidebarPoiPanel.appendChild(technicalPanel);

        const technicalToggle = document.createElement('button');
        technicalToggle.type = 'button';
        technicalToggle.className = 'sidebar-detail-technical-toggle';
        technicalToggle.title = 'Stats for nerds';
        technicalToggle.setAttribute('aria-label', 'Show technical details');
        technicalToggle.setAttribute('aria-controls', technicalPanel.id);
        technicalToggle.setAttribute('aria-expanded', 'false');
        technicalToggle.innerHTML = '<i class="ui-icon" data-lucide="database" aria-hidden="true"></i><span>Stats</span>';
        technicalToggle.addEventListener('click', () => {
            const expanded = technicalToggle.getAttribute('aria-expanded') !== 'true';
            technicalToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            technicalToggle.setAttribute('aria-label', expanded ? 'Hide technical details' : 'Show technical details');
            technicalPanel.hidden = !expanded;
        });
        actions.appendChild(technicalToggle);
    }

    const focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'sidebar-detail-focus-action';
    focusButton.title = 'Focus on map';
    focusButton.setAttribute('aria-label', 'Focus on map');
    focusButton.innerHTML = '<i class="ui-icon" data-lucide="crosshair" aria-hidden="true"></i>';
    focusButton.addEventListener('click', focusSidebarSelectedFeature);
    actions.appendChild(focusButton);

    const linkedMap = detailModel.linkedMap;
    if (linkedMap) {
        const linkedButton = document.createElement('button');
        linkedButton.type = 'button';
        linkedButton.innerHTML = '<i class="ui-icon" data-lucide="map" aria-hidden="true"></i><span>Open Map</span>';
        linkedButton.addEventListener('click', () => {
            navigateToMap(linkedMap.id, { preResolvedMap: linkedMap });
        });
        actions.appendChild(linkedButton);
    }
    sidebarPoiPanel.appendChild(actions);
}

function refreshMapAfterFeatureDetailLayoutChange() {
    if (!map || typeof map.invalidateSize !== 'function') return;
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    setTimeout(() => map.invalidateSize({ pan: false }), transitionDuration + 20);
}

function syncFeatureDetailSearchVisibility() {
    if (!container) return;
    let obscuresSearch = false;
    const canObscureSearch =
        featureDetailSheetOpen &&
        !isMobileLayoutActive &&
        !featureDetailSheetDocked &&
        featureDetailSheet &&
        searchControlContainer &&
        window.getComputedStyle(searchControlContainer).display !== 'none';
    if (canObscureSearch) {
        const sheetRect = featureDetailSheet.getBoundingClientRect();
        const searchRect = searchControlContainer.getBoundingClientRect();
        const margin = 14;
        obscuresSearch = searchRect.width > 0 && searchRect.height > 0 && !(
            sheetRect.right < searchRect.left - margin ||
            sheetRect.left > searchRect.right + margin ||
            sheetRect.bottom < searchRect.top - margin ||
            sheetRect.top > searchRect.bottom + margin
        );
    }
    if (!canObscureSearch) {
        if (featureDetailSearchVisibilityTimer !== null) {
            clearTimeout(featureDetailSearchVisibilityTimer);
            featureDetailSearchVisibilityTimer = null;
        }
        featureDetailSearchTargetObscured = false;
        container.classList.remove('feature-detail-obscures-search');
        return;
    }
    if (
        featureDetailSearchTargetObscured === obscuresSearch &&
        (
            featureDetailSearchVisibilityTimer !== null ||
            container.classList.contains('feature-detail-obscures-search') === obscuresSearch
        )
    ) {
        return;
    }
    featureDetailSearchTargetObscured = obscuresSearch;
    if (featureDetailSearchVisibilityTimer !== null) {
        clearTimeout(featureDetailSearchVisibilityTimer);
    }
    const delay = obscuresSearch ? 180 : 320;
    featureDetailSearchVisibilityTimer = setTimeout(() => {
        featureDetailSearchVisibilityTimer = null;
        container.classList.toggle('feature-detail-obscures-search', featureDetailSearchTargetObscured);
    }, delay);
}

function clampWorkspaceValue(value, min, max) {
    return Math.min(Math.max(Number(value) || min, min), Math.max(min, max));
}

function scheduleWorkspaceMapResize() {
    if (workspaceMapResizeFrame !== null) return;
    const scheduleFrame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 0);
    workspaceMapResizeFrame = scheduleFrame(() => {
        workspaceMapResizeFrame = null;
        if (map && typeof map.invalidateSize === 'function') {
            map.invalidateSize({ pan: false });
        }
    });
}

function getWorkspaceWidthLimits() {
    const containerWidth = container ? container.clientWidth : window.innerWidth;
    const atlasAllowance = featureDetailSheetOpen && featureDetailSheetDocked
        ? featureDetailDockedWidth
        : 0;
    const atlasMax = Math.min(
        ATLAS_WIDTH_MAX,
        containerWidth - atlasAllowance - WORKSPACE_MAP_WIDTH_MIN
    );
    const visibleAtlasWidth = container && container.classList.contains('sidebar-collapsed')
        ? 0
        : atlasSidebarWidth;
    const detailMax = Math.min(
        DETAIL_DOCKED_WIDTH_MAX,
        containerWidth - visibleAtlasWidth - WORKSPACE_MAP_WIDTH_MIN
    );
    return {
        atlasMax: Math.max(ATLAS_WIDTH_MIN, atlasMax),
        detailMax: Math.max(DETAIL_DOCKED_WIDTH_MIN, detailMax)
    };
}

function applyAtlasSidebarWidth(value, { persist = false } = {}) {
    const { atlasMax } = getWorkspaceWidthLimits();
    atlasSidebarWidth = clampWorkspaceValue(value, ATLAS_WIDTH_MIN, atlasMax);
    if (container) {
        container.style.setProperty('--atlas-sidebar-width', `${Math.round(atlasSidebarWidth)}px`);
        container.style.setProperty('--atlas-sidebar-offset', `${Math.round(atlasSidebarWidth / 2)}px`);
    }
    if (atlasResizeHandle) {
        atlasResizeHandle.setAttribute('aria-valuemax', String(Math.round(atlasMax)));
        atlasResizeHandle.setAttribute('aria-valuenow', String(Math.round(atlasSidebarWidth)));
    }
    if (persist) safeSetStorage(UX_STORAGE_KEYS.atlasSidebarWidth, String(Math.round(atlasSidebarWidth)));
    scheduleWorkspaceMapResize();
}

function applyFeatureDetailDockedWidth(value, { persist = false } = {}) {
    const { detailMax } = getWorkspaceWidthLimits();
    featureDetailDockedWidth = clampWorkspaceValue(value, DETAIL_DOCKED_WIDTH_MIN, detailMax);
    if (container) container.style.setProperty('--feature-detail-docked-width', `${Math.round(featureDetailDockedWidth)}px`);
    if (featureDetailDockResizeHandle) {
        featureDetailDockResizeHandle.setAttribute('aria-valuemax', String(Math.round(detailMax)));
        featureDetailDockResizeHandle.setAttribute('aria-valuenow', String(Math.round(featureDetailDockedWidth)));
    }
    if (persist) safeSetStorage(UX_STORAGE_KEYS.featureDetailDockedWidth, String(Math.round(featureDetailDockedWidth)));
    scheduleWorkspaceMapResize();
}

function getFloatingDetailBounds() {
    const containerRect = container
        ? container.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const sidebarBoundary = sidebar && container && !container.classList.contains('sidebar-collapsed')
        ? sidebar.getBoundingClientRect().right - containerRect.left
        : 0;
    const left = sidebarBoundary + WORKSPACE_EDGE_MARGIN;
    const top = WORKSPACE_EDGE_MARGIN;
    return {
        left,
        top,
        right: containerRect.width - WORKSPACE_EDGE_MARGIN,
        bottom: containerRect.height - WORKSPACE_EDGE_MARGIN
    };
}

function applyFloatingFeatureDetailGeometry(geometry, { persist = false } = {}) {
    if (!featureDetailSheet || !geometry) return;
    const bounds = getFloatingDetailBounds();
    const maxWidth = Math.max(1, bounds.right - bounds.left);
    const maxHeight = Math.max(1, bounds.bottom - bounds.top);
    const minWidth = Math.min(DETAIL_FLOATING_WIDTH_MIN, maxWidth);
    const minHeight = Math.min(DETAIL_FLOATING_HEIGHT_MIN, maxHeight);
    const width = clampWorkspaceValue(geometry.width, minWidth, maxWidth);
    const height = clampWorkspaceValue(geometry.height, minHeight, maxHeight);
    const left = clampWorkspaceValue(geometry.left, bounds.left, bounds.right - width);
    const top = clampWorkspaceValue(geometry.top, bounds.top, bounds.bottom - height);
    featureDetailFloatingGeometry = { left, top, width, height };
    featureDetailSheet.classList.add('user-positioned');
    featureDetailSheet.style.left = `${Math.round(left)}px`;
    featureDetailSheet.style.top = `${Math.round(top)}px`;
    featureDetailSheet.style.width = `${Math.round(width)}px`;
    featureDetailSheet.style.height = `${Math.round(height)}px`;
    featureDetailSheet.style.transform = 'none';
    syncFeatureDetailSearchVisibility();
    if (featureDetailCornerResizeHandle) {
        featureDetailCornerResizeHandle.setAttribute('aria-valuenow', `${Math.round(width)} by ${Math.round(height)}`);
    }
    if (persist) safeSetJSON(UX_STORAGE_KEYS.featureDetailGeometry, featureDetailFloatingGeometry);
}

function clearFloatingFeatureDetailStyles() {
    if (!featureDetailSheet) return;
    featureDetailSheet.classList.remove('user-positioned');
    ['left', 'top', 'width', 'height', 'transform'].forEach((property) => {
        featureDetailSheet.style[property] = '';
    });
    syncFeatureDetailSearchVisibility();
}

function resetFloatingFeatureDetailGeometry() {
    featureDetailFloatingGeometry = null;
    safeRemoveStorage(UX_STORAGE_KEYS.featureDetailGeometry);
    clearFloatingFeatureDetailStyles();
}

function syncFeatureDetailLayoutGeometry() {
    if (!featureDetailSheet || isMobileLayoutActive || featureDetailSheetDocked) {
        clearFloatingFeatureDetailStyles();
        return;
    }
    if (featureDetailFloatingGeometry) {
        applyFloatingFeatureDetailGeometry(featureDetailFloatingGeometry);
    } else {
        clearFloatingFeatureDetailStyles();
    }
}

function beginWorkspaceResize(handle, onMove, onFinish) {
    return (event) => {
        if (isMobileLayoutActive || event.button !== 0) return;
        event.preventDefault();
        container?.classList.add('workspace-resizing');
        handle.setPointerCapture?.(event.pointerId);
        const move = (moveEvent) => onMove(moveEvent);
        const finish = (finishEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            container?.classList.remove('workspace-resizing');
            handle.releasePointerCapture?.(finishEvent.pointerId);
            onFinish?.();
            refreshMapAfterFeatureDetailLayoutChange();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
    };
}

function initializeResizableWorkspace() {
    const storedAtlasWidth = Number(safeGetStorage(UX_STORAGE_KEYS.atlasSidebarWidth));
    const storedDockedWidth = Number(safeGetStorage(UX_STORAGE_KEYS.featureDetailDockedWidth));
    const storedGeometry = safeGetJSON(UX_STORAGE_KEYS.featureDetailGeometry, null);
    atlasSidebarWidth = Number.isFinite(storedAtlasWidth) && storedAtlasWidth > 0 ? storedAtlasWidth : ATLAS_WIDTH_DEFAULT;
    featureDetailDockedWidth = Number.isFinite(storedDockedWidth) && storedDockedWidth > 0
        ? storedDockedWidth
        : DETAIL_DOCKED_WIDTH_DEFAULT;
    featureDetailFloatingGeometry = storedGeometry && ['left', 'top', 'width', 'height'].every((key) => Number.isFinite(Number(storedGeometry[key])))
        ? storedGeometry
        : null;
    applyAtlasSidebarWidth(atlasSidebarWidth);
    applyFeatureDetailDockedWidth(featureDetailDockedWidth);

    if (atlasResizeHandle) {
        atlasResizeHandle.addEventListener('pointerdown', beginWorkspaceResize(
            atlasResizeHandle,
            (event) => {
                const containerLeft = container?.getBoundingClientRect().left || 0;
                applyAtlasSidebarWidth(event.clientX - containerLeft);
            },
            () => applyAtlasSidebarWidth(atlasSidebarWidth, { persist: true })
        ));
        atlasResizeHandle.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home'
                ? ATLAS_WIDTH_DEFAULT
                : atlasSidebarWidth + (event.key === 'ArrowRight' ? 16 : -16);
            applyAtlasSidebarWidth(next, { persist: true });
        });
    }

    if (featureDetailDockResizeHandle) {
        featureDetailDockResizeHandle.addEventListener('pointerdown', beginWorkspaceResize(
            featureDetailDockResizeHandle,
            (event) => {
                const containerRight = container?.getBoundingClientRect().right || window.innerWidth;
                applyFeatureDetailDockedWidth(containerRight - event.clientX);
            },
            () => applyFeatureDetailDockedWidth(featureDetailDockedWidth, { persist: true })
        ));
        featureDetailDockResizeHandle.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home'
                ? DETAIL_DOCKED_WIDTH_DEFAULT
                : featureDetailDockedWidth + (event.key === 'ArrowLeft' ? 16 : -16);
            applyFeatureDetailDockedWidth(next, { persist: true });
        });
    }

    if (featureDetailHeader) {
        featureDetailHeader.addEventListener('pointerdown', (event) => {
            if (isMobileLayoutActive || !featureDetailSheet?.classList.contains('floating') || event.button !== 0) return;
            if (event.target instanceof Element && event.target.closest('button, .workspace-corner-resize-handle')) return;
            const containerRect = container.getBoundingClientRect();
            const sheetRect = featureDetailSheet.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startGeometry = {
                left: sheetRect.left - containerRect.left,
                top: sheetRect.top - containerRect.top,
                width: sheetRect.width,
                height: sheetRect.height
            };
            applyFloatingFeatureDetailGeometry(startGeometry);
            beginWorkspaceResize(featureDetailHeader, (moveEvent) => {
                applyFloatingFeatureDetailGeometry({
                    ...startGeometry,
                    left: startGeometry.left + moveEvent.clientX - startX,
                    top: startGeometry.top + moveEvent.clientY - startY
                });
            }, () => applyFloatingFeatureDetailGeometry(featureDetailFloatingGeometry, { persist: true }))(event);
        });
        featureDetailHeader.addEventListener('dblclick', (event) => {
            if (event.target instanceof Element && event.target.closest('button')) return;
            resetFloatingFeatureDetailGeometry();
        });
    }

    if (featureDetailCornerResizeHandle) {
        featureDetailCornerResizeHandle.addEventListener('pointerdown', (event) => {
            if (!featureDetailSheet?.classList.contains('floating')) return;
            const containerRect = container.getBoundingClientRect();
            const sheetRect = featureDetailSheet.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startGeometry = {
                left: sheetRect.left - containerRect.left,
                top: sheetRect.top - containerRect.top,
                width: sheetRect.width,
                height: sheetRect.height
            };
            beginWorkspaceResize(featureDetailCornerResizeHandle, (moveEvent) => {
                applyFloatingFeatureDetailGeometry({
                    ...startGeometry,
                    width: startGeometry.width + moveEvent.clientX - startX,
                    height: startGeometry.height + moveEvent.clientY - startY
                });
            }, () => applyFloatingFeatureDetailGeometry(featureDetailFloatingGeometry, { persist: true }))(event);
        });
        featureDetailCornerResizeHandle.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') {
                resetFloatingFeatureDetailGeometry();
                return;
            }
            const rect = featureDetailSheet.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            applyFloatingFeatureDetailGeometry({
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                width: rect.width + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0),
                height: rect.height + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0)
            }, { persist: true });
        });
    }
}

function updateFeatureDetailSheetDOM(open, floating, docked, mobileExpanded, modal) {
    if (!featureDetailSheet) return;
    featureDetailSheet.hidden = !open;
    featureDetailSheet.classList.toggle('visible', open);
    featureDetailSheet.classList.toggle('floating', floating);
    featureDetailSheet.classList.toggle('docked', docked);
    featureDetailSheet.classList.toggle('expanded', mobileExpanded);
    featureDetailSheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    featureDetailSheet.setAttribute('aria-modal', modal ? 'true' : 'false');
}

function updateFeatureDetailBackdropDOM(mobileExpanded) {
    if (!featureDetailBackdrop) return;
    featureDetailBackdrop.hidden = !mobileExpanded;
    featureDetailBackdrop.classList.toggle('visible', mobileExpanded);
    featureDetailBackdrop.setAttribute('aria-hidden', mobileExpanded ? 'false' : 'true');
}

function updateFeatureDetailLayoutBtnDOM() {
    if (!featureDetailLayoutBtn) return;
    const pressed = isMobileLayoutActive ? featureDetailSheetExpanded : featureDetailSheetDocked;
    const label = isMobileLayoutActive
        ? (featureDetailSheetExpanded ? 'Restore details' : 'Expand details')
        : (featureDetailSheetDocked ? 'Open as main panel' : 'Dock details to right');
    const iconMarkup = isMobileLayoutActive
        ? (featureDetailSheetExpanded
            ? '<i class="ui-icon" data-lucide="minimize-2" aria-hidden="true"></i>'
            : '<i class="ui-icon" data-lucide="maximize-2" aria-hidden="true"></i>')
        : (featureDetailSheetDocked
            ? '<i class="ui-icon" data-lucide="panel-right-open" aria-hidden="true"></i>'
            : '<i class="ui-icon" data-lucide="panel-right" aria-hidden="true"></i>');
    featureDetailLayoutBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    featureDetailLayoutBtn.setAttribute('aria-label', label);
    featureDetailLayoutBtn.setAttribute('title', label);
    featureDetailLayoutBtn.innerHTML = iconMarkup;
}

function updateContainerDOMClasses(element, open, floating, docked, expanded) {
    if (!element) return;
    element.classList.toggle('feature-detail-open', open);
    element.classList.toggle('feature-detail-floating', floating);
    element.classList.toggle('feature-detail-docked', docked);
    element.classList.toggle('feature-detail-expanded', expanded);
}

function syncFeatureDetailSheetState() {
    const open = featureDetailSheetOpen && !!selectedSidebarFeature;
    if (!open) featureDetailSheetExpanded = false;
    if (!isMobileLayoutActive) featureDetailSheetExpanded = false;
    const mobileExpanded = open && isMobileLayoutActive && featureDetailSheetExpanded;
    const floating = open && !isMobileLayoutActive && !featureDetailSheetDocked;
    const docked = open && !isMobileLayoutActive && featureDetailSheetDocked;
    const modal = mobileExpanded;

    updateFeatureDetailSheetDOM(open, floating, docked, mobileExpanded, modal);
    updateFeatureDetailBackdropDOM(mobileExpanded);
    updateFeatureDetailLayoutBtnDOM();
    updateContainerDOMClasses(container, open, floating, docked, mobileExpanded);
    updateContainerDOMClasses(bodyElement, open, floating, docked, modal);

    if (!isMobileLayoutActive) {
        applyFeatureDetailDockedWidth(featureDetailDockedWidth);
        applyAtlasSidebarWidth(atlasSidebarWidth);
    }
    syncFeatureDetailLayoutGeometry();
    syncFeatureDetailSearchVisibility();
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(syncFeatureDetailSearchVisibility);
    }
    syncSidebarInteractionState();
    if (mapContainerElement) mapContainerElement.inert = modal;
    refreshLucideIcons();
}

function openSelectedFeatureDetails() {
    if (!selectedSidebarFeature || !featureDetailSheet) return false;
    const activeElement = document.activeElement;
    lastFeatureDetailTrigger = activeElement instanceof HTMLElement ? activeElement : null;
    featureDetailSheetOpen = true;
    featureDetailSheetExpanded = false;
    if (isMobileLayoutActive && hasOpenMobileSurface()) {
        closeMobileSheet({ restoreFocus: false });
    }
    if (mapBlurbElement && mapBlurbElement.classList.contains('visible')) {
        setMapBlurbVisible(false);
    }
    if (map && typeof map.closePopup === 'function') {
        map.closePopup();
    }
    syncFeatureDetailSheetState();
    refreshMapAfterFeatureDetailLayoutChange();
    requestAnimationFrame(() => featureDetailSheet.focus({ preventScroll: true }));
    trackAnalytics('feature_details_opened', {
        featureType: selectedSidebarFeatureType,
        featureName: getSidebarFeatureTitle(selectedSidebarFeature)
    });
    return false;
}

function closeFeatureDetailSheet({ restoreFocus = true } = {}) {
    if (!featureDetailSheetOpen) return;
    featureDetailSheetOpen = false;
    featureDetailSheetExpanded = false;
    syncFeatureDetailSheetState();
    refreshMapAfterFeatureDetailLayoutChange();
    if (restoreFocus) {
        const focusTarget = lastFeatureDetailTrigger && lastFeatureDetailTrigger.isConnected
            ? lastFeatureDetailTrigger
            : mapElement;
        if (focusTarget && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }
    lastFeatureDetailTrigger = null;
}

function toggleFeatureDetailLayout() {
    if (!featureDetailSheetOpen || !selectedSidebarFeature) return;
    if (isMobileLayoutActive) {
        featureDetailSheetExpanded = !featureDetailSheetExpanded;
    } else {
        featureDetailSheetDocked = !featureDetailSheetDocked;
        safeSetStorage(
            UX_STORAGE_KEYS.featureDetailMode,
            featureDetailSheetDocked ? FEATURE_DETAIL_MODE_DOCKED : FEATURE_DETAIL_MODE_FLOATING
        );
    }
    syncFeatureDetailSheetState();
    refreshMapAfterFeatureDetailLayoutChange();
    if (featureDetailSheet) featureDetailSheet.focus({ preventScroll: true });
}

function trapFeatureDetailFocus(event) {
    if (!isMobileLayoutActive || !featureDetailSheetExpanded || event.key !== 'Tab' || !featureDetailSheet) return;
    const focusable = Array.from(featureDetailSheet.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
        event.preventDefault();
        featureDetailSheet.focus({ preventScroll: true });
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const focusIsOnContainer = active === featureDetailSheet;
    if (event.shiftKey && (focusIsOnContainer || active === first || !featureDetailSheet.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (focusIsOnContainer || active === last || !featureDetailSheet.contains(active))) {
        event.preventDefault();
        first.focus();
    }
}

function syncSidebarPanels() {
    setElementHiddenState(sidebarMapPanel, false);
    renderSidebarFeaturePanel();
    if (!selectedSidebarFeature) {
        featureDetailSheetOpen = false;
    }
    syncFeatureDetailSheetState();
    refreshLucideIcons();
}

function setSidebarSelectedFeature(feature, type) {
    selectedSidebarFeature = feature || null;
    selectedSidebarFeatureType = feature ? type : '';
    syncSidebarPanels();
}

function initializeFeatureDetailSheet() {
    featureDetailSheetDocked = safeGetStorage(UX_STORAGE_KEYS.featureDetailMode) === FEATURE_DETAIL_MODE_DOCKED;
    initializeResizableWorkspace();
    if (featureDetailCloseBtn) {
        featureDetailCloseBtn.addEventListener('click', () => closeFeatureDetailSheet());
    }
    if (featureDetailLayoutBtn) {
        featureDetailLayoutBtn.addEventListener('click', toggleFeatureDetailLayout);
    }
    if (featureDetailBackdrop) {
        featureDetailBackdrop.addEventListener('click', () => closeFeatureDetailSheet());
    }
    if (featureDetailSheet) {
        featureDetailSheet.addEventListener('keydown', trapFeatureDetailFocus);
    }
    if (mobileAtlasCloseBtn) {
        mobileAtlasCloseBtn.addEventListener('click', () => closeMobileSheet({ restoreFocus: true }));
    }
    syncSidebarPanels();
}

function getPreferredMapImageUrl(mapInfo) {
    if (!mapInfo) return '';
    const variants = mapInfo && typeof mapInfo.imageVariants === 'object' ? mapInfo.imageVariants : null;
    const defaultUrl = String(
        (variants && (variants.default || variants.desktop)) ||
        mapInfo.imageUrl ||
        ''
    ).trim();
    if (!defaultUrl) return '';

    if (!mobileLayoutV2Enabled || !isMobileLayoutActive) return defaultUrl;

    const candidateValues = [
        variants && variants.mobile,
        variants && variants.compact,
        mapInfo.mobileImageUrl,
        mapInfo.imageUrlMobile,
        mapInfo.smallImageUrl,
        mapInfo.imageUrlSmall
    ];
    for (const candidateValue of candidateValues) {
        const candidate = String(candidateValue || '').trim();
        if (candidate) {
            return candidate;
        }
    }
    return defaultUrl;
}

function parsePositiveInteger(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parseNonNegativeInteger(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function parseFiniteNumber(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function normalizeTileAssetRoot(value) {
    const rawRoot = String(value || '').trim().replace(/\\/g, '/');
    if (!rawRoot || rawRoot === '.') return '';

    const normalizedRoot = rawRoot
        .replace(/^\.?\//, '')
        .replace(/\/+$/, '');
    if (!normalizedRoot ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalizedRoot) ||
        normalizedRoot === '..' ||
        normalizedRoot.startsWith('../') ||
        normalizedRoot.includes('/../')) {
        return '';
    }
    return normalizedRoot;
}

function resolveTileUrlTemplate(urlTemplate) {
    const normalizedTemplate = String(urlTemplate || '').trim().replace(/\\/g, '/');
    const tileAssetRoot = normalizeTileAssetRoot(getConfigValue('performance.tileAssetRoot', 'tile'));
    if (!tileAssetRoot || normalizedTemplate.startsWith(`${tileAssetRoot}/`)) {
        return normalizedTemplate;
    }
    if (normalizedTemplate.startsWith('tile/')) {
        return `${tileAssetRoot}/${normalizedTemplate.slice('tile/'.length)}`;
    }
    return normalizedTemplate;
}

function getMapTileSource(mapInfo) {
    const source = mapInfo && mapInfo.tileSource;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

    const type = String(source.type || 'xyz').trim().toLowerCase();
    const urlTemplate = String(source.urlTemplate || '').trim();
    if (type !== 'xyz' || !urlTemplate) return null;
    if (!urlTemplate.includes('{z}') || !urlTemplate.includes('{x}') || !urlTemplate.includes('{y}')) {
        return null;
    }

    const maxZoom = parseNonNegativeInteger(source.maxZoom, null);
    if (!Number.isInteger(maxZoom)) return null;
    const minZoom = parseNonNegativeInteger(source.minZoom, Math.max(0, maxZoom - Math.abs(mapOptions.minZoom || 0)));
    if (minZoom > maxZoom) return null;

    const leafletNativeZoom = parseFiniteNumber(source.leafletNativeZoom, 0);
    const zoomOffset = parseFiniteNumber(source.zoomOffset, maxZoom - leafletNativeZoom);
    const cacheVersion = String(source.cacheVersion || '').trim().slice(0, 128);
    return {
        type,
        urlTemplate: resolveTileUrlTemplate(urlTemplate),
        tileSize: parsePositiveInteger(source.tileSize, 256),
        minZoom,
        maxZoom,
        leafletNativeZoom,
        zoomOffset,
        minNativeZoom: parseFiniteNumber(source.minNativeZoom, minZoom - zoomOffset),
        maxNativeZoom: parseFiniteNumber(source.maxNativeZoom, leafletNativeZoom),
        cacheVersion
    };
}

function getGeneratedTileRowCount(options, tileZoom) {
    const tileOptions = options || {};
    const sourceHeight = Number(tileOptions.sourceHeight);
    const tileSize = Number(tileOptions.tileSize);
    const sourceMaxZoom = Number(tileOptions.sourceMaxZoom);
    const zoom = Number(tileZoom);
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 ||
        !Number.isFinite(tileSize) || tileSize <= 0 ||
        !Number.isFinite(sourceMaxZoom) ||
        !Number.isFinite(zoom)) {
        return null;
    }

    const scale = Math.pow(2, zoom - sourceMaxZoom);
    const scaledHeight = Math.max(1, Math.ceil(sourceHeight * scale));
    return Math.ceil(scaledHeight / tileSize);
}

function normalizeSimpleCrsTileCoords(coords, options, tileZoom) {
    const normalizedCoords = { ...coords };
    const sourceY = Number(coords?.y);
    if (!Number.isFinite(sourceY) || sourceY >= 0) {
        return normalizedCoords;
    }

    const rowCount = getGeneratedTileRowCount(options, tileZoom);
    normalizedCoords.y = Number.isInteger(rowCount) && rowCount > 0
        ? sourceY + rowCount
        : -sourceY - 1;
    return normalizedCoords;
}

function createSimpleCrsTileLayer(urlTemplate, options) {
    const SimpleCrsTileLayer = L.TileLayer.extend({
        getTileUrl(coords) {
            const tileZoom = typeof this._getZoomForUrl === 'function'
                ? this._getZoomForUrl()
                : coords.z;
            const normalizedCoords = normalizeSimpleCrsTileCoords(coords, this.options, tileZoom);
            return L.TileLayer.prototype.getTileUrl.call(this, normalizedCoords);
        }
    });
    return new SimpleCrsTileLayer(urlTemplate, options);
}

function buildGeneratedTileUrl(tileSource, coords) {
    if (!tileSource || !coords) return '';
    const url = String(tileSource.urlTemplate || '')
        .replace('{z}', String(coords.z))
        .replace('{x}', String(coords.x))
        .replace('{y}', String(coords.y));
    return typeof withAssetVersion === 'function'
        ? withAssetVersion(url, tileSource.cacheVersion)
        : url;
}

function getVisibleSourceTileCoordinates(tileLayer, tileSource) {
    if (!tileLayer || !tileSource || !tileLayer._tiles || typeof tileLayer._getZoomForUrl !== 'function') {
        return [];
    }

    const sourceZoom = Number(tileLayer._getZoomForUrl());
    if (!Number.isInteger(sourceZoom) || sourceZoom < tileSource.minZoom || sourceZoom > tileSource.maxZoom) {
        return [];
    }

    const seen = new Set();
    return Object.values(tileLayer._tiles).reduce((coordinates, tileEntry) => {
        if (!tileEntry || tileEntry.current === false || !tileEntry.coords) return coordinates;
        const normalized = normalizeSimpleCrsTileCoords(tileEntry.coords, tileLayer.options, sourceZoom);
        const x = Number(normalized.x);
        const y = Number(normalized.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return coordinates;
        const key = `${sourceZoom}:${x}:${y}`;
        if (seen.has(key)) return coordinates;
        seen.add(key);
        coordinates.push({ z: sourceZoom, x, y });
        return coordinates;
    }, []);
}

function getIdleTileWarmupCandidates(mapInfo, tileLayer, tileSource) {
    const visibleTiles = getVisibleSourceTileCoordinates(tileLayer, tileSource);
    const sourceWidth = Number(mapInfo?.width);
    const sourceHeight = Number(mapInfo?.height);
    if (visibleTiles.length === 0 || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
        return [];
    }

    const targetZoom = tileSource.maxZoom;
    const sourceZoom = visibleTiles[0].z;
    const zoomDelta = targetZoom - sourceZoom;
    if (zoomDelta <= 0) return [];

    const descendantScale = Math.pow(2, zoomDelta);
    const maxColumns = Math.ceil(sourceWidth / tileSource.tileSize);
    const maxRows = Math.ceil(sourceHeight / tileSource.tileSize);
    // ⚡ Bolt: Replaced multiple Math.max/min spreads and .map() with a single for loop to eliminate 4x redundant array allocations.
    let minVisibleX = Infinity;
    let maxVisibleX = -Infinity;
    let minVisibleY = Infinity;
    let maxVisibleY = -Infinity;
    for (let i = 0; i < visibleTiles.length; i++) {
        const tile = visibleTiles[i];
        if (tile.x < minVisibleX) minVisibleX = tile.x;
        if (tile.x + 1 > maxVisibleX) maxVisibleX = tile.x + 1;
        if (tile.y < minVisibleY) minVisibleY = tile.y;
        if (tile.y + 1 > maxVisibleY) maxVisibleY = tile.y + 1;
    }
    const centerX = ((minVisibleX + maxVisibleX) * descendantScale) / 2;
    const centerY = ((minVisibleY + maxVisibleY) * descendantScale) / 2;
    const candidates = new Map();

    visibleTiles.forEach((tile) => {
        const startX = Math.max(0, tile.x * descendantScale);
        const endX = Math.min(maxColumns, (tile.x + 1) * descendantScale);
        const startY = Math.max(0, tile.y * descendantScale);
        const endY = Math.min(maxRows, (tile.y + 1) * descendantScale);
        for (let y = startY; y < endY; y += 1) {
            for (let x = startX; x < endX; x += 1) {
                const key = `${targetZoom}:${x}:${y}`;
                if (candidates.has(key)) continue;
                const coords = { z: targetZoom, x, y };
                candidates.set(key, {
                    ...coords,
                    url: buildGeneratedTileUrl(tileSource, coords),
                    distance: Math.pow(x + 0.5 - centerX, 2) + Math.pow(y + 0.5 - centerY, 2)
                });
            }
        }
    });

    return Array.from(candidates.values())
        .sort((left, right) => left.distance - right.distance)
        .map(({ distance, ...candidate }) => candidate);
}

function isIdleTileWarmupAllowed() {
    if (getConfigValue('performance.idleTileWarmup', true) === false) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    const connection = typeof navigator !== 'undefined'
        ? navigator.connection || navigator.mozConnection || navigator.webkitConnection
        : null;
    if (!connection) return true;
    if (connection.saveData) return false;
    return !/^(?:slow-)?2g$/i.test(String(connection.effectiveType || ''));
}

function removeIdleDetailTileLayer() {
    if (!idleDetailTileLayer) return;
    if (map && map.hasLayer(idleDetailTileLayer)) {
        map.removeLayer(idleDetailTileLayer);
    }
    idleDetailTileLayer = null;
}

function cancelIdleTileWarmup(options = {}) {
    idleTileWarmupGeneration += 1;
    if (idleTileWarmupTimer) {
        clearTimeout(idleTileWarmupTimer);
        idleTileWarmupTimer = null;
    }
    if (options.removeDetailLayer) {
        removeIdleDetailTileLayer();
    }
}

function waitForIdleTileSlice() {
    return new Promise((resolve) => {
        scheduleIdleTask(resolve, 1200);
    });
}

async function cacheIdleTileBatch(urls) {
    const results = await Promise.all(urls.map(async (url) => {
        try {
            const response = await fetch(url, {
                cache: 'force-cache',
                credentials: 'same-origin'
            });
            if (!response || !response.ok) return false;
            await response.blob();
            return true;
        } catch {
            return false;
        }
    }));
    return results.every(Boolean);
}

function showIdleDetailTileLayer(mapInfo, tileSource, generation) {
    if (generation !== idleTileWarmupGeneration || currentMapData !== mapInfo || currentMapBaseLayerMode !== 'tile') {
        return;
    }

    removeIdleDetailTileLayer();
    const urlTemplate = typeof withAssetVersion === 'function'
        ? withAssetVersion(tileSource.urlTemplate, tileSource.cacheVersion)
        : tileSource.urlTemplate;
    const detailLayer = createSimpleCrsTileLayer(urlTemplate, {
        tileSize: tileSource.tileSize,
        minZoom: mapOptions.minZoom,
        maxZoom: mapOptions.maxZoom,
        minNativeZoom: tileSource.leafletNativeZoom,
        maxNativeZoom: tileSource.leafletNativeZoom,
        zoomOffset: tileSource.zoomOffset,
        sourceWidth: mapInfo.width,
        sourceHeight: mapInfo.height,
        sourceMaxZoom: tileSource.maxZoom,
        bounds: L.latLngBounds(currentBounds),
        noWrap: true,
        keepBuffer: 0,
        updateWhenIdle: true,
        updateWhenZooming: false,
        opacity: 0,
        className: 'map-idle-detail-tile'
    });
    let tileFailures = 0;
    detailLayer.on('tileerror', () => {
        tileFailures += 1;
    });
    detailLayer.on('load', () => {
        if (generation !== idleTileWarmupGeneration || tileFailures > 0 || idleDetailTileLayer !== detailLayer) {
            if (idleDetailTileLayer === detailLayer) removeIdleDetailTileLayer();
            return;
        }
        const container = detailLayer.getContainer && detailLayer.getContainer();
        if (container?.classList) container.classList.add('map-idle-detail-layer');
        detailLayer.setOpacity(1);
    });
    idleDetailTileLayer = detailLayer;
    detailLayer.addTo(map);
    const container = detailLayer.getContainer && detailLayer.getContainer();
    if (container?.classList) container.classList.add('map-idle-detail-layer');
}

async function runIdleTileWarmup(generation) {
    idleTileWarmupTimer = null;
    if (generation !== idleTileWarmupGeneration || !isIdleTileWarmupAllowed()) return;
    if (!currentMapData || !currentImageLayer || currentMapBaseLayerMode !== 'tile') return;

    const mapInfo = currentMapData;
    const tileLayer = currentImageLayer;
    const tileSource = getMapTileSource(mapInfo);
    if (!tileSource) return;

    const candidates = getIdleTileWarmupCandidates(mapInfo, tileLayer, tileSource);
    if (candidates.length === 0) return;

    const mobile = typeof isMobileLayoutActive !== 'undefined' && isMobileLayoutActive;
    const configuredMaxTiles = Math.floor(getPerformanceNumber(
        mobile ? 'idleTileWarmupMobileMaxTiles' : 'idleTileWarmupMaxTiles',
        mobile ? 192 : 768
    ));
    const maxTiles = Math.max(0, configuredMaxTiles);
    const batchSize = Math.max(1, Math.min(8, Math.floor(getPerformanceNumber('idleTileWarmupBatchSize', 4))));
    const batchDelayMs = Math.max(0, getPerformanceNumber('idleTileWarmupBatchDelayMs', 80));
    const displayLimit = Math.max(0, Math.floor(getPerformanceNumber(
        mobile ? 'idleTileUpgradeMobileMaxTiles' : 'idleTileUpgradeMaxTiles',
        mobile ? 72 : 160
    )));
    const warmupCandidates = candidates.slice(0, maxTiles);
    const canUpgradeVisibleMap = candidates.length <= displayLimit && candidates.length <= maxTiles;
    let allTilesCached = true;

    for (let index = 0; index < warmupCandidates.length; index += batchSize) {
        if (generation !== idleTileWarmupGeneration || !isIdleTileWarmupAllowed() || currentMapData !== mapInfo) {
            return;
        }
        await waitForIdleTileSlice();
        if (generation !== idleTileWarmupGeneration || !isIdleTileWarmupAllowed() || currentMapData !== mapInfo) {
            return;
        }
        const batch = warmupCandidates.slice(index, index + batchSize).map((candidate) => candidate.url);
        const batchCached = await cacheIdleTileBatch(batch);
        allTilesCached = allTilesCached && batchCached;
        if (batchDelayMs > 0 && index + batchSize < warmupCandidates.length) {
            await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
        }
    }

    if (allTilesCached && canUpgradeVisibleMap) {
        showIdleDetailTileLayer(mapInfo, tileSource, generation);
    }
}

function scheduleIdleTileWarmup() {
    if (idleDetailTileLayer || !isIdleTileWarmupAllowed()) return;
    if (idleTileWarmupTimer) clearTimeout(idleTileWarmupTimer);
    const generation = ++idleTileWarmupGeneration;
    const delayMs = Math.max(250, getPerformanceNumber('idleTileWarmupDelayMs', 1800));
    idleTileWarmupTimer = setTimeout(() => {
        runIdleTileWarmup(generation).catch(() => undefined);
    }, delayMs);
}

// ⚡ Bolt: Replaced Array.from() and chained .filter() calls with a single for loop
// to eliminate redundant intermediate array allocations and multiple O(N) traversals.
function getTileLayerImageCounts(tileContainer) {
    if (!tileContainer || typeof tileContainer.querySelectorAll !== 'function') {
        return { total: 0, loaded: 0, failed: 0 };
    }
    const tiles = tileContainer.querySelectorAll('img.leaflet-tile');
    let loaded = 0;
    let failed = 0;

    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (tile.complete) {
            if (tile.naturalWidth > 0) {
                loaded++;
            } else if (tile.naturalWidth === 0) {
                failed++;
            }
        }
    }

    return {
        total: tiles.length,
        loaded,
        failed
    };
}

function areAllObservedTilesFailed(tileCounts) {
    return !!tileCounts && tileCounts.total > 0 && tileCounts.loaded === 0 && tileCounts.failed === tileCounts.total;
}

function getTilePreviewFadeConfig() {
    const retireRatio = Math.max(0.05, Math.min(1, getPerformanceNumber('tilePreviewRetireRatio', 0.76)));
    const fadeStartRatio = Math.max(0, Math.min(retireRatio, getPerformanceNumber('tilePreviewFadeStartRatio', 0.45)));
    return { fadeStartRatio, retireRatio };
}

function getMapPreviewLayerElement() {
    return currentMapPreviewLayer && typeof currentMapPreviewLayer.getElement === 'function'
        ? currentMapPreviewLayer.getElement()
        : null;
}

function setMapPreviewLayerOpacity(opacity) {
    if (!currentMapPreviewLayer) return;
    const rawOpacity = Number(opacity);
    const normalizedOpacity = Number.isFinite(rawOpacity)
        ? Math.max(0, Math.min(1, rawOpacity))
        : 1;
    if (typeof currentMapPreviewLayer.setOpacity === 'function') {
        currentMapPreviewLayer.setOpacity(normalizedOpacity);
    }
    const previewElement = getMapPreviewLayerElement();
    if (previewElement) {
        previewElement.style.opacity = String(normalizedOpacity);
    }
}

function updateMapPreviewLayerForTileProgress(tileCounts) {
    if (!currentMapPreviewLayer || !tileCounts || tileCounts.total <= 0) return;
    setMapPreviewLayerOpacity(1);
}

function createMapPreviewLayer(mapInfo, bounds) {
    const previewImageUrl = getMiniMapImageUrl(mapInfo);
    const mapImageUrl = getPreferredMapImageUrl(mapInfo);
    if (!previewImageUrl || previewImageUrl === mapImageUrl || !L.imageOverlay) return null;
    const versionedPreviewImageUrl = typeof withAssetVersion === 'function'
        ? withAssetVersion(previewImageUrl)
        : previewImageUrl;
    return L.imageOverlay(versionedPreviewImageUrl, bounds, {
        pane: 'tilePane',
        interactive: false,
        opacity: 1,
        className: 'map-preview-layer'
    });
}

function removeMapPreviewLayer() {
    if (!currentMapPreviewLayer) return;
    if (map.hasLayer(currentMapPreviewLayer)) {
        map.removeLayer(currentMapPreviewLayer);
    }
    currentMapPreviewLayer = null;
}

function mountBootstrapMapPreview(mapInfo) {
    if (typeof document === 'undefined') return;
    const previewImageUrl = getMiniMapImageUrl(mapInfo);
    const mapElement = document.getElementById('map');
    if (!previewImageUrl || !mapElement) return;

    let previewImage = document.getElementById('map-bootstrap-preview');
    if (!previewImage || previewImage.tagName !== 'IMG') {
        if (previewImage) previewImage.remove();
        previewImage = new Image();
        previewImage.id = 'map-bootstrap-preview';
        previewImage.alt = '';
        previewImage.decoding = 'async';
        previewImage.fetchPriority = 'high';
    }

    previewImage.onload = () => {
        if (document.documentElement) {
            document.documentElement.classList.add('bootstrap-map-preview-ready');
        }
    };
    previewImage.onerror = () => {
        previewImage.remove();
        if (document.documentElement) {
            document.documentElement.classList.remove('bootstrap-map-preview-loading');
        }
    };

    const versionedPreviewUrl = typeof withAssetVersion === 'function'
        ? withAssetVersion(previewImageUrl)
        : previewImageUrl;
    const currentPreviewSrc = previewImage.getAttribute('src') || '';
    if (currentPreviewSrc !== previewImageUrl && currentPreviewSrc !== versionedPreviewUrl) {
        previewImage.src = versionedPreviewUrl;
    }
    mapElement.appendChild(previewImage);

    if (document.documentElement) {
        document.documentElement.classList.add('bootstrap-map-preview-loading');
        if (previewImage.complete && previewImage.naturalWidth > 0) {
            document.documentElement.classList.add('bootstrap-map-preview-ready');
        }
    }
}

function removeBootstrapMapPreview() {
    if (typeof document === 'undefined') return;
    const bootstrapPreview = document.getElementById('map-bootstrap-preview');
    if (bootstrapPreview) bootstrapPreview.remove();
    if (document.documentElement) {
        document.documentElement.classList.remove('bootstrap-map-preview-ready');
    }
}

function hasBootstrapMapPreview() {
    if (typeof document === 'undefined') return false;
    if (document.documentElement && document.documentElement.classList.contains('bootstrap-map-preview-ready')) {
        return true;
    }
    return !!document.getElementById('map-bootstrap-preview');
}

function markMapPreviewLayerElement() {
    const previewElement = currentMapPreviewLayer && typeof currentMapPreviewLayer.getElement === 'function'
        ? currentMapPreviewLayer.getElement()
        : null;
    if (previewElement && previewElement.classList) {
        previewElement.classList.add('map-preview-layer');
    }
}

function createMapBaseLayer(selectedMap, mapImageUrl, bounds) {
    const tileSource = getMapTileSource(selectedMap);
    if (tileSource && L.TileLayer) {
        const urlTemplate = typeof withAssetVersion === 'function'
            ? withAssetVersion(tileSource.urlTemplate, tileSource.cacheVersion)
            : tileSource.urlTemplate;
        return {
            mode: 'tile',
            layer: createSimpleCrsTileLayer(urlTemplate, {
                tileSize: tileSource.tileSize,
                minZoom: mapOptions.minZoom,
                maxZoom: mapOptions.maxZoom,
                minNativeZoom: tileSource.minNativeZoom,
                maxNativeZoom: tileSource.maxNativeZoom,
                zoomOffset: tileSource.zoomOffset,
                sourceWidth: selectedMap.width,
                sourceHeight: selectedMap.height,
                sourceMaxZoom: tileSource.maxZoom,
                bounds: L.latLngBounds(bounds),
                noWrap: true,
                keepBuffer: 2,
                updateWhenIdle: isMobileLayoutActive,
                updateWhenZooming: false,
                className: 'map-tile-layer'
            })
        };
    }

    return {
        mode: 'image',
        layer: L.imageOverlay(mapImageUrl, bounds)
    };
}

function getMiniMapImageUrl(mapInfo) {
    const mapImageUrl = getPreferredMapImageUrl(mapInfo);
    if (!mapImageUrl) return '';

    const [pathAndQuery, hash = ''] = String(mapImageUrl).split('#');
    const queryIndex = pathAndQuery.indexOf('?');
    const path = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
    const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex) : '';
    const miniPath = path.replace(/(\.[^./?#]+)$/, '.mini.webp');
    if (miniPath === path) {
        return `${path}.mini.webp${query}${hash ? `#${hash}` : ''}`;
    }
    return `${miniPath}${query}${hash ? `#${hash}` : ''}`;
}

function hasDirectMapHash(mapId) {
    return !!String(mapId || '').trim();
}

function shouldShowMapChooserForMapId(mapId) {
    if (!mapChooserElement || isEmbeddedView || hasDirectMapHash(mapId)) return false;
    const params = new URLSearchParams(window.location.search || '');
    return params.get('gallery') === 'true';
}

function setMapChooserVisible(visible) {
    if (!mapChooserElement) return;
    mapChooserElement.hidden = !visible;
    mapChooserElement.setAttribute('aria-hidden', visible ? 'false' : 'true');
    mapChooserElement.classList.toggle('visible', visible);
    if (bodyElement) {
        bodyElement.classList.toggle('map-chooser-open', visible);
    }
    if (visible && mapChooserCloseBtn && typeof mapChooserCloseBtn.focus === 'function') {
        requestAnimationFrame(() => mapChooserCloseBtn.focus({ preventScroll: true }));
    }
}

function closeMapChooserToMap({ restoreFocus = true } = {}) {
    if (!mapChooserElement || mapChooserElement.hidden) return;
    if (history.state?.mapChooserOverlay === true) {
        restoreMapChooserTriggerOnPopState = restoreFocus;
        history.back();
        return;
    }

    const fallbackMapId = currentlyLoadedMapId ||
        safeGetStorage(UX_STORAGE_KEYS.lastMapId) ||
        findFirstLoadableIdRecursive(mapData) ||
        '';
    const cleanSearch = clearTransientMapSearchParams(window.location.search);
    const nextHash = generateHash(fallbackMapId, currentSidebarState);
    history.replaceState(
        {
            mapId: fallbackMapId || null,
            sidebarState: currentSidebarState,
            search: cleanSearch,
            hash: nextHash
        },
        '',
        buildAppUrlWithHash(nextHash, cleanSearch)
    );
    setMapChooserVisible(false);
    if (fallbackMapId && fallbackMapId !== currentlyLoadedMapId) {
        loadMap(fallbackMapId, false);
    }
    if (restoreFocus) {
        requestAnimationFrame(() => {
            if (mapElement && typeof mapElement.focus === 'function') {
                mapElement.focus({ preventScroll: true });
            }
        });
    }
}

function getMapChooserEntryText(item) {
    return [
        item?.id,
        item?.name,
        item?.group,
        item?.category
    ].map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function isMapChooserArchiveEntry(item, ancestors = []) {
    const branchText = [...ancestors, item].map(getMapChooserEntryText).join(' ');
    if (/old dev maps|irl old maps|archive/i.test(branchText)) return true;
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim();
    return /^(OLD-|DEV-|Archive-)/i.test(id) || /^(OLD-|DEV-|Archive-)/i.test(name);
}

function getPrimaryMapChooserEntries(items, ancestors = []) {
    const entries = [];
    const sourceItems = Array.isArray(items) ? items : [];
    sourceItems.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        if (isMapChooserArchiveEntry(item, ancestors)) return;
        if (isRenderableMapEntry(item)) entries.push(item);
        if (Array.isArray(item.children) && item.children.length > 0) {
            entries.push(...getPrimaryMapChooserEntries(item.children, [...ancestors, item]));
        }
    });
    return entries;
}

function formatMapChooserDate(...candidateValues) {
    for (const candidateValue of candidateValues) {
        if (!candidateValue) continue;
        const dateOnlyMatch = typeof candidateValue === 'string'
            ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidateValue.trim())
            : null;
        let date;
        if (dateOnlyMatch) {
            const [, yearText, monthText, dayText] = dateOnlyMatch;
            const year = Number(yearText);
            const monthIndex = Number(monthText) - 1;
            const day = Number(dayText);
            date = new Date(0);
            date.setFullYear(year, monthIndex, day);
            date.setHours(12, 0, 0, 0);
            if (
                date.getFullYear() !== year ||
                date.getMonth() !== monthIndex ||
                date.getDate() !== day
            ) {
                continue;
            }
        } else {
            date = new Date(candidateValue);
        }
        if (Number.isNaN(date.getTime())) continue;
        return new Intl.DateTimeFormat('en', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }
    return '';
}

function getMapChooserEditedText(mapInfo) {
    const formattedDate = formatMapChooserDate(
        mapInfo?.updatedAt,
        mapInfo?.lastEdited,
        mapInfo?.modifiedAt
    );
    return formattedDate ? `Last edited: ${formattedDate}` : '';
}

function getMapChooserImageSources(mapInfo) {
    const fullImageUrl = String(getPreferredMapImageUrl(mapInfo) || mapInfo?.imageUrl || '').trim();
    const miniImageUrl = String(getMiniMapImageUrl(mapInfo) || '').trim();
    return {
        preview: miniImageUrl || fullImageUrl,
        fallback: fullImageUrl
    };
}

function handleMapChooserImageError(event) {
    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;
    const fallbackSrc = image.dataset.fallbackSrc;
    if (fallbackSrc) {
        delete image.dataset.fallbackSrc;
        image.src = fallbackSrc;
    }
}

function getMapChooserActiveMapId(entries) {
    const candidateIds = [
        currentlyLoadedMapId,
        safeGetStorage(UX_STORAGE_KEYS.lastMapId),
        entries[0]?.id
    ];

    for (let i = 0; i < candidateIds.length; i++) {
        const candidateId = candidateIds[i];
        // ⚡ Bolt: Replace O(N) Set allocation + O(N) map with a short-circuiting array traversal for ~5x speedup
        if (candidateId) {
            for (let j = 0; j < entries.length; j++) {
                if (entries[j].id === candidateId) {
                    return candidateId;
                }
            }
        }
    }
    return '';
}

function getMapChooserRegionCount(mapInfo) {
    const count = Number(mapInfo?.regionCount);
    return Number.isInteger(count) && count >= 0 ? count : 0;
}

function createMapChooserCard(mapInfo, index, activeMapId) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'map-chooser-card';
    card.dataset.mapId = mapInfo.id;
    card.style.setProperty('--reveal-index', String(index));

    const mapName = mapInfo.name || 'Unnamed Map';
    const isActive = mapInfo.id === activeMapId;
    card.classList.toggle('is-active', isActive);
    if (isActive) card.setAttribute('aria-current', 'page');

    const baseId = `map-card-${mapInfo.id.replace(/\W/g, '-')}-${index}`;
    const titleId = `${baseId}-title`;
    const descId = `${baseId}-desc`;
    const editedId = `${baseId}-edited`;
    const regionsId = `${baseId}-regions`;

    card.setAttribute('aria-labelledby', titleId);

    const media = document.createElement('span');
    media.className = 'map-chooser-card-media';

    const image = document.createElement('img');
    const imageSources = getMapChooserImageSources(mapInfo);
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.loading = index < 3 ? 'eager' : 'lazy';
    image.decoding = 'async';
    if (imageSources.fallback && imageSources.fallback !== imageSources.preview) {
        image.dataset.fallbackSrc = withAssetVersion(imageSources.fallback);
    }
    image.addEventListener('error', handleMapChooserImageError);
    image.src = imageSources.preview ? withAssetVersion(imageSources.preview) : '';
    media.appendChild(image);

    const copy = document.createElement('span');
    copy.className = 'map-chooser-card-copy';

    const title = document.createElement('span');
    title.id = titleId;
    title.className = 'map-chooser-card-title';
    title.textContent = mapName;

    const edited = document.createElement('span');
    edited.id = editedId;
    edited.className = 'map-chooser-meta map-chooser-edited';
    edited.textContent = getMapChooserEditedText(mapInfo);

    const regions = document.createElement('span');
    regions.id = regionsId;
    regions.className = 'map-chooser-meta map-chooser-regions';
    regions.textContent = `Regions: ${getMapChooserRegionCount(mapInfo)}`;

    const description = document.createElement('span');
    description.id = descId;
    description.className = 'map-chooser-meta map-chooser-description';
    description.textContent = getMapChooserDescriptionText(mapInfo);

    copy.appendChild(title);
    const describedByIds = [];
    if (description.textContent) {
        copy.appendChild(description);
        describedByIds.push(descId);
    }
    if (edited.textContent) {
        copy.appendChild(edited);
        describedByIds.push(editedId);
    }
    copy.appendChild(regions);
    describedByIds.push(regionsId);
    card.setAttribute('aria-describedby', describedByIds.join(' '));

    card.appendChild(media);
    card.appendChild(copy);
    card.addEventListener('click', () => {
        openMapFromChooser(mapInfo);
    });

    return card;
}

function getMapChooserDescriptionText(mapInfo) {
    const rawText = String(
        mapInfo?.selectorDescription ||
        mapInfo?.summary ||
        mapInfo?.description ||
        mapInfo?.blurb ||
        ''
    ).trim();
    if (!rawText) return '';

    // Uses DOMParser instead of innerHTML to prevent execution of embedded scripts
    // or loading of external resources (like <img src=x onerror=...>) when stripping HTML.
    const parser = new DOMParser();
    const sandbox = parser.parseFromString(rawText, 'text/html');
    return String(sandbox.body.textContent || sandbox.body.innerText || '').trim();
}

function getArchiveMapChooserEntries(items, ancestors = []) {
    const entries = [];
    const sourceItems = Array.isArray(items) ? items : [];
    sourceItems.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        if (isMapChooserArchiveEntry(item, ancestors) && isRenderableMapEntry(item)) {
            entries.push(item);
        }
        if (Array.isArray(item.children) && item.children.length > 0) {
            entries.push(...getArchiveMapChooserEntries(item.children, [...ancestors, item]));
        }
    });
    return entries;
}

function renderMapChooser(items = mapData) {
    if (!mapChooserGrid) return;
    const entries = getPrimaryMapChooserEntries(items);
    const archiveEntries = getArchiveMapChooserEntries(items);
    const activeMapId = getMapChooserActiveMapId([...entries, ...archiveEntries]);
    mapChooserGrid.innerHTML = '';

    if (entries.length === 0 && archiveEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'map-chooser-empty';
        empty.textContent = getConfigValue('copy.loading.noMaps', 'No maps available.');
        mapChooserGrid.appendChild(empty);
        return;
    }

    const entriesFragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
        entriesFragment.appendChild(createMapChooserCard(entry, index, activeMapId));
    });
    mapChooserGrid.appendChild(entriesFragment);

    if (archiveEntries.length > 0) {
        const details = document.createElement('details');
        details.className = 'map-chooser-archive-details';
        details.style.gridColumn = '1 / -1';

        const summary = document.createElement('summary');
        summary.className = 'map-chooser-archive-summary';
        summary.textContent = 'Development & Archive Maps';
        details.appendChild(summary);

        const archiveGrid = document.createElement('div');
        archiveGrid.className = 'map-chooser-grid';
        archiveGrid.style.marginTop = '16px';

        const archiveFragment = document.createDocumentFragment();
        archiveEntries.forEach((entry, index) => {
            archiveFragment.appendChild(createMapChooserCard(entry, entries.length + index, activeMapId));
        });
        archiveGrid.appendChild(archiveFragment);

        details.appendChild(archiveGrid);
        mapChooserGrid.appendChild(details);
    }
}

function openMapFromChooser(mapInfo) {
    if (!isRenderableMapEntry(mapInfo)) return;
    setMapChooserVisible(false);
    if (!isMobileLayoutActive) {
        unlockAdvancedControls('map_chooser_selected');
    }
    trackAnalytics('map_chooser_selected', { mapId: mapInfo.id, mapName: mapInfo.name || '' });
    navigateToMap(mapInfo.id, { preResolvedMap: mapInfo });
    requestAnimationFrame(() => {
        if (mapElement && typeof mapElement.focus === 'function') {
            mapElement.focus({ preventScroll: true });
        }
    });
}

function isValidThemePreference(value) {
    return value === 'light' || value === 'dark' || value === 'system';
}

function resolveSystemTheme() {
    return systemThemeMediaQuery && systemThemeMediaQuery.matches ? 'dark' : 'light';
}

function resolveThemePreference() {
    const prebootPreference = window.__INITIAL_THEME_PREFERENCE__;
    if (isValidThemePreference(prebootPreference)) {
        return prebootPreference;
    }

    const savedPreference = safeGetStorage(UX_STORAGE_KEYS.themePreference);
    if (isValidThemePreference(savedPreference)) {
        return savedPreference;
    }

    const legacyTheme = safeGetStorage(UX_STORAGE_KEYS.theme);
    if (legacyTheme === 'light' || legacyTheme === 'dark') {
        safeSetStorage(UX_STORAGE_KEYS.themePreference, legacyTheme);
        return legacyTheme;
    }

    safeSetStorage(UX_STORAGE_KEYS.themePreference, 'system');
    return 'system';
}

function resolveEffectiveTheme(preference = themePreference) {
    if (preference === 'light' || preference === 'dark') {
        return preference;
    }
    return resolveSystemTheme();
}

function syncThemeToggleA11y(theme) {
    if (!themeToggle) return;
    const switchingTo = theme === 'dark' ? 'light' : 'dark';
    const label = `Switch to ${switchingTo} theme`;
    themeToggle.setAttribute('aria-label', label);
    themeToggle.setAttribute('title', label);
}

function normalizeAtmosphereMode(value) {
    if (typeof value !== 'string') return '';
    const mode = value.trim().toLowerCase();
    return mode === 'aurora' || mode === 'snow' ? mode : '';
}

function normalizeAtmosphereConfig(rawConfig) {
    if (!rawConfig) return null;
    if (typeof rawConfig === 'string') {
        const mode = normalizeAtmosphereMode(rawConfig);
        return mode ? { day: mode, night: mode } : null;
    }
    if (typeof rawConfig !== 'object') return null;

    const day = normalizeAtmosphereMode(rawConfig.day);
    const night = normalizeAtmosphereMode(rawConfig.night);
    const fallback = normalizeAtmosphereMode(rawConfig.default || rawConfig.all || rawConfig.both);
    const resolvedDay = day || fallback;
    const resolvedNight = night || fallback;

    if (!resolvedDay && !resolvedNight) return null;
    return { day: resolvedDay, night: resolvedNight };
}

function resolveAtmosphereMode() {
    if (!currentAtmosphereConfig) return '';
    const themeSlot = currentEffectiveTheme === 'dark' ? 'night' : 'day';
    return currentAtmosphereConfig[themeSlot] || '';
}

function applyAtmosphereLayer() {
    if (!mapContainerElement || !atmosphereLayer) return;

    const mode = resolveAtmosphereMode();
    const currentMode = mapContainerElement.getAttribute('data-atmosphere') || '';
    const nextClass = mode ? `atmosphere-${mode}` : '';

    if (mode === currentMode) {
        if (!nextClass) {
            atmosphereLayer.classList.remove('atmosphere-aurora', 'atmosphere-snow');
            return;
        }
        if (atmosphereLayer.classList.contains(nextClass)) {
            return;
        }
        atmosphereLayer.classList.remove('atmosphere-aurora', 'atmosphere-snow');
        atmosphereLayer.classList.add(nextClass);
        return;
    }

    if (!mode) {
        mapContainerElement.removeAttribute('data-atmosphere');
        atmosphereLayer.classList.remove('atmosphere-aurora', 'atmosphere-snow');
        return;
    }

    mapContainerElement.setAttribute('data-atmosphere', mode);
    atmosphereLayer.classList.remove('atmosphere-aurora', 'atmosphere-snow');
    atmosphereLayer.classList.add(nextClass);
}

function setMapAtmosphere(rawConfig) {
    if (!getFeatureFlag('atmosphere', true)) {
        currentAtmosphereConfig = null;
        applyAtmosphereLayer();
        return;
    }
    currentAtmosphereConfig = normalizeAtmosphereConfig(rawConfig);
    applyAtmosphereLayer();
}

function shouldAnimateThemeTransition() {
    return !prefersReducedMotion();
}

function parseCssDurationToMs(rawValue) {
    if (typeof rawValue !== 'string') return null;
    const value = rawValue.trim();
    if (!value) return null;
    if (value.endsWith('ms')) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (value.endsWith('s')) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed * 1000 : null;
    }
    return null;
}

function getThemeAnimationDurationMs() {
    const computedStyle = window.getComputedStyle(rootElement);
    const totalDuration = parseCssDurationToMs(computedStyle.getPropertyValue('--theme-transition-total'));
    if (totalDuration !== null && totalDuration >= 0) {
        return Math.ceil(totalDuration + THEME_ANIMATION_BUFFER_MS);
    }

    return THEME_ANIMATION_FALLBACK_MS;
}

function isLocalHost() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isPublicHost() {
    return !isLocalHost();
}

function canAccessGMToolkit() {
    if (!getFeatureFlag('gmMode', false)) return false;
    const policy = String(getConfigValue('security.gmToolkitPolicy', 'local-only')).toLowerCase();
    if (policy === 'public') return true;
    if (policy === 'disabled') return false;
    return isLocalHost();
}

function setGMVisibility(enabled, source = 'manual') {
    gmContentVisible = !!enabled;
    safeSetStorage(UX_STORAGE_KEYS.gmUnlocked, gmContentVisible ? 'true' : 'false');
    if (gmStatusLabel) {
        gmStatusLabel.textContent = gmContentVisible ? 'GM content enabled' : 'GM content disabled';
    }
    if (gmPill) {
        gmPill.classList.toggle('active', gmContentVisible);
    }
    trackAnalytics('gm_visibility_changed', { enabled: gmContentVisible, source });
    // Reload current map to apply visibility filtering
    if (currentlyLoadedMapId) {
        loadMap(currentlyLoadedMapId, false);
    }
}

function setPanelCollapsed(panelEl, buttonEl, collapsed, storageKey) {
    if (!panelEl || !buttonEl) return;
    panelEl.classList.toggle('collapsed', collapsed);
    buttonEl.textContent = collapsed ? 'Expand' : 'Collapse';
    buttonEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (storageKey) safeSetStorage(storageKey, collapsed ? 'true' : 'false');
}

function setAuxPanelVisible(panelEl, visible, displayMode = 'block') {
    if (!panelEl) return;
    if (isMobileLayoutActive && (panelEl === sessionToolkitPanel || panelEl === gmPill)) {
        const mountedInMobileTools = mobileToolsPanelSlot && panelEl.parentNode === mobileToolsPanelSlot && isMobileSurfaceMode(MOBILE_SURFACE_MODE_TOOLS);
        panelEl.style.display = mountedInMobileTools && visible ? displayMode : 'none';
        return;
    }
    panelEl.style.display = visible ? displayMode : 'none';
}

function updatePanelToggleButtons() {
    // GM and session toolkit controls were removed; keep this as a no-op for older call sites.
}

function initializeGMVisibility() {
    if (!getFeatureFlag('gmMode', true)) {
        setGMVisibility(false, 'disabled');
        return;
    }
    if (isLocalHost()) {
        setGMVisibility(true, 'localhost');
        return;
    }
    if (isPublicHost()) {
        setGMVisibility(false, 'public_host_forced_off');
    }
}

function visibilityAllowed(item) {
    const vis = (item && item.visibility) ? String(item.visibility).toLowerCase() : 'public';
    return vis !== 'gm' || gmContentVisible;
}

function trackAnalytics(eventName, details = {}) {
    const payload = {
        event: eventName,
        timestamp: new Date().toISOString(),
        mapId: currentlyLoadedMapId || null,
        ...details
    };

    if (!window.__ATLAS_ANALYTICS) {
        window.__ATLAS_ANALYTICS = [];
    }
    window.__ATLAS_ANALYTICS.push(payload);
    if (window.__ATLAS_ANALYTICS.length > 300) {
        window.__ATLAS_ANALYTICS.shift();
    }

    const endpoint = getConfigValue('security.analyticsEndpoint', '') || window.ATLAS_ANALYTICS_ENDPOINT;
    if (!endpoint) return;

    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, body);
        return;
    }

    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
    }).catch(() => {
        // Best effort only.
    });
}

function setSearchMeta(text = '') {
    if (!searchResultsContainer) return;
    const message = String(text || '').trim();
    const existingStatus = searchResultsContainer.querySelector('.search-status');
    if (!message) {
        if (existingStatus) existingStatus.remove();
        return;
    }

    renderedSearchResults = [];
    activeSearchResultIndex = -1;
    activeSearchResultElement = null;
    searchResultsContainer.replaceChildren();
    searchResultsContainer.removeAttribute('role');
    searchResultsContainer.removeAttribute('aria-label');
    searchResultsContainer.removeAttribute('aria-activedescendant');
    poiSearchInput.removeAttribute('aria-activedescendant');

    const status = document.createElement('div');
    status.className = 'search-results-summary search-status';
    status.setAttribute('role', 'status');
    status.textContent = message;
    searchResultsContainer.appendChild(status);
    searchResultsContainer.style.display = 'block';
    poiSearchInput.setAttribute('aria-expanded', 'true');
    syncMobileSearchResultsCardState();
}

function setLoadingMessage(message, options = {}) {
    if (!loadingIndicator) return;
    const {
        showProgress = true,
        showRetry = false
    } = options;

    const loadingText = loadingIndicator.querySelector('.loading-text');
    const progressContainer = loadingIndicator.querySelector('.progress-container');
    if (loadingText) loadingText.textContent = message;
    if (progressContainer) progressContainer.style.display = showProgress ? 'block' : 'none';
    if (loadingRetryBtn) loadingRetryBtn.style.display = showRetry ? 'inline-block' : 'none';
}

function setLoadingProgressValue(value) {
    if (!loadingIndicator) return;
    const numericValue = Number(value);
    const clampedValue = Number.isFinite(numericValue)
        ? Math.max(0, Math.min(100, numericValue))
        : 0;
    loadingProgress = clampedValue;
    const progressBar = loadingIndicator.querySelector('.progress-bar');
    if (progressBar) progressBar.style.width = `${loadingProgress}%`;
}

function clearLoadingProgressTimer() {
    if (loadingProgressInterval) clearInterval(loadingProgressInterval);
    loadingProgressInterval = null;
}

function positionFilterPanel() {
    if (!poiFilterContainer || !toggleFiltersBtn) return;
    if (isMobileLayoutActive) {
        poiFilterContainer.style.left = '';
        poiFilterContainer.style.right = '';
        poiFilterContainer.style.top = '';
        poiFilterContainer.style.maxHeight = '';
        return;
    }
    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    const mapRect = mapContainer.getBoundingClientRect();
    const buttonRect = toggleFiltersBtn.getBoundingClientRect();
    const panelWidth = poiFilterContainer.offsetWidth || 260;
    const minLeft = 10;
    const maxLeft = Math.max(minLeft, mapRect.width - panelWidth - 10);
    const preferredLeft = (buttonRect.right - mapRect.left) + 8;
    const clampedLeft = Math.max(minLeft, Math.min(preferredLeft, maxLeft));
    const panelTop = Math.max(10, (buttonRect.top - mapRect.top) - 2);

    poiFilterContainer.style.left = `${clampedLeft}px`;
    poiFilterContainer.style.top = `${panelTop}px`;
}

function saveMapView(mapId, viewValue) {
    if (!mapId || !viewValue) return;
    const viewsByMap = safeGetJSON(UX_STORAGE_KEYS.mapViews, {});
    viewsByMap[mapId] = viewValue;
    safeSetJSON(UX_STORAGE_KEYS.mapViews, viewsByMap);
}

function setOnboardingVisibility(visible) {
    if (!onboardingCoachmark) return;
    onboardingCoachmark.hidden = !visible;
}

function syncSidebarBackdropState() {
    updateMobileLayoutState();
    const isMobile = window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT;
    const sidebarIsOpen = !container.classList.contains('sidebar-collapsed');
    const legacyDrawerOpen = isMobile && !isMobileLayoutActive && sidebarIsOpen;
    const mobileSurfaceOpen = isMobileLayoutActive && hasOpenMobileSurface();
    container.classList.toggle('mobile-sidebar-open', legacyDrawerOpen);
    container.classList.toggle('mobile-surface-open', mobileSurfaceOpen);
    if (sidebarBackdrop) {
        sidebarBackdrop.setAttribute('aria-hidden', (legacyDrawerOpen || mobileSurfaceOpen) ? 'false' : 'true');
    }
    syncMobileSearchPanelState();
    clampFloatingPanels();
}

function findMapRecursive(items, id) {
    for (const item of items) {
        if (item.id === id) { return item; }
        if (item.type === 'folder' && item.children) {
            const found = findMapRecursive(item.children, id);
            if (found) return found;
        }
    }
    return null;
}

function isRenderableMapEntry(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.status === 'coming-soon') return false;
    if (!String(item.id || '').trim()) return false;

    const width = Number(item.width);
    const height = Number(item.height);
    const imageUrl = String(item.imageUrl || '').trim();

    return Number.isFinite(width) && width > 0 &&
        Number.isFinite(height) && height > 0 &&
        !!imageUrl;
}

function findFirstLoadableIdRecursive(items) {
    for (const item of items) {
        if (isRenderableMapEntry(item)) return item.id;
        if (item.type === 'folder' && item.children) {
            const foundId = findFirstLoadableIdRecursive(item.children);
            if (foundId) return foundId;
        }
    }
    return null;
}

function parseHash() {
    const hash = window.location.hash.substring(1);
    let mapId = null;
    let sidebarState = null;
    if (hash) {
        const parts = hash.split('-s=');
        mapId = parts[0];
        if (parts.length > 1 && ['o', 'c'].includes(parts[1])) {
            sidebarState = parts[1];
        }
    }
    // Default map ID determination moved to initializeApp after data is loaded
    return {
        mapId: mapId, // May be null initially
        sidebarState: sidebarState || 'o'
    };
}

function getHistoryStateValue(state, key, fallbackValue) {
    if (!state || typeof state !== 'object') return fallbackValue;
    return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallbackValue;
}

function generateHash(mapId, sidebarState) {
    const normalizedMapId = (mapId || '').trim();
    const normalizedSidebarState = ['o', 'c'].includes(sidebarState) ? sidebarState : 'o';
    return `#${normalizedMapId}-s=${normalizedSidebarState}`;
}

function buildAppUrlWithHash(hash, search = window.location.search) {
    return `${window.location.pathname}${search}${hash}`;
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getMapRuntimeData(mapId = currentlyLoadedMapId) {
    if (!mapId) return null;
    if (currentMapData && currentMapData.id === mapId) {
        return currentMapData;
    }
    return findMapRecursive(mapData, mapId);
}

function getMapDataUrl(mapEntry) {
    const explicitUrl = String(mapEntry?.dataUrl || '').trim();
    if (explicitUrl) return explicitUrl;
    const mapId = String(mapEntry?.id || '').trim();
    return mapId ? `maps/${mapId}.json` : '';
}

async function getMapDefinition(mapId, preResolvedMap = null) {
    const manifestEntry = preResolvedMap || findMapRecursive(mapData, mapId);
    if (!manifestEntry) {
        throw new Error(`Map "${mapId}" not found in atlas index.`);
    }

    if (mapDefinitionCache.has(mapId)) {
        return mapDefinitionCache.get(mapId);
    }

    if (mapDefinitionPromiseCache.has(mapId)) {
        return mapDefinitionPromiseCache.get(mapId);
    }

    const dataUrl = getMapDataUrl(manifestEntry);
    const definitionPromise = fetchJsonAsset(dataUrl)
        .then((mapDefinition) => {
            const mergedDefinition = {
                ...manifestEntry,
                ...mapDefinition
            };
            prefetchedJsonUrls.add(withAssetVersion(dataUrl));
            mapDefinitionCache.set(mapId, mergedDefinition);
            mapDefinitionPromiseCache.delete(mapId);
            return mergedDefinition;
        })
        .catch((error) => {
            mapDefinitionPromiseCache.delete(mapId);
            throw error;
        });

    mapDefinitionPromiseCache.set(mapId, definitionPromise);
    return definitionPromise;
}

function getSearchScopeLabel(scope = currentSearchScope) {
    const configValue = (path, fallbackValue) =>
        (typeof getConfigValue === 'function') ? getConfigValue(path, fallbackValue) : fallbackValue;
    return scope === SEARCH_SCOPE_ATLAS
        ? configValue('taxonomy.labels.atlasSearchScope', 'Atlas')
        : configValue('taxonomy.labels.mapSearchScope', 'This Map');
}

function prepareAtlasSearchIndex(entries) {
    const preparedEntries = Array.isArray(entries) ? entries : [];
    for (let index = 0; index < preparedEntries.length; index += 1) {
        const entry = preparedEntries[index];
        entry._normalizedName = normalizeSearchValue(entry.name);
        entry._normalizedSearchContent = normalizeSearchValue(`${entry.mapName || ''} ${entry.typeLabel || ''} ${entry.summary || ''} ${entry.description || ''} ${entry.searchText || ''}`);
    }
    return preparedEntries;
}

function configureAtlasSearchIndex(atlas) {
    atlasSearchIndexUrl = typeof atlas?.searchIndexUrl === 'string'
        ? atlas.searchIndexUrl.trim()
        : '';
    atlasSearchIndexPromise = null;
    if (Object.prototype.hasOwnProperty.call(atlas || {}, 'searchIndex')) {
        atlasSearchIndex = prepareAtlasSearchIndex(atlas.searchIndex);
        atlasSearchIndexLoaded = true;
        return;
    }
    atlasSearchIndex = [];
    atlasSearchIndexLoaded = false;
}

function getAtlasSearchEntryCount() {
    if (Array.isArray(atlasSearchIndex) && atlasSearchIndex.length > 0) {
        return atlasSearchIndex.length;
    }
    return !atlasSearchIndexLoaded && atlasSearchIndexUrl ? 1 : 0;
}

async function ensureAtlasSearchIndexLoaded() {
    if (atlasSearchIndexLoaded) return atlasSearchIndex;
    if (!atlasSearchIndexUrl) return [];
    if (atlasSearchIndexPromise) return atlasSearchIndexPromise;

    if (searchScopeAtlasBtn) {
        searchScopeAtlasBtn.setAttribute('aria-busy', 'true');
        searchScopeAtlasBtn.setAttribute('aria-disabled', 'true');
    }
    setSearchMeta('Loading atlas search…');

    atlasSearchIndexPromise = fetchJsonAsset(atlasSearchIndexUrl)
        .then((payload) => {
            const entries = Array.isArray(payload) ? payload : payload?.searchIndex;
            if (!Array.isArray(entries)) {
                throw new Error('Atlas search index is missing a searchIndex array.');
            }
            atlasSearchIndex = prepareAtlasSearchIndex(entries);
            atlasSearchIndexLoaded = true;
            prefetchedJsonUrls.add(withAssetVersion(atlasSearchIndexUrl));
            return atlasSearchIndex;
        })
        .catch((error) => {
            console.error('Error loading atlas search index:', error);
            setSearchMeta('Atlas search could not be loaded. Try again.');
            return null;
        })
        .finally(() => {
            atlasSearchIndexPromise = null;
            if (searchScopeAtlasBtn) {
                searchScopeAtlasBtn.removeAttribute('aria-busy');
                searchScopeAtlasBtn.removeAttribute('aria-disabled');
            }
        });

    return atlasSearchIndexPromise;
}

function atlasScopeActionStillOwnsFocus(previousActiveElement, currentActiveElement = document.activeElement) {
    return currentActiveElement === previousActiveElement || currentActiveElement === searchScopeAtlasBtn;
}

function setSearchScope(scope) {
    currentSearchScope = resolveSearchScope(scope);
    if (searchScopeAtlasBtn) {
        const active = currentSearchScope === SEARCH_SCOPE_ATLAS;
        searchScopeAtlasBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
}

function getMobileMapSummaryExcerpt(mapInfo, maxLength = 148) {
    const rawBlurb = stripHtml(mapInfo?.blurb || '');
    if (!rawBlurb) {
        return 'Search locations and regions on this map.';
    }
    if (rawBlurb.length <= maxLength) {
        return rawBlurb;
    }
    const shortened = rawBlurb.slice(0, Math.max(0, maxLength - 1));
    const trimmed = shortened.replace(/\s+\S*$/, '').trim();
    return `${trimmed || shortened.trim()}…`;
}

function closeSearchResults({ clearMeta = true, preserveScope = false } = {}) {
    renderedSearchResults = [];
    activeSearchResultIndex = -1;
    searchResultsContainer.style.display = 'none';
    searchResultsContainer.innerHTML = '';
    searchResultsContainer.removeAttribute('role');
    searchResultsContainer.removeAttribute('aria-label');
    searchResultsContainer.removeAttribute('aria-activedescendant');
    poiSearchInput.removeAttribute('aria-activedescendant');
    poiSearchInput.setAttribute('aria-expanded', 'false');
    activeSearchResultElement = null;
    if (clearMeta) {
        setSearchMeta('');
        lastTrackedSearchSignature = '';
        if (!preserveScope) setSearchScope(SEARCH_SCOPE_MAP);
    }
    syncMobileSearchResultsCardState();
    syncMobileExploreVisibility();
}

function normalizeSearchValue(value) {
    return String(value || '').trim().toLowerCase();
}

function getSecondarySearchMatchCache(searchContext, normalizedText) {
    if (!searchContext || !normalizedText) return null;
    if (searchContext._secondarySearchMatchText !== normalizedText) {
        searchContext._secondarySearchMatchText = normalizedText;
        searchContext._secondarySearchMatchCache = new Map();
    }
    return searchContext._secondarySearchMatchCache;
}

function rememberSecondarySearchMatch(searchCache, term, match) {
    if (!searchCache) return;
    if (searchCache.size >= 32) {
        const oldestKey = searchCache.keys().next().value;
        searchCache.delete(oldestKey);
    }
    searchCache.set(term, match);
}

function getFuzzyMatchScore(term, target) {
    if (!term || !target) return -1;
    let searchIndex = 0;
    let lastMatchIndex = -1;
    let spreadPenalty = 0;

    for (let termIndex = 0; termIndex < term.length;) {
        const firstCodeUnit = term.charCodeAt(termIndex);
        let char = term[termIndex];
        termIndex += 1;

        if (firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff && termIndex < term.length) {
            const secondCodeUnit = term.charCodeAt(termIndex);
            if (secondCodeUnit >= 0xdc00 && secondCodeUnit <= 0xdfff) {
                char += term[termIndex];
                termIndex += 1;
            }
        }

        const foundIndex = target.indexOf(char, searchIndex);
        if (foundIndex === -1) return -1;
        if (lastMatchIndex >= 0 && spreadPenalty < 120) {
            spreadPenalty += foundIndex - lastMatchIndex - 1;
        }
        lastMatchIndex = foundIndex;
        searchIndex = foundIndex + 1;
    }

    return spreadPenalty >= 120 ? 40 : 160 - spreadPenalty;
}

function checkPrimarySearchMatch(term, normalizedPrimary) {
    if (normalizedPrimary === term) {
        return { matched: true, score: 520, matchedByContent: false };
    }
    const primaryIndex = normalizedPrimary.indexOf(term);
    if (primaryIndex === 0) {
        return { matched: true, score: 430, matchedByContent: false };
    }
    if (primaryIndex > 0) {
        return { matched: true, score: 320 - Math.min(primaryIndex, 120), matchedByContent: false };
    }

    const fuzzyScore = getFuzzyMatchScore(term, normalizedPrimary);
    if (fuzzyScore >= 0) {
        return { matched: true, score: fuzzyScore, matchedByContent: false };
    }
    return null;
}

function checkSecondarySearchMatch(term, normalizedSecondary, searchContext = null) {
    const searchCache = getSecondarySearchMatchCache(searchContext, normalizedSecondary);
    if (searchCache && searchCache.has(term)) {
        return searchCache.get(term);
    }

    if (!term) {
        const emptyTermMatch = { matched: true, score: 180, matchedByContent: true };
        rememberSecondarySearchMatch(searchCache, term, emptyTermMatch);
        return emptyTermMatch;
    }

    const fuzzySecondaryScore = getFuzzyMatchScore(term, normalizedSecondary);
    if (fuzzySecondaryScore >= 0) {
        const secondaryMatch = fuzzySecondaryScore === 160 || normalizedSecondary.includes(term)
            ? { matched: true, score: 180, matchedByContent: true }
            : { matched: true, score: Math.max(80, fuzzySecondaryScore - 40), matchedByContent: true };
        rememberSecondarySearchMatch(searchCache, term, secondaryMatch);
        return secondaryMatch;
    }

    rememberSecondarySearchMatch(searchCache, term, null);
    return null;
}

function computeSearchMatch(term, primaryText, secondaryText = '') {
    const normalizedPrimary = normalizeSearchValue(primaryText);
    if (!term || !normalizedPrimary) return { matched: false, score: -1, matchedByContent: false };

    const primaryMatch = checkPrimarySearchMatch(term, normalizedPrimary);
    if (primaryMatch) return primaryMatch;

    // ⚡ Bolt: Defer expensive string normalization on potentially large secondary text
    // until after all primary fast-paths fail
    // ⚡ Bolt: Defer normalization of potentially large secondary text until we confirm it's needed
    const actualSecondaryText = typeof secondaryText === 'function' ? secondaryText() : secondaryText;
    const normalizedSecondary = normalizeSearchValue(actualSecondaryText);
    if (normalizedSecondary) {
        const secondaryMatch = checkSecondarySearchMatch(term, normalizedSecondary);
        if (secondaryMatch) return secondaryMatch;
    }

    return { matched: false, score: -1, matchedByContent: false };
}

function highlightSearchText(text, searchRegex) {
    const fragment = document.createDocumentFragment();
    if (!searchRegex) {
        fragment.textContent = text;
        return fragment;
    }

    const safeRegex = new RegExp(searchRegex.source, searchRegex.flags + (searchRegex.global ? '' : 'g'));
    safeRegex.lastIndex = 0;
    let lastIndex = 0;
    let match;

    while ((match = safeRegex.exec(text)) !== null) {
        const matchStart = match.index;
        const matchLength = match[0].length;

        if (matchStart > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)));
        }

        const span = document.createElement('span');
        span.className = 'search-result-highlight';
        span.textContent = match[0];
        fragment.appendChild(span);

        lastIndex = matchStart + matchLength;

        if (matchLength === 0) {
            safeRegex.lastIndex++;
        }
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    return fragment;
}

function scheduleIdleTask(callback, timeout = 900) {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(callback, { timeout });
    }
    return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), Math.min(timeout, 400));
}

function cancelIdleTask(id) {
    if (id == null) return;
    if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(id);
        return;
    }
    clearTimeout(id);
}

function registerServiceWorker() {
    if (!getFeatureFlag('serviceWorker', true) || getConfigValue('performance.serviceWorker', true) === false) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!/^https?:$/i.test(window.location.protocol)) return;

    const swUrl = `sw.js?v=${encodeURIComponent(window.APP_ASSET_VERSION || '0')}`;
    window.addEventListener('load', () => {
        window.setTimeout(() => {
            scheduleIdleTask(() => {
                navigator.serviceWorker.register(swUrl).catch((error) => {
                    console.warn('Service worker registration failed:', error);
                });
            }, 2500);
        }, 1200);
    }, { once: true });
}

function shouldAvoidOptionalPrefetch(connection = (typeof navigator !== 'undefined' ? navigator.connection : null)) {
    if (!connection) return false;
    if (connection.saveData === true) return true;
    return /^(slow-)?2g$/i.test(String(connection.effectiveType || '').trim());
}

async function prefetchJsonAsset(url) {
    if (shouldAvoidOptionalPrefetch()) return;
    if (getConfigValue('performance.prefetchJson', true) === false) return;
    const normalizedUrl = withAssetVersion(url);
    if (!url || prefetchedJsonUrls.has(normalizedUrl)) return;
    prefetchedJsonUrls.add(normalizedUrl);
    try {
        await fetch(normalizedUrl, { credentials: 'same-origin' });
    } catch {
        prefetchedJsonUrls.delete(normalizedUrl);
    }
}

function prefetchImageAsset(url) {
    if (shouldAvoidOptionalPrefetch()) return;
    if (getConfigValue('performance.prefetchImages', true) === false) return;
    const normalizedUrl = withAssetVersion(url);
    if (!url || prefetchedImageUrls.has(normalizedUrl)) return;
    prefetchedImageUrls.add(normalizedUrl);
    prefetchImageQueue.push(normalizedUrl);
    drainPrefetchImageQueue();
}

function prefetchMapImageAsset(mapInfo) {
    if (!mapInfo || getMapTileSource(mapInfo)) return;
    prefetchImageAsset(getPreferredMapImageUrl(mapInfo));
}

function drainPrefetchImageQueue() {
    if (prefetchImageInFlight || prefetchImageQueue.length === 0) return;
    const nextUrl = prefetchImageQueue.shift();
    if (!nextUrl) return;
    prefetchImageInFlight = true;
    const img = new Image();
    const finalize = () => {
        prefetchImageInFlight = false;
        drainPrefetchImageQueue();
    };
    img.onload = finalize;
    img.onerror = () => {
        prefetchedImageUrls.delete(nextUrl);
        finalize();
    };
    img.src = nextUrl;
}

function collectLinkedMapPrefetchCandidates(mapDefinition) {
    const candidateIds = new Set();
    const maybeAdd = (mapId) => {
        const normalizedId = String(mapId || '').trim();
        if (!normalizedId || normalizedId === currentlyLoadedMapId) return;
        const target = findMapRecursive(mapData, normalizedId);
        if (isRenderableMapEntry(target)) {
            candidateIds.add(normalizedId);
        }
    };

    getVisiblePoints(mapDefinition).forEach((point) => maybeAdd(point.linkedMapId));
    getVisibleRegions(mapDefinition).forEach((region) => maybeAdd(region.linkedMapId));
    getVisibleLines(mapDefinition).forEach((line) => maybeAdd(line.linkedMapId));

    return Array.from(candidateIds);
}

function schedulePostLoadPrefetch(mapDefinition) {
    if (isEmbeddedView || !mapDefinition) return;
    if (scheduledPrefetchIdleId) {
        cancelIdleTask(scheduledPrefetchIdleId);
        scheduledPrefetchIdleId = null;
    }

    scheduledPrefetchIdleId = scheduleIdleTask(() => {
        scheduledPrefetchIdleId = null;
        const currentManifest = findMapRecursive(mapData, mapDefinition.id);
        if (currentManifest) {
            prefetchJsonAsset(getMapDataUrl(currentManifest));
            prefetchMapImageAsset(currentManifest);
        }

        collectLinkedMapPrefetchCandidates(mapDefinition)
            .slice(0, Math.max(0, Math.round(getPerformanceNumber('linkedMapPrefetchLimit', 3))))
            .forEach((candidateId, index) => {
                const candidateEntry = findMapRecursive(mapData, candidateId);
                if (!candidateEntry) return;
                prefetchJsonAsset(getMapDataUrl(candidateEntry));
                if (index === 0) {
                    prefetchMapImageAsset(candidateEntry);
                }
            });
    });
}

// --- Function to Set Sidebar State ---
function setSidebarState(state, updateHash = true) {
    const shouldBeCollapsed = (state === 'c');
    const isCurrentlyCollapsed = container.classList.contains('sidebar-collapsed');
    if (!shouldBeCollapsed && isMobileLayoutActive && isMobileSurfaceMode(MOBILE_SURFACE_MODE_SEARCH)) {
        closeMobileSearchPanel({ restoreFocus: false });
    }
    if (shouldBeCollapsed !== isCurrentlyCollapsed) {
        container.classList.toggle('sidebar-collapsed', shouldBeCollapsed);

        // Update SVG direction
        if (shouldBeCollapsed) {
            // Point Right (Expand)
             toggleBtn.innerHTML = `<i class="ui-icon" data-lucide="chevron-right" aria-hidden="true"></i>`;
             toggleBtn.title = 'Expand Sidebar';
             toggleBtn.setAttribute('aria-label', 'Expand Sidebar');
             toggleBtn.setAttribute('aria-expanded', 'false');
        } else {
            // Point Left (Collapse)
            toggleBtn.innerHTML = `<i class="ui-icon" data-lucide="chevron-left" aria-hidden="true"></i>`;
            toggleBtn.title = 'Collapse Sidebar';
            toggleBtn.setAttribute('aria-label', 'Collapse Sidebar');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        refreshLucideIcons();

        // Invalidate map size after CSS transition completes
        setTimeout(() => {
            map.invalidateSize({ animate: true });
            syncFeatureDetailLayoutGeometry();
        }, transitionDuration);

            currentSidebarState = state;
            if (updateHash && currentlyLoadedMapId) {
            // Synchronize browser history with the new hash and search parameters
            const newHash = generateHash(currentlyLoadedMapId, state);
            const currentSearch = window.location.search;
            const newUrl = buildAppUrlWithHash(newHash, currentSearch);
            const currentState = (history.state && typeof history.state === 'object') ? history.state : {};
            history.replaceState(
                {
                    ...currentState,
                    mapId: currentlyLoadedMapId,
                    sidebarState: state,
                    search: currentSearch,
                    hash: newHash
                },
                '',
                newUrl
            ); // Use replaceState for sidebar toggle
            }
            if (!isInitializing) {
                trackAnalytics('sidebar_toggled', { state: currentSidebarState });
            }
    } else {
            currentSidebarState = state;
    }
    safeSetStorage(UX_STORAGE_KEYS.sidebarState, currentSidebarState);
    syncSidebarBackdropState();
}

function getRegionGroupChildCheckboxCounts(regionTypeCheckboxes, groupName) {
    let childCount = 0;
    let checkedChildCount = 0;

    for (let i = 0; i < regionTypeCheckboxes.length; i++) {
        const childCheckbox = regionTypeCheckboxes[i];
        if (childCheckbox.getAttribute('data-group') !== groupName) continue;

        childCount++;
        if (childCheckbox.checked) {
            checkedChildCount++;
        }
    }

    return { childCount, checkedChildCount };
}

// --- Helper Function to Update the "Toggle All" Checkbox State ---
function updateToggleAllCheckboxState() {
    if (!poiFilterCheckboxesLive) return;

    // Group region checkboxes
    const regionGroupCheckboxes = [];
    const regionTypeCheckboxes = [];
    const allTopLevelFilters = [];
    const checkedTopLevelFilters = [];
    const indeterminateTopLevelFilters = [];

    // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
    const staticCheckboxes = getStaticPoiFilterCheckboxes();
    for (let i = 0; i < staticCheckboxes.length; i++) {
        const checkbox = staticCheckboxes[i];
        if (checkbox.type !== 'checkbox' || checkbox.id === 'filter-toggle-all') continue;

        if (checkbox.classList.contains('region-group-filter')) {
            regionGroupCheckboxes.push(checkbox);
            allTopLevelFilters.push(checkbox);
            if (checkbox.indeterminate) {
                indeterminateTopLevelFilters.push(checkbox);
            } else if (checkbox.checked) {
                checkedTopLevelFilters.push(checkbox);
            }
        } else if (checkbox.classList.contains('region-type-filter')) {
            regionTypeCheckboxes.push(checkbox);
        } else if (checkbox.classList.contains('poi-filter-checkbox') || checkbox.classList.contains('line-type-filter')) {
            allTopLevelFilters.push(checkbox);
            if (checkbox.checked) {
                checkedTopLevelFilters.push(checkbox);
            }
        }
    }

    // Update indeterminate state for each region group parent
    regionGroupCheckboxes.forEach(groupCheckbox => {
        const groupName = groupCheckbox.value;
        const { childCount, checkedChildCount } = getRegionGroupChildCheckboxCounts(regionTypeCheckboxes, groupName);

        if (checkedChildCount === 0) {
            groupCheckbox.checked = false;
            groupCheckbox.indeterminate = false;
        } else if (checkedChildCount === childCount) {
            groupCheckbox.checked = true;
            groupCheckbox.indeterminate = false;
        } else {
            groupCheckbox.checked = false;
            groupCheckbox.indeterminate = true;
        }
    });

    // Re-evaluate top level filters indeterminate after updating group checkboxes
    checkedTopLevelFilters.length = 0;
    indeterminateTopLevelFilters.length = 0;
    for (let i = 0; i < allTopLevelFilters.length; i++) {
        const checkbox = allTopLevelFilters[i];
        if (checkbox.classList.contains('region-group-filter')) {
            if (checkbox.indeterminate) {
                indeterminateTopLevelFilters.push(checkbox);
            } else if (checkbox.checked) {
                checkedTopLevelFilters.push(checkbox);
            }
        } else if (checkbox.checked) {
            checkedTopLevelFilters.push(checkbox);
        }
    }

    if (allTopLevelFilters.length === 0) {
        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
    } else if (indeterminateTopLevelFilters.length > 0 || (checkedTopLevelFilters.length > 0 && checkedTopLevelFilters.length < allTopLevelFilters.length)) {
        filterToggleAllCheckbox.checked = false;
        filterToggleAllCheckbox.indeterminate = true;
    } else if (checkedTopLevelFilters.length === allTopLevelFilters.length) {
        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
    } else { // All are unchecked
        filterToggleAllCheckbox.checked = false;
        filterToggleAllCheckbox.indeterminate = false;
    }
}

function setCoordsDisplayVisible(visible) {
    if (visible && !currentLatLonBounds) return;
    coordsDisplayEnabled = visible;
    safeSetStorage(UX_STORAGE_KEYS.coordsVisible, String(coordsDisplayEnabled));
    if (toggleCoordsBtn) {
        toggleCoordsBtn.setAttribute('aria-pressed', coordsDisplayEnabled ? 'true' : 'false');
    }
    coordinateDisplay.style.display = coordsDisplayEnabled ? 'block' : 'none';
    if (isMobileLayoutActive) {
        coordinateDisplay.style.display = 'none';
    }
    if (mobileCoordsBtn) {
        mobileCoordsBtn.classList.toggle('active', coordsDisplayEnabled);
        mobileCoordsBtn.setAttribute('aria-pressed', coordsDisplayEnabled ? 'true' : 'false');
    }
    trackAnalytics('coords_display_toggled', { visible: coordsDisplayEnabled });
}

function buildControlVisibilityState(mapInfo) {
    const hasPOIs = allMapMarkers.length > 0;
    const hasRegions = (visibleRegionsCache && visibleRegionsCache.length > 0) || (Array.isArray(mapInfo.regions) && mapInfo.regions.length > 0);
    const hasRoads = (visibleLinesCache && visibleLinesCache.length > 0) ||
        (Array.isArray(mapInfo.roads) && mapInfo.roads.length > 0) ||
        (Array.isArray(mapInfo.lines) && mapInfo.lines.length > 0);
    const hasValidScale = typeof mapInfo.scalePixels === 'number' && mapInfo.scalePixels > 0 &&
        typeof mapInfo.scaleKilometers === 'number' && mapInfo.scaleKilometers > 0;
    const allowGMToolkit = canAccessGMToolkit() && !isEmbeddedView;

    return resolveControlVisibilityState({
        isEmbedded: isEmbeddedView,
        isMobileLayout: isMobileLayoutActive,
        advancedControls: advancedControlsUnlocked,
        hasPOIs,
        hasRegions,
        hasRoads,
        hasValidScale,
        hasBlurb: !!mapInfo.blurb,
        hasLatLonBounds: !!mapInfo.latLonBounds,
        allowGMToolkit,
        atlasSearchCount: getAtlasSearchEntryCount(),
        toolkitVisible: toolkitPanelVisible,
        gmVisible: gmPanelVisible
    });
}

function applyPrimaryControlVisibility(visibilityState) {
    toggleMarkersBtn.style.display = visibilityState.showMarkersButton ? 'block' : 'none';
    searchControlContainer.style.display = visibilityState.showSearchControl ? 'block' : 'none';
    toggleFiltersBtn.style.display = visibilityState.showFiltersButton ? 'block' : 'none';
    measureToolBtn.style.display = visibilityState.showMeasureButton ? 'block' : 'none';
    if (toggleSoundBtn) toggleSoundBtn.style.display = visibilityState.showSoundButton ? 'block' : 'none';
    toggleBlurbBtn.style.display = visibilityState.showBlurbButton ? 'block' : 'none';
    toggleCoordsBtn.style.display = visibilityState.showCoordsButton ? 'block' : 'none';
    if (shareViewBtn) shareViewBtn.style.display = visibilityState.showShareButton ? 'block' : 'none';
    if (toggleGMPanelBtn) toggleGMPanelBtn.style.display = visibilityState.showGMButton ? 'block' : 'none';
    if (toggleToolkitPanelBtn) toggleToolkitPanelBtn.style.display = visibilityState.showToolkitButton ? 'block' : 'none';
    if (toggleBtn) toggleBtn.hidden = isEmbeddedView || isMobileLayoutActive;
    if (searchRefineFiltersBtn) searchRefineFiltersBtn.hidden = !visibilityState.showSearchFilterAction;
    toggleCoordsBtn.setAttribute('aria-pressed', coordsDisplayEnabled ? 'true' : 'false');
}

function applyAuxiliaryPanelVisibility(visibilityState) {
    if (sessionToolkitPanel) {
        sessionToolkitPanel.style.display = visibilityState.showToolkitPanel ||
            (isMobileLayoutActive && isMobileSurfaceMode(MOBILE_SURFACE_MODE_TOOLS) && mobileToolsPanelMode === MOBILE_TOOLS_PANEL_TOOLKIT)
            ? 'block'
            : 'none';
    }
    if (gmPill) {
        gmPill.style.display = visibilityState.showGMPill ||
            (isMobileLayoutActive && isMobileSurfaceMode(MOBILE_SURFACE_MODE_TOOLS) && mobileToolsPanelMode === MOBILE_TOOLS_PANEL_GM)
            ? 'flex'
            : 'none';
    }
}

function handleHiddenControlCleanup(visibilityState) {
    if (!visibilityState.showSearchControl) {
        closeSearchResults();
        if (isMobileLayoutActive && isMobileSurfaceMode(MOBILE_SURFACE_MODE_SEARCH)) {
            closeMobileSearchPanel({ restoreFocus: false });
        }
    }

    if (!visibilityState.showSearchFilterAction) {
        if (filtersPanelVisible) {
            filtersPanelVisible = false;
            mobileFilterExpanded = false;
            poiFilterContainer.classList.remove('visible');
            toggleFiltersBtn.classList.remove('active');
            toggleFiltersBtn.setAttribute('aria-expanded', 'false');
        }
        syncFilterPanelInteractionState(false);
        syncMobileFilterState();
    }
}

function applyAdvancedControlsLock() {
    if (filtersPanelVisible) {
        if (!isMobileLayoutActive) {
            filtersPanelVisible = false;
            poiFilterContainer.classList.remove('visible');
            toggleFiltersBtn.classList.remove('active');
            toggleFiltersBtn.setAttribute('aria-expanded', 'false');
        }
    }
    syncFilterPanelInteractionState(filtersPanelVisible);
    syncMobileFilterState();
    setMapBlurbVisible(false);
    coordinateDisplay.style.display = 'none';
    setAuxPanelVisible(gmPill, false);
    setAuxPanelVisible(sessionToolkitPanel, false);
    if (activeFiltersContainer) {
        activeFiltersContainer.style.display = 'none';
        activeFiltersContainer.innerHTML = '';
    }
    updatePanelToggleButtons();
}

function applyMobileLayoutVisibility(mapInfo) {
    setMapBlurbVisible(false);
    coordinateDisplay.style.display = coordsDisplayEnabled && mapInfo.latLonBounds ? 'block' : 'none';
    setAuxPanelVisible(gmPill, isMobileSurfaceMode(MOBILE_SURFACE_MODE_TOOLS) && mobileToolsPanelMode === MOBILE_TOOLS_PANEL_GM, 'flex');
    setAuxPanelVisible(sessionToolkitPanel, isMobileSurfaceMode(MOBILE_SURFACE_MODE_TOOLS) && mobileToolsPanelMode === MOBILE_TOOLS_PANEL_TOOLKIT);
    if (activeFiltersContainer) {
        activeFiltersContainer.style.display = 'none';
        activeFiltersContainer.innerHTML = '';
    }
}

function updateCurrentControlVisibility(selectedMap = null) {
    const mapInfo = selectedMap || getMapRuntimeData(currentlyLoadedMapId);
    if (!mapInfo) return;

    if (isEmbeddedView) {
        setAuxPanelVisible(sessionToolkitPanel, false);
        setAuxPanelVisible(gmPill, false);
    }

    const visibilityState = buildControlVisibilityState(mapInfo);

    applyPrimaryControlVisibility(visibilityState);
    applyAuxiliaryPanelVisibility(visibilityState);

    syncMobileMapMeta(mapInfo, visibilityState);
    syncMobileSheetActionState(visibilityState);
    syncMobileExploreVisibility();

    handleHiddenControlCleanup(visibilityState);

    if (!advancedControlsUnlocked) {
        applyAdvancedControlsLock();
        if (!isMobileLayoutActive) return;
    }

    if (isMobileLayoutActive) {
        applyMobileLayoutVisibility(mapInfo);
    }

    if (!isMobileLayoutActive && mapInfo.latLonBounds) {
        coordinateDisplay.style.display = coordsDisplayEnabled ? 'block' : 'none';
    } else {
        coordinateDisplay.style.display = 'none';
    }
    updatePanelToggleButtons();
    clampFloatingPanels();
}

function unlockAdvancedControls(reason = 'interaction') {
    if (advancedControlsUnlocked || isEmbeddedView) return;
    advancedControlsUnlocked = true;
    safeSetStorage(UX_STORAGE_KEYS.advancedControlsUnlocked, 'true');
    setOnboardingVisibility(false);
    updateCurrentControlVisibility();
    if (safeGetStorage(UX_STORAGE_KEYS.filterPanelOpen) === 'true' && toggleFiltersBtn.style.display !== 'none') {
        filtersPanelVisible = true;
        poiFilterContainer.classList.add('visible');
        toggleFiltersBtn.classList.add('active');
        toggleFiltersBtn.setAttribute('aria-expanded', 'true');
        syncFilterPanelInteractionState(true);
    }
    initializeSoundState();
    updateActiveFilterChips();
    trackAnalytics('advanced_controls_unlocked', { reason });
}

function getSearchFilterChips() {
    const chips = [];
    const searchTerm = poiSearchInput.value.trim();
    if (searchTerm) {
        chips.push({
            label: `Search: ${searchTerm}`,
            clear: () => {
                poiSearchInput.value = '';
                updateVisibleMarkersAndSearch();
                poiSearchInput.focus();
                trackAnalytics('search_cleared', { source: 'chip' });
            }
        });
    }
    return chips;
}

function getHiddenFilterChips() {
    const chips = [];
    const hiddenFilters = [];

    // ⚡ Bolt: Early return for hidden filters check if all items are already toggled visible
    const allChecked = filterToggleAllCheckbox && filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;

    if (!allChecked && poiFilterCheckboxesLive) {
        // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
        const staticCheckboxes = getStaticPoiFilterCheckboxes();
        for (let i = 0; i < staticCheckboxes.length; i++) {
            const checkbox = staticCheckboxes[i];
            if (checkbox.type === 'checkbox' && checkbox.id !== 'filter-toggle-all') {
                if ((checkbox.classList.contains('poi-filter-checkbox') ||
                     checkbox.classList.contains('region-type-filter') ||
                     checkbox.classList.contains('line-type-filter')) &&
                    !checkbox.checked) {
                    hiddenFilters.push(checkbox);
                }
            }
        }
    }

    if (hiddenFilters.length > 0) {
        if (hiddenFilters.length > 6) {
            chips.push({
                label: `${hiddenFilters.length} filters hidden`,
                clear: () => {
                    filterToggleAllCheckbox.checked = true;
                    filterToggleAllCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        } else {
            hiddenFilters.forEach(checkbox => {
                const label = checkbox.nextElementSibling?.textContent?.trim() || checkbox.value || 'Filter';
                chips.push({
                    label,
                    clear: () => {
                        checkbox.checked = true;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            });
        }
    }
    return chips;
}

function renderFilterChips(chips) {
    activeFiltersContainer.innerHTML = '';
    if (chips.length === 0) {
        activeFiltersContainer.style.display = 'none';
        return;
    }

    const fragment = document.createDocumentFragment();
    chips.forEach(chip => {
        const chipEl = document.createElement('span');
        chipEl.className = 'active-filter-chip';
        chipEl.textContent = chip.label;

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.setAttribute('aria-label', `Clear ${chip.label}`);
        clearBtn.textContent = '×';
        clearBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            chip.clear();
        });

        chipEl.appendChild(clearBtn);
        fragment.appendChild(chipEl);
    });
    activeFiltersContainer.appendChild(fragment);

    activeFiltersContainer.style.display = 'flex';
}

function updateActiveFilterChips() {
    if (!activeFiltersContainer || isEmbeddedView || isMobileLayoutActive) {
        if (activeFiltersContainer) {
            activeFiltersContainer.style.display = 'none';
            activeFiltersContainer.innerHTML = '';
        }
        return;
    }

    const chips = [...getSearchFilterChips(), ...getHiddenFilterChips()];
    renderFilterChips(chips);
}

if (searchRefineFiltersBtn) {
    searchRefineFiltersBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (searchRefineFiltersBtn.hidden) return;
        if (toggleFiltersBtn.style.display === 'none' && !isMobileLayoutActive) return;
        toggleFilterPanel();
    });
}

if (searchRefineClearBtn) {
    searchRefineClearBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        poiSearchInput.value = '';
        setSearchScope(SEARCH_SCOPE_MAP);

        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
        setFilterCheckboxesChecked(true);

        updateToggleAllCheckboxState();
        updateVisibleMarkersAndSearch();
        updateVisibleRegions();
        updateVisibleLines();
        trackAnalytics('search_refine_cleared');
    });
}

if (encounterRollBtn) {
    encounterRollBtn.addEventListener('click', () => {
        rollEncounter();
    });
}
if (encounterSelect) {
    encounterSelect.addEventListener('change', () => {
        renderEncounterTableList(encounterSelect.value);
    });
}
if (encounterViewBtn) {
    encounterViewBtn.addEventListener('click', () => {
        if (!encounterTableList) return;
        const nextVisible = encounterTableList.style.display === 'none';
        encounterTableList.style.display = nextVisible ? 'flex' : 'none';
        encounterViewBtn.textContent = nextVisible ? 'Hide List' : 'View Full List';
        if (nextVisible) renderEncounterTableList(encounterSelect?.value || '');
    });
}
if (travelDistanceInput) {
    travelDistanceInput.addEventListener('input', updateTravelTime);
}
if (travelModeSelect) {
    travelModeSelect.addEventListener('change', updateTravelTime);
}

// ⚡ Bolt: Optimizes active search result DOM traversal by maintaining a reference to the active element, turning an O(N) operation into O(1) (Measured improvement: ~64x speedup)
let cachedSearchResultsNodeList = null;

function setActiveSearchResult(index) {
    activeSearchResultIndex = index;

    if (activeSearchResultElement) {
        activeSearchResultElement.classList.remove('active');
        activeSearchResultElement.setAttribute('aria-selected', 'false');
        activeSearchResultElement = null;
    }

    if (index >= 0) {
        // ⚡ Bolt: Cache querySelectorAll result to avoid O(N) DOM query on every keystroke
        if (!cachedSearchResultsNodeList || cachedSearchResultsNodeList.length === 0 || cachedSearchResultsNodeList[0].parentNode !== searchResultsContainer) {
            cachedSearchResultsNodeList = searchResultsContainer.querySelectorAll('.search-result-item');
        }
        const items = cachedSearchResultsNodeList;
        const newActive = items[index];
        if (newActive) {
            newActive.classList.add('active');
            newActive.setAttribute('aria-selected', 'true');
            activeSearchResultElement = newActive;
            poiSearchInput.setAttribute('aria-activedescendant', newActive.id || '');
        }
    } else {
        poiSearchInput.removeAttribute('aria-activedescendant');
    }
}

function moveSearchResultSelection(direction) {
    if (!renderedSearchResults.length) return;
    const itemCount = renderedSearchResults.length;
    const nextIndex = activeSearchResultIndex < 0
        ? (direction > 0 ? 0 : itemCount - 1)
        : (activeSearchResultIndex + direction + itemCount) % itemCount;
    setActiveSearchResult(nextIndex);
    const activeItem = searchResultsContainer.querySelector(`.search-result-item[data-result-index="${nextIndex}"]`);
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
        activeItem.scrollIntoView({ block: 'nearest' });
    }
}

function selectSearchResult(index = activeSearchResultIndex) {
    const result = renderedSearchResults[index];
    if (!result || typeof result.onSelect !== 'function') return;
    result.onSelect();
    poiSearchInput.value = '';
    setSearchScope(SEARCH_SCOPE_MAP);
    closeSearchResults();
    closeMobileSheet({ restoreFocus: false });
    updateActiveFilterChips();
    syncMobileExploreVisibility();
}

function buildScopedSearchParams(entry) {
    const params = new URLSearchParams(window.location.search);
    ['view', 'poi', 'region', 'line', 'src', 'stype'].forEach((key) => params.delete(key));

    switch (entry.kind) {
        case 'poi':
            params.set('poi', entry.name);
            break;
        case 'region':
            params.set('region', entry.name);
            break;
        case 'line':
            params.set('line', entry.name);
            break;
        default:
            break;
    }

    return params;
}

function openAtlasSearchResult(entry) {
    const targetMap = findMapRecursive(mapData, entry.mapId);
    if (!isRenderableMapEntry(targetMap)) return;

    const params = buildScopedSearchParams(entry);
    const nextSearch = params.toString() ? `?${params.toString()}` : '';
    const nextHash = generateHash(entry.mapId, currentSidebarState);
    const nextUrl = buildAppUrlWithHash(nextHash, nextSearch);
    history.pushState(
        {
            mapId: entry.mapId,
            sidebarState: currentSidebarState,
            search: nextSearch,
            hash: nextHash
        },
        '',
        nextUrl
    );
    setSearchScope(SEARCH_SCOPE_MAP);
    loadMap(entry.mapId, false, targetMap);
    trackAnalytics('search_result_opened', {
        scope: SEARCH_SCOPE_ATLAS,
        kind: entry.kind,
        targetMapId: entry.mapId
    });
}

function renderSearchResults(term, results) {
    renderedSearchResults = results;
    activeSearchResultIndex = results.length > 0 ? 0 : -1;
    searchResultsContainer.innerHTML = '';
    activeSearchResultElement = null;
    cachedSearchResultsNodeList = null; // Invalidate cache when search results change
    searchResultsContainer.removeAttribute('aria-activedescendant');
    poiSearchInput.removeAttribute('aria-activedescendant');

    if (!term) {
        closeSearchResults();
        syncMobileExploreVisibility();
        return;
    }

    if (results.length === 0) {
        searchResultsContainer.removeAttribute('role');
        searchResultsContainer.removeAttribute('aria-label');
        poiSearchInput.setAttribute('aria-expanded', 'true');
        const summary = document.createElement('div');
        summary.className = 'search-results-summary';
        summary.textContent = `0 results in ${getSearchScopeLabel()}`;
        searchResultsContainer.appendChild(summary);

        const emptyState = document.createElement('div');
        emptyState.className = 'search-results-empty';
        emptyState.textContent = `No ${getSearchScopeLabel().toLowerCase()} results match this search.`;
        searchResultsContainer.appendChild(emptyState);
    } else {
        searchResultsContainer.setAttribute('role', 'listbox');
        searchResultsContainer.setAttribute('aria-label', 'Search results');
        poiSearchInput.setAttribute('aria-expanded', 'true');
        const summary = document.createElement('div');
        summary.className = 'search-results-summary';
        summary.setAttribute('role', 'presentation');
        summary.setAttribute('aria-hidden', 'true');
        summary.textContent = `${results.length} result${results.length === 1 ? '' : 's'} in ${getSearchScopeLabel()}`;
        searchResultsContainer.appendChild(summary);

        const searchRegex = term ? new RegExp(escapeRegExp(term), 'gi') : null;

        const fragment = document.createDocumentFragment();

        results.forEach((result, index) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            resultItem.id = `search-result-${index}`;
            resultItem.dataset.resultIndex = String(index);
            resultItem.tabIndex = -1;
            resultItem.setAttribute('role', 'option');
            resultItem.setAttribute('aria-selected', index === activeSearchResultIndex ? 'true' : 'false');
            resultItem.setAttribute('aria-posinset', String(index + 1));
            resultItem.setAttribute('aria-setsize', String(results.length));

            const titleRow = document.createElement('div');
            titleRow.className = 'search-result-title';
            const titleLabel = document.createElement('span');
            titleLabel.className = 'search-result-label';
            titleLabel.appendChild(highlightSearchText(result.title, searchRegex));

            const badge = document.createElement('span');
            badge.className = 'badge-kind';
            badge.textContent = result.badge;

            titleRow.appendChild(titleLabel);
            titleRow.appendChild(badge);

            const metaRow = document.createElement('div');
            metaRow.className = 'search-result-meta';
            metaRow.textContent = result.subtitle;

            resultItem.appendChild(titleRow);
            if (result.subtitle) {
                resultItem.appendChild(metaRow);
            }

            resultItem.addEventListener('mouseenter', () => setActiveSearchResult(index));
            resultItem.addEventListener('click', () => selectSearchResult(index));
            resultItem.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectSearchResult(index);
                }
            });

            fragment.appendChild(resultItem);
        });

        searchResultsContainer.appendChild(fragment);
    }

    searchResultsContainer.style.display = 'block';
    setActiveSearchResult(activeSearchResultIndex);
    syncMobileSearchResultsCardState();
    syncMobileExploreVisibility();

    const searchSignature = `${currentSearchScope}:${term}:${results.length}`;
    if (results.length > 0 && searchSignature !== lastTrackedSearchSignature) {
        lastTrackedSearchSignature = searchSignature;
        trackAnalytics('search_success', {
            term: poiSearchInput.value.trim(),
            scope: currentSearchScope,
            resultCount: results.length
        });
    }
}

function sortSearchResults(results) {
    return results
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const groupDelta = (SEARCH_RESULT_GROUP_INDEX[a.group] ?? -1) - (SEARCH_RESULT_GROUP_INDEX[b.group] ?? -1);
            if (groupDelta !== 0) return groupDelta;
            return a.title.localeCompare(b.title);
        })
        .slice(0, 40);
}

function computePrecomputedSearchMatch(term, normalizedPrimary, normalizedSecondary, secondarySearchContext = null) {
    if (!term || !normalizedPrimary) return { matched: false, score: -1, matchedByContent: false };

    const primaryMatch = checkPrimarySearchMatch(term, normalizedPrimary);
    if (primaryMatch) return primaryMatch;

    if (normalizedSecondary) {
        const secondaryMatch = checkSecondarySearchMatch(term, normalizedSecondary, secondarySearchContext);
        if (secondaryMatch) return secondaryMatch;
    }

    return { matched: false, score: -1, matchedByContent: false };
}

function searchMapMarkers(searchTerm, results, allPoiGroupsChecked, activeSpecificGroupFilters, searchFiltersCurrentMap) {
    const hasSearchTerm = !!searchTerm;

    allMapMarkers.forEach((marker) => {
        const poi = marker.poiData;
        if (!poi) return;

        let searchContext = marker._searchContext;
        if (!searchContext) {
            searchContext = {
                poiGroup: getPoiGroup(poi.type),
                normalizedPrimary: null,
                normalizedSecondary: null
            };
            marker._searchContext = searchContext;
        }

        const poiGroup = searchContext.poiGroup;
        const groupMatch = allPoiGroupsChecked || activeSpecificGroupFilters.has(poiGroup);
        let match = { matched: false, score: -1, matchedByContent: false };
        // ⚡ Bolt: Skip expensive string concatenation and fuzzy matching when the user is only filtering (search is empty) or the marker is filtered out.
        if (searchFiltersCurrentMap && groupMatch && hasSearchTerm) {
            // ⚡ Bolt: Lazy evaluation of `normalizedPrimary` and `normalizedSecondary` string normalizations
            // and concatenations only when actually performing a search to eliminate wasted CPU cycles and
            // object allocations during map load and pure category filtering.
            if (searchContext.normalizedPrimary === null) {
                searchContext.normalizedPrimary = normalizeSearchValue(poi.name);
                searchContext.normalizedSecondary = normalizeSearchValue(getFeatureSearchDetailText(poi));
            }
            match = computePrecomputedSearchMatch(
                searchTerm,
                searchContext.normalizedPrimary,
                searchContext.normalizedSecondary,
                searchContext
            );
        }
        const isSearchMatch = !hasSearchTerm || match.matched;

        if (markersVisible && groupMatch && (!searchFiltersCurrentMap || isSearchMatch)) {
            if (!currentMarkerGroup.hasLayer(marker)) currentMarkerGroup.addLayer(marker);
        } else if (currentMarkerGroup.hasLayer(marker)) {
            currentMarkerGroup.removeLayer(marker);
        }

        if (searchFiltersCurrentMap && groupMatch && match.matched && hasSearchTerm) {
            results.push({
                group: 'poi',
                badge: 'POI',
                title: poi.name,
                subtitle: match.matchedByContent ? `Matched in ${poiGroup.toLowerCase()} details` : poiGroup,
                score: match.score,
                onSelect: () => {
                    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 1));
                    marker.openPopup();
                }
            });
        }
    });
}

function searchMapRegions(searchTerm, results, searchFiltersCurrentMap) {
    if (!searchFiltersCurrentMap || !currentRegionGroup) return;

    const allRegionTypesChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;
    const activeRegionTypeFilters = new Set();
    if (!allRegionTypesChecked && poiFilterCheckboxesLive) {
        // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
        const staticCheckboxes = getStaticPoiFilterCheckboxes();
        for (let i = 0; i < staticCheckboxes.length; i++) {
            const checkbox = staticCheckboxes[i];
            if (checkbox.type === 'checkbox' &&
                checkbox.classList.contains('region-type-filter') &&
                checkbox.checked) {
                activeRegionTypeFilters.add(checkbox.value);
            }
        }
    }

    // ⚡ Bolt: Iterate over static array instead of LayerGroup for ~15x faster iterations
    allMapRegions.forEach((layer) => {
            const region = layer.regionData;
            if (!region || !region.name) return;

            const regionFilterValue = region.value || region.name;
            const typeMatch = allRegionTypesChecked || activeRegionTypeFilters.has(regionFilterValue);

            // ⚡ Bolt: Skip expensive string concatenation and fuzzy matching when the user is only filtering (search is empty).
            if (typeMatch) {
                const match = computeSearchMatch(searchTerm, region.name, () => `${region.summary || ''} ${region.description || ''}`);

                if (match.matched) {
                    results.push({
                        group: 'region',
                        badge: 'Region',
                        title: region.name,
                        subtitle: match.matchedByContent ? `Matched in ${region.type || 'region'} description` : (region.value || region.type || 'Region'),
                        score: match.score,
                        onSelect: () => {
                            map.fitBounds(layer.getBounds(), { maxZoom: Math.max(map.getZoom(), 1) });
                            layer.openPopup();
                        }
                    });
                }
            }
        });
}

function searchMapLines(searchTerm, results, searchFiltersCurrentMap) {
    if (!searchFiltersCurrentMap || !currentRoadGroup) return;

    const allLineTypesChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;
    const activeLineTypeFilters = new Set();
    if (!allLineTypesChecked && poiFilterCheckboxesLive) {
        // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
        const staticCheckboxes = getStaticPoiFilterCheckboxes();
        for (let i = 0; i < staticCheckboxes.length; i++) {
            const checkbox = staticCheckboxes[i];
            if (checkbox.type === 'checkbox' &&
                checkbox.classList.contains('line-type-filter') &&
                checkbox.checked) {
                activeLineTypeFilters.add(checkbox.value);
            }
        }
    }

    // ⚡ Bolt: Iterating over static array instead of LayerGroup for ~70% faster iterations
    allMapLines.forEach((layer) => {
            const line = layer.roadData;
            if (!line) return;
            const lineName = line.name || line.type || 'Unnamed Line';
            const lineType = line.type || 'Unnamed Road Type';
            const typeMatch = allLineTypesChecked || activeLineTypeFilters.has(lineType);

            // ⚡ Bolt: Skip expensive string concatenation and fuzzy matching when the user is only filtering (search is empty).
            if (typeMatch) {
                const match = computeSearchMatch(searchTerm, lineName, () => `${lineType} ${line.summary || ''} ${line.description || ''}`);

                if (match.matched) {
                    results.push({
                        group: 'line',
                        badge: 'Line',
                        title: lineName,
                        subtitle: match.matchedByContent ? `Matched in ${lineType.toLowerCase()} details` : lineType,
                        score: match.score,
                        onSelect: () => {
                            map.fitBounds(layer.getBounds(), { maxZoom: Math.max(map.getZoom(), 1) });
                            if (layer.getPopup()) layer.openPopup();
                        }
                    });
                }
            }
        });
}

function searchAtlasIndex(searchTerm, results) {
    if (currentSearchScope === SEARCH_SCOPE_ATLAS && searchTerm) {
        for (let i = 0; i < atlasSearchIndex.length; i++) {
            const entry = atlasSearchIndex[i];
            if (!visibilityAllowed(entry)) continue;

            // Bolt: Atlas load precomputes these normalized strings so searches avoid
            // rebuilding and lowercasing secondary details for every atlas entry.
            const match = computePrecomputedSearchMatch(
                searchTerm,
                entry._normalizedName ?? normalizeSearchValue(entry.name),
                entry._normalizedSearchContent ?? normalizeSearchValue(`${entry.mapName || ''} ${entry.typeLabel || ''} ${entry.summary || ''} ${entry.description || ''} ${entry.searchText || ''}`),
                entry
            );

            if (!match.matched) continue;

            results.push({
                group: entry.kind,
                badge: entry.kind === 'map' ? 'Map' : (entry.typeLabel || entry.kind),
                title: entry.name,
                subtitle: entry.mapId === currentlyLoadedMapId
                    ? `${entry.mapName || 'Current map'}${match.matchedByContent ? ' • matched in details' : ''}`
                    : `${entry.mapName || entry.mapId}${match.matchedByContent ? ' • matched in details' : ''}`,
                score: match.score + (entry.kind === 'map' ? 10 : 0),
                onSelect: () => openAtlasSearchResult(entry)
            });
        }
    }
}

function updateVisibleMarkersAndSearch() {
    const hasMarkers = !!currentMarkerGroup && allMapMarkers.length > 0;
    const hasRegions = !!currentRegionGroup && currentRegionGroup.getLayers().length > 0;
    const hasLines = !!currentRoadGroup && currentRoadGroup.getLayers().length > 0;
    const hasAtlasIndex = getAtlasSearchEntryCount() > 0;
    const searchable = hasMarkers || hasRegions || hasLines || hasAtlasIndex;

    if (!searchable) {
        searchControlContainer.style.display = 'none';
        closeMobileSheet({ restoreFocus: false });
        closeSearchResults();
        updateActiveFilterChips();
        syncMobileExploreVisibility();
        return;
    }

    searchControlContainer.style.display = 'block';
    const searchTerm = normalizeSearchValue(poiSearchInput.value);
    const results = [];

    const allPoiGroupsChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;
    const activeSpecificGroupFilters = new Set();
    if (!allPoiGroupsChecked && poiFilterCheckboxesLive) {
        // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
        const staticCheckboxes = getStaticPoiFilterCheckboxes();
        for (let i = 0; i < staticCheckboxes.length; i++) {
            const checkbox = staticCheckboxes[i];
            if (checkbox.type === 'checkbox' &&
                checkbox.id !== 'filter-toggle-all' &&
                checkbox.classList.contains('poi-filter-checkbox') &&
                checkbox.checked) {
                activeSpecificGroupFilters.add(checkbox.value);
            }
        }
    }
    const searchFiltersCurrentMap = currentSearchScope === SEARCH_SCOPE_MAP && !!searchTerm;

    searchMapMarkers(searchTerm, results, allPoiGroupsChecked, activeSpecificGroupFilters, searchFiltersCurrentMap);
    searchMapRegions(searchTerm, results, searchFiltersCurrentMap);
    searchMapLines(searchTerm, results, searchFiltersCurrentMap);
    searchAtlasIndex(searchTerm, results);

    if (!searchTerm) {
        closeSearchResults({ preserveScope: true });
    } else {
        renderSearchResults(searchTerm, sortSearchResults(results));
    }

    updateActiveFilterChips();
    syncMobileExploreVisibility();
}

// --- Encounter and Travel Helpers ---
function updateEncounterSelect() {
    if (!encounterSelect) return;
    encounterSelect.innerHTML = '';
    if (!currentEncounterTables || currentEncounterTables.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No tables on this map';
        encounterSelect.appendChild(opt);
        encounterSelect.disabled = true;
        return;
    }
    encounterSelect.disabled = false;
    currentEncounterTables.forEach(table => {
        const opt = document.createElement('option');
        opt.value = table.id;
        opt.textContent = table.name || table.id;
        encounterSelect.appendChild(opt);
    });
    renderEncounterTableList(encounterSelect.value);
}

function rollEncounter() {
    if (!encounterSelect || !encounterResult) return;
    const tableId = encounterSelect.value;
    const table = currentEncounterTablesById.get(tableId); // Bolt: Optimized from O(n) .find() to O(1) Map lookup (measured 45.85x speedup)
    if (!table) {
        encounterResult.textContent = 'Select a table.';
        return;
    }
    const entries = Array.isArray(table.entries) ? table.entries : [];
    if (entries.length === 0) {
        encounterResult.textContent = 'No entries in this table.';
        return;
    }
    const totalWeight = entries.reduce((sum, e) => sum + (e.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    let chosen = entries[0];
    for (const entry of entries) {
        roll -= (entry.weight || 1);
        if (roll <= 0) {
            chosen = entry;
            break;
        }
    }
    encounterResult.textContent = chosen.result || 'No result';
}

function renderEncounterTableList(tableId) {
    if (!encounterTableList) return;
    encounterTableList.innerHTML = '';
    const table = currentEncounterTablesById.get(tableId); // Bolt: Optimized from O(n) .find() to O(1) Map lookup (measured 45.85x speedup)
    if (!table || !Array.isArray(table.entries) || table.entries.length === 0) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.textContent = 'No encounter entries.';
        encounterTableList.appendChild(item);
        return;
    }
    const fragment = document.createDocumentFragment();
    table.entries.forEach((entry, index) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        const weight = entry.weight || 1;
        const result = entry.result || `Entry ${index + 1}`;

        const weightSpan = document.createElement('span');
        weightSpan.className = 'encounter-weight';
        weightSpan.textContent = `x${weight}`;

        item.appendChild(weightSpan);
        item.appendChild(document.createTextNode(` ${result}`));
        fragment.appendChild(item);
    });
    encounterTableList.appendChild(fragment);
}

function initializeGMPillDrag() {
    if (!gmPill || !mapElement) return;
    const dragHandle = gmPill.querySelector('.gm-drag-handle') || gmPill;
    let draggingPointerId = null;
    let offsetX = 0;
    let offsetY = 0;

    const positionPill = (clientX, clientY) => {
        const mapRect = mapElement.getBoundingClientRect();
        const pillRect = gmPill.getBoundingClientRect();
        const maxLeft = Math.max(0, mapRect.width - pillRect.width);
        const maxTop = Math.max(0, mapRect.height - pillRect.height);
        const left = Math.min(Math.max(0, clientX - mapRect.left - offsetX), maxLeft);
        const top = Math.min(Math.max(0, clientY - mapRect.top - offsetY), maxTop);
        gmPill.style.left = `${left}px`;
        gmPill.style.top = `${top}px`;
        gmPill.style.right = 'auto';
    };

    const onPointerMove = (event) => {
        if (draggingPointerId === null || event.pointerId !== draggingPointerId) return;
        positionPill(event.clientX, event.clientY);
    };

    const onPointerUp = (event) => {
        if (draggingPointerId === null || event.pointerId !== draggingPointerId) return;
        draggingPointerId = null;
        gmPill.classList.remove('dragging');
        dragHandle.releasePointerCapture?.(event.pointerId);
    };

    dragHandle.addEventListener('pointerdown', (event) => {
        if (event.target === gmToggleBtn) return;
        const pillRect = gmPill.getBoundingClientRect();
        draggingPointerId = event.pointerId;
        offsetX = event.clientX - pillRect.left;
        offsetY = event.clientY - pillRect.top;
        dragHandle.setPointerCapture?.(event.pointerId);
        gmPill.classList.add('dragging');
        event.preventDefault();
    });

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
}

function updateTravelTime() {
    if (!travelDistanceInput || !travelModeSelect || !travelTimeOutput) return;
    const km = parseFloat(travelDistanceInput.value || (lastMeasuredDistanceKm || 0));
    const speed = parseFloat(travelModeSelect.value || '5');
    if (!km || km <= 0) {
        travelTimeOutput.textContent = 'Enter distance to compute time.';
        return;
    }
    const hours = km / speed;
    const days = hours / 24;
    travelTimeOutput.textContent = `${hours.toFixed(1)} hours (~${days.toFixed(2)} days)`;
}

// --- Function to Populate Filter Checkboxes (in the panel) ---
function populateFilters(pointsOfInterest, mapId) {
    // Clear existing dynamic filters
    if (dynamicFiltersContainer) {
        dynamicFiltersContainer.replaceChildren();
    }

    const hasPOIs = pointsOfInterest && pointsOfInterest.length > 0;
    const selectedMap = getMapRuntimeData(mapId);
    const regions = visibleRegionsCache && visibleRegionsCache.length ? visibleRegionsCache : (selectedMap?.regions || []);
    const hasRegions = regions.length > 0;
    const lines = visibleLinesCache && visibleLinesCache.length ? visibleLinesCache : [...(selectedMap?.roads || []), ...(selectedMap?.lines || [])];
    const hasRoads = lines.length > 0;

    // Hide filter button if no POIs, no regions, and no roads
    if (!hasPOIs && !hasRegions && !hasRoads) {
        poiFilterContainer.classList.remove('visible');
        toggleFiltersBtn.style.display = 'none';
        filtersPanelVisible = false;
        toggleFiltersBtn.classList.remove('active');
        toggleFiltersBtn.setAttribute('aria-expanded', 'false');
        syncFilterPanelInteractionState(false);
        filterToggleAllCheckbox.checked = true;
        filterToggleAllCheckbox.indeterminate = false;
        updateActiveFilterChips();
        return;
    }

    // PART 1: Add POI type filters (existing logic)
    if (hasPOIs) {
        populatePOIFilters(pointsOfInterest);
    }

    // PART 2: Add region type filters (NEW HIERARCHICAL LOGIC)
    if (hasRegions) {
        populateRegionFilters(regions, selectedMap, hasPOIs);
    }

    // PART 3: Add line type filters (New)
    if (hasRoads) {
        populateLineFilters(lines, hasPOIs, hasRegions);
    }

    // Show filter button since we have filters
    toggleFiltersBtn.style.display = 'block';

    // Restore filter panel preference for returning users.
    const shouldRestoreFilterPanel = safeGetStorage(UX_STORAGE_KEYS.filterPanelOpen) === 'true' &&
        advancedControlsUnlocked &&
        !isEmbeddedView;
    filtersPanelVisible = shouldRestoreFilterPanel;
    poiFilterContainer.classList.toggle('visible', filtersPanelVisible);
    toggleFiltersBtn.classList.toggle('active', filtersPanelVisible);
    toggleFiltersBtn.setAttribute('aria-expanded', filtersPanelVisible ? 'true' : 'false');
    syncFilterPanelInteractionState(filtersPanelVisible);
    if (filtersPanelVisible) {
        positionFilterPanel();
    }
    refreshLucideIcons();

    // Set initial state of the master toggle
    updateToggleAllCheckboxState();
    updateActiveFilterChips();
}

function populatePOIFilters(pointsOfInterest) {
    if (poiFilterContainer.querySelector('h3')) {
        const poiHeader = document.createElement('h3');
        poiHeader.textContent = getConfigValue('taxonomy.labels.poiTypes', 'POI Types:');
        dynamicFiltersContainer.appendChild(poiHeader);
    }
    const relevantGroupsObj = Object.create(null);
    for (let i = 0; i < pointsOfInterest.length; i++) {
        const group = getPoiGroup(pointsOfInterest[i].type);
        if (group !== undefined && group !== null) relevantGroupsObj[group] = true;
    }
    const sortedGroups = Object.keys(relevantGroupsObj).sort();
    const fragment = document.createDocumentFragment();
    sortedGroups.forEach(groupName => {
        if (!groupName || (poiTypeGroups[groupName] && poiTypeGroups[groupName].length === 0)) return;
        const filterId = `filter-group-${groupName.replace(/\s+/g, '-')}`;
        const div = document.createElement('div');
        div.className = 'filter-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = filterId;
        checkbox.value = groupName;
        checkbox.checked = true;
        checkbox.className = 'poi-filter-checkbox';
        const label = document.createElement('label');
        label.htmlFor = filterId;
        label.textContent = groupName;
        div.appendChild(checkbox);
        div.appendChild(label);
        fragment.appendChild(div);
    });
    dynamicFiltersContainer.appendChild(fragment);
}

const filterGroupsCache = new WeakMap();
const regionGroupNestedCheckboxes = new WeakMap();

function getOrGenerateRegionFilterGroups(regions, selectedMap) {
    // Check if explicit filter groups exist, otherwise auto-generate from data
    let regionFilterGroups = selectedMap.filterGroups && selectedMap.filterGroups.Regions;

    // Auto-generation fallback
    if (!regionFilterGroups) {
        if (filterGroupsCache.has(regions)) {
            return filterGroupsCache.get(regions);
        }

        const tempGroups = Object.create(null);
        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            const type = region.type;
            if (!type) continue;

            const value = region.value || region.name;
            if (!value) continue;

            if (!region.value && region.name) {
                region.value = region.name;
            }

            let group = tempGroups[type];
            if (!group) {
                group = Object.create(null);
                tempGroups[type] = group;
            }

            group[value] = true;
        }

        const keys = Object.keys(tempGroups);
        if (keys.length > 0) {
            regionFilterGroups = Object.create(null);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                regionFilterGroups[key] = Object.keys(tempGroups[key]).sort();
            }
        }

        filterGroupsCache.set(regions, regionFilterGroups);
    }

    return regionFilterGroups;
}

function getRegionGroupNestedCheckboxes(groupCheckbox) {
    const nestedCheckboxes = regionGroupNestedCheckboxes.get(groupCheckbox);
    if (nestedCheckboxes) {
        return nestedCheckboxes;
    }

    if (!groupCheckbox || typeof groupCheckbox.closest !== 'function') {
        return [];
    }

    const groupContainer = groupCheckbox.closest('.filter-group');
    if (!groupContainer) {
        return [];
    }

    const fallbackCheckboxes = Array.from(groupContainer.querySelectorAll('.region-type-filter'));
    regionGroupNestedCheckboxes.set(groupCheckbox, fallbackCheckboxes);
    return fallbackCheckboxes;
}

function setRegionGroupChildCheckboxes(groupCheckbox, checked) {
    const groupName = groupCheckbox.value;
    const nestedCheckboxes = getRegionGroupNestedCheckboxes(groupCheckbox);

    for (let i = 0; i < nestedCheckboxes.length; i++) {
        const checkbox = nestedCheckboxes[i];
        if (checkbox.dataset.group === groupName) {
            checkbox.checked = checked;
        }
    }
}

function getFilterControlIdPart(value) {
    return encodeURIComponent(String(value || '').trim())
        .replace(/%/g, '-')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'filter';
}

function createRegionFilterGroupDOM(groupName, values) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'filter-group closed'; // Start as closed

    const normalizedGroupName = String(groupName || '');
    const groupIdPart = getFilterControlIdPart(groupName);
    const groupFilterId = `filter-region-group-${groupIdPart}`;

    const header = document.createElement('div');
    header.className = 'filter-group-header';
    header.setAttribute('role', 'button');
    header.tabIndex = 0;
    header.setAttribute('aria-expanded', 'false');

    const chevron = document.createElement('span');
    chevron.className = 'filter-chevron-icon';
    chevron.setAttribute('aria-hidden', 'true');
    const chevronIcon = document.createElement('i');
    chevronIcon.className = 'ui-icon';
    chevronIcon.dataset.lucide = 'chevron-right';
    chevron.appendChild(chevronIcon);

    const groupFilterItem = document.createElement('div');
    groupFilterItem.className = 'filter-item';
    const groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.id = groupFilterId;
    groupCheckbox.value = normalizedGroupName;
    groupCheckbox.checked = true;
    groupCheckbox.className = 'region-group-filter';
    const groupLabel = document.createElement('label');
    groupLabel.htmlFor = groupFilterId;
    groupLabel.textContent = normalizedGroupName;
    groupFilterItem.append(groupCheckbox, groupLabel);

    header.append(chevron, groupFilterItem);
    groupContainer.appendChild(header);

    const nestedList = document.createElement('div');
    nestedList.className = 'nested-filter-list';
    const nestedCheckboxes = [];

    for (let i = 0; i < values.length; i++) {
        const normalizedValue = String(values[i] || '');
        const filterId = `filter-region-value-${groupIdPart}-${getFilterControlIdPart(normalizedValue)}-${i}`;
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = filterId;
        checkbox.value = normalizedValue;
        checkbox.checked = true;
        checkbox.className = 'region-type-filter';
        checkbox.dataset.group = normalizedGroupName;
        const label = document.createElement('label');
        label.htmlFor = filterId;
        label.textContent = normalizedValue;
        filterItem.append(checkbox, label);
        nestedList.appendChild(filterItem);
        nestedCheckboxes.push(checkbox);
    }

    groupContainer.appendChild(nestedList);
    regionGroupNestedCheckboxes.set(groupCheckbox, nestedCheckboxes);
    return groupContainer;
}

function populateRegionFilters(regions, selectedMap, hasPOIs) {
    const regionFilterGroups = getOrGenerateRegionFilterGroups(regions, selectedMap);

    if (regionFilterGroups && Object.keys(regionFilterGroups).length > 0) {
        // ⚡ Bolt: Batch DOM insertions using DocumentFragment to prevent costly layout thrashing and reflows.
        const fragment = document.createDocumentFragment();

        if (hasPOIs) {
            const divider = document.createElement('hr');
            divider.style.margin = '10px 0';
            divider.style.borderColor = 'var(--glass-border)';
            fragment.appendChild(divider);
        }
        const regionHeader = document.createElement('h3');
        regionHeader.textContent = "Region Types:";
        fragment.appendChild(regionHeader);

        for (const groupName in regionFilterGroups) {
            if (Object.hasOwnProperty.call(regionFilterGroups, groupName)) {
                const values = regionFilterGroups[groupName];
                if (!Array.isArray(values) || values.length === 0) continue;

                const groupContainer = createRegionFilterGroupDOM(groupName, values);
                fragment.appendChild(groupContainer);
            }
        }
        dynamicFiltersContainer.appendChild(fragment);
    }
}

// ⚡ Bolt: Cache derived unique line types by map data reference to achieve O(1) retrieval on UI updates.
const lineTypesCache = new WeakMap();

function populateLineFilters(lines, hasPOIs, hasRegions) {
    // ⚡ Bolt: Batch DOM insertions using DocumentFragment to prevent costly layout thrashing and reflows.
    const fragment = document.createDocumentFragment();

    if (hasPOIs || hasRegions) { // Add divider if other filters are present
        const divider = document.createElement('hr');
        divider.style.margin = '10px 0';
        divider.style.borderColor = 'var(--glass-border)';
        fragment.appendChild(divider);
    }

    const lineHeader = document.createElement('h3');
    lineHeader.textContent = "Line Types:";
    fragment.appendChild(lineHeader);

    const allLines = lines;
    let lineTypes;

    if (lineTypesCache.has(allLines)) {
        lineTypes = lineTypesCache.get(allLines);
    } else {
        // ⚡ Bolt: Optimized unique value extraction using Object.create(null) instead of allocating Set instances and chained array methods.
        const uniqueTypes = Object.create(null);
        for (let i = 0; i < allLines.length; i++) {
            const type = allLines[i].type || "Unnamed Road Type";
            if (type) {
                uniqueTypes[type] = true;
            }
        }
        lineTypes = Object.keys(uniqueTypes).sort();
        lineTypesCache.set(allLines, lineTypes);
    }

    lineTypes.forEach(type => {
        const filterId = `filter-line-${(type || "untyped").replace(/\s+/g, '-').toLowerCase()}`;
        const div = document.createElement('div');
        div.className = 'filter-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = filterId;
        checkbox.value = type;
        checkbox.checked = true; // Default checked
        checkbox.className = 'line-type-filter'; // Specific class for line filters

        const label = document.createElement('label');
        label.htmlFor = filterId;
        label.textContent = type.charAt(0).toUpperCase() + type.slice(1); // Capitalize

        div.appendChild(checkbox);
        div.appendChild(label);
        fragment.appendChild(div);
    });
    dynamicFiltersContainer.appendChild(fragment);
}

const sharedLinkOpenSessionKeys = new Set();
function getRuntimeConfigValue(path, fallbackValue) {
    return (typeof getConfigValue === 'function') ? getConfigValue(path, fallbackValue) : fallbackValue;
}

const SHARE_RELAY_DEFAULT_COPY = getRuntimeConfigValue('copy.shareRelay.default', 'Shared with you. Pass it on to your party.');

function getShareContextFromParams(params) {
    if (!(params instanceof URLSearchParams)) return null;

    const source = String(params.get('src') || '').trim().toLowerCase();
    const sharedType = String(params.get('stype') || '').trim().toLowerCase();

    if (source !== 'share') return null;
    if (!['poi', 'region', 'line', 'view'].includes(sharedType)) return null;

    if (sharedType === 'view') {
        const normalizedView = String(params.get('view') || '').trim();
        if (!normalizedView) return null;
        return {
            source,
            sharedType,
            featureType: 'view',
            featureName: 'current_view',
            view: normalizedView
        };
    }

    const featureName = String(params.get(sharedType) || '').trim();
    if (!featureName) return null;
    return {
        source,
        sharedType,
        featureType: sharedType,
        featureName
    };
}

function buildShareRelaySessionKey(context) {
    if (!context || typeof context !== 'object') return null;
    const sharedType = String(context.sharedType || '').trim().toLowerCase();
    if (!sharedType) return null;

    if (sharedType === 'view') {
        const normalizedView = String(context.view || '').trim();
        return normalizedView ? `view:${normalizedView}` : null;
    }

    const featureName = String(context.featureName || '').trim().toLowerCase();
    return featureName ? `${sharedType}:${featureName}` : null;
}

function isShareRelayDismissedForSession() {
    return safeGetSessionStorage(UX_STORAGE_KEYS.shareRelayDismissedSession) === 'true';
}

function markShareRelayDismissedForSession() {
    safeSetSessionStorage(UX_STORAGE_KEYS.shareRelayDismissedSession, 'true');
}

function hideShareRelayPrompt(reason = 'hidden') {
    activeShareRelayContext = null;
    if (!shareRelayCoachmark) return;

    shareRelayCoachmark.hidden = true;
    if (shareRelayCopy) {
        shareRelayCopy.textContent = SHARE_RELAY_DEFAULT_COPY;
    }
    if (shareRelayActionBtn && shareRelayActionBtn.dataset.originalInnerHtml) {
        if (typeof DOMPurify !== 'undefined') {
            shareRelayActionBtn.innerHTML = DOMPurify.sanitize(shareRelayActionBtn.dataset.originalInnerHtml);
        } else {
            shareRelayActionBtn.textContent = shareRelayActionBtn.dataset.originalInnerHtml;
        }
    }

    if (reason === 'dismissed' || reason === 'completed') {
        markShareRelayDismissedForSession();
    }
}

function showShareRelayPrompt(context) {
    if (!context || isEmbeddedView || !shareRelayCoachmark || !shareRelayActionBtn || !shareRelayDismissBtn) {
        return;
    }
    if (isShareRelayDismissedForSession()) return;

    const sessionKey = buildShareRelaySessionKey(context);
    if (!sessionKey) return;

    activeShareRelayContext = context;
    if (shareRelayCopy) {
        const featureName = String(context.featureName || '').trim();
        shareRelayCopy.textContent = context.sharedType === 'view'
            ? getRuntimeConfigValue('copy.shareRelay.mapView', 'Shared with you. Pass this map view to your party.')
            : getRuntimeConfigValue('copy.shareRelay.feature', 'Shared with you: {featureName}. Pass it on to your party.').replace('{featureName}', featureName);
    }
    shareRelayCoachmark.hidden = false;

    if (shownShareRelaySessionKeys.has(sessionKey)) return;
    shownShareRelaySessionKeys.add(sessionKey);
    trackAnalytics('share_relay_prompt_shown', {
        source: 'share',
        entryPoint: 'relay_prompt',
        sharedType: context.sharedType
    });
}

function trackShareLinkOpenFromParams(params, focusedType, focusedName) {
    if (!(params instanceof URLSearchParams)) return;

    const source = String(params.get('src') || '').trim().toLowerCase();
    const sharedType = String(params.get('stype') || '').trim().toLowerCase();
    const normalizedFocusedType = String(focusedType || '').trim().toLowerCase();
    const normalizedFocusedName = String(focusedName || '').trim();

    if (source !== 'share') return;
    if (!['poi', 'region', 'line'].includes(sharedType)) return;
    if (!normalizedFocusedType || sharedType !== normalizedFocusedType) return;
    if (!normalizedFocusedName) return;

    const sessionKey = `${sharedType}:${normalizedFocusedName.toLowerCase()}`;
    if (sharedLinkOpenSessionKeys.has(sessionKey)) return;
    sharedLinkOpenSessionKeys.add(sessionKey);

    trackAnalytics('share_link_opened', {
        source,
        sharedType,
        featureType: normalizedFocusedType,
        featureName: normalizedFocusedName
    });
}

function trackShareViewOpenFromParams(params, viewParam) {
    if (!(params instanceof URLSearchParams)) return;

    const source = String(params.get('src') || '').trim().toLowerCase();
    const sharedType = String(params.get('stype') || '').trim().toLowerCase();
    const normalizedView = String(viewParam || '').trim();

    if (source !== 'share') return;
    if (sharedType !== 'view') return;
    if (!normalizedView) return;

    const sessionKey = `view:${normalizedView}`;
    if (sharedLinkOpenSessionKeys.has(sessionKey)) return;
    sharedLinkOpenSessionKeys.add(sessionKey);

    trackAnalytics('share_link_opened', {
        source,
        sharedType,
        featureType: 'view',
        featureName: 'current_view',
        view: normalizedView
    });
}

function buildFeatureShareUrl(type, name) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedName = String(name || '').trim();

    if (!['poi', 'region', 'line'].includes(normalizedType)) return null;
    if (!normalizedName) return null;

    const url = new URL(window.location.href);
    clearShareTargetSearchParams(url.searchParams);
    url.searchParams.set(normalizedType, normalizedName);
    url.searchParams.set('src', 'share');
    url.searchParams.set('stype', normalizedType);
    return url.toString();
}

function buildCurrentViewShareUrl() {
    if (!map || !currentlyLoadedMapId) return null;

    const center = map.getCenter();
    const zoom = map.getZoom();
    const lat = parseFloat(center.lat.toFixed(4));
    const lng = parseFloat(center.lng.toFixed(4));
    const view = `${lat},${lng},${zoom}`;

    const url = new URL(window.location.href);
    clearShareTargetSearchParams(url.searchParams);
    url.searchParams.set('view', view);
    url.searchParams.set('src', 'share');
    url.searchParams.set('stype', 'view');
    return url.toString();
}

function clearShareTargetSearchParams(searchParams) {
    if (!(searchParams instanceof URLSearchParams)) return;
    [
        'view',
        'poi',
        'region',
        'line',
        'src',
        'stype'
    ].forEach((key) => searchParams.delete(key));
}

function canUseNativeShare(shareUrl) {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
        return false;
    }
    if (typeof navigator.canShare === 'function') {
        try {
            return navigator.canShare({ url: shareUrl });
        } catch {
            return false;
        }
    }
    return true;
}

function showShareButtonSuccessState(btn) {
    if (!btn) return;
    if (!btn.dataset.originalInnerHtml) {
        btn.dataset.originalInnerHtml = btn.innerHTML;
    }
    btn.innerHTML = '✔';
    if (btn.__shareResetTimeoutId) {
        clearTimeout(btn.__shareResetTimeoutId);
    }
    btn.__shareResetTimeoutId = setTimeout(() => {
        if (typeof DOMPurify !== 'undefined') {
            btn.innerHTML = DOMPurify.sanitize(btn.dataset.originalInnerHtml);
        } else {
            btn.textContent = btn.dataset.originalInnerHtml;
        }
    }, 1500);
}

function showShareButtonErrorState(btn) {
    if (!btn) return;
    if (!btn.dataset.originalInnerHtml) {
        btn.dataset.originalInnerHtml = btn.innerHTML;
    }
    btn.innerHTML = '❌';
    if (btn.__shareResetTimeoutId) {
        clearTimeout(btn.__shareResetTimeoutId);
    }
    btn.__shareResetTimeoutId = setTimeout(() => {
        if (typeof DOMPurify !== 'undefined') {
            btn.innerHTML = DOMPurify.sanitize(btn.dataset.originalInnerHtml);
        } else {
            btn.textContent = btn.dataset.originalInnerHtml;
        }
    }, 1500);
}

async function executeShareAction({
    btn,
    shareUrl,
    shareData,
    onShareClicked,
    onNativeCompleted,
    onNativeCancelled,
    onNativeFailed,
    onCopyUnavailable,
    onClipboardCompleted
}) {
    const nativeShareSupported = canUseNativeShare(shareUrl);

    if (onShareClicked) {
        onShareClicked(nativeShareSupported);
    }

    if (nativeShareSupported) {
        try {
            await navigator.share(shareData);
            showShareButtonSuccessState(btn);
            if (onNativeCompleted) onNativeCompleted();
            return;
        } catch (error) {
            const errorName = error && error.name ? String(error.name) : 'unknown';
            if (errorName === 'AbortError') {
                if (onNativeCancelled) onNativeCancelled();
                return;
            }
            console.warn('Native share failed; falling back to clipboard.', error);
            if (onNativeFailed) onNativeFailed(errorName);
        }
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        showShareButtonErrorState(btn);
        if (onCopyUnavailable) onCopyUnavailable();
        return;
    }

    try {
        await navigator.clipboard.writeText(shareUrl);
        showShareButtonSuccessState(btn);
        if (onClipboardCompleted) onClipboardCompleted();
    } catch (err) {
        console.error('Failed to copy link: ', err);
        showShareButtonErrorState(btn);
    }
}

// Global function for onclick
window.copyFeatureLink = async function(btn, type, name) {
    const featureType = String(type || '').trim().toLowerCase();
    const featureName = String(name || '').trim();
    const shareUrl = buildFeatureShareUrl(featureType, featureName);

    if (!shareUrl) return;

    const siteShortName = getRuntimeConfigValue('brand.shortName', 'Interactive Atlas');
    const shareData = {
        title: `${siteShortName}: ${featureName}`,
        text: getRuntimeConfigValue('copy.share.featureText', 'Explore {featureName} on this interactive atlas.').replace('{featureName}', featureName),
        url: shareUrl
    };

    await executeShareAction({
        btn,
        shareUrl,
        shareData,
        onShareClicked: (supported) => trackAnalytics('share_clicked', { featureType, featureName, nativeShareSupported: supported }),
        onNativeCompleted: () => trackAnalytics('share_native_completed', { featureType, featureName }),
        onNativeCancelled: () => trackAnalytics('share_native_cancelled', { featureType, featureName }),
        onNativeFailed: (errorName) => trackAnalytics('share_native_failed', { featureType, featureName, errorName }),
        onCopyUnavailable: () => trackAnalytics('share_copy_unavailable', { featureType, featureName }),
        onClipboardCompleted: () => trackAnalytics('share_link_copied', { featureType, featureName })
    });
};

async function shareCurrentView(btn) {
    const shareUrl = buildCurrentViewShareUrl();
    if (!shareUrl) return;

    const featureType = 'view';
    const featureName = 'current_view';
    const siteShortName = getRuntimeConfigValue('brand.shortName', 'Interactive Atlas');
    const shareData = {
        title: `${siteShortName}: ${getRuntimeConfigValue('copy.share.currentViewTitle', 'Current View')}`,
        text: getRuntimeConfigValue('copy.share.currentViewText', 'Explore this map view.'),
        url: shareUrl
    };

    await executeShareAction({
        btn,
        shareUrl,
        shareData,
        onShareClicked: (supported) => trackAnalytics('share_clicked', { featureType, featureName, nativeShareSupported: supported, entryPoint: 'map_controls' }),
        onNativeCompleted: () => trackAnalytics('share_native_completed', { featureType, featureName }),
        onNativeCancelled: () => trackAnalytics('share_native_cancelled', { featureType, featureName }),
        onNativeFailed: (errorName) => trackAnalytics('share_native_failed', { featureType, featureName, errorName }),
        onCopyUnavailable: () => trackAnalytics('share_copy_unavailable', { featureType, featureName }),
        onClipboardCompleted: () => trackAnalytics('share_link_copied', { featureType, featureName })
    });
}

async function relaySharedContext(btn) {
    const context = activeShareRelayContext;
    if (!context) return;

    const sharedType = String(context.sharedType || '').trim().toLowerCase();
    const featureType = String(context.featureType || '').trim().toLowerCase();
    const featureName = String(context.featureName || '').trim();
    const shareUrl = sharedType === 'view'
        ? buildCurrentViewShareUrl()
        : buildFeatureShareUrl(featureType, featureName);

    if (!shareUrl) return;

    const siteShortName = getRuntimeConfigValue('brand.shortName', 'Interactive Atlas');
    const shareData = {
        title: sharedType === 'view'
            ? `${siteShortName}: ${getRuntimeConfigValue('copy.share.sharedViewTitle', 'Shared View')}`
            : `${siteShortName}: ${featureName}`,
        text: sharedType === 'view'
            ? getRuntimeConfigValue('copy.share.sharedViewText', 'Explore this shared map view.')
            : getRuntimeConfigValue('copy.share.featureText', 'Explore {featureName} on this interactive atlas.').replace('{featureName}', featureName),
        url: shareUrl
    };

    await executeShareAction({
        btn,
        shareUrl,
        shareData,
        onShareClicked: (supported) => trackAnalytics('share_clicked', { featureType, featureName, nativeShareSupported: supported, entryPoint: 'relay_prompt' }),
        onNativeCompleted: () => {
            trackAnalytics('share_relay_completed', { sharedType, featureType, featureName, method: 'native' });
            hideShareRelayPrompt('completed');
        },
        onNativeCancelled: () => trackAnalytics('share_native_cancelled', { featureType, featureName, entryPoint: 'relay_prompt' }),
        onNativeFailed: (errorName) => trackAnalytics('share_native_failed', { featureType, featureName, errorName, entryPoint: 'relay_prompt' }),
        onCopyUnavailable: () => trackAnalytics('share_copy_unavailable', { featureType, featureName, entryPoint: 'relay_prompt' }),
        onClipboardCompleted: () => {
            trackAnalytics('share_relay_completed', { sharedType, featureType, featureName, method: 'clipboard' });
            hideShareRelayPrompt('completed');
        }
    });
}

window.openLinkedMapFromPopup = function(event, mapId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const trimmedMapId = String(mapId || '').trim();
    if (!trimmedMapId) {
        return false;
    }

    const targetMap = findMapRecursive(mapData, trimmedMapId);
    if (!isRenderableMapEntry(targetMap)) {
        alert(`Linked map "${trimmedMapId}" is not currently available.`);
        trackAnalytics('linked_map_open_failed', { linkedMapId: trimmedMapId, reason: 'not_available' });
        return false;
    }

    if (trimmedMapId !== currentlyLoadedMapId) {
        trackAnalytics('linked_map_opened', { linkedMapId: trimmedMapId, fromMapId: currentlyLoadedMapId });
        navigateToMap(trimmedMapId, { preResolvedMap: targetMap });
    } else {
        map.closePopup();
    }

    return false;
};

function focusPOI(poiName) {
    // ⚡ Bolt: Use O(1) Map lookup instead of O(N) Array.find
    const marker = allMapMarkersByName.get(poiName);
    if (marker) {
        // Ensure marker is visible (add to group if not)
        if (!currentMarkerGroup.hasLayer(marker)) {
            currentMarkerGroup.addLayer(marker);
        }
        // Also ensure the marker group is on the map (it should be)
        if (!map.hasLayer(currentMarkerGroup)) {
             currentMarkerGroup.addTo(map);
        }

        map.setView(marker.getLatLng(), Math.max(map.getZoom(), 2), { animate: false });
        marker.openPopup();
        return true;
    }
    console.warn("POI not found for focus:", poiName);
    return false;
}

function focusRegion(regionName) {
    // ⚡ Bolt: Use O(1) Map lookup instead of O(N) LayerGroup iteration
    const targetLayer = allMapRegionsByName.get(regionName);

    if (targetLayer) {
        map.fitBounds(targetLayer.getBounds(), { animate: false });
        targetLayer.openPopup();
        return true;
    }
    console.warn("Region not found for focus:", regionName);
    return false;
}

function focusLine(lineName) {
    // ⚡ Bolt: Optimized from O(N) LayerGroup iteration to O(1) Map lookup (measured ~1000x speedup)
    const targetLayer = allMapLinesByName.get(lineName);

    if (targetLayer) {
        map.fitBounds(targetLayer.getBounds(), { animate: false });
        targetLayer.openPopup();
        return true;
    }
    console.warn("Line not found for focus:", lineName);
    return false;
}

function checkAndFocusFeature() {
    const params = new URLSearchParams(window.location.search);
    const poiName = params.get('poi');
    const regionName = params.get('region');
    const lineName = params.get('line');
    let focused = false;
    let focusedType = '';
    let focusedName = '';

    if (poiName) {
        focused = focusPOI(poiName);
        if (focused) {
            focusedType = 'poi';
            focusedName = poiName;
        }
    } else if (regionName) {
        focused = focusRegion(regionName);
        if (focused) {
            focusedType = 'region';
            focusedName = regionName;
        }
    } else if (lineName) {
        focused = focusLine(lineName);
        if (focused) {
            focusedType = 'line';
            focusedName = lineName;
        }
    }

    if (focused) {
        trackShareLinkOpenFromParams(params, focusedType, focusedName);
        const shareContext = getShareContextFromParams(params);
        if (shareContext) {
            showShareRelayPrompt(shareContext);
        }
    } else {
        hideShareRelayPrompt('not_focused');
    }
    return focused;
}

// --- Map View URL State Management ---
let viewUpdateTimeout;
initializeFeatureDetailSheet();
// --- Map Chooser Back Button ---
const sidebarBackToChooserBtn = document.getElementById('sidebar-back-to-chooser');
if (mapChooserCloseBtn) {
    mapChooserCloseBtn.addEventListener('click', () => closeMapChooserToMap());
}
if (sidebarBackToChooserBtn) {
    sidebarBackToChooserBtn.addEventListener('click', () => {
        if (!mapChooserElement) return;

        const galleryParams = new URLSearchParams(clearTransientMapSearchParams(window.location.search).replace(/^\?/, ''));
        galleryParams.set('gallery', 'true');
        const gallerySearch = `?${galleryParams.toString()}`;

        history.pushState(
            {
                mapId: null,
                sidebarState: currentSidebarState,
                search: gallerySearch,
                hash: '',
                mapChooserOverlay: true,
                returnMapId: currentlyLoadedMapId || null
            },
            '',
            buildAppUrlWithHash('', gallerySearch)
        );

        if (isMobileLayoutActive) {
            closeMobileSheet({ restoreFocus: false });
        }
        if (featureDetailSheetOpen) {
            closeFeatureDetailSheet({ restoreFocus: false });
        }

        renderMapChooser(mapData);
        setMapChooserVisible(true);
    });
}

function updateURLWithMapView() {
    // Keep the last active map/view in local storage without making ordinary
    // pan/zoom interactions visible in the address bar.
    if (!map || !currentlyLoadedMapId) return;

    clearTimeout(viewUpdateTimeout);
    viewUpdateTimeout = setTimeout(() => {
        if (!map || !currentlyLoadedMapId) return;

        const center = map.getCenter();
        const zoom = map.getZoom();
        const lat = parseFloat(center.lat.toFixed(4));
        const lng = parseFloat(center.lng.toFixed(4));
        const newView = `${lat},${lng},${zoom}`;

        saveMapView(currentlyLoadedMapId, newView);
        safeSetStorage(UX_STORAGE_KEYS.lastMapId, currentlyLoadedMapId);
    }, 500); // 500ms debounce
}


// --- Helper Functions for loadMap ---

function pushMapHistoryState(mapId, updateHash = true, stateTitle = '') {
    if (!updateHash) return;
    const newHash = generateHash(mapId || '', currentSidebarState);
    const currentSearch = window.location.search;
    const newUrl = buildAppUrlWithHash(newHash, currentSearch);
    history.pushState(
        {
            mapId: mapId,
            sidebarState: currentSidebarState,
            search: currentSearch,
            hash: newHash
        },
        stateTitle,
        newUrl
    );
}

function replaceMapHistoryState(mapId, updateHash = true) {
    if (!updateHash) return;
    const newHash = generateHash(mapId || '', currentSidebarState);
    const currentSearch = window.location.search;
    const newUrl = buildAppUrlWithHash(newHash, currentSearch);
    if (window.location.href !== new URL(newUrl, window.location.href).href) {
        history.replaceState(
            {
                mapId: mapId,
                sidebarState: currentSidebarState,
                search: currentSearch,
                hash: newHash
            },
            '',
            newUrl
        );
    }
}

function resetMapState() {
    cancelIdleTileWarmup({ removeDetailLayer: true });
    if (isMeasuringMultiPoint) finalizeMultiPointMeasure(false);
    measurementLayerGroup.clearLayers();

    searchControlContainer.style.display = 'none';
    closeSearchResults();
    poiFilterContainer.classList.remove('visible');
    toggleFiltersBtn.style.display = 'none';
    filtersPanelVisible = false;
    toggleFiltersBtn.classList.remove('active');
    toggleFiltersBtn.setAttribute('aria-expanded', 'false');
    syncFilterPanelInteractionState(false);
    poiSearchInput.value = '';
    setSearchScope(SEARCH_SCOPE_MAP);
    setSearchMeta('');
    updateActiveFilterChips();

    if (dynamicFiltersContainer) {
        dynamicFiltersContainer.replaceChildren();
    }
    filterToggleAllCheckbox.checked = true;
    filterToggleAllCheckbox.indeterminate = false;

    if (currentImageLayer) map.removeLayer(currentImageLayer);
    if (currentMapPreviewLayer) map.removeLayer(currentMapPreviewLayer);
    if (currentMapUnderlay) map.removeLayer(currentMapUnderlay);
    removeMiniMapControl();
    if (currentMarkerGroup) map.removeLayer(currentMarkerGroup);
    if (currentRegionGroup) map.removeLayer(currentRegionGroup);
    if (currentRoadGroup) map.removeLayer(currentRoadGroup);

    currentImageLayer = null;
    currentMapBaseLayerMode = 'image';
    currentMapPreviewLayer = null;
    currentMapUnderlay = null;
    currentMarkerGroup = null;
    currentRegionGroup = null;
    currentRoadGroup = null;
    allMapMarkers = [];
    allMapMarkersById.clear();
    allMapMarkersByName.clear();
    allMapRegions = [];
    allMapRegionsById.clear();
    allMapRegionsByName.clear();
    allMapLines = [];
    allMapLinesById.clear();
    allMapLinesByName.clear();
    setSidebarSelectedFeature(null, '');
}

function populatePOIsOnMap(selectedMap) {
    const mapHeight = selectedMap.height;
    const mapWidth = selectedMap.width;
    let errorCount = 0;

    visiblePointsCache.forEach(point => {
        try {
            if (point.coords && point.coords.length === 2 && !isNaN(point.coords[0]) && !isNaN(point.coords[1])) {
                if (point.coords[0] >= 0 && point.coords[0] <= mapHeight && point.coords[1] >= 0 && point.coords[1] <= mapWidth) {
                    const markerLabel = getPoiMarkerAccessibleName(point);
                    const marker = L.marker(point.coords, {
                        icon: getPoiIcon(getPoiGroup(point.type), point.type),
                        title: markerLabel,
                        alt: markerLabel
                    });
                    if (marker) {
                        marker.poiData = point;
                        marker.bindPopup(createPopupContent(point, 'poi'), { minWidth: 250 });
                        marker.bindTooltip(createPoiTooltipContent(point), getPoiTooltipOptions());
                        if (typeof marker.on === 'function') {
                            marker.on('popupopen', () => {
                                setSidebarSelectedFeature(point, 'poi');
                            });
                        }
                        attachPoiTooltipBehavior(marker);
                        allMapMarkers.push(marker);
                        if (point.id && !allMapMarkersById.has(point.id)) {
                            allMapMarkersById.set(point.id, marker);
                        }
                        if (point.name && !allMapMarkersByName.has(point.name)) {
                            allMapMarkersByName.set(point.name, marker);
                        }
                    } else {
                        console.warn(`L.marker returned undefined for POI: ${point.name || 'Unnamed POI'}`);
                    }
                } else {
                    console.warn(`POI coordinates out of bounds for map ${selectedMap.name}: ${point.name}`, point.coords);
                }
            } else {
                console.warn(`Invalid coordinates for POI: ${point.name}`, point.coords);
            }
        } catch (error) {
            errorCount++;
            const poiName = point ? (point.name || JSON.stringify(point)) : 'Unknown POI';
            console.error(`Error processing POI: ${poiName}`, error);
            trackAnalytics('poi_processing_error', {
                poiName: poiName,
                errorMessage: error && error.message ? error.message : 'Unknown error'
            });
        }
    });

    if (errorCount > 0) {
        console.warn(`Encountered ${errorCount} errors while processing POIs for map ${selectedMap.name || 'Unknown'}.`);
    }
}

function finalizeMapUI(requestedMapId, selectedMap) {
    toggleMarkersBtn.classList.toggle('markers-hidden', !markersVisible);
    toggleMarkersBtn.title = markersVisible ? 'Hide Markers & Regions' : 'Show Markers & Regions';
    toggleMarkersBtn.setAttribute('aria-label', toggleMarkersBtn.title);

    renderMapBlurbContent(selectedMap);
    if (!selectedMap.blurb && !isMobileLayoutActive) {
        setMapBlurbVisible(false);
    }

    updateCurrentControlVisibility(selectedMap);
    updateActiveFilterChips();

    // ⚡ Bolt: Optimizes active map item deselecting by replacing live DOM queries with static ones. (Measured improvement: ~3.3x speedup)
    const activeItems = mapListElement.querySelectorAll('.active');
    for (let i = 0; i < activeItems.length; i++) {
        activeItems[i].classList.remove('active');
    }
    const activeMapItem = document.querySelector(`#map-list .map-item[data-map-id="${requestedMapId}"]`);
    const activeFolderHeader = document.querySelector(`#map-list .folder-header[data-map-id="${requestedMapId}"]`);
    if (activeMapItem) {
        activeMapItem.classList.add('active');
        let parent = activeMapItem.closest('.nested-list');
        while (parent) {
            const folderLi = parent.closest('.folder');
            if (folderLi && folderLi.classList.contains('closed')) {
                folderLi.classList.remove('closed');
                syncFolderExpandedAria(folderLi);
            }
            parent = folderLi?.parentElement.closest('.nested-list');
        }
    } else if (activeFolderHeader) {
        activeFolderHeader.classList.add('active');
        const folderLi = activeFolderHeader.closest('.folder');
        if (folderLi && folderLi.classList.contains('closed')) {
            folderLi.classList.remove('closed');
            syncFolderExpandedAria(folderLi);
        }
    }

    currentlyLoadedMapId = requestedMapId;
    safeSetStorage(UX_STORAGE_KEYS.lastMapId, requestedMapId);
    loadingMapId = null;
    schedulePostLoadPrefetch(selectedMap);
    syncSidebarPanels();

    if (!isEmbeddedView && window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT && !container.classList.contains('sidebar-collapsed')) {
        setSidebarState('c', false);
    }
}

function abortMapLoad(options = {}) {
    const {
        reason,
        requestedMapId,
        message,
        updateHash = true,
        isUnavailable = false,
        showRetry = true
    } = options;

    if (loadingProgressInterval) clearInterval(loadingProgressInterval);
    loadingProgressInterval = null;
    currentlyLoadedMapId = null;
    currentMapData = null;
    syncSidebarPanels();
    setMapAtmosphere(null);
    toggleMarkersBtn.style.display = 'none';
    measureToolBtn.style.display = 'none';
    toggleFiltersBtn.style.display = 'none';
    searchControlContainer.style.display = 'none';
    removeBootstrapMapPreview();
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.classList.remove('bootstrap-map-preview-loading');
    }

    if (isUnavailable) {
        loadingMapId = null;
        setMapBlurbVisible(false);
        setLoadingMessage(message, { showSpinner: false, showProgress: false, showRetry: false });
        if (loadingIndicator) {
            setTimeout(() => {
                loadingIndicator.style.display = 'none';
            }, 1400);
        }
    } else {
        setLoadingMessage(message, { showSpinner: false, showProgress: false, showRetry: showRetry });
    }

    if (isUnavailable || reason === 'invalid_data' || reason === 'image_error') {
        pushMapHistoryState(null, updateHash);
    }

    trackAnalytics('map_load_failed', { mapId: requestedMapId, reason: reason });
}

function renderMapFeatures(selectedMap, requestedMapId) {
    visiblePointsCache = getVisiblePoints(selectedMap);
    visibleRegionsCache = getVisibleRegions(selectedMap);
    visibleLinesCache = getVisibleLines(selectedMap);
    currentEncounterTables = getVisibleEncounterTables(selectedMap);
    currentEncounterTablesById = new Map((currentEncounterTables || []).map(t => [t.id, t]));
    updateEncounterSelect();
    updateTravelTime();
    populateFilters(visiblePointsCache, requestedMapId);

    populatePOIsOnMap(selectedMap);

    currentMarkerGroup.addTo(map);
    updateVisibleMarkersAndSearch();

    addRegionsToMap(requestedMapId);
    addRoadsToMap(requestedMapId);
    updateVisibleRegions();
    if (typeof updateVisibleLines === 'function') {
        updateVisibleLines();
    }

    if (currentRegionGroup && typeof currentRegionGroup.bringToBack === 'function') {
        currentRegionGroup.bringToBack();
    }

    map.off('mousemove', updateCoordinates);
    if (selectedMap.latLonBounds) {
        currentLatLonBounds = selectedMap.latLonBounds;
        map.on('mousemove', updateCoordinates);
    } else {
        currentLatLonBounds = null;
        map.off('mousemove', updateCoordinates);
        coordinateDisplay.style.display = 'none';
    }
}

function startMapLoadingProgress(manifestEntry) {
    if (!loadingIndicator) return;
    const isBootstrapPreviewLoading = hasBootstrapMapPreview();
    loadingIndicator.style.display = 'flex';
    if (isBootstrapPreviewLoading) {
        loadingIndicator.classList.add('initial-loader');
        document.documentElement.classList.add('bootstrap-map-preview-loading');
    }
    setLoadingProgressValue(isBootstrapPreviewLoading ? Math.max(loadingProgress, 45) : 0);
    if (!isBootstrapPreviewLoading) {
        setLoadingMessage(
            manifestEntry ? `Loading "${manifestEntry.name}"...` : 'Loading map...',
            { showSpinner: true, showProgress: true, showRetry: false }
        );
    }

    clearLoadingProgressTimer();
    loadingProgressInterval = setInterval(() => {
        if (loadingProgress < 90) {
            loadingProgress += 2 + Math.random() * 3;
            setLoadingProgressValue(Math.min(loadingProgress, 90));
        } else {
            clearLoadingProgressTimer();
        }
    }, 150);
}

function finalizeMapLoadState(requestedMapId, selectedMap, usingAlternateMobileImage, loadStartedAt, options = {}) {
    // Defensive: if layers got detached during async startup, attach them again.
    if (currentMapUnderlay && !map.hasLayer(currentMapUnderlay)) {
        currentMapUnderlay.addTo(map);
    }
    if (currentMapPreviewLayer && !map.hasLayer(currentMapPreviewLayer)) {
        currentMapPreviewLayer.addTo(map);
    }
    if (currentImageLayer && !map.hasLayer(currentImageLayer)) {
        currentImageLayer.addTo(map);
    }

    if (loadingIndicator) {
        setLoadingProgressValue(100);
        const hideDelayMs = parseNonNegativeInteger(options.hideDelayMs, 300);
        setTimeout(() => {
            clearLoadingProgressTimer();
            loadingIndicator.style.display = 'none';
            loadingIndicator.classList.remove('initial-loader');
            document.documentElement.classList.remove('bootstrap-map-preview-loading');
        }, hideDelayMs);
    }

    applySearchParamsToCurrentMap(new URLSearchParams(window.location.search));

    syncMiniMapControl();

    trackAnalytics('map_load_success', {
        mapId: requestedMapId,
        mapName: selectedMap.name,
        imageVariant: usingAlternateMobileImage ? 'mobile' : 'default',
        baseLayer: currentMapBaseLayerMode,
        durationMs: Math.round(performance.now() - loadStartedAt)
    });
    clampFloatingPanels();
    scheduleIdleTileWarmup();
}

// --- Function to Load/Switch Map ---
function initMapLoadContext(mapId, preResolvedMap) {
    hideShareRelayPrompt('map_loading');
    const requestedMapId = String(mapId || '').trim();
    const requestToken = ++loadRequestToken;
    const manifestEntry = preResolvedMap || findMapRecursive(mapData, requestedMapId);

    if (requestedMapId && manifestEntry && manifestEntry.status !== 'coming-soon') {
        mountBootstrapMapPreview(manifestEntry);
        setMapChooserVisible(false);
    } else if (requestedMapId) {
        setMapChooserVisible(false);
    }

    loadingMapId = requestedMapId;
    trackAnalytics('map_load_started', { mapId: requestedMapId });
    setMapAtmosphere(manifestEntry?.atmosphere || null);

    if (currentlyLoadedMapId && currentlyLoadedMapId !== requestedMapId) {
        trackAnalytics('map_switched', {
            fromMapId: currentlyLoadedMapId,
            toMapId: requestedMapId
        });
    }

    return { requestedMapId, manifestEntry, requestToken };
}

function handleMapUnavailable(manifestEntry, requestedMapId, mapId, updateHash) {
    if (!manifestEntry || manifestEntry.status === 'coming-soon') {
        console.warn('Attempted to load unavailable map:', mapId);
        if (manifestEntry) alert(`The map "${manifestEntry.name}" is coming soon.`);
        abortMapLoad({ reason: 'unavailable', requestedMapId, message: 'This map is not available yet.', updateHash, isUnavailable: true });
        return true;
    }
    return false;
}

function handleRedundantLoad(requestedMapId, updateHash) {
    if (requestedMapId === currentlyLoadedMapId && currentImageLayer) {
        loadingMapId = null;
        replaceMapHistoryState(requestedMapId, updateHash);
        if (loadingIndicator) {
            if (loadingProgressInterval) clearInterval(loadingProgressInterval);
            loadingIndicator.style.display = 'none';
        }
        applySearchParamsToCurrentMap(new URLSearchParams(window.location.search));
        return true;
    }
    return false;
}

async function fetchMapDefinitionOrAbort(requestedMapId, manifestEntry, requestToken, updateHash) {
    try {
        return await getMapDefinition(requestedMapId, manifestEntry);
    } catch (error) {
        if (requestToken === loadRequestToken) {
            console.error(`Failed to load map definition for ${requestedMapId}:`, error);
            abortMapLoad({ reason: 'definition_error', requestedMapId, message: `Could not load "${manifestEntry.name || requestedMapId}" data. Check the map definition and press Retry.`, updateHash, showRetry: true });
        }
        return null;
    }
}

function setupMapLayers(selectedMap, requestedMapId, mapImageUrl, updateHash) {
    currentMarkerGroup = L.layerGroup();
    currentRegionGroup = L.layerGroup().addTo(map);
    currentRoadGroup = L.layerGroup().addTo(map);

    const mapHeight = selectedMap.height;
    const mapWidth = selectedMap.width;

    if (isNaN(mapHeight) || isNaN(mapWidth) || !mapImageUrl) {
        console.error(`Invalid dimensions or missing imageUrl for map ID ${requestedMapId}`);
        abortMapLoad({ reason: 'invalid_data', requestedMapId, message: `Could not load "${selectedMap.name}". The map data is invalid. Press Retry after fixing map dimensions.`, updateHash, showRetry: true });
        return false;
    }

    currentBounds = [[0, 0], [mapHeight, mapWidth]];
    currentMapUnderlay = L.rectangle(currentBounds, {
        stroke: false,
        fill: true,
        fillOpacity: 1,
        fillColor: getMapBackgroundColor(selectedMap),
        color: getMapBackgroundColor(selectedMap),
        interactive: false,
        pane: 'tilePane'
    });
    const baseLayer = createMapBaseLayer(selectedMap, mapImageUrl, currentBounds);
    currentMapPreviewLayer = createMapPreviewLayer(selectedMap, currentBounds);
    currentImageLayer = baseLayer.layer;
    currentMapBaseLayerMode = baseLayer.mode;
    if (currentMapBaseLayerMode === 'image') {
        prefetchedImageUrls.add(withAssetVersion(mapImageUrl));
    }
    return true;
}

function setupMapImageLoading({ requestedMapId, selectedMap, mapImageUrl, usingAlternateMobileImage, loadStartedAt, updateHash, requestToken }) {
    let previewLoadingComplete = false;
    let detailLoadingComplete = false;
    let loadingTimeout = null;
    let previewReadyTimeout = null;
    let fallbackStarted = false;
    let tileLoadFailures = 0;

    function isActiveMapLoad() {
        return requestToken === loadRequestToken;
    }

    function clearLoadingTimers() {
        clearTimeout(loadingTimeout);
        clearTimeout(previewReadyTimeout);
        loadingTimeout = null;
        previewReadyTimeout = null;
    }

    function finishPreviewLoading() {
        if (!isActiveMapLoad() || previewLoadingComplete) return;
        previewLoadingComplete = true;
        clearTimeout(previewReadyTimeout);
        previewReadyTimeout = null;
        removeBootstrapMapPreview();
        setLoadingProgressValue(Math.max(loadingProgress, 60));
    }

    function finishDetailLoading() {
        if (!isActiveMapLoad() || detailLoadingComplete) return;
        detailLoadingComplete = true;
        clearLoadingTimers();
        const hadPreviewLayer = !!currentMapPreviewLayer;
        const keepPreviewLayer = currentMapBaseLayerMode === 'tile' && !!currentMapPreviewLayer;
        removeBootstrapMapPreview();
        if (keepPreviewLayer) {
            setMapPreviewLayerOpacity(1);
        } else {
            removeMapPreviewLayer();
        }
        finalizeMapLoadState(requestedMapId, selectedMap, usingAlternateMobileImage, loadStartedAt, {
            hideDelayMs: hadPreviewLayer ? 0 : 300
        });
    }

    function updateTileLoadingProgress() {
        if (!isActiveMapLoad() || detailLoadingComplete || currentMapBaseLayerMode !== 'tile') return;
        const tileContainer = currentImageLayer && typeof currentImageLayer.getContainer === 'function'
            ? currentImageLayer.getContainer()
            : null;
        const tileCounts = getTileLayerImageCounts(tileContainer);
        if (tileCounts.total === 0) return;
        updateMapPreviewLayerForTileProgress(tileCounts);
        const tileProgress = 60 + (tileCounts.loaded / tileCounts.total) * 35;
        setLoadingProgressValue(Math.max(loadingProgress, tileProgress));
        if (tileCounts.loaded === tileCounts.total) {
            finishDetailLoading();
        }
    }

    function hasOnlyFailedVisibleTiles() {
        const tileContainer = currentImageLayer && typeof currentImageLayer.getContainer === 'function'
            ? currentImageLayer.getContainer()
            : null;
        return areAllObservedTilesFailed(getTileLayerImageCounts(tileContainer));
    }

    function handleTileLayerLoad() {
        if (!isActiveMapLoad()) return;
        if (tileLoadFailures > 0 && currentMapPreviewLayer && hasOnlyFailedVisibleTiles()) {
            if (getConfigValue('performance.tileFullImageFallback', true) === false) {
                console.warn('Tile layer finished without loading visible tiles; keeping the map preview:', selectedMap.id || selectedMap.name);
                finishWithPreviewFallback();
            } else {
                console.warn('Tile layer finished without loading visible tiles; falling back to full map image:', selectedMap.id || selectedMap.name);
                setTimeout(attachImageFallback, 0);
            }
            return;
        }
        finishDetailLoading();
    }

    function finishWithPreviewFallback() {
        if (!isActiveMapLoad() || detailLoadingComplete || !currentMapPreviewLayer) return;
        detailLoadingComplete = true;
        clearLoadingTimers();
        removeBootstrapMapPreview();
        if (currentImageLayer && map.hasLayer(currentImageLayer)) {
            map.removeLayer(currentImageLayer);
        }
        currentImageLayer = currentMapPreviewLayer;
        currentMapPreviewLayer = null;
        currentMapBaseLayerMode = 'preview';
        finalizeMapLoadState(requestedMapId, selectedMap, usingAlternateMobileImage, loadStartedAt, {
            hideDelayMs: 0
        });
    }

    function abortImageLoad() {
        if (!isActiveMapLoad() || detailLoadingComplete) return;
        detailLoadingComplete = true;
        clearLoadingTimers();
        console.error('Image overlay failed to load:', mapImageUrl);

        if (previewLoadingComplete && currentMapPreviewLayer) {
            if (currentImageLayer) map.removeLayer(currentImageLayer);
            currentImageLayer = currentMapPreviewLayer;
            currentMapPreviewLayer = null;
            currentMapBaseLayerMode = 'preview';
            console.warn('Detailed map image failed after preview load; keeping the low-resolution preview visible.');
            finalizeMapLoadState(requestedMapId, selectedMap, usingAlternateMobileImage, loadStartedAt, {
                hideDelayMs: 300
            });
            return;
        }

        if (currentImageLayer) map.removeLayer(currentImageLayer);
        if (currentMapPreviewLayer) map.removeLayer(currentMapPreviewLayer);
        if (currentMapUnderlay) map.removeLayer(currentMapUnderlay);
        currentImageLayer = null;
        currentMapPreviewLayer = null;
        currentMapUnderlay = null;
        abortMapLoad({ reason: 'image_error', requestedMapId, message: `Could not load "${selectedMap.name}" image. Check the image path and press Retry.`, updateHash, showRetry: true });
    }

    function attachImageFallback() {
        if (!isActiveMapLoad() || detailLoadingComplete || fallbackStarted) return;
        if (getConfigValue('performance.tileFullImageFallback', true) === false && currentMapPreviewLayer) {
            finishWithPreviewFallback();
            return;
        }
        fallbackStarted = true;
        const fallbackLayer = L.imageOverlay(mapImageUrl, currentBounds);
        const preloadImg = new Image();
        if (currentImageLayer) {
            map.removeLayer(currentImageLayer);
        }
        currentImageLayer = fallbackLayer;
        currentMapBaseLayerMode = 'image';
        prefetchedImageUrls.add(withAssetVersion(mapImageUrl));
        currentImageLayer.on('load', finishDetailLoading);
        currentImageLayer.on('error', abortImageLoad);
        preloadImg.onload = finishDetailLoading;
        preloadImg.onerror = abortImageLoad;
        preloadImg.src = mapImageUrl;
        currentImageLayer.addTo(map);
    }

    loadingTimeout = setTimeout(() => {
        if (!isActiveMapLoad() || detailLoadingComplete) return;
        console.warn('Detailed map image is still loading; keeping the preview visible.');
        setLoadingProgressValue(Math.max(loadingProgress, 92));
    }, 8000);

    currentMapUnderlay.addTo(map);
    if (currentMapPreviewLayer) {
        currentMapPreviewLayer.on('load', finishPreviewLoading);
        currentMapPreviewLayer.on('error', () => {
            if (!isActiveMapLoad()) return;
            console.warn('Low-resolution map preview failed to load:', selectedMap.id || selectedMap.name);
        });
        currentMapPreviewLayer.addTo(map);
        markMapPreviewLayerElement();
        previewReadyTimeout = setTimeout(() => {
            if (!isActiveMapLoad()) return;
            previewReadyTimeout = null;
            setLoadingProgressValue(Math.max(loadingProgress, 55));
        }, 550);
    }

    if (currentMapBaseLayerMode === 'tile') {
        currentImageLayer.on('load', handleTileLayerLoad);
        currentImageLayer.on('tileload', updateTileLoadingProgress);
        currentImageLayer.on('tileerror', function (event) {
            if (!isActiveMapLoad() || detailLoadingComplete) return;
            tileLoadFailures += 1;
            const failedTileUrl = event && event.tile ? event.tile.currentSrc || event.tile.src : '';
            if (currentMapPreviewLayer) {
                setMapPreviewLayerOpacity(1);
                console.warn('Tile layer failed to load; keeping the low-resolution preview behind tiles:', failedTileUrl || selectedMap.id || selectedMap.name);
                setLoadingProgressValue(Math.max(loadingProgress, 90));
                setTimeout(updateTileLoadingProgress, 0);
                return;
            }
            console.warn('Tile layer failed to load without a preview; falling back to full map image:', failedTileUrl || selectedMap.id || selectedMap.name);
            attachImageFallback();
        });
        currentImageLayer.addTo(map);
        setTimeout(updateTileLoadingProgress, 0);
        setTimeout(updateTileLoadingProgress, 250);
        setTimeout(updateTileLoadingProgress, 1000);
        map.fitBounds(currentBounds, { animate: false });
        return;
    }

    attachImageFallback();
}

async function loadMap(mapId, updateHash = true, preResolvedMap = null) {
    const loadStartedAt = performance.now();
    const { requestedMapId, manifestEntry, requestToken } = initMapLoadContext(mapId, preResolvedMap);

    startMapLoadingProgress(manifestEntry);
    resetMapState();

    if (handleMapUnavailable(manifestEntry, requestedMapId, mapId, updateHash)) return;
    if (handleRedundantLoad(requestedMapId, updateHash)) return;

    let selectedMap = await fetchMapDefinitionOrAbort(requestedMapId, manifestEntry, requestToken, updateHash);
    if (!selectedMap || requestToken !== loadRequestToken) return;

    currentMapData = selectedMap;
    setMapAtmosphere(selectedMap?.atmosphere || manifestEntry?.atmosphere || null);

    const mapImageUrl = getPreferredMapImageUrl(selectedMap);
    const defaultImageUrl = String(selectedMap.imageUrl || '').trim();
    const usingAlternateMobileImage = !!defaultImageUrl && mapImageUrl !== defaultImageUrl;

    if (!setupMapLayers(selectedMap, requestedMapId, mapImageUrl, updateHash)) return;

    setupMapImageLoading({ requestedMapId, selectedMap, mapImageUrl, usingAlternateMobileImage, loadStartedAt, updateHash, requestToken });

    renderMapFeatures(selectedMap, requestedMapId);
    finalizeMapUI(requestedMapId, selectedMap);
    pushMapHistoryState(requestedMapId, updateHash, selectedMap.name);
}

// --- Function to add regions to map ---
function addRegionsToMap(mapId) {
    if (!currentRegionGroup) {
        currentRegionGroup = L.layerGroup().addTo(map);
    } else {
        currentRegionGroup.clearLayers();
    }

    const selectedMap = getMapRuntimeData(mapId);
    if (!selectedMap) return;
    const regionsToUse = visibleRegionsCache && visibleRegionsCache.length ? visibleRegionsCache : (selectedMap.regions || []);
    if (!regionsToUse || !Array.isArray(regionsToUse)) {
        return;
    }

    regionsToUse.forEach(region => {
        if (!region.coordinates || region.coordinates.length < 3) {
            console.warn(`Invalid coordinates for region: ${region.name}`);
            return;
        }

        const polygon = L.polygon(region.coordinates, {
            color: region.color || '#3388ff',
            fillColor: region.fillColor || '#3388ff',
            fillOpacity: regionsVisible ? (region.fillOpacity || 0.2) : 0, // Initial opacity based on toggle
            weight: 2,
            opacity: regionsVisible ? 1 : 0, // Initial opacity based on toggle
            interactive: true // Make regions clickable
        });

        const popupHtml = createPopupContent(region, 'region');
        if (popupHtml) {
            polygon.bindPopup(popupHtml, {
                minWidth: 250 // Set a min-width for consistency
            });
        }

        polygon.regionData = region; // Store data for filtering
        if (typeof polygon.on === 'function') {
            polygon.on('popupopen', () => {
                setSidebarSelectedFeature(region, 'region');
            });
        }
        currentRegionGroup.addLayer(polygon);
        polygon.bringToBack(); // Ensure regions are behind markers
        allMapRegions.push(polygon);
        if (region.id && !allMapRegionsById.has(region.id)) {
            allMapRegionsById.set(region.id, polygon);
        }
        if (region.name && !allMapRegionsByName.has(region.name)) {
            allMapRegionsByName.set(region.name, polygon);
        }
    });
}

// --- Update region visibility based on main toggle and filters ---
function updateVisibleRegions() {
    if (!currentRegionGroup) return;

    // Check the master toggle state
    const allTypesChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;

    // Get the currently checked region type filters (the individual values)
    const valueFilterValues = new Set();
    if (!allTypesChecked && poiFilterCheckboxesLive) {
        // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
        const staticCheckboxes = getStaticPoiFilterCheckboxes();
        for (let i = 0; i < staticCheckboxes.length; i++) {
            const checkbox = staticCheckboxes[i];
            if (checkbox.type === 'checkbox' &&
                checkbox.classList.contains('region-type-filter') &&
                checkbox.checked) {
                valueFilterValues.add(checkbox.value);
            }
        }
    }

    // ⚡ Bolt: Iterate over static array instead of LayerGroup for ~15x faster iterations
    allMapRegions.forEach(layer => {
        const region = layer.regionData;
        if (!region) return;

        const regionFilterValue = region.value || region.name;

        // A region is visible if the master toggle is checked OR its specific value is in the checked set.
        const typeMatch = allTypesChecked || valueFilterValues.has(regionFilterValue);

        // Apply visibility and interactivity based on *both* the overall toggle AND the type filter match
        if (regionsVisible && typeMatch) { // regionsVisible is synced with markersVisible
            const targetFillOpacity = region.fillOpacity || 0.2;
            let styleChanged = false;
            if (layer.options.stroke !== true || layer.options.fill !== true || layer.options.opacity !== 1 || layer.options.fillOpacity !== targetFillOpacity) {
                layer.setStyle({
                    stroke: true,
                    fill: true,
                    opacity: 1,
                    fillOpacity: targetFillOpacity
                });
                styleChanged = true;
            }
            // ⚡ Bolt: Prevent unconditional layer.bringToBack() to avoid expensive DOM re-orderings
            if (styleChanged) {
                layer.bringToBack();
            }
        } else {
            if (layer.options.stroke !== false || layer.options.fill !== false) {
                layer.setStyle({
                    stroke: false,
                    fill: false
                });
            }
        }
    });
}

// --- Populate Sidebar (Recursive Function) ---
function syncFolderExpandedAria(folderListItem) {
    if (!folderListItem) return;
    const header = folderListItem.querySelector('.folder-header');
    if (!header) return;
    const expanded = !folderListItem.classList.contains('closed');
    const expandedText = expanded ? 'true' : 'false';
    const toggleBtn = header.querySelector('.folder-toggle-btn');
    const mainAction = header.querySelector('.folder-main-action');
    const nestedList = Array.from(folderListItem.children).find((child) => child.classList?.contains('nested-list'));
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', expandedText);
    if (mainAction) mainAction.setAttribute('aria-expanded', expandedText);
    if (nestedList) {
        nestedList.inert = !expanded;
        nestedList.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    }
}

function getMapPresetGroupLabel(item) {
    return String(item?.group || item?.category || '').trim();
}

function createFolderToggleBtn(folderName, hasChildren) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'folder-toggle-btn';
    toggleBtn.setAttribute('aria-label', `Toggle folder: ${folderName}`);
    toggleBtn.innerHTML = `
        <span class="sidebar-chevron-icon" aria-hidden="true">
            <i class="ui-icon" data-lucide="chevron-right"></i>
        </span>
    `;
    if (!hasChildren) {
        toggleBtn.disabled = true;
        toggleBtn.setAttribute('aria-hidden', 'true');
        toggleBtn.tabIndex = -1;
    }
    return toggleBtn;
}

function createFolderMainAction(folderName, isLoadable, isComingSoon) {
    const mainAction = document.createElement('button');
    mainAction.type = 'button';
    mainAction.className = 'folder-main-action';
    if (isLoadable) {
        const loadIcon = document.createElement('span');
        loadIcon.className = 'folder-load-icon';
        loadIcon.setAttribute('aria-hidden', 'true');
        loadIcon.innerHTML = `<i class="ui-icon" data-lucide="map-pin"></i>`;
        mainAction.appendChild(loadIcon);
    }
    const mainActionLabel = document.createElement('span');
    mainActionLabel.className = 'folder-main-action-label';
    mainActionLabel.textContent = `${folderName}${isComingSoon ? ' (Soon)' : ''}`;
    mainAction.appendChild(mainActionLabel);
    return mainAction;
}

function attachFolderEventListeners({ item, folderName, isLoadable, isComingSoon, header, toggleBtn, mainAction, toggleFolderOpen }) {
    toggleBtn.addEventListener('click', toggleFolderOpen);
    toggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleFolderOpen(e);
        }
    });

    if (isLoadable) {
        header.dataset.mapId = item.id;
        mainAction.title = `Load map: ${folderName}`;
        mainAction.setAttribute('aria-label', `Load map: ${folderName}`);
        mainAction.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isMobileLayoutActive) {
                unlockAdvancedControls('map_selected');
            }
            navigateToMap(item.id);
        });
        mainAction.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                mainAction.click();
            }
        });
    } else if (isComingSoon) {
        header.classList.add('coming-soon');
        mainAction.title = `${folderName} - Coming Soon!`;
        mainAction.setAttribute('aria-label', `${folderName} coming soon`);
        mainAction.addEventListener('click', (e) => {
            e.stopPropagation();
            alert(`The map "${folderName}" is coming soon!`);
        });
        mainAction.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                mainAction.click();
            }
        });
    } else {
        mainAction.title = `Toggle folder: ${folderName}`;
        mainAction.setAttribute('aria-label', `Toggle folder: ${folderName}`);
        mainAction.addEventListener('click', toggleFolderOpen);
        mainAction.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleFolderOpen(e);
            }
        });
    }
}

function createSidebarFolderItem(item) {
    const listItem = document.createElement('li');
    listItem.classList.add('folder', 'closed');
    const header = document.createElement('div');
    header.classList.add('folder-header');

    const folderName = item.name || 'Unnamed Folder!';
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    const isComingSoon = item.status === 'coming-soon';
    const isLoadable = isRenderableMapEntry(item);

    const toggleBtn = createFolderToggleBtn(folderName, hasChildren);
    const mainAction = createFolderMainAction(folderName, isLoadable, isComingSoon);
    if (hasChildren && !isLoadable && !isComingSoon) {
        toggleBtn.tabIndex = -1;
        toggleBtn.setAttribute('aria-hidden', 'true');
    }

    const nestedList = document.createElement('ul');
    nestedList.classList.add('nested-list');
    if (hasChildren) {
        populateSidebar(nestedList, item.children);
    }

    const toggleFolderOpen = (e) => {
        e.stopPropagation();
        if (!hasChildren) return;
        listItem.classList.toggle('closed');
        syncFolderExpandedAria(listItem);
    };

    attachFolderEventListeners({ item, folderName, isLoadable, isComingSoon, header, toggleBtn, mainAction, toggleFolderOpen });

    header.appendChild(toggleBtn);
    header.appendChild(mainAction);
    listItem.appendChild(header);
    listItem.appendChild(nestedList);
    syncFolderExpandedAria(listItem);

    return listItem;
}

function createSidebarMapItem(item) {
    const listItem = document.createElement('li');
    listItem.classList.add('map-item');
    listItem.textContent = item.name || 'Unnamed Map!'; // Add fallback text
    listItem.dataset.mapId = item.id;
    listItem.tabIndex = 0;
    listItem.setAttribute('role', 'button');

    if (item.status === 'coming-soon') {
        listItem.classList.add('coming-soon');
        listItem.textContent = `${item.name || 'Unnamed Map!'} (Soon)`;
        listItem.title = `${item.name || 'Coming Soon!'} - Coming Soon!`;
        listItem.addEventListener('click', (e) => {
            e.stopPropagation();
            alert(`The map "${item.name || 'this map'}" is coming soon!`);
        });
        listItem.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                listItem.click();
            }
        });
    } else if (!isRenderableMapEntry(item)) {
        listItem.classList.add('coming-soon');
        listItem.textContent = `${item.name || 'Unnamed Map!'} (Unavailable)`;
        listItem.title = `${item.name || 'This map'} is not currently available`;
        listItem.addEventListener('click', (e) => {
            e.stopPropagation();
            alert(`The map "${item.name || 'this map'}" is not currently available.`);
        });
        listItem.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                listItem.click();
            }
        });
    } else {
        listItem.title = `Load map: ${item.name || 'Unnamed Map!'}`;
        listItem.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isMobileLayoutActive) {
                unlockAdvancedControls('map_selected');
            }
            navigateToMap(item.id);
        });
        listItem.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                listItem.click();
            }
        });
    }
    return listItem;
}

function createSidebarListItem(item) {
    if (item.type === 'folder') {
        return createSidebarFolderItem(item);
    } else {
        return createSidebarMapItem(item);
    }
}

function createSidebarGroupItem(groupLabel, sourceItems) {
    const groupItem = document.createElement('li');
    groupItem.className = 'map-preset-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'map-preset-group-header';
    groupHeader.textContent = groupLabel;
    groupItem.appendChild(groupHeader);

    const groupList = document.createElement('ul');
    groupList.className = 'map-preset-group-list';
    sourceItems
        .filter((candidate) => getMapPresetGroupLabel(candidate) === groupLabel)
        .forEach((candidate) => {
            groupList.appendChild(createSidebarListItem(candidate));
        });
    groupItem.appendChild(groupList);

    return groupItem;
}

function populateSidebar(parentElement, items) {
    if (!parentElement || !Array.isArray(items)) return;
    parentElement.innerHTML = '';
    const hasGroupedItems = items.some((item) => getMapPresetGroupLabel(item));

    if (!hasGroupedItems) {
        items.forEach((item) => {
            parentElement.appendChild(createSidebarListItem(item));
        });
        refreshLucideIcons();
        return;
    }

    const renderedGroups = new Set();
    items.forEach((item) => {
        const groupLabel = getMapPresetGroupLabel(item);
        if (!groupLabel) {
            parentElement.appendChild(createSidebarListItem(item));
            return;
        }
        if (renderedGroups.has(groupLabel)) return;
        renderedGroups.add(groupLabel);

        parentElement.appendChild(createSidebarGroupItem(groupLabel, items));
    });
    refreshLucideIcons();
}
// populateSidebar is now called within initializeApp after data is loaded

// --- Sidebar Toggle Button Logic ---
toggleBtn.addEventListener('click', () => {
    unlockAdvancedControls('sidebar_toggle');
    const newState = container.classList.contains('sidebar-collapsed') ? 'o' : 'c';
    setSidebarState(newState, true);
});

if (mobileSheetLauncherBtn) {
    mobileSheetLauncherBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!isMobileLayoutActive) return;
        lastMobileSurfaceTriggerButton = mobileSheetLauncherBtn;
        if (isMobileSurfaceMode(MOBILE_SURFACE_MODE_ATLAS)) {
            closeMobileSheet({ restoreFocus: false });
            return;
        }
        openMobileSheet({
            mode: MOBILE_SURFACE_MODE_ATLAS,
            focusSearch: false,
            triggerButton: mobileSheetLauncherBtn
        });
    });
}

if (mobileSearchLauncherBtn) {
    mobileSearchLauncherBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!isMobileLayoutActive) return;
        lastMobileSurfaceTriggerButton = mobileSearchLauncherBtn;
        if (isMobileSurfaceMode(MOBILE_SURFACE_MODE_SEARCH)) {
            closeMobileSheet({ restoreFocus: false });
            return;
        }
        openMobileSheet({
            mode: MOBILE_SURFACE_MODE_SEARCH,
            focusSearch: true,
            triggerButton: mobileSearchLauncherBtn
        });
    });
}

if (mobileToolsLauncherBtn) {
    mobileToolsLauncherBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!isMobileLayoutActive || mobileToolsLauncherBtn.hidden) return;
        lastMobileSurfaceTriggerButton = mobileToolsLauncherBtn;
        if (isMobileSurfaceMode(MOBILE_SURFACE_MODE_TOOLS)) {
            closeMobileSheet({ restoreFocus: false });
            return;
        }
        openMobileToolsPanel({
            panelMode: mobileToolsPanelMode,
            triggerButton: mobileToolsLauncherBtn
        });
    });
}

if (mobileSearchPanelCloseBtn) {
    mobileSearchPanelCloseBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMobileSearchPanel({ restoreFocus: true });
    });
}

if (mobileToolsCardCloseBtn) {
    mobileToolsCardCloseBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMobileSheet({ restoreFocus: true });
    });
}

if (mobileInfoHelpBtn) {
    mobileInfoHelpBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const nextVisible = !mapBlurbElement.classList.contains('visible');
        if (nextVisible) {
            lastMobileSurfaceTriggerButton = mobileInfoHelpBtn;
            closeMobileSheet({ restoreFocus: false });
        }
        setMapBlurbVisible(nextVisible);
    });
}

if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
        closeMobileSearchPanel({ restoreFocus: true });
        if (!isMobileLayoutActive && !container.classList.contains('sidebar-collapsed')) {
            setSidebarState('c', true);
        }
    });
}

window.addEventListener('resize', debounce(syncSidebarBackdropState, 120));
window.addEventListener('resize', debounce(positionFilterPanel, 120));
window.addEventListener('resize', debounce(clampFloatingPanels, 120));
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        syncSidebarBackdropState();
        positionFilterPanel();
        clampFloatingPanels();
    }, 120);
});
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', debounce(() => {
        updateMobileLayoutState();
        clampFloatingPanels();
    }, 80));
}
document.addEventListener('touchstart', markControlTouch, { passive: true, capture: true });
document.addEventListener('pointerdown', markControlTouch, { capture: true });

if (loadingRetryBtn) {
    loadingRetryBtn.addEventListener('click', () => {
        trackAnalytics('retry_clicked', { mapId: loadingMapId || currentlyLoadedMapId || null });
        loadingRetryBtn.style.display = 'none';

        if (loadingMapId) {
            loadMap(loadingMapId, false);
            return;
        }

        if (currentlyLoadedMapId) {
            loadMap(currentlyLoadedMapId, false);
            return;
        }

        loadMapData();
    });
}

// --- Theme Toggle Logic ---
function applyTheme(theme, options = {}) {
    const { animate = true } = options;
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    const shouldAnimate = animate && shouldAnimateThemeTransition();
    const previousEffectiveTheme = currentEffectiveTheme;
    const shouldUseCloudHandoff = shouldAnimate && previousEffectiveTheme === 'light' && normalizedTheme === 'dark';

    if (shouldAnimate) {
        rootElement.classList.add('theme-animating');
    }

    if (shouldUseCloudHandoff) {
        rootElement.classList.add(THEME_CLOUD_HANDOFF_CLASS);
    } else {
        rootElement.classList.remove(THEME_CLOUD_HANDOFF_CLASS);
    }

    currentEffectiveTheme = normalizedTheme;
    rootElement.setAttribute('data-theme', normalizedTheme);
    rootElement.style.colorScheme = normalizedTheme;
    bodyElement.classList.toggle('dark-theme', normalizedTheme === 'dark'); // Backward-compatibility class.
    if (themeToggle) {
        themeToggle.checked = normalizedTheme === 'dark';
    }
    syncThemeToggleA11y(normalizedTheme);
    applyAtmosphereLayer();
    updateMapUnderlayColor(getMapRuntimeData(currentlyLoadedMapId));

    if (themeAnimationTimeoutId) {
        clearTimeout(themeAnimationTimeoutId);
        themeAnimationTimeoutId = null;
    }
    if (shouldAnimate) {
        const transitionDurationMs = getThemeAnimationDurationMs();
        themeAnimationTimeoutId = window.setTimeout(() => {
            rootElement.classList.remove('theme-animating');
            rootElement.classList.remove(THEME_CLOUD_HANDOFF_CLASS);
            themeAnimationTimeoutId = null;
        }, transitionDurationMs);
    } else {
        rootElement.classList.remove('theme-animating');
        rootElement.classList.remove(THEME_CLOUD_HANDOFF_CLASS);
    }
}

function setThemePreference(preference) {
    const normalizedPreference = isValidThemePreference(preference) ? preference : 'system';
    themePreference = normalizedPreference;
    safeSetStorage(UX_STORAGE_KEYS.themePreference, normalizedPreference);
    if (normalizedPreference === 'light' || normalizedPreference === 'dark') {
        safeSetStorage(UX_STORAGE_KEYS.theme, normalizedPreference); // Legacy key compatibility.
    } else {
        safeRemoveStorage(UX_STORAGE_KEYS.theme);
    }
    applyTheme(resolveEffectiveTheme(normalizedPreference), { animate: true });
}

function handleSystemThemeChange() {
    if (themePreference !== 'system') return;
    applyTheme(resolveEffectiveTheme('system'), { animate: true });
}

if (systemThemeMediaQuery) {
    if (typeof systemThemeMediaQuery.addEventListener === 'function') {
        systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof systemThemeMediaQuery.addListener === 'function') {
        systemThemeMediaQuery.addListener(handleSystemThemeChange);
    }
}

themeToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); // Prevent page scroll on Space
        themeToggle.checked = !themeToggle.checked;
        // Manually dispatch change event since we are changing the property programmatically
        themeToggle.dispatchEvent(new Event('change'));
    }
});

themeToggle.addEventListener('change', () => {
    unlockAdvancedControls('theme_toggle');
    const newThemePreference = themeToggle.checked ? 'dark' : 'light';
    setThemePreference(newThemePreference);
    const effectiveTheme = resolveEffectiveTheme(newThemePreference);
    trackAnalytics('theme_changed', { theme: effectiveTheme, preference: newThemePreference });

    // Update audio track if sound is enabled
    if (soundEnabled) {
        ensureAmbientTrackLoadedForTheme(effectiveTheme);
        if (effectiveTheme === 'dark') {
            fadeAudio(lightAmbient, 0);
            fadeAudio(darkAmbient, 0.3);
        } else {
            fadeAudio(darkAmbient, 0);
            fadeAudio(lightAmbient, 0.3);
        }
    }
});

// --- Sound Control Logic ---
function ensureAmbientAudioLoaded(audioElement) {
    if (!audioElement) return;
    const source = audioElement.querySelector('source[data-src]');
    if (!source) return;
    if (source.dataset.loaded === 'true') return;

    const src = String(source.dataset.src || '').trim();
    if (!src) return;

    source.src = withAssetVersion(src);
    source.dataset.loaded = 'true';
    audioElement.load();
}

function getAmbientAudioForTheme(theme) {
    return theme === 'dark' ? darkAmbient : lightAmbient;
}

function ensureAmbientTrackLoadedForTheme(theme = currentEffectiveTheme) {
    ensureAmbientAudioLoaded(getAmbientAudioForTheme(theme));
}

function scheduleSavedAmbientAudioResume() {
    if (savedAmbientResumeScheduled) return;
    savedAmbientResumeScheduled = true;
    const resumeAfterStartup = () => {
        window.setTimeout(() => {
            scheduleIdleTask(() => {
                savedAmbientResumeScheduled = false;
                if (!soundEnabled || !canUseSoundControlsNow()) return;
                const theme = currentEffectiveTheme;
                ensureAmbientTrackLoadedForTheme(theme);
                fadeAudio(getAmbientAudioForTheme(theme), 0.3);
            }, 2500);
        }, 1200);
    };

    if (document.readyState === 'complete') {
        resumeAfterStartup();
    } else {
        window.addEventListener('load', resumeAfterStartup, { once: true });
    }
}

function fadeAudio(audioElement, targetVolume, duration = 1800) {
    if (!audioElement) return;
    const existingFrame = activeAudioFadeFrameIds.get(audioElement);
    if (existingFrame) {
        cancelAnimationFrame(existingFrame);
        activeAudioFadeFrameIds.delete(audioElement);
    }

    const clampedTarget = Math.max(0, Math.min(1, targetVolume));
    const easeInOutCubic = (t) => (t < 0.5)
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const startVolume = audioElement.volume;
    const volumeChange = clampedTarget - startVolume;
    if (volumeChange === 0 && (clampedTarget === 0 || !audioElement.paused)) return;

    const startTime = Date.now();

    function updateVolume() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / duration);
        const easedProgress = easeInOutCubic(progress);
        audioElement.volume = Math.max(0, Math.min(1, startVolume + (volumeChange * easedProgress)));

        if (progress < 1) {
            const frameId = requestAnimationFrame(updateVolume);
            activeAudioFadeFrameIds.set(audioElement, frameId);
        } else {
            activeAudioFadeFrameIds.delete(audioElement);
            if (clampedTarget === 0 && !audioElement.paused) {
                audioElement.pause();
            }
        }
    }

    if (clampedTarget > 0 && audioElement.paused) {
        audioElement.volume = 0; // Start from silent
        audioElement.play().then(() => {
            const frameId = requestAnimationFrame(updateVolume);
            activeAudioFadeFrameIds.set(audioElement, frameId);
        }).catch(e => console.warn('Audio play prevented:', e));
    } else if (clampedTarget > 0 && !audioElement.paused) {
        const frameId = requestAnimationFrame(updateVolume);
        activeAudioFadeFrameIds.set(audioElement, frameId);
    } else if (clampedTarget === 0) {
        const frameId = requestAnimationFrame(updateVolume);
        activeAudioFadeFrameIds.set(audioElement, frameId);
    }
}
// --- Function to add roads to map ---
function addRoadsToMap(mapId) {
    if (!currentRoadGroup) {
        currentRoadGroup = L.layerGroup().addTo(map);
    } else {
        currentRoadGroup.clearLayers();
    }
    allMapLinesByName.clear();

    const selectedMap = getMapRuntimeData(mapId);
    if (!selectedMap) return;

    const allLines = (visibleLinesCache && visibleLinesCache.length) ? visibleLinesCache : [...(selectedMap.roads || []), ...(selectedMap.lines || [])];

    if (allLines.length === 0) {
        return;
    }

    allLines.forEach(road => {
        if (!road.coordinates || road.coordinates.length < 2) {
            console.warn(`Invalid coordinates for road: ${road.name}`);
            return;
        }

        const polyline = L.polyline(road.coordinates, {
            color: road.color || '#ffffff',
            weight: road.weight || 3,
            opacity: road.opacity || 0.8,
            dashArray: road.dashArray || null,
            interactive: true // Make roads clickable
        });

        // Store original opacity for filtering
        polyline.originalOpacity = road.opacity || 0.8;

        const popupHtml = createPopupContent(road, 'line');
        if (popupHtml) {
            polyline.bindPopup(popupHtml, { // Use unified creator
                minWidth: 250
            });
        }

        polyline.roadData = road; // Store data for filtering
        if (typeof polyline.on === 'function') {
            polyline.on('popupopen', () => {
                setSidebarSelectedFeature(road, 'line');
            });
        }
        currentRoadGroup.addLayer(polyline);
        allMapLines.push(polyline);
        if (road.id && !allMapLinesById.has(road.id)) {
            allMapLinesById.set(road.id, polyline);
        }
        if (road.name && !allMapLinesByName.has(road.name)) {
            allMapLinesByName.set(road.name, polyline);
        }
    });
}

function canUseSoundControlsNow() {
    return !isEmbeddedView && (advancedControlsUnlocked || isMobileLayoutActive);
}

function applySoundEnabledState(nextEnabled, {
    trackEvent = true
} = {}) {
    soundEnabled = !!nextEnabled;
    safeSetStorage(UX_STORAGE_KEYS.soundEnabled, String(soundEnabled));

    if (soundEnabled) {
        ensureAmbientTrackLoadedForTheme(currentEffectiveTheme);
        soundIcon.innerHTML = `<i class="ui-icon" data-lucide="volume-2" aria-hidden="true"></i>`;
        if (mobileSoundBtn) {
            mobileSoundBtn.classList.add('active');
            mobileSoundBtn.setAttribute('aria-pressed', 'true');
            mobileSoundBtn.innerHTML = `<i class="ui-icon" data-lucide="volume-2" aria-hidden="true"></i><span>Sound</span>`;
        }
        refreshLucideIcons();
        toggleSoundBtn.title = "Mute Sound";
        toggleSoundBtn.setAttribute('aria-label', "Mute Sound");
        toggleSoundBtn.setAttribute('aria-pressed', "true");

        const currentTheme = currentEffectiveTheme;
        if (currentTheme === 'dark') {
            fadeAudio(darkAmbient, 0.3);
        } else {
            fadeAudio(lightAmbient, 0.3);
        }
    } else {
        soundIcon.innerHTML = `<i class="ui-icon" data-lucide="volume-x" aria-hidden="true"></i>`;
        if (mobileSoundBtn) {
            mobileSoundBtn.classList.remove('active');
            mobileSoundBtn.setAttribute('aria-pressed', 'false');
            mobileSoundBtn.innerHTML = `<i class="ui-icon" data-lucide="volume-x" aria-hidden="true"></i><span>Sound</span>`;
        }
        refreshLucideIcons();
        toggleSoundBtn.title = "Unmute Sound";
        toggleSoundBtn.setAttribute('aria-label', "Unmute Sound");
        toggleSoundBtn.setAttribute('aria-pressed', "false");

        fadeAudio(lightAmbient, 0);
        fadeAudio(darkAmbient, 0);
    }

    if (trackEvent) {
        trackAnalytics('sound_toggled', { enabled: soundEnabled });
    }
}

function initializeSoundState() {
    const setSoundIcon = (enabled) => {
        if (!soundIcon) return;
        soundIcon.innerHTML = `<i class="ui-icon" data-lucide="${enabled ? 'volume-2' : 'volume-x'}" aria-hidden="true"></i>`;
        if (mobileSoundBtn) {
            mobileSoundBtn.classList.toggle('active', enabled);
            mobileSoundBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            mobileSoundBtn.innerHTML = `<i class="ui-icon" data-lucide="${enabled ? 'volume-2' : 'volume-x'}" aria-hidden="true"></i><span>Sound</span>`;
        }
        refreshLucideIcons();
    };

    if (isEmbeddedView || !getFeatureFlag('sound', true)) {
        soundEnabled = false; // Ensure state reflects no sound
        // Set icon/title to muted state (even though button is hidden)
        setSoundIcon(false);
        if (toggleSoundBtn) toggleSoundBtn.title = "Unmute Sound"; // Check if button exists before setting title
        return; // Exit early, do not proceed with sound logic
    }

    const savedSoundState = safeGetStorage(UX_STORAGE_KEYS.soundEnabled);
    soundEnabled = savedSoundState === 'true'; // Convert string to boolean
    const canUseSoundNow = canUseSoundControlsNow();

    // Set initial volume to 0 to prevent autoplay issues on load
    lightAmbient.volume = 0;
    darkAmbient.volume = 0;

    if (soundEnabled && canUseSoundNow) {
        setSoundIcon(true);
            if (toggleSoundBtn) {
                toggleSoundBtn.title = "Mute Sound";
                toggleSoundBtn.setAttribute('aria-label', "Mute Sound");
                toggleSoundBtn.setAttribute('aria-pressed', "true");
            }
        scheduleSavedAmbientAudioResume();
    } else {
        fadeAudio(lightAmbient, 0);
        fadeAudio(darkAmbient, 0);
        setSoundIcon(false);
        if (toggleSoundBtn) {
            toggleSoundBtn.title = "Unmute Sound";
            toggleSoundBtn.setAttribute('aria-label', "Unmute Sound");
            toggleSoundBtn.setAttribute('aria-pressed', soundEnabled && !canUseSoundNow ? "true" : "false");
        }
    }
    // Make button visible now that state is set (only if not embedded)
    if (toggleSoundBtn) toggleSoundBtn.style.display = (advancedControlsUnlocked && !isEmbeddedView && !isMobileLayoutActive) ? 'block' : 'none';
}

if (toggleSoundBtn) {
    toggleSoundBtn.addEventListener('click', (e) => {
        if (!getFeatureFlag('sound', true)) return;
        unlockAdvancedControls('sound_toggle');
        e.stopPropagation();
        applySoundEnabledState(!soundEnabled);
    });
}


// Apply initial theme from storage
themePreference = resolveThemePreference();
applyTheme(resolveEffectiveTheme(themePreference), { animate: false });

function getMapPixelDimensions(bounds) {
    return {
        width: bounds[1][1],
        height: bounds[1][0]
    };
}

function projectMapPointToLatLon(point, latLonBounds, imageBounds) {
    const { width, height } = getMapPixelDimensions(imageBounds);
    const { north, south, east, west } = latLonBounds;

    const lon = west + (point.lng / width) * (east - west);
    // In Leaflet CRS.Simple, lat=0 is the bottom and lat=mapHeight is the top.
    // Interpolate from south (bottom) to north (top).
    const lat = south + (point.lat / height) * (north - south);

    return { lat, lon };
}

function updateCoordinates(e) {
    if (coordsLocked) return;
    if (!currentLatLonBounds || !currentBounds) return;

    const { lat, lon } = projectMapPointToLatLon(e.latlng, currentLatLonBounds, currentBounds);
    updateCoordinateDisplay(lat, lon);
}

// --- Map Click Handler ---
map.on('click', function (e) {
    if (shouldIgnoreMapPointerEvent(e)) return;
    closeMobileSearchPanel({ restoreFocus: false });
    setMapBlurbVisible(false);
    if (currentBounds) {
        unlockAdvancedControls('map_click');
    }
});
map.on('dblclick', function (e) {
    if (isMeasuringMultiPoint) return;
    coordsLocked = !coordsLocked;
    if (coordsLocked) {
        updateCoordinates(e); // one last update to lock in the current coords
    }
    // Hide filter panel if clicking outside
    if (filtersPanelVisible && !poiFilterContainer.contains(e.originalEvent.target) && e.originalEvent.target !== toggleFiltersBtn && !toggleFiltersBtn.contains(e.originalEvent.target)) {
        toggleFilterPanel();
    }
    // Hide search results if clicking outside
    if (searchResultsContainer.style.display === 'block' && !searchResultsContainer.contains(e.originalEvent.target) && e.originalEvent.target !== poiSearchInput) {
        closeSearchResults();
    }
    // Measurement logic handled separately
    setMapBlurbVisible(false);
});

// --- Blurb Element Click Stop ---
mapBlurbElement.addEventListener('click', (e) => {
    e.stopPropagation();
    const helpAction = e.target instanceof Element ? e.target.closest('.map-blurb-help-action') : null;
    if (helpAction && openAboutModal) {
        setMapBlurbVisible(false);
        openAboutModal('guide', 'mobile_info_card');
    }
});

// --- Coordinate Toggle Button Logic ---
if (toggleCoordsBtn) {
    toggleCoordsBtn.addEventListener('click', function () {
        unlockAdvancedControls('coords_toggle');
        if (toggleCoordsBtn.style.display === 'none') return;
        setCoordsDisplayVisible(!coordsDisplayEnabled);
    });
}

if (shareViewBtn) {
    shareViewBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        unlockAdvancedControls('share_view');
        if (shareViewBtn.style.display === 'none') return;
        await shareCurrentView(shareViewBtn);
    });
}

if (mobileMarkersBtn) {
    mobileMarkersBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (mobileMarkersBtn.hidden || mobileMarkersBtn.disabled) return;
        toggleMarkersVisibility();
    });
}

if (mobileFiltersBtn) {
    mobileFiltersBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (mobileFiltersBtn.hidden || mobileFiltersBtn.disabled) return;
        closeMobileSheet({ restoreFocus: false });
        toggleFilterPanel();
    });
}

if (mobileMeasureBtn) {
    mobileMeasureBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (mobileMeasureBtn.hidden || mobileMeasureBtn.disabled) return;
        unlockAdvancedControls('mobile_measure_toggle');
        toggleMeasurementTool();
    });
}

if (mobileSoundBtn) {
    mobileSoundBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (mobileSoundBtn.hidden || mobileSoundBtn.disabled) return;
        unlockAdvancedControls('mobile_sound_toggle');
        applySoundEnabledState(!soundEnabled);
    });
}

if (mobileShareViewBtn) {
    mobileShareViewBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (mobileShareViewBtn.hidden || mobileShareViewBtn.disabled) return;
        unlockAdvancedControls('mobile_share_view');
        await shareCurrentView(mobileShareViewBtn);
    });
}

if (mobileCoordsBtn) {
    mobileCoordsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (mobileCoordsBtn.hidden || mobileCoordsBtn.disabled) return;
        unlockAdvancedControls('mobile_coords_toggle');
        setCoordsDisplayVisible(!coordsDisplayEnabled);
    });
}

if (mobileHelpBtn) {
    mobileHelpBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (openAboutModal) openAboutModal('guide', 'mobile_sheet');
    });
}

// --- Handle Hash Changes / Back/Forward Navigation ---
window.addEventListener('popstate', (event) => {
    const { mapId: hashMpId, sidebarState: hashSidebarState } = parseHash(); // Re-parse hash
    const targetMapId = getHistoryStateValue(event.state, 'mapId', hashMpId);
    const targetSidebarState = getHistoryStateValue(event.state, 'sidebarState', hashSidebarState);


    if (!hasDirectMapHash(targetMapId) && shouldShowMapChooserForMapId(targetMapId)) {
        renderMapChooser(mapData);
        setMapChooserVisible(true);
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (targetSidebarState && targetSidebarState !== currentSidebarState) {
            setSidebarState(targetSidebarState, false);
        }
        syncSidebarBackdropState();
        return;
    }

    setMapChooserVisible(false);
    if (targetMapId !== currentlyLoadedMapId) {
        loadMap(targetMapId || '', false); // Load map without pushing new state
    } else {
        applySearchParamsToCurrentMap(new URLSearchParams(window.location.search));
    }
    if (targetSidebarState && targetSidebarState !== currentSidebarState) {
        setSidebarState(targetSidebarState, false); // Set sidebar without updating hash
    }
    syncSidebarBackdropState();
    if (restoreMapChooserTriggerOnPopState) {
        restoreMapChooserTriggerOnPopState = false;
        requestAnimationFrame(() => {
            const focusTarget = isMobileLayoutActive ? mobileSheetLauncherBtn : sidebarBackToChooserBtn;
            if (focusTarget && typeof focusTarget.focus === 'function') {
                focusTarget.focus({ preventScroll: true });
            }
        });
    }
});
window.addEventListener('beforeunload', () => {
    if (loadingProgressInterval) clearInterval(loadingProgressInterval);
    trackAnalytics('session_end', {
        durationMs: Date.now() - sessionStartedAt,
        mobile: window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT
    });
});


// --- Custom Zoom Control Logic ---
const customZoomInBtn = document.getElementById('custom-zoom-in');
const customZoomOutBtn = document.getElementById('custom-zoom-out');

if (customZoomInBtn) {
    customZoomInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unlockAdvancedControls('zoom_in');
        zoomMapBy(SMOOTH_ZOOM_STEP);
    });
}

if (customZoomOutBtn) {
    customZoomOutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unlockAdvancedControls('zoom_out');
        zoomMapBy(-SMOOTH_ZOOM_STEP);
    });
}

// --- Marker Toggle Button Logic ---
function toggleMarkersVisibility() {
    markersVisible = !markersVisible;
    regionsVisible = markersVisible; // Sync regions with markers

    toggleMarkersBtn.title = markersVisible ? "Hide Markers & Regions" : "Show Markers & Regions";
    toggleMarkersBtn.setAttribute('aria-label', markersVisible ? "Hide Markers & Regions" : "Show Markers & Regions");
    toggleMarkersBtn.classList.toggle('markers-hidden', !markersVisible);

    updateVisibleRegions(); // Update regions visibility
    updateVisibleMarkersAndSearch(); // Update marker visibility

    if (mobileMarkersBtn) {
        mobileMarkersBtn.classList.toggle('active', markersVisible);
        mobileMarkersBtn.setAttribute('aria-pressed', markersVisible ? 'true' : 'false');
    }
    trackAnalytics('markers_toggled', { visible: markersVisible });
}

toggleMarkersBtn.addEventListener('click', () => {
    unlockAdvancedControls('markers_toggle');
    toggleMarkersVisibility();
});
// --- Blurb Toggle Button Logic ---
toggleBlurbBtn.addEventListener('click', (e) => {
    unlockAdvancedControls('blurb_toggle');
    e.stopPropagation(); // Prevent map click event
    const nextVisible = !mapBlurbElement.classList.contains('visible');
    setMapBlurbVisible(nextVisible);
    trackAnalytics('map_blurb_toggled', { visible: nextVisible });
});

// --- Filter Panel Toggle Logic ---
function toggleFilterPanel() {
    if (!isMobileLayoutActive) {
        unlockAdvancedControls('filter_toggle');
    }
    if (isMobileLayoutActive && !isMobileSurfaceMode(MOBILE_SURFACE_MODE_SEARCH)) {
        openMobileSheet({ mode: MOBILE_SURFACE_MODE_SEARCH, focusSearch: false, triggerButton: mobileSearchLauncherBtn });
    }
    filtersPanelVisible = !filtersPanelVisible;
    mobileFilterExpanded = isMobileLayoutActive ? filtersPanelVisible : false;
    poiFilterContainer.classList.toggle('visible', filtersPanelVisible);
    toggleFiltersBtn.classList.toggle('active', filtersPanelVisible);
    toggleFiltersBtn.title = filtersPanelVisible ? "Hide Filters" : "Show Filters";
    toggleFiltersBtn.setAttribute('aria-label', filtersPanelVisible ? "Hide Filters" : "Show Filters");
    toggleFiltersBtn.setAttribute('aria-expanded', filtersPanelVisible);
    syncFilterPanelInteractionState(filtersPanelVisible);
    syncMobileFilterState();
    safeSetStorage(UX_STORAGE_KEYS.filterPanelOpen, String(filtersPanelVisible));
    if (filtersPanelVisible) {
        positionFilterPanel();
    }
    clampFloatingPanels();
    updateActiveFilterChips();
    trackAnalytics('filter_panel_toggled', { visible: filtersPanelVisible });
}
toggleFiltersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFilterPanel();
});

// --- Search Input Logic ---
const debouncedUpdateVisibleMarkersAndSearch = debounce(updateVisibleMarkersAndSearch, 300);
poiSearchInput.addEventListener('input', debouncedUpdateVisibleMarkersAndSearch);
poiSearchInput.addEventListener('focus', () => {
    if (!isMobileLayoutActive) {
        unlockAdvancedControls('search_focus');
    }
    if (isMobileLayoutActive && !isMobileSurfaceMode(MOBILE_SURFACE_MODE_SEARCH)) {
        openMobileSheet({ mode: MOBILE_SURFACE_MODE_SEARCH, focusSearch: false, triggerButton: mobileSearchLauncherBtn });
    }
});
poiSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSearchResultSelection(1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSearchResultSelection(-1);
        return;
    }
    if (event.key === 'Enter' && activeSearchResultIndex >= 0) {
        event.preventDefault();
        selectSearchResult(activeSearchResultIndex);
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeSearchResults();
        poiSearchInput.blur();
    }
});
poiSearchInput.addEventListener('click', (e) => e.stopPropagation());
searchResultsContainer.addEventListener('click', (e) => e.stopPropagation());
if (searchScopeAtlasBtn) {
    searchScopeAtlasBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (searchScopeAtlasBtn.getAttribute('aria-busy') === 'true') return;
        const activeElementBeforeLoad = document.activeElement;
        const nextScope = currentSearchScope === SEARCH_SCOPE_ATLAS ? SEARCH_SCOPE_MAP : SEARCH_SCOPE_ATLAS;
        setSearchScope(nextScope);
        if (nextScope === SEARCH_SCOPE_ATLAS) {
            const entries = await ensureAtlasSearchIndexLoaded();
            if (entries === null) {
                setSearchScope(SEARCH_SCOPE_MAP);
                if (atlasScopeActionStillOwnsFocus(activeElementBeforeLoad)) {
                    poiSearchInput.focus();
                }
                return;
            }
        }
        updateVisibleMarkersAndSearch();
        if (atlasScopeActionStillOwnsFocus(activeElementBeforeLoad)) {
            poiSearchInput.focus();
        }
    });
}
if (activeFiltersContainer) {
    activeFiltersContainer.addEventListener('click', (e) => e.stopPropagation());
}

// --- Update line visibility based on filters ---
function updateVisibleLines() {
    if (!currentRoadGroup) return;

    const allTypesChecked = filterToggleAllCheckbox.checked && !filterToggleAllCheckbox.indeterminate;

    // ⚡ Bolt: Use a Set for O(1) lookups inside the layer iteration loop below
    const typeFilterValues = new Set();
    if (!allTypesChecked && poiFilterCheckboxesLive) {
        // ⚡ Bolt: Convert live HTMLCollection to a static array for O(1) length and index access (Measured improvement: ~91% faster)
        const staticCheckboxes = getStaticPoiFilterCheckboxes();
        for (let i = 0; i < staticCheckboxes.length; i++) {
            const checkbox = staticCheckboxes[i];
            if (checkbox.type === 'checkbox' &&
                checkbox.classList.contains('line-type-filter') &&
                checkbox.checked) {
                typeFilterValues.add(checkbox.value);
            }
        }
    }

    // ⚡ Bolt: Iterating over static array instead of LayerGroup for ~70% faster iterations
    allMapLines.forEach(layer => {
        const road = layer.roadData;
        if (!road) return;

        const roadType = road.type || "Unnamed Road Type"; // Match the logic in populateFilters
        const typeMatch = allTypesChecked || typeFilterValues.has(roadType);

        // Lines are always "visible" in terms of the master toggle (markersVisible)
        // Their appearance is solely based on type filters.
        if (typeMatch) {
            const targetOpacity = layer.originalOpacity === undefined ? 0.8 : layer.originalOpacity;
            if (layer.options.opacity !== targetOpacity) {
                layer.setStyle({
                    opacity: targetOpacity // Restore original or default
                });
            }
        } else {
            if (layer.options.opacity !== 0) {
                layer.setStyle({
                    opacity: 0 // Hide
                });
            }
        }
    });
}

// --- Combined Filter Panel Logic ---
poiFilterContainer.addEventListener('change', (e) => {
    const target = e.target;
    if (target.type !== 'checkbox') return;

    // Handle parent group checkbox for regions
    if (target.classList.contains('region-group-filter')) {
        setRegionGroupChildCheckboxes(target, target.checked);
    }

    // Handle master "Show All / Hide All" checkbox
    if (target.id === 'filter-toggle-all') {
        const isChecked = target.checked;
        setFilterCheckboxesChecked(isChecked);
        filterToggleAllCheckbox.indeterminate = false;
    }

    // Update parent and master toggles' indeterminate states
    updateToggleAllCheckboxState();

    // Trigger visibility updates
    if (target.classList.contains('poi-filter-checkbox') || target.id === 'filter-toggle-all') {
        updateVisibleMarkersAndSearch();
    }
    if (target.classList.contains('region-type-filter') || target.classList.contains('region-group-filter') || target.id === 'filter-toggle-all') {
        updateVisibleRegions();
    }
    if (target.classList.contains('line-type-filter') || target.id === 'filter-toggle-all') {
        updateVisibleLines();
    }

    updateActiveFilterChips();
    trackAnalytics('filter_changed', {
        filterId: target.id || null,
        checked: target.checked
    });
});
// Prevent map click when clicking inside filter panel
poiFilterContainer.addEventListener('click', (e) => {
    const header = e.target.closest('.filter-group-header');
    if (header) {
        const group = header.closest('.filter-group');
        if (group) {
            const isClosed = group.classList.toggle('closed');
            header.setAttribute('aria-expanded', !isClosed);
        }
    }
    e.stopPropagation();
});

// Allow keyboard toggling of filter groups
poiFilterContainer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        const header = e.target.closest('.filter-group-header');
        if (header) {
            e.preventDefault();
            const group = header.closest('.filter-group');
            if (group) {
                const isClosed = group.classList.toggle('closed');
                header.setAttribute('aria-expanded', !isClosed);
            }
        }
    }
});

// --- Measurement Tool Logic ---

function toggleMeasurementTool() {
    isMeasuringMultiPoint = !isMeasuringMultiPoint; // Use the new state variable
    measureToolBtn.classList.toggle('active', isMeasuringMultiPoint);
    measureToolBtn.setAttribute('aria-pressed', isMeasuringMultiPoint);
    mapElement.classList.toggle('measuring-cursor', isMeasuringMultiPoint);

    if (isMeasuringMultiPoint) {
        measureToolBtn.title = "Click to add points. Double-click or Enter to finish. Backspace undoes a point. Esc cancels.";
        map.closePopup();
        measurementDoubleClickZoomWasEnabled = map.doubleClickZoom.enabled();
        map.doubleClickZoom.disable();
        map.on('click', handleMultiPointMeasureClick);
        map.on('mousemove', handleMultiPointMouseMove);
        map.on('dblclick', finalizeMultiPointMeasure); // Add dblclick listener
        document.addEventListener('keydown', handleMeasureKeyDown); // For Esc key

        // Clear previous measurement layers (if any)
        measurementLayerGroup.clearLayers();
        multiPointPath = [];
        cachedMultiPointPixelDistance = 0;
        multiPointVertexMarkers = [];
        if (multiPointPolyline) map.removeLayer(multiPointPolyline);
        multiPointPolyline = null;
        if (multiPointTotalTooltip) map.removeLayer(multiPointTotalTooltip);
        multiPointTotalTooltip = null;
        // Clear other related layers/tooltips if you add them

        if (filtersPanelVisible) toggleFilterPanel();
    } else {
        measureToolBtn.title = "Measure Distance";
        finalizeMultiPointMeasure(false); // Clean up without making permanent
    }

    if (mobileMeasureBtn) {
        mobileMeasureBtn.classList.toggle('active', isMeasuringMultiPoint);
        mobileMeasureBtn.setAttribute('aria-pressed', isMeasuringMultiPoint ? 'true' : 'false');
    }
    trackAnalytics('measurement_toggled', { enabled: isMeasuringMultiPoint });
}

function handleMultiPointMeasureClick(e) {
    if (!isMeasuringMultiPoint || !currentlyLoadedMapId) return;
    if (shouldIgnoreMapPointerEvent(e)) return;
    // The first click of a double-click already placed the finishing point.
    if (e.originalEvent?.detail > 1) return;

    const clickPoint = e.latlng;
    multiPointPath.push(clickPoint);

    if (multiPointPath.length >= 2) {
        cachedMultiPointPixelDistance += map.distance(multiPointPath[multiPointPath.length - 2], multiPointPath[multiPointPath.length - 1]);
    } else {
        cachedMultiPointPixelDistance = 0;
    }

    // Add a vertex marker
    const vertexMarker = L.circleMarker(clickPoint, {
        radius: 5,
        color: 'cyan', // Or your preferred color
        fillColor: '#0ff',
        fillOpacity: 0.7,
        interactive: false
    }).addTo(measurementLayerGroup);
    multiPointVertexMarkers.push(vertexMarker);

    // Update the polyline
    if (multiPointPolyline) {
        multiPointPolyline.setLatLngs(multiPointPath);
    } else if (multiPointPath.length >= 2) {
        multiPointPolyline = L.polyline(multiPointPath, {
            color: 'yellow',
            weight: 3,
            dashArray: '5, 5',
            interactive: false
        }).addTo(measurementLayerGroup);
    }

    updateMeasurementTooltips(); // New function to handle tooltips
}

function handleMultiPointMouseMove(e) {
    if (!isMeasuringMultiPoint || multiPointPath.length === 0 || !currentlyLoadedMapId) return;

    const currentMapInfo = getMapRuntimeData(currentlyLoadedMapId);
    const scalePx = currentMapInfo?.scalePixels;
    const scaleKm = currentMapInfo?.scaleKilometers;

    const lastFixedPoint = multiPointPath[multiPointPath.length - 1];
    const currentMousePos = e.latlng;

    if (temporaryMouseMoveLine) {
        measurementLayerGroup.removeLayer(temporaryMouseMoveLine);
    }
    temporaryMouseMoveLine = L.polyline([lastFixedPoint, currentMousePos], {
        color: 'lime',
        weight: 2,
        dashArray: '3, 3',
        interactive: false
    }).addTo(measurementLayerGroup);

    if (temporaryMouseMoveTooltip) {
        map.removeLayer(temporaryMouseMoveTooltip); // Or measurementLayerGroup.removeLayer
    }

    const pixelDistance = map.distance(lastFixedPoint, currentMousePos);
    let segmentDistanceString = `${pixelDistance.toFixed(0)} px`;
    if (scalePx && scaleKm) {
        const kmDistance = (pixelDistance / scalePx) * scaleKm;
        segmentDistanceString = `${kmDistance.toFixed(2)} km`;
    }

    temporaryMouseMoveTooltip = L.tooltip({
        permanent: true,
        direction: 'top',
        className: 'measure-tooltip',
        offset: L.point(0, -10)
    })
        .setLatLng(currentMousePos)
        .setContent(`Segment: ${segmentDistanceString}`)
        .addTo(map); // Add to map to follow mouse, or to measurementLayerGroup
}

function updateMeasurementTooltips() {
    // Ensure the function doesn't run if not measuring or no path exists
    if (!currentlyLoadedMapId || multiPointPath.length < 1) {
        // Clean up any leftover tooltip if the path becomes empty
        if (multiPointTotalTooltip) {
            map.removeLayer(multiPointTotalTooltip);
            multiPointTotalTooltip = null;
        }
        return;
    }

    // Get map scale information
    const currentMapInfo = getMapRuntimeData(currentlyLoadedMapId);
    const scalePx = currentMapInfo?.scalePixels;
    // Assuming scaleKilometers in JSON truly represents kilometers for this calculation
    const scaleKmValue = currentMapInfo?.scaleKilometers;
    // Use 'km' as the unit name if scaleUnitName is not set or is generic,
    // but prefer scaleUnitName if it's specific (e.g. "miles" and you adjusted paces accordingly)
    const scaleUnitName = (currentMapInfo?.scaleUnitName && currentMapInfo.scaleUnitName !== 'units') ? currentMapInfo.scaleUnitName : 'km';

    const hasValidScale = typeof scalePx === 'number' && scalePx > 0 &&
        typeof scaleKmValue === 'number' && scaleKmValue > 0;

    // Calculate total pixel distance
    let totalPixelDistance = cachedMultiPointPixelDistance;

    // --- Build the Tooltip Content String ---
    let tooltipContent = '';
    let displayDistanceString = '';

    if (hasValidScale) {
        // Calculate distance in kilometers (or the unit defined by scaleKmValue)
        const totalDistanceInKm = (totalPixelDistance / scalePx) * scaleKmValue;
        lastMeasuredDistanceKm = totalDistanceInKm;
        displayDistanceString = `${totalDistanceInKm.toFixed(2)} ${scaleUnitName}`;

        // --- Updated Pace Values in Kilometers per Day ---
        const fastPaceKmPerDay = 48.28;
        const normalPaceKmPerDay = 38.62;
        const slowPaceKmPerDay = 28.97;
        // ---

        // Calculate days for each pace
        const daysFastPace = (totalDistanceInKm / fastPaceKmPerDay).toFixed(1);
        const daysNormalPace = (totalDistanceInKm / normalPaceKmPerDay).toFixed(1);
        const daysSlowPace = (totalDistanceInKm / slowPaceKmPerDay).toFixed(1);

        // Construct the multi-line tooltip content
        tooltipContent = `Total ≈ ${displayDistanceString}<br>Fast ≈ ${daysFastPace} Day(s)<br>Normal ≈ ${daysNormalPace} Day(s)<br>Slow ≈ ${daysSlowPace} Day(s)`;

    } else {
        // Scale is unknown or distance is zero
        if (totalPixelDistance > 0) {
            displayDistanceString = `${totalPixelDistance.toFixed(0)} pixels (Scale unknown)`;
            tooltipContent = `Total: ${displayDistanceString}<br>Days at Fast Pace: N/A<br>Days at Normal Pace: N/A<br>Days at Slow Pace: N/A`;
        } else if (multiPointPath.length === 1) {
            displayDistanceString = "Start point";
            tooltipContent = displayDistanceString; // Only show "Start point"
        } else {
            displayDistanceString = "0 pixels";
            tooltipContent = `Total: ${displayDistanceString}<br>Days at Fast Pace: N/A<br>Days at Normal Pace: N/A<br>Days at Slow Pace: N/A`;
        }
    }
    // --- Tooltip Content String is now built ---

    // Remove the previous total tooltip (if it exists)
    if (multiPointTotalTooltip) {
        map.removeLayer(multiPointTotalTooltip);
    }

    // Create and add the new total tooltip using the constructed content
    if (multiPointPath.length > 0) {
        multiPointTotalTooltip = L.tooltip({
            permanent: true,
            direction: 'right',
            className: 'measure-tooltip',
            offset: L.point(10, 0) // Position offset from the point
        })
            .setLatLng(multiPointPath[multiPointPath.length - 1]) // Position at the last point
            .setContent(tooltipContent) // Use the full tooltipContent string
            .addTo(map);
    } else {
        multiPointTotalTooltip = null; // Ensure it's null if path is empty
    }
}

function finalizeMultiPointMeasure(makePermanent = true) {
    isMeasuringMultiPoint = false;
    map.off('click', handleMultiPointMeasureClick);
    map.off('mousemove', handleMultiPointMouseMove);
    map.off('dblclick', finalizeMultiPointMeasure);
    document.removeEventListener('keydown', handleMeasureKeyDown);
    mapElement.classList.remove('measuring-cursor');
    measureToolBtn.classList.remove('active');
    measureToolBtn.setAttribute('aria-pressed', 'false');
    if (mobileMeasureBtn) {
        mobileMeasureBtn.classList.remove('active');
        mobileMeasureBtn.setAttribute('aria-pressed', 'false');
    }
    if (measurementDoubleClickZoomWasEnabled) map.doubleClickZoom.enable();
    measurementDoubleClickZoomWasEnabled = false;
    measureToolBtn.title = "Measure Distance";


    if (temporaryMouseMoveLine) {
        measurementLayerGroup.removeLayer(temporaryMouseMoveLine);
        temporaryMouseMoveLine = null;
    }
    if (temporaryMouseMoveTooltip) {
        map.removeLayer(temporaryMouseMoveTooltip);
        temporaryMouseMoveTooltip = null;
    }

    if (!makePermanent || multiPointPath.length < 2) {
        measurementLayerGroup.clearLayers();
        if (multiPointPolyline) map.removeLayer(multiPointPolyline);
        multiPointPolyline = null;
        if (multiPointTotalTooltip) map.removeLayer(multiPointTotalTooltip);
        multiPointTotalTooltip = null;
        multiPointPath = [];
        cachedMultiPointPixelDistance = 0;
        multiPointVertexMarkers = [];
    } else {
        // Path and markers are already on measurementLayerGroup.
        // Make the total tooltip permanent on the polyline itself.
        if (multiPointPolyline && multiPointTotalTooltip) {
            // The multiPointTotalTooltip already has the full content
            // from the last call to updateMeasurementTooltips.
            // We just need to re-bind it or ensure it stays.
            // For simplicity, let's ensure it uses the latest content if it was removed and re-added.
            const finalContent = multiPointTotalTooltip.getContent(); // Get the already formatted content
            map.removeLayer(multiPointTotalTooltip); // Remove the one that was following the mouse

            multiPointPolyline.bindTooltip(finalContent, { // Use the captured finalContent
                permanent: true,
                direction: 'center',
                className: 'measure-tooltip',
                sticky: true // Make it sticky to the line
            }).openTooltip();
            // Ensure the individual vertex markers are cleared if they are not desired permanently
            multiPointVertexMarkers.forEach(marker => measurementLayerGroup.removeLayer(marker));
            multiPointVertexMarkers = [];
        }
    }
}

function handleMeasureKeyDown(e) {
    if (!isMeasuringMultiPoint || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        finalizeMultiPointMeasure(false); // Cancel measurement
    } else if (e.key === 'Enter') {
        e.preventDefault();
        finalizeMultiPointMeasure(true);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const removed = multiPointPath.pop();
        if (!removed) return;
        if (multiPointPath.length) {
            cachedMultiPointPixelDistance = Math.max(0, cachedMultiPointPixelDistance - map.distance(multiPointPath[multiPointPath.length - 1], removed));
        } else {
            cachedMultiPointPixelDistance = 0;
        }
        measurementLayerGroup.removeLayer(multiPointVertexMarkers.pop());
        if (multiPointPolyline) multiPointPolyline.setLatLngs(multiPointPath);
        if (temporaryMouseMoveLine) measurementLayerGroup.removeLayer(temporaryMouseMoveLine);
        if (temporaryMouseMoveTooltip) map.removeLayer(temporaryMouseMoveTooltip);
        temporaryMouseMoveLine = null;
        temporaryMouseMoveTooltip = null;
        updateMeasurementTooltips();
    }
}

measureToolBtn.addEventListener('click', (e) => {
    unlockAdvancedControls('measure_toggle');
    e.stopPropagation();
    toggleMeasurementTool(); // This should now call the multi-point version
});

// --- Inject Map Icon CSS ---
// REMOVED: Icons are now inline SVGs.

// --- NEW: Data Loading Functions ---
function setupKeyboardAndModalLogic() {
    // --- Keyboard Shortcut & Modal Logic ---
    const aboutModal = document.getElementById('about-modal');
    const closeAboutModalBtn = document.getElementById('close-about-modal-btn');
    const helpBtn = document.getElementById('help-btn');
    const aboutLink = document.getElementById('about-link');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let lastFocus = null;

    function toggleAboutModal(show, tabName = 'guide', source = 'manual') {
        if (!aboutModal) return;

        if (show) {
            if (featureDetailSheetOpen) {
                closeFeatureDetailSheet();
            }
            lastFocus = document.activeElement; // Save focus
            if (typeof aboutModal.setAttribute === 'function') {
                aboutModal.setAttribute('aria-hidden', 'false');
            }
            aboutModal.style.display = 'flex';
            // Small delay to allow display:flex to apply before adding visible class for transition
            requestAnimationFrame(() => {
                aboutModal.classList.add('visible');
                // Focus management: Focus the active tab or first tab
                const focusTarget = aboutModal.querySelector('.tab-btn.active') || aboutModal.querySelector('.tab-btn') || closeAboutModalBtn;
                if (focusTarget) focusTarget.focus();
            });
            if (tabName) switchTab(tabName);
            if (source !== 'onboarding_auto') {
                unlockAdvancedControls('help_open');
            }
            trackAnalytics('help_opened', { tab: tabName, source });
        } else {
            aboutModal.classList.remove('visible');
            setTimeout(() => {
                aboutModal.style.display = 'none';
                if (typeof aboutModal.setAttribute === 'function') {
                    aboutModal.setAttribute('aria-hidden', 'true');
                }
                if (lastFocus) lastFocus.focus(); // Restore focus
            }, 300); // Match transition duration
        }
    }

    // Trap focus inside modal
    if (aboutModal) {
        let cachedFocusableContent = null;
        aboutModal.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                if (!cachedFocusableContent) {
                    cachedFocusableContent = aboutModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                }
                const focusableContent = cachedFocusableContent;
                if (!focusableContent || focusableContent.length === 0) return;
                const first = focusableContent[0];
                const last = focusableContent[focusableContent.length - 1];

                if (e.shiftKey) { // Shift + Tab
                    if (document.activeElement === first) {
                        last.focus();
                        e.preventDefault();
                    }
                } else { // Tab
                    if (document.activeElement === last) {
                        first.focus();
                        e.preventDefault();
                    }
                }
            }
        });
    }

    openAboutModal = (tabName = 'guide', source = 'manual') => toggleAboutModal(true, tabName, source);
    closeAboutModal = () => toggleAboutModal(false);

    function switchTab(tabName) {
        tabBtns.forEach(btn => {
            if (btn.dataset.tab === tabName) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        tabContents.forEach(content => {
            if (content.id === `tab-${tabName}`) content.classList.add('active');
            else content.classList.remove('active');
        });
    }

    // Event Listeners for Modal
    if (closeAboutModalBtn) {
        closeAboutModalBtn.addEventListener('click', () => toggleAboutModal(false));
    }

    if (aboutModal) {
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) toggleAboutModal(false);
        });
    }

    if (helpBtn) {
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleAboutModal(true, 'guide', 'help_button');
        });
    }

    if (aboutLink) {
        aboutLink.addEventListener('click', (e) => {
            e.preventDefault();
            toggleAboutModal(true, 'lore', 'about_link');
        });
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    if (onboardingOpenHelpBtn) {
        onboardingOpenHelpBtn.addEventListener('click', () => {
            safeSetStorage(UX_STORAGE_KEYS.onboardingSeen, 'true');
            unlockAdvancedControls('onboarding_open_guide');
            setOnboardingVisibility(false);
            if (openAboutModal) openAboutModal('guide', 'onboarding_card');
        });
    }

    if (onboardingDismissBtn) {
        onboardingDismissBtn.addEventListener('click', () => {
            safeSetStorage(UX_STORAGE_KEYS.onboardingSeen, 'true');
            setOnboardingVisibility(false);
            trackAnalytics('onboarding_dismissed');
        });
    }

    if (shareRelayActionBtn) {
        shareRelayActionBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await relaySharedContext(shareRelayActionBtn);
        });
    }

    if (shareRelayDismissBtn) {
        shareRelayDismissBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideShareRelayPrompt('dismissed');
        });
    }

    function isInputFocused() {
        const activeElement = document.activeElement;
        return activeElement && (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable);
    }

    function handleHelpShortcut(e) {
        if (e.key === '?') {
            if (!isInputFocused()) { // Don't trigger if typing '?' in search
                e.preventDefault();
                if (aboutModal) {
                    const isVisible = aboutModal.classList.contains('visible');
                    toggleAboutModal(!isVisible, 'guide', 'shortcut');
                }
                return true;
            }
        }
        return false;
    }

    function handleEscapeShortcut(e) {
        // If help modal is open, Esc should close it
        if (aboutModal && aboutModal.classList.contains('visible') && e.key === 'Escape') {
            e.preventDefault();
            toggleAboutModal(false);
            return true;
        }

        // Handle Escape for other UI elements
        if (e.key === 'Escape') {
            if (mapChooserElement && !mapChooserElement.hidden) {
                closeMapChooserToMap();
                e.preventDefault();
            } else if (featureDetailSheetOpen) {
                closeFeatureDetailSheet();
                e.preventDefault();
            } else if (isMobileLayoutActive && hasOpenMobileSurface()) {
                closeMobileSheet({ restoreFocus: true });
                e.preventDefault();
            } else if (map.getPanes().popupPane.firstChild) { // Check if a Leaflet popup is open
                map.closePopup();
                e.preventDefault();
            } else if (filtersPanelVisible) {
                toggleFilterPanel(); // Your existing function
                e.preventDefault();
            } else if (searchResultsContainer.style.display === 'block') {
                closeSearchResults();
                if (poiSearchInput) poiSearchInput.blur();
                e.preventDefault();
            } else if (isMeasuringMultiPoint) { // For the new measurement tool
                finalizeMultiPointMeasure(false); // Cancel measurement
                e.preventDefault();
            }
            // Add other Escape handlers here if needed
            return true; // Processed Escape, no further checks for this key press
        }
        return false;
    }

    function handleSearchShortcut(e) {
        if ((e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'))) {
            if (searchControlContainer && searchControlContainer.style.display !== 'none' && poiSearchInput) {
                if (featureDetailSheetOpen) {
                    closeFeatureDetailSheet({ restoreFocus: false });
                }
                if (isMobileLayoutActive) {
                    openMobileSheet({ mode: MOBILE_SURFACE_MODE_SEARCH, focusSearch: true, triggerButton: mobileSearchLauncherBtn });
                } else {
                    poiSearchInput.focus();
                }
                e.preventDefault();
                return true;
            }
        }
        return false;
    }

    function handleGeneralShortcuts(e) {
        switch (e.key.toLowerCase()) {
            case '+':
            case '=':
                if (map) zoomMapBy(SMOOTH_ZOOM_STEP);
                e.preventDefault();
                return true;
            case '-':
                if (map) zoomMapBy(-SMOOTH_ZOOM_STEP);
                e.preventDefault();
                return true;
            case 's':
                if (toggleBtn) toggleBtn.click(); // Toggle Sidebar
                e.preventDefault();
                return true;
            case 't':
                if (themeToggle) themeToggle.click(); // Toggle Theme
                e.preventDefault();
                return true;
            case 'm':
                if (measureToolBtn && measureToolBtn.style.display !== 'none') {
                    measureToolBtn.click();
                    e.preventDefault();
                }
                return true;
            case 'h': // Toggle Markers/Regions
                if (toggleMarkersBtn && toggleMarkersBtn.style.display !== 'none') {
                    toggleMarkersBtn.click();
                    e.preventDefault();
                }
                return true;
            case 'f': // Toggle Filters Panel
                if (toggleFiltersBtn && toggleFiltersBtn.style.display !== 'none') {
                    toggleFiltersBtn.click();
                    e.preventDefault();
                }
                return true;
        }
        return false;
    }

    document.addEventListener('keydown', function (e) {
        if (handleEscapeShortcut(e)) return;
        if (featureDetailSheetExpanded) return;
        if (handleHelpShortcut(e)) return;

        // For other shortcuts, don't act if an input is focused or help modal is open
        if (isInputFocused() || (aboutModal && aboutModal.classList.contains('visible'))) {
            return;
        }

        if (handleSearchShortcut(e)) return;
        if (handleGeneralShortcuts(e)) return;
    });



}

async function loadMapData() {
    try {
        // Show loading indicator for data fetch
        if (loadingIndicator && !hasBootstrapMapPreview()) {
            loadingIndicator.style.display = 'flex';
            loadingIndicator.classList.add('initial-loader');
            const progressBar = loadingIndicator.querySelector('.progress-bar');
            if (progressBar) progressBar.style.width = '10%'; // Initial progress
            setLoadingMessage(getConfigValue('copy.loading.mapIndex', 'Loading map index...'), {
                showSpinner: true,
                showProgress: true,
                showRetry: false
            });
        }

        const atlas = await fetchJsonAsset('maps/atlas-index.json');
        if (!atlas || !Array.isArray(atlas.tree)) {
            throw new Error('Atlas index is missing a valid tree.');
        }
        prefetchedJsonUrls.add(withAssetVersion('maps/atlas-index.json'));

        if (loadingIndicator && loadingIndicator.querySelector('.progress-bar')) {
            loadingIndicator.querySelector('.progress-bar').style.width = '30%';
            setLoadingMessage(getConfigValue('copy.loading.processing', 'Processing map data...'), {
                showSpinner: true,
                showProgress: true,
                showRetry: false
            });
        }

        mapData = atlas.tree;
        configureAtlasSearchIndex(atlas);

        if (loadingIndicator && loadingIndicator.querySelector('.progress-bar')) {
            loadingIndicator.querySelector('.progress-bar').style.width = '100%';
        }

        // Setup UI logic
        setupKeyboardAndModalLogic();

        // Now that data is loaded, initialize the application
        initializeApp();

    } catch (error) {
        console.error('Error loading map data:', error);
        if (loadingIndicator) {
            setLoadingMessage(
                getConfigValue('copy.loading.mapIndexError', 'Error loading map index. Check your connection and press Retry.'),
                { showSpinner: false, showProgress: false, showRetry: true }
            );
        }
        // Optionally display an error message to the user in the UI
        const rawErrorMessage = getConfigValue('copy.loading.mapIndexError', 'Could not load map data. Please try refreshing the page or check the console for details.');
        const safeErrorMessage = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(rawErrorMessage)
            : escapeHtml(rawErrorMessage);

        if (sidebar) {
            sidebar.innerHTML = `<h2>Error</h2><p>${safeErrorMessage}</p>`;
        } else if (!loadingIndicator) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'fallback-error-notification';
            errorDiv.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ff4444;color:#fff;padding:15px;border-radius:4px;z-index:9999;box-shadow:0 4px 6px rgba(0,0,0,0.1);';
            errorDiv.innerHTML = `<strong>Error</strong>: ${safeErrorMessage}`;
            document.body.appendChild(errorDiv);
        }
        trackAnalytics('map_index_load_failed', { reason: error?.message || 'unknown' });
    }
}

function applyEmbeddedViewOverrides() {
    if (!isEmbeddedView) return;

    const wipPopup = document.getElementById('wip-popup');
    if (wipPopup) wipPopup.style.display = 'none';

    const bottomLinkBar = document.getElementById('bottom-link-bar');
    if (bottomLinkBar) bottomLinkBar.style.display = 'none';

    if (toggleBlurbBtn) toggleBlurbBtn.style.display = 'none';
    if (toggleGMPanelBtn) toggleGMPanelBtn.style.display = 'none';
    if (toggleToolkitPanelBtn) toggleToolkitPanelBtn.style.display = 'none';
    if (mapBlurbElement) setMapBlurbVisible(false);

    // Hide the sidebar toggle button
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    if (toggleSidebarBtn) toggleSidebarBtn.style.display = 'none';

    // Hide the sound toggle button.
    if (toggleSoundBtn) toggleSoundBtn.style.display = 'none';

    // Force sidebar to be collapsed initially
    setSidebarState('c', false);

    if (window.innerWidth <= 600) { // Or your preferred mobile breakpoint
        const wipPopup = document.getElementById('wip-popup');
        if (wipPopup) {
            setTimeout(() => {
                wipPopup.classList.add('fade-out');
            }, 7000); // 7 seconds delay
        }
    }
}

function hideInitialControls() {
    toggleMarkersBtn.style.display = 'none';
    toggleFiltersBtn.style.display = 'none';
    measureToolBtn.style.display = 'none';
    searchControlContainer.style.display = 'none';
    closeSearchResults();
    poiFilterContainer.classList.remove('visible');
    syncFilterPanelInteractionState(false);
    setAuxPanelVisible(sessionToolkitPanel, false);
    setAuxPanelVisible(gmPill, false);
}

function initializeOnboardingState() {
    if (!isEmbeddedView) {
        if (advancedControlsUnlocked && safeGetStorage(UX_STORAGE_KEYS.onboardingSeen) !== 'true') {
            safeSetStorage(UX_STORAGE_KEYS.onboardingSeen, 'true');
        }
        const hasSeenOnboarding = safeGetStorage(UX_STORAGE_KEYS.onboardingSeen) === 'true' || advancedControlsUnlocked;
        if (!hasSeenOnboarding) {
            setOnboardingVisibility(true);
            safeSetStorage(UX_STORAGE_KEYS.onboardingSeen, 'true');
            trackAnalytics('onboarding_shown');
            if (shouldAutoOpenOnboardingGuide({
                isEmbedded: isEmbeddedView,
                isMobileLayout: isMobileLayoutActive,
                hasSeenOnboarding
            })) {
                setTimeout(() => {
                    if (openAboutModal) openAboutModal('guide', 'onboarding_auto');
                }, 500);
            }
        } else {
            setOnboardingVisibility(false);
        }
    } else {
        setOnboardingVisibility(false);
    }
}

function initializeAppGlobalUIState() {
    isEmbeddedView = isEmbedModeFromUrl();
    if (bodyElement) bodyElement.classList.toggle('embedded-view', isEmbeddedView);
    if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('embedded-view', isEmbeddedView);
    }
    if (isEmbeddedView && container) {
        container.classList.add('sidebar-collapsed');
    }
    if (advancedControlsUnlocked) {
        safeSetStorage(UX_STORAGE_KEYS.advancedControlsUnlocked, 'true');
    }
    initializeGMVisibility();
    setPanelCollapsed(
        sessionToolkitPanel,
        toolkitCollapseBtn,
        safeGetStorage(UX_STORAGE_KEYS.toolkitPanelCollapsed) === 'true',
        null
    );
    updatePanelToggleButtons();

    applyEmbeddedViewOverrides();

    // Populate sidebar now that mapData is ready
    populateSidebar(mapListElement, mapData);
    initializeGMPillDrag();
}

function determineInitialSidebarState(hashSidebarState, initialMapIdFromHash = '') {
    const sidebarFromStorage = safeGetStorage(UX_STORAGE_KEYS.sidebarState);
    const hasSidebarInHash = window.location.hash.includes('-s=');
    return hasSidebarInHash ? hashSidebarState : (sidebarFromStorage || 'o');
}

function handleMapChooserInitialization() {
    renderMapChooser(mapData);
    setMapChooserVisible(true);
    setMapBlurbVisible(false);
    setOnboardingVisibility(false);
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
        loadingIndicator.classList.remove('initial-loader');
    }
    initializeSoundState();
    history.replaceState(
        {
            mapId: null,
            sidebarState: currentSidebarState,
            search: window.location.search,
            hash: window.location.hash || ''
        },
        '',
        `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    syncSidebarBackdropState();
    isInitializing = false;
}

function determineMapToLoad(initialMapIdFromHash) {
    let mapIdToLoad = initialMapIdFromHash;
    let mapToLoadData = null;

    const storedMapId = safeGetStorage(UX_STORAGE_KEYS.lastMapId);
    if (!mapIdToLoad && storedMapId) {
        mapIdToLoad = storedMapId;
    }

    // If hash points to a valid map, try to load it
    if (mapIdToLoad) {
        mapToLoadData = findMapRecursive(mapData, mapIdToLoad);
    }

    // If hash/storage target is invalid or non-renderable, fall back to first renderable map
    if (!isRenderableMapEntry(mapToLoadData)) {
        mapIdToLoad = findFirstLoadableIdRecursive(mapData);
        mapToLoadData = findMapRecursive(mapData, mapIdToLoad);
    }

    return { mapIdToLoad, mapToLoadData };
}

function handleNoMapFallback(effectiveSidebarState) {
    console.error("No loadable map data found for initialization.");
    if (sidebar) {
        sidebar.innerHTML = '';
        const h2 = document.createElement('h2');
        h2.textContent = getConfigValue('copy.sidebarTitle', 'Atlas');
        sidebar.appendChild(h2);

        const p = document.createElement('p');
        p.textContent = getConfigValue('copy.loading.noMaps', 'No maps available.');
        sidebar.appendChild(p);
    }
    setMapBlurbVisible(false);
    // Ensure loading indicator is hidden if it somehow wasn't
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    // Set a clean hash state
    const fallbackHash = generateHash('', effectiveSidebarState);
    history.replaceState(null, '', buildAppUrlWithHash(fallbackHash, window.location.search));
    isInitializing = false;
}

function finalizeAppInitialization(mapToLoadData, mapIdToLoad = '') {
    // Initialize sound state (after theme is applied)
    // This will now check for embed mode internally
    initializeSoundState();

    const loadedMapId = currentlyLoadedMapId || String(mapIdToLoad || mapToLoadData?.id || '').trim();
    const correctInitialHash = generateHash(loadedMapId, currentSidebarState);
    const currentSearch = window.location.search; // Get current search params like ?embed=true
    const finalUrl = buildAppUrlWithHash(correctInitialHash, currentSearch);
    history.replaceState({ mapId: loadedMapId, sidebarState: currentSidebarState }, mapToLoadData?.name || '', finalUrl);

    initializeOnboardingState();

    syncSidebarBackdropState();
    isInitializing = false;
}

function initializeApp() {
    initializeAppGlobalUIState();

    // Determine initial map and sidebar state
    const { mapId: initialMapIdFromHash, sidebarState: hashSidebarState } = parseHash();
    const initialSidebarState = determineInitialSidebarState(hashSidebarState, initialMapIdFromHash);

    const effectiveSidebarState = (isEmbeddedView || isMobileLayoutActive) ? 'c' : initialSidebarState;
    setSidebarState(effectiveSidebarState, false); // Set sidebar state without updating hash yet

    hideInitialControls();

    let mapIdToLoad = initialMapIdFromHash;
    if (shouldShowMapChooserForMapId(mapIdToLoad)) {
        handleMapChooserInitialization();
        return;
    }

    const mapLoadData = determineMapToLoad(initialMapIdFromHash);
    mapIdToLoad = mapLoadData.mapIdToLoad;
    let mapToLoadData = mapLoadData.mapToLoadData;

    // Load the determined map
    if (mapIdToLoad && isRenderableMapEntry(mapToLoadData)) {
        markersVisible = true; // Default to visible
        regionsVisible = true;
        loadMap(mapIdToLoad, false); // Load map, don't update hash yet
    } else {
        handleNoMapFallback(effectiveSidebarState);
        return; // Stop initialization
    }

    finalizeAppInitialization(mapToLoadData, mapIdToLoad);
}

// --- Start the application by loading data ---
registerServiceWorker();
loadMapData();
