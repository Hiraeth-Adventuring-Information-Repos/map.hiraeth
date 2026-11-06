const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

function harness(t, { mobile = true } = {}) {
    const dom = new JSDOM(`<div id="map" tabindex="0"></div>
        <button id="launcher">Search</button><button id="other">Other</button>
        <section id="search"><input id="input"><div id="results"></div></section>`,
    { url: 'https://example.test/#a-s=c' });
    t.after(() => dom.window.close());
    const { document } = dom.window;
    // JSDOM has no layout; controls with rectangles represent rendered elements.
    const rendered = element => {
        element.getClientRects = () => [{ width: 50, height: 30 }];
        return element;
    };
    const byId = id => rendered(document.getElementById(id));
    const context = {
        window: dom.window, document, URLSearchParams,
        isMobileLayoutActive: mobile, mobileSurfaceMode: 'search', MOBILE_SURFACE_MODE_SEARCH: 'search',
        SEARCH_SCOPE_MAP: 'map', SEARCH_SCOPE_ATLAS: 'atlas', loadRequestToken: 5,
        currentSidebarState: 'c', currentlyLoadedMapId: 'a', mapData: [],
        mobileSearchPanel: byId('search'), searchResultsContainer: byId('results'),
        poiSearchInput: byId('input'), mapElement: byId('map'), mobileSearchLauncherBtn: byId('launcher'),
        activeSearchResultIndex: 0, renderedSearchResults: [],
        isMobileSurfaceMode(mode) { return context.mobileSurfaceMode === mode; },
        hasOpenMobileSurface() { return !!context.mobileSurfaceMode; },
        closeMobileSheet() {
            context.mobileSurfaceMode = null;
            context.mobileSearchPanel.inert = true;
            context.mobileSearchPanel.setAttribute('aria-hidden', 'true');
            context.poiSearchInput.blur();
        },
        closeSearchResults() { context.searchResultsContainer.replaceChildren(); },
        setSearchScope() {}, updateVisibleMarkersAndSearch() {}, updateActiveFilterChips() {}, syncMobileExploreVisibility() {},
        findMapRecursive: () => ({ id: 'b' }), isRenderableMapEntry: () => true,
        generateHash: id => `#${id}-s=c`,
        buildAppUrlWithHash: (hash, search) => search + hash,
        history: dom.window.history, trackAnalytics() {},
        allMapMarkersById: new Map(), allMapMarkersByName: new Map(),
        allMapRegionsById: new Map(), allMapRegionsByName: new Map(),
        allMapLinesById: new Map(), allMapLinesByName: new Map()
    };
    vm.createContext(context);
    vm.runInContext('let cancelPendingSearchResultFocus = null;\n' + [
        'isSearchResultFocusTarget', 'beginSearchResultFocusHandoff', 'selectSearchResult',
        'buildScopedSearchParams', 'openAtlasSearchResult'
    ].map(functionSource).join('\n'), context);
    function layer({ popup = true } = {}) {
        const marker = rendered(document.createElement('button'));
        marker.textContent = 'Selected marker';
        context.mapElement.append(marker);
        const popupElement = rendered(document.createElement('div'));
        popupElement.innerHTML = '<button data-popup-action="open-details">Details</button>';
        const details = rendered(popupElement.firstElementChild);
        if (popup) context.mapElement.append(popupElement);
        return { marker, popupElement, details,
            getElement: () => marker, getPopup: () => popup ? { getElement: () => popupElement } : null };
    }
    context.poiSearchInput.focus();
    return { context, document, dom, layer, byId };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('mobile Enter hands focus to the selected popup Details control', t => {
    const { context, document, layer } = harness(t);
    const selected = layer();
    context.renderedSearchResults = [{ onSelect: () => selected }];
    context.selectSearchResult();
    assert.equal(context.mobileSearchPanel.inert, true);
    assert.equal(document.activeElement, selected.details);
});

test('pointer selection from body hands focus to a visible marker when it has no popup', t => {
    const { context, document, layer } = harness(t);
    context.poiSearchInput.blur();
    const selected = layer({ popup: false });
    context.renderedSearchResults = [{ onSelect: () => selected }];
    context.selectSearchResult();
    assert.equal(document.activeElement, selected.marker);
});

test('desktop selection preserves focus', t => {
    const { context, document, layer } = harness(t, { mobile: false });
    context.closeMobileSheet = () => {};
    context.renderedSearchResults = [{ onSelect: () => layer() }];
    context.selectSearchResult();
    assert.equal(document.activeElement, context.poiSearchInput);
});

for (const hiddenState of ['hidden', 'inert', 'aria-hidden', 'display', 'visibility', 'disabled', 'detached']) {
    test(`focus skips a ${hiddenState} popup control`, t => {
        const { context, document, layer } = harness(t);
        const selected = layer();
        if (hiddenState === 'hidden') selected.popupElement.hidden = true;
        if (hiddenState === 'inert') selected.popupElement.setAttribute('inert', '');
        if (hiddenState === 'aria-hidden') selected.popupElement.setAttribute('aria-hidden', 'true');
        if (hiddenState === 'display') selected.popupElement.style.display = 'none';
        if (hiddenState === 'visibility') selected.popupElement.style.visibility = 'hidden';
        if (hiddenState === 'disabled') selected.details.disabled = true;
        if (hiddenState === 'detached') selected.popupElement.remove();
        context.renderedSearchResults = [{ onSelect: () => selected }];
        context.selectSearchResult();
        assert.equal(document.activeElement, selected.marker);
    });
}

test('missing or hidden result controls use the map, then its visible search launcher', t => {
    const { context, document, layer } = harness(t);
    const selected = layer({ popup: false });
    selected.marker.hidden = true;
    context.renderedSearchResults = [{ onSelect: () => selected }];
    context.selectSearchResult();
    assert.equal(document.activeElement, context.mapElement);
    context.mobileSurfaceMode = 'search';
    context.mobileSearchPanel.inert = false;
    context.mobileSearchPanel.removeAttribute('aria-hidden');
    context.poiSearchInput.focus();
    context.mapElement.setAttribute('inert', '');
    context.selectSearchResult();
    assert.equal(document.activeElement, context.mobileSearchLauncherBtn);
});

test('cross-map selection waits for its map definition before focusing its selected marker', async t => {
    const { context, document, layer } = harness(t);
    const loading = deferred();
    const selected = layer({ popup: false });
    context.loadMap = () => { context.loadRequestToken++; return loading.promise; };
    context.allMapMarkersById.set('inn', selected);
    context.renderedSearchResults = [{ onSelect: () => context.openAtlasSearchResult({ mapId: 'b', kind: 'poi', itemId: 'inn', name: 'Inn' }) }];
    context.selectSearchResult();
    assert.equal(document.activeElement, document.body);
    context.currentlyLoadedMapId = 'b';
    loading.resolve();
    await flush();
    assert.equal(document.activeElement, selected.marker);
});

for (const intent of ['pointerdown', 'keydown', 'focusin', 'surface', 'navigation', 'map-load']) {
    test(`async selection does not reclaim focus after later ${intent}`, async t => {
        const { context, document, dom, layer, byId } = harness(t);
        const selection = deferred();
        context.renderedSearchResults = [{ onSelect: () => selection.promise }];
        context.selectSearchResult();
        if (intent === 'focusin') byId('other').focus();
        else if (intent === 'surface') context.mobileSurfaceMode = 'tools';
        else if (intent === 'navigation') dom.window.history.pushState({}, '', '#elsewhere');
        else if (intent === 'map-load') context.loadRequestToken++;
        else document.dispatchEvent(new dom.window.Event(intent, { bubbles: true }));
        const before = document.activeElement;
        selection.resolve(layer());
        await flush();
        assert.equal(document.activeElement, before);
    });
}

test('a newer programmatic selection supersedes an unresolved selection', async t => {
    const { context, document, layer } = harness(t);
    const first = deferred(), second = deferred();
    context.renderedSearchResults = [{ onSelect: () => first.promise }];
    context.selectSearchResult();
    context.mobileSurfaceMode = 'search';
    context.renderedSearchResults = [{ onSelect: () => second.promise }];
    context.selectSearchResult();
    first.resolve(layer());
    await flush();
    assert.equal(document.activeElement, document.body);
    const selected = layer();
    second.resolve(selected);
    await flush();
    assert.equal(document.activeElement, selected.details);
});

test('failed async selection falls back to the map without an unhandled rejection', async t => {
    const { context, document } = harness(t);
    const selection = deferred();
    context.renderedSearchResults = [{ onSelect: () => selection.promise }];
    context.selectSearchResult();
    selection.reject(new Error('Network unavailable'));
    await flush();
    assert.equal(document.activeElement, context.mapElement);
});
