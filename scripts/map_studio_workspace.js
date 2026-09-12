const fs = require('node:fs');
const path = require('node:path');
const {
    assertRepository,
    getAuthenticatedGitArgs,
    getCurrentBranch,
    getWorkspaceState,
    makeDraftBranch,
    runGit
} = require('./map_studio_git.js');

const WORKSPACE_STATE_VERSION = 1;
const WORKSPACE_STATE_FILE = 'workspace-state.json';
const WORKSPACE_REPOSITORY_DIR = 'repository';
const WORKSPACE_WORKTREES_DIR = 'worktrees';

function resolveManagedPath(rootPath, childPath) {
    const root = path.resolve(rootPath);
    const fullPath = path.resolve(childPath);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
        throw new Error('Draft workspace path escapes the managed drafts directory.');
    }
    return fullPath;
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
}

function readWorkspaceRecord(statePath, draftsRoot) {
    if (!fs.existsSync(statePath)) return { record: null, recoveryIssue: '' };
    try {
        const payload = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (payload?.version !== WORKSPACE_STATE_VERSION || !payload.activeDraft) {
            throw new Error('Workspace state uses an unsupported format.');
        }
        const record = {
            id: String(payload.activeDraft.id || '').trim(),
            title: String(payload.activeDraft.title || '').trim(),
            branch: String(payload.activeDraft.branch || '').trim(),
            root: resolveManagedPath(draftsRoot, payload.activeDraft.root),
            baseRef: String(payload.activeDraft.baseRef || 'main').trim(),
            createdAt: String(payload.activeDraft.createdAt || '').trim()
        };
        if (!record.id || !record.branch.startsWith('map-studio/') || !record.root) {
            throw new Error('Workspace state does not describe a valid Studio draft.');
        }
        if (!fs.existsSync(record.root)) {
            throw new Error(`Draft workspace is missing: ${record.root}`);
        }
        if (getCurrentBranch(record.root) !== record.branch) {
            throw new Error('Draft workspace branch no longer matches its persisted state.');
        }
        return { record, recoveryIssue: '' };
    } catch (error) {
        return {
            record: null,
            recoveryIssue: error.message || 'The persisted draft workspace could not be recovered.'
        };
    }
}

function ensureWorkspaceRepository(baseRepoRoot, repositoryRoot) {
    if (!fs.existsSync(path.join(repositoryRoot, '.git'))) {
        fs.mkdirSync(path.dirname(repositoryRoot), { recursive: true });
        runGit(baseRepoRoot, [
            'clone',
            '--no-hardlinks',
            '--branch', 'main',
            '--origin', 'host-base',
            baseRepoRoot,
            repositoryRoot
        ]);
    }

    assertRepository(repositoryRoot);
    const hostRemote = runGit(repositoryRoot, ['remote', 'get-url', 'host-base'], { allowFailure: true });
    runGit(repositoryRoot, hostRemote.ok
        ? ['remote', 'set-url', 'host-base', baseRepoRoot]
        : ['remote', 'add', 'host-base', baseRepoRoot]);

    const sourceOrigin = runGit(baseRepoRoot, ['remote', 'get-url', 'origin'], { allowFailure: true });
    if (sourceOrigin.ok && sourceOrigin.stdout) {
        const serviceOrigin = runGit(repositoryRoot, ['remote', 'get-url', 'origin'], { allowFailure: true });
        runGit(repositoryRoot, serviceOrigin.ok
            ? ['remote', 'set-url', 'origin', sourceOrigin.stdout]
            : ['remote', 'add', 'origin', sourceOrigin.stdout]);
    }
}

function createStudioWorkspaceManager(options = {}) {
    const baseRepoRoot = path.resolve(options.baseRepoRoot || path.resolve(__dirname, '..'));
    const draftsRoot = path.resolve(options.draftsRoot || path.join(baseRepoRoot, '.cache', 'map-studio-drafts'));
    const repositoryRoot = resolveManagedPath(draftsRoot, path.join(draftsRoot, WORKSPACE_REPOSITORY_DIR));
    const worktreesRoot = resolveManagedPath(draftsRoot, path.join(draftsRoot, WORKSPACE_WORKTREES_DIR));
    const statePath = path.join(draftsRoot, WORKSPACE_STATE_FILE);
    const reviewStatePath = path.join(draftsRoot, 'review-state.json');
    const githubClient = options.githubClient;
    const now = options.now || (() => new Date());
    const dependencyRoot = path.resolve(options.dependencyRoot || path.join(baseRepoRoot, 'node_modules'));

    if (!githubClient || typeof githubClient.getConfiguration !== 'function') {
        throw new Error('A GitHub client is required to manage Studio workspaces.');
    }

    assertRepository(baseRepoRoot);
    fs.mkdirSync(draftsRoot, { recursive: true });
    ensureWorkspaceRepository(baseRepoRoot, repositoryRoot);
    fs.mkdirSync(worktreesRoot, { recursive: true });

    const restored = readWorkspaceRecord(statePath, draftsRoot);
    let activeDraft = restored.record;
    let recoveryIssue = restored.recoveryIssue;
    let reviewRoot = '';
    if (fs.existsSync(reviewStatePath)) {
        const review = JSON.parse(fs.readFileSync(reviewStatePath, 'utf8'));
        const candidate = resolveManagedPath(worktreesRoot, review.root);
        if (!fs.existsSync(candidate) || runGit(candidate, ['rev-parse', 'HEAD']).stdout !== review.commit) {
            throw new Error('The synced review workspace is missing or changed. Restore it before starting Studio.');
        }
        reviewRoot = candidate;
    }

    function persistActiveDraft(record) {
        writeJsonAtomic(statePath, {
            version: WORKSPACE_STATE_VERSION,
            activeDraft: record
        });
    }

    function clearActiveDraft() {
        activeDraft = null;
        recoveryIssue = '';
        fs.rmSync(statePath, { force: true });
    }

    function getBaseCheckoutState() {
        const state = getWorkspaceState(baseRepoRoot, githubClient.getConfiguration());
        return {
            branch: state.branch,
            changedPaths: state.changedPaths,
            clean: state.clean
        };
    }

    function getWorkspaceRoot() {
        return activeDraft?.root || reviewRoot || baseRepoRoot;
    }

    function getState() {
        const githubConfiguration = githubClient.getConfiguration();
        if (activeDraft) {
            const state = getWorkspaceState(activeDraft.root, githubConfiguration);
            return {
                ...state,
                isolated: true,
                draft: { ...activeDraft },
                baseCheckout: getBaseCheckoutState(),
                recovery: { required: false, message: '' },
                capabilities: {
                    ...state.capabilities,
                    canStartDraft: false,
                    canAbandonDraft: true
                }
            };
        }

        const baseCheckout = getBaseCheckoutState();
        return {
            branch: '',
            baseBranch: 'main',
            activeDraft: false,
            mode: recoveryIssue ? 'recovery' : 'base',
            editable: false,
            isolated: false,
            changedPaths: [],
            publishableChanges: [],
            unsupportedChanges: [],
            clean: true,
            baseCheckout,
            recovery: { required: Boolean(recoveryIssue), message: recoveryIssue },
            capabilities: {
                canStartDraft: !recoveryIssue,
                canEdit: false,
                canCreateMap: false,
                canPublish: false,
                canFinishDraft: false,
                canAbandonDraft: false
            },
            github: githubConfiguration
        };
    }

    function linkDependencies(worktreeRoot) {
        if (!fs.existsSync(dependencyRoot)) return;
        const target = path.join(worktreeRoot, 'node_modules');
        if (fs.existsSync(target)) return;
        fs.symlinkSync(dependencyRoot, target, 'dir');
    }

    async function startDraft(title) {
        const normalizedTitle = String(title || '').trim();
        if (!normalizedTitle) throw new Error('A draft title is required.');
        if (recoveryIssue) {
            throw new Error(`Resolve the persisted workspace before starting another draft: ${recoveryIssue}`);
        }
        if (activeDraft) return getState();

        const githubConfiguration = githubClient.getConfiguration();
        let baseRef = 'host-base/main';
        if (githubConfiguration.configured === true) {
            const token = await githubClient.getToken();
            runGit(repositoryRoot, getAuthenticatedGitArgs(['fetch', '--prune', 'origin', 'main']), {
                env: { MAP_STUDIO_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }
            });
            baseRef = 'origin/main';
        } else {
            runGit(repositoryRoot, ['fetch', '--prune', 'host-base', 'main']);
        }
        runGit(repositoryRoot, ['rev-parse', '--verify', baseRef]);

        const branch = makeDraftBranch(normalizedTitle, now());
        const id = branch.slice('map-studio/'.length);
        const worktreeRoot = resolveManagedPath(worktreesRoot, path.join(worktreesRoot, `draft-${id}`));
        let worktreeCreated = false;

        try {
            runGit(repositoryRoot, ['worktree', 'add', '-b', branch, worktreeRoot, baseRef]);
            worktreeCreated = true;
            linkDependencies(worktreeRoot);
            const record = {
                id,
                title: normalizedTitle,
                branch,
                root: worktreeRoot,
                baseRef,
                createdAt: now().toISOString()
            };
            persistActiveDraft(record);
            activeDraft = record;
            return getState();
        } catch (error) {
            if (worktreeCreated) {
                runGit(repositoryRoot, ['worktree', 'remove', '--force', worktreeRoot], { allowFailure: true });
            }
            runGit(repositoryRoot, ['branch', '-D', branch], { allowFailure: true });
            throw error;
        }
    }

    async function finishDraft() {
        if (!activeDraft) throw new Error('There is no active Map Studio draft to finish.');
        const state = getWorkspaceState(activeDraft.root, githubClient.getConfiguration());
        if (!state.clean) throw new Error('The draft still has uncommitted files. Publish or resolve them first.');

        const token = await githubClient.getToken();
        runGit(repositoryRoot, getAuthenticatedGitArgs(['fetch', '--prune', 'origin', 'main']), {
            env: { MAP_STUDIO_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }
        });
        const draftHead = runGit(activeDraft.root, ['rev-parse', 'HEAD']).stdout;
        const merged = runGit(repositoryRoot, ['merge-base', '--is-ancestor', draftHead, 'origin/main'], {
            allowFailure: true
        });
        if (!merged.ok) {
            const pull = typeof githubClient.findMergedPullRequest === 'function'
                ? await githubClient.findMergedPullRequest({ branch: activeDraft.branch, headSha: draftHead, base: 'main' })
                : null;
            const exactHeadMerged = pull?.merged === true && pull.head?.sha === draftHead
                && pull.head?.ref === activeDraft.branch && pull.base?.ref === 'main';
            const mergePresent = exactHeadMerged && /^[0-9a-f]{40,64}$/i.test(pull.merge_commit_sha || '')
                && runGit(repositoryRoot, ['merge-base', '--is-ancestor', pull.merge_commit_sha, 'origin/main'], { allowFailure: true }).ok;
            if (!mergePresent) throw new Error('This draft has not been merged into origin/main yet. Its current commit must be included in the merged pull request.');
        }
        // GitHub checks are asynchronous: never remove edits or commits made meanwhile.
        if (!getWorkspaceState(activeDraft.root, githubClient.getConfiguration()).clean
            || runGit(activeDraft.root, ['rev-parse', 'HEAD']).stdout !== draftHead) {
            throw new Error('The draft changed while checking its merge. Save and publish the latest changes before finishing.');
        }

        // Review the fetched merged atlas from a private immutable checkout.
        // Never reset or switch the user's original checkout.
        const reviewCommit = runGit(repositoryRoot, ['rev-parse', 'origin/main']).stdout;
        const nextReviewRoot = resolveManagedPath(worktreesRoot, path.join(worktreesRoot, `review-${reviewCommit}`));
        if (!fs.existsSync(nextReviewRoot)) {
            runGit(repositoryRoot, ['worktree', 'add', '--detach', nextReviewRoot, reviewCommit]);
            linkDependencies(nextReviewRoot);
        }
        if (runGit(nextReviewRoot, ['rev-parse', 'HEAD']).stdout !== reviewCommit
            || !getWorkspaceState(nextReviewRoot, githubClient.getConfiguration()).clean) {
            throw new Error('The synced review workspace contains unexpected changes. Preserve them before finishing this draft.');
        }
        writeJsonAtomic(reviewStatePath, { root: nextReviewRoot, commit: reviewCommit });
        reviewRoot = nextReviewRoot;

        const finishedBranch = activeDraft.branch;
        const finishedRoot = activeDraft.root;
        runGit(finishedRoot, ['restore', '--worktree', '--', 'dist'], { allowFailure: true });
        runGit(repositoryRoot, ['worktree', 'remove', finishedRoot]);
        runGit(repositoryRoot, ['branch', merged.ok ? '-d' : '-D', finishedBranch]);
        clearActiveDraft();
        return getState();
    }

    function abandonDraft(confirmBranch) {
        if (!activeDraft) throw new Error('There is no active Map Studio draft to abandon.');
        if (String(confirmBranch || '') !== activeDraft.branch) {
            throw new Error('Confirm the exact draft branch before abandoning it.');
        }

        const state = getWorkspaceState(activeDraft.root, githubClient.getConfiguration());
        const abandonedBranch = activeDraft.branch;
        const abandonedRoot = activeDraft.root;
        runGit(abandonedRoot, ['restore', '--worktree', '--', 'dist'], { allowFailure: true });
        runGit(repositoryRoot, [
            'worktree', 'remove',
            ...(state.clean ? [] : ['--force']),
            abandonedRoot
        ]);
        runGit(repositoryRoot, ['branch', state.clean ? '-d' : '-D', abandonedBranch]);
        clearActiveDraft();
        return getState();
    }

    return {
        abandonDraft,
        finishDraft,
        getState,
        getWorkspaceRoot,
        startDraft
    };
}

module.exports = {
    WORKSPACE_STATE_FILE,
    WORKSPACE_STATE_VERSION,
    WORKSPACE_REPOSITORY_DIR,
    WORKSPACE_WORKTREES_DIR,
    createStudioWorkspaceManager,
    ensureWorkspaceRepository,
    readWorkspaceRecord,
    resolveManagedPath,
    writeJsonAtomic
};
