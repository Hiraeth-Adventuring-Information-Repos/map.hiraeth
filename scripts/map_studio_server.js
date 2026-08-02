#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
    createEditorServer,
    hasRunningPreviewBuild,
    isSameOriginWriteRequest
} = require('./editor_server.js');
const { createSessionManager } = require('./map_studio_auth.js');
const { createGitHubClient } = require('./map_studio_github.js');
const {
    finishMergedDraft,
    getWorkspaceState,
    publishDraft,
    startDraft
} = require('./map_studio_git.js');
const {
    createNewMapFromUpload,
    getManifestEntries,
    metadataFromHeaders,
    receiveUploadToTemporaryFile
} = require('./map_studio_maps.js');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8010;
const MAX_LOGIN_BODY_BYTES = 8 * 1024;

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

function createMapStudioServer(options = {}) {
    const repoRoot = path.resolve(options.repoRoot || process.env.MAP_STUDIO_REPO_ROOT || path.resolve(__dirname, '..'));
    const allowedHosts = parseAllowedHosts(options.allowedHosts || process.env.MAP_STUDIO_ALLOWED_HOSTS);
    if (allowedHosts.size === 0) {
        throw new Error('MAP_STUDIO_ALLOWED_HOSTS must list every hostname used to access Map Studio.');
    }

    const sessionManager = options.sessionManager || createSessionManager({
        password: options.password || process.env.MAP_STUDIO_PASSWORD,
        passwordFile: options.passwordFile || process.env.MAP_STUDIO_PASSWORD_FILE,
        secureCookies: options.secureCookies ?? process.env.MAP_STUDIO_SECURE_COOKIES !== 'false',
        sessionTtlMs: options.sessionTtlMs || process.env.MAP_STUDIO_SESSION_TTL_MS
    });
    const githubClient = options.githubClient || createGitHubClient(options.github || {});
    let publishJobCounter = 0;
    let publishJob = null;
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
            result: publishJob.result
        };
    }

    function startPublishJob(payload) {
        if (publishJob?.status === 'running') return publishJob;
        if (mapMutationRunning || editorMutationRunning || hasRunningPreviewBuild(repoRoot)) {
            throw new Error('Wait for the current map operation to finish before publishing.');
        }
        publishJob = {
            id: String(publishJobCounter += 1),
            status: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: '',
            output: [],
            error: '',
            result: null
        };
        const appendOutput = (chunk) => {
            String(chunk || '').split(/\r?\n/).filter(Boolean).forEach((line) => {
                publishJob.output.push(line.slice(0, 1000));
            });
            if (publishJob.output.length > 400) publishJob.output.splice(0, publishJob.output.length - 400);
        };
        publishDraft({
            repoRoot,
            title: payload.title,
            description: payload.description,
            githubClient,
            onOutput: appendOutput
        }).then((result) => {
            publishJob.status = 'complete';
            publishJob.result = result;
            publishJob.finishedAt = new Date().toISOString();
        }).catch((error) => {
            publishJob.status = 'failed';
            publishJob.error = error.message || String(error);
            publishJob.finishedAt = new Date().toISOString();
        });
        return publishJob;
    }

    const authorizeStudioWrite = (request) => {
        const session = sessionManager.authenticate(request);
        let activeDraft = false;
        try {
            activeDraft = getWorkspaceState(repoRoot, githubClient.getConfiguration()).activeDraft;
        } catch (error) {
            activeDraft = false;
        }
        return Boolean(
            session &&
            activeDraft &&
            !mapMutationRunning &&
            !hasRunningPreviewBuild(repoRoot) &&
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
            return getWorkspaceState(repoRoot, githubClient.getConfiguration()).activeDraft;
        } catch (error) {
            return false;
        }
    };
    const editorServer = createEditorServer({
        repoRoot,
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
                ? { ok: true, authenticated: true, csrfToken: session.csrfToken }
                : { ok: true, authenticated: false });
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
                    workspace: getWorkspaceState(repoRoot, githubClient.getConfiguration()),
                    publishJob: serializePublishJob()
                });
            } catch (error) {
                sendJson(response, 500, { ok: false, error: error.message || 'Could not inspect the workspace.' });
            }
            return;
        }

        if (url.pathname === '/api/studio/map-options' && request.method === 'GET') {
            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'maps', 'maps.json'), 'utf8'));
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

        if (url.pathname === '/api/studio/drafts' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Draft request was not authorized.' });
                return;
            }
            try {
                const body = await readJsonBody(request);
                const title = String(body.title || '').trim();
                if (!title) throw new Error('A draft title is required.');
                const workspace = await startDraft({ repoRoot, title, githubClient });
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
                if (publishJob?.status === 'running' || mapMutationRunning || editorMutationRunning || hasRunningPreviewBuild(repoRoot)) {
                    throw new Error('Wait for the current Studio operation to finish.');
                }
                const workspace = await finishMergedDraft({ repoRoot, githubClient });
                sendJson(response, 200, { ok: true, workspace });
            } catch (error) {
                sendJson(response, 409, { ok: false, error: error.message || 'Could not finish the draft.' });
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

        if (url.pathname === '/api/studio/maps' && request.method === 'POST') {
            if (!isSameOriginWriteRequest(request) || !sessionManager.hasValidCsrf(request, session)) {
                sendJson(response, 403, { ok: false, error: 'Map upload request was not authorized.' });
                return;
            }
            let workspace;
            try {
                workspace = getWorkspaceState(repoRoot, githubClient.getConfiguration());
            } catch (error) {
                sendJson(response, 500, { ok: false, error: error.message || 'Could not inspect the workspace.' });
                return;
            }
            if (!workspace.activeDraft) {
                sendJson(response, 409, { ok: false, error: 'Start a Map Studio draft before adding a map.' });
                return;
            }
            if (mapMutationRunning || editorMutationRunning || publishJob?.status === 'running' || hasRunningPreviewBuild(repoRoot)) {
                sendJson(response, 409, { ok: false, error: 'Another map or publication operation is already running.' });
                return;
            }

            mapMutationRunning = true;
            let upload = null;
            try {
                const metadata = metadataFromHeaders(request.headers);
                upload = await receiveUploadToTemporaryFile(request);
                const result = createNewMapFromUpload({
                    repoRoot,
                    uploadPath: upload.uploadPath,
                    metadata
                });
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
            url.pathname === '/api/editor/save-atlas'
        );
        if (isEditorMutation) {
            if (editorMutationRunning || mapMutationRunning || publishJob?.status === 'running' || hasRunningPreviewBuild(repoRoot)) {
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
    startMapStudioServer
};
