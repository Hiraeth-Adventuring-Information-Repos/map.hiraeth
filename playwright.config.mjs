import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: ['map-studio-workflow.spec.mjs', 'map-file-workflow.spec.mjs', 'map-drawing-workflow.spec.mjs', 'campaign-journeys.spec.mjs', 'poi-markers.spec.mjs'],
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 10_000 },
    reporter: [
        ['line'],
        ['html', { open: 'never' }]
    ],
    use: {
        ...devices['Desktop Chrome'],
        actionTimeout: 10_000,
        navigationTimeout: 20_000,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    }
});
