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
    'getMapSettingsFieldValues',
    'setMapSettingsFieldValues',
    'renderMapParentOptions',
    'renderMapSettingsForm'
];
const formFactory = new Function('dependencies', `
    const {
        document,
        dom,
        state,
        fieldApi,
        findNodeLocation,
        buildParentOptions
    } = dependencies;
    ${functionNames.map(extractFunction).join('\n')}
    return { getMapSettingsFieldValues, renderMapSettingsForm };
`);

const document = new JSDOM(`
    <form>
        <section data-map-field-surface="overview"></section>
        <section data-map-field-surface="advanced"></section>
    </form>
    <span id="currentMapId"></span>
`).window.document;
fieldApi.renderMapFields(document);
const mapSettingsInputs = fieldApi.collectMapInputs(document);
const fieldNames = fieldApi.getMapFields().map((field) => field.key);

const currentMap = {
    id: 'fair',
    name: 'Fair',
    type: 'map',
    status: 'active',
    visibility: 'public',
    category: 'Legacy Worlds',
    dataUrl: 'maps/fair.json',
    imageUrl: 'maps/fair.webp',
    mobileImageUrl: 'maps/fair-mobile.webp',
    smallImageUrl: 'maps/fair-small.webp',
    width: 0,
    height: 2048,
    scalePixels: 0,
    scaleKilometers: 0,
    scaleUnitName: 'km',
    backgroundColor: '#000000',
    atmosphere: 'misty',
    latLonBounds: {
        north: 0,
        south: -90,
        east: 180,
        west: 0
    },
    blurb: 'The known world.',
    selectorDescription: 'Explore Fair.'
};
const state = {
    atlasTree: [currentMap],
    currentMap,
    currentMapDataUrl: 'maps/fallback.json'
};
let findNodeLocationCallCount = 0;
const { getMapSettingsFieldValues, renderMapSettingsForm } = formFactory({
    document,
    dom: {
        mapSettingsInputs,
        currentMapId: document.getElementById('currentMapId')
    },
    state,
    fieldApi,
    findNodeLocation: () => {
        findNodeLocationCallCount += 1;
        return { index: 0, parentId: 'world' };
    },
    buildParentOptions: () => [
        { id: '', label: 'Root' },
        { id: 'world', label: 'World' },
        { id: 'archive', label: 'Archive' }
    ]
});

renderMapSettingsForm();

const expectedValues = {
    name: 'Fair',
    type: 'map',
    status: 'active',
    visibility: 'public',
    group: 'Legacy Worlds',
    dataUrl: 'maps/fair.json',
    order: '0',
    imageUrl: 'maps/fair.webp',
    mobileImageUrl: 'maps/fair-mobile.webp',
    smallImageUrl: 'maps/fair-small.webp',
    width: '0',
    height: '2048',
    scalePixels: '0',
    scaleKilometers: '0',
    scaleUnitName: 'km',
    backgroundColor: '#000000',
    atmosphere: 'misty',
    latNorth: '0',
    latSouth: '-90',
    latEast: '180',
    latWest: '0',
    blurb: 'The known world.',
    selectorDescription: 'Explore Fair.'
};
Object.entries(expectedValues).forEach(([name, value]) => {
    assert.equal(mapSettingsInputs[name].value, value, `${name} should be populated`);
});
assert.equal(document.getElementById('currentMapId').textContent, 'fair');
assert.deepEqual(
    Array.from(mapSettingsInputs.parentId.options, (option) => [option.value, option.textContent]),
    [['', 'Root'], ['world', 'World'], ['archive', 'Archive']]
);
assert.equal(mapSettingsInputs.parentId.value, 'world');
assert.equal(findNodeLocationCallCount, 1);

assert.equal(
    getMapSettingsFieldValues({ group: 'Current Group', category: 'Legacy Group' }, null).group,
    'Current Group'
);

state.currentMap = null;
state.currentMapDataUrl = '';
renderMapSettingsForm();

fieldNames.forEach((name) => {
    const expectedValue = name === 'order' ? '0' : '';
    assert.equal(mapSettingsInputs[name].value, expectedValue, `${name} should reset without a map`);
});
assert.equal(document.getElementById('currentMapId').textContent, 'No map');
assert.equal(mapSettingsInputs.parentId.value, '');
assert.equal(findNodeLocationCallCount, 1, 'empty state should not search the atlas tree');

console.log('map settings form rendering checks passed');
