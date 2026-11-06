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


// Repeated UI refreshes must leave existing nodes (and listeners) in place.
const { document } = dom.window;
const observer = new dom.window.MutationObserver(() => {});
observer.observe(document.body, { childList: true, subtree: true });
let clicks = 0;
searchIcon.addEventListener('click', () => { clicks += 1; });
dom.window.lucide.createIcons();
assert.strictEqual(document.querySelector('[data-lucide="search"]'), searchIcon);
assert.strictEqual(document.querySelector('[data-lucide="map-pin"]'), labelledIcon);
assert.equal(observer.takeRecords().length, 0, 'unchanged refresh should not mutate the DOM');
searchIcon.dispatchEvent(new dom.window.Event('click'));
assert.equal(clicks, 1);

const lateIcon = document.createElement('i');
lateIcon.setAttribute('data-lucide', 'x');
document.body.appendChild(lateIcon);
dom.window.lucide.createIcons();
assert.equal(document.querySelector('[data-lucide="x"]').tagName.toLowerCase(), 'svg');
assert.strictEqual(document.querySelector('[data-lucide="search"]'), searchIcon);

searchIcon.setAttribute('data-lucide', 'x');
dom.window.lucide.createIcons();
const changedIcon = document.querySelector('button svg');
assert.notStrictEqual(changedIcon, searchIcon);
assert.equal(changedIcon.classList.contains('lucide-x'), true);
assert.equal(changedIcon.classList.contains('lucide-search'), false);
assert.equal(changedIcon.classList.contains('ui-icon'), true);
assert.equal(changedIcon.querySelector('circle'), null);
assert.equal(changedIcon.querySelectorAll('path').length, 2);
dom.window.lucide.createIcons();
assert.strictEqual(document.querySelector('button svg'), changedIcon);

// Shared attrs may change or be removed; generated defaults must not override them.
dom.window.lucide.createIcons({ attrs: { width: 32, stroke: 'red' } });
let updatedIcon = document.querySelector('button svg');
assert.equal(updatedIcon.getAttribute('width'), '32');
assert.equal(updatedIcon.getAttribute('stroke'), 'red');
dom.window.lucide.createIcons({ attrs: { stroke: 'red', width: 32 } });
assert.strictEqual(document.querySelector('button svg'), updatedIcon, 'option key order is immaterial');
updatedIcon.setAttribute('width', '40');
updatedIcon.setAttribute('aria-label', 'Close');
updatedIcon.removeAttribute('aria-hidden');
dom.window.lucide.createIcons({ attrs: { width: 48, stroke: 'blue' } });
updatedIcon = document.querySelector('button svg');
assert.equal(updatedIcon.getAttribute('width'), '40', 'caller attrs override shared attrs');
assert.equal(updatedIcon.getAttribute('stroke'), 'blue');
assert.equal(updatedIcon.getAttribute('aria-label'), 'Close');
assert.equal(updatedIcon.hasAttribute('aria-hidden'), false);
dom.window.lucide.createIcons();
assert.equal(document.querySelector('button svg').getAttribute('stroke'), 'currentColor');
assert.equal(document.querySelector('button svg').getAttribute('width'), '40');

// Root/nameAttr options still select only the requested placeholders.
const scoped = document.createElement('section');
scoped.innerHTML = '<i data-icon="search" aria-labelledby="label"></i>';
document.body.appendChild(scoped);
const outside = document.createElement('i');
outside.setAttribute('data-icon', 'search');
document.body.appendChild(outside);
dom.window.lucide.createIcons({ root: scoped, nameAttr: 'data-icon' });
const scopedIcon = scoped.firstElementChild;
assert.equal(scopedIcon.tagName.toLowerCase(), 'svg');
assert.equal(scopedIcon.getAttribute('aria-labelledby'), 'label');
assert.equal(scopedIcon.hasAttribute('aria-hidden'), false);
assert.equal(outside.tagName.toLowerCase(), 'i');
dom.window.lucide.createIcons({ root: scoped, nameAttr: 'data-icon' });
assert.strictEqual(scoped.firstElementChild, scopedIcon);
observer.disconnect();
dom.window.close();

console.log('Pages Lucide subset checks passed');
