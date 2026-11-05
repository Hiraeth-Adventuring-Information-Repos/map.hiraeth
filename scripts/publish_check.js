#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { countFiles } = require('./build_pages.js');
const { validateDist } = require('./validate_dist.js');

const repoRoot = path.resolve(__dirname, '..');
function runStep(label, command, args) {
    console.log(`\n> ${label}`);
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: 'inherit'
    });
    if (result.error) {
        console.error(result.error.message || result.error);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function runCapture(command, args) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    if (result.error || result.status !== 0) return null;
    return String(result.stdout || '').trim();
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function getUnitTestFiles() {
    return fs.readdirSync(path.join(repoRoot, 'tests'))
        .filter((fileName) => fileName.endsWith('.test.js'))
        .sort()
        .map((fileName) => path.join('tests', fileName));
}

function printChangedFileSummary() {
    const status = runCapture('git', ['status', '--short', '--untracked-files=normal']);
    console.log('\nChanged files:');
    if (!status) {
        console.log('  Unable to read git status.');
        return;
    }
    const lines = status.split('\n').filter(Boolean);
    if (lines.length === 0) {
        console.log('  None');
        return;
    }
    const generatedDistLines = lines.filter((line) => /^.. dist\//.test(line));
    lines
        .filter((line) => !/^.. dist\//.test(line))
        .forEach((line) => console.log(`  ${line}`));
    if (generatedDistLines.length > 0) {
        console.log(`  dist/: ${generatedDistLines.length} generated file changes`);
    }
}

runStep('Generate atlas index', process.execPath, ['scripts/generate_atlas_index.js']);
runStep('Validate map data', process.execPath, ['scripts/validate_map_data.js']);
runStep('Run unit tests', process.execPath, ['--test', ...getUnitTestFiles()]);
runStep('Build GitHub Pages bundle', process.execPath, ['scripts/build_pages.js']);
const optimizedRuntime = validateDist();

const atlas = readJson('maps/atlas-index.json');
const distPath = path.join(repoRoot, 'dist');
const distFileCount = fs.existsSync(distPath) ? countFiles(distPath) : 0;

console.log('\nPublish check passed.');
console.log(`- Search entries: ${Array.isArray(atlas.searchIndex) ? atlas.searchIndex.length : 0}`);
console.log(`- Pages bundle files: ${distFileCount}`);
console.log('- Required Pages files present');
console.log('- Internal server files absent from dist/');
console.log('- Legacy POI PNG copies absent from dist/');
console.log('- Per-map tile cache fingerprints present');
console.log('- Native map resolution and detail quality preserved');
console.log(`- Optimized app/style/atlas shell: ${optimizedRuntime.appBytes}/${optimizedRuntime.styleBytes}/${optimizedRuntime.atlasShellBytes} bytes`);
console.log(`- Deferred atlas search entries: ${optimizedRuntime.atlasSearchEntries}`);
printChangedFileSummary();
