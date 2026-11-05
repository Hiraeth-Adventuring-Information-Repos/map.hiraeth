const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function listGate(root) {
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'),
        'test', '--config=playwright.pages.config.mjs', '--list'], {
        encoding: 'utf8', env: { ...process.env, PAGES_TEST_ROOT: root }
    });
    if (result.error) throw result.error;
    return result;
}

test('production browser gate fails for an absent artifact and does not build it', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-gate-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const missing = path.join(root, 'missing-dist');
    const result = listGate(missing);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing Pages artifact/);
    assert.equal(fs.existsSync(missing), false);
});

test('production gate discovers actual artifact cases for both browsers without a build', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-gate-list-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    const result = listGate(root);
    assert.equal(result.status, 0, result.stderr);
    for (const browser of ['chromium', 'firefox']) {
        assert.match(result.stdout, new RegExp(`\\[${browser}\\].*built viewer renders tiles`));
        assert.match(result.stdout, new RegExp(`\\[${browser}\\].*never request routing geometry`));
    }
    assert.deepEqual(fs.readdirSync(root), ['index.html']);
});

test('production browser verification gates both artifact uploads', () => {
    for (const name of ['pages-build-check.yml', 'pages-deploy.yml']) {
        const text = fs.readFileSync(path.join('.github/workflows', name), 'utf8');
        const build = text.indexOf('run: npm run build:pages');
        const browsers = text.indexOf('run: npx playwright install --with-deps chromium firefox');
        const gate = text.indexOf('run: npm run test:pages');
        const upload = text.indexOf(name === 'pages-deploy.yml' ? 'uses: actions/upload-pages-artifact' : 'name: Upload Pages bundle artifact');
        assert.ok(build >= 0 && browsers > build && gate > browsers && upload > gate, name);
        assert.match(text, /if: failure\(\)[\s\S]*test-results\/pages/);
    }
});
