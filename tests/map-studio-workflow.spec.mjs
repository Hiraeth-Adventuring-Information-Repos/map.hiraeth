import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
    STUDIO_PASSWORD,
    createFixture,
    getFreePort,
    startFixtureServer,
    stopFixtureServer,
    waitForHealth,
    writeJson
} = require('./fixtures/map-studio-e2e-fixture.cjs');
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('maintainer workflow survives restart and remains usable at narrow widths', async ({ page }, testInfo) => {
    const fixtureRoot = testInfo.outputPath('map-studio-fixture');
    const fixture = createFixture({ sourceRoot, fixtureRoot });
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let server = startFixtureServer({ sourceRoot, ...fixture, port });
    await waitForHealth(baseUrl, server);

    try {
        await page.goto(`${baseUrl}/studio`);
        await page.locator('#studio-password').fill(STUDIO_PASSWORD);
        await page.locator('#login-form').evaluate((form) => form.requestSubmit());
        await expect(page.locator('#studio-dashboard')).toBeVisible();

        await page.locator('#draft-title').fill('Browser workflow map');
        await page.locator('#start-draft-button').click();
        await expect(page.locator('#continue-editing-link')).toBeVisible();
        await expect(page.locator('#new-map-button')).toBeEnabled();

        await page.locator('#new-map-button').click();
        await expect(page.locator('#new-map-dialog')).toBeVisible();
        await page.locator('#new-map-id').fill('workflow-map');
        await page.locator('#new-map-name').fill('Workflow Map');
        await page.locator('#new-map-file').setInputFiles(path.join(fixture.repoRoot, 'maps/base-map.webp'));
        await page.locator('#review-new-map-button').click();
        await expect(page.locator('#new-map-plan-files')).toContainText('maps/workflow-map.webp');
        await expect(page.locator('#create-new-map-button')).toBeEnabled();
        await page.locator('#create-new-map-button').click();

        await page.waitForURL('**/studio/editor?map=workflow-map');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map');

        await page.locator('#map-name').fill('Workflow Map Revised');
        await expect(page.locator('#editor-undo-btn')).toBeEnabled();
        await page.locator('#editor-undo-btn').click();
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map');
        await page.locator('#editor-redo-btn').click();
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map Revised');
        await expect(page.locator('#editor-save-state-title')).toContainText('ready to save');
        await page.locator('#save-current-map-btn').click();
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        await expect(page.locator('#editor-export-status')).toContainText('validation passed');

        await expect(page.locator('#build-live-preview-btn')).toBeEnabled();
        await page.locator('#build-live-preview-btn').click();
        await expect(page.locator('#live-preview-link')).toBeVisible({ timeout: 20_000 });
        const previewPagePromise = page.context().waitForEvent('page');
        await page.locator('#live-preview-link').click();
        const previewPage = await previewPagePromise;
        await previewPage.waitForLoadState('domcontentloaded');
        await expect(previewPage).toHaveTitle(/Hiraeth|Map/i);
        await previewPage.close();

        const workspaceState = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'workspace-state.json'), 'utf8'));
        const workspaceRoot = workspaceState.activeDraft.root;
        const previewJobPath = path.resolve(workspaceRoot, execFileSync('git', ['rev-parse', '--git-path', 'map-studio-jobs/preview-job.json'], {
            cwd: workspaceRoot,
            encoding: 'utf8'
        }).trim());
        const previewJob = JSON.parse(fs.readFileSync(previewJobPath, 'utf8'));

        await page.locator('#editor-studio-home-link').click();
        await expect(page).toHaveURL(`${baseUrl}/studio`);
        await expect(page.locator('#publish-button')).toBeEnabled();
        await page.locator('#draft-title').fill('Browser workflow map');
        await page.locator('#publish-button').click();
        await expect(page.locator('#publish-progress-status')).toContainText('ready for review', { timeout: 20_000 });

        const completedPublish = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'jobs/publish-job.json'), 'utf8'));
        const publishedCommit = completedPublish.job.result.commit;
        expect(completedPublish.job.result.pullRequestNumber).toBe(1);

        await stopFixtureServer(server);
        completedPublish.job.status = 'running';
        completedPublish.job.finishedAt = '';
        completedPublish.job.result = null;
        writeJson(path.join(fixture.draftsRoot, 'jobs/publish-job.json'), completedPublish);
        previewJob.job.status = 'running';
        previewJob.job.step = 'Build Pages bundle';
        previewJob.job.steps = previewJob.job.steps.map((step, index) => ({
            ...step,
            status: index === previewJob.job.steps.length - 1 ? 'running' : 'pass'
        }));
        writeJson(previewJobPath, previewJob);
        fs.mkdirSync(path.join(workspaceRoot, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, 'dist/partial.html'), 'partial build');

        server = startFixtureServer({ sourceRoot, ...fixture, port });
        await waitForHealth(baseUrl, server);
        await page.goto(`${baseUrl}/studio`);
        await page.locator('#studio-password').fill(STUDIO_PASSWORD);
        await page.locator('#login-form').evaluate((form) => form.requestSubmit());
        await expect(page.locator('#studio-dashboard')).toBeVisible();
        await expect(page.locator('#publish-progress-status')).toContainText('interrupted');
        await expect(page.locator('#resume-publish-button')).toBeVisible();
        await page.locator('#resume-publish-button').click();
        await expect(page.locator('#publish-progress-status')).toContainText('ready for review', { timeout: 20_000 });
        const resumedPublish = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'jobs/publish-job.json'), 'utf8'));
        expect(resumedPublish.job.result.commit).toBe(publishedCommit);
        expect(resumedPublish.job.result.pullRequestNumber).toBe(1);

        await page.goto(`${baseUrl}/studio/editor?map=workflow-map`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        const recoveredPreview = await page.evaluate(async (jobId) => {
            const response = await fetch(`/api/editor/build-preview-status?id=${encodeURIComponent(jobId)}`);
            return response.json();
        }, previewJob.job.id);
        expect(recoveredPreview.status).toBe('interrupted');
        expect(fs.existsSync(path.join(workspaceRoot, 'dist/partial.html'))).toBe(false);
        await expect(page.locator('#build-live-preview-btn')).toBeEnabled();
        await page.locator('#build-live-preview-btn').click();
        await expect(page.locator('#live-preview-link')).toBeVisible({ timeout: 20_000 });

        await page.setViewportSize({ width: 480, height: 900 });
        const narrowLayout = await page.evaluate(() => {
            const inspector = document.querySelector('#editor-inspector').getBoundingClientRect();
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                inspectorLeft: inspector.left,
                inspectorRight: inspector.right,
                inspectorWidth: inspector.width,
                resizerDisplay: getComputedStyle(document.querySelector('#editor-inspector-resizer')).display
            };
        });
        expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth);
        expect(narrowLayout.inspectorLeft).toBeGreaterThanOrEqual(0);
        expect(narrowLayout.inspectorRight).toBeLessThanOrEqual(narrowLayout.viewportWidth + 1);
        expect(narrowLayout.inspectorWidth).toBeGreaterThan(400);
        expect(narrowLayout.resizerDisplay).toBe('none');

        await page.goto(`${baseUrl}/studio`);
        await expect(page.locator('#finish-draft-button')).toBeEnabled();
        await page.locator('#finish-draft-button').click();
        await expect(page.locator('#start-draft-button')).toBeVisible();
        await expect(page.locator('#workflow-status')).toContainText('workspace is ready for another change');
    } catch (error) {
        error.message += `\nFixture server output:\n${server?.getOutput?.() || '(no output)'}`;
        throw error;
    } finally {
        await stopFixtureServer(server);
    }
});
