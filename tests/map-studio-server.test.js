const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createMapStudioServer, restorePublishJob } = require('../scripts/map_studio_server.js');

(async () => {
    const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-studio-publish-job-test-'));
    const recoveryPath = path.join(recoveryRoot, 'publish-job.json');
    fs.writeFileSync(recoveryPath, `${JSON.stringify({
        version: 1,
        job: {
            id: 'publish-1',
            branch: 'map-studio/recovery-test',
            status: 'running',
            startedAt: '2026-08-04T00:00:00.000Z',
            output: ['Validation started'],
            payload: { title: 'Recovery test', description: '' }
        }
    })}\n`);
    const recoveredJob = restorePublishJob(recoveryPath);
    assert.equal(recoveredJob.status, 'interrupted');
    assert.match(recoveredJob.error, /Resume it/);
    assert.equal(JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).job.status, 'interrupted');
    fs.rmSync(recoveryRoot, { recursive: true, force: true });

    const repoRoot = path.resolve(__dirname, '..');
    const session = { csrfToken: 'test-csrf' };
    const sessionManager = {
        authenticate: () => session,
        hasValidCsrf: (_request, candidate) => candidate === session,
        login: () => ({ ok: false }),
        logout: () => {},
        getExpiredCookie: () => '',
        getSessionCookie: () => ''
    };
    const githubClient = {
        getConfiguration: () => ({ configured: false, mode: 'none' }),
        verifyConfiguration: async () => ({
            ok: false,
            status: 'not-configured',
            message: 'GitHub publishing setup is incomplete.',
            remediation: ['Configure a repository-scoped credential.']
        })
    };
    let state = {
        branch: '',
        mode: 'base',
        editable: false,
        activeDraft: false,
        changedPaths: [],
        capabilities: { canStartDraft: true }
    };
    let startedTitle = '';
    let abandonedBranch = '';
    const workspaceManager = {
        getWorkspaceRoot: () => repoRoot,
        getState: () => state,
        startDraft: async (title) => {
            startedTitle = title;
            state = {
                branch: 'map-studio/test-draft',
                draft: { branch: 'map-studio/test-draft' },
                mode: 'studio-draft',
                editable: true,
                activeDraft: true,
                changedPaths: [],
                capabilities: { canEdit: true, canAbandonDraft: true }
            };
            return state;
        },
        abandonDraft: (confirmBranch) => {
            abandonedBranch = confirmBranch;
            state = {
                branch: '',
                mode: 'base',
                editable: false,
                activeDraft: false,
                changedPaths: [],
                capabilities: { canStartDraft: true }
            };
            return state;
        },
        finishDraft: async () => state
    };

    const server = createMapStudioServer({
        repoRoot,
        allowedHosts: '127.0.0.1',
        secureCookies: false,
        sessionManager,
        githubClient,
        workspaceManager
    });
    function request(method, pathname, body) {
        return new Promise((resolve, reject) => {
            const encoded = body === undefined ? '' : JSON.stringify(body);
            const incoming = Readable.from(encoded ? [encoded] : []);
            incoming.method = method;
            incoming.url = pathname;
            incoming.headers = {
                host: '127.0.0.1:8010',
                origin: 'http://127.0.0.1:8010',
                'x-csrf-token': 'test-csrf',
                ...(encoded ? {
                    'content-type': 'application/json',
                    'content-length': String(Buffer.byteLength(encoded))
                } : {})
            };

            const response = new EventEmitter();
            response.headers = {};
            response.statusCode = 200;
            response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; };
            response.writeHead = (status, headers = {}) => {
                response.statusCode = status;
                Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
            };
            response.end = (responseBody = '') => {
                try {
                    resolve({
                        status: response.statusCode,
                        payload: JSON.parse(String(responseBody))
                    });
                } catch (error) {
                    reject(error);
                }
            };
            server.emit('request', incoming, response);
        });
    }

    const initial = await request('GET', '/api/studio/workspace');
    assert.equal(initial.status, 200);
    assert.equal(initial.payload.workspace.mode, 'base');

    const githubCheck = await request('GET', '/api/studio/github/check');
    assert.equal(githubCheck.status, 200);
    assert.equal(githubCheck.payload.result.status, 'not-configured');
    assert.deepEqual(githubCheck.payload.result.remediation, ['Configure a repository-scoped credential.']);

    const started = await request('POST', '/api/studio/drafts', { title: 'Server draft' });
    assert.equal(started.status, 200);
    assert.equal(startedTitle, 'Server draft');
    assert.equal(started.payload.workspace.activeDraft, true);

    const mapPlan = await request('POST', '/api/studio/maps/plan', {
        id: 'server-plan-audit',
        name: 'Server Plan Audit',
        artworkContentType: 'image/webp'
    });
    assert.equal(mapPlan.status, 200);
    assert.equal(mapPlan.payload.plan.files[0].path, 'maps/server-plan-audit.webp');
    assert.equal(mapPlan.payload.plan.files.at(-1).action, 'Regenerate');

    const abandoned = await request('POST', '/api/studio/drafts/abandon', {
        confirmBranch: 'map-studio/test-draft'
    });
    assert.equal(abandoned.status, 200);
    assert.equal(abandonedBranch, 'map-studio/test-draft');
    assert.equal(abandoned.payload.workspace.mode, 'base');

    console.log('map studio server workspace routing checks passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
