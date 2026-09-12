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
    const pageErrors = [];
    const consoleIssues = [];
    const responseIssues = [];
    const monitorBrowserPage = (browserPage) => {
        browserPage.on('pageerror', (error) => {
            pageErrors.push(`${browserPage.url()}: ${error.message}`);
        });
        browserPage.on('console', (message) => {
            // This test deliberately drops one publication-status request.
            if (message.location().url.endsWith('/api/studio/publish-status') && message.text().includes('net::ERR_FAILED')) return;
            if (message.type() === 'warning' || message.type() === 'error') {
                consoleIssues.push(`${message.type()} ${browserPage.url()}: ${message.text()}`);
            }
        });
        browserPage.on('response', (response) => {
            if (response.status() >= 400) {
                responseIssues.push(`${response.status()} ${response.request().resourceType()} ${response.url()}`);
            }
        });
    };
    monitorBrowserPage(page);
    page.context().on('page', (browserPage) => monitorBrowserPage(browserPage));

    try {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(`${baseUrl}/studio`);
        await page.locator('#studio-password').fill(STUDIO_PASSWORD);
        await page.locator('#login-form').evaluate((form) => form.requestSubmit());
        await expect(page.locator('#studio-dashboard')).toBeVisible();
        await expect(page.locator('#studio-editor-link')).toHaveText('Edit maps');
        await expect(page.locator('#studio-editor-link')).toHaveAttribute('href', '/studio/editor');
        await expect(page.locator('#open-editor-link')).toHaveText('Edit maps');
        await expect(page.locator('#new-map-button')).toBeEnabled();
        await expect(page.locator('#studio-preview-link')).toHaveText('Preview unavailable');
        await expect(page.locator('#studio-preview-link')).not.toHaveAttribute('href', /.+/);
        await expect(page.locator('#studio-preview-link')).toHaveAttribute('tabindex', '-1');
        await expect(page.locator('#edit-maps-button')).toBeEnabled();
        const initialCta = await page.locator('#edit-maps-button').boundingBox();
        expect(initialCta).not.toBeNull();
        expect(initialCta.y + initialCta.height).toBeLessThanOrEqual(720);

        await page.setViewportSize({ width: 390, height: 844 });
        const narrowDashboard = await page.evaluate(() => {
            const review = document.querySelector('.review-shortcut').getBoundingClientRect();
            const newMapCard = document.querySelector('#new-map-card').getBoundingClientRect();
            const newMapCopy = document.querySelector('#new-map-card > div').getBoundingClientRect();
            const availability = document.querySelector('#new-map-card .availability-note').getBoundingClientRect();
            return {
                reviewBottom: review.bottom,
                cardWidth: newMapCard.width,
                copyWidth: newMapCopy.width,
                availabilityWidth: availability.width,
                viewportHeight: document.documentElement.clientHeight,
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth
            };
        });
        expect(narrowDashboard.reviewBottom).toBeLessThanOrEqual(narrowDashboard.viewportHeight);
        expect(narrowDashboard.scrollWidth).toBeLessThanOrEqual(narrowDashboard.viewportWidth);
        expect(narrowDashboard.copyWidth).toBeGreaterThanOrEqual(180);
        expect(narrowDashboard.availabilityWidth).toBeGreaterThanOrEqual(narrowDashboard.cardWidth - 48);
        await page.setViewportSize({ width: 1280, height: 720 });

        await page.goto(`${baseUrl}/studio/editor?map=base-map&mode=review`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-access', 'review-only');
        await expect(page.locator('#editor-access-title')).toHaveText('Review-only map browser');
        await expect(page.locator('#editor-atlas-tree')).toHaveAttribute('aria-label', 'Maps available to review');
        await expect(page.locator('#editor-save-bar')).toBeHidden();
        await expect(page.locator('.map-editor-publish-panel')).toBeHidden();
        await page.locator('[data-dm-tab="map-details"]').click();
        await expect(page.locator('#map-name')).toBeDisabled();
        await expect(page.locator('#map-settings-form')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('#editor-tool-point')).toBeDisabled();
        await expect(page.locator('#editor-tool-region')).toBeDisabled();
        await expect(page.locator('#editor-tool-line')).toBeDisabled();
        await expect(page.locator('#editor-add-poi-btn')).toBeDisabled();
        await expect(page.locator('#editor-add-region-btn')).toBeDisabled();
        await expect(page.locator('#editor-add-line-btn')).toBeDisabled();
        await expect(page.locator('#save-current-map-btn')).toBeDisabled();
        await expect(page.locator('#build-live-preview-btn')).toBeDisabled();
        await expect(page.locator('#live-preview-link')).toBeHidden();

        const reviewModeBefore = await page.locator('#map-editor-app').getAttribute('data-mode');
        await page.keyboard.press('p');
        await page.keyboard.press('r');
        await page.keyboard.press('l');
        await page.locator('#editor-map').click({ position: { x: 160, y: 120 } });
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', reviewModeBefore);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'false');

        await page.goto(`${baseUrl}/studio`);
        await expect(page.locator('#studio-dashboard')).toBeVisible();

        if (!await page.locator('#draft-title').isVisible()) await page.locator('#studio-publication-panel > summary').click();
        await page.locator('#draft-title').fill('Browser workflow map');
        await page.locator('#start-draft-button').click();
        await expect(page.locator('#continue-editing-link')).toBeVisible();
        await expect(page.locator('#new-map-button')).toBeEnabled();
        await expect(page.locator('#studio-editor-link')).toHaveText('Edit maps');

        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#new-map-button').click();
        await expect(page.locator('#new-map-dialog')).toBeVisible();
        await page.locator('#new-map-name').fill('Workflow Map');
        await expect(page.locator('#new-map-id')).toHaveValue('workflow-map');
        await page.locator('#new-map-file').setInputFiles(path.join(fixture.repoRoot, 'maps/base-map.webp'));
        await expect(page.locator('#new-map-next-button')).toBeHidden();
        await expect(page.locator('summary').filter({ hasText: 'Placement & scale' })).toBeVisible();
        await page.locator('#review-new-map-button').click();
        await expect(page.locator('#new-map-plan-title')).toBeFocused();
        await expect(page.locator('#new-map-plan-files')).toContainText('maps/workflow-map.webp');
        await expect(page.locator('#create-new-map-button')).toBeEnabled();
        await expect(page.locator('#create-new-map-button')).toBeVisible();
        const narrowWizard = await page.evaluate(() => {
            const dialog = document.querySelector('#new-map-dialog').getBoundingClientRect();
            const create = document.querySelector('#create-new-map-button').getBoundingClientRect();
            return {
                dialogRight: dialog.right,
                createBottom: create.bottom,
                viewportWidth: document.documentElement.clientWidth,
                viewportHeight: document.documentElement.clientHeight,
                scrollWidth: document.documentElement.scrollWidth
            };
        });
        expect(narrowWizard.scrollWidth).toBeLessThanOrEqual(narrowWizard.viewportWidth);
        expect(narrowWizard.dialogRight).toBeLessThanOrEqual(narrowWizard.viewportWidth + 1);
        expect(narrowWizard.createBottom).toBeLessThanOrEqual(narrowWizard.viewportHeight + 1);

        await page.locator('#new-map-back-button').click();
        await page.locator('summary').filter({ hasText: 'Descriptions' }).click();
        await page.locator('#new-map-selector-description').fill('A workflow test map.');
        await expect(page.locator('#new-map-plan')).toBeHidden();
        await expect(page.locator('#create-new-map-button')).toBeDisabled();
        await page.locator('#review-new-map-button').click();
        await expect(page.locator('#new-map-plan-files')).toContainText('maps/workflow-map.webp');
        await expect(page.locator('#create-new-map-button')).toBeEnabled();
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.locator('#create-new-map-button').click();

        await page.waitForURL('**/studio/editor?map=workflow-map');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        await expect(page.locator('#editor-map')).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        const narrow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
            panel: document.querySelector('#editor-inspector').getBoundingClientRect().bottom,
            map: document.querySelector('.map-editor-canvas-panel').getBoundingClientRect().top }));
        expect(narrow.scroll).toBeLessThanOrEqual(narrow.width);
        expect(narrow.panel).toBeLessThanOrEqual(narrow.map);
        await page.setViewportSize({ width: 1280, height: 720 });
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-access', 'writable');
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map');
        await expect(page.locator('#map-name')).toBeEnabled();
        await expect(page.locator('#editor-tool-point')).toBeEnabled();
        await expect(page.locator('#editor-tool-region')).toBeEnabled();
        await expect(page.locator('#editor-tool-line')).toBeEnabled();
        await page.locator('.dm-settings-section').filter({ hasText: 'Artwork' }).locator('summary').click();
        await expect(page.locator('#map-imageUrl')).toBeVisible();
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-browser');
        await page.locator('[data-dm-tab="map-details"]').click();
        await page.locator('#dm-panel-toggle').click();
        await expect(page.locator('#editor-inspector')).toBeHidden();
        await expect(page.locator('#editor-map')).toBeVisible();
        await page.locator('#dm-panel-toggle').click();
        await expect(page.locator('#editor-inspector')).toBeVisible();
        const widthBefore = await page.locator('#editor-inspector').evaluate(e => e.getBoundingClientRect().width);
        await page.locator('#editor-inspector-resizer').focus();
        await page.keyboard.press('ArrowRight');
        expect(await page.locator('#editor-inspector').evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(widthBefore);
        await page.locator('[data-dm-tab="library"]').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-dm-tab="map-details"]')).toBeFocused();
        await page.evaluate(() => { localStorage.setItem('themePreference', 'system'); localStorage.setItem('theme', 'dark'); });
        await page.locator('[data-dm-theme]').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(await page.evaluate(() => [localStorage.getItem('themePreference'), localStorage.getItem('theme')])).toEqual(['system', 'dark']);
        await page.locator('[data-dm-theme]').click();

        await page.locator('#editor-file-menu-btn').click();
        await expect(page.locator('#editor-file-menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#editor-file-menu')).toBeHidden();
        await expect(page.locator('#editor-file-menu-btn')).toBeFocused();

        await page.locator('#editor-view-menu-btn').click();
        await page.locator('#editor-menu-pan-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-tool', 'pan');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        await page.keyboard.press('v');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-tool', 'select');

        await page.locator('#map-name').fill('Workflow Map Revised');
        await expect(page.locator('#editor-undo-btn')).toBeEnabled();
        await page.locator('#editor-undo-btn').click();
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map');
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        await expect(page.locator('#save-current-map-btn')).toBeDisabled();
        await page.locator('#editor-redo-btn').click();
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map Revised');
        await expect(page.locator('#editor-save-state-title')).toContainText('Unsaved changes to Workflow Map Revised');

        await page.locator('#editor-file-menu-btn').click();
        await page.locator('#editor-menu-all-maps-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'library');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
        await expect(page.locator('#editor-context-label')).toHaveText('Unsaved map');
        await expect(page.locator('#editor-context-name')).toHaveText('Workflow Map Revised');
        await expect(page.locator('#editor-save-state-title')).toContainText('Unsaved changes to Workflow Map Revised');
        await page.locator('[data-dm-tab="map-details"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map Revised');

        await page.locator('#editor-studio-home-link').click();
        await expect(page.locator('#editor-unsaved-dialog')).toBeVisible();
        await expect(page.locator('#editor-unsaved-copy')).toContainText('Workflow Map Revised');
        await page.locator('#editor-cancel-switch-btn').click();
        await expect(page.locator('#editor-unsaved-dialog')).toBeHidden();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map Revised');

        await page.locator('#save-current-map-btn').click();
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        await expect(page.locator('#editor-export-status')).toContainText('validation passed');

        const draftWorkspaceState = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'workspace-state.json'), 'utf8'));
        const workspaceRoot = draftWorkspaceState.activeDraft.root;
        const savedWorkflowMapPath = path.join(workspaceRoot, 'maps/workflow-map.json');
        let savedWorkflowMap = JSON.parse(fs.readFileSync(savedWorkflowMapPath, 'utf8'));
        expect(savedWorkflowMap.name).toBe('Workflow Map Revised');

        await page.locator('[data-dm-tab="map-details"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await expect(page.locator('#editor-feature-type-select')).toHaveValue('points');
        await page.locator('#editor-create-feature-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
        await page.locator('#editor-map').click({ position: { x: 240, y: 180 } });
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-edit');
        await expect(page.locator('#editor-feature-form [data-field="name"]')).toHaveValue('');
        await expect(page.locator('#editor-save-state-title')).toContainText(/Complete the new (point|feature)/);
        await expect(page.locator('#save-current-map-btn')).toBeDisabled();
        await page.keyboard.press('Meta+s');
        savedWorkflowMap = JSON.parse(fs.readFileSync(savedWorkflowMapPath, 'utf8'));
        expect(savedWorkflowMap.pointsOfInterest).toEqual([]);
        expect(savedWorkflowMap.pointsOfInterest.some((point) => !String(point.name || '').trim() || /^POI\s+\d+$/i.test(point.name))).toBe(false);
        for (let undoAttempt = 0; undoAttempt < 4; undoAttempt += 1) {
            if (await page.locator('#map-editor-app').getAttribute('data-dirty') === 'false') break;
            await expect(page.locator('#editor-undo-btn')).toBeEnabled();
            await page.locator('#editor-undo-btn').click();
        }
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'false');
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');

        await page.locator('#editor-studio-home-link').click();
        await expect(page.locator('#studio-preview-link')).toHaveText('Build preview');
        await expect(page.locator('#studio-preview-link')).toHaveAttribute('href', '/studio/editor?action=preview');
        await page.goto(`${baseUrl}/studio/editor?map=workflow-map`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');

        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await page.locator('#editor-feature-type-select').selectOption('regions');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-browser');
        await expect(page.locator('#editor-feature-type-select')).toBeVisible();
        await expect(page.locator('#editor-feature-type-select')).toHaveValue('regions');
        await page.locator('#editor-create-feature-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
        await expect(page.locator('#editor-finish-draw-btn')).toBeDisabled();
        await page.locator('#editor-map').click({ position: { x: 220, y: 170 } });
        await page.locator('#editor-map').click({ position: { x: 280, y: 210 } });
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
        await expect(page.locator('#editor-save-state-title')).toContainText('Finish or cancel the current region');
        const draftRecoveryBeforeReload = await page.evaluate(() => Object.entries(window.sessionStorage)
            .filter(([key]) => key.startsWith('mapEditorRecovery:'))
            .map(([, value]) => JSON.parse(value))
            .find((snapshot) => snapshot.drawMode === 'region'));
        expect(draftRecoveryBeforeReload.draftCoordinates).toHaveLength(2);
        await page.locator('[data-dm-tab="map-details"]').click();
        await page.locator('[data-dm-tab="library"]').click();
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
        await expect(page.locator('#editor-finish-draw-btn')).toBeDisabled();

        await page.reload();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
        await expect(page.locator('#editor-save-state-title')).toContainText('Finish or cancel the current region');
        await expect(page.locator('#editor-export-status')).toContainText('Recovered an unfinished region drawing');
        await page.locator('#editor-export-btn').click();
        await expect(page.locator('#export-current-map-btn')).toBeDisabled();
        await expect(page.locator('#editor-export-current-map-note')).toContainText('finish or cancel');
        await expect(page.locator('#editor-export-build-preview-btn')).toBeDisabled();
        await page.locator('#editor-export-close-btn').click();
        await page.locator('#editor-back-to-feature-list-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-browser');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'false');

        await page.locator('#editor-export-btn').click();
        await expect(page.locator('#editor-export-dialog')).toBeVisible();
        await expect(page.locator('#editor-export-build-preview-btn')).toBeEnabled();
        await page.locator('#editor-export-build-preview-btn').click();
        await expect(page.locator('#editor-export-status')).toContainText('Built live preview', { timeout: 20_000 });
        const previewPagePromise = page.context().waitForEvent('page');
        await page.locator('#editor-export-open-preview-link').click();
        const previewPage = await previewPagePromise;
        await previewPage.waitForLoadState('domcontentloaded');
        await expect(previewPage).toHaveTitle(/Hiraeth|Map/i);
        await previewPage.close();
        await page.locator('#editor-export-close-btn').click();

        await page.locator('[data-dm-tab="map-details"]').click();
        await page.locator('[data-dm-tab="map-details"]').click();
        await page.locator('#map-name').fill('Workflow Map Published');
        await expect(page.locator('#live-preview-link')).toHaveAttribute('hidden', '');
        await expect(page.locator('#editor-export-open-preview-link')).toHaveAttribute('hidden', '');
        await expect(page.locator('#editor-export-open-preview-link')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('#editor-export-open-preview-link')).toHaveAttribute('tabindex', '-1');
        await expect(page.locator('#build-live-preview-btn')).toBeDisabled();
        await page.locator('#save-current-map-btn').click();
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        savedWorkflowMap = JSON.parse(fs.readFileSync(savedWorkflowMapPath, 'utf8'));
        expect(savedWorkflowMap.name).toBe('Workflow Map Published');
        await expect(page.locator('#build-live-preview-btn')).toBeEnabled();
        await page.locator('#editor-export-btn').click();
        await expect(page.locator('#editor-export-build-preview-btn')).toBeEnabled();
        await page.locator('#editor-export-build-preview-btn').click();
        await expect(page.locator('#editor-export-status')).toContainText('Built live preview', { timeout: 20_000 });
        await page.locator('#editor-export-close-btn').click();

        await page.locator('#map-name').fill('Temporary discarded title');
        await page.locator('[data-dm-tab="library"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'library');
        await page.locator('#editor-atlas-tree [data-map-id="base-map"]').click();
        await expect(page.locator('#editor-unsaved-dialog')).toBeVisible();
        await expect(page.locator('#editor-unsaved-copy')).toContainText('Base Map');
        await page.locator('#editor-discard-switch-btn').click();
        await expect(page.locator('#editor-current-map-id')).toHaveText('base-map');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'false');
        await page.locator('[data-dm-tab="library"]').click();
        await page.locator('#editor-atlas-tree [data-map-id="workflow-map"]').click();
        await expect(page.locator('#editor-current-map-id')).toHaveText('workflow-map');
        await page.locator('[data-dm-tab="map-details"]').click();
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map Published');
        savedWorkflowMap = JSON.parse(fs.readFileSync(savedWorkflowMapPath, 'utf8'));
        expect(savedWorkflowMap.name).toBe('Workflow Map Published');

        await page.locator('#map-name').fill('Recovered after reload');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
        const recoveryBeforeReload = await page.evaluate(() => Object.entries(window.sessionStorage)
            .filter(([key]) => key.startsWith('mapEditorRecovery:'))
            .map(([key, value]) => ({ key, snapshot: JSON.parse(value) })));
        expect(recoveryBeforeReload).toHaveLength(1);
        expect(recoveryBeforeReload[0].snapshot.mapFormValues).toContainEqual(expect.objectContaining({
            field: 'name',
            value: 'Recovered after reload'
        }));
        await page.reload();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        const recoveryAfterReload = await page.evaluate(() => Object.entries(window.sessionStorage)
            .filter(([key]) => key.startsWith('mapEditorRecovery:'))
            .map(([key, value]) => ({ key, snapshot: JSON.parse(value) })));
        expect(recoveryAfterReload).toHaveLength(1);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
        await expect(page.locator('#map-name')).toHaveValue('Recovered after reload');
        await expect(page.locator('#editor-export-status')).toContainText('Recovered unsaved changes');
        await page.locator('#editor-studio-home-link').click();
        await expect(page.locator('#editor-unsaved-dialog')).toBeVisible();
        await page.locator('#editor-discard-switch-btn').click();
        await expect(page).toHaveURL(`${baseUrl}/studio`);

        const previewJobPath = path.resolve(workspaceRoot, execFileSync('git', ['rev-parse', '--git-path', 'map-studio-jobs/preview-job.json'], {
            cwd: workspaceRoot,
            encoding: 'utf8'
        }).trim());
        const previewJob = JSON.parse(fs.readFileSync(previewJobPath, 'utf8'));

        await expect(page.locator('#publish-button')).toBeEnabled();
        await expect(page.locator('#finish-draft-button')).toBeVisible();
        await expect(page.locator('#finish-draft-button')).toBeDisabled();
        let publicationStatusRequests = 0;
        await page.route('**/api/studio/publish-status', route => {
            publicationStatusRequests += 1;
            return publicationStatusRequests === 1 ? route.abort('failed') : route.continue();
        });
        if (!await page.locator('#draft-title').isVisible()) await page.locator('#studio-publication-panel > summary').click();
        await page.locator('#draft-title').fill('Browser workflow map');
        await page.locator('#publish-button').click();
        await expect(page.locator('#publish-progress-status')).toContainText('ready for review', { timeout: 20_000 });
        await expect(page.locator('#finish-draft-button')).toBeEnabled();

        expect(publicationStatusRequests).toBeGreaterThan(1);
        await page.unroute('**/api/studio/publish-status');

        const completedPublish = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'jobs/publish-job.json'), 'utf8'));
        const publishedCommit = completedPublish.job.result.commit;
        expect(completedPublish.job.result.pullRequestNumber).toBe(1);
        await page.goto(`${baseUrl}/studio/editor?map=workflow-map`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await page.locator('[data-dm-tab="map-details"]').click();
        const publishedName = await page.locator('#map-name').inputValue();
        await page.locator('#map-name').fill('Follow-up awaiting publication');
        await page.locator('#save-current-map-btn').click();
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        await page.goto(`${baseUrl}/studio`);
        await expect(page.locator('#workflow-title')).toHaveText('Update this draft before merging');
        await expect(page.locator('#publish-button')).toHaveText('Update pull request');
        await expect(page.locator('#finish-draft-button')).toBeDisabled();
        await page.goto(`${baseUrl}/studio/editor?map=workflow-map`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await page.locator('#map-name').fill(publishedName);
        await page.locator('#save-current-map-btn').click();
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');


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
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        const recoveredPreview = await page.evaluate(async (jobId) => {
            const response = await fetch(`/api/editor/build-preview-status?id=${encodeURIComponent(jobId)}`);
            return response.json();
        }, previewJob.job.id);
        expect(recoveredPreview.status).toBe('interrupted');
        expect(fs.existsSync(path.join(workspaceRoot, 'dist/partial.html'))).toBe(false);
        await page.locator('#editor-export-btn').click();
        await expect(page.locator('#editor-export-build-preview-btn')).toBeEnabled();
        await page.locator('#editor-export-build-preview-btn').click();
        await expect(page.locator('#editor-export-status')).toContainText('Built live preview', { timeout: 20_000 });
        await page.locator('#editor-export-close-btn').click();

        await page.locator('[data-dm-tab="map-details"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'map-details');
        await page.setViewportSize({ width: 390, height: 844 });
        const narrowLayout = await page.evaluate(() => {
            const inspector = document.querySelector('#editor-inspector').getBoundingClientRect();
            const workspace = document.querySelector('.map-editor-workspace').getBoundingClientRect();
            return {
                viewportWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                inspectorLeft: inspector.left,
                inspectorRight: inspector.right,
                inspectorWidth: inspector.width,
                inspectorTop: inspector.top,
                inspectorBottom: inspector.bottom,
                launcherLeft: document.querySelector('#editor-inspector-launcher').getBoundingClientRect().left,
                launcherRight: document.querySelector('#editor-inspector-launcher').getBoundingClientRect().right,
                workspaceTop: workspace.top,
                workspaceBottom: workspace.bottom,
                resizerDisplay: getComputedStyle(document.querySelector('#editor-inspector-resizer')).display,
                mapOverviewIcon: getComputedStyle(document.querySelector('#editor-map-home-btn'), '::before').content
            };
        });
        expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth);
        expect(narrowLayout.inspectorLeft).toBeGreaterThanOrEqual(0);
        expect(narrowLayout.inspectorRight).toBeLessThanOrEqual(narrowLayout.viewportWidth + 1);
        expect(narrowLayout.inspectorWidth).toBeGreaterThanOrEqual(320);
        expect(narrowLayout.inspectorTop).toBeGreaterThanOrEqual(narrowLayout.workspaceTop);
        expect(narrowLayout.inspectorBottom).toBeLessThan(narrowLayout.workspaceBottom);
        expect(narrowLayout.launcherLeft).toBeGreaterThanOrEqual(0);
        expect(narrowLayout.launcherRight).toBeLessThanOrEqual(narrowLayout.viewportWidth + 1);
        expect(narrowLayout.resizerDisplay).toBe('none');
        expect(narrowLayout.mapOverviewIcon).toBe('"⌂"');

        for (const selector of [
            '#editor-file-menu-btn',
            '[data-dm-tab="map-details"]',
            '#editor-export-btn',
            '#dm-panel-toggle',
            '#editor-reset-view-btn'
        ]) {
            const control = page.locator(selector);
            await expect(control).toBeVisible();
            const bounds = await control.boundingBox();
            expect(bounds, `${selector} should have a measurable mobile tap target`).not.toBeNull();
            expect(bounds.width, `${selector} should be at least 44px wide`).toBeGreaterThanOrEqual(44);
            expect(bounds.height, `${selector} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
        }
        for (const selector of ['#editor-access-studio-link', '#save-current-map-btn']) {
            const control = page.locator(selector);
            if (!await control.isVisible()) continue;
            const bounds = await control.boundingBox();
            expect(bounds, `${selector} should have a measurable mobile tap target`).not.toBeNull();
            expect(bounds.width, `${selector} should be at least 44px wide`).toBeGreaterThanOrEqual(44);
            expect(bounds.height, `${selector} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
        }

        await page.locator('#dm-panel-toggle').click();
        await expect(page.locator('.map-editor-workspace')).toHaveAttribute('data-inspector-collapsed', 'true');
        for (const selector of ['[data-dm-tab="map-details"]', '[data-dm-tab="feature-browser"]', '#dm-panel-toggle']) {
            const control = page.locator(selector);
            await expect(control).toBeVisible();
            const bounds = await control.boundingBox();
            expect(bounds.width).toBeGreaterThanOrEqual(44);
            expect(bounds.height).toBeGreaterThanOrEqual(44);
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        }
        await page.locator('#dm-panel-toggle').click();
        await expect(page.locator('#editor-inspector')).toBeVisible();
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-browser');
        await page.locator('#editor-feature-type-select').selectOption('regions');
        await page.locator('#editor-create-feature-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
        for (const selector of [
            '#editor-back-to-feature-list-btn',
            '#editor-finish-draw-btn',
            '#editor-reset-view-btn',
            '.leaflet-control-zoom-in',
            '.leaflet-control-zoom-out'
        ]) {
            const control = page.locator(selector);
            await expect(control).toBeVisible();
            const bounds = await control.boundingBox();
            expect(bounds, `${selector} should have a measurable mobile tap target`).not.toBeNull();
            expect(bounds.width, `${selector} should be at least 44px wide`).toBeGreaterThanOrEqual(44);
            expect(bounds.height, `${selector} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
        }
        const narrowToolbar = await page.evaluate(() => ({
            viewportWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
        }));
        expect(narrowToolbar.scrollWidth).toBeLessThanOrEqual(narrowToolbar.viewportWidth);
        await page.locator('#editor-back-to-feature-list-btn').click();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-browser');

        await page.goto(`${baseUrl}/studio`);
        await expect(page.locator('#finish-draft-button')).toBeEnabled();
        await page.locator('#dismiss-publish-button').click();
        await expect(page.locator('#publish-progress')).toBeHidden();
        await expect(page.locator('#finish-draft-button')).toBeEnabled();
        await page.locator('#finish-draft-button').click();
        await expect(page.locator('#start-draft-button')).toBeVisible();
        await expect(page.locator('#workflow-status')).toContainText('workspace is ready for another change');
        await page.goto(`${baseUrl}/studio/editor?map=workflow-map&mode=review`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await page.locator('[data-dm-tab="map-details"]').click();
        await expect(page.locator('#map-name')).toHaveValue('Workflow Map Published');
        expect(pageErrors).toEqual([]);
        expect(consoleIssues, `Failed browser responses:\n${responseIssues.join('\n') || '(none)'}`).toEqual([]);
        expect(responseIssues).toEqual([]);
    } catch (error) {
        error.message += `\nFixture server output:\n${server?.getOutput?.() || '(no output)'}`;
        throw error;
    } finally {
        await stopFixtureServer(server);
    }
});

// Real artwork in a disposable workspace makes the visual contract reviewable.
test('DM visual review and player appearance isolation', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const fixture = createFixture({ sourceRoot, fixtureRoot: testInfo.outputPath('visual-fixture') });
    fs.cpSync(path.join(sourceRoot, 'maps'), path.join(fixture.repoRoot, 'maps'), { recursive: true });
    fs.cpSync(path.join(sourceRoot, 'dist/tile'), path.join(fixture.repoRoot, 'dist/tile'), { recursive: true });
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = startFixtureServer({ sourceRoot, ...fixture, port });
    const capture = async name => {
        const file = testInfo.outputPath(`${name}.png`);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        const modalOpen = await page.locator('dialog[open]').count() > 0;
        await page.screenshot({ path: file, fullPage: !modalOpen, animations: 'disabled' });
        await testInfo.attach(name, { path: file, contentType: 'image/png' });
    };
    try {
        await waitForHealth(baseUrl, server);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${baseUrl}/studio`);
        await capture('dm-login');
        await page.locator('#studio-password').fill(STUDIO_PASSWORD);
        await page.locator('#login-form').evaluate(form => form.requestSubmit());
        await expect(page.locator('#studio-dashboard')).toBeVisible();
        await expect(page.locator('#studio-status-title')).not.toContainText('Checking');
        await capture('dm-studio');
        const player = await page.context().newPage();
        await player.goto(`${baseUrl}/?map=main_continent`);
        await expect(player.locator('#map')).toBeVisible();
        await expect(player.locator('#loading-indicator')).toBeHidden({ timeout: 30_000 });
        await player.waitForLoadState('networkidle');
        const playerPreferences = await player.evaluate(() => [localStorage.getItem('themePreference'), localStorage.getItem('theme')]);
        const playerTheme = await player.locator('html').getAttribute('data-theme');
        const before = await player.screenshot({ path: testInfo.outputPath('player-before.png'), animations: 'disabled' });
        await page.goto(`${baseUrl}/studio/editor?mode=review`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('.dm-new-map-tile #dm-new-map')).toBeVisible();
        await expect(page.locator('.dm-library-options')).not.toHaveAttribute('open', '');
        const cardBounds = await page.locator('.map-editor-library-card').first().boundingBox();
        expect(cardBounds.width).toBeLessThanOrEqual(260);
        expect(cardBounds.height).toBeLessThanOrEqual(170);
        await expect(page.locator('details[data-library-group="archived"]')).not.toHaveAttribute('open', '');
        const galleryScroll = await page.evaluate(() => {
            const selectors = ['body', '.map-editor-shell', '.map-editor-sidebar', '#editor-atlas-tree'];
            return selectors.filter(selector => {
                const element = document.querySelector(selector);
                return ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1;
            });
        });
        expect(galleryScroll, 'Only the workspace should scroll in the map library').toEqual([]);

        await page.locator('.dm-library-options > summary').click();
        await expect(page.locator('#editor-library-recent-select')).toBeVisible();
        await page.locator('.dm-library-options > summary').click();
        await capture('dm-map-library');
        await page.locator('#editor-atlas-tree [data-map-id="main_continent"]').click();
        await expect(page.locator('#editor-map .leaflet-image-layer')).toBeVisible();
        await expect.poll(() => page.locator('#editor-map .leaflet-image-layer').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        await expect.poll(async () => parseFloat(await page.locator('#editor-zoom-status').textContent())).toBeLessThan(50);
        await capture('dm-map-scale');
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await expect(page.locator('#editor-feature-type-select')).toBeVisible();
        await capture('dm-features');
        await page.locator('#editor-unified-feature-list button').first().click();
        await expect(page.locator('#editor-feature-form')).toBeVisible();
        await capture('dm-feature-detail');
        // Changing task or resizing a panel preserves a chosen zoom.
        await page.locator('.leaflet-control-zoom-in').click();
        const zoom = await page.locator('#editor-zoom-status').textContent();
        await page.locator('[data-dm-tab="map-details"]').click();
        await page.locator('[data-dm-tab="feature-browser"]').click();
        await expect(page.locator('#editor-feature-form')).toBeVisible();
        await expect(page.locator('#editor-zoom-status')).toHaveText(zoom);
        await page.locator('#editor-reset-view-btn').click();
        await page.locator('[data-dm-theme]').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await capture('dm-feature-dark');
        expect(await player.evaluate(() => [localStorage.getItem('themePreference'), localStorage.getItem('theme')])).toEqual(playerPreferences);
        await expect(player.locator('html')).toHaveAttribute('data-theme', playerTheme);
        const after = await player.screenshot({ path: testInfo.outputPath('player-after.png'), animations: 'disabled' });
        expect(after.equals(before), 'Player rendering remains pixel-identical after DM theme changes').toBe(true);
        await player.close();
        await page.locator('[data-dm-theme]').click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('[data-dm-tab="map-details"]').click();
        await page.locator('#editor-reset-view-btn').click();
        await page.evaluate(() => document.querySelector('.map-editor-shell').scrollTo(0, 0));
        await capture('dm-mobile-map-scale');
        await page.locator('#dm-panel-toggle').click();
        await expect(page.locator('#editor-map')).toBeVisible();
        await capture('dm-mobile-canvas');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${baseUrl}/studio`);
        // Creating a map prepares its editing draft without a separate setup step.
        await expect(page.locator('#new-map-button')).toBeEnabled();
        await page.locator('#new-map-button').click();
        await capture('dm-new-map');
        await page.locator('#new-map-name').fill('Review map');
        await page.locator('#new-map-file').setInputFiles(path.join(fixture.repoRoot, 'maps/base-map.webp'));
        await page.locator('summary').filter({ hasText: 'Placement & scale' }).click();
        await capture('dm-new-map-placement');
        await page.locator('summary').filter({ hasText: 'Placement & scale' }).click();
        await page.locator('summary').filter({ hasText: 'Descriptions' }).click();
        await capture('dm-new-map-copy');
        await page.locator('#review-new-map-button').click();
        await expect(page.locator('#new-map-plan-files')).toBeVisible();
        await capture('dm-new-map-review');
        await page.locator('#cancel-new-map-button').click();
        await page.locator('[data-dm-theme]').click();
        await capture('dm-studio-dark');
        await page.locator('#new-map-button').click();
        await capture('dm-new-map-dark');
    } finally {
        await stopFixtureServer(server);
    }
});

test('feature editing creates moves and persists POIs polygons and lines', async ({ page }, testInfo) => {
    const fixture = createFixture({ sourceRoot, fixtureRoot: testInfo.outputPath('feature-editing-fixture') });
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = startFixtureServer({ sourceRoot, ...fixture, port });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
        await waitForHealth(baseUrl, server);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${baseUrl}/studio`);
        await page.locator('#studio-password').fill(STUDIO_PASSWORD);
        await page.locator('#login-form').evaluate(form => form.requestSubmit());
        await expect(page.locator('#studio-dashboard')).toBeVisible();
        await page.locator('#edit-maps-button').click();
        await page.waitForURL('**/studio/editor');
        await page.goto(`${baseUrl}/studio/editor?map=base-map`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-access', 'writable');
        const workspace = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'workspace-state.json'), 'utf8')).activeDraft.root;
        const savedPath = path.join(workspace, 'maps/base-map.json');
        const readSaved = () => JSON.parse(fs.readFileSync(savedPath, 'utf8'));
        const form = page.locator('#editor-feature-form');
        const save = async () => {
            await page.locator('#save-current-map-btn').click();
            await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        };
        const snapshot = async name => {
            const screenshotPath = testInfo.outputPath(`${name}.png`);
            await page.screenshot({ path: screenshotPath, animations: 'disabled' });
            await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
        };
        const dragFirstHandle = async () => {
            const handle = page.locator('#editor-map .leaflet-marker-icon').first();
            await expect(handle).toBeVisible();
            const box = await handle.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 25, { steps: 8 });
            await page.mouse.up();
        };
        const expected = {};
        for (const [type, name, positions] of [
            ['points', 'Lantern Harbor', [[220, 190]]],
            ['regions', 'Amber Reach', [[230, 180], [400, 180], [360, 330]]],
            ['lines', 'Pilgrim Road', [[240, 210], [450, 310]]]
        ]) {
            await page.locator('[data-dm-tab="feature-browser"]').click();
            if (await page.locator('#map-editor-app').getAttribute('data-mode') === 'feature-edit') {
                await page.locator('#editor-back-to-feature-list-btn').click();
            }
            await page.locator('#editor-feature-type-select').selectOption(type);
            await page.locator('#editor-create-feature-btn').click();
            await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'draw');
            for (const [x, y] of positions) await page.locator('#editor-map').click({ position: { x, y } });
            if (type !== 'points') await page.locator('#editor-finish-draw-btn').click();
            await expect(page.locator('#map-editor-app')).toHaveAttribute('data-mode', 'feature-edit');
            await form.locator('[data-field="name"]').fill(name);
            await form.locator('[data-field="name"]').press('Tab');
            await form.locator('[data-field="type"]').fill(type === 'points' ? 'Harbor' : type === 'regions' ? 'Province' : 'Road');
            await form.locator('[data-field="type"]').press('Tab');
            await form.locator('[data-field="summary"]').fill(`Surveyed ${name}`);
            await form.locator('[data-field="summary"]').press('Tab');
            await save();
            const collection = type === 'points' ? 'pointsOfInterest' : type;
            const beforeMove = readSaved()[collection][0];
            const positionBefore = type === 'points' ? beforeMove.coords : beforeMove.coordinates;
            await dragFirstHandle();
            await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
            await page.locator('#editor-undo-btn').click();
            await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'false');
            await page.locator('#editor-redo-btn').click();
            await expect(page.locator('#map-editor-app')).toHaveAttribute('data-dirty', 'true');
            await save();
            const afterMove = readSaved()[collection][0];
            expect(type === 'points' ? afterMove.coords : afterMove.coordinates).not.toEqual(positionBefore);
            expect(afterMove.name).toBe(name);
            expect(afterMove.summary).toBe(`Surveyed ${name}`);
            expected[collection] = afterMove;
            await snapshot(`editable-${type}`);
        }
        await page.reload();
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await page.locator('[data-dm-tab="feature-browser"]').click();
        for (const [type, collection] of [['points', 'pointsOfInterest'], ['regions', 'regions'], ['lines', 'lines']]) {
            await page.locator('#editor-feature-type-select').selectOption(type);
            await expect(page.locator('#editor-unified-feature-list')).toContainText(expected[collection].name);
            expect(readSaved()[collection]).toEqual([expected[collection]]);
        }
        expect(JSON.parse(fs.readFileSync(path.join(fixture.repoRoot, 'maps/base-map.json'), 'utf8')).pointsOfInterest).toEqual([]);
        expect(pageErrors).toEqual([]);
    } finally {
        await stopFixtureServer(server);
    }
});

test('review opens a writable draft directly and preserves the selected map', async ({ page }, testInfo) => {
    const fixture = createFixture({ sourceRoot, fixtureRoot: testInfo.outputPath('direct-edit-fixture') });
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = startFixtureServer({ sourceRoot, ...fixture, port });
    try {
        await waitForHealth(baseUrl, server);
        await page.goto(`${baseUrl}/studio`);
        await page.locator('#studio-password').fill(STUDIO_PASSWORD);
        await page.locator('#login-form').evaluate(form => form.requestSubmit());
        await expect(page.locator('#edit-maps-button')).toBeEnabled();
        await page.goto(`${baseUrl}/studio/editor?map=base-map&mode=review`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-loading', 'false');
        await expect(page.locator('#editor-access-studio-link')).toHaveText('Start editing');
        await page.locator('#editor-access-studio-link').click();
        await page.waitForURL(`${baseUrl}/studio/editor?map=base-map`);
        await expect(page.locator('#map-editor-app')).toHaveAttribute('data-access', 'writable');
        await expect(page.locator('#map-name')).toBeEnabled();
        await page.locator('#map-name').fill('Direct editing works');
        await page.locator('#save-current-map-btn').click();
        await expect(page.locator('#editor-save-state-title')).toContainText('All changes saved');
        await page.locator('#editor-export-btn').click();
        await page.locator('#editor-export-build-preview-btn').click();
        await expect(page.locator('#editor-export-status')).toContainText('Built live preview', { timeout: 20_000 });
        const draft = JSON.parse(fs.readFileSync(path.join(fixture.draftsRoot, 'workspace-state.json'), 'utf8')).activeDraft;
        expect(JSON.parse(fs.readFileSync(path.join(draft.root, 'maps/base-map.json'), 'utf8')).name).toBe('Direct editing works');
        await page.reload();
        await expect(page.locator('#map-name')).toHaveValue('Direct editing works');
    } finally { await stopFixtureServer(server); }
});
