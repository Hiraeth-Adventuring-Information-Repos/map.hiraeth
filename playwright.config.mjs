import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: ['campaign-journeys.spec.mjs', 'travel-network.spec.mjs', 'travel-addresses.spec.mjs', 'stomion-addresses.spec.mjs', 'poi-markers.spec.mjs', 'world-transport.spec.mjs', 'viewer-refinements.spec.mjs'],
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
