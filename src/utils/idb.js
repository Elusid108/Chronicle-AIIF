const DB_NAME = 'chronicle';
const DB_VERSION = 2;

export const ACTIVE_SAVE_ID = 'active';

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
        };
        req.onsuccess = () => resolve(req.result);
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

export const copyImages = async (fromId, toId, keepLastN) => {
    if (!fromId || !toId || fromId === toId) return;
    if (!keepLastN || keepLastN <= 0) {
        await deleteImagesForSave(toId);
        return;
    }
    const keys = await idbKeys('images');
    const fromIndexed = keys
        .map((k) => ({ key: k, index: parseTurnIndex(fromId, k) }))
        .filter((row) => row.index != null);
    if (!fromIndexed.length) return;

    const toCopy = fromIndexed.sort((a, b) => b.index - a.index).slice(0, keepLastN);
    const copied = new Set(toCopy.map((row) => row.index));
    const sourceAll = new Set(fromIndexed.map((row) => row.index));

    for (const row of toCopy) {
        const blob = await idbGet('images', row.key);
        if (blob) await putTurnImage(toId, row.index, blob);
    }

    const destKeys = await idbKeys('images');
    const db = await openDb();
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    for (const key of destKeys) {
        const index = parseTurnIndex(toId, key);
        if (index == null) continue;
        if (copied.has(index)) continue;
        if (sourceAll.has(index)) store.delete(key);
    }
    await txDone(tx);
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

export const copyCodexImages = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const keys = await idbKeys('codexImages');
    const prefix = `${fromId}:`;
    for (const key of keys) {
        if (!String(key).startsWith(prefix)) continue;
        const rest = String(key).slice(prefix.length);
        const blob = await idbGet('codexImages', key);
        if (blob) await idbPut('codexImages', blob, `${toId}:${rest}`);
    }
};

export const copyCodexImageKey = async (saveId, category, fromKey, intoKey) => {
    const blob = await getCodexImage(saveId, category, fromKey);
    if (blob) await putCodexImage(saveId, category, intoKey, blob);
};
