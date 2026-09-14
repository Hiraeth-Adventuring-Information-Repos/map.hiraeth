const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('js/app.js', 'utf8');

const buildUrlStart = appSource.indexOf('function buildFeatureShareUrl(type, name) {');
const buildUrlEnd = appSource.indexOf('function canUseNativeShare(shareUrl) {');
const shareTrackingStart = appSource.indexOf('const sharedLinkOpenSessionKeys = new Set();');
const shareTrackingEnd = appSource.indexOf('function buildFeatureShareUrl(type, name) {');
const relaySourceStart = appSource.indexOf('async function executeShareAction({');
const relaySourceEnd = appSource.indexOf('window.openLinkedMapFromPopup = function(event, mapId) {');

if (
    buildUrlStart === -1 ||
    buildUrlEnd === -1 ||
    shareTrackingStart === -1 ||
    shareTrackingEnd === -1 ||
    relaySourceStart === -1 ||
    relaySourceEnd === -1
) {
    throw new Error('Could not locate Smart Share helpers in js/app.js');
}

const buildUrlSource = appSource.slice(buildUrlStart, buildUrlEnd);
const shareTrackingSource = appSource.slice(shareTrackingStart, shareTrackingEnd);
const relaySource = appSource.slice(relaySourceStart, relaySourceEnd);

global.window = {
    location: {
        href: 'https://maps.hiraeth.wiki/?view=12.01,30.4,2&poi=Old%20Dock#line-map-s=o'
    }
};
global.map = {
    getCenter() {
        return { lat: 18.123456, lng: -27.654321 };
    },
    getZoom() {
        return 3;
    }
};
global.currentlyLoadedMapId = 'icebeach';

// eslint-disable-next-line no-eval
eval(buildUrlSource);

const sharedRegionUrl = buildFeatureShareUrl('region', 'Starfall Bay');
const parsedShareUrl = new URL(sharedRegionUrl);

assert.equal(parsedShareUrl.searchParams.get('region'), 'Starfall Bay');
assert.equal(parsedShareUrl.searchParams.get('poi'), null);
assert.equal(parsedShareUrl.searchParams.get('line'), null);
assert.equal(parsedShareUrl.searchParams.get('view'), null);
assert.equal(parsedShareUrl.searchParams.get('src'), 'share');
assert.equal(parsedShareUrl.searchParams.get('stype'), 'region');
assert.equal(parsedShareUrl.hash, '#icebeach');
assert.equal(parsedShareUrl.pathname, '/share/icebeach/');

assert.equal(buildFeatureShareUrl('invalid-type', 'Name'), null);
assert.equal(buildFeatureShareUrl('poi', ''), null);

const sharedViewUrl = buildCurrentViewShareUrl();
const parsedViewShareUrl = new URL(sharedViewUrl);
assert.equal(parsedViewShareUrl.searchParams.get('view'), '18.1235,-27.6543,3');
assert.equal(parsedViewShareUrl.searchParams.get('poi'), null);
assert.equal(parsedViewShareUrl.searchParams.get('region'), null);
assert.equal(parsedViewShareUrl.searchParams.get('line'), null);
assert.equal(parsedViewShareUrl.searchParams.get('src'), 'share');
assert.equal(parsedViewShareUrl.searchParams.get('stype'), 'view');
assert.equal(parsedViewShareUrl.hash, '#icebeach');
assert.equal(parsedViewShareUrl.pathname, '/share/icebeach/');

// A local viewer must share the public deployment, including its base path.
global.getRuntimeConfigValue = () => 'https://maps.hiraeth.wiki/atlas/';
const originalHref = window.location.href;
window.location.href = 'http://127.0.0.1:8080/?poi=Old%20Dock#icebeach-s=c';
const localShare = new URL(buildCurrentViewShareUrl());
assert.equal(localShare.origin, 'https://maps.hiraeth.wiki');
assert.equal(localShare.pathname, '/atlas/share/icebeach/');
assert.equal(localShare.hash, '#icebeach-s=c');
window.location.href = 'http://127.0.0.1:8080/';
assert.equal(new URL(buildFeatureShareUrl('poi', 'Harbor')).hash, '#icebeach');
window.location.href = originalHref;
delete global.getRuntimeConfigValue;


const trackedEvents = [];
function trackAnalytics(eventName, details) {
    trackedEvents.push({ eventName, details });
}

let sessionStorageMock = {};
function safeGetSessionStorage(key) {
    return Object.hasOwn(sessionStorageMock, key) ? sessionStorageMock[key] : null;
}
function safeSetSessionStorage(key, value) {
    sessionStorageMock[key] = value;
}
const UX_STORAGE_KEYS = {
    shareRelayDismissedSession: 'shareRelayDismissedSession'
};
let isEmbeddedView = false;
const shareRelayCoachmark = { hidden: true };
const shareRelayCopy = { textContent: '' };
const shareRelayActionBtn = { dataset: {}, innerHTML: 'Share This' };
const shareRelayDismissBtn = { dataset: {} };
let activeShareRelayContext = null;
const shownShareRelaySessionKeys = new Set();

// eslint-disable-next-line no-eval
eval(shareTrackingSource);

const firstParams = new URLSearchParams('poi=Old Dock&src=share&stype=poi');
trackShareLinkOpenFromParams(firstParams, 'poi', 'Old Dock');
assert.equal(trackedEvents.length, 1);
assert.equal(trackedEvents[0].eventName, 'share_link_opened');
assert.equal(trackedEvents[0].details.source, 'share');
assert.equal(trackedEvents[0].details.sharedType, 'poi');
assert.equal(trackedEvents[0].details.featureName, 'Old Dock');

// Should be tracked once per session per feature.
trackShareLinkOpenFromParams(firstParams, 'poi', 'Old Dock');
assert.equal(trackedEvents.length, 1);

// Ignore non-share sources.
const nonShareParams = new URLSearchParams('poi=Old Dock&src=external&stype=poi');
trackShareLinkOpenFromParams(nonShareParams, 'poi', 'Old Dock');
assert.equal(trackedEvents.length, 1);

// Ignore attribution type mismatch.
const mismatchParams = new URLSearchParams('line=North Road&src=share&stype=line');
trackShareLinkOpenFromParams(mismatchParams, 'poi', 'Old Dock');
assert.equal(trackedEvents.length, 1);

// Different shared feature should still track.
trackShareLinkOpenFromParams(mismatchParams, 'line', 'North Road');
assert.equal(trackedEvents.length, 2);
assert.equal(trackedEvents[1].details.sharedType, 'line');
assert.equal(trackedEvents[1].details.featureName, 'North Road');

const sharedViewParams = new URLSearchParams('view=18.1235,-27.6543,3&src=share&stype=view');
trackShareViewOpenFromParams(sharedViewParams, '18.1235,-27.6543,3');
assert.equal(trackedEvents.length, 3);
assert.equal(trackedEvents[2].details.sharedType, 'view');
assert.equal(trackedEvents[2].details.featureName, 'current_view');

// Should be tracked once per session per shared view.
trackShareViewOpenFromParams(sharedViewParams, '18.1235,-27.6543,3');
assert.equal(trackedEvents.length, 3);

// Ignore non-share sources for view links.
const nonShareViewParams = new URLSearchParams('view=18.1235,-27.6543,3&src=external&stype=view');
trackShareViewOpenFromParams(nonShareViewParams, '18.1235,-27.6543,3');
assert.equal(trackedEvents.length, 3);

// Relay context extraction only returns valid shared-link contexts.
assert.deepEqual(
    getShareContextFromParams(new URLSearchParams('poi=Old Dock&src=share&stype=poi')),
    {
        source: 'share',
        sharedType: 'poi',
        featureType: 'poi',
        featureName: 'Old Dock'
    }
);
assert.deepEqual(
    getShareContextFromParams(new URLSearchParams('view=18.1235,-27.6543,3&src=share&stype=view')),
    {
        source: 'share',
        sharedType: 'view',
        featureType: 'view',
        featureName: 'current_view',
        view: '18.1235,-27.6543,3'
    }
);
assert.equal(getShareContextFromParams(new URLSearchParams('poi=Old Dock&src=external&stype=poi')), null);

// Relay prompt should track once per session key and respect session dismissal.
showShareRelayPrompt({
    source: 'share',
    sharedType: 'poi',
    featureType: 'poi',
    featureName: 'Old Dock'
});
assert.equal(trackedEvents.length, 4);
assert.equal(trackedEvents[3].eventName, 'share_relay_prompt_shown');

showShareRelayPrompt({
    source: 'share',
    sharedType: 'poi',
    featureType: 'poi',
    featureName: 'Old Dock'
});
assert.equal(trackedEvents.length, 4);

safeSetSessionStorage(UX_STORAGE_KEYS.shareRelayDismissedSession, 'true');
showShareRelayPrompt({
    source: 'share',
    sharedType: 'view',
    featureType: 'view',
    featureName: 'current_view',
    view: '18.1235,-27.6543,3'
});
assert.equal(trackedEvents.length, 4);
safeSetSessionStorage(UX_STORAGE_KEYS.shareRelayDismissedSession, 'false');

let copiedShareUrl = null;
const navigator = {
    share: undefined,
    clipboard: {
        async writeText(value) {
            copiedShareUrl = value;
        }
    }
};
function alert() {}
function canUseNativeShare() {
    return false;
}
function showShareButtonSuccessState() {}
function showShareButtonErrorState() {}
function hideShareRelayPrompt() {}

// eslint-disable-next-line no-eval
eval(relaySource);

(async () => {
    activeShareRelayContext = {
        source: 'share',
        sharedType: 'poi',
        featureType: 'poi',
        featureName: 'Old Dock'
    };
    await relaySharedContext({ dataset: {}, innerHTML: 'Share' });
    assert.match(copiedShareUrl, /stype=poi/);

    activeShareRelayContext = {
        source: 'share',
        sharedType: 'view',
        featureType: 'view',
        featureName: 'current_view',
        view: '18.1235,-27.6543,3'
    };
    await relaySharedContext({ dataset: {}, innerHTML: 'Share' });
    assert.match(copiedShareUrl, /stype=view/);

    console.log('share link flow regression checks passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
