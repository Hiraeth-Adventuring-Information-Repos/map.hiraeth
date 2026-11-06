const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync('js/app.js', 'utf8');
function createSearch() {
    const context = vm.createContext({});
    vm.runInContext(source.slice(source.indexOf('function normalizeSearchValue('), source.indexOf('function highlightSearchText('))
        + source.slice(source.indexOf('function computeGeometrySearchMatch('), source.indexOf('function searchMapRegions(')), context);
    return context;
}

test('cached geometry matches preserve existing primary, content, fuzzy and missing results', () => {
    const search = createSearch();
    for (const [name, text] of [['Emerald Fields', 'A broad green meadow beside the river'], ['Road to Fair', 'Trade road passing an ancient silver mine']]) {
        const layer = {}, feature = {};
        for (const term of ['', 'emerald fields', 'road', 'fair', 'silver', 'river', 'grn', 'zzzz', 'silver']) {
            const actual = search.computeGeometrySearchMatch(term, layer, feature, name, () => text);
            const expected = search.computeSearchMatch(term, name, () => text);
            assert.deepEqual(actual, expected, `same ranking and content flag for ${term}`);
        }
    }
});

test('geometry search defers descriptions and reuses text and secondary match work', () => {
    const search = createSearch(), layer = {}, feature = {};
    let reads = 0;
    const text = () => { reads++; return 'Old silver mine'; };
    search.computeGeometrySearchMatch('', layer, feature, 'Trade Road', text);
    search.computeGeometrySearchMatch('trade', layer, feature, 'Trade Road', text);
    assert.equal(reads, 0, 'empty and primary matches do not read description text');
    const first = search.computeGeometrySearchMatch('silver', layer, feature, 'Trade Road', text);
    // A repeated secondary query must not perform another fuzzy scan.
    search.getFuzzyMatchScore = (term, target) => {
        assert.equal(target, 'trade road');
        return -1;
    };
    assert.deepEqual(search.computeGeometrySearchMatch('silver', layer, feature, 'Trade Road', text), first);
    assert.equal(reads, 1);
});

test('replacement feature objects get fresh cached geometry text', () => {
    const search = createSearch(), layer = {};
    assert.equal(search.computeGeometrySearchMatch('silver', layer, {}, 'Road', () => 'silver mine').matched, true);
    assert.equal(search.computeGeometrySearchMatch('silver', layer, {}, 'River', () => 'water').matched, false);
});
