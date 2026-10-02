import { CODEX_DESC_LIMIT, CODEX_VISUAL_LIMIT, EMPTY_SCENE } from '../constants.js';
import {
    normalizeCodex, normalizeEntry, normalizePossession, normalizeScene, normalizeSummary, sanitizeSceneString,
} from '../utils/storage.js';

export const normalizeKey = (key) => String(key || '').trim().replace(/\s+/g, ' ');

// How many unfolded beats the prompt shows and compaction keeps.
export const BEAT_WINDOW = 14;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "kael_voss" should also match "Kael Voss" in prose.
const nameVariants = (name) => {
    const n = normalizeKey(name);
    if (!n) return [];
    const out = [n];
    const spaced = n.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const underscored = spaced.replace(/\s+/g, '_');
    for (const v of [spaced, underscored]) {
        if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    }
    return out;
};

const NAME_BOUNDARY_L = '(?<![A-Za-z0-9_-])';
const NAME_BOUNDARY_R = '(?![A-Za-z0-9_-])';

export const mentionedIn = (text, name) => {
    if (!text) return false;
    return nameVariants(name).some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(text));
};

const resolveCategory = (raw) => {
    const catKey = String(raw || '').toLowerCase();
    if (catKey === 'character' || catKey === 'person' || catKey === 'people' || catKey === 'characters') return 'characters';
    if (catKey === 'place' || catKey === 'location' || catKey === 'locations' || catKey === 'places') return 'places';
    if (catKey === 'item' || catKey === 'artifact' || catKey === 'artifacts' || catKey === 'items') return 'items';
    return null;
};

// The model clears a free-text field by sending one of these values.
export const isClearSentinel = (value) => /^(none|n\/a|-|cleared|null)$/i.test(String(value || '').trim());

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
        const statusRaw = typeof item.status === 'string' ? item.status.trim() : '';
        const locationRaw = typeof item.location === 'string' ? item.location.trim() : '';
        const clearStatus = isClearSentinel(statusRaw);
        const clearLocation = isClearSentinel(locationRaw);
        const status = clearStatus ? '' : statusRaw;
        const location = clearLocation ? '' : locationRaw;
        const possession = normalizePossession(item.possession);
        const holderRaw = typeof item.holder === 'string' ? item.holder.trim() : '';
        const holder = isClearSentinel(holderRaw) ? '' : sanitizeSceneString(holderRaw, 60);

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
                status: clearStatus ? '' : (status || existing.status),
                location: clearLocation ? '' : (location || existing.location),
                visual: visual || existing.visual,
                // An explicit possession replaces the old one and resets a stale holder.
                possession: possession || existing.possession,
                holder: possession ? holder : (holder || existing.holder),
            };
        } else {
            next[catKey][incomingKey] = {
                description: appendDescription('', rawEntry),
                citations: [pageNum],
                aliases: aliases.filter((a) => a.toLowerCase() !== incomingKey.toLowerCase()),
                status,
                location,
                possession,
                holder,
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
        possession: data.possession || undefined,
        holder: data.holder || undefined,
        visual: data.visual,
        source: data.source,
        pinned: data.pinned || undefined,
    };
};

// Items on the player right now.
export const carriedItems = (codex) => {
    const src = normalizeCodex(codex);
    return Object.entries(src.items || {})
        .filter(([, data]) => data.possession === 'carried')
        .map(([key, data]) => ({ key, data }));
};

// Items reachable in the current scene: marked nearby, or held by someone present.
export const nearbyItems = (codex, scene = EMPTY_SCENE) => {
    const src = normalizeCodex(codex);
    const present = (scene?.present_characters || []).map((n) => String(n).toLowerCase());
    const heldByPresent = (holder) => {
        if (!holder) return false;
        const h = holder.toLowerCase();
        return present.some((p) => p === h || mentionedIn(p, holder) || mentionedIn(holder, p));
    };
    return Object.entries(src.items || {})
        .filter(([, data]) => data.possession === 'nearby'
            || (data.possession !== 'carried' && data.possession !== 'lost' && data.possession !== 'stored' && heldByPresent(data.holder)))
        .map(([key, data]) => ({ key, data }));
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
            const isCarried = cat === 'items' && data.possession === 'carried';
            const always = Boolean(data.source === 'player' || data.pinned || isProtagonist || isCurrentPlace || isCarried);
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

export const splitBeatsForCompaction = (summary, keepRecent = BEAT_WINDOW) => {
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
    // Arrays are authoritative whenever the update carries them (even empty):
    // that is how characters leave a scene and threads get resolved. A
    // salvaged turn has no scene keys at all, so the previous scene survives.
    return {
        location: next.location || base.location,
        time_of_day: next.time_of_day || base.time_of_day,
        present_characters: Array.isArray(update.present_characters) ? next.present_characters : base.present_characters,
        goal: next.goal || base.goal,
        open_threads: Array.isArray(update.open_threads) ? next.open_threads : base.open_threads,
    };
};

/**
 * Player codex edits replayed on top of a rebuilt codex (rewind/regenerate).
 * overrides = { ops: [{ type: 'patch', atTurn, category, key, patch } |
 *                     { type: 'merge', atTurn, category, from, into }] }
 * atTurn = number of AI turns in history when the player made the edit.
 */
export const applyCodexOverrides = (codex, overrides, atTurn) => {
    const ops = Array.isArray(overrides?.ops) ? overrides.ops : [];
    let next = codex;
    for (const op of ops) {
        if (!op || op.atTurn !== atTurn) continue;
        if (op.type === 'patch') next = updateCodexEntry(next, op.category, op.key, op.patch || {});
        else if (op.type === 'merge') next = mergeCodexKeys(next, op.category, op.from, op.into);
    }
    return next;
};

export const pruneCodexOverrides = (overrides, maxTurn) => ({
    ops: (Array.isArray(overrides?.ops) ? overrides.ops : []).filter((op) => op && op.atTurn <= maxTurn),
});

export const appendCodexOverride = (overrides, op) => ({
    ops: [...(Array.isArray(overrides?.ops) ? overrides.ops : []), op],
});

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
        possession: patch.possession != null ? normalizePossession(patch.possession) : current.possession,
        holder: patch.holder != null ? sanitizeSceneString(String(patch.holder), 60) : current.holder,
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
        possession: into.possession || from.possession,
        holder: into.holder || from.holder,
        visual: into.visual || from.visual,
        hasPortrait: Boolean(into.hasPortrait || from.hasPortrait),
        portraitUrl: into.portraitUrl || from.portraitUrl,
        pinned: into.pinned || from.pinned,
        source: into.source === 'player' || from.source === 'player' ? 'player' : 'model',
    };
    delete next[category][fromKey];
    return next;
};

const GENERIC_VISUAL = { characters: 'a figure', places: 'a place', items: 'an object' };

const stripNames = (text, names) => {
    let out = String(text || '');
    for (const n of names) {
        out = out.replace(new RegExp(`${NAME_BOUNDARY_L}${escapeRegExp(n)}${NAME_BOUNDARY_R}`, 'gi'), '');
    }
    return out.replace(/\s{2,}/g, ' ').replace(/^[\s,;:'"-]+|[\s,;:'"-]+$/g, '').trim();
};

// A painter-safe description that never contains the entity's own name.
export const visualForEntry = (key, data, category = 'characters') => {
    const names = [key, ...(data?.aliases || [])].flatMap(nameVariants);
    const visual = stripNames(data?.visual || '', names);
    if (visual) return visual;
    const desc = stripNames((data?.description || '').split(/[.;]/)[0], names);
    if (desc) return desc;
    return GENERIC_VISUAL[category] || 'a figure';
};

// Proper names shorter than this are left alone for places/items (common
// nouns like "door"); character names and aliases are always scrubbed.
const NAME_SCRUB_MIN = { characters: 3, places: 8, items: 8 };

// Replace codex names in an image prompt with their visual descriptions in a
// single pass, so an inserted visual is never re-scanned for shorter names.
export const scrubImagePrompt = (prompt, codex) => {
    if (!prompt) return prompt;
    const src = normalizeCodex(codex);
    const byName = new Map();
    for (const cat of ['characters', 'places', 'items']) {
        for (const [key, val] of Object.entries(src[cat] || {})) {
            const data = normalizeEntry(val);
            const visual = visualForEntry(key, data, cat);
            for (const raw of [key, ...(data.aliases || [])]) {
                for (const n of nameVariants(raw)) {
                    if (n.length < NAME_SCRUB_MIN[cat]) continue;
                    const lower = n.toLowerCase();
                    if (!byName.has(lower)) byName.set(lower, { name: n, visual });
                }
            }
        }
    }
    if (!byName.size) return String(prompt);
    const names = [...byName.values()].map((row) => row.name).sort((a, b) => b.length - a.length);
    const re = new RegExp(`${NAME_BOUNDARY_L}(?:${names.map(escapeRegExp).join('|')})${NAME_BOUNDARY_R}`, 'gi');
    return String(prompt).replace(re, (match) => byName.get(match.toLowerCase())?.visual || match);
};

const PROPER_NOUN_STOP = new Set(('i you the a an it he she they we but and or then when as if your his her their its this that there here what where who why how yes no not so now still just only even every each some all nothing something someone behind beneath above below inside outside beyond before after through across around against without with from into onto over under upon down up out off on in at to for of by do does did is are was were be been will would could should can may might must suddenly somewhere perhaps maybe meanwhile instead otherwise however yet also again once twice finally later soon today tonight tomorrow yesterday mr mrs ms dr sir lord lady captain doctor chapter page end north south east west').split(' '));

// Capitalized, non-sentence-initial words (and runs of them) in the
// narrative that no codex entry or the scene location accounts for. Used to
// decide whether the lore backfill call is worth making this turn.
export const unknownProperNouns = (narrative, codex, scene = EMPTY_SCENE) => {
    const text = String(narrative || '');
    if (!text) return [];
    const known = new Set();
    const src = normalizeCodex(codex);
    for (const cat of ['characters', 'places', 'items']) {
        for (const [key, val] of Object.entries(src[cat] || {})) {
            for (const raw of [key, ...(normalizeEntry(val).aliases || [])]) {
                for (const n of nameVariants(raw)) {
                    known.add(n.toLowerCase());
                    for (const w of n.toLowerCase().split(/[\s_-]+/)) if (w) known.add(w);
                }
            }
        }
    }
    for (const w of String(scene?.location || '').toLowerCase().split(/[^a-z0-9]+/)) if (w) known.add(w);

    const found = [];
    const seen = new Set();
    const tokens = text.split(/\s+/);
    let sentenceStart = true;
    let run = [];
    const flushRun = () => {
        if (!run.length) { return; }
        const phrase = run.join(' ');
        const lower = phrase.toLowerCase();
        const allKnown = run.every((w) => known.has(w.toLowerCase()));
        if (!known.has(lower) && !allKnown && !seen.has(lower)) {
            seen.add(lower);
            found.push(phrase);
        }
        run = [];
    };
    for (const rawTok of tokens) {
        const leading = /^["'“‘(\[]+/.test(rawTok);
        const word = rawTok.replace(/^["'“‘(\[]+|["'”’)\],;:!?.]+$/g, '');
        const endsSentence = /[.!?]["'”’)]*$/.test(rawTok);
        const isCap = /^[A-Z][a-zA-Z'’-]{2,}$/.test(word) && !/^[A-Z]+$/.test(word);
        if (isCap && !sentenceStart && !PROPER_NOUN_STOP.has(word.toLowerCase())) {
            run.push(word);
        } else {
            flushRun();
        }
        sentenceStart = endsSentence || (leading && sentenceStart);
        if (!word) sentenceStart = true;
    }
    flushRun();
    return found;
};

export const findBucketKey = (bucket, name) => {
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
