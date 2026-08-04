const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGit } = require('../scripts/map_studio_git.js');
const { createStudioWorkspaceManager } = require('../scripts/map_studio_workspace.js');

(async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-studio-workspace-test-'));
    const baseRepoRoot = path.join(tempRoot, 'base');
    const draftsRoot = path.join(tempRoot, 'drafts');
    const remoteRoot = path.join(tempRoot, 'remote.git');

    runGit(tempRoot, ['init', '--bare', remoteRoot]);
    runGit(tempRoot, ['init', '-b', 'main', baseRepoRoot]);
    fs.mkdirSync(path.join(baseRepoRoot, 'maps'), { recursive: true });
    fs.mkdirSync(path.join(baseRepoRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(baseRepoRoot, 'maps', 'maps.json'), '[]\n');
    fs.writeFileSync(path.join(baseRepoRoot, 'dist', 'index.html'), 'base preview\n');
    fs.writeFileSync(path.join(baseRepoRoot, '.gitignore'), 'node_modules\n');
    runGit(baseRepoRoot, ['add', '-f', '.gitignore', 'maps/maps.json', 'dist/index.html']);
    runGit(baseRepoRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial']);
    runGit(baseRepoRoot, ['remote', 'add', 'origin', remoteRoot]);
    runGit(baseRepoRoot, ['push', '-u', 'origin', 'main']);

    fs.writeFileSync(path.join(baseRepoRoot, 'host-only-note.txt'), 'Do not include in Studio drafts.\n');
    const localClient = {
        getConfiguration: () => ({ configured: false, mode: 'none' }),
        getToken: async () => { throw new Error('Offline drafts must not request a token.'); }
    };
    const manager = createStudioWorkspaceManager({ baseRepoRoot, draftsRoot, githubClient: localClient });
    const baseState = manager.getState();
    assert.equal(baseState.mode, 'base');
    assert.equal(baseState.capabilities.canStartDraft, true);
    assert.deepEqual(baseState.changedPaths, []);
    assert.deepEqual(baseState.baseCheckout.changedPaths, ['host-only-note.txt']);

    const draftState = await manager.startDraft('Isolated coast update');
    const draftRoot = manager.getWorkspaceRoot();
    assert.notEqual(draftRoot, baseRepoRoot);
    assert.equal(draftState.isolated, true);
    assert.equal(draftState.activeDraft, true);
    assert.equal(draftState.capabilities.canAbandonDraft, true);
    assert.equal(runGit(baseRepoRoot, ['branch', '--show-current']).stdout, 'main');
    assert.equal(runGit(baseRepoRoot, ['branch', '--list', draftState.branch]).stdout, '');
    assert.doesNotMatch(runGit(baseRepoRoot, ['worktree', 'list', '--porcelain']).stdout, /draft-/);
    assert.equal(fs.readFileSync(path.join(baseRepoRoot, 'host-only-note.txt'), 'utf8').trim(), 'Do not include in Studio drafts.');
    assert.equal(fs.existsSync(path.join(draftRoot, 'host-only-note.txt')), false);

    fs.writeFileSync(path.join(draftRoot, 'maps', 'isolated.json'), '{}\n');
    assert.deepEqual(manager.getState().changedPaths, ['maps/isolated.json']);
    assert.throws(() => manager.abandonDraft('wrong-branch'), /Confirm the exact draft branch/);

    const restoredManager = createStudioWorkspaceManager({ baseRepoRoot, draftsRoot, githubClient: localClient });
    assert.equal(restoredManager.getWorkspaceRoot(), draftRoot);
    assert.equal(restoredManager.getState().draft.branch, draftState.branch);
    const abandonedState = restoredManager.abandonDraft(draftState.branch);
    assert.equal(abandonedState.mode, 'base');
    assert.equal(fs.existsSync(draftRoot), false);
    assert.equal(runGit(baseRepoRoot, ['branch', '--list', draftState.branch]).stdout, '');

    const connectedClient = {
        getConfiguration: () => ({ configured: true, mode: 'token', owner: 'test', repo: 'map' }),
        getToken: async () => 'test-token'
    };
    const connectedManager = createStudioWorkspaceManager({ baseRepoRoot, draftsRoot, githubClient: connectedClient });
    const connectedDraft = await connectedManager.startDraft('Finish isolated draft');
    const connectedDraftRoot = connectedManager.getWorkspaceRoot();
    fs.writeFileSync(path.join(connectedDraftRoot, 'maps', 'finished.json'), '{}\n');
    fs.writeFileSync(path.join(connectedDraftRoot, 'dist', 'index.html'), 'generated preview\n');
    assert.equal(connectedManager.getState().clean, false);
    runGit(connectedDraftRoot, ['add', 'maps/finished.json']);
    runGit(connectedDraftRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Finish draft']);
    assert.equal(connectedManager.getState().clean, true);
    const connectedHead = runGit(connectedDraftRoot, ['rev-parse', 'HEAD']).stdout;
    runGit(connectedDraftRoot, ['push', 'origin', connectedDraft.branch]);
    runGit(tempRoot, ['--git-dir', remoteRoot, 'update-ref', 'refs/heads/main', connectedHead]);
    const finishedState = await connectedManager.finishDraft();
    assert.equal(finishedState.mode, 'base');
    assert.equal(fs.existsSync(connectedDraftRoot), false);
    assert.equal(runGit(baseRepoRoot, ['branch', '--show-current']).stdout, 'main');
    assert.equal(fs.existsSync(path.join(baseRepoRoot, 'maps', 'finished.json')), false);
    assert.equal(fs.existsSync(path.join(baseRepoRoot, 'host-only-note.txt')), true);
    assert.equal(runGit(baseRepoRoot, ['branch', '--list', connectedDraft.branch]).stdout, '');

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('map studio isolated workspace checks passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
