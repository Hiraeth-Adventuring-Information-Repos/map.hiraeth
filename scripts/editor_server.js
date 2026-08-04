#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
    runtimeAssetFiles,
    runtimeDirectories,
    runtimeFiles
} = require('./build_pages.js');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8010;
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const LIVE_PAGES_SOURCE_FILES = new Set([
    ...runtimeFiles,
    ...runtimeAssetFiles
]);

const LIVE_PAGES_SOURCE_PREFIXES = [
    ...runtimeDirectories.map((directoryPath) => `${directoryPath}/`),
    'maps/'
];

const EDITOR_ONLY_SOURCE_FILES = new Set([
    'map-editor.html',
    'css/map-editor.css',
    'js/map-editor.js',
    'js/editor-shared.js',
    'js/libs/text-toolbar.js'
]);

const CHANGED_FILE_GROUPS = [
    'Map data',
    'Pages bundle',
    'Editor-only',
    'CI/scripts',
    'Unrelated'
];

const PREVIEW_BUILD_STEPS = [
    { label: 'Generate atlas index', script: 'scripts/generate_atlas_index.js' },
    { label: 'Validate map data', script: 'scripts/validate_map_data.js' },
    { label: 'Build Pages bundle', script: 'scripts/build_pages.js' }
];

const previewBuildJobs = new Map();
let previewBuildJobCounter = 0;

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg'
};

function normalizeHost(host) {
    return String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHost(host) {
    const normalized = normalizeHost(host);
    return normalized === 'localhost' ||
        normalized === '::1' ||
        normalized === '0:0:0:0:0:0:0:1' ||
        normalized === DEFAULT_HOST ||
        /^127\./.test(normalized);
}

function isLocalEditorHostname(host) {
    const normalized = normalizeHost(host);
    return isLoopbackHost(normalized) || normalized.endsWith('.localhost');
}

function assertLoopbackBindHost(host) {
    if (!isLoopbackHost(host)) {
        throw new Error(`Refusing to start editor server on non-loopback host "${host}". Use ${DEFAULT_HOST}.`);
    }
}

function getDefaultPortForProtocol(protocol) {
    return protocol === 'https:' ? '443' : '80';
}

function parseHostHeader(hostHeader) {
    const rawHost = String(hostHeader || '').trim();
    if (!rawHost) return null;
    try {
        const parsed = new URL(`http://${rawHost}`);
        return {
            hostname: normalizeHost(parsed.hostname),
            port: parsed.port || '80',
            explicitPort: parsed.port || ''
        };
    } catch (error) {
        return null;
    }
}

function isSameLocalEditorOrigin(originValue, hostHeader) {
    const requestHost = parseHostHeader(hostHeader);
    if (!requestHost || !isLocalEditorHostname(requestHost.hostname)) return false;

    try {
        const originUrl = new URL(originValue);
        if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false;

        const originHostname = normalizeHost(originUrl.hostname);
        const originPort = originUrl.port || getDefaultPortForProtocol(originUrl.protocol);

        return isLocalEditorHostname(originHostname) &&
            originHostname === requestHost.hostname &&
            originPort === requestHost.port;
    } catch (error) {
        return false;
    }
}

function isSameRequestOrigin(originValue, hostHeader, forwardedProtocol = '') {
    const requestHost = parseHostHeader(hostHeader);
    if (!requestHost) return false;

    try {
        const originUrl = new URL(originValue);
        if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false;
        const normalizedForwardedProtocol = String(forwardedProtocol || '')
            .split(',')[0]
            .trim()
            .toLowerCase();
        const requestProtocol = normalizedForwardedProtocol === 'http' || normalizedForwardedProtocol === 'https'
            ? `${normalizedForwardedProtocol}:`
            : '';
        const originPort = originUrl.port || getDefaultPortForProtocol(originUrl.protocol);
        const requestPort = requestHost.explicitPort || getDefaultPortForProtocol(requestProtocol || 'http:');
        return normalizeHost(originUrl.hostname) === requestHost.hostname &&
            (!requestProtocol || originUrl.protocol === requestProtocol) &&
            originPort === requestPort;
    } catch (error) {
        return false;
    }
}

function isSameOriginWriteRequest(request) {
    const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').trim();
    const origin = String(request.headers.origin || '').trim();
    if (origin) return isSameRequestOrigin(origin, request.headers.host, forwardedProtocol);

    const referer = String(request.headers.referer || '').trim();
    if (referer) return isSameRequestOrigin(referer, request.headers.host, forwardedProtocol);

    return false;
}

function isAllowedEditorWriteRequest(request) {
    const origin = String(request.headers.origin || '').trim();
    if (origin) return isSameLocalEditorOrigin(origin, request.headers.host);

    const referer = String(request.headers.referer || '').trim();
    if (referer) return isSameLocalEditorOrigin(referer, request.headers.host);

    return false;
}

function resolveRepoPath(repoRoot, relativePath) {
    const fullPath = path.resolve(repoRoot, relativePath);
    if (!fullPath.startsWith(`${repoRoot}${path.sep}`) && fullPath !== repoRoot) {
        throw new Error(`Path escapes repository root: ${relativePath}`);
    }
    return fullPath;
}

function resolveMapTargetPath(repoRoot, payload) {
    const rawPath = String(payload?.dataUrl || payload?.fileName || '').trim() ||
        `maps/${String(payload?.mapId || 'map').trim()}.json`;
    const candidate = rawPath.includes('/') ? rawPath : `maps/${rawPath}`;
    const normalized = path.posix.normalize(candidate);

    if (
        normalized.startsWith('../') ||
        normalized.startsWith('/') ||
        !normalized.startsWith('maps/') ||
        path.posix.dirname(normalized) !== 'maps' ||
        !normalized.endsWith('.json')
    ) {
        throw new Error('Map saves can only target top-level maps/*.json files.');
    }

    const basename = path.posix.basename(normalized);
    if (basename === 'maps.json' || basename === 'atlas-index.json') {
        throw new Error('Use Save Atlas Structure for maps.json. atlas-index.json is generated.');
    }

    return {
        relativePath: normalized,
        fullPath: resolveRepoPath(repoRoot, normalized)
    };
}

function getManifestEntries(manifestDocument) {
    if (Array.isArray(manifestDocument)) return manifestDocument;
    if (manifestDocument && Array.isArray(manifestDocument.maps)) return manifestDocument.maps;
    return null;
}

function validateMapDocument(document) {
    const errors = [];
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        return ['Map document must be a JSON object.'];
    }
    if (!String(document.id || '').trim()) errors.push('Map document id is required.');
    if (!String(document.name || '').trim()) errors.push('Map document name is required.');
    if (document.pointsOfInterest !== undefined && !Array.isArray(document.pointsOfInterest)) {
        errors.push('pointsOfInterest must be an array when present.');
    }
    if (document.regions !== undefined && !Array.isArray(document.regions)) {
        errors.push('regions must be an array when present.');
    }
    if (document.lines !== undefined && !Array.isArray(document.lines)) {
        errors.push('lines must be an array when present.');
    }
    if (document.roads !== undefined && !Array.isArray(document.roads)) {
        errors.push('roads must be an array when present.');
    }
    return errors;
}

function validateAtlasManifestDocument(document) {
    const entries = getManifestEntries(document);
    const errors = [];
    if (!entries) return ['Atlas structure must be an array or an object with a maps array.'];

    const ids = new Set();
    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            errors.push(`Entry ${index} must be an object.`);
            return;
        }
        const id = String(entry.id || '').trim();
        const name = String(entry.name || '').trim();
        if (!id) errors.push(`Entry ${index} id is required.`);
        if (!name) errors.push(`Entry ${index} name is required.`);
        if (id && ids.has(id)) errors.push(`Duplicate id "${id}".`);
        if (id) ids.add(id);
    });

    entries.forEach((entry, index) => {
        const parentId = String(entry?.parentId || '').trim();
        if (parentId && !ids.has(parentId)) {
            errors.push(`Entry ${index} has unknown parentId "${parentId}".`);
        }
    });

    return errors;
}

function prettyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function snapshotFile(fullPath) {
    return {
        fullPath,
        existed: fs.existsSync(fullPath),
        content: fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : null
    };
}

function getWriteTransactionRoot(repoRoot) {
    const result = spawnSync('git', ['rev-parse', '--git-path', 'map-studio-transactions'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    if (result.error || result.status !== 0) {
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        throw new Error(`Could not locate the Studio transaction journal${output ? `: ${output}` : '.'}`);
    }
    return path.resolve(repoRoot, String(result.stdout || '').trim());
}

function isGitWorkTree(repoRoot) {
    const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    return !result.error && result.status === 0 && String(result.stdout || '').trim() === 'true';
}

function assertTransactionRelativePath(repoRoot, fullPath) {
    const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
    if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
        throw new Error('Studio transaction path escapes the repository.');
    }
    return relativePath;
}

function createWriteTransaction(repoRoot, snapshots, generatedDir) {
    const transactionRoot = getWriteTransactionRoot(repoRoot);
    fs.mkdirSync(transactionRoot, { recursive: true });
    const transactionDir = fs.mkdtempSync(path.join(transactionRoot, 'transaction-'));
    const records = snapshots.map((snapshot, index) => {
        const relativePath = assertTransactionRelativePath(repoRoot, snapshot.fullPath);
        const backup = snapshot.existed ? `${String(index).padStart(5, '0')}.bin` : '';
        if (snapshot.existed) fs.writeFileSync(path.join(transactionDir, backup), snapshot.content);
        return { relativePath, existed: snapshot.existed, backup };
    });
    const manifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        generatedDir: assertTransactionRelativePath(repoRoot, generatedDir),
        records
    };
    const manifestPath = path.join(transactionDir, 'transaction.json');
    const temporaryManifestPath = `${manifestPath}.tmp`;
    fs.writeFileSync(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryManifestPath, manifestPath);
    return { transactionDir, manifest };
}

function restoreWriteTransaction(repoRoot, transactionDir, manifest) {
    const snapshots = manifest.records.map((record) => {
        const fullPath = resolveRepoPath(repoRoot, record.relativePath);
        return {
            fullPath,
            existed: record.existed === true,
            content: record.existed ? fs.readFileSync(path.join(transactionDir, record.backup)) : null
        };
    });
    restoreSnapshots(snapshots);
    const generatedDir = resolveRepoPath(repoRoot, manifest.generatedDir);
    removeFilesOutsideSnapshot(generatedDir, new Set(snapshots.map((snapshot) => snapshot.fullPath)));
}

function recoverWriteTransactions(repoRoot) {
    const transactionRoot = getWriteTransactionRoot(repoRoot);
    if (!fs.existsSync(transactionRoot)) return [];
    const recovered = [];
    fs.readdirSync(transactionRoot, { withFileTypes: true }).forEach((entry) => {
        if (!entry.isDirectory()) return;
        const transactionDir = path.join(transactionRoot, entry.name);
        const manifestPath = path.join(transactionDir, 'transaction.json');
        if (!fs.existsSync(manifestPath)) {
            fs.rmSync(transactionDir, { recursive: true, force: true });
            return;
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest?.version !== 1 || !Array.isArray(manifest.records)) {
            throw new Error(`Studio transaction ${entry.name} uses an unsupported journal format.`);
        }
        restoreWriteTransaction(repoRoot, transactionDir, manifest);
        fs.rmSync(transactionDir, { recursive: true, force: true });
        recovered.push(entry.name);
    });
    return recovered;
}

function completeWriteTransaction(transaction) {
    if (!transaction?.transactionDir) return;
    fs.rmSync(transaction.transactionDir, { recursive: true, force: true });
}

function listFilesRecursive(directoryPath) {
    if (!fs.existsSync(directoryPath)) return [];
    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) return listFilesRecursive(entryPath);
        if (entry.isFile()) return [entryPath];
        return [];
    });
}

function countFilesRecursive(directoryPath) {
    return listFilesRecursive(directoryPath).length;
}

function getGitChangedFiles(repoRoot) {
    const result = spawnSync('git', ['status', '--short', '--untracked-files=normal'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    if (result.error || result.status !== 0) {
        return {
            ok: false,
            files: [],
            error: result.error ? result.error.message : String(result.stderr || '').trim()
        };
    }
    return {
        ok: true,
        files: String(result.stdout || '').split('\n').map((line) => line.trimEnd()).filter(Boolean),
        error: ''
    };
}

function parseGitStatusLine(line) {
    const raw = String(line || '').trimEnd();
    const status = raw.slice(0, 2).trim() || '??';
    const pathPart = raw.slice(3).trim();
    const pathParts = pathPart.split(' -> ');
    const relativePath = pathParts[pathParts.length - 1] || pathPart;
    return {
        raw,
        status,
        path: relativePath,
        previousPath: pathParts.length > 1 ? pathParts[0] : ''
    };
}

function getPathFromGitStatusLine(line) {
    return parseGitStatusLine(line).path;
}

function normalizeChangedPath(relativePath) {
    return String(relativePath || '').trim().replace(/\\/g, '/');
}

function classifyChangedFilePath(relativePath) {
    const normalized = normalizeChangedPath(relativePath);
    if (!normalized) return 'Unrelated';
    if (normalized === 'maps' || normalized.startsWith('maps/')) return 'Map data';
    if (normalized === 'dist' || normalized.startsWith('dist/')) return 'Pages bundle';
    if (EDITOR_ONLY_SOURCE_FILES.has(normalized) || /^tests\/(?:map-editor|updateTreeAfterSettingsChange)/.test(normalized)) {
        return 'Editor-only';
    }
    if (
        LIVE_PAGES_SOURCE_FILES.has(normalized) ||
        LIVE_PAGES_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
        return 'Pages bundle';
    }
    if (
        normalized === 'package.json' ||
        normalized === 'package-lock.json' ||
        normalized.startsWith('.github/') ||
        normalized.startsWith('scripts/') ||
        normalized.startsWith('tests/')
    ) {
        return 'CI/scripts';
    }
    return 'Unrelated';
}

function getChangedFileGroups(statusLines) {
    const groups = new Map(CHANGED_FILE_GROUPS.map((label) => [label, []]));
    statusLines.map(parseGitStatusLine).forEach((entry) => {
        const label = classifyChangedFilePath(entry.path);
        groups.get(label).push(entry);
    });
    return CHANGED_FILE_GROUPS.map((label) => {
        const files = groups.get(label);
        return {
            label,
            count: files.length,
            files
        };
    }).filter((group) => group.count > 0);
}

function isLivePagesSourcePath(relativePath) {
    const normalized = normalizeChangedPath(relativePath);
    if (!normalized || normalized.startsWith('dist/')) return false;
    if (EDITOR_ONLY_SOURCE_FILES.has(normalized)) return false;
    if (normalized === 'maps/maps.json') return true;
    return LIVE_PAGES_SOURCE_FILES.has(normalized) ||
        LIVE_PAGES_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function filesMatch(leftPath, rightPath) {
    if (!fs.existsSync(leftPath) || !fs.existsSync(rightPath)) return false;
    const leftStat = fs.statSync(leftPath);
    const rightStat = fs.statSync(rightPath);
    if (!leftStat.isFile() || !rightStat.isFile()) return false;
    if (leftStat.size !== rightStat.size) return false;
    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
}

function getDistComparisonTargetsForSource(relativePath) {
    const normalized = normalizeChangedPath(relativePath);
    if (!normalized || normalized.startsWith('dist/')) return [];
    if (normalized === 'maps/maps.json') {
        return [{
            source: 'maps/atlas-index.json',
            dist: 'maps/atlas-index.json',
            reason: 'Atlas structure changed.'
        }];
    }
    if (!isLivePagesSourcePath(normalized)) return [];
    return [{
        source: normalized,
        dist: normalized,
        reason: 'Live source changed.'
    }];
}

function compareLiveSourcesToDist(repoRoot, changedPaths) {
    const seen = new Set();
    const mismatches = [];
    changedPaths.forEach((relativePath) => {
        getDistComparisonTargetsForSource(relativePath).forEach((target) => {
            const key = `${target.source}=>${target.dist}`;
            if (seen.has(key)) return;
            seen.add(key);

            const sourcePath = resolveRepoPath(repoRoot, target.source);
            const distPath = resolveRepoPath(repoRoot, `dist/${target.dist}`);
            const sourceExists = fs.existsSync(sourcePath);
            const distExists = fs.existsSync(distPath);

            if (!sourceExists && !distExists) return;
            if (!sourceExists) {
                mismatches.push({
                    source: target.source,
                    dist: target.dist,
                    reason: `${target.reason} Source file is missing.`
                });
                return;
            }
            if (!distExists) {
                mismatches.push({
                    source: target.source,
                    dist: target.dist,
                    reason: `${target.reason} dist/${target.dist} is missing.`
                });
                return;
            }
            if (!filesMatch(sourcePath, distPath)) {
                mismatches.push({
                    source: target.source,
                    dist: target.dist,
                    reason: `${target.reason} dist/${target.dist} does not match.`
                });
            }
        });
    });

    return {
        checked: seen.size,
        mismatches
    };
}

function getPublishReadiness(repoRoot) {
    const gitStatus = getGitChangedFiles(repoRoot);
    const changedPaths = gitStatus.files.map(getPathFromGitStatusLine);
    const distPath = resolveRepoPath(repoRoot, 'dist');
    const distExists = fs.existsSync(distPath) && fs.statSync(distPath).isDirectory();
    const distFileCount = distExists ? countFilesRecursive(distPath) : 0;
    const pagesBundleDrift = compareLiveSourcesToDist(repoRoot, changedPaths);
    const warnings = [];

    if (!distExists || distFileCount === 0) {
        warnings.push('dist/ has not been built.');
    } else if (pagesBundleDrift.mismatches.length > 0) {
        warnings.push(`dist/ does not match ${pagesBundleDrift.mismatches.length} changed live source file(s); build the Pages bundle before publishing.`);
    }
    if (!gitStatus.ok) {
        warnings.push(`Could not read changed files: ${gitStatus.error || 'git status failed.'}`);
    }

    const pagesBundleStale = pagesBundleDrift.mismatches.length > 0;
    const topStatus = !gitStatus.ok
        ? 'Failed'
        : (!distExists || distFileCount === 0 || pagesBundleStale ? 'Needs Build' : 'Ready');

    return {
        changedFiles: gitStatus.files,
        changedFileGroups: getChangedFileGroups(gitStatus.files),
        topStatus,
        pagesBundle: {
            built: distExists && distFileCount > 0,
            fileCount: distFileCount,
            stale: pagesBundleStale,
            drift: pagesBundleDrift
        },
        warnings
    };
}

function restoreSnapshots(snapshots) {
    snapshots.forEach((snapshot) => {
        if (snapshot.existed) {
            fs.mkdirSync(path.dirname(snapshot.fullPath), { recursive: true });
            fs.writeFileSync(snapshot.fullPath, snapshot.content);
        } else {
            fs.rmSync(snapshot.fullPath, { force: true });
        }
    });
}

function removeFilesOutsideSnapshot(directoryPath, snapshotPaths) {
    if (!fs.existsSync(directoryPath)) return;
    listFilesRecursive(directoryPath).forEach((fullPath) => {
        if (!snapshotPaths.has(fullPath)) {
            fs.rmSync(fullPath, { force: true });
        }
    });
}

function runNodeScript(repoRoot, relativeScriptPath) {
    const result = spawnSync(process.execPath, [relativeScriptPath], {
        cwd: repoRoot,
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        throw new Error(`${relativeScriptPath} failed${output ? `:\n${output}` : '.'}`);
    }

    return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function regenerateAndValidate(repoRoot) {
    runNodeScript(repoRoot, 'scripts/generate_atlas_index.js');
    runNodeScript(repoRoot, 'scripts/validate_map_data.js');
}

function buildLivePreview(repoRoot) {
    const output = [
        runNodeScript(repoRoot, 'scripts/generate_atlas_index.js'),
        runNodeScript(repoRoot, 'scripts/validate_map_data.js'),
        runNodeScript(repoRoot, 'scripts/build_pages.js')
    ].filter(Boolean);
    return output.join('\n');
}

function appendPreviewBuildOutput(job, chunk) {
    const lines = String(chunk || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => {
        job.output.push(line);
        if (job.output.length > 200) job.output.shift();
    });
    job.recentOutput = job.output.slice(-8);
    persistPreviewBuildJob(job.repoRoot, job);
}

function getPreviewBuildJobPath(repoRoot) {
    const result = spawnSync('git', ['rev-parse', '--git-path', 'map-studio-jobs/preview-job.json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    if (result.error || result.status !== 0) {
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        throw new Error(`Could not locate the preview job record${output ? `: ${output}` : '.'}`);
    }
    return path.resolve(repoRoot, String(result.stdout || '').trim());
}

function persistPreviewBuildJob(repoRoot, job) {
    if (!isGitWorkTree(repoRoot)) return;
    const jobPath = getPreviewBuildJobPath(repoRoot);
    fs.mkdirSync(path.dirname(jobPath), { recursive: true });
    const temporaryPath = `${jobPath}.${process.pid}.tmp`;
    const payload = {
        version: 1,
        job: {
            id: job.id,
            status: job.status,
            step: job.step,
            steps: job.steps,
            output: job.output,
            recentOutput: job.recentOutput,
            error: job.error,
            previewUrl: job.previewUrl
        }
    };
    fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, jobPath);
}

function restorePreviewBuildJob(repoRoot) {
    if (!isGitWorkTree(repoRoot)) return null;
    const jobPath = getPreviewBuildJobPath(repoRoot);
    if (!fs.existsSync(jobPath)) return null;
    try {
        const payload = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
        if (payload?.version !== 1 || !payload.job?.id) {
            throw new Error('Preview job record uses an unsupported format.');
        }
        const job = {
            id: String(payload.job.id),
            repoRoot,
            status: String(payload.job.status || 'failed'),
            step: String(payload.job.step || ''),
            steps: Array.isArray(payload.job.steps) ? payload.job.steps : [],
            output: Array.isArray(payload.job.output) ? payload.job.output.map(String).slice(-200) : [],
            recentOutput: Array.isArray(payload.job.recentOutput) ? payload.job.recentOutput.map(String).slice(-8) : [],
            error: String(payload.job.error || ''),
            previewUrl: String(payload.job.previewUrl || ''),
            readiness: null
        };
        if (job.status === 'running') {
            job.status = 'interrupted';
            job.step = 'Interrupted';
            job.error = 'Preview build was interrupted by a Studio restart. Start the build again to replace the partial preview safely.';
            const activeStep = job.steps.find((step) => step.status === 'running');
            if (activeStep) activeStep.status = 'interrupted';
            fs.rmSync(path.join(repoRoot, 'dist'), { recursive: true, force: true });
            appendPreviewBuildOutput(job, job.error);
        }
        previewBuildJobs.set(job.id, job);
        return job;
    } catch (error) {
        fs.rmSync(path.join(repoRoot, 'dist'), { recursive: true, force: true });
        fs.rmSync(jobPath, { force: true });
        return null;
    }
}

function findPreviewBuildJob(repoRoot, jobId = '') {
    const inMemory = Array.from(previewBuildJobs.values()).find((job) => {
        return job.repoRoot === repoRoot && (!jobId || job.id === jobId);
    });
    if (inMemory) return inMemory;
    const restored = restorePreviewBuildJob(repoRoot);
    if (!restored || (jobId && restored.id !== jobId)) return null;
    return restored;
}

function runNodeScriptAsync(repoRoot, relativeScriptPath, onOutput) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [relativeScriptPath], {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';

        const collectOutput = (chunk) => {
            const text = String(chunk || '');
            output += text;
            if (onOutput) onOutput(text);
        };

        child.stdout.on('data', collectOutput);
        child.stderr.on('data', collectOutput);
        child.on('error', reject);
        child.on('close', (status) => {
            if (status === 0) {
                resolve(output.trim());
                return;
            }
            reject(new Error(`${relativeScriptPath} failed${output.trim() ? `:\n${output.trim()}` : '.'}`));
        });
    });
}

function serializePreviewBuildJob(job) {
    return {
        id: job.id,
        ok: job.status !== 'failed' && job.status !== 'interrupted',
        status: job.status,
        step: job.step,
        steps: job.steps,
        recentOutput: job.recentOutput,
        error: job.error,
        previewUrl: job.previewUrl,
        readiness: job.readiness
    };
}

async function runPreviewBuildJob(repoRoot, job) {
    try {
        for (let index = 0; index < PREVIEW_BUILD_STEPS.length; index += 1) {
            const step = PREVIEW_BUILD_STEPS[index];
            job.step = step.label;
            job.steps[index].status = 'running';
            persistPreviewBuildJob(repoRoot, job);
            appendPreviewBuildOutput(job, `${step.label}...`);
            await runNodeScriptAsync(repoRoot, step.script, (chunk) => appendPreviewBuildOutput(job, chunk));
            job.steps[index].status = 'pass';
            persistPreviewBuildJob(repoRoot, job);
        }

        job.status = 'complete';
        job.step = 'Ready';
        job.previewUrl = '/preview/';
        job.readiness = getPublishReadiness(repoRoot);
        appendPreviewBuildOutput(job, 'Live preview is ready.');
    } catch (error) {
        job.status = 'failed';
        job.step = 'Failed';
        job.error = error.message || 'Preview build failed.';
        const activeStep = job.steps.find((step) => step.status === 'running');
        if (activeStep) activeStep.status = 'fail';
        appendPreviewBuildOutput(job, job.error);
    }
}

function startPreviewBuildJob(repoRoot) {
    const currentJob = findPreviewBuildJob(repoRoot);
    const runningJob = currentJob?.status === 'running' ? currentJob : null;
    if (runningJob) return runningJob;

    const job = {
        id: `${Date.now()}-${process.pid}-${String(previewBuildJobCounter += 1)}`,
        repoRoot,
        status: 'running',
        step: 'Queued',
        steps: PREVIEW_BUILD_STEPS.map((step) => ({
            label: step.label,
            status: 'pending'
        })),
        output: [],
        recentOutput: [],
        error: '',
        previewUrl: '',
        readiness: null
    };
    Array.from(previewBuildJobs.entries()).forEach(([id, existingJob]) => {
        if (existingJob.repoRoot === repoRoot) previewBuildJobs.delete(id);
    });
    previewBuildJobs.set(job.id, job);
    persistPreviewBuildJob(repoRoot, job);
    runPreviewBuildJob(repoRoot, job);
    return job;
}

function hasRunningPreviewBuild(repoRoot) {
    return findPreviewBuildJob(repoRoot)?.status === 'running';
}

function writeWithValidation(repoRoot, writes) {
    recoverWriteTransactions(repoRoot);
    const atlasPath = resolveRepoPath(repoRoot, 'maps/atlas-index.json');
    const generatedDir = resolveRepoPath(repoRoot, 'maps/generated');
    const snapshots = [
        ...writes.map((write) => snapshotFile(write.fullPath)),
        snapshotFile(atlasPath),
        ...listFilesRecursive(generatedDir).map(snapshotFile)
    ];
    const snapshotPaths = new Set(snapshots.map((snapshot) => snapshot.fullPath));
    const transaction = createWriteTransaction(repoRoot, snapshots, generatedDir);

    try {
        writes.forEach((write) => {
            fs.mkdirSync(path.dirname(write.fullPath), { recursive: true });
            if (write.sourcePath) {
                fs.copyFileSync(write.sourcePath, write.fullPath);
            } else {
                fs.writeFileSync(write.fullPath, write.content);
            }
        });
        regenerateAndValidate(repoRoot);
        completeWriteTransaction(transaction);
    } catch (error) {
        restoreSnapshots(snapshots);
        removeFilesOutsideSnapshot(generatedDir, snapshotPaths);
        completeWriteTransaction(transaction);
        throw error;
    }
}

function saveMapDocument(repoRoot, payload) {
    const errors = validateMapDocument(payload?.document);
    if (errors.length > 0) {
        throw new Error(errors.join(' '));
    }

    const target = resolveMapTargetPath(repoRoot, payload);
    writeWithValidation(repoRoot, [{
        fullPath: target.fullPath,
        content: prettyJson(payload.document)
    }]);

    return {
        ok: true,
        saved: target.relativePath,
        atlas: 'maps/atlas-index.json',
        readiness: getPublishReadiness(repoRoot)
    };
}

function saveAtlasStructure(repoRoot, payload) {
    const errors = validateAtlasManifestDocument(payload?.document);
    if (errors.length > 0) {
        throw new Error(errors.join(' '));
    }

    const target = {
        relativePath: 'maps/maps.json',
        fullPath: resolveRepoPath(repoRoot, 'maps/maps.json')
    };
    writeWithValidation(repoRoot, [{
        fullPath: target.fullPath,
        content: prettyJson(payload.document)
    }]);

    return {
        ok: true,
        saved: target.relativePath,
        atlas: 'maps/atlas-index.json',
        readiness: getPublishReadiness(repoRoot)
    };
}

function saveWorkspaceDocuments(repoRoot, payload, options = {}) {
    const mapPayload = payload?.map;
    const atlasPayload = payload?.atlas;
    const mapErrors = validateMapDocument(mapPayload?.document);
    const atlasErrors = validateAtlasManifestDocument(atlasPayload?.document);
    const errors = [...mapErrors, ...atlasErrors];
    if (errors.length > 0) {
        throw new Error(errors.join(' '));
    }

    const mapTarget = resolveMapTargetPath(repoRoot, mapPayload);
    const atlasTarget = {
        relativePath: 'maps/maps.json',
        fullPath: resolveRepoPath(repoRoot, 'maps/maps.json')
    };
    const writeDocuments = options.writeDocuments || writeWithValidation;
    writeDocuments(repoRoot, [
        {
            fullPath: mapTarget.fullPath,
            content: prettyJson(mapPayload.document)
        },
        {
            fullPath: atlasTarget.fullPath,
            content: prettyJson(atlasPayload.document)
        }
    ]);

    return {
        ok: true,
        saved: [mapTarget.relativePath, atlasTarget.relativePath],
        atlas: 'maps/atlas-index.json',
        readiness: getPublishReadiness(repoRoot)
    };
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
            if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                request.destroy();
            }
        });
        request.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error('Request body must be valid JSON.'));
            }
        });
        request.on('error', reject);
    });
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(payload));
}

async function handleApiRequest(repoRoot, request, response, url, options = {}) {
    const authorizeWriteRequest = options.authorizeWriteRequest || isAllowedEditorWriteRequest;
    const isSaveAvailable = options.isSaveAvailable || (() => true);
    if (url.pathname === '/api/editor/status' && request.method === 'GET') {
        const saveEnabled = Boolean(isSaveAvailable(request));
        sendJson(response, 200, {
            ok: true,
            saveEnabled,
            message: saveEnabled
                ? 'Map editor save server is ready.'
                : 'Start an authorized Map Studio draft to enable saves.',
            readiness: getPublishReadiness(repoRoot)
        });
        return true;
    }

    if (url.pathname === '/api/editor/readiness' && request.method === 'GET') {
        sendJson(response, 200, {
            ok: true,
            readiness: getPublishReadiness(repoRoot)
        });
        return true;
    }

    if (url.pathname === '/api/editor/build-preview-status' && request.method === 'GET') {
        const jobId = String(url.searchParams.get('id') || '').trim();
        const job = findPreviewBuildJob(repoRoot, jobId);
        if (!job) {
            sendJson(response, 404, { ok: false, error: 'Preview build job was not found.' });
            return true;
        }
        sendJson(response, 200, serializePreviewBuildJob(job));
        return true;
    }

    if (url.pathname === '/api/editor/build-preview' && request.method === 'POST') {
        if (!authorizeWriteRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'Preview build request was not authorized.' });
            return true;
        }
        try {
            const job = startPreviewBuildJob(repoRoot);
            sendJson(response, 200, {
                ok: true,
                jobId: job.id,
                status: job.status,
                statusUrl: `/api/editor/build-preview-status?id=${encodeURIComponent(job.id)}`,
                step: job.step,
                steps: job.steps
            });
        } catch (error) {
            sendJson(response, 500, { ok: false, error: error.message || 'Could not build live preview.' });
        }
        return true;
    }

    if (url.pathname === '/api/editor/save-map' && request.method === 'POST') {
        if (!authorizeWriteRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'Editor save request was not authorized.' });
            return true;
        }
        try {
            const payload = await readRequestBody(request);
            sendJson(response, 200, saveMapDocument(repoRoot, payload));
        } catch (error) {
            sendJson(response, 400, { ok: false, error: error.message || 'Could not save map.' });
        }
        return true;
    }

    if (url.pathname === '/api/editor/save-workspace' && request.method === 'POST') {
        if (!authorizeWriteRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'Editor save request was not authorized.' });
            return true;
        }
        try {
            const payload = await readRequestBody(request);
            sendJson(response, 200, saveWorkspaceDocuments(repoRoot, payload));
        } catch (error) {
            sendJson(response, 400, { ok: false, error: error.message || 'Could not save editor changes.' });
        }
        return true;
    }

    if (url.pathname === '/api/editor/save-atlas' && request.method === 'POST') {
        if (!authorizeWriteRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'Atlas save request was not authorized.' });
            return true;
        }
        try {
            const payload = await readRequestBody(request);
            sendJson(response, 200, saveAtlasStructure(repoRoot, payload));
        } catch (error) {
            sendJson(response, 400, { ok: false, error: error.message || 'Could not save atlas structure.' });
        }
        return true;
    }

    if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { ok: false, error: 'Unknown API endpoint.' });
        return true;
    }

    return false;
}

function resolvePathUnderRoot(rootPath, relativePath) {
    const fullPath = path.resolve(rootPath, relativePath);
    if (!fullPath.startsWith(`${rootPath}${path.sep}`) && fullPath !== rootPath) {
        throw new Error(`Path escapes static root: ${relativePath}`);
    }
    return fullPath;
}

function resolveStaticRequestPathFromRoot(rootPath, urlPathname) {
    let decodedPathname;
    try {
        decodedPathname = decodeURIComponent(urlPathname || '/');
    } catch (error) {
        return null;
    }

    const requestedPath = decodedPathname === '/' ? '/index.html' : decodedPathname;
    const segments = requestedPath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.git' || segment === 'node_modules')) {
        return null;
    }

    const relativePath = path.normalize(`.${requestedPath}`);
    if (relativePath.startsWith('..')) return null;
    const fullPath = resolvePathUnderRoot(rootPath, relativePath);
    if (!fs.existsSync(fullPath)) return null;
    if (fs.statSync(fullPath).isDirectory()) {
        return resolvePathUnderRoot(rootPath, path.join(relativePath, 'index.html'));
    }
    return fullPath;
}

function resolveStaticRequestPath(repoRoot, urlPathname) {
    return resolveStaticRequestPathFromRoot(repoRoot, urlPathname);
}

function resolveEditorStaticRoot(repoRoot, staticRoot, urlPathname) {
    return String(urlPathname || '').startsWith('/maps/') ? repoRoot : staticRoot;
}

function resolvePreviewRequestPath(repoRoot, urlPathname) {
    if (!urlPathname.startsWith('/preview/')) return null;
    const distRoot = resolveRepoPath(repoRoot, 'dist');
    const previewPathname = urlPathname.slice('/preview'.length) || '/';
    return resolveStaticRequestPathFromRoot(distRoot, previewPathname);
}

function sendStaticFile(response, fullPath) {
    const extension = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';
    response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
    });
    fs.createReadStream(fullPath).pipe(response);
}

function createEditorServer(options = {}) {
    const initialRepoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..'));
    const staticRoot = path.resolve(options.staticRoot || initialRepoRoot);
    const getRepoRoot = typeof options.getRepoRoot === 'function'
        ? () => path.resolve(options.getRepoRoot())
        : () => initialRepoRoot;
    if (isGitWorkTree(getRepoRoot())) {
        recoverWriteTransactions(getRepoRoot());
        restorePreviewBuildJob(getRepoRoot());
    }
    const authorizeWriteRequest = options.authorizeWriteRequest || isAllowedEditorWriteRequest;
    const isSaveAvailable = options.isSaveAvailable || (() => true);
    return http.createServer(async (request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`}`);
        const repoRoot = getRepoRoot();

        if (await handleApiRequest(repoRoot, request, response, url, {
            authorizeWriteRequest,
            isSaveAvailable
        })) return;

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            sendJson(response, 405, { ok: false, error: 'Method not allowed.' });
            return;
        }

        if (url.pathname === '/preview') {
            response.writeHead(302, {
                Location: '/preview/',
                'Cache-Control': 'no-store'
            });
            response.end();
            return;
        }

        const previewPath = resolvePreviewRequestPath(repoRoot, url.pathname);
        if (previewPath && fs.existsSync(previewPath)) {
            if (request.method === 'HEAD') {
                response.writeHead(200, { 'Cache-Control': 'no-store' });
                response.end();
                return;
            }
            sendStaticFile(response, previewPath);
            return;
        }

        const requestRoot = resolveEditorStaticRoot(repoRoot, staticRoot, url.pathname);
        const fullPath = resolveStaticRequestPath(requestRoot, url.pathname);
        if (!fullPath || !fs.existsSync(fullPath)) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        if (request.method === 'HEAD') {
            response.writeHead(200, { 'Cache-Control': 'no-store' });
            response.end();
            return;
        }

        sendStaticFile(response, fullPath);
    });
}

function startEditorServer(options = {}) {
    const host = options.host || process.env.HOST || DEFAULT_HOST;
    const port = Number(options.port || process.env.PORT || DEFAULT_PORT);
    const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..'));

    assertLoopbackBindHost(host);

    const server = createEditorServer({ repoRoot });
    server.listen(port, host, () => {
        console.log(`Map editor running at http://${host}:${port}/map-editor.html`);
        console.log('Save buttons are enabled only from this local editor server.');
    });
    return server;
}

if (require.main === module) {
    try {
        startEditorServer();
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

module.exports = {
    DEFAULT_HOST,
    DEFAULT_PORT,
    assertLoopbackBindHost,
    buildLivePreview,
    classifyChangedFilePath,
    compareLiveSourcesToDist,
    completeWriteTransaction,
    createWriteTransaction,
    createEditorServer,
    getChangedFileGroups,
    getPublishReadiness,
    getPreviewBuildJobPath,
    hasRunningPreviewBuild,
    isAllowedEditorWriteRequest,
    isLoopbackHost,
    isSameOriginWriteRequest,
    getWriteTransactionRoot,
    recoverWriteTransactions,
    restorePreviewBuildJob,
    resolveEditorStaticRoot,
    resolvePreviewRequestPath,
    resolveMapTargetPath,
    saveAtlasStructure,
    saveMapDocument,
    saveWorkspaceDocuments,
    snapshotFile,
    startEditorServer,
    validateAtlasManifestDocument,
    validateMapDocument,
    writeWithValidation
};
