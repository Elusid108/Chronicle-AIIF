import {
    CODEX_DESC_LIMIT, CODEX_VISUAL_LIMIT, DEFAULT_CONFIG, DEFAULT_CODEX, EMPTY_SCENE, EMPTY_SUMMARY,
    INITIAL_SUMMARY, SCENE_FIELD_LIMITS,
} from '../constants.js';
import {
    ACTIVE_SAVE_ID, copyCodexImages, copyImages, deleteCodexImagesForSave, deleteImagesForSave,
    getCodexImage, getTurnImage, idbDelete, idbGet, idbPut,
} from './idb.js';
import { revokeIfBlobUrl } from './images.js';

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

export const sanitizeSceneString = (value, maxLen = 200) => {
    let s = String(value || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const meta = s.search(/\bLet's (?:clean|keep)\b/i);
    if (meta > 0) s = s.slice(0, meta).trim();
    else if (meta === 0) {
        const parts = s.split(/\bLet's (?:clean|keep)[^:]*:\s*/i).map((p) => p.trim()).filter(Boolean);
        s = (parts[parts.length - 1] || '').trim();
    }
    const sentences = s.split(/(?<=[.!?])\s+/);
    const out = [];
    for (const sent of sentences) {
        if (!sent) continue;
        if (out.length && out[out.length - 1] === sent) continue;
        out.push(sent);
    }
    s = out.join(' ');
    const repeated = s.match(/(.{16,}?)\1{2,}/);
    if (repeated) s = s.slice(0, s.indexOf(repeated[1]) + repeated[1].length).trim();
    if (s.length > maxLen) {
        s = s.slice(0, maxLen);
        const clipped = s.lastIndexOf(' ');
        if (clipped > maxLen * 0.6) s = s.slice(0, clipped);
        s = s.trim();
    }
    return s;
};

const uniqCap = (arr, maxItems, maxLen) => {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(arr) ? arr : []) {
        const s = sanitizeSceneString(raw, maxLen);
        if (!s) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
        if (out.length >= maxItems) break;
    }
    return out;
};

export const persistableEntry = (val) => {
    const n = normalizeEntry(val);
    return {
        description: n.description,
        citations: n.citations,
        aliases: n.aliases,
        status: n.status,
        location: n.location,
        source: n.source,
        pinned: n.pinned,
        visual: n.visual,
        hasPortrait: n.hasPortrait,
    };
};

export const normalizeEntry = (val) => {
    if (typeof val === 'string') {
        return {
            description: sanitizeSceneString(val, CODEX_DESC_LIMIT),
            citations: [],
            aliases: [],
            status: '',
            location: '',
            source: 'model',
            pinned: false,
            visual: '',
            hasPortrait: false,
            portraitUrl: '',
        };
    }
    const data = val && typeof val === 'object' ? val : {};
    return {
        description: sanitizeSceneString(typeof data.description === 'string' ? data.description : '', CODEX_DESC_LIMIT),
        citations: Array.isArray(data.citations) ? data.citations.slice() : [],
        aliases: Array.isArray(data.aliases) ? data.aliases.map(String).filter(Boolean) : [],
        status: sanitizeSceneString(typeof data.status === 'string' ? data.status : '', 80),
        location: sanitizeSceneString(typeof data.location === 'string' ? data.location : '', 120),
        source: data.source === 'player' ? 'player' : 'model',
        pinned: Boolean(data.pinned),
        visual: sanitizeSceneString(typeof data.visual === 'string' ? data.visual : '', CODEX_VISUAL_LIMIT),
        hasPortrait: Boolean(data.hasPortrait),
        portraitUrl: typeof data.portraitUrl === 'string' ? data.portraitUrl : '',
    };
};

export const normalizeCodex = (codex, persistable = false) => {
    const src = codex && typeof codex === 'object' ? codex : { ...DEFAULT_CODEX };
    const out = { characters: {}, places: {}, items: {} };
    for (const cat of ['characters', 'places', 'items']) {
        const bucket = src[cat] && typeof src[cat] === 'object' ? src[cat] : {};
        for (const [key, val] of Object.entries(bucket)) {
            if (!key) continue;
            out[cat][key] = persistable ? persistableEntry(val) : normalizeEntry(val);
        }
    }
    return out;
};

export const normalizeScene = (scene) => {
    const s = scene && typeof scene === 'object' ? scene : {};
    return {
        location: sanitizeSceneString(s.location, SCENE_FIELD_LIMITS.location),
        time_of_day: sanitizeSceneString(s.time_of_day, SCENE_FIELD_LIMITS.time_of_day),
        present_characters: uniqCap(
            (Array.isArray(s.present_characters) ? s.present_characters : []).filter(
                (name) => !/^(you|player|protagonist|the player)$/i.test(String(name || '').trim()),
            ),
            12,
            SCENE_FIELD_LIMITS.present_character,
        ),
        goal: sanitizeSceneString(s.goal, SCENE_FIELD_LIMITS.goal),
        open_threads: uniqCap(s.open_threads, 6, SCENE_FIELD_LIMITS.open_thread),
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
    if (!data || !Array.isArray(data.history)) return null;
    const history = data.history.map(stripTurnMedia);
    return {
        history,
        codex: normalizeCodex(data.codex, true),
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
    codex: normalizeCodex(state.codex, true),
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
const CURRENT_SLOT_KEY = 'currentSlotId';

const settingLabel = (config) => {
    if (!config || typeof config !== 'object') return '';
    if (config.setting === 'custom') return config.settingCustom || 'Custom';
    return config.setting || '';
};

export const defaultSlotName = (state) => {
    const pages = countPages(state?.history);
    const title = state?.exportDetails?.title;
    if (title && title !== 'The Unnamed Chronicle') return title;
    const genre = settingLabel(state?.config);
    if (pages === 0) return genre ? `New ${genre} story` : 'New story';
    return genre ? `${genre} · ${pages} ${pages === 1 ? 'page' : 'pages'}` : `${pages} ${pages === 1 ? 'page' : 'pages'}`;
};

const slotMetaFromState = (id, state, existing = null) => ({
    id,
    name: existing?.customName ? existing.name : defaultSlotName(state),
    savedAt: Date.now(),
    pages: countPages(state?.history),
    title: state?.exportDetails?.title || existing?.title || 'Untitled',
    setting: settingLabel(state?.config) || existing?.setting || '',
    customName: Boolean(existing?.customName),
});

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
    try { await deleteCodexImagesForSave(ACTIVE_SAVE_ID); } catch { /* ignore */ }
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

export const attachCodexPortraits = async (codex, saveId = ACTIVE_SAVE_ID) => {
    const src = normalizeCodex(codex);
    for (const cat of ['characters', 'places', 'items']) {
        for (const [key, data] of Object.entries(src[cat] || {})) {
            if (data.portraitUrl) continue;
            try {
                const blob = (saveId && await getCodexImage(saveId, cat, key))
                    || await getCodexImage(ACTIVE_SAVE_ID, cat, key);
                if (blob) src[cat][key] = { ...data, portraitUrl: URL.createObjectURL(blob), hasPortrait: true };
            } catch { /* ignore */ }
        }
    }
    return src;
};

export const revokeCodexPortraits = (codex) => {
    const src = codex && typeof codex === 'object' ? codex : {};
    for (const cat of ['characters', 'places', 'items']) {
        for (const val of Object.values(src[cat] || {})) revokeIfBlobUrl(val?.portraitUrl);
    }
};

export const listSlots = async () => {
    try {
        const index = await idbGet('meta', SLOT_INDEX_KEY);
        if (Array.isArray(index)) return index;
    } catch { /* ignore */ }
    return [];
};

export const getCurrentSlotId = async () => {
    try {
        const id = await idbGet('meta', CURRENT_SLOT_KEY);
        return id || null;
    } catch { /* ignore */ }
    return null;
};

export const setCurrentSlotId = async (id) => {
    if (id) await idbPut('meta', id, CURRENT_SLOT_KEY);
    else {
        try { await idbDelete('meta', CURRENT_SLOT_KEY); } catch { /* ignore */ }
    }
};

const writeSlotIndex = async (index) => {
    await idbPut('meta', index, SLOT_INDEX_KEY);
    return index;
};

export const createStorySlot = async (state, keepLastNImages = 0) => {
    const id = `slot_${Date.now()}`;
    const payload = buildSavePayload(state);
    const entry = slotMetaFromState(id, state);
    await idbPut('saves', payload, id);
    try { await copyImages(ACTIVE_SAVE_ID, id, keepLastNImages); } catch { /* ignore */ }
    try { await copyCodexImages(ACTIVE_SAVE_ID, id); } catch { /* ignore */ }
    const prev = await listSlots();
    await writeSlotIndex([entry, ...prev.filter((s) => s.id !== id)]);
    await setCurrentSlotId(id);
    return entry;
};

export const writeStorySlot = async (id, state, keepLastNImages = 0) => {
    if (!id) return null;
    const payload = buildSavePayload(state);
    await idbPut('saves', payload, id);
    try { await copyImages(ACTIVE_SAVE_ID, id, keepLastNImages); } catch { /* ignore */ }
    try { await copyCodexImages(ACTIVE_SAVE_ID, id); } catch { /* ignore */ }
    const prev = await listSlots();
    const existing = prev.find((s) => s.id === id) || null;
    const entry = slotMetaFromState(id, state, existing);
    const next = existing
        ? prev.map((s) => (s.id === id ? entry : s))
        : [entry, ...prev];
    await writeSlotIndex(next);
    return entry;
};

export const renameSlot = async (id, name) => {
    const trimmed = String(name || '').trim();
    const prev = await listSlots();
    const next = prev.map((s) => (s.id === id ? { ...s, name: trimmed || s.name, customName: true } : s));
    return writeSlotIndex(next);
};

export const reorderSlots = async (id, direction) => {
    const prev = await listSlots();
    const i = prev.findIndex((s) => s.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return writeSlotIndex(next);
};

export const saveToSlot = async (name, state, keepLastNImages = 0) => {
    const entry = await createStorySlot(state, keepLastNImages);
    if (name) await renameSlot(entry.id, name);
    const latest = (await listSlots()).find((s) => s.id === entry.id);
    return latest || { ...entry, name: name || entry.name };
};

export const deleteSlot = async (id) => {
    try { await idbDelete('saves', id); } catch { /* ignore */ }
    try { await deleteImagesForSave(id); } catch { /* ignore */ }
    try { await deleteCodexImagesForSave(id); } catch { /* ignore */ }
    const current = await getCurrentSlotId();
    if (current === id) await setCurrentSlotId(null);
    const next = (await listSlots()).filter((s) => s.id !== id);
    return writeSlotIndex(next);
};

export const ensureActiveMigratedToLibrary = async () => {
    const existingId = await getCurrentSlotId();
    const slots = await listSlots();
    if (existingId && slots.some((s) => s.id === existingId)) return existingId;
    const active = await readActiveSave();
    if (!active || !Array.isArray(active.history) || active.history.length === 0) return existingId || null;
    const entry = await createStorySlot(active);
    return entry.id;
};

export const loadSlot = async (id) => {
    const data = await idbGet('saves', id);
    const migrated = migrateSave(data);
    if (!migrated) return null;
    const withImages = await attachStoredImages(migrated, id);
    const codex = await attachCodexPortraits(withImages.codex, id);
    return { ...withImages, codex };
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
