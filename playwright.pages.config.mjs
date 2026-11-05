import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const artifactRoot = path.resolve(process.env.PAGES_TEST_ROOT || 'dist');
if (!fs.existsSync(path.join(artifactRoot, 'index.html'))) {
    throw new Error(`Missing Pages artifact: ${artifactRoot}. Run npm run build:pages first.`);
}
process.env.PAGES_TEST_ROOT = artifactRoot;

export default defineConfig({
    testDir: './tests',
    testMatch: 'pages-artifact.spec.mjs',
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 10_000 },
    outputDir: 'test-results/pages',
    reporter: [['line'], ['html', { outputFolder: 'playwright-pages-report', open: 'never' }]],
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
    ],
    use: {
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: 'block',
        actionTimeout: 10_000,
        navigationTimeout: 30_000,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    }
});
