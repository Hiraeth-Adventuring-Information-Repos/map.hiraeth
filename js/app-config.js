(function initAppConfig(root, factory) {
    function getDefaultBrandConfig() {
        return {
                siteName: 'HAG Interactive World Map Viewer',
                shortName: 'Hiraeth Maps',
                description: 'Explore interactive maps, discover points of interest, and measure distances in Hiraeth!',
                publicUrl: 'https://maps.hiraeth.wiki/',
                author: 'Jax SN Johnson',
                sourceUrl: 'https://jsnj.link/map-hiraeth-source',
                socialPreviewImage: 'https://maps.hiraeth.wiki/images/hiraeth-maps-preview.png',
                icons: {
                    favicon16: 'favicon-16x16.png',
                    favicon32: 'favicon-32x32.png',
                    favicon: 'favicon.png',
                    appleTouchIcon: 'apple-touch-icon.png'
                }
            };
    }

    function getDefaultAssetsConfig() {
        return {
                version: '0.1.49',
                stylesheets: [
                    'css/leaflet.css',
                    'css/style.css',
                    'css/stars.css',
                    'css/Control.MiniMap.min.css'
                ],
                editorStylesheets: [
                    'css/style.css',
                    'css/map-editor.css'
                ],
                scripts: [
                    'js/libs/leaflet.js',
                    'js/libs/Control.MiniMap.min.js',
                    'js/libs/lucide.min.js',
                    'js/starfield.js',
                    'js/shared-utils.js',
                    'js/app.js'
                ],
                editorScripts: [
                    'js/editor-shared.js',
                    'js/shared-utils.js',
                    'js/map-editor.js'
                ],
                cloudTexture: 'images/clouds.webp',
                previewImage: 'images/hiraeth-maps-preview.png',
                poiIcons: {
                    Settlements: 'images/poi-icons/settlements.svg',
                    Structures: 'images/poi-icons/structures.svg',
                    'Natural Features': 'images/poi-icons/natural-features.svg',
                    Other: 'images/poi-icons/other.svg',
                    Unknown: 'images/poi-icons/unknown.svg'
                },
                poiTypeIcons: {
                    Capital: 'images/poi-icons/capital.svg',
                    City: 'images/poi-icons/city.svg',
                    Town: 'images/poi-icons/town.svg',
                    Village: 'images/poi-icons/village.svg',
                    Hamlet: 'images/poi-icons/hamlet.svg',
                    Settlement: 'images/poi-icons/settlement.svg',
                    Castle: 'images/poi-icons/castle.svg',
                    Fortress: 'images/poi-icons/fortress.svg',
                    Fort: 'images/poi-icons/fort.svg',
                    Tower: 'images/poi-icons/tower.svg',
                    Ruin: 'images/poi-icons/ruin.svg',
                    Temple: 'images/poi-icons/temple.svg',
                    Shrine: 'images/poi-icons/shrine.svg',
                    Mine: 'images/poi-icons/mine.svg',
                    Lighthouse: 'images/poi-icons/lighthouse.svg',
                    Bridge: 'images/poi-icons/bridge.svg',
                    Gate: 'images/poi-icons/gate.svg',
                    Dungeon: 'images/poi-icons/dungeon.svg',
                    Lair: 'images/poi-icons/lair.svg',
                    Camp: 'images/poi-icons/camp.svg',
                    Asylum: 'images/poi-icons/asylum.svg',
                    Landmark: 'images/poi-icons/landmark.svg',
                    Building: 'images/poi-icons/building.svg',
                    Mountain: 'images/poi-icons/mountain.svg',
                    Peak: 'images/poi-icons/peak.svg',
                    Forest: 'images/poi-icons/forest.svg',
                    Wood: 'images/poi-icons/wood.svg',
                    River: 'images/poi-icons/river.svg',
                    Lake: 'images/poi-icons/lake.svg',
                    Cave: 'images/poi-icons/cave.svg',
                    Cavern: 'images/poi-icons/cavern.svg',
                    Coast: 'images/poi-icons/coast.svg',
                    Bay: 'images/poi-icons/bay.svg',
                    Cove: 'images/poi-icons/cove.svg',
                    Swamp: 'images/poi-icons/swamp.svg',
                    Marsh: 'images/poi-icons/marsh.svg',
                    Desert: 'images/poi-icons/desert.svg',
                    'Natural Landmark': 'images/poi-icons/natural-landmark.svg',
                    'Point of Interest': 'images/poi-icons/point-of-interest.svg',
                    Region: 'images/poi-icons/region.svg',
                    Portal: 'images/poi-icons/portal.svg',
                    Tavern: 'images/poi-icons/tavern.svg',
                    'Dock & Trading': 'images/poi-icons/dock-trading.svg',
                    Market: 'images/poi-icons/market-trade.svg',
                    Trade: 'images/poi-icons/market-trade.svg',
                    'Market & Trade': 'images/poi-icons/market-trade.svg',
                    'Market / Trade': 'images/poi-icons/market-trade.svg'
                },
                audio: {
                    light: 'sounds/gentle-winds.mp3',
                    dark: 'sounds/night-ambient.mp3'
                },
                serviceWorker: {
                    versionedShellAssets: [
                        'css/style.css',
                        'css/leaflet.css',
                        'css/stars.css',
                        'css/Control.MiniMap.min.css',
                        'js/app-config.js',
                        'js/shared-utils.js',
                        'js/libs/leaflet.js',
                        'js/libs/lucide.min.js',
                        'js/libs/purify.min.js',
                        'js/app.js',
                        'js/starfield.js',
                        'js/libs/Control.MiniMap.min.js',
                        'maps/atlas-index.json',
                        'site.config.json'
                    ],
                    staticShellAssets: [
                        './',
                        'index.html',
                        'favicon-16x16.png',
                        'favicon-32x32.png',
                        'favicon.png',
                        'apple-touch-icon.png',
                        'images/clouds.webp',
                        'images/toggle.svg',
                        'css/images/marker-icon.png',
                        'css/images/marker-icon-2x.png',
                        'css/images/marker-shadow.png',
                        'images/poi-icons/settlements.svg',
                        'images/poi-icons/structures.svg',
                        'images/poi-icons/natural-features.svg',
                        'images/poi-icons/other.svg',
                        'images/poi-icons/unknown.svg'
                    ]
                }
            };
    }

    function getDefaultThemeConfig() {
        return {
                preset: 'parchment',
                fontImportUrl: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400..800&display=swap',
                fontFamilyMain: "'EB Garamond', serif",
                baseTextScale: 1,
                tokens: {
                    light: {
                        '--bg-primary': '#fdfaf6',
                        '--bg-secondary': '#f4f0eb',
                        '--text-primary': '#6b2c25',
                        '--text-secondary': '#8f5a2f',
                        '--border-color': '#dcd3c8',
                        '--highlight-bg': 'rgba(212, 163, 106, 0.3)',
                        '--active-bg': 'rgba(189, 137, 77, 0.5)',
                        '--shadow-color': 'rgba(107, 44, 37, 0.15)',
                        '--slider-bg': '#d4a36a',
                        '--slider-color': 'white',
                        '--slider-checked-bg': '#1f70c9',
                        '--glass-bg-light': 'rgba(253, 250, 246, 0.75)',
                        '--glass-border-light': 'rgba(160, 82, 45, 0.3)',
                        '--popup-bg-light': '#f7f1e7',
                        '--popup-border-light': 'rgba(132, 92, 62, 0.42)',
                        '--popup-shadow-light': '0 2px 8px rgba(107, 44, 37, 0.1)',
                        '--scrollbar-track': 'rgba(0, 0, 0, 0.05)',
                        '--scrollbar-thumb': 'rgba(160, 82, 45, 0.5)',
                        '--scrollbar-thumb-hover': 'rgba(160, 82, 45, 0.7)',
                        '--focus-ring': '#0f5fbf'
                    },
                    dark: {
                        '--bg-primary': '#222034',
                        '--bg-secondary': '#1b1830',
                        '--text-primary': '#e8e6f2',
                        '--text-secondary': '#d4d3ff',
                        '--border-color': '#524f6c',
                        '--highlight-bg': 'rgba(237, 174, 73, 0.3)',
                        '--active-bg': 'rgba(66, 159, 227, 0.4)',
                        '--shadow-color': 'rgba(0, 0, 0, 0.3)',
                        '--slider-bg': '#555',
                        '--slider-color': '#429fe3',
                        '--slider-checked-bg': '#429fe3',
                        '--glass-bg-dark': 'rgba(34, 33, 50, 0.7)',
                        '--glass-border-dark': 'rgba(245, 67, 91, 0.3)',
                        '--popup-bg-dark': '#2c2933',
                        '--popup-border-dark': 'rgba(100, 91, 108, 0.62)',
                        '--popup-shadow-dark': '0 2px 10px rgba(0, 0, 0, 0.2)',
                        '--scrollbar-track': 'rgba(255, 255, 255, 0.05)',
                        '--scrollbar-thumb': 'rgba(114, 111, 150, 0.6)',
                        '--scrollbar-thumb-hover': 'rgba(114, 111, 150, 0.8)',
                        '--focus-ring': '#8dc4ff'
                    }
                },
                mapBackgroundColors: {
                    light: '#f4f0eb',
                    dark: '#050510'
                }
            };
    }

    function getDefaultFeaturesConfig() {
        return {
                sound: true,
                stars: true,
                atmosphere: true,
                minimap: true,
                shareLinks: true,
                serviceWorker: true,
                atlasSearch: true,
                filters: true,
                coordinates: true,
                sessionToolkit: false,
                gmMode: false,
                editor: true,
                onboarding: true,
                wipNotice: true,
                embeddedMode: true
            };
    }

    function getDefaultPerformanceConfig() {
        return {
                lowQualityMode: false,
                mobileBreakpoint: 768,
                starCount: 450,
                starFps: 30,
                tileAssetRoot: 'tile',
                tilePreviewFadeStartRatio: 0.45,
                tilePreviewRetireRatio: 0.76,
                tileFullImageFallback: true,
                idleTileWarmup: true,
                idleTileWarmupDelayMs: 1800,
                idleTileWarmupBatchSize: 4,
                idleTileWarmupBatchDelayMs: 80,
                idleTileWarmupMaxTiles: 768,
                idleTileWarmupMobileMaxTiles: 192,
                idleTileUpgradeMaxTiles: 160,
                idleTileUpgradeMobileMaxTiles: 72,
                linkedMapPrefetchLimit: 3,
                prefetchImages: true,
                prefetchJson: true,
                serviceWorker: true
            };
    }

    function getDefaultTaxonomyConfig() {
        return {
                poiTypeGroups: {
                    Settlements: ['City', 'Town', 'Village', 'Hamlet', 'Settlement', 'Capital'],
                    Structures: ['Castle', 'Fortress', 'Fort', 'Tower', 'Ruin', 'Temple', 'Shrine', 'Mine', 'Lighthouse', 'Bridge', 'Gate', 'Dungeon', 'Lair', 'Camp', 'Asylum', 'Landmark', 'Building'],
                    'Natural Features': ['Mountain', 'Peak', 'Forest', 'Wood', 'River', 'Lake', 'Cave', 'Cavern', 'Coast', 'Bay', 'Cove', 'Swamp', 'Marsh', 'Desert', 'Natural Landmark'],
                    Other: ['Point of Interest', 'Region', 'Portal', 'Tavern', 'Dock & Trading', 'Market', 'Trade', 'Market & Trade', 'Market / Trade'],
                    Unknown: ['Unknown']
                },
                labels: {
                    filterHeading: 'Filter by Type:',
                    showAll: 'Show All / Hide All',
                    atlasSearchScope: 'Atlas',
                    mapSearchScope: 'This Map'
                },
                defaultRegionStyle: {
                    color: '#3388ff',
                    fillColor: '#3388ff',
                    fillOpacity: 0.2
                },
                defaultLineStyle: {
                    color: '#ffffff',
                    weight: 3
                }
            };
    }

    function getDefaultCopyConfig() {
        return {
                sidebarTitle: 'Atlas',
                themeLabel: 'Theme',
                loading: {
                    mapData: 'Loading Map Data...',
                    mapIndex: 'Loading map index...',
                    processing: 'Processing map data...',
                    retry: 'Retry',
                    mapIndexError: 'Error loading map index. Check your connection and press Retry.',
                    noMaps: 'No maps available.'
                },
                onboarding: {
                    text: "New here? Open the Traveler's Guide for controls and shortcuts.",
                    openGuide: 'Open Guide',
                    dismiss: 'Dismiss'
                },
                shareRelay: {
                    default: 'Shared with you. Pass it on to your party.',
                    mapView: 'Shared with you. Pass this map view to your party.',
                    feature: 'Shared with you: {featureName}. Pass it on to your party.',
                    action: 'Share This',
                    dismiss: 'Dismiss'
                },
                wipNotice: [
                    'This atlas is still being refined.',
                    'Some markers, names, and boundaries may be inaccurate.'
                ],
                bottomLinks: [
                    { label: 'Wiki', href: 'https://jsnj.link/maps-to-wiki' },
                    { label: 'Blog', href: 'https://jsnj.link/maps-blog-post' },
                    { label: 'About', href: '#', id: 'about-link' },
                    { label: 'Source', href: 'https://jsnj.link/map-hiraeth-source' }
                ],
                help: {
                    tabs: [
                        {
                            id: 'guide',
                            label: "Traveler's Guide",
                            html: '<div class="guide-grid"><div class="guide-section"><h3>Navigation & Interaction</h3><p>Move freely through the map by clicking and dragging. Use your mouse wheel or trackpad to zoom in for detail or out for an overview.</p><ul><li><strong>Single Click:</strong> Identify a location or select a point for measurement.</li><li><strong>Double Click:</strong> Lock the coordinate display to a specific point.</li><li><strong>Click Links:</strong> Shareable links to specific locations can be shared or copied from popups.</li></ul><h3>Toolbar Controls</h3><ul><li><strong>Sidebar:</strong> Toggle the map list on the left.</li><li><strong>Markers:</strong> Show or hide all map markers and regions.</li><li><strong>Filters:</strong> Toggle specific categories of locations.</li><li><strong>Ruler:</strong> Measure a path with multiple points.</li><li><strong>Sound:</strong> Toggle ambient background audio.</li></ul></div><div class="guide-section"><h3>Keyboard Shortcuts</h3><p>Master these keys to navigate the realm swiftly.</p><div class="shortcut-grid"><kbd>+</kbd> <span class="shortcut-desc">Zoom In</span><kbd>-</kbd> <span class="shortcut-desc">Zoom Out</span><kbd>S</kbd> <span class="shortcut-desc">Toggle Sidebar</span><kbd>T</kbd> <span class="shortcut-desc">Toggle Theme</span><kbd>M</kbd> <span class="shortcut-desc">Measurement Tool</span><kbd>H</kbd> <span class="shortcut-desc">Toggle Markers</span><kbd>F</kbd> <span class="shortcut-desc">Toggle Filters</span><kbd>/</kbd> <span class="shortcut-desc">Search</span><kbd>?</kbd> <span class="shortcut-desc">Help</span><kbd>Esc</kbd> <span class="shortcut-desc">Close / Cancel</span></div></div></div>'
                        },
                        {
                            id: 'lore',
                            label: 'The Setting',
                            html: '<div class="lore-text"><h3>The World of Hiraeth</h3><p>Hiraeth is a realm born of imagination, nurtured through more than a decade of shared stories and dedicated world-building.</p><p>This interactive atlas is a living window into a world that has grown through tabletop roleplaying, stories, and hand-drawn maps.</p><p>Explore. Discover. The journey awaits.</p></div>'
                        },
                        {
                            id: 'changelog',
                            label: 'Changelog',
                            html: '<div class="changelog-entry"><div class="changelog-header"><h3>Map Loading Stabilization</h3><span class="version-pill" title="Current release">v0.1.32</span></div><ul class="changelog-list"><li>Faded the low-resolution map preview once detailed tiles cover most of the viewport.</li><li>Preloaded direct map definitions during startup so GitHub Pages can fetch map data sooner.</li><li>Bumped the shell asset version so service-worker caches pick up the deployment.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Current Atlas Stabilization</h3><span class="version-pill" title="June 2026">v0.1.7</span></div><ul class="changelog-list"><li>Fixed map-view share URL handling and expanded regression coverage around shared map views.</li><li>Added Astrousia archive maps, IceBeach lore summaries, and updated atlas accessibility notes.</li><li>Hardened GitHub Pages validation, local-only editor access, atlas generation, and map-editor save flows.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Security, Tests, and Performance Sweep</h3><span class="version-pill" title="May 2026 to June 2026">v0.1.6</span></div><ul class="changelog-list"><li>Closed multiple DOM XSS risks in popups, map editor controls, app config rendering, help modals, search highlights, and encounter tables.</li><li>Added broad unit coverage for search, filters, storage helpers, popup builders, mobile layout, map loading, and share-link behavior.</li><li>Improved atlas search, filter loops, hydration, DOM traversal, and Leaflet line lookups for smoother large-map browsing.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Mobile Atlas and Editor Rebuild</h3><span class="version-pill" title="April 2026">v0.1.5</span></div><ul class="changelog-list"><li>Reworked mobile map navigation into focused search, maps, drawer, and bottom-sheet surfaces.</li><li>Migrated the atlas to file-backed map JSON manifests with generated runtime indexes and preserved metadata.</li><li>Added the map editor, map chooser UI, responsive minimap thumbnails, preset grouping, runtime guards, and configurable site bootstrap.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Smart Sharing and Atlas Polish</h3><span class="version-pill" title="March 2026">v0.1.4</span></div><ul class="changelog-list"><li>Introduced Smart Share Links, shared-view coachmarks, popup opacity tuning, and mobile layout refinements.</li><li>Added POI hover tooltips, reset-view improvements, compact search controls, and search highlight fixes.</li><li>Started the atlas manifest performance pass and refreshed Fair map artwork, boundaries, and Apsley content.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Deep Links, Embeds, and Safe Popups</h3><span class="version-pill" title="February 2026">v0.1.3</span></div><ul class="changelog-list"><li>Added custom icons, local-only GM/editor gating, UI refinements, and background polish.</li><li>Fixed URL history, hash generation, invalid-map startup fallback, coordinate labels, and sidebar state restoration.</li><li>Sanitized popup content, popup headers, custom properties, and wiki links while improving embed-first loading.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Sharing, Minimap, and Site Shell</h3><span class="version-pill" title="December 2025 to January 2026">v0.1.2</span></div><ul class="changelog-list"><li>Added feature sharing, map-view deep links, MiniMap support, and refined viewport indicator behavior.</li><li>Redesigned the about page, embed link generator, loading state, starfield, and point-finder map selection.</li><li>Added Stomion updates, dynamic controls, accessibility improvements, search bar fixes, and map-content polish.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>World Expansion and Richer Map Tools</h3><span class="version-pill" title="May 2025 to October 2025">v0.1.1</span></div><ul class="changelog-list"><li>Expanded Hiraeth with Old-Lin, Southern Thalassia, Gelwood, Arfordir, Krasnogory Krai, Zafra, Pyralis, and many Fair map revisions.</li><li>Added map lines, hierarchical filters, map-specific filter groups, custom feature properties, collapsible popups, pronunciation guides, and summaries.</li><li>Improved point-finder workflows, scale export, recursive map listings, region visibility tools, mobile controls, and README documentation.</li></ul></div><div class="changelog-entry"><div class="changelog-header"><h3>Origin Launch</h3><span class="version-pill" title="April 2025">v0.1.0</span></div><ul class="changelog-list"><li>Created the first Leaflet-based Hiraeth map viewer with Icebeach and Fair maps.</li><li>Added the sidebar, dark and light themes, EB Garamond styling, glassy UI, bottom links, about page, favicons, and wiki/blog/source links.</li><li>Introduced POI imports, marker types, region overlays, the measurement tool, ambient audio, embed mode, and early map data structure.</li></ul></div>'
                        }
                    ]
                },
                editor: {
                    title: 'Map Editor',
                    eyebrow: 'Internal Tool',
                    reload: 'Reload Data',
                    searchLabel: 'Atlas Search',
                    searchPlaceholder: 'Find a map or folder',
                    loading: 'Loading atlas data...',
                    toolbarHint: 'Click a feature to select it. Drag POI markers to move them, and drag orange vertex handles to reshape regions and lines.',
                    emptyTitle: 'No Renderable Map Selected',
                    emptyCopy: 'Select a map with image data to edit points, regions, and lines.'
                }
            };
    }

    function getDefaultSecurityConfig() {
        return {
                analyticsEndpoint: '',
                gmToolkitPolicy: 'local-only',
                externalLinksNewTab: true,
                allowedVisibilityValues: ['public', 'gm', 'private']
            };
    }

    const DEFAULT_SITE_CONFIG = {
        brand: getDefaultBrandConfig(),
        assets: getDefaultAssetsConfig(),
        theme: getDefaultThemeConfig(),
        features: getDefaultFeaturesConfig(),
        performance: getDefaultPerformanceConfig(),
        taxonomy: getDefaultTaxonomyConfig(),
        copy: getDefaultCopyConfig(),
        security: getDefaultSecurityConfig()
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = factory(root, DEFAULT_SITE_CONFIG);
        return;
    }
    root.AppConfig = factory(root, DEFAULT_SITE_CONFIG);
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAppConfig(root = {}, DEFAULT_SITE_CONFIG = {}) {
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/`/g, '&#96;');
    }

    const COLOR_LIKE_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+|var\(--[a-z0-9_-]+\)|transparent|white|black)$/i;
    const COLOR_LIKE_TOKEN_KEYWORDS = ['color', 'bg', 'ring', 'thumb', 'slider', 'text'];
    const THEME_TOKEN_MODES = ['light', 'dark'];

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function deepMerge(base, override) {
        if (!isPlainObject(base)) return clone(override);
        const merged = clone(base);
        if (!isPlainObject(override)) return merged;
        Object.keys(override).forEach((key) => {
            const nextValue = override[key];
            if (nextValue === undefined) return;
            if (isPlainObject(merged[key]) && isPlainObject(nextValue)) {
                merged[key] = deepMerge(merged[key], nextValue);
                return;
            }
            merged[key] = clone(nextValue);
        });
        return merged;
    }

    function getPathValue(source, path, fallbackValue = undefined) {
        const parts = Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean);
        let cursor = source;
        for (const part of parts) {
            if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
                return fallbackValue;
            }
            cursor = cursor[part];
        }
        return cursor === undefined ? fallbackValue : cursor;
    }

    function getCurrentReleaseChangelogHtml(version) {
        const versionLabel = escapeHtml(`v${String(version || '').trim()}`);
        return `<div class="changelog-entry"><div class="changelog-header"><h3>Faster Maps and Flexible Details</h3><span class="version-pill" title="Current release">${versionLabel}</span></div><ul class="changelog-list"><li>Shows a quick map preview first, then quietly loads and saves sharper map tiles while the view is resting.</li><li>Stops background loading as soon as the map moves, avoids extra work on data-saving connections, and reuses saved tiles on later visits.</li><li>Prevents white zoom flashes and unstyled startup text while detailed map imagery is loading.</li><li>Gives Atlas, Search, and location details clearer jobs, with a large player-friendly Details window that can also dock to the right.</li><li>Lets desktop players drag and resize Details, adjust both sidebars, and keep their preferred layout after refreshing.</li><li>Puts place names and story text first, keeps internal fields behind Stats, and replaces the wide Focus button with a compact map-target control.</li><li>Keeps Search visible unless the floating Details window actually covers it, with calmer timing near the overlap boundary.</li><li>Keeps the mobile experience predictable with a fixed bottom sheet and fullscreen details option.</li></ul></div>`;
    }

    function syncCurrentReleaseChangelog(config) {
        const changelogTabs = config?.copy?.help?.tabs;
        if (!Array.isArray(changelogTabs)) return;
        const changelogTab = changelogTabs.find((tab) => tab && tab.id === 'changelog');
        if (!changelogTab || typeof changelogTab.html !== 'string') return;

        const version = String(config?.assets?.version || '').trim();
        if (!version) return;
        const versionLabel = `v${version}`;
        if (changelogTab.html.includes(`>${versionLabel}<`) && changelogTab.html.includes('title="Current release"')) {
            return;
        }
        changelogTab.html = `${getCurrentReleaseChangelogHtml(version)}${changelogTab.html.replace(/\s+title="Current release"/g, '')}`;
    }

    function normalizeConfig(rawConfig = {}) {
        const merged = deepMerge(DEFAULT_SITE_CONFIG, rawConfig);
        if (!merged.brand.socialPreviewImage && merged.assets.previewImage) {
            merged.brand.socialPreviewImage = merged.assets.previewImage;
        }
        merged.theme.tokens.light['--font-family-main'] = merged.theme.fontFamilyMain;
        merged.theme.tokens.dark['--font-family-main'] = merged.theme.fontFamilyMain;
        syncCurrentReleaseChangelog(merged);
        return merged;
    }

    function isColorLikeTokenKey(key) {
        return COLOR_LIKE_TOKEN_KEYWORDS.some((keyword) => key.includes(keyword));
    }

    function validateThemeTokenValue(mode, key, rawValue, errors) {
        if (!isColorLikeTokenKey(key)) return;

        const value = String(rawValue || '').trim();
        if (!value || COLOR_LIKE_PATTERN.test(value)) return;

        errors.push(`theme.tokens.${mode}.${key} has an invalid color-like value.`);
    }

    function validateThemeTokens(themeTokens, errors) {
        THEME_TOKEN_MODES.forEach((mode) => {
            const tokens = themeTokens[mode];
            if (!isPlainObject(tokens)) {
                errors.push(`theme.tokens.${mode} must be an object.`);
                return;
            }

            Object.keys(tokens).forEach((key) => validateThemeTokenValue(mode, key, tokens[key], errors));
        });
    }

    function validateBrand(brand, errors) {
        if (!String(brand.siteName || '').trim()) errors.push('brand.siteName is required.');
        if (!String(brand.description || '').trim()) errors.push('brand.description is required.');
    }

    function validateAssets(assets, errors) {
        if (!String(assets.version || '').trim()) errors.push('assets.version is required.');
        if (!Array.isArray(assets.stylesheets) || assets.stylesheets.length === 0) errors.push('assets.stylesheets must list at least one stylesheet.');
        if (!isPlainObject(assets.poiIcons) || !assets.poiIcons.Unknown) errors.push('assets.poiIcons.Unknown is required.');
    }

    function validateTaxonomy(taxonomy, errors) {
        if (!isPlainObject(taxonomy.poiTypeGroups) || !Array.isArray(taxonomy.poiTypeGroups.Unknown)) errors.push('taxonomy.poiTypeGroups.Unknown must be an array.');
    }

    function validatePerformance(performance, errors) {
        if (!Number.isFinite(Number(performance.mobileBreakpoint)) || Number(performance.mobileBreakpoint) < 320) {
            errors.push('performance.mobileBreakpoint must be a number >= 320.');
        }
        if (!Number.isFinite(Number(performance.starCount)) || Number(performance.starCount) < 0) {
            errors.push('performance.starCount must be a non-negative number.');
        }
        if (!Number.isFinite(Number(performance.starFps)) || Number(performance.starFps) <= 0) {
            errors.push('performance.starFps must be a positive number.');
        }
        const tileAssetRoot = String(performance.tileAssetRoot || '').trim().replace(/\\/g, '/');
        if (!tileAssetRoot ||
            /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(tileAssetRoot) ||
            tileAssetRoot === '..' ||
            tileAssetRoot.startsWith('../') ||
            tileAssetRoot.includes('/../')) {
            errors.push('performance.tileAssetRoot must be a safe repository-relative path.');
        }
    }

    function validateConfig(config) {
        const candidate = normalizeConfig(config);
        const errors = [];
        validateBrand(candidate.brand, errors);
        validateAssets(candidate.assets, errors);
        validateTaxonomy(candidate.taxonomy, errors);
        validateThemeTokens(candidate.theme.tokens, errors);
        validatePerformance(candidate.performance, errors);
        return errors;
    }

    let activeConfig = normalizeConfig(root.__SITE_CONFIG__ || {});
    let readyPromise = null;

    function setConfig(nextConfig) {
        const errors = validateConfig(nextConfig);
        if (errors.length > 0 && root.console && typeof root.console.warn === 'function') {
            root.console.warn('Site config validation warnings:', errors);
        }
        activeConfig = normalizeConfig(nextConfig);
        root.__SITE_CONFIG__ = activeConfig;
        root.APP_ASSET_VERSION = activeConfig.assets.version;
        if (activeConfig.security.analyticsEndpoint) {
            root.HAG_ANALYTICS_ENDPOINT = activeConfig.security.analyticsEndpoint;
        }
        return activeConfig;
    }

    function loadConfig(url = 'site.config.json') {
        if (readyPromise) return readyPromise;
        if (root.__SITE_CONFIG_EMBEDDED__ === true) {
            readyPromise = Promise.resolve(setConfig(root.__SITE_CONFIG__ || activeConfig));
            return readyPromise;
        }
        if (typeof root.fetch !== 'function') {
            readyPromise = Promise.resolve(setConfig(activeConfig));
            return readyPromise;
        }
        readyPromise = root.fetch(url, { cache: 'no-store' })
            .then((response) => {
                if (!response || !response.ok) return {};
                return response.json();
            })
            .then((rawConfig) => setConfig(rawConfig))
            .catch(() => setConfig(activeConfig));
        return readyPromise;
    }

    function setMeta(documentRef, selector, attrName, attrValue, content) {
        if (!documentRef) return;
        let element = documentRef.querySelector(selector);
        if (!element) {
            element = documentRef.createElement('meta');
            element.setAttribute(attrName, attrValue);
            documentRef.head.appendChild(element);
        }
        element.setAttribute('content', content);
    }

    function setIcon(documentRef, rel, href, sizes = '') {
        if (!documentRef || !href) return;
        let selector = `link[rel="${rel}"]`;
        if (sizes) selector += `[sizes="${sizes}"]`;
        let link = documentRef.querySelector(selector);
        if (!link) {
            link = documentRef.createElement('link');
            link.rel = rel;
            if (sizes) link.sizes = sizes;
            documentRef.head.appendChild(link);
        }
        link.href = href;
    }

    function applyDocumentMetadata(documentRef = root.document) {
        if (!documentRef) return;
        documentRef.title = activeConfig.brand.siteName;
        setMeta(documentRef, 'meta[property="og:description"]', 'property', 'og:description', activeConfig.brand.description);
        setMeta(documentRef, 'meta[property="og:image"]', 'property', 'og:image', activeConfig.brand.socialPreviewImage || activeConfig.assets.previewImage);
        setMeta(documentRef, 'meta[property="og:url"]', 'property', 'og:url', activeConfig.brand.publicUrl);
        setIcon(documentRef, 'icon', activeConfig.brand.icons.favicon32, '32x32');
        setIcon(documentRef, 'icon', activeConfig.brand.icons.favicon16, '16x16');
        setIcon(documentRef, 'apple-touch-icon', activeConfig.brand.icons.appleTouchIcon, '180x180');
    }

    function injectFont(documentRef = root.document) {
        if (!documentRef || !activeConfig.theme.fontImportUrl) return;
        if (!documentRef.querySelector('link[data-app-config-font="true"]')) {
            const link = documentRef.createElement('link');
            link.rel = 'stylesheet';
            link.href = activeConfig.theme.fontImportUrl;
            link.setAttribute('data-app-config-font', 'true');
            documentRef.head.appendChild(link);
        }
    }

    function renderTokenBlock(selector, tokens) {
        return `${selector} {\n${Object.keys(tokens).map((key) => `    ${key}: ${tokens[key]};`).join('\n')}\n}`;
    }

    function resolveDocumentAssetUrl(assetPath, documentRef = root.document) {
        const value = String(assetPath || '').trim();
        if (!value) return '';
        const baseUrl = documentRef?.baseURI || root.location?.href || '';
        if (!baseUrl) return value;
        try {
            return new URL(value, baseUrl).href;
        } catch {
            return value;
        }
    }

    function toCssUrl(assetPath, documentRef = root.document) {
        const url = resolveDocumentAssetUrl(assetPath, documentRef);
        const escapedUrl = url.replace(/["\\\n\r\f]/g, '\\$&');
        return `url("${escapedUrl}")`;
    }

    function applyThemeTokens(documentRef = root.document) {
        if (!documentRef) return;
        let style = documentRef.getElementById('app-config-theme-tokens');
        if (!style) {
            style = documentRef.createElement('style');
            style.id = 'app-config-theme-tokens';
            documentRef.head.appendChild(style);
        }
        const lightTokens = {
            ...activeConfig.theme.tokens.light,
            '--cloud-texture-url': toCssUrl(activeConfig.assets.cloudTexture, documentRef),
            '--glass-bg': 'var(--glass-bg-light)',
            '--glass-border': 'var(--glass-border-light)',
            '--popup-bg': 'var(--popup-bg-light)',
            '--popup-border': 'var(--popup-border-light)',
            '--popup-shadow': 'var(--popup-shadow-light)',
            '--popup-text': 'var(--text-primary)'
        };
        const darkTokens = {
            ...activeConfig.theme.tokens.dark,
            '--cloud-texture-url': toCssUrl(activeConfig.assets.cloudTexture, documentRef),
            '--glass-bg': 'var(--glass-bg-dark)',
            '--glass-border': 'var(--glass-border-dark)',
            '--popup-bg': 'var(--popup-bg-dark)',
            '--popup-border': 'var(--popup-border-dark)',
            '--popup-shadow': 'var(--popup-shadow-dark)',
            '--popup-text': 'var(--text-primary)'
        };
        style.textContent = [
            renderTokenBlock(':root', lightTokens),
            renderTokenBlock(':root[data-theme="dark"]', darkTokens)
        ].join('\n\n');
    }

    function setText(documentRef, selector, value) {
        const element = documentRef && documentRef.querySelector(selector);
        if (element && value !== undefined) element.textContent = value;
    }

    function hydrateBottomLinks(documentRef) {
        const bar = documentRef && documentRef.getElementById('bottom-link-bar');
        if (!bar || !Array.isArray(activeConfig.copy.bottomLinks)) return;
        bar.innerHTML = '';
        activeConfig.copy.bottomLinks.forEach((item) => {
            if (!item || !item.label) return;
            const link = documentRef.createElement('a');
            link.textContent = item.label;
            link.href = item.href || '#';
            if (item.id) link.id = item.id;
            if (activeConfig.security.externalLinksNewTab && link.href && !link.href.endsWith('#')) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            if (item.id === 'about-link') link.className = 'back-link';
            bar.appendChild(link);
        });
    }

    function hydrateHelpModal(documentRef) {
        const tabs = get('copy.help.tabs', []);
        const tabsContainer = documentRef && documentRef.querySelector('.modal-tabs');
        const body = documentRef && documentRef.querySelector('.modal-body');
        if (!tabsContainer || !body || !Array.isArray(tabs) || tabs.length === 0) return;
        tabsContainer.innerHTML = '';
        body.innerHTML = '';
        tabs.forEach((tab, index) => {
            const id = String(tab.id || `tab-${index}`).replace(/[^a-z0-9_-]/gi, '-');
            const button = documentRef.createElement('button');
            button.className = `tab-btn${index === 0 ? ' active' : ''}`;
            button.dataset.tab = id;
            button.textContent = tab.label || id;
            tabsContainer.appendChild(button);

            const content = documentRef.createElement('div');
            content.id = `tab-${id}`;
            content.className = `tab-content${index === 0 ? ' active' : ''}`;
            const rawHtml = tab.html || '';
            if (typeof DOMPurify !== 'undefined') {
                content.innerHTML = DOMPurify.sanitize(rawHtml);
            } else {
                content.textContent = rawHtml;
            }
            body.appendChild(content);
        });
    }

    function hydrateStaticDom(documentRef = root.document) {
        if (!documentRef) return;
        setText(documentRef, '.atlas-sidebar-heading h1', get('copy.sidebarTitle'));
        setText(documentRef, '.theme-switch-wrapper span', get('copy.themeLabel'));
        setText(documentRef, '#loading-indicator .loading-text', get('copy.loading.mapData'));
        setText(documentRef, '#loading-retry-btn', get('copy.loading.retry'));
        setText(documentRef, '#onboarding-coachmark p', get('copy.onboarding.text'));
        setText(documentRef, '#onboarding-open-help-btn', get('copy.onboarding.openGuide'));
        setText(documentRef, '#onboarding-dismiss-btn', get('copy.onboarding.dismiss'));
        setText(documentRef, '#share-relay-copy', get('copy.shareRelay.default'));
        setText(documentRef, '#share-relay-action-btn', get('copy.shareRelay.action'));
        setText(documentRef, '#share-relay-dismiss-btn', get('copy.shareRelay.dismiss'));
        setText(documentRef, '#poi-filter-container h3', get('taxonomy.labels.filterHeading'));
        setText(documentRef, 'label[for="filter-toggle-all"]', get('taxonomy.labels.showAll'));
        hydrateBottomLinks(documentRef);
        hydrateHelpModal(documentRef);

        const wipPopup = documentRef.getElementById('wip-popup');
        const notices = get('copy.wipNotice', []);
        if (wipPopup && Array.isArray(notices)) {
            wipPopup.innerHTML = '';
            notices.forEach((line) => {
                const p = documentRef.createElement('p');
                p.textContent = String(line);
                wipPopup.appendChild(p);
            });
            wipPopup.hidden = !get('features.wipNotice', true);
        }

        const lightSource = documentRef.querySelector('#light-ambient source');
        const darkSource = documentRef.querySelector('#dark-ambient source');
        if (lightSource) lightSource.dataset.src = get('assets.audio.light', '');
        if (darkSource) darkSource.dataset.src = get('assets.audio.dark', '');
    }

    function hydrateEditorDom(documentRef = root.document) {
        if (!documentRef) return;
        documentRef.title = `${get('brand.shortName', 'Atlas')} ${get('copy.editor.title', 'Map Editor')}`;
        setText(documentRef, '.map-editor-eyebrow', get('copy.editor.eyebrow'));
        setText(documentRef, '.map-editor-panel-header h1', get('copy.editor.title'));
        setText(documentRef, '#reload-editor-btn', get('copy.editor.reload'));
        setText(documentRef, '.map-editor-search-label', get('copy.editor.searchLabel'));
        const search = documentRef.getElementById('editor-tree-search');
        if (search) search.placeholder = get('copy.editor.searchPlaceholder', search.placeholder);
        setText(documentRef, '#editor-selection-status', get('copy.editor.loading'));
        setText(documentRef, '.map-editor-toolbar-hint', get('copy.editor.toolbarHint'));
        setText(documentRef, '#editor-map-empty-title', get('copy.editor.emptyTitle'));
        setText(documentRef, '#editor-map-empty-copy', get('copy.editor.emptyCopy'));
    }

    function get(path, fallbackValue = undefined) {
        return getPathValue(activeConfig, path, fallbackValue);
    }

    setConfig(activeConfig);

    return {
        DEFAULT_SITE_CONFIG,
        COLOR_LIKE_PATTERN,
        deepMerge,
        normalizeConfig,
        validateConfig,
        loadConfig,
        setConfig,
        get,
        getAll: () => activeConfig,
        applyDocumentMetadata,
        applyThemeTokens,
        injectFont,
        hydrateStaticDom,
        hydrateEditorDom,
        get ready() {
            return readyPromise || Promise.resolve(activeConfig);
        }
    };
}));
