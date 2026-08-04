const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const STUDIO_PASSWORD = 'studio-e2e-password';

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, ...(options.env || {}) }
    });
    if (result.error || result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || result.stdout || result.error?.message).trim()}`);
    }
    return String(result.stdout || '').trim();
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copy(sourceRoot, fixtureRoot, relativePath) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
}

function writeFixtureScripts(repoRoot) {
    const scriptsRoot = path.join(repoRoot, 'scripts');
    fs.mkdirSync(scriptsRoot, { recursive: true });
    fs.writeFileSync(path.join(scriptsRoot, 'generate_atlas_index.js'), `
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'maps/maps.json'), 'utf8'));
const entries = Array.isArray(manifest) ? manifest : manifest.maps;
const tree = entries.map((entry) => ({
    ...entry,
    ...JSON.parse(fs.readFileSync(path.join(root, entry.dataUrl), 'utf8')),
    dataUrl: entry.dataUrl
}));
fs.writeFileSync(path.join(root, 'maps/atlas-index.json'), JSON.stringify({ generatedAt: 'fixture', tree, searchIndex: [] }, null, 2) + '\\n');
console.log('fixture atlas generated');
`);
    fs.writeFileSync(path.join(scriptsRoot, 'validate_map_data.js'), `
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'maps/maps.json'), 'utf8'));
const entries = Array.isArray(manifest) ? manifest : manifest.maps;
if (!Array.isArray(entries) || entries.length === 0) throw new Error('Fixture manifest is empty.');
for (const entry of entries) JSON.parse(fs.readFileSync(path.join(root, entry.dataUrl), 'utf8'));
JSON.parse(fs.readFileSync(path.join(root, 'maps/atlas-index.json'), 'utf8'));
console.log('fixture map data valid');
`);
    fs.writeFileSync(path.join(scriptsRoot, 'build_pages.js'), `
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const relativePath of ['index.html', 'site.config.json', 'css', 'js', 'images', 'sounds', 'maps']) {
    const source = path.join(root, relativePath);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(dist, relativePath), { recursive: true });
}
console.log('fixture Pages bundle built');
`);
    fs.writeFileSync(path.join(scriptsRoot, 'publish_check.js'), `
console.log('fixture publish check passed');
`);
}

function createFixture({ sourceRoot, fixtureRoot }) {
    const repoRoot = path.join(fixtureRoot, 'base');
    const originRoot = path.join(fixtureRoot, 'origin.git');
    const draftsRoot = path.join(fixtureRoot, 'drafts');
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.mkdirSync(repoRoot, { recursive: true });

    for (const relativePath of [
        'map-studio.html',
        'map-editor.html',
        'index.html',
        'site.config.json',
        'css',
        'js',
        'images',
        'sounds',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon.png',
        'apple-touch-icon.png'
    ]) copy(sourceRoot, repoRoot, relativePath);

    fs.mkdirSync(path.join(repoRoot, 'maps'), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, 'maps/OLD-CONT.mini.webp'), path.join(repoRoot, 'maps/base-map.webp'));
    writeJson(path.join(repoRoot, 'maps/base-map.json'), {
        id: 'base-map',
        name: 'Base Map',
        width: 512,
        height: 403,
        imageUrl: 'maps/base-map.webp',
        pointsOfInterest: [],
        regions: [],
        lines: []
    });
    writeJson(path.join(repoRoot, 'maps/maps.json'), [
        { id: 'base-map', order: 0, name: 'Base Map', dataUrl: 'maps/base-map.json' }
    ]);
    writeFixtureScripts(repoRoot);
    run(process.execPath, ['scripts/generate_atlas_index.js'], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'node_modules\ndist/\n.cache/\n');

    run('git', ['init', '-b', 'main'], { cwd: repoRoot });
    run('git', ['config', 'user.name', 'Map Studio E2E'], { cwd: repoRoot });
    run('git', ['config', 'user.email', 'map-studio-e2e@example.invalid'], { cwd: repoRoot });
    run('git', ['add', '.'], { cwd: repoRoot });
    run('git', ['commit', '-m', 'Create browser fixture'], { cwd: repoRoot });
    run('git', ['init', '--bare', originRoot]);
    run('git', ['remote', 'add', 'origin', originRoot], { cwd: repoRoot });
    run('git', ['push', '-u', 'origin', 'main'], { cwd: repoRoot });

    return { repoRoot, originRoot, draftsRoot };
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close((error) => error ? reject(error) : resolve(address.port));
        });
    });
}

function waitForHealth(baseUrl, child, timeoutMs = 15_000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (child.exitCode !== null) {
                reject(new Error(`Fixture server exited with code ${child.exitCode}.`));
                return;
            }
            http.get(`${baseUrl}/healthz`, (response) => {
                response.resume();
                if (response.statusCode === 200) {
                    resolve();
                    return;
                }
                retry();
            }).on('error', retry);
        };
        const retry = () => {
            if (Date.now() - startedAt >= timeoutMs) {
                reject(new Error(`Fixture server did not become healthy at ${baseUrl}.`));
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}

function startFixtureServer({ sourceRoot, repoRoot, draftsRoot, originRoot, port }) {
    const child = spawn(process.execPath, [__filename, 'serve'], {
        cwd: sourceRoot,
        env: {
            ...process.env,
            MAP_STUDIO_E2E_SOURCE_ROOT: sourceRoot,
            MAP_STUDIO_E2E_REPO_ROOT: repoRoot,
            MAP_STUDIO_E2E_DRAFTS_ROOT: draftsRoot,
            MAP_STUDIO_E2E_ORIGIN_ROOT: originRoot,
            MAP_STUDIO_E2E_PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.getOutput = () => output;
    return child;
}

function stopFixtureServer(child) {
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
        }, 5_000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

function createFakeGitHubClient(originRoot, draftsRoot) {
    const statePath = path.join(draftsRoot, 'fake-github.json');
    const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { pullRequests: [] };
    const writeState = (state) => writeJson(statePath, state);
    return {
        getConfiguration: () => ({
            configured: true,
            mode: 'fixture',
            owner: 'hiraeth-e2e',
            repo: 'map-fixture',
            setup: { remediation: [] }
        }),
        getToken: async () => 'fixture-token',
        verifyConfiguration: async () => ({
            ok: true,
            status: 'ready',
            message: 'Fixture GitHub connection is ready.',
            remediation: []
        }),
        findOpenPullRequest: async ({ branch }) => readState().pullRequests.find((pullRequest) => pullRequest.branch === branch) || null,
        createDraftPullRequest: async ({ branch, title }) => {
            const state = readState();
            const pullRequest = {
                branch,
                title,
                number: state.pullRequests.length + 1,
                html_url: `https://example.invalid/hiraeth-e2e/map-fixture/pull/${state.pullRequests.length + 1}`
            };
            state.pullRequests.push(pullRequest);
            writeState(state);
            const commit = run('git', ['--git-dir', originRoot, 'rev-parse', `refs/heads/${branch}`]);
            run('git', ['--git-dir', originRoot, 'update-ref', 'refs/heads/main', commit]);
            return pullRequest;
        }
    };
}

function runFixtureServer() {
    const sourceRoot = process.env.MAP_STUDIO_E2E_SOURCE_ROOT;
    const repoRoot = process.env.MAP_STUDIO_E2E_REPO_ROOT;
    const draftsRoot = process.env.MAP_STUDIO_E2E_DRAFTS_ROOT;
    const originRoot = process.env.MAP_STUDIO_E2E_ORIGIN_ROOT;
    const port = Number(process.env.MAP_STUDIO_E2E_PORT);
    const { startMapStudioServer } = require(path.join(sourceRoot, 'scripts/map_studio_server.js'));
    const { publishDraft } = require(path.join(sourceRoot, 'scripts/map_studio_git.js'));
    const githubClient = createFakeGitHubClient(originRoot, draftsRoot);
    const server = startMapStudioServer({
        host: '127.0.0.1',
        port,
        repoRoot,
        draftsRoot,
        dependencyRoot: path.join(sourceRoot, 'node_modules'),
        allowedHosts: '127.0.0.1,localhost',
        password: STUDIO_PASSWORD,
        secureCookies: false,
        githubClient,
        publishDraft: (options) => publishDraft({
            ...options,
            runValidation: async (_command, _args, validationOptions) => {
                validationOptions.onOutput?.('Fixture publication validation passed.\n');
            },
            advanceAssetVersion: () => ({ previousVersion: 'fixture', nextVersion: 'fixture' })
        })
    });
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

if (require.main === module && process.argv[2] === 'serve') runFixtureServer();

module.exports = {
    STUDIO_PASSWORD,
    createFixture,
    getFreePort,
    startFixtureServer,
    stopFixtureServer,
    waitForHealth,
    writeJson
};
