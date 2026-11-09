const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

const setupIdx = appJs.indexOf("function setupKeyboardAndModalLogic() {");
const setupEndIdx = appJs.indexOf("async function loadMapData() {");
const block = appJs.slice(setupIdx, setupEndIdx);

// Mock the global environment to test the extracted functions
global.document = {
    activeElement: { tagName: 'BODY', focus: () => {} }, // added focus
    addEventListener: () => {},
    getElementById: (id) => {
        if (id === 'about-modal') return global.aboutModal;
        return {
            addEventListener: () => {},
            classList: { add: () => {}, remove: () => {} }
        };
    },
    querySelectorAll: () => []
};

global.aboutModal = {
    classList: {
        contains: (cls) => global.aboutModalVisible && cls === 'visible',
        add: () => { global.aboutModalVisible = true; },
        remove: () => { global.aboutModalVisible = false; }
    },
    style: { display: 'none' },
    addEventListener: () => {},
    querySelector: () => ({ focus: () => {} }) // mock focusTarget for toggleAboutModal
};

global.aboutModalVisible = false;

global.map = {
    closePopup: () => { global.popupClosed = true; },
    getPanes: () => ({ popupPane: { firstChild: global.hasPopup } })
};
global.hasPopup = false;
global.mapZoomedIn = false;
global.mapZoomedOut = false;
global.zoomMapDeltas = [];
global.popupClosed = false;

global.toggleBtn = { click: () => { global.sidebarToggled = true; } };
global.sidebarToggled = false;

global.themeToggle = { click: () => { global.themeToggled = true; } };
global.themeToggled = false;

global.measureToolBtn = { style: { display: 'block' }, click: () => { global.measureToggled = true; } };
global.measureToggled = false;

global.toggleMarkersBtn = { style: { display: 'block' }, click: () => { global.markersToggled = true; } };
global.markersToggled = false;

global.toggleFiltersBtn = { style: { display: 'block' }, click: () => { global.filtersToggled = true; } };
global.filtersToggled = false;

global.searchControlContainer = { style: { display: 'block' } };
global.poiSearchInput = { focus: () => { global.searchFocused = true; }, blur: () => { global.searchBlurred = true; } };
global.searchFocused = false;
global.searchBlurred = false;

global.isMobileLayoutActive = false;
global.mobileSearchLauncherBtn = null;
global.openMobileSheet = () => { global.mobileSheetOpened = true; };
global.mobileSheetOpened = false;
global.MOBILE_SURFACE_MODE_SEARCH = 'SEARCH';
global.mobileSurfaceOpen = false;
global.hasOpenMobileSurface = () => global.mobileSurfaceOpen;
global.mobileSurfaceClosed = false;
global.closeMobileSheet = () => {
    global.mobileSurfaceOpen = false;
    global.mobileSurfaceClosed = true;
};

global.filtersPanelVisible = false;
global.toggleFilterPanel = () => { global.filtersPanelToggled = true; };
global.filtersPanelToggled = false;

global.searchResultsContainer = { style: { display: 'none' } };
global.closeSearchResults = () => { global.searchResultsClosed = true; };
global.searchResultsClosed = false;

global.isMeasuringMultiPoint = false;
global.finalizeMultiPointMeasure = () => { global.multiPointCanceled = true; };
global.multiPointCanceled = false;

global.trackAnalytics = () => {};
global.safeSetStorage = () => {};
global.unlockAdvancedControls = () => {};
global.setOnboardingVisibility = () => {};
global.UX_STORAGE_KEYS = { onboardingSeen: 'seen' };
global.relaySharedContext = () => {};
global.hideShareRelayPrompt = () => {};
global.featureDetailSheetOpen = false;
global.featureDetailSheetExpanded = false;
global.closeFeatureDetailSheet = () => {
    global.featureDetailSheetOpen = false;
    global.featureDetailSheetExpanded = false;
    global.featureDetailsClosed = true;
};
global.featureDetailsClosed = false;
global.mapChooserElement = { hidden: true };
global.mapChooserClosed = false;
global.closeMapChooserToMap = () => {
    global.mapChooserElement.hidden = true;
    global.mapChooserClosed = true;
};

// Missing UI elements referenced in the setup block
global.onboardingOpenHelpBtn = null;
global.onboardingDismissBtn = null;
global.shareRelayActionBtn = null;
global.shareRelayDismissBtn = null;

// Variables from block
global.lastFocus = null;

let addedListener = null;
document.addEventListener = (evt, fn) => {
    if (evt === 'keydown' && fn.toString().includes('handleHelpShortcut')) {
        addedListener = fn;
    }
};

global.window = {
    requestAnimationFrame: (cb) => cb(),
    setTimeout: (cb) => cb()
};
global.requestAnimationFrame = global.window.requestAnimationFrame;
const origSetTimeout = global.setTimeout;
global.setTimeout = global.window.setTimeout;
const SMOOTH_ZOOM_STEP = 0.5;
function zoomMapBy(delta) {
    global.zoomMapDeltas.push(delta);
    if (delta > 0) global.mapZoomedIn = true;
    if (delta < 0) global.mapZoomedOut = true;
}

// Evaluate the block
eval(block + "\nsetupKeyboardAndModalLogic();");

// Create test events
const createEvent = (key, ctrlKey = false, metaKey = false, options = {}) => {
    let prevented = false;
    return {
        key,
        ctrlKey,
        metaKey,
        preventDefault: () => { prevented = true; },
        isPrevented: () => prevented,
        ...options
    };
};

assert.ok(addedListener, "Keydown listener should have been added");

// Test ? shortcut
let evt = createEvent('?');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.aboutModalVisible);

// Test Escape closing about modal
evt = createEvent('Escape');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(!global.aboutModalVisible);

// The mobile card is hidden and rerendered when its Guide action opens help.
// Closing help must return to the persistent Info launcher, not the removed action.
const mobileInfoLauncher = {
    tagName: 'BUTTON',
    focus() { document.activeElement = this; }
};
const removedGuideAction = { tagName: 'BUTTON', focus() {} };
global.mobileInfoHelpBtn = mobileInfoLauncher;
global.Element = class {};
let blurbClick;
global.mapBlurbElement = { addEventListener: (_, handler) => { blurbClick = handler; } };
global.setMapBlurbVisible = () => {};
global.unlockAdvancedControls = () => { removedGuideAction.isConnected = false; };
document.activeElement = removedGuideAction;
const blurbStart = appJs.indexOf("mapBlurbElement.addEventListener('click', (e) => {");
const blurbEnd = appJs.indexOf('// --- Coordinate Toggle Button Logic ---', blurbStart);
eval(appJs.slice(blurbStart, blurbEnd));
const guideTarget = new Element();
guideTarget.closest = () => removedGuideAction;
blurbClick({ target: guideTarget, stopPropagation() {} });
assert.equal(removedGuideAction.isConnected, false);
addedListener(createEvent('Escape'));
assert.equal(document.activeElement, mobileInfoLauncher, 'Escape returns focus to the mobile Info launcher');

// Ordinary help openings still restore the focused desktop launcher.
const desktopHelpLauncher = { tagName: 'BUTTON', focus() { document.activeElement = this; } };
document.activeElement = desktopHelpLauncher;
openAboutModal('guide', 'manual');
document.activeElement = { tagName: 'BUTTON' };
addedListener(createEvent('Escape'));
assert.equal(document.activeElement, desktopHelpLauncher);
global.unlockAdvancedControls = () => {};
document.activeElement = { tagName: 'BODY' };

// Escape should leave the full-screen map chooser without requiring a selection.
global.mapChooserElement.hidden = false;
const galleryShortcutState = () => JSON.stringify({
    measure: global.measureToggled, filters: global.filtersToggled,
    markers: global.markersToggled, sidebar: global.sidebarToggled,
    theme: global.themeToggled, search: global.searchFocused,
    help: global.aboutModalVisible, zoom: global.zoomMapDeltas
});
const galleryStateBefore = galleryShortcutState();
for (const key of ['m', 'M', 'f', 'F', '+', '=', '-', 's', 'S', 'h', 'H', 't', '/', '?']) {
    evt = createEvent(key);
    addedListener(evt);
    assert.equal(galleryShortcutState(), galleryStateBefore, `${key} must not change the map behind the gallery`);
    assert.equal(evt.isPrevented(), false, `gallery should retain ${key}`);
}
for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    evt = createEvent('f', false, false, modifier);
    addedListener(evt);
    assert.equal(galleryShortcutState(), galleryStateBefore, 'gallery must retain Ctrl/Cmd+F');
    assert.equal(evt.isPrevented(), false);
}
document.activeElement = { tagName: 'BUTTON' };
for (const key of ['Enter', ' ', 'Tab', 'ArrowDown']) {
    evt = createEvent(key);
    addedListener(evt);
    assert.equal(evt.isPrevented(), false, `gallery buttons should retain ${key}`);
}
evt = createEvent('Escape');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.mapChooserClosed);
assert.equal(global.measureToggled, false, 'Escape must not leave a measurement started behind the gallery');
evt = createEvent('m');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.measureToggled, 'map shortcuts must resume after leaving the gallery');
global.measureToggled = false;
document.activeElement = { tagName: 'BODY' };

// Escape should close any open mobile surface and return control to its launcher.
global.isMobileLayoutActive = true;
global.mobileSurfaceOpen = true;
evt = createEvent('Escape');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.mobileSurfaceClosed);
global.isMobileLayoutActive = false;

// Test + shortcut
evt = createEvent('+');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.mapZoomedIn);
assert.equal(global.zoomMapDeltas.at(-1), SMOOTH_ZOOM_STEP);

// Test - shortcut
evt = createEvent('-');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.mapZoomedOut);
assert.equal(global.zoomMapDeltas.at(-1), -SMOOTH_ZOOM_STEP);

// Test s shortcut
evt = createEvent('s');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.sidebarToggled);

// Test / shortcut
global.featureDetailSheetOpen = true;
global.featureDetailSheetExpanded = false;
evt = createEvent('/');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.searchFocused);
assert.ok(global.featureDetailsClosed);

// Expanded details should consume Escape but block all other global shortcuts.
global.featureDetailSheetOpen = true;
global.featureDetailSheetExpanded = true;
global.featureDetailsClosed = false;
global.sidebarToggled = false;
evt = createEvent('s');
addedListener(evt);
assert.ok(!evt.isPrevented());
assert.ok(!global.sidebarToggled);
evt = createEvent('?');
addedListener(evt);
assert.ok(!evt.isPrevented());
assert.ok(!global.aboutModalVisible);
evt = createEvent('Escape');
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.featureDetailsClosed);

// Test Ctrl+F shortcut
global.searchFocused = false;
evt = createEvent('f', true, false);
addedListener(evt);
assert.ok(evt.isPrevented());
assert.ok(global.searchFocused);

// Test input focused ignore
document.activeElement = { tagName: 'INPUT' };
evt = createEvent('t');
addedListener(evt);
assert.ok(!evt.isPrevented());
assert.ok(!global.themeToggled);

// Native controls retain text entry and type-to-select keys.
for (const activeElement of [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true }
]) {
    document.activeElement = activeElement;
    global.sidebarToggled = false;
    global.searchFocused = false;
    for (const key of ['s', '/', '?']) {
        evt = createEvent(key);
        addedListener(evt);
        assert.equal(evt.isPrevented(), false, `${activeElement.tagName} should retain ${key}`);
    }
    assert.equal(global.sidebarToggled, false);
    assert.equal(global.searchFocused, false);
    assert.equal(global.aboutModalVisible, false);
}

document.activeElement = { tagName: 'BODY' };
const shortcutState = () => JSON.stringify({
    sidebar: global.sidebarToggled, theme: global.themeToggled,
    measure: global.measureToggled, markers: global.markersToggled,
    filters: global.filtersToggled, search: global.searchFocused,
    help: global.aboutModalVisible, zoom: global.zoomMapDeltas
});
for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
    { ctrlKey: true, altKey: true }, { metaKey: true, shiftKey: true }]) {
    for (const key of ['s', 't', 'm', 'h', 'f', '+', '=', '-', '/', '?']) {
        if (key === 'f' && !modifier.altKey && !modifier.shiftKey) continue;
        const before = shortcutState();
        evt = createEvent(key, false, false, modifier);
        addedListener(evt);
        assert.equal(evt.isPrevented(), false, `browser command ${JSON.stringify(modifier)} ${key} must remain available`);
        assert.equal(shortcutState(), before);
    }
}
for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    global.searchFocused = false;
    evt = createEvent('f', false, false, modifier);
    addedListener(evt);
    assert.equal(evt.isPrevented(), true);
    assert.equal(global.searchFocused, true, 'Ctrl/Cmd+F must still focus map search');
}

// Local widgets and IME composition take precedence, including for Escape.
for (const options of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }]) {
    global.featureDetailSheetOpen = true;
    global.featureDetailsClosed = false;
    for (const key of ['s', '?', '/', 'Escape']) {
        const before = shortcutState();
        evt = createEvent(key, false, false, options);
        addedListener(evt);
        assert.equal(evt.isPrevented(), false);
        assert.equal(shortcutState(), before);
        assert.equal(global.featureDetailsClosed, false);
    }
}

console.log('All shortcut tests passed!');
global.setTimeout = origSetTimeout;
