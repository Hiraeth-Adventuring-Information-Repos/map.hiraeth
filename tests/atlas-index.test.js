const assert = require('node:assert/strict');
const fs = require('node:fs');

const atlas = JSON.parse(fs.readFileSync('maps/atlas-index.json', 'utf8'));
const stomionSource = JSON.parse(fs.readFileSync('maps/The-Port-City-of-Stomion.json', 'utf8'));

function countSentences(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return 0;
    const matches = cleaned.match(/[^.!?]+[.!?]+/g) || [];
    return matches.length + (/[.!?]$/.test(cleaned) ? 0 : 1);
}

function assertShortPlainText(value, label) {
    const text = String(value || '').trim();
    assert.match(text, /\S/, `${label} should not be empty`);
    assert.ok(!/[<>]/.test(text), `${label} should not contain HTML`);
    assert.ok(countSentences(text) <= 2, `${label} should be 1 to 2 sentences max`);
}

assert.ok(Array.isArray(atlas.tree));
assert.ok(atlas.tree.length > 0);
assert.ok(Array.isArray(atlas.searchIndex));
assert.ok(atlas.searchIndex.length > 0);

function walkTree(node, visit) {
    visit(node);
    if (Array.isArray(node.children)) {
        node.children.forEach((child) => walkTree(child, visit));
    }
}

atlas.tree.forEach((rootNode) => walkTree(rootNode, (node) => {
    if (node && node.selectorDescription) {
        assertShortPlainText(node.selectorDescription, `${node.id || node.name} selectorDescription`);
    }
}));

const mainContinent = atlas.tree.find((item) => item.id === 'main_continent');
assert.ok(mainContinent);
assert.equal(mainContinent.dataUrl, 'maps/Fair-Content.json');
assert.deepEqual(mainContinent.tileSource, {
    type: 'xyz',
    urlTemplate: 'tile/main_continent/{z}/{x}/{y}.webp',
    tileSize: 256,
    minZoom: 1,
    maxZoom: 5,
    leafletNativeZoom: 0,
    zoomOffset: 5
});
assertShortPlainText(mainContinent.selectorDescription || mainContinent.summary || mainContinent.description || mainContinent.blurb || '', 'main_continent selectorDescription');
assert.ok(Array.isArray(mainContinent.children));
assert.ok(mainContinent.children.length > 0);

const iceBeach = mainContinent.children.find((item) => item.id === 'IceBeach');
assert.ok(iceBeach);
assert.equal(iceBeach.dataUrl, 'maps/IceBeach.json');
assertShortPlainText(iceBeach.selectorDescription || iceBeach.summary || iceBeach.description || iceBeach.blurb || '', 'IceBeach selectorDescription');

const stomion = mainContinent.children.find((item) => item.id === 'The-Port-City-of-Stomion');
assert.ok(stomion);
assert.equal(stomion.dataUrl, 'maps/The-Port-City-of-Stomion.json');
assertShortPlainText(stomion.selectorDescription || stomion.summary || stomion.description || stomion.blurb || '', 'The-Port-City-of-Stomion selectorDescription');

const irlOldMaps = atlas.tree.find((item) => item.id === 'IRL Old Maps');
assert.ok(irlOldMaps);
assertShortPlainText(irlOldMaps.selectorDescription || irlOldMaps.summary || irlOldMaps.description || irlOldMaps.blurb || '', 'IRL Old Maps selectorDescription');

const mapSearchEntry = atlas.searchIndex.find((entry) => entry.kind === 'map' && entry.mapId === 'main_continent');
assert.ok(mapSearchEntry);
assert.equal(mapSearchEntry.name, 'Fair');
assert.equal(mapSearchEntry.mapPath, 'Fair');
const archivedFairSearchEntry = atlas.searchIndex.find(entry => entry.kind === 'map' && entry.mapId === 'OLD-Fair');
assert.equal(archivedFairSearchEntry.mapPath, 'Development & Archive Maps › Fair');
assert.ok(!atlas.searchIndex.some(entry => entry.mapId === 'IRL Old Maps'));
const castgateSearchEntry = atlas.searchIndex.find(entry => entry.kind === 'map' && entry.mapId === 'castgate');
assert.equal(castgateSearchEntry.mapPath, 'Fair › IceBeach › Castgate');
assert.ok(atlas.searchIndex.some(entry => entry.kind === 'map' && entry.mapId === 'IceBeach'));
assertShortPlainText(mapSearchEntry.summary || mapSearchEntry.description || '', 'main_continent search summary');

const stomionPoiEntry = atlas.searchIndex.find((entry) => entry.kind === 'poi' && entry.mapId === 'The-Port-City-of-Stomion');
assert.ok(stomionPoiEntry);
assert.equal(stomionPoiEntry.name, stomionSource.pointsOfInterest[0].name);

console.log('atlas-index regression checks passed');
