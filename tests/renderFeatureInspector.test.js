const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const fieldApi = require('../js/map-editor-fields.js');

const editorSource = fs.readFileSync('js/map-editor.js', 'utf8');

function extractFunction(name) {
    const start = editorSource.indexOf(`    function ${name}(`);
    assert.notEqual(start, -1, `Could not locate ${name} in js/map-editor.js`);

    const bodyStart = editorSource.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < editorSource.length; index += 1) {
        if (editorSource[index] === '{') depth += 1;
        if (editorSource[index] === '}') depth -= 1;
        if (depth === 0) return editorSource.slice(start, index + 1);
    }

    throw new Error(`Could not extract ${name} from js/map-editor.js`);
}

const functionNames = [
    'renderFeatureSchema',
    'renderPointFeatureInspector',
    'renderRegionFeatureInspector',
    'renderLineFeatureInspector',
    'renderJourneyInspector',
    'renderFeatureInspector'
];
const inspectorFactory = new Function('dependencies', `
    const {
        dom,
        document,
        window,
        fieldApi,
        state,
        getSelectedFeature,
        stringifyKeyFacts,
        stringifyTags,
        stringifyCoordinates,
        renderDetailSectionControls,
        syncFormAccess,
        canMutateWorkspace
    } = dependencies;
    ${functionNames.map(extractFunction).join('\n')}
    return { renderFeatureInspector };
`);

const document = new JSDOM(`
    <form id="feature-form"></form>
    <p id="feature-form-empty"></p>
    <span id="selected-feature-chip"></span>
`).window.document;
const dom = {
    featureForm: document.querySelector('#feature-form'),
    featureFormEmpty: document.querySelector('#feature-form-empty'),
    selectedFeatureChip: document.querySelector('#selected-feature-chip')
};
const state = { selectedFeature: { mode: null } };
let selectedFeature = null;
let detailSectionsFeature = null;
const { renderFeatureInspector } = inspectorFactory({
    dom,
    document,
    window: { AppConfig: require('../js/app-config.js') },
    fieldApi,
    state,
    getSelectedFeature: () => selectedFeature,
    stringifyKeyFacts: (properties) => Object.entries(properties).map(([key, value]) => `${key}: ${value}`).join('\n'),
    stringifyTags: (tags) => tags.join('\n'),
    stringifyCoordinates: (coordinates) => JSON.stringify(coordinates),
    renderDetailSectionControls: (feature) => {
        detailSectionsFeature = feature;
    },
    syncFormAccess: () => {},
    canMutateWorkspace: () => true
});

renderFeatureInspector();
assert.equal(dom.featureForm.hidden, true);
assert.equal(dom.featureFormEmpty.hidden, false);
assert.equal(dom.selectedFeatureChip.textContent, 'None');

selectedFeature = {
    name: 'Hearth',
    pronunciation: 'harth',
    type: 'City',
    properties: { Nation: 'Hiraeth' },
    tags: ['Capital', 'Trade'],
    coords: [12, 34]
};
state.selectedFeature.mode = 'points';
renderFeatureInspector();
assert.equal(dom.featureForm.hidden, false);
assert.equal(dom.featureFormEmpty.hidden, true);
assert.equal(dom.selectedFeatureChip.textContent, 'POI');
assert.equal(dom.featureForm.querySelector('[data-field="name"]').value, 'Hearth');
assert.equal(dom.featureForm.querySelector('[data-field="propertiesText"]').value, 'Nation: Hiraeth');
assert.equal(dom.featureForm.querySelector('[data-field="tags"]').value, 'Capital\nTrade');
assert.equal(dom.featureForm.querySelector('[data-field="coordY"]').value, '12');
assert.equal(detailSectionsFeature, selectedFeature);
assert.ok(dom.featureForm.querySelector('#feature-points-type-options option[value="Library"]'));
assert.equal(dom.featureForm.querySelector('[data-field="type"]').getAttribute('list'), 'feature-points-type-options');
assert.equal(dom.featureForm.querySelector('[data-field="type"]').value, 'City');

selectedFeature = {
    id: 'north',
    name: 'North Reach',
    value: 'north-reach',
    fillOpacity: 0,
    coordinates: [[1, 2], [3, 4]],
    properties: { climate: 'cold' }
};
state.selectedFeature.mode = 'regions';
renderFeatureInspector();
assert.equal(dom.selectedFeatureChip.textContent, 'Region');
assert.equal(dom.featureForm.querySelector('[data-field="value"]').value, 'north-reach');
assert.equal(dom.featureForm.querySelector('[data-field="fillOpacity"]').value, '0');
assert.equal(dom.featureForm.querySelector('[data-field="coordinates"]').value, '[[1,2],[3,4]]');

selectedFeature = {
    id: 'road',
    name: 'King Road',
    weight: 0,
    dashArray: '4 2',
    coordinates: [[5, 6], [7, 8]]
};
state.selectedFeature.mode = 'lines';
renderFeatureInspector();
assert.equal(dom.selectedFeatureChip.textContent, 'Line');
assert.equal(dom.featureForm.querySelector('[data-field="weight"]').value, '0');
assert.equal(dom.featureForm.querySelector('[data-field="dashArray"]').value, '4 2');
assert.equal(dom.featureForm.querySelector('[data-field="coordinates"]').value, '[[5,6],[7,8]]');

console.log('feature inspector rendering checks passed');

selectedFeature = {name: 'Test trail', campaign: 'Test campaign', color: '#d97706', visibleByDefault: true, stops: [{ id: 'stop', name: 'Arrival', coords: [10, 20], date: 'Autumn, 500 EC' }]};
state.selectedFeature.mode = 'journeys';
renderFeatureInspector();
assert.equal(dom.featureForm.querySelector('[data-field=visibleByDefault]').checked, true);
assert.equal(dom.featureForm.querySelector('[data-stop-field=date]').value, 'Autumn, 500 EC');
assert.equal(dom.featureForm.querySelector('[data-journey-stop]').querySelector('button').disabled, true);
