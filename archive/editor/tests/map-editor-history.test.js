const assert = require('node:assert/strict');
const { createHistory } = require('../js/map-editor-history.js');

const history = createHistory({ limit: 2 });
assert.deepEqual(history.getState(), { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' });
assert.equal(history.record({ name: 'Fair' }, 'Rename map'), true);
assert.equal(history.record({ name: 'Fair' }, 'Duplicate checkpoint'), false);
assert.equal(history.getState().undoLabel, 'Rename map');

const undo = history.undo({ name: 'Fair Coast' });
assert.equal(undo.label, 'Rename map');
assert.deepEqual(undo.snapshot, { name: 'Fair' });
assert.equal(history.getState().canRedo, true);

const redo = history.redo({ name: 'Fair' });
assert.equal(redo.label, 'Rename map');
assert.deepEqual(redo.snapshot, { name: 'Fair Coast' });

history.record({ step: 1 }, 'One');
history.record({ step: 2 }, 'Two');
history.record({ step: 3 }, 'Three');
assert.equal(history.undo({ step: 4 }).label, 'Three');
assert.equal(history.undo({ step: 3 }).label, 'Two');
assert.equal(history.undo({ step: 2 }), null);

history.clear();
assert.equal(history.getState().canUndo, false);

console.log('map editor history checks passed');
