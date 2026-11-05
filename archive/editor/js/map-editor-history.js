(function exposeMapEditorHistory(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MapEditorHistory = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMapEditorHistoryApi() {
    function cloneSnapshot(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function serializeSnapshot(value) {
        return JSON.stringify(value);
    }

    function createHistory(options = {}) {
        const limit = Math.max(1, Number(options.limit) || 30);
        const past = [];
        const future = [];

        function record(snapshot, label = 'Edit') {
            if (snapshot == null) return false;
            const serialized = serializeSnapshot(snapshot);
            const previous = past[past.length - 1];
            if (previous?.serialized === serialized) return false;
            past.push({
                label: String(label || 'Edit'),
                serialized,
                snapshot: cloneSnapshot(snapshot)
            });
            if (past.length > limit) past.splice(0, past.length - limit);
            future.length = 0;
            return true;
        }

        function undo(currentSnapshot) {
            const target = past.pop();
            if (!target) return null;
            future.push({
                label: target.label,
                serialized: serializeSnapshot(currentSnapshot),
                snapshot: cloneSnapshot(currentSnapshot)
            });
            return { label: target.label, snapshot: cloneSnapshot(target.snapshot) };
        }

        function redo(currentSnapshot) {
            const target = future.pop();
            if (!target) return null;
            past.push({
                label: target.label,
                serialized: serializeSnapshot(currentSnapshot),
                snapshot: cloneSnapshot(currentSnapshot)
            });
            return { label: target.label, snapshot: cloneSnapshot(target.snapshot) };
        }

        function clear() {
            past.length = 0;
            future.length = 0;
        }

        function getState() {
            return {
                canUndo: past.length > 0,
                canRedo: future.length > 0,
                undoLabel: past[past.length - 1]?.label || '',
                redoLabel: future[future.length - 1]?.label || ''
            };
        }

        return { clear, getState, record, redo, undo };
    }

    return { cloneSnapshot, createHistory };
}));
