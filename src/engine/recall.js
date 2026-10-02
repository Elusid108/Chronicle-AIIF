/**
 * Per-story recall: every AI page is indexed (Gemini embedding + keyword
 * tokens) under its story slot in IndexedDB. Each turn retrieves the few
 * older pages most relevant to the player's action and hands them to the
 * prompt as RECALLED EARLIER EVENTS. Falls back to BM25 keyword scoring
 * whenever embeddings are unavailable.
 *
 * The scoring half of this module is pure (no IndexedDB, no fetch) so it can
 * be unit-tested in Node.
 */
import { GeminiHttpError, embedText, isAbortError } from '../api/gemini.js';
import { deleteRecallFrom, getRecallDocs, putRecallDoc } from '../utils/idb.js';
import { verboseEvent } from '../utils/verboseLog.js';

export const RECALL_DEFAULT_K = 4;
export const RECALL_BUDGET_CHARS = 1200;
export const RECALL_EXCERPT_CHARS = 600;
const QUERY_EMBED_TIMEOUT_MS = 4000;
const INDEX_BATCH = 16;

// 'untested' | 'ok' | 'unavailable' (for this page session)
export const recallState = { embeddings: 'untested', lastError: '' };
export const getRecallState = () => ({ ...recallState });

const noteEmbedError = (e) => {
    recallState.lastError = e?.message || String(e);
    if (e instanceof GeminiHttpError && [400, 403, 404].includes(e.status)) {
        recallState.embeddings = 'unavailable';
    }
    verboseEvent('recall.embedError', { error: e, state: recallState.embeddings });
};

const STOPWORDS = new Set(('a an the and or but if then than so as of at by for from in into on onto to with without over under up down out off about across after before behind beneath between beyond during through toward towards upon within is are was were be been being am do does did done have has had having can could may might must shall should will would you your yours yourself he him his she her hers it its they them their theirs we us our ours i me my mine this that these those there here where when why how what which who whom whose not no nor yes all any both each few more most other some such only own same too very just now still yet again once ever never always also even back away again around along against toward continue continues the').split(' '));

export const tokenize = (text) => String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

export const buildRecallDoc = (turn, pageNumber) => {
    const action = turn?.userActionPreceding ? String(turn.userActionPreceding).trim() : '(opening)';
    const beat = String(turn?.summary_update || '').trim().replace(/[.\s]+$/, '');
    const excerpt = String(turn?.narrative || '').replace(/\s+/g, ' ').trim().slice(0, RECALL_EXCERPT_CHARS);
    return `Page ${pageNumber}. Action: ${action}. Beat: ${beat || '(none)'}. Narrative excerpt: ${excerpt}`;
};

export const bm25Scores = (queryTokens, docs, { k1 = 1.2, b = 0.75 } = {}) => {
    const N = docs.length;
    if (!N) return [];
    const lengths = docs.map((d) => (d.tokens || []).length);
    const avgdl = lengths.reduce((a, n) => a + n, 0) / N || 1;
    const df = new Map();
    for (const d of docs) for (const t of new Set(d.tokens || [])) df.set(t, (df.get(t) || 0) + 1);
    const q = [...new Set(queryTokens || [])];
    return docs.map((d, i) => {
        const tf = new Map();
        for (const t of d.tokens || []) tf.set(t, (tf.get(t) || 0) + 1);
        let score = 0;
        for (const t of q) {
            const f = tf.get(t);
            if (!f) continue;
            const n = df.get(t) || 0;
            const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
            score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[i]) / avgdl)));
        }
        return score;
    });
};

// Vectors are L2-normalized by embedText, so the dot product is the cosine.
export const cosine = (a, b) => {
    if (!a || !b || a.length !== b.length) return 0;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
};

const MIN_COSINE = 0.45;

/**
 * Hybrid ranking: 0.6 * normalized cosine + 0.4 * normalized BM25 when both
 * are available for a doc, else BM25 alone. Docs with no lexical overlap and
 * weak vector similarity are dropped so the section stays empty rather than noisy.
 */
export const rankRecall = ({ queryTokens = [], queryVector = null, docs = [], k = RECALL_DEFAULT_K, exclude = new Set() }) => {
    const cands = docs.filter((d) => d && !exclude.has(d.turnIndex));
    if (!cands.length) return [];
    const bm = bm25Scores(queryTokens, cands);
    const bmMax = Math.max(0, ...bm);
    const vec = cands.map((d) => (queryVector && d.vector && d.vector.length === queryVector.length ? cosine(queryVector, d.vector) : null));
    const vecMax = Math.max(0, ...vec.filter((v) => v != null));
    const scored = cands.map((d, i) => {
        const bmN = bmMax > 0 ? bm[i] / bmMax : 0;
        let score;
        let keep;
        if (vec[i] != null && vecMax > 0) {
            const vN = Math.max(0, vec[i]) / vecMax;
            score = 0.6 * vN + 0.4 * bmN;
            keep = bm[i] > 0 || vec[i] >= MIN_COSINE;
        } else {
            score = bmN;
            keep = bm[i] > 0;
        }
        return { turnIndex: d.turnIndex, pageNumber: d.pageNumber, text: d.text, score, keep };
    });
    return scored
        .filter((row) => row.keep && row.score > 0)
        .sort((a, b) => b.score - a.score || a.turnIndex - b.turnIndex)
        .slice(0, Math.max(0, k))
        .map(({ keep, ...row }) => row);
};

export const formatRecallSection = (hits, budget = RECALL_BUDGET_CHARS) => {
    const lines = [];
    let used = 0;
    for (const hit of [...(hits || [])].sort((a, b) => a.pageNumber - b.pageNumber)) {
        const body = String(hit.text || '').replace(/^Page \d+\.\s*/, '').trim();
        const clipped = body.length > 280 ? `${body.slice(0, 277).replace(/\s+\S*$/, '')}…` : body;
        const line = `- Page ${hit.pageNumber}: ${clipped}`;
        if (used + line.length > budget && lines.length) break;
        lines.push(line);
        used += line.length + 1;
    }
    return lines.join('\n');
};

export const lastAiIndices = (history, count = 2) => {
    const out = [];
    for (let i = (history || []).length - 1; i >= 0 && out.length < count; i--) {
        if (history[i]?.type === 'ai') out.push(i);
    }
    return out;
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Embedding timed out')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

const embedOrNull = async (deps, texts, taskType, signal, timeoutMs) => {
    if (recallState.embeddings === 'unavailable' || !deps?.apiKey) return null;
    try {
        const p = embedText(deps, texts, { taskType, signal });
        const vectors = timeoutMs ? await withTimeout(p, timeoutMs) : await p;
        recallState.embeddings = 'ok';
        return vectors;
    } catch (e) {
        if (isAbortError(e)) throw e;
        noteEmbedError(e);
        return null;
    }
};

// ---- IndexedDB-facing API ----

export const indexTurn = async ({ slotId, turnIndex, turn, deps, signal }) => {
    if (!slotId || !turn || turn.type !== 'ai' || !turn.narrative) return;
    const pageNumber = turnIndex + 1;
    const text = buildRecallDoc(turn, pageNumber);
    const vectors = await embedOrNull(deps, [text], 'RETRIEVAL_DOCUMENT', signal);
    if (signal?.aborted) return;
    await putRecallDoc(slotId, turnIndex, {
        turnIndex, pageNumber, text, vector: vectors ? vectors[0] : null, tokens: tokenize(text), createdAt: Date.now(),
    });
    verboseEvent('recall.indexed', { turnIndex, embedded: Boolean(vectors) });
};

// Backfill missing docs for an older save (and drop docs past the end of history).
export const ensureRecallIndex = async ({ slotId, history, deps, signal }) => {
    if (!slotId || !Array.isArray(history)) return;
    await deleteRecallFrom(slotId, history.length);
    const existing = await getRecallDocs(slotId);
    const have = new Map(existing.map((d) => [d.turnIndex, d]));
    const missing = [];
    history.forEach((turn, i) => {
        if (turn?.type !== 'ai' || !turn.narrative) return;
        const doc = have.get(i);
        if (!doc) missing.push({ turn, i });
        else if (!doc.vector && recallState.embeddings !== 'unavailable') missing.push({ turn, i, reindex: true });
    });
    if (!missing.length) return;
    for (let start = 0; start < missing.length; start += INDEX_BATCH) {
        if (signal?.aborted) return;
        const batch = missing.slice(start, start + INDEX_BATCH);
        const texts = batch.map(({ turn, i }) => buildRecallDoc(turn, i + 1));
        const vectors = await embedOrNull(deps, texts, 'RETRIEVAL_DOCUMENT', signal);
        if (signal?.aborted) return;
        for (let j = 0; j < batch.length; j++) {
            const { i } = batch[j];
            await putRecallDoc(slotId, i, {
                turnIndex: i, pageNumber: i + 1, text: texts[j], vector: vectors ? vectors[j] : null, tokens: tokenize(texts[j]), createdAt: Date.now(),
            });
        }
    }
    verboseEvent('recall.backfilled', { count: missing.length });
};

/**
 * Retrieve older pages relevant to `query`. Only pages still in history are
 * considered (rewind-safe) and the pages already quoted as PREVIOUS PROSE
 * are excluded. Never throws except on abort.
 */
export const retrieveRecall = async ({ slotId, history, query, deps, signal, k = RECALL_DEFAULT_K }) => {
    const empty = { text: '', pages: [], hits: [] };
    if (!slotId || !query || !Array.isArray(history)) return empty;
    const docs = (await getRecallDocs(slotId)).filter((d) => d && d.turnIndex < history.length);
    if (!docs.length) return empty;
    const exclude = new Set(lastAiIndices(history, 2));
    const queryTokens = tokenize(query);
    let queryVector = null;
    if (docs.some((d) => d.vector)) {
        const vectors = await embedOrNull(deps, [query], 'RETRIEVAL_QUERY', signal, QUERY_EMBED_TIMEOUT_MS);
        queryVector = vectors ? vectors[0] : null;
    }
    const hits = rankRecall({ queryTokens, queryVector, docs, k, exclude });
    verboseEvent('recall.hits', {
        query, mode: queryVector ? 'hybrid' : 'lexical', candidates: docs.length,
        hits: hits.map((h) => ({ page: h.pageNumber, score: Number(h.score.toFixed(3)) })),
    });
    return { text: formatRecallSection(hits), pages: hits.map((h) => h.pageNumber), hits };
};
