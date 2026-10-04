const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const {
    buildPagesLucideSubsetSource,
    collectPagesLucideIconNames
} = require('../scripts/build_pages.js');

const fullLucide = require('../js/libs/lucide.min.js');
const iconNames = collectPagesLucideIconNames();

[
    'circle-help',
    'crosshair',
    'footprints',
    'funnel',
    'layout-grid',
    'link-2',
    'map-pin',
    'maximize-2',
    'minimize-2',
    'search',
    'share-2',
    'ship',
    'sliders-horizontal',
    'train-front',
    'volume-2',
    'volume-x',
    'x'
].forEach((iconName) => {
    assert.ok(iconNames.includes(iconName), `Pages Lucide subset should include ${iconName}`);
});

const subsetSource = buildPagesLucideSubsetSource(iconNames, fullLucide);
const fullSourceBytes = fs.statSync('js/libs/lucide.min.js').size;
assert.ok(
    Buffer.byteLength(subsetSource) < fullSourceBytes * 0.15,
    'Pages Lucide subset should remain substantially smaller than the full catalog'
);
assert.throws(
    () => buildPagesLucideSubsetSource(['not-a-real-icon'], fullLucide),
    /Lucide icon is unavailable/
);

const dom = new JSDOM(`<!doctype html><body>
    <button><i class="ui-icon" data-lucide="search"></i><span>Search</span></button>
    <i data-lucide="map-pin" aria-label="Map pin"></i>
</body>`, { runScripts: 'outside-only' });

dom.window.eval(subsetSource);
assert.equal(typeof dom.window.lucide.createIcons, 'function');
dom.window.lucide.createIcons();
dom.window.lucide.createIcons();

const searchIcon = dom.window.document.querySelector('[data-lucide="search"]');
assert.equal(searchIcon.tagName.toLowerCase(), 'svg');
assert.equal(searchIcon.classList.contains('lucide-search'), true);
assert.equal(searchIcon.classList.contains('ui-icon'), true);
assert.equal(searchIcon.getAttribute('aria-hidden'), 'true');
assert.ok(searchIcon.querySelector('circle'));

const labelledIcon = dom.window.document.querySelector('[data-lucide="map-pin"]');
assert.equal(labelledIcon.getAttribute('aria-label'), 'Map pin');
assert.equal(labelledIcon.hasAttribute('aria-hidden'), false);

console.log('Pages Lucide subset checks passed');
