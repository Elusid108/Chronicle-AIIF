import { DEFAULT_CONFIG, DEFAULT_CODEX, EMPTY_SCENE, EMPTY_SUMMARY, INITIAL_SUMMARY } from '../constants.js';
import {
    ACTIVE_SAVE_ID, copyImages, deleteImagesForSave, getTurnImage, idbDelete, idbGet, idbPut,
} from './idb.js';

export const STORAGE_KEYS = {
    apiKey: 'chronicle_api_key',
    prefs: 'chronicle_prefs',
    modelPrefs: 'chronicle_model_prefs',
    favVoices: 'chronicle_fav_voices',
    save: 'chronicle_save',
    slots: 'chronicle_slots',
    idbMigrated: 'chronicle_idb_migrated',
};

export const SAVE_VERSION = 3;

export const loadJSON = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`Chronicle: failed to parse ${key}`, e);
        return fallback;
    }
};

export const saveJSON = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError') console.warn('Chronicle: could not save, storage full');
        else console.warn('Chronicle: save failed', e);
        return false;
    }
};

export const normalizeEntry = (val) => {
    if (typeof val === 'string') {
        return { description: val, citations: [], aliases: [], status: '', location: '', source: 'model', pinned: false };
    }
    const data = val && typeof val === 'object' ? val : {};
    return {
        description: typeof data.description === 'string' ? data.description : '',
        citations: Array.isArray(data.citations) ? data.citations.slice() : [],
        aliases: Array.isArray(data.aliases) ? data.aliases.map(String).filter(Boolean) : [],
        status: typeof data.status === 'string' ? data.status : '',
        location: typeof data.location === 'string' ? data.location : '',
        source: data.source === 'player' ? 'player' : 'model',
        pinned: Boolean(data.pinned),
    };
};

export const normalizeCodex = (codex) => {
    const src = codex && typeof codex === 'object' ? codex : { ...DEFAULT_CODEX };
    const out = { characters: {}, places: {}, items: {} };
    for (const cat of ['characters', 'places', 'items']) {
        const bucket = src[cat] && typeof src[cat] === 'object' ? src[cat] : {};
        for (const [key, val] of Object.entries(bucket)) {
            if (!key) continue;
            out[cat][key] = normalizeEntry(val);
        }
    }
    return out;
};

export const normalizeScene = (scene) => {
    const s = scene && typeof scene === 'object' ? scene : {};
    return {
        location: typeof s.location === 'string' ? s.location : '',
        time_of_day: typeof s.time_of_day === 'string' ? s.time_of_day : '',
        present_characters: Array.isArray(s.present_characters) ? s.present_characters.map(String) : [],
        goal: typeof s.goal === 'string' ? s.goal : '',
        open_threads: Array.isArray(s.open_threads) ? s.open_threads.map(String) : [],
    };
};

// summary may historically be a single string. v2 used beats + longTerm.
// v3 adds foldedThrough (how many prefix AI turns live in longTerm).
export const normalizeSummary = (summary) => {
    if (summary && typeof summary === 'object' && Array.isArray(summary.beats)) {
        return {
            beats: summary.beats.slice(),
            longTerm: summary.longTerm || '',
            foldedThrough: Number.isFinite(summary.foldedThrough) ? summary.foldedThrough : 0,
        };
    }
    if (typeof summary === 'string') {
        const beats = summary
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s && s !== INITIAL_SUMMARY);
        return { beats, longTerm: '', foldedThrough: 0 };
    }
    return { ...EMPTY_SUMMARY, beats: [] };
};

export const summaryToText = (summary) => {
    const norm = normalizeSummary(summary);
    const parts = [];
    if (norm.longTerm) parts.push(norm.longTerm);
    parts.push(...norm.beats);
    const text = parts.join('\n').trim();
    return text || INITIAL_SUMMARY;
};

const stripTurnMedia = (turn) => {
    if (!turn || typeof turn !== 'object') return turn;
    const { audio, image, ...rest } = turn;
    return { ...rest, audio: null, image: null };
};

export const migrateSave = (data) => {
    if (!data || !Array.isArray(data.history) || data.history.length === 0) return null;
    const history = data.history.map(stripTurnMedia);
    return {
        history,
        codex: normalizeCodex(data.codex),
        summary: normalizeSummary(data.summary != null ? data.summary : INITIAL_SUMMARY),
        scene: normalizeScene(data.scene),
        styleCard: typeof data.styleCard === 'string' ? data.styleCard : '',
        currentSlideIndex: typeof data.currentSlideIndex === 'number' ? data.currentSlideIndex : history.length - 1,
        isEnding: Boolean(data.isEnding),
        turnsRemaining: data.turnsRemaining != null ? data.turnsRemaining : null,
        isFinished: Boolean(data.isFinished),
        exportDetails: data.exportDetails && typeof data.exportDetails === 'object'
            ? data.exportDetails
            : { title: 'The Unnamed Chronicle', author: 'Anonymous' },
        config: data.config && typeof data.config === 'object' ? { ...DEFAULT_CONFIG, ...data.config } : { ...DEFAULT_CONFIG },
        initialContext: typeof data.initialContext === 'string' ? data.initialContext : '',
        stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
    };
};

export const buildSavePayload = (state) => ({
    version: SAVE_VERSION,
    history: (state.history || []).map(stripTurnMedia),
    codex: normalizeCodex(state.codex),
    summary: normalizeSummary(state.summary),
    scene: normalizeScene(state.scene),
    styleCard: typeof state.styleCard === 'string' ? state.styleCard : '',
    currentSlideIndex: state.currentSlideIndex,
    isEnding: state.isEnding,
    turnsRemaining: state.turnsRemaining,
    isFinished: state.isFinished,
    exportDetails: state.exportDetails,
    config: state.config,
    initialContext: state.initialContext,
    stats: state.stats || null,
});

export const countPages = (history) => (Array.isArray(history) ? history.filter((t) => t.type === 'ai').length : 0);

const SLOT_INDEX_KEY = 'slotIndex';

let initLock = null;

const runInitStorage = async () => {
    if (localStorage.getItem(STORAGE_KEYS.idbMigrated) === '1') return;
    try {
        const existingActive = await idbGet('saves', ACTIVE_SAVE_ID);
        if (!existingActive) {
            const legacySave = loadJSON(STORAGE_KEYS.save, null);
            const migrated = migrateSave(legacySave);
            if (migrated) await idbPut('saves', buildSavePayload(migrated), ACTIVE_SAVE_ID);
        }

        const legacySlots = loadJSON(STORAGE_KEYS.slots, []);
        if (Array.isArray(legacySlots) && legacySlots.length) {
            const index = [];
            for (const entry of legacySlots) {
                if (!entry || !entry.id || !entry.data) continue;
                const migratedSlot = migrateSave(entry.data);
                if (!migratedSlot) continue;
                const payload = buildSavePayload(migratedSlot);
                await idbPut('saves', payload, entry.id);
                index.push({
                    id: entry.id,
                    name: entry.name,
                    savedAt: entry.savedAt,
                    pages: entry.pages || countPages(payload.history),
                    title: entry.title || payload.exportDetails?.title || 'Untitled',
                });
            }
            await idbPut('meta', index, SLOT_INDEX_KEY);
        }

        localStorage.setItem(STORAGE_KEYS.idbMigrated, '1');
        try { localStorage.removeItem(STORAGE_KEYS.save); } catch { /* ignore */ }
        try { localStorage.removeItem(STORAGE_KEYS.slots); } catch { /* ignore */ }
    } catch (e) {
        console.warn('Chronicle: IDB migration failed', e);
    }
};

export const initStorage = () => {
    if (!initLock) initLock = runInitStorage();
    return initLock;
};

export const readActiveSave = async () => {
    try {
        const data = await idbGet('saves', ACTIVE_SAVE_ID);
        const migrated = migrateSave(data);
        if (migrated) return migrated;
    } catch (e) {
        console.warn('Chronicle: IDB read failed', e);
    }
    return migrateSave(loadJSON(STORAGE_KEYS.save, null));
};

export const writeActiveSave = async (state) => {
    try {
        await idbPut('saves', buildSavePayload(state), ACTIVE_SAVE_ID);
        return true;
    } catch (e) {
        console.warn('Chronicle: IDB write failed', e);
        return saveJSON(STORAGE_KEYS.save, buildSavePayload(state));
    }
};

export const clearActiveSave = async () => {
    try { await idbDelete('saves', ACTIVE_SAVE_ID); } catch { /* ignore */ }
    try { await deleteImagesForSave(ACTIVE_SAVE_ID); } catch { /* ignore */ }
    try { localStorage.removeItem(STORAGE_KEYS.save); } catch { /* ignore */ }
};

export const attachStoredImages = async (save, saveId = ACTIVE_SAVE_ID) => {
    if (!save?.history) return save;
    if (!saveId) {
        return { ...save, history: save.history.map((turn) => (turn?.type === 'ai' ? { ...turn, image: turn.image || null } : turn)) };
    }
    const history = await Promise.all(save.history.map(async (turn, idx) => {
        if (turn?.type !== 'ai') return turn;
        if (turn.image) return turn;
        try {
            const blob = await getTurnImage(saveId, idx);
            if (blob) return { ...turn, image: URL.createObjectURL(blob) };
        } catch { /* ignore */ }
        return { ...turn, image: null };
    }));
    return { ...save, history };
};

export const listSlots = async () => {
    try {
        const index = await idbGet('meta', SLOT_INDEX_KEY);
        if (Array.isArray(index)) return index;
    } catch { /* ignore */ }
    return [];
};

export const saveToSlot = async (name, state, keepLastNImages = 0) => {
    const payload = buildSavePayload(state);
    const id = `slot_${Date.now()}`;
    const entry = {
        id,
        name: name || 'Save',
        savedAt: Date.now(),
        pages: countPages(state.history),
        title: state.exportDetails?.title || 'Untitled',
    };
    await idbPut('saves', payload, id);
    try { await copyImages(ACTIVE_SAVE_ID, id, keepLastNImages); } catch { /* ignore */ }
    const prev = await listSlots();
    const next = [entry, ...prev].slice(0, 12);
    await idbPut('meta', next, SLOT_INDEX_KEY);
    return entry;
};

export const deleteSlot = async (id) => {
    try { await idbDelete('saves', id); } catch { /* ignore */ }
    try { await deleteImagesForSave(id); } catch { /* ignore */ }
    const next = (await listSlots()).filter((s) => s.id !== id);
    await idbPut('meta', next, SLOT_INDEX_KEY);
    return next;
};

export const loadSlot = async (id) => {
    const data = await idbGet('saves', id);
    const migrated = migrateSave(data);
    if (!migrated) return null;
    return attachStoredImages(migrated, id);
};

export const exportStoryFile = (state) => {
    const payload = buildSavePayload(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = (state.exportDetails?.title || 'chronicle').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    a.href = url;
    a.download = `${safeTitle}.chronicle.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const importStoryFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            const migrated = migrateSave(data);
            if (!migrated) throw new Error('No story data found in file');
            resolve(migrated);
        } catch (e) {
            reject(e);
        }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
});

// Legacy aliases used during the v2 localStorage era.
export const readSave = readActiveSave;
export const writeSave = writeActiveSave;
export const clearSave = clearActiveSave;
