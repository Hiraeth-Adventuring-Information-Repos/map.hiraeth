#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const VERSIONED_FILES = [
    'site.config.json',
    'js/app-config.js',
    'index.html',
    'map-editor.html'
];

function nextPatchVersion(version) {
    const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error(`Asset version "${version}" is not a numeric major.minor.patch version.`);
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function getAssetVersion(repoRoot) {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'site.config.json'), 'utf8'));
    const version = String(config?.assets?.version || '').trim();
    if (!version) throw new Error('site.config.json assets.version is missing.');
    return version;
}

function bumpAssetVersion(repoRoot, requestedVersion = '') {
    const previousVersion = getAssetVersion(repoRoot);
    const nextVersion = String(requestedVersion || '').trim() || nextPatchVersion(previousVersion);
    if (nextVersion === previousVersion) {
        return { changed: false, previousVersion, nextVersion, files: [] };
    }

    const snapshots = VERSIONED_FILES.map((relativePath) => {
        const fullPath = path.join(repoRoot, relativePath);
        return { relativePath, fullPath, source: fs.readFileSync(fullPath, 'utf8') };
    });
    const missing = snapshots.filter(({ source }) => !source.includes(previousVersion));
    if (missing.length > 0) {
        throw new Error(`Asset version ${previousVersion} is missing from: ${missing.map((item) => item.relativePath).join(', ')}`);
    }

    try {
        snapshots.forEach(({ fullPath, source }) => {
            fs.writeFileSync(fullPath, source.split(previousVersion).join(nextVersion));
        });
    } catch (error) {
        snapshots.forEach(({ fullPath, source }) => fs.writeFileSync(fullPath, source));
        throw error;
    }

    return {
        changed: true,
        previousVersion,
        nextVersion,
        files: [...VERSIONED_FILES]
    };
}

if (require.main === module) {
    try {
        const result = bumpAssetVersion(path.resolve(__dirname, '..'), process.argv[2]);
        console.log(result.changed
            ? `Asset version advanced from ${result.previousVersion} to ${result.nextVersion}.`
            : `Asset version remains ${result.nextVersion}.`);
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

module.exports = {
    VERSIONED_FILES,
    bumpAssetVersion,
    getAssetVersion,
    nextPatchVersion
};
