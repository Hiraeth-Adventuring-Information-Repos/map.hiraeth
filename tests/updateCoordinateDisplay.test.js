const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('js/app.js', 'utf8');
const fnStart = appSource.indexOf('function updateCoordinateDisplay(');
const fnEnd = appSource.indexOf('const DEFAULT_POI_TYPE_GROUPS', fnStart);

if (fnStart === -1 || fnEnd === -1 || fnEnd <= fnStart) {
    throw new Error('Could not locate updateCoordinateDisplay function in js/app.js');
}

const fnSource = appSource.slice(fnStart, fnEnd);

let text = '';
let mutations = 0;
const spanEl = {
    get textContent() { return text; },
    set textContent(value) { text = value; mutations++; },
    set innerHTML(value) { assert.fail('Coordinate text must not replace HTML'); }
};
let queries = 0;
const sandbox = { document: { getElementById: () => ({ querySelector(selector) {
    assert.equal(selector, 'span');
    queries++;
    return spanEl;
} }) } };
const refsStart = appSource.indexOf('const coordinateDisplay =');
const refsEnd = appSource.indexOf('const copyCoordsBtn =', refsStart);
vm.createContext(sandbox);
vm.runInContext(appSource.slice(refsStart, refsEnd) + fnSource, sandbox);

sandbox.updateCoordinateDisplay(10, 20);
assert.equal(spanEl.textContent, '10.00° N, 20.00° E');
assert.equal(mutations, 1);

// Identical formatted values must not mutate the DOM, including rounded changes.
for (let index = 0; index < 100; index++) sandbox.updateCoordinateDisplay(10.001, 20.001);
assert.equal(mutations, 1);
assert.equal(queries, 1, 'the span is cached instead of queried on mousemove');

sandbox.updateCoordinateDisplay(-5, -122.5);
assert.equal(spanEl.textContent, '5.00° S, 122.50° W');
assert.equal(mutations, 2);

// Missing DOM node should not crash coordinate updates.
const missingSpan = { coordinateDisplaySpan: null };
vm.createContext(missingSpan);
vm.runInContext(fnSource, missingSpan);
assert.doesNotThrow(() => missingSpan.updateCoordinateDisplay(0, 0));

console.log('updateCoordinateDisplay regression checks passed');
