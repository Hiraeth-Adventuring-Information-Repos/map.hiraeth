const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');

function extractFunctionRange(startMarker, endMarker) {
    const start = appSource.indexOf(startMarker);
    if (start === -1) {
        throw new Error(`Could not find start marker: ${startMarker}`);
    }
    const end = endMarker ? appSource.indexOf(endMarker, start) : appSource.length;
    if (end === -1) {
        throw new Error(`Could not find end marker: ${endMarker}`);
    }
    return appSource.slice(start, end);
}

let featureFlagOverrides = null;

function getFeatureFlag(name, fallbackValue) {
    if (!featureFlagOverrides || !Object.prototype.hasOwnProperty.call(featureFlagOverrides, name)) {
        return fallbackValue;
    }
    return featureFlagOverrides[name];
}

// eslint-disable-next-line no-eval
eval([
    extractFunctionRange('function resolveControlVisibilityState(', 'function shouldAutoOpenOnboardingGuide('),
    extractFunctionRange('function shouldAutoOpenOnboardingGuide(', 'function setElementHiddenState(')
].join('\n'));

const mobileVisibility = resolveControlVisibilityState({
    isMobileLayout: true,
    advancedControls: false,
    hasPOIs: true,
    hasRegions: true,
    hasRoads: true,
    hasValidScale: true,
    hasBlurb: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 10,
    toolkitVisible: true,
    gmVisible: true
});

assert.equal(mobileVisibility.showSearchControl, true);
assert.equal(mobileVisibility.showMarkersButton, false);
assert.equal(mobileVisibility.showMobileSheetToggle, true);
assert.equal(mobileVisibility.showMobileToolsToggle, true);
assert.equal(mobileVisibility.showMobileExploreMode, true);
assert.equal(mobileVisibility.showMobileMapMode, true);
assert.equal(mobileVisibility.showMobileMapList, true);
assert.equal(mobileVisibility.showMobileMoreSection, true);
assert.equal(mobileVisibility.showMobileMarkersAction, true);
assert.equal(mobileVisibility.showMobileFiltersAction, true);
assert.equal(mobileVisibility.showFiltersButton, false);
assert.equal(mobileVisibility.showSearchFilterAction, true);
assert.equal(mobileVisibility.showToolkitPanel, false);
assert.equal(mobileVisibility.showGMPill, false);
assert.equal(mobileVisibility.showMobileShareAction, true);
assert.equal(mobileVisibility.showMobileSoundAction, true);
assert.equal(mobileVisibility.showMobileMeasureAction, true);
assert.equal(mobileVisibility.showMobileCoordsAction, true);
assert.equal(mobileVisibility.showMobileHelpAction, true);
assert.equal(mobileVisibility.showMobileGMAction, false);
assert.equal(mobileVisibility.showMobileToolkitAction, false);
assert.equal(mobileVisibility.mobileMarkersDisabled, false);
assert.equal(mobileVisibility.mobileFiltersDisabled, false);
assert.equal(mobileVisibility.mobileMeasureDisabled, false);
assert.equal(mobileVisibility.mobileCoordsDisabled, false);
assert.equal(mobileVisibility.mobileGMDisabled, true);
assert.equal(mobileVisibility.mobileToolkitDisabled, true);
assert.equal(mobileVisibility.showMobileMapBlurb, false);

const mobileLimitedVisibility = resolveControlVisibilityState({
    isMobileLayout: true,
    advancedControls: false,
    hasPOIs: false,
    hasRegions: false,
    hasRoads: false,
    hasValidScale: false,
    hasBlurb: false,
    hasLatLonBounds: false,
    allowGMToolkit: true,
    atlasSearchCount: 12,
    toolkitVisible: true,
    gmVisible: true
});

assert.equal(mobileLimitedVisibility.showMobileMarkersAction, false);
assert.equal(mobileLimitedVisibility.showMobileFiltersAction, false);
assert.equal(mobileLimitedVisibility.showMobileMeasureAction, false);
assert.equal(mobileLimitedVisibility.showMobileShareAction, true);
assert.equal(mobileLimitedVisibility.showMobileCoordsAction, false);
assert.equal(mobileLimitedVisibility.showMobileHelpAction, true);
assert.equal(mobileLimitedVisibility.mobileMarkersDisabled, true);
assert.equal(mobileLimitedVisibility.mobileFiltersDisabled, true);
assert.equal(mobileLimitedVisibility.mobileMeasureDisabled, true);
assert.equal(mobileLimitedVisibility.mobileCoordsDisabled, true);
assert.equal(mobileLimitedVisibility.showMobileExploreMode, true);

const desktopVisibility = resolveControlVisibilityState({
    isMobileLayout: false,
    advancedControls: true,
    hasPOIs: true,
    hasRegions: true,
    hasRoads: true,
    hasValidScale: true,
    hasBlurb: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 10,
    toolkitVisible: true,
    gmVisible: true
});

assert.equal(desktopVisibility.showMobileSheetToggle, false);
assert.equal(desktopVisibility.showMarkersButton, true);
assert.equal(desktopVisibility.showFiltersButton, true);
assert.equal(desktopVisibility.showToolkitPanel, false);
assert.equal(desktopVisibility.showGMPill, false);
assert.equal(desktopVisibility.showMobileMapBlurb, false);

const desktopLockedVisibility = resolveControlVisibilityState({
    isMobileLayout: false,
    advancedControls: false,
    hasPOIs: true,
    hasRegions: true,
    hasRoads: true,
    hasValidScale: true,
    hasBlurb: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 10,
    toolkitVisible: true,
    gmVisible: true
});

assert.equal(desktopLockedVisibility.showMeasureButton, false);
assert.equal(desktopLockedVisibility.showSoundButton, false);
assert.equal(desktopLockedVisibility.showShareButton, false);
assert.equal(desktopLockedVisibility.showMobileMeasureAction, false);

const embeddedVisibility = resolveControlVisibilityState({
    isEmbedded: true,
    isMobileLayout: true,
    advancedControls: true,
    hasPOIs: true,
    hasRegions: true,
    hasValidScale: true,
    hasBlurb: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 5,
    toolkitVisible: true,
    gmVisible: true
});

assert.equal(embeddedVisibility.showMobileSheetToggle, false);
assert.equal(embeddedVisibility.showMobileToolsToggle, false);
assert.equal(embeddedVisibility.showMobileExploreMode, false);
assert.equal(embeddedVisibility.showMobileMapMode, false);
assert.equal(embeddedVisibility.showMobileShareAction, false);
assert.equal(embeddedVisibility.showMobileHelpAction, false);
assert.equal(embeddedVisibility.showMobileMapBlurb, false);

assert.equal(shouldAutoOpenOnboardingGuide({ isMobileLayout: true, hasSeenOnboarding: false }), false);
assert.equal(shouldAutoOpenOnboardingGuide({ isMobileLayout: false, hasSeenOnboarding: false }), true);
assert.equal(shouldAutoOpenOnboardingGuide({ isEmbedded: true, hasSeenOnboarding: false }), false);
assert.equal(shouldAutoOpenOnboardingGuide({ isMobileLayout: false, hasSeenOnboarding: true }), false);




// Test 1: Desktop with basic markers
const desktopBasic = resolveControlVisibilityState({
    hasPOIs: true,
    hasRegions: false,
    isMobileLayout: false
});
assert.equal(desktopBasic.showMarkersButton, true);
assert.equal(desktopBasic.showFiltersButton, true);
assert.equal(desktopBasic.showSearchControl, true);
assert.equal(desktopBasic.showMobileSheetToggle, false);

// Test 2: Mobile with advanced controls enabled (should still hide desktop advanced features)
const mobileAdvanced = resolveControlVisibilityState({
    isMobileLayout: true,
    advancedControls: true,
    hasPOIs: true,
    hasRegions: true,
    hasRoads: true,
    hasValidScale: true,
    hasBlurb: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 1,
    toolkitVisible: true,
    gmVisible: true
});
assert.equal(mobileAdvanced.showMarkersButton, false);
assert.equal(mobileAdvanced.showFiltersButton, false);
assert.equal(mobileAdvanced.showMeasureButton, false);
assert.equal(mobileAdvanced.showSoundButton, false);
assert.equal(mobileAdvanced.showShareButton, false);
assert.equal(mobileAdvanced.showGMButton, false);
assert.equal(mobileAdvanced.showToolkitButton, false);
assert.equal(mobileAdvanced.showToolkitPanel, false);
assert.equal(mobileAdvanced.showGMPill, false);

// Test 3: Embedded mode (should suppress floating tool panels and mobile elements)
const embeddedDesktop = resolveControlVisibilityState({
    isEmbedded: true,
    isMobileLayout: false,
    advancedControls: true,
    hasPOIs: true,
    allowGMToolkit: true,
    gmVisible: true
});
assert.equal(embeddedDesktop.showMobileSheetToggle, false);


// Test 4: Default fallback overrides
const defaultsOnlyVisibility = resolveControlVisibilityState({});
assert.equal(defaultsOnlyVisibility.showSearchControl, false);
assert.equal(defaultsOnlyVisibility.showMarkersButton, false);
assert.equal(defaultsOnlyVisibility.showFiltersButton, false);
assert.equal(defaultsOnlyVisibility.showMobileSheetToggle, false);

// Directions depend on a usable route graph, independently of advanced tools.
for (const isMobileLayout of [false, true]) {
    const routed = resolveControlVisibilityState({ isMobileLayout, hasTravelRoutes: true, routingEnabled: true });
    assert.equal(routed.showDirectionsButton, true);
    assert.equal(routed.showMobileDirectionsAction, isMobileLayout);
    assert.equal(resolveControlVisibilityState({ isMobileLayout }).showDirectionsButton, false);
    const unflagged = resolveControlVisibilityState({ isMobileLayout, hasTravelRoutes: true });
    assert.equal(unflagged.showDirectionsButton, false);
    assert.equal(unflagged.showMobileDirectionsAction, false);
    const embedded = resolveControlVisibilityState({ isMobileLayout, hasTravelRoutes: true, routingEnabled: true, isEmbedded: true });
    assert.equal(embedded.showDirectionsButton, false);
    assert.equal(embedded.showMobileDirectionsAction, false);
}

// Test 5: Feature flags remain independent from map capability and panel state
featureFlagOverrides = {
    atlasSearch: false,
    filters: false,
    sound: false,
    coordinates: false,
    shareLinks: false,
    gmMode: true,
    sessionToolkit: true
};

const featureFlaggedDesktop = resolveControlVisibilityState({
    advancedControls: true,
    hasPOIs: true,
    hasRegions: true,
    hasRoads: true,
    hasValidScale: true,
    hasBlurb: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 10,
    toolkitVisible: true,
    gmVisible: true
});
assert.equal(featureFlaggedDesktop.showMarkersButton, true);
assert.equal(featureFlaggedDesktop.showSearchControl, false);
assert.equal(featureFlaggedDesktop.showFiltersButton, false);
assert.equal(featureFlaggedDesktop.showSearchFilterAction, false);
assert.equal(featureFlaggedDesktop.showSoundButton, false);
assert.equal(featureFlaggedDesktop.showCoordsButton, false);
assert.equal(featureFlaggedDesktop.showShareButton, false);
assert.equal(featureFlaggedDesktop.showGMButton, true);
assert.equal(featureFlaggedDesktop.showToolkitButton, true);
assert.equal(featureFlaggedDesktop.showToolkitPanel, true);
assert.equal(featureFlaggedDesktop.showGMPill, true);

const featureFlaggedMobile = resolveControlVisibilityState({
    isMobileLayout: true,
    hasPOIs: true,
    hasRegions: true,
    hasRoads: true,
    hasValidScale: true,
    hasLatLonBounds: true,
    allowGMToolkit: true,
    atlasSearchCount: 10
});
assert.equal(featureFlaggedMobile.showSearchControl, false);
assert.equal(featureFlaggedMobile.showMobileFiltersAction, false);
assert.equal(featureFlaggedMobile.showMobileShareAction, false);
assert.equal(featureFlaggedMobile.showMobileSoundAction, false);
assert.equal(featureFlaggedMobile.showMobileCoordsAction, false);
assert.equal(featureFlaggedMobile.showMobileGMAction, true);
assert.equal(featureFlaggedMobile.showMobileToolkitAction, true);
assert.equal(featureFlaggedMobile.mobileFiltersDisabled, true);
assert.equal(featureFlaggedMobile.mobileShareDisabled, false);
assert.equal(featureFlaggedMobile.mobileSoundDisabled, false);
assert.equal(featureFlaggedMobile.mobileCoordsDisabled, false);
assert.equal(featureFlaggedMobile.mobileGMDisabled, false);
assert.equal(featureFlaggedMobile.mobileToolkitDisabled, false);

featureFlagOverrides = null;



console.log('mobile control visibility checks passed');
