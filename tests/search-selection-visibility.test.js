const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
const selectSource = source.slice(source.indexOf('function selectSearchResult('), source.indexOf('function buildScopedSearchParams('));

test('selecting a filtered search result restores other markers before opening its popup', () => {
    const selected = { visible: true, popupOpen: false };
    const other = { visible: false };
    const calls = [];
    const context = {
        activeSearchResultIndex: 0,
        SEARCH_SCOPE_MAP: 'map',
        beginSearchResultFocusHandoff: () => null,
        poiSearchInput: { value: 'selected' },
        renderedSearchResults: [{ onSelect() {
            assert.equal(other.visible, true);
            selected.popupOpen = true;
            calls.push('focus');
        } }],
        setSearchScope() {},
        closeSearchResults() {},
        closeMobileSheet() {},
        updateActiveFilterChips() {},
        syncMobileExploreVisibility() {},
        updateVisibleMarkersAndSearch() {
            assert.equal(context.poiSearchInput.value, '');
            // Removing/readding a marker while its popup is open would close it.
            selected.popupOpen = false;
            other.visible = true;
            calls.push('restore');
        }
    };
    vm.createContext(context);
    vm.runInContext(selectSource, context);
    context.selectSearchResult();
    assert.deepEqual(calls, ['restore', 'focus']);
    assert.equal(selected.popupOpen, true);
    assert.equal(other.visible, true);
});

test('invalid result selection leaves the current search and map unchanged', () => {
    const context = { activeSearchResultIndex: -1, renderedSearchResults: [], poiSearchInput: { value: 'keep' } };
    vm.createContext(context);
    vm.runInContext(selectSource, context);
    context.selectSearchResult();
    assert.equal(context.poiSearchInput.value, 'keep');
});
