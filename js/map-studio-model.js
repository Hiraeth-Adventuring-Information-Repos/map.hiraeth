(function exposeMapStudioModel(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MapStudioModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMapStudioModel() {
    function countLabel(count, singular, plural = `${singular}s`) {
        return `${count} ${count === 1 ? singular : plural}`;
    }

    function deriveWorkspacePresentation(workspace = {}, readiness = {}) {
        const capabilities = workspace.capabilities || {};
        const branch = String(workspace.branch || 'detached HEAD');
        const mode = String(workspace.mode || 'detached');
        const changeCount = Array.isArray(workspace.changedPaths) ? workspace.changedPaths.length : 0;
        const publishableCount = Array.isArray(workspace.publishableChanges)
            ? workspace.publishableChanges.length
            : changeCount;
        const unsupportedCount = Array.isArray(workspace.unsupportedChanges)
            ? workspace.unsupportedChanges.length
            : 0;
        const githubReady = workspace.github?.configured === true;
        const previewReady = readiness.topStatus === 'Ready';
        const editable = capabilities.canEdit === true || workspace.editable === true;
        const activeDraft = workspace.activeDraft === true;

        let statusTone = 'neutral';
        let statusLabel = 'Workspace unavailable';
        let title = 'Choose how to begin';
        let summary = 'Start a draft to keep map changes isolated from the published branch.';

        if (mode === 'detached') {
            statusTone = 'danger';
            statusLabel = 'Detached HEAD';
            title = 'Workspace needs repair';
            summary = 'Switch to main or a named working branch before editing map files.';
        } else if (activeDraft) {
            statusTone = unsupportedCount > 0 ? 'warning' : 'good';
            statusLabel = changeCount > 0 ? countLabel(changeCount, 'changed file') : 'Draft ready';
            title = changeCount > 0 ? 'Review your draft changes' : 'Continue editing this draft';
            summary = changeCount > 0
                ? `${branch} contains ${countLabel(publishableCount, 'publishable change')}.`
                : `${branch} is isolated and ready for map work.`;
        } else if (editable) {
            statusTone = unsupportedCount > 0 ? 'warning' : 'neutral';
            statusLabel = 'Working branch';
            title = 'Continue on the current branch';
            summary = `${branch} can be edited locally. Studio publishing is reserved for map-studio drafts.`;
        } else if (mode === 'main') {
            statusTone = workspace.clean ? 'neutral' : 'warning';
            statusLabel = workspace.clean ? 'Main is clean' : 'Main has changes';
            title = workspace.clean ? 'Start a map draft' : 'Resolve changes on main';
            summary = workspace.clean
                ? 'Create a local draft branch before editing; GitHub can be connected later for review.'
                : 'Map Studio will not create a draft while the published branch has uncommitted files.';
        }

        const stages = [
            {
                id: 'draft',
                label: 'Draft',
                state: editable ? 'complete' : (mode === 'main' ? 'current' : 'blocked'),
                detail: editable ? branch : 'Create an isolated branch'
            },
            {
                id: 'edit',
                label: 'Edit',
                state: changeCount > 0 ? 'complete' : (editable ? 'current' : 'blocked'),
                detail: changeCount > 0 ? countLabel(changeCount, 'changed file') : 'Maps and atlas data'
            },
            {
                id: 'validate',
                label: 'Validate',
                state: changeCount > 0 ? (previewReady ? 'complete' : 'current') : 'blocked',
                detail: previewReady ? 'Preview bundle ready' : 'Build and inspect preview'
            },
            {
                id: 'review',
                label: 'Review',
                state: capabilities.canPublish === true ? 'current' : 'blocked',
                detail: githubReady ? 'Create a draft pull request' : 'Connect GitHub to publish'
            }
        ];

        return {
            activeDraft,
            branch,
            changeCount,
            editable,
            githubReady,
            mode,
            previewReady,
            publishableCount,
            stages,
            statusLabel,
            statusTone,
            summary,
            title,
            unsupportedCount
        };
    }

    return {
        countLabel,
        deriveWorkspacePresentation
    };
}));
