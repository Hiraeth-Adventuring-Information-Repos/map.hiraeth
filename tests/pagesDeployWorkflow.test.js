const assert = require('node:assert/strict');
const fs = require('node:fs');

const deployWorkflow = fs.readFileSync('.github/workflows/pages-deploy.yml', 'utf8');
const checkWorkflow = fs.readFileSync('.github/workflows/pages-build-check.yml', 'utf8');

assert.match(deployWorkflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
assert.match(deployWorkflow, /paths-ignore:[\s\S]*- dist\/\*\*/);
assert.match(deployWorkflow, /paths-ignore:[\s\S]*- readme\.md/);
assert.match(deployWorkflow, /paths-ignore:[\s\S]*- tests\/\*\*/);
assert.doesNotMatch(deployWorkflow, /paths-ignore:[\s\S]*- (?:js\/app\.js|css\/style\.css|maps\/\*\*)/);
assert.match(deployWorkflow, /permissions:\s*\n\s*contents: read\s*\n\s*pages: read/);
assert.match(deployWorkflow, /permissions:\s*\n\s*pages: write\s*\n\s*id-token: write/);
assert.match(deployWorkflow, /uses: actions\/configure-pages@v6/);
assert.match(deployWorkflow, /uses: actions\/upload-pages-artifact@v5/);
assert.match(deployWorkflow, /path: dist/);
assert.match(deployWorkflow, /uses: actions\/deploy-pages@v5/);

[deployWorkflow, checkWorkflow].forEach((workflow) => {
    assert.match(workflow, /runs-on: ubuntu-24\.04/);
    assert.match(workflow, /uses: actions\/checkout@v6/);
    assert.match(workflow, /uses: actions\/setup-node@v6/);
    assert.match(workflow, /id: tile-cache\s*\n\s*uses: actions\/cache@v6/);
    assert.match(workflow, /if: steps\.tile-cache\.outputs\.cache-hit != 'true'/);
    assert.match(workflow, /node scripts\/generate_tiles\.js --print-cache-key/);
    assert.match(workflow, /restore-keys: \|\s*\n\s*pages-tiles-\$\{\{ runner\.os \}\}-/);
    assert.match(workflow, /MAP_HIRAETH_TILE_CACHE_DIR: \.cache\/pages-tiles/);
    assert.match(workflow, /npm ci --no-audit --no-fund/);
    assert.match(workflow, /npm run validate:data && npm run test:unit/);
    assert.match(workflow, /npm run build:pages/);
});

assert.match(deployWorkflow, /uses: actions\/cache@v6/);
assert.match(checkWorkflow, /uses: actions\/cache@v6/);
assert.doesNotMatch(checkWorkflow, /uses: actions\/cache\/restore@v6/);
assert.match(checkWorkflow, /uses: actions\/upload-artifact@v6/);
assert.match(checkWorkflow, /npx playwright install --with-deps firefox/);
assert.match(checkWorkflow, /npm run test:firefox/);
assert.match(checkWorkflow, /fetch-depth: 2/);
assert.doesNotMatch(checkWorkflow, /fetch-depth: 0/);
assert.match(checkWorkflow, /pull_request:\s*\n\s*paths-ignore:[\s\S]*- dist\/\*\*/);

console.log('Pages deployment workflow checks passed');
