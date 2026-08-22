import { EMPTY_SCENE, EMPTY_SUMMARY } from '../constants.js';
import { normalizeCodex, normalizeEntry, normalizeScene, normalizeSummary } from '../utils/storage.js';

export const normalizeKey = (key) => String(key || '').trim().replace(/\s+/g, ' ');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const mentionedIn = (text, name) => {
    const n = normalizeKey(name);
    if (!n || !text) return false;
    return new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(text);
};

const resolveCategory = (raw) => {
    const catKey = String(raw || '').toLowerCase();
    if (catKey === 'character' || catKey === 'person' || catKey === 'people' || catKey === 'characters') return 'characters';
    if (catKey === 'place' || catKey === 'location' || catKey === 'locations' || catKey === 'places') return 'places';
    if (catKey === 'item' || catKey === 'artifact' || catKey === 'artifacts' || catKey === 'items') return 'items';
    return null;
};

const findExistingKey = (bucket, rawKey) => {
    const n = normalizeKey(rawKey);
    if (!n) return null;
    const nLower = n.toLowerCase();
    for (const [k, val] of Object.entries(bucket)) {
        if (k.toLowerCase() === nLower) return k;
        const entry = normalizeEntry(val);
        if ((entry.aliases || []).some((a) => normalizeKey(a).toLowerCase() === nLower)) return k;
    }
    return null;
};

export const mergeCodex = (prev, updates, currentTurnIndex) => {
    if (!updates || !Array.isArray(updates)) return normalizeCodex(prev);
    const next = normalizeCodex(prev);
    const pageNum = currentTurnIndex + 1;

    updates.forEach((item) => {
        const catKey = resolveCategory(item.category);
        const incomingKey = normalizeKey(item.key);
        if (!catKey || !incomingKey || !item.entry) return;

        const existingKey = findExistingKey(next[catKey], incomingKey) || incomingKey;
        const existing = next[catKey][existingKey] ? normalizeEntry(next[catKey][existingKey]) : null;
        const aliases = Array.isArray(item.aliases) ? item.aliases.map(normalizeKey).filter(Boolean) : [];
        const status = typeof item.status === 'string' ? item.status.trim() : '';
        const location = typeof item.location === 'string' ? item.location.trim() : '';

        if (existing) {
            let desc = existing.description || '';
            if (item.entry && !desc.includes(item.entry)) desc = desc ? `${desc}; ${item.entry}` : item.entry;
            const cites = existing.citations.includes(pageNum) ? existing.citations : [...existing.citations, pageNum];
            const mergedAliases = [...existing.aliases];
            for (const a of aliases) {
                if (a.toLowerCase() !== existingKey.toLowerCase() && !mergedAliases.some((x) => x.toLowerCase() === a.toLowerCase())) {
                    mergedAliases.push(a);
                }
            }
            if (incomingKey.toLowerCase() !== existingKey.toLowerCase()
                && !mergedAliases.some((x) => x.toLowerCase() === incomingKey.toLowerCase())) {
                mergedAliases.push(incomingKey);
            }
            next[catKey][existingKey] = {
                ...existing,
                description: desc,
                citations: cites,
                aliases: mergedAliases,
                status: status || existing.status,
                location: location || existing.location,
            };
        } else {
            next[catKey][incomingKey] = {
                description: item.entry,
                citations: [pageNum],
                aliases: aliases.filter((a) => a.toLowerCase() !== incomingKey.toLowerCase()),
                status,
                location,
                source: 'model',
                pinned: false,
            };
        }
    });
    return next;
};

export const countCodexEntries = (codex) =>
    ['characters', 'places', 'items'].reduce((acc, c) => acc + Object.keys(codex[c] || {}).length, 0);

export const appendBeat = (summary, beatText) => {
    const norm = normalizeSummary(summary);
    if (beatText && beatText.trim()) {
        return { beats: [...norm.beats, beatText.trim()], longTerm: norm.longTerm, foldedThrough: norm.foldedThrough || 0 };
    }
    return norm;
};

export const hashBeats = (beats) => (beats || []).join('\n');

export const applyCompaction = (summary, split, folded) => {
    const norm = normalizeSummary(summary);
    const prefix = norm.beats.slice(0, split.toFold.length);
    if (hashBeats(prefix) !== hashBeats(split.toFold)) return null;
    return {
        beats: norm.beats.slice(split.toFold.length),
        longTerm: folded,
        foldedThrough: (norm.foldedThrough || 0) + split.toFold.length,
    };
};

const compactForm = (key, data) => ({
    key,
    description: data.description,
    aliases: data.aliases,
    status: data.status,
    location: data.location,
    source: data.source,
    pinned: data.pinned,
});

export const selectRelevantCodex = (codex, recentText = '', scene = EMPTY_SCENE, maxEntries = 24) => {
    const all = [];
    const src = normalizeCodex(codex);
    const sceneLoc = scene?.location || '';

    for (const cat of ['characters', 'places', 'items']) {
        const entries = src[cat] || {};
        for (const [key, val] of Object.entries(entries)) {
            const data = normalizeEntry(val);
            const cites = data.citations || [];
            const lastCite = cites.length ? Math.max(...cites) : 0;
            const names = [key, ...(data.aliases || [])];
            const mentioned = names.some((n) => mentionedIn(recentText, n));
            const isProtagonist = cat === 'characters' && Object.keys(entries)[0] === key;
            const isCurrentPlace = cat === 'places' && sceneLoc && names.some((n) => mentionedIn(sceneLoc, n) || n.toLowerCase() === sceneLoc.toLowerCase());
            const always = Boolean(data.pinned || data.source === 'player' || isProtagonist || isCurrentPlace);
            const score = (always ? 200000 : 0) + (mentioned ? 100000 : 0) + lastCite;
            all.push({ cat, key, data, score, always });
        }
    }

    all.sort((a, b) => b.score - a.score);
    const pinned = all.filter((p) => p.always);
    const rest = all.filter((p) => !p.always);
    const picked = [...pinned];
    for (const row of rest) {
        if (picked.length >= maxEntries) break;
        picked.push(row);
    }

    const out = { characters: {}, places: {}, items: {} };
    for (const p of picked) out[p.cat][p.key] = compactForm(p.key, p.data);
    return { codex: out, omitted: Math.max(0, all.length - picked.length) };
};

export const splitBeatsForCompaction = (summary, keepRecent = 14) => {
    const norm = normalizeSummary(summary);
    if (norm.beats.length <= keepRecent + 6) return null;
    const toFold = norm.beats.slice(0, norm.beats.length - keepRecent);
    const keep = norm.beats.slice(norm.beats.length - keepRecent);
    return { toFold, keep, longTerm: norm.longTerm, foldedThrough: norm.foldedThrough || 0 };
};

export const recentNarratives = (history, count = 2) => {
    const out = [];
    for (let i = history.length - 1; i >= 0 && out.length < count; i--) {
        const t = history[i];
        if (t && t.type === 'ai' && t.narrative) out.unshift(t.narrative);
    }
    return out;
};

export const mergeScene = (prev, update) => {
    const base = normalizeScene(prev || EMPTY_SCENE);
    if (!update || typeof update !== 'object') return base;
    const next = normalizeScene(update);
    return {
        location: next.location || base.location,
        time_of_day: next.time_of_day || base.time_of_day,
        present_characters: next.present_characters.length ? next.present_characters : base.present_characters,
        goal: next.goal || base.goal,
        open_threads: next.open_threads.length ? next.open_threads : base.open_threads,
    };
};

export const updateCodexEntry = (codex, category, key, patch) => {
    const next = normalizeCodex(codex);
    if (!next[category] || !next[category][key]) return next;
    const current = normalizeEntry(next[category][key]);
    const aliases = patch.aliases != null
        ? String(patch.aliases).split(',').map(normalizeKey).filter(Boolean)
        : current.aliases;
    next[category][key] = {
        ...current,
        description: patch.description != null ? String(patch.description) : current.description,
        status: patch.status != null ? String(patch.status) : current.status,
        location: patch.location != null ? String(patch.location) : current.location,
        aliases,
        pinned: patch.pinned != null ? Boolean(patch.pinned) : current.pinned,
        source: 'player',
    };
    return next;
};

export const pinCodexEntry = (codex, category, key, pinned) =>
    updateCodexEntry(codex, category, key, { pinned });

export const mergeCodexKeys = (codex, category, fromKey, intoKey) => {
    const next = normalizeCodex(codex);
    if (!next[category] || fromKey === intoKey) return next;
    const from = next[category][fromKey] && normalizeEntry(next[category][fromKey]);
    const into = next[category][intoKey] && normalizeEntry(next[category][intoKey]);
    if (!from || !into) return next;
    const aliases = [...into.aliases];
    const addAlias = (a) => {
        const n = normalizeKey(a);
        if (n && n.toLowerCase() !== intoKey.toLowerCase() && !aliases.some((x) => x.toLowerCase() === n.toLowerCase())) {
            aliases.push(n);
        }
    };
    addAlias(fromKey);
    from.aliases.forEach(addAlias);
    let desc = into.description || '';
    if (from.description && !desc.includes(from.description)) desc = desc ? `${desc}; ${from.description}` : from.description;
    next[category][intoKey] = {
        ...into,
        description: desc,
        citations: [...new Set([...(into.citations || []), ...(from.citations || [])])].sort((a, b) => a - b),
        aliases,
        status: into.status || from.status,
        location: into.location || from.location,
        pinned: into.pinned || from.pinned,
        source: into.source === 'player' || from.source === 'player' ? 'player' : 'model',
    };
    delete next[category][fromKey];
    return next;
};

const visualForEntry = (key, data) => {
    const desc = (data.description || '').split(/[.;]/)[0].trim();
    if (desc) return desc;
    return `a figure known as ${key}`;
};

export const scrubImagePrompt = (prompt, codex) => {
    if (!prompt) return prompt;
    let out = String(prompt);
    const names = [];
    const src = normalizeCodex(codex);
    for (const cat of ['characters', 'places', 'items']) {
        for (const [key, val] of Object.entries(src[cat] || {})) {
            const data = normalizeEntry(val);
            names.push({ name: key, visual: visualForEntry(key, data) });
            for (const alias of data.aliases || []) names.push({ name: alias, visual: visualForEntry(key, data) });
        }
    }
    names.sort((a, b) => b.name.length - a.name.length);
    for (const { name, visual } of names) {
        const n = normalizeKey(name);
        if (!n || n.length < 2) continue;
        out = out.replace(new RegExp(`\\b${escapeRegExp(n)}\\b`, 'gi'), visual);
    }
    return out;
};
