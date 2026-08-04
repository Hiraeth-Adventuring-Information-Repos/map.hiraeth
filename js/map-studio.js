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
        draftTitle: document.getElementById('draft-title'),
        draftDescription: document.getElementById('draft-description'),
        startDraftButton: document.getElementById('start-draft-button'),
        continueEditingLink: document.getElementById('continue-editing-link'),
        publishButton: document.getElementById('publish-button'),
        finishDraftButton: document.getElementById('finish-draft-button'),
        workflowStatus: document.getElementById('workflow-status'),
        newMapButton: document.getElementById('new-map-button'),
        publishProgress: document.getElementById('publish-progress'),
        publishProgressStatus: document.getElementById('publish-progress-status'),
        publishOutput: document.getElementById('publish-output'),
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
        newMapStatus: document.getElementById('new-map-status'),
        createNewMapButton: document.getElementById('create-new-map-button')
    };

    let csrfToken = '';
    let workspace = null;
    let readiness = null;
    let publishPollTimer = null;
    let mapIdWasEdited = false;

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
        dom.newMapButton.disabled = capabilities.canCreateMap !== true;

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
        if (!job) return;
        dom.publishProgress.hidden = false;
        dom.publishProgressStatus.textContent = job.status === 'running'
            ? 'Running the complete release check…'
            : (job.status === 'complete'
                ? `Draft pull request #${job.result?.pullRequestNumber} is ready for review.`
                : `Publication failed: ${job.error || 'Unknown error'}`);
        dom.publishOutput.textContent = (job.recentOutput || []).join('\n');
        if (job.status === 'complete' && job.result?.pullRequestUrl) {
            const link = document.createElement('a');
            link.href = job.result.pullRequestUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'primary-action';
            link.textContent = 'Open draft pull request';
            dom.publishProgress.querySelectorAll('a').forEach((item) => item.remove());
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
        if (dom.createNewMapButton.disabled) return;
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
            dom.workflowStatus.textContent = error.message;
            await refreshWorkspace().catch(() => {});
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
            dom.workflowStatus.textContent = error.message;
            await refreshWorkspace().catch(() => {});
        }
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
            dom.workflowStatus.textContent = error.message;
            await refreshWorkspace().catch(() => {});
        }
    });

    dom.newMapButton.addEventListener('click', () => {
        mapIdWasEdited = false;
        dom.newMapForm.reset();
        openNewMapDialog();
    });
    dom.closeNewMapButton.addEventListener('click', closeNewMapDialog);
    dom.cancelNewMapButton.addEventListener('click', closeNewMapDialog);
    dom.newMapId.addEventListener('input', () => { mapIdWasEdited = true; });
    dom.newMapName.addEventListener('input', () => {
        if (!mapIdWasEdited) dom.newMapId.value = slugifyMapId(dom.newMapName.value);
    });

    dom.newMapForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const artwork = dom.newMapFile.files[0];
        if (!artwork) {
            dom.newMapStatus.textContent = 'Choose a WebP map image.';
            return;
        }
        if (artwork.type && artwork.type !== 'image/webp') {
            dom.newMapStatus.textContent = 'Map artwork must be a WebP image.';
            return;
        }
        const metadata = {
            id: dom.newMapId.value.trim(),
            name: dom.newMapName.value.trim(),
            parentId: dom.newMapParent.value,
            scalePixels: dom.newMapScalePixels.value,
            scaleKilometers: dom.newMapScaleKilometers.value,
            selectorDescription: dom.newMapSelectorDescription.value.trim(),
            blurb: dom.newMapBlurb.value.trim()
        };
        dom.createNewMapButton.disabled = true;
        dom.cancelNewMapButton.disabled = true;
        dom.closeNewMapButton.disabled = true;
        dom.newMapStatus.textContent = 'Uploading artwork, creating map files, and validating the atlas…';
        try {
            const response = await fetch('/api/studio/maps', {
                method: 'POST',
                headers: {
                    'Content-Type': 'image/webp',
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
            dom.createNewMapButton.disabled = false;
            dom.cancelNewMapButton.disabled = false;
            dom.closeNewMapButton.disabled = false;
        }
    });

    refreshSession().catch((error) => {
        showAuthenticated(false);
        dom.loginStatus.textContent = error.message;
    });
}());
