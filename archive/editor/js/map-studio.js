(function () {
    // DM appearance is independent of the public map preference.
    function applyDmTheme(theme) {
        const dark = theme === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        document.querySelectorAll('[data-dm-theme]').forEach(button => {
            button.setAttribute('aria-pressed', String(dark));
            button.title = dark ? 'Use parchment theme' : 'Use dark theme';
        });
    }
    let dmTheme = 'light';
    try { dmTheme = localStorage.getItem('hiraethDmTheme') || 'light'; } catch (_) {}
    applyDmTheme(dmTheme);
    document.querySelectorAll('[data-dm-theme]').forEach(button => button.addEventListener('click', () => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('hiraethDmTheme', theme); } catch (_) {}
        applyDmTheme(theme);
    }));
    window.addEventListener('storage', event => {
        if (event.key === 'hiraethDmTheme') applyDmTheme(event.newValue);
    });

    const dom = {
        login: document.getElementById('studio-login'),
        dashboard: document.getElementById('studio-dashboard'),
        loginForm: document.getElementById('login-form'),
        password: document.getElementById('studio-password'),
        loginStatus: document.getElementById('login-status'),
        logoutButton: document.getElementById('logout-button'),
        studioEditorLink: document.getElementById('studio-editor-link'),
        studioPreviewLink: document.getElementById('studio-preview-link'),
        statusTitle: document.getElementById('studio-status-title'),
        statusSummary: document.getElementById('studio-status-summary'),
        statusChip: document.getElementById('studio-status-chip'),
        statusStrip: document.querySelector('.status-strip'),
        pipelineDetails: document.getElementById('pipeline-details'),
        pipelineSummaryStatus: document.getElementById('pipeline-summary-status'),
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
        workflowPullRequestLink: document.getElementById('workflow-pull-request-link'),
        finishDraftButton: document.getElementById('finish-draft-button'),
        abandonDraftButton: document.getElementById('abandon-draft-button'),
        workflowStatus: document.getElementById('workflow-status'),
        openEditorLink: document.getElementById('open-editor-link'),
        editorCardTitle: document.getElementById('editor-card-title'),
        editorCardDescription: document.getElementById('editor-card-description'),
        newMapButton: document.getElementById('new-map-button'),
        previewCardTitle: document.getElementById('preview-card-title'),
        previewCardDescription: document.getElementById('preview-card-description'),
        previewActionLink: document.getElementById('preview-action-link'),
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
        newMapSteps: Array.from(document.querySelectorAll('[data-new-map-step]')),
        newMapStepIndicators: Array.from(document.querySelectorAll('[data-new-map-step-indicator]')),
        newMapBackButton: document.getElementById('new-map-back-button'),
        newMapNextButton: document.getElementById('new-map-next-button'),
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
    let publishJob = null;
    let publishPollTimer = null;
    let draftStartPending = false;
    let draftStartPromise = null;
    let mapIdWasEdited = false;
    let newMapPlanSignature = '';
    let newMapPreviewUrl = '';
    let currentNewMapStep = 1;

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
        if (!authenticated) {
            clearTimeout(publishPollTimer);
            publishPollTimer = null;
            dom.password.focus();
        }
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
        const currentStage = stages.find((stage) => stage.state === 'current');
        const completedStage = [...stages].reverse().find((stage) => stage.state === 'complete');
        const summaryStage = currentStage || completedStage;
        dom.pipelineSummaryStatus.textContent = summaryStage
            ? `${summaryStage.id.charAt(0).toUpperCase()}${summaryStage.id.slice(1)}: ${summaryStage.detail}`
            : 'Draft not started';
    }

    function updateStartDraftAvailability() {
        const capabilityReady = workspace?.capabilities?.canStartDraft === true;
        dom.startDraftButton.disabled = draftStartPending || !capabilityReady;
        dom.startDraftButton.title = capabilityReady ? '' : 'Draft creation is unavailable in the current workspace.';
        const editButton = document.getElementById('edit-maps-button');
        if (editButton) editButton.disabled = draftStartPending || !(workspace?.capabilities?.canEdit || capabilityReady);
        dom.newMapButton.disabled = draftStartPending || !(workspace?.capabilities?.canCreateMap || capabilityReady);
    }

    async function ensureEditingWorkspace() {
        if (draftStartPromise) return draftStartPromise;
        if (workspace?.capabilities?.canEdit === true) return workspace;
        if (workspace?.capabilities?.canStartDraft !== true) throw new Error('Editing is unavailable. Check the workspace details below.');
        const title = dom.draftTitle.value.trim() || 'Map updates';
        dom.draftTitle.value = title;
        draftStartPending = true;
        updateStartDraftAvailability();
        draftStartPromise = (async () => {
            const response = await fetch('/api/studio/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ title })
            });
            const payload = await readJsonResponse(response);
            renderWorkspace(payload.workspace);
            return payload.workspace;
        })();
        try { return await draftStartPromise; }
        finally {
            draftStartPending = false;
            draftStartPromise = null;
            updateStartDraftAvailability();
        }
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

    function setLink(link, { href = '', label, external = false, disabled = false }) {
        link.textContent = label;
        if (disabled || !href) {
            link.removeAttribute('href');
            link.removeAttribute('target');
            link.removeAttribute('rel');
            link.setAttribute('aria-disabled', 'true');
            link.tabIndex = -1;
            return;
        }
        link.href = href;
        link.toggleAttribute('target', external);
        if (external) {
            link.target = '_blank';
            link.rel = 'noopener';
        } else {
            link.removeAttribute('target');
            link.removeAttribute('rel');
        }
        link.removeAttribute('aria-disabled');
        link.removeAttribute('tabindex');
    }

    function renderEditorEntry(presentation) {
        const entry = { href: '/studio/editor', label: 'Edit maps' };
        setLink(dom.studioEditorLink, entry);
        setLink(dom.openEditorLink, entry);
        dom.editorCardTitle.textContent = 'Your maps';
        dom.editorCardDescription.textContent = 'Open the map library to edit places, regions, and routes.';
    }

    function renderPreviewEntry(presentation) {
        if (presentation.previewReady) {
            const openPreview = { href: '/preview/', label: 'Open preview', external: true };
            setLink(dom.studioPreviewLink, openPreview);
            setLink(dom.previewActionLink, openPreview);
            dom.previewCardTitle.textContent = 'Inspect current preview';
            dom.previewCardDescription.textContent = 'Review the current optimized bundle before creating a pull request.';
        } else if (presentation.editable) {
            setLink(dom.studioPreviewLink, { href: '/studio/editor?action=preview', label: 'Build preview' });
            setLink(dom.previewActionLink, { href: '/studio/editor?action=preview', label: 'Build preview in editor' });
            dom.previewCardTitle.textContent = 'Preview needs rebuilding';
            dom.previewCardDescription.textContent = 'The current files differ from the last bundle. Build a fresh preview in the editor.';
        } else {
            setLink(dom.studioPreviewLink, { label: 'Preview unavailable', disabled: true });
            setLink(dom.previewActionLink, { label: 'Preview unavailable', disabled: true });
            dom.previewCardTitle.textContent = 'Preview is not ready';
            dom.previewCardDescription.textContent = 'Start a local draft before building a map preview.';
        }
    }

    function hasKnownCurrentPullRequest(presentation) {
        return publishJob?.status === 'complete'
            && publishJob.result?.branch === presentation.branch
            && Boolean(publishJob.result?.pullRequestNumber || publishJob.result?.pullRequestUrl);
    }

    function renderMergeAction(presentation, capabilities) {
        const knownPullRequest = hasKnownCurrentPullRequest(presentation);
        dom.continueEditingLink.className = knownPullRequest ? 'secondary-action' : 'primary-action';
        dom.workflowPullRequestLink.hidden = !knownPullRequest || !publishJob.result?.pullRequestUrl;
        if (knownPullRequest && publishJob.result?.pullRequestUrl) {
            dom.workflowPullRequestLink.href = publishJob.result.pullRequestUrl;
            dom.workflowPullRequestLink.textContent = publishJob.result.pullRequestNumber
                ? `Open pull request #${publishJob.result.pullRequestNumber}`
                : 'Open draft pull request';
        } else {
            dom.workflowPullRequestLink.removeAttribute('href');
        }
        dom.finishDraftButton.hidden = !presentation.activeDraft;
        dom.finishDraftButton.disabled = capabilities.canFinishDraft !== true;
        dom.finishDraftButton.textContent = 'Check merge and sync';
        dom.finishDraftButton.title = knownPullRequest
            ? 'Confirm the pull request was merged, then sync and close this local draft.'
            : 'Check whether this draft was merged before closing it.';
    }

    function renderStudioPresentation() {
        if (!workspace || !window.MapStudioModel) {
            renderWorkspaceDetails();
            return;
        }
        const presentation = window.MapStudioModel.deriveWorkspacePresentation(workspace, readiness || {});
        const capabilities = workspace.capabilities || {};
        dom.statusTitle.textContent = presentation.activeDraft
            ? 'Local draft workspace'
            : (presentation.editable ? 'Writable branch' : 'Review-only workspace');
        dom.statusSummary.textContent = presentation.activeDraft || presentation.editable
            ? `Working on ${presentation.branch}.`
            : 'No writable draft is active. Review maps safely or start a draft to edit.';
        dom.statusChip.textContent = presentation.statusLabel;
        dom.statusChip.className = `status-chip ${presentation.statusTone}`;
        dom.statusStrip.dataset.tone = presentation.statusTone;
        dom.branchChip.textContent = presentation.branch;
        dom.branchChip.title = presentation.branch;
        dom.workflowTitle.textContent = presentation.title;
        dom.workflowSummary.textContent = presentation.summary;
        renderPipeline(presentation.stages);
        const pipelineMode = presentation.editable ? 'working' : 'onboarding';
        if (dom.pipelineDetails.dataset.mode !== pipelineMode) {
            dom.pipelineDetails.open = false;
            dom.pipelineDetails.dataset.mode = pipelineMode;
        }
        const knownPullRequest = hasKnownCurrentPullRequest(presentation);
        if (presentation.activeDraft && knownPullRequest && !workspace.clean) {
            dom.workflowTitle.textContent = 'Update this draft before merging';
            dom.workflowSummary.textContent = 'This draft has new local changes. Save, rebuild and inspect the preview, then update the pull request before merging it.';
        } else if (presentation.activeDraft && knownPullRequest) {
            dom.workflowTitle.textContent = 'Review and finish this draft';
            dom.workflowSummary.textContent = publishJob.result?.pullRequestNumber
                ? `Pull request #${publishJob.result.pullRequestNumber} is ready. Merge it after review, then check its status and sync.`
                : 'The draft pull request is ready. Merge it after review, then check its status and sync.';
            const reviewStage = document.getElementById('pipeline-review');
            if (reviewStage) {
                reviewStage.dataset.state = 'complete';
                const detail = reviewStage.querySelector('small');
                if (detail) detail.textContent = 'Pull request ready';
            }
        }
        renderEditorEntry(presentation);
        renderPreviewEntry(presentation);

        dom.startDraftButton.hidden = presentation.editable;
        updateStartDraftAvailability();
        dom.continueEditingLink.hidden = !presentation.editable;
        dom.publishButton.hidden = !presentation.activeDraft;
        dom.publishButton.disabled = capabilities.canPublish !== true;
        dom.publishButton.textContent = knownPullRequest ? 'Update pull request' : 'Create draft pull request';
        renderMergeAction(presentation, capabilities);
        dom.abandonDraftButton.hidden = !presentation.activeDraft;
        dom.abandonDraftButton.disabled = capabilities.canAbandonDraft !== true;
        updateStartDraftAvailability();
        const editStatus = document.getElementById('edit-maps-status');
        if (editStatus) editStatus.textContent = presentation.editable ? 'Continue where you left off.' : 'A private editing copy is prepared automatically.';
        const publicationPanel = document.getElementById('studio-publication-panel');
        const hasChanges = (workspace.changedPaths || []).length > 0 || knownPullRequest || ['running', 'interrupted', 'failed'].includes(publishJob?.status);
        if (publicationPanel && publicationPanel.dataset.hasChanges !== String(hasChanges)) {
            publicationPanel.dataset.hasChanges = String(hasChanges);
            if (hasChanges) publicationPanel.open = true;
        }
        if (!dom.newMapButton.disabled && new URLSearchParams(location.search).get('new-map') === '1') {
            history.replaceState(null, '', location.pathname);
            queueMicrotask(() => dom.newMapButton.click());
        }
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
        renderPublishJob(payload.publishJob || null);
    }

    function renderPublishJob(job) {
        publishJob = job;
        if (!job) {
            dom.publishProgress.hidden = true;
            if (workspace) renderStudioPresentation();
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
        if (job.status === 'running' && !dom.dashboard.hidden) schedulePublishPoll(1200);
        if (workspace) renderStudioPresentation();
    }

    function schedulePublishPoll(delay) {
        clearTimeout(publishPollTimer);
        publishPollTimer = setTimeout(pollPublishJob, delay);
    }

    async function pollPublishJob() {
        clearTimeout(publishPollTimer);
        publishPollTimer = null;
        if (dom.dashboard.hidden) return;
        try {
            const response = await fetch('/api/studio/publish-status', { cache: 'no-store' });
            if (response.status === 401) {
                showAuthenticated(false);
                dom.loginStatus.textContent = 'Sign in again to check publication progress.';
                return;
            }
            const payload = await readJsonResponse(response);
            renderPublishJob(payload.publishJob);
            if (payload.publishJob?.status !== 'running') {
                await Promise.all([refreshReadiness(), refreshWorkspace()]);
            }
        } catch (error) {
            dom.publishProgressStatus.textContent = 'Connection interrupted. Retrying publication status…';
            if (!dom.dashboard.hidden) schedulePublishPoll(3000);
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
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
    }

    function formatFileSize(bytes) {
        const size = Math.max(0, Number(bytes) || 0);
        if (size < 1024) return `${Math.round(size)} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
        return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
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

    function setNewMapStep(step, { focus = true } = {}) {
        currentNewMapStep = Number(step) === 4 ? 4 : 1;
        dom.newMapSteps.forEach((panel) => {
            panel.hidden = currentNewMapStep === 4 ? Number(panel.dataset.newMapStep) !== 4 : Number(panel.dataset.newMapStep) === 4;
        });
        dom.newMapStepIndicators.forEach((indicator) => {
            const indicatorStep = Number(indicator.dataset.newMapStepIndicator);
            indicator.dataset.state = indicatorStep < currentNewMapStep
                ? 'complete'
                : (indicatorStep === currentNewMapStep ? 'current' : 'upcoming');
            if (indicatorStep === currentNewMapStep) indicator.setAttribute('aria-current', 'step');
            else indicator.removeAttribute('aria-current');
        });
        dom.newMapForm.querySelectorAll('[data-new-map-options]').forEach(section => { section.hidden = currentNewMapStep === 4; });
        dom.newMapBackButton.hidden = currentNewMapStep === 1;
        dom.newMapNextButton.hidden = true;
        dom.reviewNewMapButton.hidden = currentNewMapStep !== 1;
        dom.createNewMapButton.hidden = currentNewMapStep !== 4;
        dom.createNewMapButton.disabled = !newMapPlanSignature
            || newMapPlanSignature !== getNewMapPlanSignature()
            || dom.newMapForm.dataset.busy === 'true';
        if (focus) {
            const heading = dom.newMapSteps
                .find((panel) => Number(panel.dataset.newMapStep) === currentNewMapStep)
                ?.querySelector('legend');
            heading?.setAttribute('tabindex', '-1');
            heading?.focus({ preventScroll: true });
            document.querySelector('.new-map-scroll-region')?.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function validateNewMapStep(step = currentNewMapStep) {
        const panel = dom.newMapSteps.find((candidate) => Number(candidate.dataset.newMapStep) === step);
        const fields = Array.from(panel?.querySelectorAll('input, select, textarea') || []);
        const invalid = fields.find((field) => !field.checkValidity());
        if (invalid) {
            let ancestor = invalid.parentElement;
            while (ancestor && ancestor !== dom.newMapForm) {
                if (ancestor.tagName === 'DETAILS') ancestor.open = true;
                ancestor = ancestor.parentElement;
            }
            invalid.reportValidity();
            invalid.focus();
            return false;
        }
        if (step === 1) {
            const artwork = getNewMapArtwork();
            if (!artwork) {
                dom.newMapStatus.textContent = 'Choose map artwork before continuing.';
                dom.newMapFile.focus();
                return false;
            }
            if (!getNewMapArtworkContentType(artwork)) {
                dom.newMapStatus.textContent = 'Map artwork must be a WebP, PNG, or JPEG image.';
                dom.newMapFile.focus();
                return false;
            }
        }
        dom.newMapStatus.textContent = '';
        return true;
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
        dom.newMapArtworkMeta.textContent = 'Supported formats: WebP, PNG, and JPEG.';
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
            const conversion = artworkContentType === 'image/webp'
                ? 'Original WebP will be preserved.'
                : 'Studio will convert this to a high-quality WebP.';
            dom.newMapArtworkTitle.textContent = artwork.name;
            dom.newMapArtworkMeta.textContent = `${dom.newMapPreviewImage.naturalWidth} × ${dom.newMapPreviewImage.naturalHeight} pixels · ${formatFileSize(artwork.size)}. ${conversion}`;
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
        dom.logoutButton.hidden = payload.authenticationRequired === false;
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

    dom.draftTitle.addEventListener('input', () => {
        updateStartDraftAvailability();
        if (dom.workflowStatus.textContent === 'Enter a change title first.') {
            dom.workflowStatus.textContent = '';
        }
    });

    dom.startDraftButton.addEventListener('click', async () => {
        dom.workflowStatus.textContent = 'Preparing your editing copy…';
        try {
            await ensureEditingWorkspace();
            dom.workflowStatus.textContent = 'Ready to edit.';
        } catch (error) { dom.workflowStatus.textContent = error.message; }
    });
    [document.getElementById('edit-maps-button'), dom.studioEditorLink, dom.openEditorLink].filter(Boolean).forEach(button => button.addEventListener('click', async event => {
        event.preventDefault();
        const status = document.getElementById('edit-maps-status');
        status.textContent = 'Opening your maps…';
        try {
            await ensureEditingWorkspace();
            window.location.href = '/studio/editor';
        } catch (error) { status.textContent = error.message; }
    }));

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

    dom.newMapButton.addEventListener('click', async () => {
        try { await ensureEditingWorkspace(); }
        catch (error) { document.getElementById('edit-maps-status').textContent = error.message; return; }
        mapIdWasEdited = false;
        newMapPlanSignature = '';
        dom.newMapForm.reset();
        dom.newMapForm.querySelectorAll('details').forEach(section => { section.open = false; });
        dom.newMapForm.dataset.busy = 'false';
        dom.createNewMapButton.disabled = true;
        dom.newMapPlan.hidden = true;
        dom.newMapPlanFiles.replaceChildren();
        clearNewMapPreview();
        setNewMapStep(1, { focus: false });
        openNewMapDialog();
    });
    dom.closeNewMapButton.addEventListener('click', closeNewMapDialog);
    dom.cancelNewMapButton.addEventListener('click', closeNewMapDialog);
    dom.newMapId.addEventListener('input', () => { mapIdWasEdited = true; });
    dom.newMapName.addEventListener('input', () => {
        if (!mapIdWasEdited) dom.newMapId.value = slugifyMapId(dom.newMapName.value);
    });
    dom.newMapNextButton.addEventListener('click', () => {
        if (validateNewMapStep()) setNewMapStep(currentNewMapStep + 1);
    });
    dom.newMapBackButton.addEventListener('click', () => {
        setNewMapStep(1);
    });
    dom.newMapForm.addEventListener('input', invalidateNewMapPlan);
    dom.newMapForm.addEventListener('change', (event) => {
        invalidateNewMapPlan();
        if (event.target === dom.newMapFile) renderNewMapArtworkPreview();
    });

    dom.reviewNewMapButton.addEventListener('click', async () => {
        if (currentNewMapStep !== 1) return;
        if (![1, 2, 3].every(step => validateNewMapStep(step))) return;
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
            setNewMapStep(4);
            dom.createNewMapButton.disabled = false;
            dom.newMapStatus.textContent = 'Ready when you are.';
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
        dom.newMapBackButton.disabled = true;
        dom.newMapNextButton.disabled = true;
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
            dom.newMapBackButton.disabled = false;
            dom.newMapNextButton.disabled = false;
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
