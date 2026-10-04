const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

(function() {
    const routingExperimentEnabled = false;
    const appSource = fs.readFileSync('js/app.js', 'utf8');

    // We need the HTML and URL helpers used by buildPopupHeader.
    const utilsStart = appSource.indexOf('function escapeHtml(value) {');
    const utilsEnd = appSource.indexOf('function resolveLinkedMapData(featureData) {');

    const actionStart = appSource.indexOf('function handleMapPopupAction(event) {');
    const actionEnd = appSource.indexOf('// --- NEW: Unified Popup Content Generator ---');

    const buildStart = appSource.indexOf('function buildPopupHeader(data, type, safePronunciation) {');
    const buildEnd = appSource.indexOf('function buildPopupFullContent(data, safeDescription) {');

    if (
        utilsStart === -1 ||
        utilsEnd === -1 ||
        actionStart === -1 ||
        actionEnd === -1 ||
        buildStart === -1 ||
        buildEnd === -1
    ) {
        throw new Error('Could not locate required functions in js/app.js');
    }

    const utilsSource = appSource.slice(utilsStart, utilsEnd);
    const actionSource = appSource.slice(actionStart, actionEnd);
    const buildSource = appSource.slice(buildStart, buildEnd);

    // Mock resolveLinkedMapData
    global.mockLinkedMapData = null;
    function resolveLinkedMapData(data) {
        return global.mockLinkedMapData;
    }

    let detailOpenCount = 0;
    function openSelectedFeatureDetails() {
        detailOpenCount += 1;
        return false;
    }

    // eslint-disable-next-line no-eval
    eval(utilsSource);
    // eslint-disable-next-line no-eval
    eval(actionSource);
    // eslint-disable-next-line no-eval
    eval(buildSource);

    // Helper to reset mocks
    function reset() {
        global.mockLinkedMapData = null;
        detailOpenCount = 0;
    }

    function installPopup(html) {
        const { window } = new JSDOM(`<!doctype html><div id="map"><div id="popup">${html}</div></div>`, { runScripts: 'dangerously' });
        global.window = window;
        const mapRoot = window.document.getElementById('map');
        const root = window.document.getElementById('popup');
        root.addEventListener('click', (event) => event.stopPropagation());
        mapRoot.addEventListener('click', handleMapPopupAction, true);
        return { window, root };
    }

    // Test 1: Only data.name present (no type, no pronunciation, no linked map).
    reset();
    let result = buildPopupHeader({ name: 'Test Location' }, null, null);
    assert.ok(result.includes('<div class="popup-header-row"><h3>Test Location</h3></div>'), 'Should contain basic h3 with name');
    assert.ok(!result.includes('share-btn'), 'Should not contain share button without type');
    assert.ok(!result.includes('popup-map-jump'), 'Should not contain map jump without linked map');
    assert.ok(!result.includes('<em>'), 'Should not contain pronunciation');

    // Test 2: data.name and data.wikiLink present.
    reset();
    result = buildPopupHeader({ name: 'Wiki Location', wikiLink: 'https://example.com' }, null, null);
    assert.ok(result.includes('<a href="https://example.com/" target="_blank" rel="noopener noreferrer" title="Visit wiki page for Wiki Location">Wiki Location</a>'), 'Should contain wiki link');

    // Test 3: data.name and type present (with share button generated).
    reset();
    result = buildPopupHeader({ name: 'Shareable Location' }, 'poi', null);
    assert.ok(result.includes('<h3>Shareable Location</h3>'), 'Should contain basic h3');
    assert.ok(result.includes('data-popup-action="share-feature" data-feature-type="poi" data-feature-name="Shareable Location"'), 'Should contain share action data');
    assert.ok(result.includes('data-lucide="link-2"'), 'Should contain link icon');
    assert.ok(result.includes('class="popup-detail-expand"'), 'Should contain the detail sheet action');
    assert.ok(result.includes('data-popup-action="open-details"'), 'Detail action should use delegated event handling');
    assert.ok(!result.includes('onclick='), 'Popup actions should not use inline JavaScript');
    assert.ok(result.includes('aria-haspopup="dialog"'), 'Detail action should expose its dialog relationship');

    // Test 4: data.name, type, and safePronunciation present.
    reset();
    result = buildPopupHeader({ name: 'Pronounced Location' }, 'poi', 'pro-NOWNST');
    assert.ok(result.includes('<h3>Pronounced Location</h3>'), 'Should contain basic h3');
    assert.ok(result.includes('<p style="margin-top: -10px; margin-bottom: 5px;"><em>pro-NOWNST</em></p>'), 'Should contain pronunciation');
    assert.ok(result.includes('share-btn'), 'Should contain share button');

    // Test 5: data.name and resolveLinkedMapData returning a valid object.
    reset();
    global.mockLinkedMapData = { id: 'linked-map-id', name: 'Linked Map Name' };
    result = buildPopupHeader({ name: 'Location with Link' }, null, null);
    assert.ok(result.includes('<div class="popup-map-jump">'), 'Should contain map jump container');
    assert.ok(result.includes('<a href="#" data-popup-action="open-linked-map" data-linked-map-id="linked-map-id" title="Open map: Linked Map Name">'), 'Should contain map jump action data');
    assert.ok(result.includes('<span>Open Linked Map Name map</span>'), 'Should contain span text for screen readers/label');

    // Test 6: No data.name, but safePronunciation present.
    reset();
    result = buildPopupHeader({}, null, 'pro-NOWNST');
    assert.ok(!result.includes('<h3>'), 'Should not contain h3');
    assert.ok(!result.includes('popup-header-row'), 'Should not contain header row');
    assert.ok(result.includes('<p style="margin-top: -10px; margin-bottom: 5px;"><em>pro-NOWNST</em></p>'), 'Should contain pronunciation');

    // Test 7: Empty object.
    reset();
    result = buildPopupHeader({}, null, null);
    assert.equal(result, '', 'Should return empty string for empty data');

    // Test 8: Special characters in name are escaped
    reset();
    result = buildPopupHeader({ name: '<script>alert("XSS")</script>' }, 'poi', null);
    assert.ok(result.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'), 'Name should be escaped for HTML content');
    assert.ok(result.includes('data-feature-name="&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;"'), 'Name should be escaped for action data');

    // Test 9: Delegated share actions preserve apostrophes and cannot compile names as JavaScript.
    reset();
    const maliciousName = "Hob's Camp');globalThis.pwned=1;//";
    result = buildPopupHeader({ name: maliciousName }, 'poi', null);
    let popup = installPopup(result);
    popup.window.pwned = 0;
    let shareCall = null;
    popup.window.copyFeatureLink = (button, type, name) => {
        shareCall = { button, type, name };
    };
    popup.root.querySelector('.share-btn').click();
    assert.equal(shareCall.type, 'poi');
    assert.equal(shareCall.name, maliciousName);
    assert.equal(popup.window.pwned, 0);
    assert.equal(popup.root.querySelector('[onclick]'), null);

    // Test 10: Detail and linked-map actions still dispatch without inline handlers.
    popup.root.querySelector('.popup-detail-expand').click();
    assert.equal(detailOpenCount, 1);

    reset();
    const maliciousMapId = "linked-map');globalThis.pwned=2;//";
    global.mockLinkedMapData = { id: maliciousMapId, name: 'Linked Map Name' };
    result = buildPopupHeader({ name: 'Location with Link' }, null, null);
    popup = installPopup(result);
    popup.window.pwned = 0;
    let openedMapId = null;
    popup.window.openLinkedMapFromPopup = (event, mapId) => {
        event.preventDefault();
        openedMapId = mapId;
    };
    popup.root.querySelector('.popup-map-jump i').click();
    assert.equal(openedMapId, maliciousMapId);
    assert.equal(popup.window.pwned, 0);
    assert.equal(popup.root.querySelector('[onclick]'), null);

    assert.match(
        appSource,
        /map\.getContainer\(\)\.addEventListener\('click', handleMapPopupAction, true\)/,
        'Map container should register the delegated popup action handler during capture'
    );

    console.log('buildPopupHeader tests passed');
})();
