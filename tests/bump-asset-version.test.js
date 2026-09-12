const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    VERSIONED_FILES,
    bumpAssetVersion,
    nextPatchVersion
} = require('../scripts/bump_asset_version.js');

assert.equal(nextPatchVersion('1.2.9'), '1.2.10');
assert.throws(() => nextPatchVersion('release-1'), /major.minor.patch/);

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-version-test-'));
VERSIONED_FILES.forEach((relativePath) => {
    const fullPath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const source = relativePath === 'site.config.json'
        ? JSON.stringify({ assets: { version: '0.1.48' } })
        : `asset=0.1.48\n`;
    fs.writeFileSync(fullPath, source);
});
const result = bumpAssetVersion(repoRoot);
assert.equal(result.previousVersion, '0.1.48');
assert.equal(result.nextVersion, '0.1.49');
VERSIONED_FILES.forEach((relativePath) => {
    assert.match(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), /0\.1\.49/);
});

fs.rmSync(repoRoot, { recursive: true, force: true });
console.log('asset version bump checks passed');
