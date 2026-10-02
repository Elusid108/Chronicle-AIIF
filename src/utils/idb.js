const DB_NAME = 'chronicle';
// v3 adds the per-story `recall` store (page embeddings + keyword tokens).
const DB_VERSION = 3;

// The pre-v3.3 shared "active" save id. Only the legacy migration reads it.
export const LEGACY_ACTIVE_ID = 'active';

let dbPromise = null;

const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
            if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
            if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
            if (!db.objectStoreNames.contains('codexImages')) db.createObjectStore('codexImages');
            if (!db.objectStoreNames.contains('recall')) db.createObjectStore('recall');
        };
        req.onblocked = () => {
            console.warn('Chronicle: IndexedDB upgrade blocked by another open tab. Close other Chronicle tabs.');
        };
        req.onsuccess = () => {
            const db = req.result;
            // If another tab upgrades the schema, drop our handle so the next call reopens.
            db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } dbPromise = null; };
            db.onclose = () => { dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => {
            dbPromise = null;
            reject(req.error || new Error('IndexedDB open failed'));
        };
    });
    return dbPromise;
};

const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB aborted'));
});

export const idbGet = async (store, key) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const idbPut = async (store, value, key) => {
    const db = await openDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await txDone(tx);
};

export const idbDelete = async (store, key) => {
    const db = await openDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
};

export const idbKeys = async (store) => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
};

const parseTurnIndex = (saveId, key) => {
    const prefix = `${saveId}:`;
    if (!String(key).startsWith(prefix)) return null;
    const index = Number(String(key).slice(prefix.length));
    return Number.isFinite(index) ? index : null;
};

export const imageKey = (saveId, turnIndex) => `${saveId}:${turnIndex}`;

export const putTurnImage = async (saveId, turnIndex, blob) => {
    if (!blob) return;
    await idbPut('images', blob, imageKey(saveId, turnIndex));
};

export const getTurnImage = async (saveId, turnIndex) => {
    const val = await idbGet('images', imageKey(saveId, turnIndex));
    return val || null;
};

export const deleteTurnImage = async (saveId, turnIndex) => {
    await idbDelete('images', imageKey(saveId, turnIndex));
};

// Drop stored page images at index >= fromIndex (rewind / regenerate).
export const deleteTurnImagesFrom = async (saveId, fromIndex) => {
    if (!saveId) return;
    const keys = await idbKeys('images');
    const drop = keys.filter((k) => {
        const index = parseTurnIndex(saveId, k);
        return index != null && index >= fromIndex;
    });
    if (!drop.length) return;
    const db = await openDb();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    for (const key of drop) store.delete(key);
    await txDone(tx);
};

export const deleteImagesForSave = async (saveId) => {
    const keys = await idbKeys('images');
    const prefix = `${saveId}:`;
    const db = await openDb();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    for (const key of keys) {
        if (String(key).startsWith(prefix) && parseTurnIndex(saveId, key) != null) store.delete(key);
    }
    await txDone(tx);
};

export const pruneTurnImages = async (saveId, keepLastN) => {
    if (!keepLastN || keepLastN <= 0) {
        await deleteImagesForSave(saveId);
        return;
    }
    const keys = await idbKeys('images');
    const indexed = keys
        .map((k) => ({ key: k, index: parseTurnIndex(saveId, k) }))
        .filter((row) => row.index != null)
        .sort((a, b) => b.index - a.index);
    const drop = indexed.slice(keepLastN);
    if (!drop.length) return;
    const db = await openDb();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    for (const row of drop) store.delete(row.key);
    await txDone(tx);
};

// Move every `${fromPrefix}…` key to `${toPrefix}…` (legacy migration).
// Existing destination keys are kept unless overwrite is set.
export const renameKeyPrefix = async (storeName, fromPrefix, toPrefix, { overwrite = false } = {}) => {
    if (!fromPrefix || !toPrefix || fromPrefix === toPrefix) return 0;
    const keys = await idbKeys(storeName);
    const existing = new Set(keys.map(String));
    let moved = 0;
    for (const key of keys) {
        const k = String(key);
        if (!k.startsWith(fromPrefix)) continue;
        const target = `${toPrefix}${k.slice(fromPrefix.length)}`;
        const db = await openDb();
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (overwrite || !existing.has(target)) {
            const req = store.get(k);
            req.onsuccess = () => {
                if (req.result != null) store.put(req.result, target);
                store.delete(k);
            };
            moved += 1;
        } else {
            store.delete(k);
        }
        await txDone(tx);
    }
    return moved;
};

export const codexImageKey = (saveId, category, key) =>
    `${saveId}:${category}:${encodeURIComponent(String(key || ''))}`;

export const putCodexImage = async (saveId, category, key, blob) => {
    if (!blob || !saveId || !category || !key) return;
    await idbPut('codexImages', blob, codexImageKey(saveId, category, key));
};

export const getCodexImage = async (saveId, category, key) => {
    if (!saveId || !category || !key) return null;
    const val = await idbGet('codexImages', codexImageKey(saveId, category, key));
    return val || null;
};

export const deleteCodexImage = async (saveId, category, key) => {
    if (!saveId || !category || !key) return;
    await idbDelete('codexImages', codexImageKey(saveId, category, key));
};

export const deleteCodexImagesForSave = async (saveId) => {
    const keys = await idbKeys('codexImages');
    const prefix = `${saveId}:`;
    const db = await openDb();
    const tx = db.transaction('codexImages', 'readwrite');
    const store = tx.objectStore('codexImages');
    for (const key of keys) {
        if (String(key).startsWith(prefix)) store.delete(key);
    }
    await txDone(tx);
};

// ---- recall docs: `${slotId}:${00042}` -> { turnIndex, pageNumber, text, vector, tokens } ----

export const recallKey = (slotId, turnIndex) => `${slotId}:${String(turnIndex).padStart(5, '0')}`;

export const putRecallDoc = async (slotId, turnIndex, doc) => {
    if (!slotId || !Number.isFinite(turnIndex) || !doc) return;
    await idbPut('recall', doc, recallKey(slotId, turnIndex));
};

export const getRecallDocs = async (slotId) => {
    if (!slotId) return [];
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('recall', 'readonly');
        const range = IDBKeyRange.bound(`${slotId}:`, `${slotId}:￿`);
        const req = tx.objectStore('recall').getAll(range);
        req.onsuccess = () => resolve((req.result || []).filter(Boolean));
        req.onerror = () => reject(req.error);
    });
};

const deleteRecallRange = async (lower, upper) => {
    const db = await openDb();
    const tx = db.transaction('recall', 'readwrite');
    tx.objectStore('recall').delete(IDBKeyRange.bound(lower, upper));
    await txDone(tx);
};

export const deleteRecallForSlot = async (slotId) => {
    if (!slotId) return;
    await deleteRecallRange(`${slotId}:`, `${slotId}:￿`);
};

export const deleteRecallFrom = async (slotId, fromIndex) => {
    if (!slotId) return;
    await deleteRecallRange(recallKey(slotId, Math.max(0, fromIndex)), `${slotId}:￿`);
};

export const copyCodexImageKey = async (saveId, category, fromKey, intoKey) => {
    const blob = await getCodexImage(saveId, category, fromKey);
    if (blob) await putCodexImage(saveId, category, intoKey, blob);
};
