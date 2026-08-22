const DB_NAME = 'chronicle';
const DB_VERSION = 1;

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
        if (String(key).startsWith(prefix)) store.delete(key);
    }
    await txDone(tx);
};

export const pruneTurnImages = async (saveId, keepLastN) => {
    if (!keepLastN || keepLastN <= 0) {
        await deleteImagesForSave(saveId);
        return;
    }
    const keys = await idbKeys('images');
    const prefix = `${saveId}:`;
    const indexed = keys
        .filter((k) => String(k).startsWith(prefix))
        .map((k) => ({ key: k, index: Number(String(k).slice(prefix.length)) }))
        .filter((row) => Number.isFinite(row.index))
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
    await deleteImagesForSave(toId);
    if (!keepLastN || keepLastN <= 0) return;
    const keys = await idbKeys('images');
    const prefix = `${fromId}:`;
    const indexed = keys
        .filter((k) => String(k).startsWith(prefix))
        .map((k) => ({ key: k, index: Number(String(k).slice(prefix.length)) }))
        .filter((row) => Number.isFinite(row.index))
        .sort((a, b) => b.index - a.index)
        .slice(0, keepLastN);
    for (const row of indexed) {
        const blob = await idbGet('images', row.key);
        if (blob) await putTurnImage(toId, row.index, blob);
    }
};
