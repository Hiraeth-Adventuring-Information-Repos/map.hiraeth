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
assert.equal(document.querySelectorAll('[data-map-field-surface="overview"] [data-field]').length, 6);
assert.equal(document.querySelectorAll('.map-editor-coordinate-fieldset [data-field]').length, 4);

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

fields.registerMapField({ key: 'maintainerNote', label: 'Maintainer Note', surface: 'advanced', help: 'Extension field.' });
fields.registerFeatureField('lines', { key: 'travelMode', label: 'Travel Mode' });
assert.equal(fields.getMapFields('advanced').at(-1).key, 'maintainerNote');
assert.equal(fields.getFeatureFields('lines').at(-1).key, 'travelMode');
assert.throws(() => fields.registerFeatureField('lines', { key: 'travelMode', label: 'Duplicate' }), /already exists/);

console.log('map editor field registry checks passed');
