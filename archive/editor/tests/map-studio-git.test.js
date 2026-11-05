const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    finishMergedDraft,
    getChangedPaths,
    getWorkspaceState,
    isGeneratedPath,
    isPublishablePath,
    makeDraftBranch,
    publishDraft,
    runGit,
    slugify,
    startDraft
} = require('../scripts/map_studio_git.js');

(async () => {

assert.equal(isPublishablePath('maps/new-map.json'), true);
assert.equal(isPublishablePath('site.config.json'), true);
assert.equal(isPublishablePath('scripts/editor_server.js'), false);
assert.equal(isGeneratedPath('dist/index.html'), true);
assert.equal(isGeneratedPath('maps/Fair.json'), false);
assert.equal(slugify('The Port City!'), 'the-port-city');
assert.match(makeDraftBranch('The Port City', new Date('2026-08-02T12:00:00Z')), /^map-studio\/20260802-the-port-city-[a-f0-9]{4}$/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-studio-git-test-'));
const remoteRoot = path.join(tempRoot, 'remote.git');
const repoRoot = path.join(tempRoot, 'workspace');
runGit(tempRoot, ['init', '--bare', remoteRoot]);
runGit(tempRoot, ['init', '-b', 'main', repoRoot]);
fs.mkdirSync(path.join(repoRoot, 'maps'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'maps', 'maps.json'), '[]\n');
runGit(repoRoot, ['add', 'maps/maps.json']);
runGit(repoRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial']);
runGit(repoRoot, ['remote', 'add', 'origin', remoteRoot]);
runGit(repoRoot, ['push', '-u', 'origin', 'main']);

assert.deepEqual(getChangedPaths(repoRoot), []);
fs.writeFileSync(path.join(repoRoot, '.hidden-file'), 'preserve leading dot');
assert.deepEqual(getChangedPaths(repoRoot), ['.hidden-file']);
fs.rmSync(path.join(repoRoot, '.hidden-file'));
fs.mkdirSync(path.join(repoRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'dist', 'generated-preview.html'), 'generated');
assert.deepEqual(getChangedPaths(repoRoot), []);

let existingPullRequest = null;
let pullRequestCreateCount = 0;
const githubClient = {
    getConfiguration: () => ({ configured: true, mode: 'token', owner: 'test', repo: 'map' }),
    getToken: async () => 'test-token',
    findOpenPullRequest: async () => existingPullRequest,
    createDraftPullRequest: async ({ branch, title }) => {
        pullRequestCreateCount += 1;
        existingPullRequest = {
            number: 7,
            html_url: `https://github.test/${branch}/${encodeURIComponent(title)}`
        };
        return existingPullRequest;
    }
};
const draft = await startDraft({ repoRoot, title: 'New Coast Map', githubClient });
assert.equal(draft.activeDraft, true);
assert.match(draft.branch, /^map-studio\//);
fs.writeFileSync(path.join(repoRoot, 'maps', 'new-map.json'), '{}\n');
const publication = await publishDraft({
    repoRoot,
    title: 'Add draft map',
    description: 'Integration test',
    githubClient,
    runValidation: async () => 'Validation passed',
    advanceAssetVersion: () => ({ previousVersion: '1.0.0', nextVersion: '1.0.1' })
});
assert.equal(publication.pullRequestNumber, 7);
assert.deepEqual(publication.paths, ['maps/new-map.json']);
assert.equal(getWorkspaceState(repoRoot, githubClient.getConfiguration()).clean, true);
const resumedPublication = await publishDraft({
    repoRoot,
    title: 'Add draft map',
    description: 'Integration test',
    githubClient,
    resume: true,
    runValidation: async () => { throw new Error('A clean resume must not repeat validation.'); },
    advanceAssetVersion: () => { throw new Error('A clean resume must not bump the asset version.'); }
});
assert.equal(resumedPublication.commit, publication.commit);
assert.equal(pullRequestCreateCount, 1);
await assert.rejects(
    finishMergedDraft({ repoRoot, githubClient }),
    /not been merged/
);
const draftHead = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout;
runGit(tempRoot, ['--git-dir', remoteRoot, 'update-ref', 'refs/heads/main', draftHead]);
const finished = await finishMergedDraft({ repoRoot, githubClient });
assert.equal(finished.branch, 'main');
assert.equal(finished.activeDraft, false);

const localOnlyRoot = path.join(tempRoot, 'local-only');
runGit(tempRoot, ['init', '-b', 'main', localOnlyRoot]);
fs.mkdirSync(path.join(localOnlyRoot, 'maps'), { recursive: true });
fs.writeFileSync(path.join(localOnlyRoot, 'maps', 'maps.json'), '[]\n');
runGit(localOnlyRoot, ['add', 'maps/maps.json']);
runGit(localOnlyRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial']);
const localOnlyClient = {
    getConfiguration: () => ({ configured: false, mode: 'none' }),
    getToken: async () => { throw new Error('Local drafts must not request a GitHub token.'); }
};
const mainWorkspace = getWorkspaceState(localOnlyRoot, localOnlyClient.getConfiguration());
assert.equal(mainWorkspace.mode, 'main');
assert.equal(mainWorkspace.editable, false);
assert.equal(mainWorkspace.capabilities.canStartDraft, true);
const localDraft = await startDraft({ repoRoot: localOnlyRoot, title: 'Offline coast map', githubClient: localOnlyClient });
assert.equal(localDraft.activeDraft, true);
assert.equal(localDraft.editable, true);
assert.equal(localDraft.capabilities.canEdit, true);
assert.equal(localDraft.capabilities.canPublish, false);

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('map studio Git workflow checks passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
