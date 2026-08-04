const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { VERSIONED_FILES, bumpAssetVersion } = require('./bump_asset_version.js');

const PUBLISHABLE_EXACT_PATHS = new Set([
    'index.html',
    'map-editor.html',
    'site.config.json',
    'js/app-config.js'
]);

function isGeneratedPath(relativePath) {
    const normalized = normalizeRepoPath(relativePath);
    return normalized === 'dist' || normalized.startsWith('dist/');
}

function normalizeRepoPath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function isPublishablePath(relativePath) {
    const normalized = normalizeRepoPath(relativePath);
    return normalized.startsWith('maps/') || PUBLISHABLE_EXACT_PATHS.has(normalized);
}

function runGit(repoRoot, args, options = {}) {
    const result = spawnSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, ...(options.env || {}) }
    });
    const rawStdout = String(result.stdout || '');
    const stdout = options.trimOutput === false ? rawStdout.trimEnd() : rawStdout.trim();
    const stderr = String(result.stderr || '').trim();
    if (result.error || result.status !== 0) {
        if (options.allowFailure) {
            return { ok: false, status: result.status, stdout, stderr, error: result.error };
        }
        throw new Error(stderr || stdout || result.error?.message || `git ${args[0]} failed.`);
    }
    return { ok: true, status: 0, stdout, stderr };
}

function getCurrentBranch(repoRoot) {
    return runGit(repoRoot, ['branch', '--show-current']).stdout;
}

function getChangedPaths(repoRoot) {
    const output = runGit(
        repoRoot,
        ['status', '--porcelain=v1', '--untracked-files=all'],
        { trimOutput: false }
    ).stdout;
    if (!output) return [];
    return output.split('\n').map((line) => {
        const rawPath = line.slice(3).trim();
        const pathParts = rawPath.split(' -> ');
        return normalizeRepoPath(pathParts[pathParts.length - 1]);
    }).filter((relativePath) => relativePath && !isGeneratedPath(relativePath));
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'map-update';
}

function makeDraftBranch(title, now = new Date()) {
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = crypto.randomBytes(2).toString('hex');
    return `map-studio/${date}-${slugify(title)}-${suffix}`;
}

function assertRepository(repoRoot) {
    const result = runGit(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
    if (!result.ok || result.stdout !== 'true') {
        throw new Error(`${repoRoot} is not a Git working tree.`);
    }
}

function getWorkspaceState(repoRoot, githubConfiguration = {}) {
    assertRepository(repoRoot);
    const branch = getCurrentBranch(repoRoot);
    const changedPaths = getChangedPaths(repoRoot);
    const activeDraft = branch.startsWith('map-studio/');
    const onMain = branch === 'main';
    const detached = !branch;
    const editable = Boolean(branch && !onMain);
    const unsupportedChanges = changedPaths.filter((changedPath) => !isPublishablePath(changedPath));
    const publishableChanges = changedPaths.filter(isPublishablePath);
    const githubReady = githubConfiguration?.configured === true;
    const clean = changedPaths.length === 0;
    return {
        branch,
        baseBranch: 'main',
        activeDraft,
        mode: detached ? 'detached' : (activeDraft ? 'studio-draft' : (onMain ? 'main' : 'working-branch')),
        editable,
        changedPaths,
        publishableChanges,
        unsupportedChanges,
        clean,
        capabilities: {
            canStartDraft: onMain && clean,
            canEdit: editable,
            canCreateMap: editable,
            canPublish: activeDraft && publishableChanges.length > 0 && unsupportedChanges.length === 0 && githubReady,
            canFinishDraft: activeDraft && clean && githubReady
        },
        github: githubConfiguration
    };
}

function getAuthenticatedGitArgs(args) {
    const credentialHelper = '!f() { if [ "$1" = get ]; then echo username=x-access-token; echo password="$MAP_STUDIO_GIT_TOKEN"; fi; }; f';
    return ['-c', 'credential.helper=', '-c', `credential.helper=${credentialHelper}`, ...args];
}

async function startDraft({ repoRoot, title, githubClient }) {
    assertRepository(repoRoot);
    const githubConfiguration = githubClient.getConfiguration();
    const state = getWorkspaceState(repoRoot, githubConfiguration);
    if (state.activeDraft) return state;
    if (state.branch !== 'main') {
        throw new Error(`Map Studio must start drafts from main, not ${state.branch || 'detached HEAD'}.`);
    }
    if (!state.clean) {
        throw new Error('The Map Studio workspace has uncommitted files. Resolve them before starting a draft.');
    }

    if (githubConfiguration.configured === true) {
        const token = await githubClient.getToken();
        const authEnv = { MAP_STUDIO_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' };
        runGit(repoRoot, getAuthenticatedGitArgs(['fetch', '--prune', 'origin', 'main']), { env: authEnv });
        runGit(repoRoot, ['merge', '--ff-only', 'origin/main']);
    }
    const branch = makeDraftBranch(title);
    runGit(repoRoot, ['switch', '-c', branch]);
    return getWorkspaceState(repoRoot, githubConfiguration);
}

async function finishMergedDraft({ repoRoot, githubClient }) {
    const state = getWorkspaceState(repoRoot, githubClient.getConfiguration());
    if (!state.activeDraft) throw new Error('There is no active Map Studio draft to finish.');
    if (!state.clean) throw new Error('The draft still has uncommitted files. Publish or resolve them first.');

    const token = await githubClient.getToken();
    const authEnv = { MAP_STUDIO_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' };
    runGit(repoRoot, getAuthenticatedGitArgs(['fetch', '--prune', 'origin', 'main']), { env: authEnv });
    const merged = runGit(repoRoot, ['merge-base', '--is-ancestor', state.branch, 'origin/main'], {
        allowFailure: true
    });
    if (!merged.ok) {
        throw new Error('This draft has not been merged into origin/main yet.');
    }

    runGit(repoRoot, ['switch', 'main']);
    runGit(repoRoot, ['merge', '--ff-only', 'origin/main']);
    runGit(repoRoot, ['branch', '-d', state.branch]);
    return getWorkspaceState(repoRoot, githubClient.getConfiguration());
}

function runCommandStreaming(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...(options.env || {}) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const output = [];
        const capture = (chunk) => {
            const text = String(chunk || '');
            output.push(text);
            if (typeof options.onOutput === 'function') options.onOutput(text);
        };
        child.stdout.on('data', capture);
        child.stderr.on('data', capture);
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`${path.basename(command)} exited with code ${code}.`));
                return;
            }
            resolve(output.join(''));
        });
    });
}

async function publishDraft({
    repoRoot,
    title,
    description,
    githubClient,
    onOutput,
    resume = false,
    runValidation = runCommandStreaming,
    advanceAssetVersion = bumpAssetVersion
}) {
    const initialState = getWorkspaceState(repoRoot, githubClient.getConfiguration());
    if (!initialState.activeDraft) throw new Error('Start a Map Studio draft before publishing.');
    if (initialState.clean && !resume) throw new Error('There are no map changes to publish.');
    if (initialState.unsupportedChanges.length > 0) {
        throw new Error(`Draft contains files Map Studio will not publish: ${initialState.unsupportedChanges.join(', ')}`);
    }

    let paths = [];
    if (!initialState.clean) {
        if (!initialState.changedPaths.some((changedPath) => VERSIONED_FILES.includes(changedPath))) {
            const versionResult = advanceAssetVersion(repoRoot);
            if (typeof onOutput === 'function') {
                onOutput(`Advanced asset version from ${versionResult.previousVersion} to ${versionResult.nextVersion}.\n`);
            }
        }

        await runValidation(process.execPath, ['scripts/publish_check.js'], {
            cwd: repoRoot,
            onOutput
        });

        const postCheckState = getWorkspaceState(repoRoot, githubClient.getConfiguration());
        if (postCheckState.unsupportedChanges.length > 0) {
            throw new Error(`Validation produced unsupported changes: ${postCheckState.unsupportedChanges.join(', ')}`);
        }
        paths = postCheckState.changedPaths.filter(isPublishablePath);
        if (paths.length === 0) throw new Error('Validation left no publishable map changes.');

        runGit(repoRoot, ['add', '--', ...paths]);
        runGit(repoRoot, [
            '-c', 'user.name=Hiraeth Map Studio',
            '-c', 'user.email=map-studio@hiraeth.wiki',
            'commit', '-m', title
        ]);
    } else {
        paths = runGit(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).stdout
            .split('\n')
            .map(normalizeRepoPath)
            .filter(isPublishablePath);
        if (typeof onOutput === 'function') {
            onOutput('Resuming from the existing validated commit.\n');
        }
    }

    const token = await githubClient.getToken();
    runGit(repoRoot, getAuthenticatedGitArgs(['push', '--set-upstream', 'origin', initialState.branch]), {
        env: { MAP_STUDIO_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }
    });

    const existingPullRequest = typeof githubClient.findOpenPullRequest === 'function'
        ? await githubClient.findOpenPullRequest({ branch: initialState.branch })
        : null;
    const pullRequest = existingPullRequest || await githubClient.createDraftPullRequest({
        branch: initialState.branch,
        title,
        body: description || 'Created and validated by Hiraeth Map Studio.'
    });
    return {
        branch: initialState.branch,
        commit: runGit(repoRoot, ['rev-parse', 'HEAD']).stdout,
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.html_url,
        paths
    };
}

module.exports = {
    assertRepository,
    finishMergedDraft,
    getAuthenticatedGitArgs,
    getChangedPaths,
    getCurrentBranch,
    getWorkspaceState,
    isGeneratedPath,
    isPublishablePath,
    makeDraftBranch,
    normalizeRepoPath,
    publishDraft,
    runCommandStreaming,
    runGit,
    slugify,
    startDraft
};
