const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');
const styleSource = fs.readFileSync('css/style.css', 'utf8');

function extractFunctionSource(name) {
    const start = appSource.indexOf(`function ${name}(`);
    if (start === -1) {
        throw new Error(`Could not find function ${name}`);
    }
    let depth = 0;
    let end = -1;
    for (let i = start; i < appSource.length; i += 1) {
        const char = appSource[i];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end === -1) {
        throw new Error(`Could not parse function ${name}`);
    }
    return appSource.slice(start, end);
}

const snippets = [
    extractFunctionSource('getPreferredMapImageUrl'),
    extractFunctionSource('getMiniMapImageUrl'),
    extractFunctionSource('createMapPreviewLayer'),
    extractFunctionSource('shouldShowMiniMap'),
    extractFunctionSource('removeMiniMapControl'),
    extractFunctionSource('getMiniMapDimensions'),
    extractFunctionSource('applyMiniMapA11yAttributes'),
    extractFunctionSource('syncMiniMapControl')
].join('\n');

global.enableMiniMapNavigation = () => {};
global.isEmbeddedView = false;
global.isMobileLayoutActive = true;
global.mobileLayoutV2Enabled = true;
global.currentBounds = [[0, 0], [1200, 2400]];
global.currentMapData = {
    id: 'default',
    width: 2400,
    height: 1200,
    imageUrl: 'maps/default.webp'
};
global.createdControls = 0;
global.L = {
    CRS: {
        Simple: {}
    },
    imageOverlay(url, bounds) {
        return { url, bounds, options: arguments[2] || {} };
    },
    latLngBounds(bounds) {
        return {
            getCenter() {
                return { bounds };
            }
        };
    },
    Control: {
        MiniMap: class MiniMap {
            constructor(layer, options) {
                this.layer = layer;
                this.options = options;
                this.containerAttributes = {};
                this.toggleAttributes = {};
                this._container = {
                    setAttribute: (name, value) => {
                        this.containerAttributes[name] = value;
                    },
                    querySelector: () => ({
                        setAttribute: (name, value) => {
                            this.toggleAttributes[name] = value;
                        }
                    })
                };
                global.createdControls += 1;
            }

            addTo(map) {
                this.map = map;
                return this;
            }

            remove() {
                this.removed = true;
            }
        }
    }
};
global.pendingMiniMapReady = null;
global.map = {
    _loaded: false,
    whenReady(callback) {
        global.pendingMiniMapReady = callback;
    }
};
global.miniMapControl = null;
global.miniMapControlMode = null;
global.miniMapControlMapId = null;

// eslint-disable-next-line no-eval
eval(snippets);

assert.doesNotThrow(() => removeMiniMapControl(), 'missing minimap control should be a safe no-op');
assert.equal(global.miniMapControl, null);
assert.equal(global.miniMapControlMode, null);
assert.equal(global.miniMapControlMapId, null);

let directRemoveCalls = 0;
const directMiniMapControl = {
    removed: false,
    remove() {
        directRemoveCalls += 1;
        this.removed = true;
    }
};

global.miniMapControl = directMiniMapControl;
global.miniMapControlMode = 'desktop';
global.miniMapControlMapId = 'default';

removeMiniMapControl();

assert.equal(directRemoveCalls, 1, 'active minimap control should be removed once');
assert.equal(directMiniMapControl.removed, true, 'active minimap control remove hook should run');
assert.equal(global.miniMapControl, null, 'minimap control reference should be cleared');
assert.equal(global.miniMapControlMode, null, 'minimap layout mode should be cleared');
assert.equal(global.miniMapControlMapId, null, 'minimap map id should be cleared');

removeMiniMapControl();

assert.equal(directRemoveCalls, 1, 'cleanup should be idempotent after the control is removed');

assert.equal(getMiniMapImageUrl({ imageUrl: 'maps/default.webp' }), 'maps/default.mini.webp');
assert.equal(getMiniMapImageUrl({ imageUrl: 'maps/Old-Lin Map.jpeg' }), 'maps/Old-Lin Map.mini.webp');
assert.equal(getMiniMapImageUrl({ imageUrl: 'maps/default.webp?asset=1#view' }), 'maps/default.mini.webp?asset=1#view');
assert.equal(getMiniMapImageUrl({ imageUrl: '' }), '');

const previewLayer = createMapPreviewLayer({ imageUrl: 'maps/default.webp' }, global.currentBounds);
assert.equal(previewLayer.url, 'maps/default.mini.webp');
assert.equal(previewLayer.options.pane, 'tilePane');
assert.equal(previewLayer.options.interactive, false);
assert.equal(previewLayer.options.className, 'map-preview-layer');
assert.equal(createMapPreviewLayer({ imageUrl: '' }, global.currentBounds), null);

assert.equal(shouldShowMiniMap(), true);
syncMiniMapControl();
assert.equal(global.miniMapControl, null);
assert.equal(global.createdControls, 0);
assert.equal(typeof global.pendingMiniMapReady, 'function');

global.map._loaded = true;
global.pendingMiniMapReady();
assert.ok(global.miniMapControl);
assert.equal(global.createdControls, 1);
assert.equal(global.miniMapControl.layer.url, 'maps/default.mini.webp');
assert.equal(global.miniMapControl.options.width, 132);
assert.equal(global.miniMapControlMapId, 'default');
assert.equal(global.miniMapControl.containerAttributes.role, 'region');
assert.equal(global.miniMapControl.containerAttributes['aria-label'], 'Map overview');
assert.equal(global.miniMapControl.toggleAttributes['aria-label'], 'Toggle map overview');
assert.match(styleSource, /body:not\(\.embedded-view\) \.leaflet-control-minimap \{[\s\S]*margin-right: 16px !important;[\s\S]*margin-bottom: 40px !important;/);
assert.match(styleSource, /\.leaflet-control-minimap \.leaflet-control-minimap-toggle-display \{\s*width: 40px !important;\s*height: 40px !important;[\s\S]*background-size: 20px 20px !important;/);

global.isMobileLayoutActive = false;
assert.equal(shouldShowMiniMap(), true);
syncMiniMapControl();
assert.ok(global.miniMapControl);
assert.equal(global.createdControls, 2);
assert.equal(global.miniMapControl.options.width, 200);

const createdControl = global.miniMapControl;
global.isMobileLayoutActive = true;
syncMiniMapControl();
assert.equal(createdControl.removed, true);
assert.ok(global.miniMapControl);
assert.equal(global.createdControls, 3);
assert.equal(global.miniMapControl.options.width, 132);

global.isMobileLayoutActive = false;
syncMiniMapControl();
assert.ok(global.miniMapControl);
assert.equal(global.createdControls, 4);

const mapChangeControl = global.miniMapControl;
global.currentMapData = {
    id: 'second-map',
    width: 2400,
    height: 1200,
    imageUrl: 'maps/second.webp'
};
syncMiniMapControl();
assert.equal(mapChangeControl.removed, true);
assert.ok(global.miniMapControl);
assert.equal(global.createdControls, 5);
assert.equal(global.miniMapControl.layer.url, 'maps/second.mini.webp');
assert.equal(global.miniMapControlMapId, 'second-map');

global.isEmbeddedView = true;
syncMiniMapControl();
assert.equal(global.miniMapControl, null);

console.log('mobile minimap visibility checks passed');
