(function () {
    const dom = {
        login: document.getElementById('studio-login'),
        dashboard: document.getElementById('studio-dashboard'),
        loginForm: document.getElementById('login-form'),
        password: document.getElementById('studio-password'),
        loginStatus: document.getElementById('login-status'),
        logoutButton: document.getElementById('logout-button'),
        statusTitle: document.getElementById('studio-status-title'),
        statusSummary: document.getElementById('studio-status-summary'),
        statusChip: document.getElementById('studio-status-chip'),
        statusStrip: document.querySelector('.status-strip'),
        branchChip: document.getElementById('studio-branch-chip'),
        workspaceDetails: document.getElementById('workspace-details'),
        workflowTitle: document.getElementById('workflow-title'),
        workflowSummary: document.getElementById('workflow-summary'),
        workspaceCapabilityNote: document.getElementById('workspace-capability-note'),
        githubSetupDetails: document.getElementById('github-setup-details'),
        githubSetupLabel: document.getElementById('github-setup-label'),
        githubSetupSummary: document.getElementById('github-setup-summary'),
        githubSetupSteps: document.getElementById('github-setup-steps'),
        checkGithubButton: document.getElementById('check-github-button'),
        githubCheckStatus: document.getElementById('github-check-status'),
        draftTitle: document.getElementById('draft-title'),
        draftDescription: document.getElementById('draft-description'),
        startDraftButton: document.getElementById('start-draft-button'),
        continueEditingLink: document.getElementById('continue-editing-link'),
        publishButton: document.getElementById('publish-button'),
        finishDraftButton: document.getElementById('finish-draft-button'),
        abandonDraftButton: document.getElementById('abandon-draft-button'),
        workflowStatus: document.getElementById('workflow-status'),
        newMapButton: document.getElementById('new-map-button'),
        publishProgress: document.getElementById('publish-progress'),
        publishProgressStatus: document.getElementById('publish-progress-status'),
        publishOutput: document.getElementById('publish-output'),
        resumePublishButton: document.getElementById('resume-publish-button'),
        dismissPublishButton: document.getElementById('dismiss-publish-button'),
        newMapDialog: document.getElementById('new-map-dialog'),
        newMapForm: document.getElementById('new-map-form'),
        closeNewMapButton: document.getElementById('close-new-map-button'),
        cancelNewMapButton: document.getElementById('cancel-new-map-button'),
        newMapName: document.getElementById('new-map-name'),
        newMapId: document.getElementById('new-map-id'),
        newMapParent: document.getElementById('new-map-parent'),
        newMapFile: document.getElementById('new-map-file'),
        newMapScalePixels: document.getElementById('new-map-scale-pixels'),
        newMapScaleKilometers: document.getElementById('new-map-scale-kilometers'),
        newMapSelectorDescription: document.getElementById('new-map-selector-description'),
        newMapBlurb: document.getElementById('new-map-blurb'),
        newMapArtworkTitle: document.getElementById('new-map-artwork-title'),
        newMapArtworkMeta: document.getElementById('new-map-artwork-meta'),
        newMapPreviewImage: document.getElementById('new-map-preview-image'),
        newMapPreviewEmpty: document.getElementById('new-map-preview-empty'),
        newMapPlan: document.getElementById('new-map-plan'),
        newMapPreprocessing: document.getElementById('new-map-preprocessing'),
        newMapPlanFiles: document.getElementById('new-map-plan-files'),
        reviewNewMapButton: document.getElementById('review-new-map-button'),
        newMapStatus: document.getElementById('new-map-status'),
        createNewMapButton: document.getElementById('create-new-map-button'),
        abandonDraftDialog: document.getElementById('abandon-draft-dialog'),
        abandonDraftForm: document.getElementById('abandon-draft-form'),
        abandonDraftCopy: document.getElementById('abandon-draft-copy'),
        abandonDraftBranch: document.getElementById('abandon-draft-branch'),
        abandonDraftConfirmation: document.getElementById('abandon-draft-confirmation'),
        abandonDraftStatus: document.getElementById('abandon-draft-status'),
        closeAbandonDraftButton: document.getElementById('close-abandon-draft-button'),
        cancelAbandonDraftButton: document.getElementById('cancel-abandon-draft-button'),
        confirmAbandonDraftButton: document.getElementById('confirm-abandon-draft-button')
    };

    let csrfToken = '';
    let workspace = null;
    let readiness = null;
    let publishPollTimer = null;
    let mapIdWasEdited = false;
    let newMapPlanSignature = '';
    let newMapPreviewUrl = '';

    async function readJsonResponse(response) {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
            throw new Error(payload?.error || `Request failed with HTTP ${response.status}.`);
        }
        return payload;
    }

    function showAuthenticated(authenticated) {
        dom.login.hidden = authenticated;
        dom.dashboard.hidden = !authenticated;
        if (!authenticated) dom.password.focus();
    }

    async function refreshReadiness() {
        try {
            const response = await fetch('/api/editor/status', { cache: 'no-store' });
            const payload = await readJsonResponse(response);
            readiness = payload.readiness || {};
            renderStudioPresentation();
        } catch (error) {
            readiness = { topStatus: 'Failed', error: error.message };
            dom.statusTitle.textContent = 'Workspace check failed';
            dom.statusSummary.textContent = error.message;
            dom.statusChip.textContent = 'Failed';
            dom.statusChip.className = 'status-chip danger';
            dom.statusStrip.dataset.tone = 'danger';
            renderWorkspaceDetails(error.stack || error.message);
        }
    }

    function renderWorkspaceDetails(fallback = '') {
        dom.workspaceDetails.textContent = workspace || readiness
            ? JSON.stringify({ workspace, readiness }, null, 2)
            : fallback || 'Workspace information is not available.';
    }

    function renderPipeline(stages) {
        stages.forEach((stage) => {
            const item = document.getElementById(`pipeline-${stage.id}`);
            if (!item) return;
            item.dataset.state = stage.state;
            const detail = item.querySelector('small');
            if (detail) detail.textContent = stage.detail;
        });
    }

    function renderGitHubSetup(configuration, checkResult = null) {
        const setup = configuration.setup || {};
        const configured = configuration.configured === true;
        const repositoryLabel = configuration.owner && configuration.repo
            ? `${configuration.owner}/${configuration.repo}`
            : 'the map repository';
        dom.githubSetupLabel.textContent = configured ? 'Configuration ready' : 'Setup required';
        dom.githubSetupSummary.textContent = checkResult?.message || (configured
            ? `Repository-scoped credentials are mounted for ${repositoryLabel}. Run the live check before publishing.`
            : 'Complete the following host configuration before Studio can create a draft pull request.');
        dom.checkGithubButton.disabled = !configured;

        const steps = checkResult?.remediation || setup.remediation || [];
        dom.githubSetupSteps.replaceChildren();
        steps.forEach((step) => {
            const item = document.createElement('li');
            item.textContent = step;
            dom.githubSetupSteps.appendChild(item);
        });

        if (checkResult) {
            dom.githubCheckStatus.dataset.tone = checkResult.ok ? 'good' : 'danger';
            dom.githubCheckStatus.textContent = checkResult.message;
        } else {
            dom.githubCheckStatus.textContent = '';
            delete dom.githubCheckStatus.dataset.tone;
        }
    }

    function renderStudioPresentation() {
        if (!workspace || !window.MapStudioModel) {
            renderWorkspaceDetails();
            return;
        }
        const presentation = window.MapStudioModel.deriveWorkspacePresentation(workspace, readiness || {});
        const capabilities = workspace.capabilities || {};
        dom.statusTitle.textContent = presentation.title;
        dom.statusSummary.textContent = presentation.summary;
        dom.statusChip.textContent = presentation.statusLabel;
        dom.statusChip.className = `status-chip ${presentation.statusTone}`;
        dom.statusStrip.dataset.tone = presentation.statusTone;
        dom.branchChip.textContent = presentation.branch;
        dom.branchChip.title = presentation.branch;
        dom.workflowTitle.textContent = presentation.title;
        dom.workflowSummary.textContent = presentation.summary;
        renderPipeline(presentation.stages);

        dom.startDraftButton.hidden = presentation.editable;
        dom.startDraftButton.disabled = capabilities.canStartDraft !== true;
        dom.continueEditingLink.hidden = !presentation.editable;
        dom.publishButton.disabled = capabilities.canPublish !== true;
        dom.finishDraftButton.disabled = capabilities.canFinishDraft !== true;
        dom.abandonDraftButton.hidden = !presentation.activeDraft;
        dom.abandonDraftButton.disabled = capabilities.canAbandonDraft !== true;
        dom.newMapButton.disabled = capabilities.canCreateMap !== true;
        renderGitHubSetup(workspace.github || {});

        if (presentation.githubReady) {
            dom.workspaceCapabilityNote.dataset.tone = 'good';
            dom.workspaceCapabilityNote.textContent = presentation.activeDraft
                ? 'GitHub review is connected. Valid drafts can be published as pull requests.'
                : 'GitHub review is connected. Start a Studio draft to use automated publishing.';
        } else if (presentation.editable) {
            dom.workspaceCapabilityNote.dataset.tone = 'warning';
            dom.workspaceCapabilityNote.textContent = 'Local editing is available. Connect a GitHub App or repository-scoped token when you are ready to create draft pull requests.';
        } else {
            dom.workspaceCapabilityNote.dataset.tone = 'neutral';
            dom.workspaceCapabilityNote.textContent = 'You can start a local draft without GitHub credentials. Publishing remains locked until GitHub is connected.';
        }

        if (presentation.unsupportedCount > 0) {
            dom.workflowStatus.textContent = `Studio will not publish unsupported files: ${workspace.unsupportedChanges.join(', ')}`;
        } else if (workspace.mode === 'detached') {
            dom.workflowStatus.textContent = 'Switch this checkout to a named branch before editing.';
        } else {
            dom.workflowStatus.textContent = '';
        }
        renderWorkspaceDetails();
    }

    function renderWorkspace(nextWorkspace) {
        workspace = nextWorkspace;
        renderStudioPresentation();
    }

    async function refreshWorkspace() {
        const response = await fetch('/api/studio/workspace', { cache: 'no-store' });
        const payload = await readJsonResponse(response);
        renderWorkspace(payload.workspace);
        if (payload.publishJob) renderPublishJob(payload.publishJob);
    }

    function renderPublishJob(job) {
        if (!job) {
            dom.publishProgress.hidden = true;
            return;
        }
        dom.publishProgress.hidden = false;
        dom.publishProgress.querySelectorAll('a').forEach((item) => item.remove());
        if (job.status === 'running') {
            dom.publishProgressStatus.textContent = 'Running the complete release check…';
        } else if (job.status === 'complete') {
            dom.publishProgressStatus.textContent = `Draft pull request #${job.result?.pullRequestNumber} is ready for review.`;
        } else if (job.status === 'interrupted') {
            dom.publishProgressStatus.textContent = job.error || 'Publication was interrupted. Resume it when ready.';
        } else {
            dom.publishProgressStatus.textContent = `Publication failed: ${job.error || 'Unknown error'}`;
        }
        dom.publishOutput.textContent = (job.recentOutput || []).join('\n');
        dom.resumePublishButton.hidden = job.canResume !== true;
        dom.dismissPublishButton.hidden = job.canDismiss !== true;
        if (job.status === 'complete' && job.result?.pullRequestUrl) {
            const link = document.createElement('a');
            link.href = job.result.pullRequestUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'primary-action';
            link.textContent = 'Open draft pull request';
            dom.publishProgress.appendChild(link);
        }
        if (job.status !== 'running' && publishPollTimer) {
            clearTimeout(publishPollTimer);
            publishPollTimer = null;
        }
    }

    async function pollPublishJob() {
        const response = await fetch('/api/studio/publish-status', { cache: 'no-store' });
        const payload = await readJsonResponse(response);
        renderPublishJob(payload.publishJob);
        if (payload.publishJob.status === 'running') {
            publishPollTimer = setTimeout(() => pollPublishJob().catch((error) => {
                dom.publishProgressStatus.textContent = error.message;
            }), 1200);
        } else {
            await Promise.all([refreshReadiness(), refreshWorkspace()]);
        }
    }

    async function postPublishRecovery(pathname, pendingMessage) {
        dom.resumePublishButton.disabled = true;
        dom.dismissPublishButton.disabled = true;
        dom.publishProgressStatus.textContent = pendingMessage;
        try {
            const response = await fetch(pathname, {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrfToken }
            });
            const payload = await readJsonResponse(response);
            renderPublishJob(payload.publishJob);
            if (payload.publishJob?.status === 'running') pollPublishJob();
            await refreshWorkspace();
        } catch (error) {
            dom.publishProgressStatus.textContent = error.message;
        } finally {
            dom.resumePublishButton.disabled = false;
            dom.dismissPublishButton.disabled = false;
        }
    }

    function slugifyMapId(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
    }

    function encodeBase64UrlJson(value) {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        let binary = '';
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function getNewMapArtwork() {
        return dom.newMapFile.files?.[0] || null;
    }

    function getNewMapArtworkContentType(artwork) {
        const declaredType = String(artwork?.type || '').toLowerCase();
        if (['image/webp', 'image/png', 'image/jpeg'].includes(declaredType)) return declaredType;
        const fileName = String(artwork?.name || '').toLowerCase();
        if (fileName.endsWith('.webp')) return 'image/webp';
        if (fileName.endsWith('.png')) return 'image/png';
        if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
        return '';
    }

    function getNewMapMetadata(artwork = getNewMapArtwork()) {
        return {
            id: dom.newMapId.value.trim(),
            name: dom.newMapName.value.trim(),
            parentId: dom.newMapParent.value,
            scalePixels: dom.newMapScalePixels.value,
            scaleKilometers: dom.newMapScaleKilometers.value,
            selectorDescription: dom.newMapSelectorDescription.value.trim(),
            blurb: dom.newMapBlurb.value.trim(),
            artworkContentType: getNewMapArtworkContentType(artwork)
        };
    }

    function getNewMapPlanSignature() {
        const artwork = getNewMapArtwork();
        if (!artwork) return '';
        return JSON.stringify({
            metadata: getNewMapMetadata(artwork),
            artwork: {
                name: artwork.name,
                size: artwork.size,
                type: artwork.type,
                lastModified: artwork.lastModified
            }
        });
    }

    function invalidateNewMapPlan() {
        newMapPlanSignature = '';
        dom.newMapPlan.hidden = true;
        dom.newMapPlanFiles.replaceChildren();
        if (dom.newMapForm.dataset.busy !== 'true') dom.createNewMapButton.disabled = true;
    }

    function clearNewMapPreview() {
        if (newMapPreviewUrl) URL.revokeObjectURL(newMapPreviewUrl);
        newMapPreviewUrl = '';
        dom.newMapPreviewImage.onload = null;
        dom.newMapPreviewImage.onerror = null;
        dom.newMapPreviewImage.removeAttribute('src');
        dom.newMapPreviewImage.hidden = true;
        dom.newMapPreviewEmpty.hidden = false;
        dom.newMapArtworkTitle.textContent = 'Choose an image to inspect it';
        dom.newMapArtworkMeta.textContent = 'WebP files are preserved. PNG and JPEG files are converted to high-quality WebP during creation.';
    }

    function renderNewMapArtworkPreview() {
        clearNewMapPreview();
        const artwork = getNewMapArtwork();
        if (!artwork) return;
        const artworkContentType = getNewMapArtworkContentType(artwork);
        if (!artworkContentType) {
            dom.newMapStatus.textContent = 'Map artwork must be a WebP, PNG, or JPEG image.';
            return;
        }

        newMapPreviewUrl = URL.createObjectURL(artwork);
        dom.newMapPreviewImage.onload = () => {
            const sizeMiB = (artwork.size / (1024 * 1024)).toFixed(1);
            const conversion = artworkContentType === 'image/webp'
                ? 'Original WebP will be preserved.'
                : 'Studio will convert this to a high-quality WebP.';
            dom.newMapArtworkTitle.textContent = artwork.name;
            dom.newMapArtworkMeta.textContent = `${dom.newMapPreviewImage.naturalWidth} × ${dom.newMapPreviewImage.naturalHeight} pixels · ${sizeMiB} MiB. ${conversion}`;
        };
        dom.newMapPreviewImage.onerror = () => {
            dom.newMapStatus.textContent = 'The selected artwork could not be previewed as an image.';
            clearNewMapPreview();
        };
        dom.newMapPreviewImage.src = newMapPreviewUrl;
        dom.newMapPreviewImage.hidden = false;
        dom.newMapPreviewEmpty.hidden = true;
    }

    function renderNewMapPlan(plan) {
        dom.newMapPreprocessing.textContent = plan.preprocessing;
        dom.newMapPlanFiles.replaceChildren();
        plan.files.forEach((file) => {
            const row = document.createElement('tr');
            [file.action, file.path, file.purpose].forEach((value) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            dom.newMapPlanFiles.appendChild(row);
        });
        dom.newMapPlan.hidden = false;
    }

    async function openNewMapDialog() {
        dom.newMapStatus.textContent = 'Loading atlas structure…';
        dom.newMapParent.innerHTML = '<option value="">Top level</option>';
        dom.newMapDialog.showModal();
        try {
            const response = await fetch('/api/studio/map-options', { cache: 'no-store' });
            const payload = await readJsonResponse(response);
            payload.parents.forEach((parent) => {
                const option = document.createElement('option');
                option.value = parent.id;
                option.textContent = parent.name;
                dom.newMapParent.appendChild(option);
            });
            dom.newMapStatus.textContent = '';
            dom.newMapName.focus();
        } catch (error) {
            dom.newMapStatus.textContent = error.message;
        }
    }

    function closeNewMapDialog() {
        if (dom.newMapForm.dataset.busy === 'true') return;
        clearNewMapPreview();
        dom.newMapDialog.close();
    }

    async function refreshSession() {
        const response = await fetch('/api/studio/session', { cache: 'no-store' });
        const payload = await readJsonResponse(response);
        csrfToken = payload.csrfToken || '';
        showAuthenticated(payload.authenticated === true);
        if (payload.authenticated) await Promise.all([refreshReadiness(), refreshWorkspace()]);
    }

    dom.loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        dom.loginStatus.textContent = 'Signing in…';
        try {
            const response = await fetch('/api/studio/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: dom.password.value })
            });
            const payload = await readJsonResponse(response);
            csrfToken = payload.csrfToken || '';
            dom.password.value = '';
            dom.loginStatus.textContent = '';
            showAuthenticated(true);
            await Promise.all([refreshReadiness(), refreshWorkspace()]);
        } catch (error) {
            dom.loginStatus.textContent = error.message;
            dom.password.select();
        }
    });

    dom.logoutButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/studio/logout', {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrfToken }
            });
            await readJsonResponse(response);
        } finally {
            csrfToken = '';
            showAuthenticated(false);
        }
    });

    dom.checkGithubButton.addEventListener('click', async () => {
        dom.checkGithubButton.disabled = true;
        dom.githubCheckStatus.dataset.tone = 'neutral';
        dom.githubCheckStatus.textContent = 'Checking repository and pull-request access…';
        try {
            const response = await fetch('/api/studio/github/check', { cache: 'no-store' });
            const payload = await readJsonResponse(response);
            renderGitHubSetup(workspace?.github || {}, payload.result);
        } catch (error) {
            dom.githubCheckStatus.dataset.tone = 'danger';
            dom.githubCheckStatus.textContent = error.message;
        } finally {
            dom.checkGithubButton.disabled = workspace?.github?.configured !== true;
        }
    });

    dom.startDraftButton.addEventListener('click', async () => {
        const title = dom.draftTitle.value.trim();
        if (!title) {
            dom.workflowStatus.textContent = 'Enter a change title first.';
            dom.draftTitle.focus();
            return;
        }
        dom.startDraftButton.disabled = true;
        dom.workflowStatus.textContent = 'Fetching main and creating the draft branch…';
        try {
            const response = await fetch('/api/studio/drafts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ title })
            });
            const payload = await readJsonResponse(response);
            renderWorkspace(payload.workspace);
            dom.workflowStatus.textContent = payload.workspace?.github?.configured
                ? 'Draft started from the latest main branch. The editor is ready.'
                : 'Local draft started. The editor is ready; connect GitHub later to publish.';
        } catch (error) {
            await refreshWorkspace().catch(() => {});
            dom.workflowStatus.textContent = error.message;
        }
    });

    dom.publishButton.addEventListener('click', async () => {
        const title = dom.draftTitle.value.trim();
        if (!title) {
            dom.workflowStatus.textContent = 'Enter a pull request title first.';
            dom.draftTitle.focus();
            return;
        }
        dom.publishButton.disabled = true;
        dom.workflowStatus.textContent = 'Starting complete validation…';
        try {
            const response = await fetch('/api/studio/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    title,
                    description: dom.draftDescription.value.trim()
                })
            });
            const payload = await readJsonResponse(response);
            renderPublishJob(payload.publishJob);
            pollPublishJob().catch((error) => {
                dom.publishProgressStatus.textContent = error.message;
            });
        } catch (error) {
            await refreshWorkspace().catch(() => {});
            dom.workflowStatus.textContent = error.message;
        }
    });

    dom.resumePublishButton.addEventListener('click', () => {
        postPublishRecovery('/api/studio/publish/resume', 'Resuming publication…');
    });
    dom.dismissPublishButton.addEventListener('click', () => {
        postPublishRecovery('/api/studio/publish/dismiss', 'Dismissing the saved job status…');
    });

    dom.finishDraftButton.addEventListener('click', async () => {
        dom.finishDraftButton.disabled = true;
        dom.workflowStatus.textContent = 'Checking that the pull request was merged and syncing main…';
        try {
            const response = await fetch('/api/studio/drafts/finish', {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrfToken }
            });
            const payload = await readJsonResponse(response);
            renderWorkspace(payload.workspace);
            dom.workflowStatus.textContent = 'Merged draft finished. The workspace is ready for another change.';
        } catch (error) {
            await refreshWorkspace().catch(() => {});
            dom.workflowStatus.textContent = error.message;
        }
    });

    function closeAbandonDraftDialog() {
        if (dom.confirmAbandonDraftButton.dataset.busy === 'true') return;
        dom.abandonDraftDialog.close();
    }

    dom.abandonDraftButton.addEventListener('click', () => {
        const branch = workspace?.draft?.branch || workspace?.branch || '';
        const changeCount = Array.isArray(workspace?.changedPaths) ? workspace.changedPaths.length : 0;
        dom.abandonDraftBranch.textContent = branch;
        dom.abandonDraftConfirmation.value = '';
        dom.abandonDraftConfirmation.dataset.expected = branch;
        dom.confirmAbandonDraftButton.disabled = true;
        dom.abandonDraftStatus.textContent = '';
        dom.abandonDraftCopy.textContent = changeCount > 0
            ? `This permanently removes the isolated worktree, its local branch, and ${changeCount} uncommitted changed ${changeCount === 1 ? 'file' : 'files'}. A remote branch is not deleted.`
            : 'This removes the isolated worktree and its local branch. A remote branch is not deleted.';
        dom.abandonDraftDialog.showModal();
        dom.abandonDraftConfirmation.focus();
    });

    dom.abandonDraftConfirmation.addEventListener('input', () => {
        dom.confirmAbandonDraftButton.disabled = dom.abandonDraftConfirmation.value !== dom.abandonDraftConfirmation.dataset.expected;
    });
    dom.closeAbandonDraftButton.addEventListener('click', closeAbandonDraftDialog);
    dom.cancelAbandonDraftButton.addEventListener('click', closeAbandonDraftDialog);
    dom.abandonDraftForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const confirmBranch = dom.abandonDraftConfirmation.value;
        dom.confirmAbandonDraftButton.dataset.busy = 'true';
        dom.confirmAbandonDraftButton.disabled = true;
        dom.cancelAbandonDraftButton.disabled = true;
        dom.closeAbandonDraftButton.disabled = true;
        dom.abandonDraftStatus.textContent = 'Removing the isolated workspace…';
        try {
            const response = await fetch('/api/studio/drafts/abandon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ confirmBranch })
            });
            const payload = await readJsonResponse(response);
            renderWorkspace(payload.workspace);
            dom.abandonDraftDialog.close();
            dom.workflowStatus.textContent = 'Local draft abandoned. The base checkout was not changed.';
        } catch (error) {
            dom.abandonDraftStatus.textContent = error.message;
        } finally {
            dom.confirmAbandonDraftButton.dataset.busy = 'false';
            dom.cancelAbandonDraftButton.disabled = false;
            dom.closeAbandonDraftButton.disabled = false;
            dom.confirmAbandonDraftButton.disabled = dom.abandonDraftConfirmation.value !== dom.abandonDraftConfirmation.dataset.expected;
        }
    });

    dom.newMapButton.addEventListener('click', () => {
        mapIdWasEdited = false;
        newMapPlanSignature = '';
        dom.newMapForm.reset();
        dom.newMapForm.dataset.busy = 'false';
        dom.createNewMapButton.disabled = true;
        dom.newMapPlan.hidden = true;
        dom.newMapPlanFiles.replaceChildren();
        clearNewMapPreview();
        openNewMapDialog();
    });
    dom.closeNewMapButton.addEventListener('click', closeNewMapDialog);
    dom.cancelNewMapButton.addEventListener('click', closeNewMapDialog);
    dom.newMapId.addEventListener('input', () => { mapIdWasEdited = true; });
    dom.newMapName.addEventListener('input', () => {
        if (!mapIdWasEdited) dom.newMapId.value = slugifyMapId(dom.newMapName.value);
    });
    dom.newMapForm.addEventListener('input', invalidateNewMapPlan);
    dom.newMapForm.addEventListener('change', (event) => {
        invalidateNewMapPlan();
        if (event.target === dom.newMapFile) renderNewMapArtworkPreview();
    });

    dom.reviewNewMapButton.addEventListener('click', async () => {
        if (!dom.newMapForm.reportValidity()) return;
        const artwork = getNewMapArtwork();
        if (!artwork) {
            dom.newMapStatus.textContent = 'Choose map artwork before reviewing the plan.';
            return;
        }
        const artworkContentType = getNewMapArtworkContentType(artwork);
        if (!artworkContentType) {
            dom.newMapStatus.textContent = 'Map artwork must be a WebP, PNG, or JPEG image.';
            return;
        }

        dom.reviewNewMapButton.disabled = true;
        dom.newMapStatus.textContent = 'Checking the map ID, atlas placement, and generated files…';
        try {
            const response = await fetch('/api/studio/maps/plan', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify(getNewMapMetadata(artwork))
            });
            const payload = await readJsonResponse(response);
            renderNewMapPlan(payload.plan);
            newMapPlanSignature = getNewMapPlanSignature();
            dom.createNewMapButton.disabled = false;
            dom.newMapStatus.textContent = 'Plan is ready. Review the artwork and file list, then create the map.';
        } catch (error) {
            invalidateNewMapPlan();
            dom.newMapStatus.textContent = error.message;
        } finally {
            dom.reviewNewMapButton.disabled = false;
        }
    });

    dom.newMapForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const artwork = getNewMapArtwork();
        if (!artwork) {
            dom.newMapStatus.textContent = 'Choose map artwork.';
            return;
        }
        if (!newMapPlanSignature || newMapPlanSignature !== getNewMapPlanSignature()) {
            invalidateNewMapPlan();
            dom.newMapStatus.textContent = 'Review the map plan again before creating files.';
            return;
        }
        const metadata = getNewMapMetadata(artwork);
        dom.newMapForm.dataset.busy = 'true';
        dom.createNewMapButton.disabled = true;
        dom.reviewNewMapButton.disabled = true;
        dom.cancelNewMapButton.disabled = true;
        dom.closeNewMapButton.disabled = true;
        const artworkContentType = getNewMapArtworkContentType(artwork);
        dom.newMapStatus.textContent = artworkContentType === 'image/webp'
            ? 'Uploading artwork, creating map files, and validating the atlas…'
            : 'Uploading and converting artwork, creating map files, and validating the atlas…';
        try {
            const response = await fetch('/api/studio/maps', {
                method: 'POST',
                headers: {
                    'Content-Type': artworkContentType,
                    'X-CSRF-Token': csrfToken,
                    'X-Map-Metadata': encodeBase64UrlJson(metadata)
                },
                body: artwork
            });
            const payload = await readJsonResponse(response);
            dom.newMapStatus.textContent = `Created ${payload.result.map.name}. Opening the editor…`;
            await refreshWorkspace();
            setTimeout(() => {
                window.location.href = `/studio/editor?map=${encodeURIComponent(payload.result.map.id)}`;
            }, 500);
        } catch (error) {
            dom.newMapStatus.textContent = error.message;
            dom.createNewMapButton.disabled = newMapPlanSignature !== getNewMapPlanSignature();
            dom.reviewNewMapButton.disabled = false;
            dom.cancelNewMapButton.disabled = false;
            dom.closeNewMapButton.disabled = false;
            dom.newMapForm.dataset.busy = 'false';
        }
    });

    refreshSession().catch((error) => {
        showAuthenticated(false);
        dom.loginStatus.textContent = error.message;
    });
}());
