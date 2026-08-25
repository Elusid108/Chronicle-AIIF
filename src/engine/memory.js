import { CODEX_DESC_LIMIT, CODEX_VISUAL_LIMIT, EMPTY_SCENE } from '../constants.js';
import { normalizeCodex, normalizeEntry, normalizeScene, normalizeSummary, sanitizeSceneString } from '../utils/storage.js';

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

const appendDescription = (existing, incoming) => {
    const nextBit = sanitizeSceneString(incoming, 400);
    if (!nextBit) return existing || '';
    let desc = existing || '';
    if (desc.toLowerCase().includes(nextBit.toLowerCase())) return desc;
    desc = desc ? `${desc}; ${nextBit}` : nextBit;
    if (desc.length <= CODEX_DESC_LIMIT) return desc;
    return desc.slice(0, CODEX_DESC_LIMIT).replace(/\s+\S*$/, '').trim();
};

export const mergeCodex = (prev, updates, currentTurnIndex) => {
    if (!updates || !Array.isArray(updates)) return normalizeCodex(prev);
    const next = normalizeCodex(prev);
    const pageNum = currentTurnIndex + 1;

    updates.forEach((item) => {
        const catKey = resolveCategory(item.category);
        const rawKey = normalizeKey(item.key);
        const rawName = normalizeKey(item.name);
        const incomingKey = rawKey || (rawName
            ? rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
            : '');
        if (!catKey || !incomingKey) return;
        const visualRaw = typeof item.visual === 'string' ? item.visual.trim() : '';
        const fromEntry = typeof item.entry === 'string' ? item.entry.trim() : '';
        const fromDesc = typeof item.description === 'string' ? item.description.trim() : '';
        const looksLikeKey = (text) => {
            if (!text) return false;
            const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            return slug === incomingKey && !/\s/.test(text);
        };
        const rawEntry = [fromEntry, fromDesc, visualRaw].find((text) => text && !looksLikeKey(text)) || '';
        const visual = sanitizeSceneString(visualRaw, CODEX_VISUAL_LIMIT);

        const existingKey = findExistingKey(next[catKey], incomingKey) || incomingKey;
        const existing = next[catKey][existingKey] ? normalizeEntry(next[catKey][existingKey]) : null;
        const aliases = Array.isArray(item.aliases) ? item.aliases.map(normalizeKey).filter(Boolean) : [];
        const status = typeof item.status === 'string' ? item.status.trim() : '';
        const location = typeof item.location === 'string' ? item.location.trim() : '';

        if (existing) {
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
                description: rawEntry
                    ? (looksLikeKey(existing.description)
                        ? appendDescription('', rawEntry)
                        : appendDescription(existing.description, rawEntry))
                    : existing.description,
                citations: cites,
                aliases: mergedAliases,
                status: status || existing.status,
                location: location || existing.location,
                visual: visual || existing.visual,
            };
        } else {
            next[catKey][incomingKey] = {
                description: appendDescription('', rawEntry),
                citations: [pageNum],
                aliases: aliases.filter((a) => a.toLowerCase() !== incomingKey.toLowerCase()),
                status,
                location,
                source: 'model',
                pinned: false,
                visual,
                hasPortrait: false,
                portraitUrl: '',
            };
        }
    });
    return next;
};

export const listCodexKeys = (codex) => {
    const out = [];
    const src = normalizeCodex(codex);
    for (const cat of ['characters', 'places', 'items']) {
        for (const key of Object.keys(src[cat] || {})) out.push({ cat, key });
    }
    return out;
};

export const diffNewCodexEntries = (prev, next) => {
    const old = new Set(listCodexKeys(prev).map((x) => `${x.cat}:${x.key.toLowerCase()}`));
    return listCodexKeys(next).filter((x) => !old.has(`${x.cat}:${x.key.toLowerCase()}`));
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

const compactForm = (key, data) => {
    const desc = data.description || '';
    const slug = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const descSlug = desc.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const description = (desc && descSlug !== slug) ? desc : (data.visual || desc);
    return {
        key,
        description,
        aliases: data.aliases,
        status: data.status,
        location: data.location,
        visual: data.visual,
        source: data.source,
    };
};

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
            const always = Boolean(data.source === 'player' || isProtagonist || isCurrentPlace);
            const score = (always ? 200000 : 0) + (mentioned ? 100000 : 0) + lastCite;
            all.push({ cat, key, data, score, always });
        }
    }

    all.sort((a, b) => b.score - a.score);
    const forced = all.filter((p) => p.always);
    const rest = all.filter((p) => !p.always);
    const picked = [...forced];
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
        visual: patch.visual != null ? sanitizeSceneString(String(patch.visual), CODEX_VISUAL_LIMIT) : current.visual,
        hasPortrait: patch.hasPortrait != null ? Boolean(patch.hasPortrait) : current.hasPortrait,
        portraitUrl: patch.portraitUrl != null ? String(patch.portraitUrl) : current.portraitUrl,
        source: patch.source != null ? patch.source : (patch.description != null ? 'player' : current.source),
    };
    return next;
};

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
        visual: into.visual || from.visual,
        hasPortrait: Boolean(into.hasPortrait || from.hasPortrait),
        portraitUrl: into.portraitUrl || from.portraitUrl,
        pinned: into.pinned || from.pinned,
        source: into.source === 'player' || from.source === 'player' ? 'player' : 'model',
    };
    delete next[category][fromKey];
    return next;
};

export const visualForEntry = (key, data) => {
    if (data?.visual) return data.visual;
    const desc = (data?.description || '').split(/[.;]/)[0].trim();
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
            const n = normalizeKey(key);
            if (!n || n.length < 8) continue;
            names.push({ name: n, visual: visualForEntry(key, normalizeEntry(val)) });
        }
    }
    names.sort((a, b) => b.name.length - a.name.length);
    for (const { name, visual } of names) {
        const re = new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(name)}(?![A-Za-z0-9-])`, 'gi');
        out = out.replace(re, visual);
    }
    return out;
};

const findBucketKey = (bucket, name) => {
    const n = normalizeKey(name);
    if (!n) return null;
    const nLower = n.toLowerCase();
    for (const [k, val] of Object.entries(bucket || {})) {
        if (k.toLowerCase() === nLower) return k;
        const entry = normalizeEntry(val);
        if ((entry.aliases || []).some((a) => normalizeKey(a).toLowerCase() === nLower)) return k;
    }
    return null;
};

export const overlayCodexRuntime = (rebuilt, previous) => {
    const next = normalizeCodex(rebuilt);
    const old = normalizeCodex(previous);
    for (const cat of ['characters', 'places', 'items']) {
        for (const [key, data] of Object.entries(next[cat] || {})) {
            const prior = old[cat]?.[key];
            if (!prior) continue;
            next[cat][key] = {
                ...data,
                visual: data.visual || prior.visual,
                hasPortrait: Boolean(data.hasPortrait || prior.hasPortrait),
                portraitUrl: data.portraitUrl || prior.portraitUrl,
            };
        }
    }
    return next;
};

export const pickCodexImageRefs = (codex, scene = EMPTY_SCENE, narrative = '', maxRefs = 10, opts = {}) => {
    const src = normalizeCodex(codex);
    const picks = [];
    const used = new Set();
    let characterCount = 0;
    const allowMissing = Boolean(opts.allowMissing);
    const take = (cat, key, label) => {
        if (!key || picks.length >= maxRefs) return;
        if (cat === 'characters' && characterCount >= 4) return;
        const id = `${cat}:${key.toLowerCase()}`;
        if (used.has(id)) return;
        const data = src[cat]?.[key];
        if (!data) return;
        if (!allowMissing && !(data.hasPortrait || data.portraitUrl)) return;
        used.add(id);
        if (cat === 'characters') characterCount += 1;
        picks.push({ category: cat, key, label });
    };

    for (const name of scene.present_characters || []) {
        const key = findBucketKey(src.characters, name);
        if (key) take('characters', key, `Character reference for ${key}. Keep this face, hair, and clothing.`);
    }
    const placeKey = findBucketKey(src.places, scene.location)
        || Object.keys(src.places || {}).find((k) => mentionedIn(scene.location || '', k));
    if (placeKey) take('places', placeKey, `Location reference for ${placeKey}. Keep this architecture and lighting.`);

    const haystack = `${narrative || ''} ${scene.location || ''}`;
    for (const cat of ['items', 'characters', 'places']) {
        const kind = cat === 'characters' ? 'Character' : cat === 'places' ? 'Location' : 'Object';
        for (const [key, val] of Object.entries(src[cat] || {})) {
            const data = normalizeEntry(val);
            const names = [key, ...(data.aliases || [])];
            if (!names.some((n) => mentionedIn(haystack, n))) continue;
            take(cat, key, `${kind} reference for ${key}. Match this appearance.`);
        }
    }
    return picks;
};
