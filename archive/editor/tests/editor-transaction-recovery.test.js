const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGit } = require('../scripts/map_studio_git.js');
const {
    createWriteTransaction,
    getPreviewBuildJobPath,
    getWriteTransactionRoot,
    recoverWriteTransactions,
    restorePreviewBuildJob,
    snapshotFile
} = require('../scripts/editor_server.js');

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-studio-transaction-test-'));
runGit(repoRoot, ['init', '-b', 'main']);
const mapsDir = path.join(repoRoot, 'maps');
const generatedDir = path.join(mapsDir, 'generated');
fs.mkdirSync(generatedDir, { recursive: true });
const mapPath = path.join(mapsDir, 'map.json');
const atlasPath = path.join(mapsDir, 'atlas-index.json');
const generatedPath = path.join(generatedDir, 'entry.json');
const unexpectedGeneratedPath = path.join(generatedDir, 'unexpected.json');
fs.writeFileSync(mapPath, 'original map\n');
fs.writeFileSync(atlasPath, 'original atlas\n');
fs.writeFileSync(generatedPath, 'original generated\n');

const snapshots = [mapPath, atlasPath, generatedPath].map(snapshotFile);
const transaction = createWriteTransaction(repoRoot, snapshots, generatedDir);
assert.equal(fs.existsSync(path.join(transaction.transactionDir, 'transaction.json')), true);
assert.doesNotMatch(runGit(repoRoot, ['status', '--short']).stdout, /map-studio-transactions/);

fs.writeFileSync(mapPath, 'interrupted map\n');
fs.writeFileSync(atlasPath, 'interrupted atlas\n');
fs.writeFileSync(generatedPath, 'interrupted generated\n');
fs.writeFileSync(unexpectedGeneratedPath, 'partial generated output\n');

const recovered = recoverWriteTransactions(repoRoot);
assert.equal(recovered.length, 1);
assert.equal(fs.readFileSync(mapPath, 'utf8'), 'original map\n');
assert.equal(fs.readFileSync(atlasPath, 'utf8'), 'original atlas\n');
assert.equal(fs.readFileSync(generatedPath, 'utf8'), 'original generated\n');
assert.equal(fs.existsSync(unexpectedGeneratedPath), false);

const incompleteTransaction = fs.mkdtempSync(path.join(getWriteTransactionRoot(repoRoot), 'transaction-'));
fs.writeFileSync(path.join(incompleteTransaction, 'orphan.bin'), 'no manifest');
assert.deepEqual(recoverWriteTransactions(repoRoot), []);
assert.equal(fs.existsSync(incompleteTransaction), false);

const partialPreviewPath = path.join(repoRoot, 'dist', 'index.html');
fs.mkdirSync(path.dirname(partialPreviewPath), { recursive: true });
fs.writeFileSync(partialPreviewPath, 'partial preview');
const previewJobPath = getPreviewBuildJobPath(repoRoot);
fs.mkdirSync(path.dirname(previewJobPath), { recursive: true });
fs.writeFileSync(previewJobPath, `${JSON.stringify({
    version: 1,
    job: {
        id: 'preview-1',
        status: 'running',
        step: 'Build Pages bundle',
        steps: [{ label: 'Build Pages bundle', status: 'running' }],
        output: ['Building preview'],
        recentOutput: ['Building preview'],
        error: '',
        previewUrl: ''
    }
})}\n`);
const recoveredPreview = restorePreviewBuildJob(repoRoot);
assert.equal(recoveredPreview.status, 'interrupted');
assert.equal(recoveredPreview.steps[0].status, 'interrupted');
assert.match(recoveredPreview.error, /Start the build again/);
assert.equal(fs.existsSync(path.join(repoRoot, 'dist')), false);
assert.doesNotMatch(runGit(repoRoot, ['status', '--short']).stdout, /map-studio-jobs/);

fs.rmSync(repoRoot, { recursive: true, force: true });
console.log('editor transaction recovery checks passed');
