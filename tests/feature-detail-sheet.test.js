const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const appSource = fs.readFileSync('js/app.js', 'utf8');
const sidebarStateStart = appSource.indexOf('function syncSidebarInteractionState() {');
const sidebarStateEnd = appSource.indexOf('function openMobileSheet(', sidebarStateStart);
const detailStart = appSource.indexOf('function refreshMapAfterFeatureDetailLayoutChange() {');
const detailEnd = appSource.indexOf('function syncSidebarPanels() {', detailStart);
if (sidebarStateStart === -1 || sidebarStateEnd === -1 || detailStart === -1 || detailEnd === -1) {
    throw new Error('Could not locate feature detail sheet helpers in js/app.js');
}
const featureDetailSource = [
    appSource.slice(sidebarStateStart, sidebarStateEnd),
    appSource.slice(detailStart, detailEnd)
].join('\n');

const dom = new JSDOM(`<!doctype html><body>
    <div class="container"></div>
    <div id="map" tabindex="-1"></div>
    <div id="feature-detail-backdrop" hidden></div>
    <section id="feature-detail-sheet" hidden tabindex="-1">
        <button id="feature-detail-layout-btn"></button>
        <button id="feature-detail-close-btn"></button>
    </section>
    <button id="popup-trigger">Details</button>
</body>`);

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.container = document.querySelector('.container');
global.bodyElement = document.body;
global.sidebar = document.createElement('aside');
global.sidebar.className = '';
global.mapContainerElement = document.createElement('main');
global.mapElement = document.getElementById('map');
global.featureDetailBackdrop = document.getElementById('feature-detail-backdrop');
global.featureDetailSheet = document.getElementById('feature-detail-sheet');
global.featureDetailLayoutBtn = document.getElementById('feature-detail-layout-btn');
global.searchControlContainer = null;
global.selectedSidebarFeature = { name: 'Apsley' };
global.selectedSidebarFeatureType = 'poi';
global.featureDetailSheetOpen = false;
global.featureDetailSheetExpanded = false;
global.featureDetailSheetDocked = false;
global.featureDetailDockedWidth = 380;
global.atlasSidebarWidth = 286;
global.featureDetailFloatingGeometry = null;
global.workspaceMapResizeFrame = null;
global.featureDetailSearchVisibilityTimer = null;
global.featureDetailSearchTargetObscured = false;
global.lastFeatureDetailTrigger = null;
global.isMobileLayoutActive = false;
global.mobileSurfaceMode = null;
global.MOBILE_SURFACE_MODE_ATLAS = 'atlas';
global.isMobileSurfaceMode = mode => global.mobileSurfaceMode === mode;
global.mapBlurbElement = null;
global.refreshLucideIcons = () => {};
global.hasOpenMobileSurface = () => false;
global.closeMobileSheet = () => {};
global.setMapBlurbVisible = () => {};
global.getSidebarFeatureTitle = feature => feature.name;
global.trackAnalytics = () => {};
global.requestAnimationFrame = callback => callback();
global.setTimeout = callback => {
    callback();
    return 1;
};
global.transitionDuration = 300;
global.UX_STORAGE_KEYS = {
    featureDetailMode: 'featureDetailMode',
    atlasSidebarWidth: 'atlasSidebarWidth',
    featureDetailDockedWidth: 'featureDetailDockedWidth',
    featureDetailGeometry: 'featureDetailGeometry'
};
global.FEATURE_DETAIL_MODE_FLOATING = 'floating';
global.FEATURE_DETAIL_MODE_DOCKED = 'docked';
global.ATLAS_WIDTH_DEFAULT = 286;
global.ATLAS_WIDTH_MIN = 240;
global.ATLAS_WIDTH_MAX = 420;
global.DETAIL_DOCKED_WIDTH_DEFAULT = 380;
global.DETAIL_DOCKED_WIDTH_MIN = 320;
global.DETAIL_DOCKED_WIDTH_MAX = 520;
global.DETAIL_FLOATING_WIDTH_MIN = 420;
global.DETAIL_FLOATING_HEIGHT_MIN = 300;
global.WORKSPACE_MAP_WIDTH_MIN = 360;
global.WORKSPACE_EDGE_MARGIN = 12;
global.atlasResizeHandle = null;
global.featureDetailDockResizeHandle = null;
global.featureDetailCornerResizeHandle = null;
global.featureDetailHeader = null;
global.detailStorage = new Map();
global.safeGetStorage = key => global.detailStorage.get(key) || null;
global.safeSetStorage = (key, value) => global.detailStorage.set(key, value);
global.safeRemoveStorage = key => global.detailStorage.delete(key);
global.safeGetJSON = () => null;
global.safeSetJSON = (key, value) => global.detailStorage.set(key, value);
global.map = {
    closeCount: 0,
    invalidateCount: 0,
    closePopup() {
        this.closeCount += 1;
    },
    invalidateSize() {
        this.invalidateCount += 1;
    }
};

// eslint-disable-next-line no-eval
eval(featureDetailSource);

const trigger = document.getElementById('popup-trigger');
trigger.focus();
assert.equal(openSelectedFeatureDetails(), false);
assert.equal(global.featureDetailSheetOpen, true);
assert.equal(global.featureDetailSheet.hidden, false);
assert.equal(global.featureDetailSheet.getAttribute('aria-hidden'), 'false');
assert.equal(global.featureDetailSheet.getAttribute('aria-modal'), 'false');
assert.equal(global.container.classList.contains('feature-detail-open'), true);
assert.equal(global.featureDetailSheet.classList.contains('floating'), true);
assert.equal(global.featureDetailLayoutBtn.getAttribute('aria-label'), 'Dock details to right');
assert.equal(global.map.closeCount, 1);

const searchControl = document.createElement('div');
searchControl.style.display = 'block';
searchControl.getBoundingClientRect = () => ({ left: 400, top: 700, right: 700, bottom: 750, width: 300, height: 50 });
document.body.appendChild(searchControl);
global.searchControlContainer = searchControl;
global.featureDetailSheet.getBoundingClientRect = () => ({ left: 450, top: 300, right: 800, bottom: 720, width: 350, height: 420 });
syncFeatureDetailSearchVisibility();
assert.equal(global.container.classList.contains('feature-detail-obscures-search'), true);
global.featureDetailSheet.getBoundingClientRect = () => ({ left: 450, top: 100, right: 800, bottom: 500, width: 350, height: 400 });
syncFeatureDetailSearchVisibility();
assert.equal(global.container.classList.contains('feature-detail-obscures-search'), false);

toggleFeatureDetailLayout();
assert.equal(global.featureDetailSheetDocked, true);
assert.equal(global.featureDetailSheet.classList.contains('docked'), true);
assert.equal(global.featureDetailSheet.classList.contains('floating'), false);
assert.equal(global.featureDetailSheet.getAttribute('aria-modal'), 'false');
assert.equal(global.featureDetailBackdrop.hidden, true);
assert.equal(global.featureDetailLayoutBtn.getAttribute('aria-pressed'), 'true');
assert.equal(global.featureDetailLayoutBtn.getAttribute('aria-label'), 'Open as main panel');
assert.equal(global.detailStorage.get('featureDetailMode'), 'docked');
assert.equal(global.mapContainerElement.inert, false);
syncFeatureDetailSearchVisibility();
assert.equal(global.container.classList.contains('feature-detail-obscures-search'), false);

global.isMobileLayoutActive = true;
toggleFeatureDetailLayout();
assert.equal(global.featureDetailSheetExpanded, true);
assert.equal(global.featureDetailSheet.classList.contains('expanded'), true);
assert.equal(global.featureDetailSheet.getAttribute('aria-modal'), 'true');
assert.equal(global.featureDetailBackdrop.hidden, false);
assert.equal(global.featureDetailLayoutBtn.getAttribute('aria-pressed'), 'true');
assert.equal(global.sidebar.inert, true);
assert.equal(global.sidebar.getAttribute('aria-hidden'), 'true');
assert.equal(global.mapContainerElement.inert, true);

const closeButton = document.getElementById('feature-detail-close-btn');
global.featureDetailSheet.focus();
let reverseTabPrevented = false;
trapFeatureDetailFocus({
    key: 'Tab',
    shiftKey: true,
    preventDefault() { reverseTabPrevented = true; }
});
assert.equal(reverseTabPrevented, true);
assert.equal(document.activeElement, closeButton);

closeButton.focus();
let tabPrevented = false;
trapFeatureDetailFocus({
    key: 'Tab',
    shiftKey: false,
    preventDefault() { tabPrevented = true; }
});
assert.equal(tabPrevented, true);
assert.equal(document.activeElement, global.featureDetailLayoutBtn);

closeFeatureDetailSheet({ restoreFocus: false });
assert.equal(global.featureDetailSheetOpen, false);
assert.equal(global.featureDetailSheet.hidden, true);
assert.equal(global.featureDetailBackdrop.hidden, true);
assert.equal(global.container.classList.contains('feature-detail-open'), false);
assert.equal(global.sidebar.inert, true, 'closed mobile Atlas remains inert while its surface is not selected');
assert.equal(global.sidebar.getAttribute('aria-hidden'), 'true');
assert.equal(global.mapContainerElement.inert, false);

// Width values above the implicit ARIA maximum of 100 need explicit bounds.
global.container.classList.add('sidebar-collapsed');
global.container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 });
global.featureDetailCornerResizeHandle = document.createElement('div');
for (const [requestedWidth, expectedWidth] of [[600, 600], [100, 420], [2000, 1176]]) {
    applyFloatingFeatureDetailGeometry({ left: 12, top: 12, width: requestedWidth, height: 400 });
    const handle = global.featureDetailCornerResizeHandle;
    assert.equal(handle.getAttribute('aria-valuemin'), '420');
    assert.equal(handle.getAttribute('aria-valuemax'), '1176');
    assert.equal(handle.getAttribute('aria-valuenow'), String(expectedWidth));
    assert.equal(handle.getAttribute('aria-valuetext'), `${expectedWidth} by 400 pixels`);
}

dom.window.close();
console.log('feature detail sheet behavior checks passed');
