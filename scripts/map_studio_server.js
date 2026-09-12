#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
    createEditorServer,
    hasRunningPreviewBuild,
    isSameOriginWriteRequest
} = require('./editor_server.js');
const { createLocalSessionManager, createSessionManager } = require('./map_studio_auth.js');
const { createGitHubClient } = require('./map_studio_github.js');
const { publishDraft } = require('./map_studio_git.js');
const { createStudioWorkspaceManager } = require('./map_studio_workspace.js');
const {
    createNewMapFromUpload,
    getManifestEntries,
    metadataFromHeaders,
    planNewMapCreation,
    prepareMapArtwork,
    receiveUploadToTemporaryFile
} = require('./map_studio_maps.js');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8010;
const MAX_LOGIN_BODY_BYTES = 8 * 1024;
const PUBLISH_JOB_STATE_VERSION = 1;

function sendJson(response, statusCode, payload, extraHeaders = {}) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
    response.writeHead(statusCode, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
    });
    response.end(body);
}

function normalizeHostname(hostHeader) {
    const raw = String(hostHeader || '').trim();
    if (!raw) return '';
    try {
        return new URL(`http://${raw}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    } catch (error) {
        return '';
    }
}

function parseAllowedHosts(value) {
    return new Set(String(value || '')
        .split(',')
        .map((host) => host.trim().toLowerCase().replace(/^\[|\]$/g, ''))
        .filter(Boolean));
}

function isAllowedHost(request, allowedHosts) {
    const hostname = normalizeHostname(request.headers.host);
    return Boolean(hostname && allowedHosts.has(hostname));
}

function applySecurityHeaders(response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'"
    );
}

function readJsonBody(request, limit = MAX_LOGIN_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
            if (Buffer.byteLength(body, 'utf8') > limit) {
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

function sendFile(response, fullPath, contentType) {
    response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
    });
    fs.createReadStream(fullPath).pipe(response);
}

function serveStudioEditor(repoRoot, response) {
    const editorPath = path.join(repoRoot, 'map-editor.html');
    const source = fs.readFileSync(editorPath, 'utf8');
    const withBase = source.replace('<head>', '<head>\n    <base href="/">');
    sendText(response, 200, withBase, 'text/html; charset=utf-8');
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
}

function restorePublishJob(jobPath) {
    if (!fs.existsSync(jobPath)) return null;
    try {
        const payload = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
        if (payload?.version !== PUBLISH_JOB_STATE_VERSION || !payload.job?.id) {
            throw new Error('Publication job record uses an unsupported format.');
        }
        const job = {
            id: String(payload.job.id),
            branch: String(payload.job.branch || ''),
            status: String(payload.job.status || 'failed'),
            startedAt: String(payload.job.startedAt || ''),
            finishedAt: String(payload.job.finishedAt || ''),
            output: Array.isArray(payload.job.output) ? payload.job.output.map(String).slice(-400) : [],
            error: String(payload.job.error || ''),
            result: payload.job.result || null,
            payload: {
                title: String(payload.job.payload?.title || ''),
                description: String(payload.job.payload?.description || '')
            }
        };
        if (job.status === 'running') {
            job.status = 'interrupted';
            job.finishedAt = new Date().toISOString();
            job.error = 'Publication was interrupted by a Studio restart. Resume it to reuse any validated commit and existing pull request.';
            writeJsonAtomic(jobPath, { version: PUBLISH_JOB_STATE_VERSION, job });
        }
        return job;
    } catch (error) {
        return {
            id: 'publish-job-recovery-error',
            branch: '',
            status: 'failed',
            startedAt: '',
            finishedAt: new Date().toISOString(),
            output: [],
            error: 'The saved publication status could not be read. Dismiss it before starting another publication.',
            result: null,
            payload: { title: '', description: '' }
        };
    }
}

function createMapStudioServer(options = {}) {
    const repoRoot = path.resolve(options.repoRoot || process.env.MAP_STUDIO_REPO_ROOT || path.resolve(__dirname, '..'));
    const draftsRoot = path.resolve(
        options.draftsRoot ||
        process.env.MAP_STUDIO_DRAFTS_ROOT ||
        path.join(repoRoot, '.cache', 'map-studio-drafts')
    );
    const allowedHosts = parseAllowedHosts(options.allowedHosts || process.env.MAP_STUDIO_ALLOWED_HOSTS);
    if (allowedHosts.size === 0) {
        throw new Error('MAP_STUDIO_ALLOWED_HOSTS must list every hostname used to access Map Studio.');
    }

    const authenticationDisabled = options.authenticationDisabled ?? process.env.MAP_STUDIO_AUTH_DISABLED === 'true';
    const sessionManager = options.sessionManager || (authenticationDisabled
        ? createLocalSessionManager()
        : createSessionManager({
            password: options.password || process.env.MAP_STUDIO_PASSWORD,
            passwordFile: options.passwordFile || process.env.MAP_STUDIO_PASSWORD_FILE,
            secureCookies: options.secureCookies ?? process.env.MAP_STUDIO_SECURE_COOKIES !== 'false',
            sessionTtlMs: options.sessionTtlMs || process.env.MAP_STUDIO_SESSION_TTL_MS
        }));
    const githubClient = options.githubClient || createGitHubClient(options.github || {});
    const workspaceManager = options.workspaceManager || createStudioWorkspaceManager({
        baseRepoRoot: repoRoot,
        draftsRoot,
        dependencyRoot: options.dependencyRoot || process.env.MAP_STUDIO_NODE_MODULES_ROOT,
        githubClient
    });
    const publishDraftOperation = options.publishDraft || publishDraft;
    const getWorkspaceRoot = () => workspaceManager.getWorkspaceRoot();
    const publishJobPath = path.join(draftsRoot, 'jobs', 'publish-job.json');
    let publishJob = restorePublishJob(publishJobPath);
    let mapMutationRunning = false;
    let editorMutationRunning = false;

    function serializePublishJob() {
        if (!publishJob) return null;
        return {
            id: publishJob.id,
            status: publishJob.status,
            startedAt: publishJob.startedAt,
            finishedAt: publishJob.finishedAt,
            recentOutput: publishJob.output.slice(-80),
            error: publishJob.error,
            result: publishJob.result,
            canResume: Boolean(publishJob.payload?.title) && (
                publishJob.status === 'interrupted' || publishJob.status === 'failed'
            ),
            canDismiss: publishJob.status !== 'running'
        };
    }

    function persistPublishJob() {
        if (!publishJob) {
            fs.rmSync(publishJobPath, { force: true });
            return;
        }
        writeJsonAtomic(publishJobPath, {
            version: PUBLISH_JOB_STATE_VERSION,
            job: publishJob
        });
    }

    function clearPublishJob() {
        if (publishJob?.status === 'running') {
            throw new Error('Wait for publication to finish before dismissing it.');
        }
        publishJob = null;
        persistPublishJob();
    }

    function startPublishJob(payload, options = {}) {
        if (publishJob?.status === 'running') return publishJob;
        const workspaceRoot = getWorkspaceRoot();
        if (mapMutationRunning || editorMutationRunning || hasRunningPreviewBuild(workspaceRoot)) {
            throw new Error('Wait for the current map operation to finish before publishing.');
        }
        const workspace = workspaceManager.getState();
        const resume = options.resume === true;
        if (resume) {
            if (!publishJob || !['interrupted', 'failed'].includes(publishJob.status)) {
                throw new Error('There is no interrupted publication to resume.');
            }
            if (!publishJob.payload.title) throw new Error('The interrupted publication is missing its title.');
            if (publishJob.branch && publishJob.branch !== workspace.branch) {
                throw new Error(`The interrupted publication belongs to ${publishJob.branch}, not ${workspace.branch || 'the current workspace'}.`);
            }
            payload = publishJob.payload;
        }
        publishJob = {
            id: resume ? publishJob.id : `${Date.now()}-${process.pid}`,
            branch: workspace.branch,
            status: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: '',
            output: resume ? [...publishJob.output, 'Resuming interrupted publication.'] : [],
            error: '',
            result: null,
            payload: {
                title: String(payload.title || ''),
                description: String(payload.description || '')
            }
        };
        persistPublishJob();
        const appendOutput = (chunk) => {
            String(chunk || '').split(/\r?\n/).filter(Boolean).forEach((line) => {
                publishJob.output.push(line.slice(0, 1000));
            });
            if (publishJob.output.length > 400) publishJob.output.splice(0, publishJob.output.length - 400);
            persistPublishJob();
        };
        publishDraftOperation({
            repoRoot: workspaceRoot,
            title: payload.title,
            description: payload.description,
            githubClient,
            onOutput: appendOutput,
            resume
        }).then((result) => {
            publishJob.status = 'complete';
            publishJob.result = result;
            publishJob.finishedAt = new Date().toISOString();
            persistPublishJob();
        }).catch((error) => {
            publishJob.status = 'failed';
            publishJob.error = error.message || String(error);
            publishJob.finishedAt = new Date().toISOString();
            persistPublishJob();
        });
        return publishJob;
    }

    const authorizeStudioWrite = (request) => {
        const session = sessionManager.authenticate(request);
        let editable = false;
        try {
            editable = workspaceManager.getState().editable;
        } catch (error) {
            editable = false;
        }
        const workspaceRoot = getWorkspaceRoot();
        return Boolean(
            session &&
            editable &&
            !mapMutationRunning &&
            !hasRunningPreviewBuild(workspaceRoot) &&
            publishJob?.status !== 'running' &&
            isAllowedHost(request, allowedHosts) &&
            isSameOriginWriteRequest(request) &&
            sessionManager.hasValidCsrf(request, session)
        );
    };
    const isStudioSaveAvailable = (request) => {
        const session = sessionManager.authenticate(request);
        if (!session || !isAllowedHost(request, allowedHosts)) return false;
        try {
            return workspaceManager.getState().editable;
        } catch (error) {
            return false;
        }
    };
    const editorServer = createEditorServer({
        repoRoot,
        staticRoot: repoRoot,
        getRepoRoot: getWorkspaceRoot,
        authorizeWriteRequest: authorizeStudioWrite,
        isSaveAvailable: isStudioSaveAvailable
    });

    return http.createServer(async (request, response) => {
        applySecurityHeaders(response);
        if (!isAllowedHost(request, allowedHosts)) {
            sendText(response, 421, 'Unrecognized Map Studio host.');
            return;
        }

        const url = new URL(request.url || '/', `http://${request.headers.host}`);
        const session = sessionManager.authenticate(request);

        if (url.pathname === '/healthz' && request.method === 'GET') {
            sendJson(response, 200, { ok: true, service: 'hiraeth-map-studio' });
            return;
        }

        if (url.pathname === '/api/studio/session' && request.method === 'GET') {
            sendJson(response, 200, session
                ? {
                    ok: true,
                    authenticated: true,
                    authenticationRequired: sessionManager.authenticationDisabled !== true,
                    csrfToken: session.csrfToken
                }
                : { ok: true, authenticated: false, authenticationRequired: true });
            return;
        }

        if (url.pathname === '/api/studio/login' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request)) {
                sendJson(response, 403, { ok: false, error: 'Login request origin was not accepted.' });
                return;
            }
            try {
                const body = await readJsonBody(request);
                const result = sessionManager.login(request, body.password);
                if (!result.ok) {
                    sendJson(response, result.rateLimited ? 429 : 401, {
                        ok: false,
                        error: result.rateLimited
                            ? 'Too many sign-in attempts. Try again later.'
                            : 'Incorrect password.'
                    });
                    return;
                }
                sendJson(response, 200, {
                    ok: true,
                    authenticated: true,
                    csrfToken: result.session.csrfToken
                }, { 'Set-Cookie': sessionManager.getSessionCookie(result.session) });
            } catch (error) {
                sendJson(response, 400, { ok: false, error: error.message || 'Could not sign in.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/logout' && request.method === 'POST') {
            if (!session || !isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Logout request was not authorized.' });
                return;
            }
            sessionManager.logout(request);
            sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionManager.getExpiredCookie() });
            return;
        }

        const publicStudioAssets = new Map([
            ['/studio', ['map-studio.html', 'text/html; charset=utf-8']],
            ['/studio/', ['map-studio.html', 'text/html; charset=utf-8']],
            ['/css/map-studio.css', ['css/map-studio.css', 'text/css; charset=utf-8']],
            ['/js/map-studio-model.js', ['js/map-studio-model.js', 'text/javascript; charset=utf-8']],
            ['/js/map-studio.js', ['js/map-studio.js', 'text/javascript; charset=utf-8']]
        ]);
        if (request.method === 'GET' && publicStudioAssets.has(url.pathname)) {
            const [relativePath, contentType] = publicStudioAssets.get(url.pathname);
            sendFile(response, path.join(repoRoot, relativePath), contentType);
            return;
        }

        if (!session) {
            if (url.pathname.startsWith('/api/')) {
                sendJson(response, 401, { ok: false, error: 'Sign in to Map Studio.' });
            } else {
                response.writeHead(302, { Location: '/studio', 'Cache-Control': 'no-store' });
                response.end();
            }
            return;
        }

        if (url.pathname === '/api/studio/workspace' && request.method === 'GET') {
            try {
                sendJson(response, 200, {
                    ok: true,
                    workspace: workspaceManager.getState(),
                    publishJob: serializePublishJob()
                });
            } catch (error) {
                sendJson(response, 500, { ok: false, error: error.message || 'Could not inspect the workspace.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/github/check' && request.method === 'GET') {
            try {
                const result = await githubClient.verifyConfiguration();
                sendJson(response, 200, { ok: true, result });
            } catch (error) {
                sendJson(response, 500, {
                    ok: false,
                    error: error.message || 'Could not check GitHub publishing access.'
                });
            }
            return;
        }

        if (url.pathname === '/api/studio/map-options' && request.method === 'GET') {
            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(getWorkspaceRoot(), 'maps', 'maps.json'), 'utf8'));
                const entries = getManifestEntries(manifest);
                sendJson(response, 200, {
                    ok: true,
                    parents: entries.map((entry) => ({
                        id: String(entry.id || ''),
                        name: String(entry.name || entry.id || ''),
                        parentId: String(entry.parentId || ''),
                        type: String(entry.type || '')
                    }))
                });
            } catch (error) {
                sendJson(response, 500, { ok: false, error: error.message || 'Could not load map parents.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/maps/plan' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Map plan request was not authorized.' });
                return;
            }
            try {
                const workspace = workspaceManager.getState();
                if (!workspace.editable) {
                    throw new Error('Start a draft before planning a new map.');
                }
                const metadata = await readJsonBody(request);
                const plan = planNewMapCreation({ repoRoot: getWorkspaceRoot(), metadata });
                sendJson(response, 200, { ok: true, plan });
            } catch (error) {
                sendJson(response, 400, { ok: false, error: error.message || 'Could not plan the map.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/drafts' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Draft request was not authorized.' });
                return;
            }
            try {
                const body = await readJsonBody(request);
                const title = String(body.title || '').trim();
                if (!title) throw new Error('A draft title is required.');
                const workspace = await workspaceManager.startDraft(title);
                sendJson(response, 200, { ok: true, workspace });
            } catch (error) {
                sendJson(response, 400, { ok: false, error: error.message || 'Could not start the draft.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/drafts/finish' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Finish-draft request was not authorized.' });
                return;
            }
            try {
                if (publishJob?.status === 'running' || mapMutationRunning || editorMutationRunning || hasRunningPreviewBuild(getWorkspaceRoot())) {
                    throw new Error('Wait for the current Studio operation to finish.');
                }
                const workspace = await workspaceManager.finishDraft();
                clearPublishJob();
                sendJson(response, 200, { ok: true, workspace });
            } catch (error) {
                sendJson(response, 409, { ok: false, error: error.message || 'Could not finish the draft.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/drafts/abandon' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Abandon-draft request was not authorized.' });
                return;
            }
            try {
                if (publishJob?.status === 'running' || mapMutationRunning || editorMutationRunning || hasRunningPreviewBuild(getWorkspaceRoot())) {
                    throw new Error('Wait for the current Studio operation to finish.');
                }
                const body = await readJsonBody(request);
                const workspace = workspaceManager.abandonDraft(String(body.confirmBranch || ''));
                clearPublishJob();
                sendJson(response, 200, { ok: true, workspace });
            } catch (error) {
                sendJson(response, 409, { ok: false, error: error.message || 'Could not abandon the draft.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/publish' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Publish request was not authorized.' });
                return;
            }
            try {
                const body = await readJsonBody(request);
                const title = String(body.title || '').trim();
                if (!title) throw new Error('A pull request title is required.');
                const job = startPublishJob({
                    title,
                    description: String(body.description || '').trim()
                });
                sendJson(response, 202, { ok: true, publishJob: serializePublishJob(job) });
            } catch (error) {
                sendJson(response, 400, { ok: false, error: error.message || 'Could not start publication.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/publish/resume' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Resume-publication request was not authorized.' });
                return;
            }
            try {
                const job = startPublishJob({}, { resume: true });
                sendJson(response, 202, { ok: true, publishJob: serializePublishJob(job) });
            } catch (error) {
                sendJson(response, 409, { ok: false, error: error.message || 'Could not resume publication.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/publish/dismiss' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Dismiss-publication request was not authorized.' });
                return;
            }
            try {
                clearPublishJob();
                sendJson(response, 200, { ok: true, publishJob: null });
            } catch (error) {
                sendJson(response, 409, { ok: false, error: error.message || 'Could not dismiss publication.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/maps' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Map upload request was not authorized.' });
                return;
            }
            let workspace;
            try {
                workspace = workspaceManager.getState();
            } catch (error) {
                sendJson(response, 500, { ok: false, error: error.message || 'Could not inspect the workspace.' });
                return;
            }
            if (!workspace.editable) {
                sendJson(response, 409, { ok: false, error: 'Start a draft or switch to a working branch before adding a map.' });
                return;
            }
            const workspaceRoot = getWorkspaceRoot();
            if (mapMutationRunning || editorMutationRunning || publishJob?.status === 'running' || hasRunningPreviewBuild(workspaceRoot)) {
                sendJson(response, 409, { ok: false, error: 'Another map or publication operation is already running.' });
                return;
            }

            mapMutationRunning = true;
            let upload = null;
            try {
                const metadata = metadataFromHeaders(request.headers);
                upload = await receiveUploadToTemporaryFile(request);
                const preparedArtwork = prepareMapArtwork({
                    uploadPath: upload.uploadPath,
                    contentType: upload.contentType
                });
                const result = createNewMapFromUpload({
                    repoRoot: workspaceRoot,
                    uploadPath: preparedArtwork.artworkPath,
                    metadata
                });
                result.artwork = {
                    converted: preparedArtwork.converted,
                    preprocessing: preparedArtwork.preprocessing
                };
                sendJson(response, 201, { ok: true, result });
            } catch (error) {
                sendJson(response, 400, { ok: false, error: error.message || 'Could not create the map.' });
            } finally {
                if (upload) upload.cleanup();
                mapMutationRunning = false;
            }
            return;
        }

        if (url.pathname === '/api/studio/publish-status' && request.method === 'GET') {
            sendJson(response, publishJob ? 200 : 404, publishJob
                ? { ok: true, publishJob: serializePublishJob() }
                : { ok: false, error: 'No publication job has been started.' });
            return;
        }

        if (url.pathname === '/studio/editor' && request.method === 'GET') {
            serveStudioEditor(repoRoot, response);
            return;
        }

        if (url.pathname.startsWith('/api/studio/')) {
            sendJson(response, 404, { ok: false, error: 'Unknown Map Studio endpoint.' });
            return;
        }

        const isEditorMutation = request.method === 'POST' && (
            url.pathname === '/api/editor/save-map' ||
            url.pathname === '/api/editor/save-atlas' ||
            url.pathname === '/api/editor/save-workspace'
        );
        if (isEditorMutation) {
            if (editorMutationRunning || mapMutationRunning || publishJob?.status === 'running' || hasRunningPreviewBuild(getWorkspaceRoot())) {
                sendJson(response, 409, { ok: false, error: 'Another Studio operation is already running.' });
                return;
            }
            editorMutationRunning = true;
            const releaseEditorMutation = () => { editorMutationRunning = false; };
            response.once('finish', releaseEditorMutation);
            response.once('close', releaseEditorMutation);
        }

        editorServer.emit('request', request, response);
    });
}

function startMapStudioServer(options = {}) {
    const host = options.host || process.env.HOST || DEFAULT_HOST;
    const port = Number(options.port || process.env.PORT || DEFAULT_PORT);
    const server = createMapStudioServer(options);
    server.listen(port, host, () => {
        console.log(`Hiraeth Map Studio running at http://${host}:${port}/studio`);
    });
    return server;
}

if (require.main === module) {
    try {
        startMapStudioServer();
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

module.exports = {
    applySecurityHeaders,
    createMapStudioServer,
    isAllowedHost,
    normalizeHostname,
    parseAllowedHosts,
    readJsonBody,
    restorePublishJob,
    startMapStudioServer
};
