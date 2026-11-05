const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { isRoutingExperimentEnabled, withRoutingExperiment, preserveRoutingExperimentLinks } = require('../js/shared-utils.js');

test('routing requires an explicit URL opt-in on every page load', () => {
    for (const search of ['', '?routing', '?routing=', '?routing=0', '?routing=false', '?routing=true', '?other=routing%3D1']) {
        assert.equal(isRoutingExperimentEnabled(search), false, search);
    }
    assert.equal(isRoutingExperimentEnabled('?routing=1'), true);
    assert.equal(isRoutingExperimentEnabled('?map=castgate&routing=1&view=1,2,0'), true);
    assert.equal(isRoutingExperimentEnabled(), false, 'no persisted opt-in');
});

test('routing opt-in follows internal pages while preserving their own query and hash', () => {
    for (const target of ['index.html#Astrousia-s=o', 'map-editor.html?map=castgate', 'file-studio.html?help=1', 'file-studio.html?new-map=1', 'editor-guide.html', '/studio/editor?mode=review']) {
        const result = new URL(withRoutingExperiment(target, '?routing=1'), 'https://maps.example.com/atlas/');
        const original = new URL(target, 'https://maps.example.com/atlas/');
        assert.equal(result.searchParams.get('routing'), '1');
        assert.equal(result.pathname, original.pathname);
        assert.equal(result.hash, original.hash);
        for (const [key, value] of original.searchParams) assert.equal(result.searchParams.get(key), value);
        assert.equal(withRoutingExperiment(target), target);
        assert.equal(withRoutingExperiment(target, '?routing=0'), target);
    }
    assert.equal(withRoutingExperiment('index.html?routing=0#IceBeach', '?routing=1'), 'index.html?routing=1#IceBeach');
});

test('page navigation preserves opt-in without changing unrelated links or enabling it by default', () => {
    const document = new JSDOM('<a data-routing-link href="map-editor.html?map=castgate">Editor</a><a href="https://example.com">Wiki</a>').window.document;
    preserveRoutingExperimentLinks(document);
    assert.equal(document.querySelector('[data-routing-link]').getAttribute('href'), 'map-editor.html?map=castgate');
    preserveRoutingExperimentLinks(document, '?routing=1');
    assert.equal(document.querySelector('[data-routing-link]').getAttribute('href'), 'map-editor.html?map=castgate&routing=1');
    assert.equal(document.querySelector('a:not([data-routing-link])').getAttribute('href'), 'https://example.com');
});
