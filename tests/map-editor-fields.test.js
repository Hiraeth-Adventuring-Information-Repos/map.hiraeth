const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fields = require('../js/map-editor-fields.js');

const document = new JSDOM(`
    <form id="map-form">
        <section data-map-field-surface="overview"></section>
        <section data-map-field-surface="advanced"></section>
    </form>
    <form id="feature-form"></form>
`).window.document;

fields.renderMapFields(document);
const inputs = fields.collectMapInputs(document);
assert.equal(inputs.name.required, true);
assert.equal(inputs.dataUrl.readOnly, true);
assert.match(inputs.dataUrl.getAttribute('aria-describedby'), /dataUrl-help/);
assert.deepEqual(
    Array.from(inputs.status.options, (option) => [option.value, option.textContent]),
    [['', 'Published (default)'], ['active', 'Active'], ['draft', 'Draft'], ['coming-soon', 'Coming soon'], ['archived', 'Archived']]
);
assert.deepEqual(
    Array.from(inputs.visibility.options, (option) => [option.value, option.textContent]),
    [['', 'Public (default)'], ['public', 'Public'], ['gm', 'GM only']]
);
assert.equal(document.querySelectorAll('[data-map-field-surface="overview"] [data-field]').length, 6);
assert.equal(document.querySelectorAll('.map-editor-coordinate-fieldset [data-field]').length, 4);
assert.deepEqual(
    Array.from(document.querySelectorAll('[data-map-field-surface="overview"] .map-editor-property-section-title'), (heading) => heading.textContent),
    ['Map identity', 'Map chooser']
);
assert.deepEqual(
    Array.from(document.querySelectorAll('[data-map-field-surface="advanced"] .map-editor-property-section-title'), (heading) => heading.textContent),
    ['Atlas record', 'Artwork', 'Canvas size', 'Scale', 'Appearance']
);

const mapValues = fields.getMapFieldValues({
    name: 'Fair',
    category: 'Legacy Worlds',
    width: 0,
    latLonBounds: { north: 0, south: -90 }
}, {
    currentMapDataUrl: 'maps/Fair.json',
    currentLocation: { index: 2, parentId: 'world' }
});
assert.equal(mapValues.group, 'Legacy Worlds');
assert.equal(mapValues.dataUrl, 'maps/Fair.json');
assert.equal(mapValues.width, 0);
assert.equal(mapValues.order, 2);
assert.equal(mapValues.parentId, 'world');
assert.equal(mapValues.latNorth, 0);

Object.entries({
    name: 'Fair Revised',
    dataUrl: 'maps/Fair.json',
    blurb: 'A revised introduction.',
    latNorth: '80',
    latSouth: '-80',
    parentId: 'archive',
    order: '4'
}).forEach(([key, value]) => { inputs[key].value = value; });
const mapPayload = fields.readMapForm(inputs);
assert.equal(mapPayload.name, 'Fair Revised');
assert.equal(mapPayload.blurb, 'A revised introduction.');
assert.equal(mapPayload.dataUrl, 'maps/Fair.json');
assert.deepEqual(mapPayload.latLonBounds, { north: '80', south: '-80', east: '', west: '' });
assert.equal(Object.hasOwn(mapPayload, 'parentId'), false);
assert.equal(Object.hasOwn(mapPayload, 'order'), false);

assert.equal(fields.validateValue(fields.getMapFields().find((field) => field.key === 'name'), ''), 'Name is required.');
assert.match(fields.validateValue(fields.getMapFields().find((field) => field.key === 'width'), '-1'), /at least 0/);

const featureForm = document.getElementById('feature-form');
fields.renderFeatureFields(document, featureForm, 'points', {
    name: 'Hearth',
    pronunciation: 'harth',
    properties: { Nation: 'Hiraeth' },
    tags: ['Capital', 'Trade'],
    coords: [12, 34]
}, {
    stringifyKeyFacts: (properties) => Object.entries(properties).map(([key, value]) => `${key}: ${value}`).join('\n'),
    stringifyTags: (tags) => tags.join('\n'),
    stringifyCoordinates: (coordinates) => JSON.stringify(coordinates)
});
assert.equal(featureForm.querySelector('[data-field="name"]').value, 'Hearth');
assert.equal(featureForm.querySelector('[data-field="propertiesText"]').value, 'Nation: Hiraeth');
assert.equal(featureForm.querySelector('[data-field="tags"]').value, 'Capital\nTrade');
assert.equal(featureForm.querySelector('[data-field="coordY"]').value, '12');
assert.equal(featureForm.querySelector('[data-field-group="coordinates"]').children.length, 2);
assert.ok(featureForm.querySelector('[data-detail-section-list]'));
assert.ok(featureForm.querySelector('details [data-field="properties"]'));
assert.deepEqual(
    Array.from(featureForm.querySelectorAll(':scope > .map-editor-feature-section > summary'), (summary) => summary.textContent),
    ['Content', 'Facts and Sections', 'Links', 'Position', 'Advanced Data']
);
assert.equal(featureForm.querySelector('[data-feature-section="content"]').open, true);
assert.equal(featureForm.querySelector('[data-feature-section="position"]').open, false);
assert.equal(featureForm.querySelector('[data-field="summary"]').previousElementSibling?.textContent, 'A short description for search results, cards, and quick previews.');

fields.registerMapField({ key: 'maintainerNote', label: 'Maintainer Note', surface: 'advanced', help: 'Extension field.' });
fields.registerFeatureField('lines', { key: 'travelMode', label: 'Travel Mode' });
assert.equal(fields.getMapFields('advanced').at(-1).key, 'maintainerNote');
assert.equal(fields.getFeatureFields('lines').at(-1).key, 'travelMode');
assert.throws(() => fields.registerFeatureField('lines', { key: 'travelMode', label: 'Duplicate' }), /already exists/);

console.log('map editor field registry checks passed');

assert.equal(inputs.imageUrl.closest('details').querySelector('summary').textContent, 'Artwork');
assert.equal(inputs.scalePixels.closest('details').querySelector('summary').textContent, 'Scale');
assert.equal(inputs.latNorth.closest('details').querySelector('summary').textContent, 'Geographic calibration');
assert.equal(inputs.imageUrl.closest('details').getAttribute('aria-disabled'), 'false');
assert.equal(document.querySelectorAll('#map-imageUrl').length, 1);
// Existing Fair bounds have more than four decimal places and must remain saveable.
inputs.latWest.value = '-48.34375';
inputs.latEast.value = '71.65625';
assert.equal(inputs.latWest.validity.stepMismatch, false);
assert.equal(inputs.latEast.validity.stepMismatch, false);
