const assert = require('node:assert/strict');
const { deriveWorkspacePresentation } = require('../js/map-studio-model.js');

const main = deriveWorkspacePresentation({
    branch: 'main',
    mode: 'main',
    clean: true,
    changedPaths: [],
    publishableChanges: [],
    unsupportedChanges: [],
    capabilities: { canStartDraft: true },
    github: { configured: false }
}, { topStatus: 'Ready' });
assert.equal(main.title, 'Start a map draft');
assert.equal(main.editable, false);
assert.equal(main.stages[0].state, 'current');
assert.match(main.stages[3].detail, /Connect GitHub/);

const isolatedBase = deriveWorkspacePresentation({
    mode: 'base',
    clean: true,
    changedPaths: [],
    publishableChanges: [],
    unsupportedChanges: [],
    capabilities: { canStartDraft: true },
    github: { configured: false },
    baseCheckout: { branch: 'codex/map-studio', clean: false, changedPaths: ['host-note.txt'] }
}, { topStatus: 'Ready' });
assert.equal(isolatedBase.title, 'Start an isolated map draft');
assert.equal(isolatedBase.statusLabel, 'No active draft');
assert.equal(isolatedBase.stages[0].state, 'current');

const recovery = deriveWorkspacePresentation({
    mode: 'recovery',
    changedPaths: [],
    capabilities: {},
    recovery: { required: true, message: 'Draft workspace is missing.' },
    github: { configured: false }
}, {});
assert.equal(recovery.statusTone, 'danger');
assert.equal(recovery.statusLabel, 'Recovery needed');
assert.match(recovery.summary, /missing/);

const workingBranch = deriveWorkspacePresentation({
    branch: 'codex/map-studio',
    mode: 'working-branch',
    editable: true,
    changedPaths: ['maps/Fair.json'],
    publishableChanges: ['maps/Fair.json'],
    unsupportedChanges: [],
    capabilities: { canEdit: true, canCreateMap: true },
    github: { configured: false }
}, { topStatus: 'Needs Build' });
assert.equal(workingBranch.editable, true);
assert.equal(workingBranch.statusLabel, 'Working branch');
assert.equal(workingBranch.stages[1].state, 'complete');
assert.equal(workingBranch.stages[2].state, 'current');

const publishableDraft = deriveWorkspacePresentation({
    branch: 'map-studio/20260804-new-map-abcd',
    draft: { branch: 'map-studio/20260804-new-map-abcd' },
    mode: 'studio-draft',
    activeDraft: true,
    editable: true,
    changedPaths: ['maps/New.json'],
    publishableChanges: ['maps/New.json'],
    unsupportedChanges: [],
    capabilities: { canEdit: true, canCreateMap: true, canPublish: true },
    github: { configured: true }
}, { topStatus: 'Ready' });
assert.equal(publishableDraft.statusTone, 'good');
assert.equal(publishableDraft.stages[2].state, 'complete');
assert.equal(publishableDraft.stages[3].state, 'current');

console.log('map studio presentation model checks passed');
