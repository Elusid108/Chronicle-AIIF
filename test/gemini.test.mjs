import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiBlockedError, callGemini, embedText, fetchGemini, generateImage, sleep } from '../src/api/gemini.js';

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body), body: null,
});

const withFetch = async (impl, fn) => {
    const prev = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return impl(String(url), init, calls.length); };
    try { return await fn(calls); } finally { globalThis.fetch = prev; }
};

test('fetchGemini returns the final 429 instead of throwing', async () => {
    await withFetch(() => jsonResponse(429, {}), async (calls) => {
        const res = await fetchGemini('https://x/y', {}, { retries: 1 });
        assert.equal(res.status, 429);
        assert.equal(calls.length, 2);
    });
});

test('sleep rejects promptly on abort', async () => {
    const ac = new AbortController();
    const p = sleep(5000, ac.signal);
    ac.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('generateImage stops walking models on 429, flips to backup once, then uses the fallback', async () => {
    const statusChanges = [];
    const notes = [];
    globalThis.Image = class { set src(v) { setTimeout(() => this.onerror && this.onerror(new Error('no network')), 0); } };
    await withFetch(() => jsonResponse(429, {}), async (calls) => {
        const result = await generateImage({
            apiKey: 'k', modelPrefs: {}, config: { style: 'comic' }, mediaStatus: { images: 'active' },
            setMediaStatus: (fn) => statusChanges.push(fn({ images: 'active', audio: 'active' })),
            notify: (type, msg) => notes.push(msg), availableImageModels: ['m1', 'm2', 'm3'],
        }, 'a scene');
        assert.equal(calls.length, 2, 'one model, retries:1 => 2 requests, then stop');
        assert.deepEqual(statusChanges, [{ images: 'backup', audio: 'active' }]);
        assert.equal(notes.length, 1);
        assert.equal(result.image, null);
        assert.ok(result.stats.some((s) => s.model === 'pollinations.ai'));
    });
    delete globalThis.Image;
});

test('embedText sends the batch shape and returns L2-normalized vectors', async () => {
    await withFetch((url, init) => {
        assert.match(url, /gemini-embedding-001:batchEmbedContents$/);
        const body = JSON.parse(init.body);
        assert.equal(body.requests[0].model, 'models/gemini-embedding-001');
        assert.equal(body.requests[0].taskType, 'RETRIEVAL_QUERY');
        assert.equal(body.requests[0].outputDimensionality, 768);
        assert.equal(body.requests[0].content.parts[0].text, 'hello');
        assert.equal(init.headers['x-goog-api-key'], 'k');
        return jsonResponse(200, { embeddings: [{ values: [3, 4] }] });
    }, async () => {
        const [v] = await embedText({ apiKey: 'k', modelPrefs: {} }, ['hello'], { taskType: 'RETRIEVAL_QUERY' });
        assert.ok(v instanceof Float32Array);
        assert.ok(Math.abs(v[0] - 0.6) < 1e-6 && Math.abs(v[1] - 0.8) < 1e-6);
    });
});

test('a safety-blocked prompt throws GeminiBlockedError without walking other models', async () => {
    await withFetch(() => jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }), async (calls) => {
        await assert.rejects(
            callGemini({ apiKey: 'k', modelPrefs: {}, availableTextModels: ['m1', 'm2'] }, 'p', 's', { schema: { type: 'object', properties: { narrative: { type: 'string' } } }, stream: false }),
            (e) => e instanceof GeminiBlockedError,
        );
        assert.equal(calls.length, 1);
    });
});

test('a schema-related 400 downgrades the schema for that model and retries it', async () => {
    const bodies = [];
    await withFetch((url, init) => {
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 1) return jsonResponse(400, { error: { message: 'Invalid JSON payload received. Unknown name "propertyOrdering"' } });
        return jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ narrative: 'ok', choices: [] }) }] }, finishReason: 'STOP' }] });
    }, async (calls) => {
        const { data } = await callGemini({ apiKey: 'k', modelPrefs: {}, availableTextModels: ['mx'] }, 'p', 's', { schema: { type: 'object', properties: { narrative: { type: 'string' } }, propertyOrdering: ['narrative'] }, stream: false });
        assert.equal(data.narrative, 'ok');
        assert.equal(calls.length, 2);
        assert.ok(bodies[0].generationConfig.responseSchema.propertyOrdering);
        assert.equal(bodies[1].generationConfig.responseSchema.propertyOrdering, undefined);
    });
});
