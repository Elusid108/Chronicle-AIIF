let worker = null;
let seq = 0;
const pending = new Map();

const getWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL('../workers/compress-image.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
        const { id, ok, blob, error } = event.data || {};
        const job = pending.get(id);
        if (!job) return;
        pending.delete(id);
        if (ok) job.resolve(blob);
        else job.reject(new Error(error || 'compress failed'));
    };
    worker.onerror = (err) => {
        for (const job of pending.values()) job.reject(err);
        pending.clear();
        worker = null;
    };
    return worker;
};

export const compressImage = (source) => new Promise((resolve, reject) => {
    try {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        const w = getWorker();
        if (source instanceof Blob) {
            w.postMessage({ id, buffer: source, mime: source.type });
        } else {
            w.postMessage({ id, src: String(source) });
        }
    } catch (e) {
        reject(e);
    }
});

export const snapshotImage = async (source) => {
    if (!source) return { blob: null, url: null };
    try {
        const blob = await compressImage(source);
        return { blob, url: URL.createObjectURL(blob) };
    } catch {
        if (typeof source === 'string') return { blob: null, url: source };
        return { blob: source, url: URL.createObjectURL(source) };
    }
};

export const revokeIfBlobUrl = (url) => {
    if (url && String(url).startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
};

export const revokeHistoryImages = (history) => {
    if (!Array.isArray(history)) return;
    for (const turn of history) revokeIfBlobUrl(turn?.image);
};
