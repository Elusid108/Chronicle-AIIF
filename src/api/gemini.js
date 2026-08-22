import { STYLE_PROMPTS } from '../constants.js';
import { pcmToWav } from '../utils/audio.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_TEXT_MODELS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const DEFAULT_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];

const collectImageModels = (modelPrefs, availableImageModels) => {
    const catalog = (availableImageModels || [])
        .map((m) => (typeof m === 'string' ? m : m && m.id))
        .filter(Boolean);
    const seen = new Set();
    const out = [];
    const add = (id) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    };
    add(modelPrefs && modelPrefs.imageModel);
    add(catalog.find((id) => /flash/i.test(id) && /image/i.test(id) && !/preview/i.test(id)));
    add(catalog.find((id) => /image/i.test(id)));
    for (const id of DEFAULT_IMAGE_MODELS) add(id);
    for (const id of catalog) {
        add(id);
        if (out.length >= 6) break;
    }
    if (!out.length) DEFAULT_IMAGE_MODELS.forEach(add);
    return out;
};

const isNarrativeModelId = (id) => Boolean(id) && !/image|tts|veo|imagen|live/i.test(id);

const collectTextModels = (modelPrefs, availableTextModels) => {
    const catalog = (availableTextModels || [])
        .map((m) => (typeof m === 'string' ? m : m && m.id))
        .filter(Boolean);
    const seen = new Set();
    const out = [];
    const add = (id) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    };
    add(modelPrefs && modelPrefs.textModel);
    add(catalog.find((id) => id === 'gemini-flash-latest'));
    add(catalog.find((id) => id === 'gemini-3.6-flash'));
    add(catalog.find((id) => /flash/i.test(id) && isNarrativeModelId(id)));
    for (const id of DEFAULT_TEXT_MODELS) add(id);
    for (const id of catalog) {
        if (!isNarrativeModelId(id)) continue;
        add(id);
        if (out.length >= 6) break;
    }
    if (!out.length) DEFAULT_TEXT_MODELS.forEach(add);
    return out;
};

export class GeminiHttpError extends Error {
    constructor(status, message) {
        super(message || `Status ${status}`);
        this.name = 'GeminiHttpError';
        this.status = status;
    }
}

export const isAbortError = (e) => e?.name === 'AbortError';

const authHeaders = (apiKey, json = true) => {
    const headers = { 'x-goog-api-key': apiKey };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt) => Math.min(500 * (2 ** attempt) + Math.random() * 250, 8000);

const fetchGemini = async (url, init, { retries = 3 } = {}) => {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url, init);
            if (response.status === 429) {
                lastErr = new GeminiHttpError(429, 'Status 429');
                if (i === retries) throw lastErr;
                await sleep(backoffMs(i));
                continue;
            }
            return response;
        } catch (e) {
            if (isAbortError(e)) throw e;
            if (e instanceof GeminiHttpError) throw e;
            lastErr = e;
            if (i === retries) throw e;
            await sleep(backoffMs(i));
        }
    }
    throw lastErr || new Error('Request failed');
};

const throwIfBad = (response) => {
    if (response.ok) return;
    throw new GeminiHttpError(response.status, `Status ${response.status}`);
};

// Tolerantly pull a string field's value out of a (possibly incomplete) JSON
// buffer. Used to reveal the narrative while the model is still streaming.
export const extractJsonStringField = (buffer, field) => {
    const keyIdx = buffer.indexOf(`"${field}"`);
    if (keyIdx === -1) return null;
    let i = buffer.indexOf('"', keyIdx + field.length + 2);
    if (i === -1) return null;
    i += 1;
    let out = '';
    while (i < buffer.length) {
        const ch = buffer[i];
        if (ch === '\\') {
            const next = buffer[i + 1];
            if (next === undefined) break;
            const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' };
            if (next === 'u') {
                const hex = buffer.slice(i + 2, i + 6);
                if (hex.length === 4) { out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue; }
                break;
            }
            out += map[next] != null ? map[next] : next;
            i += 2;
            continue;
        }
        if (ch === '"') return out;
        out += ch;
        i += 1;
    }
    return out;
};

const parseModelJson = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end > start) {
            return JSON.parse(text.slice(start, end + 1));
        }
        throw e;
    }
};

const buildTextPayload = (prompt, systemInstruction, schema) => {
    const generationConfig = { temperature: 0.85, maxOutputTokens: 2400, responseMimeType: 'application/json' };
    if (schema) generationConfig.responseSchema = schema;
    return {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig,
    };
};

const streamGenerate = async (apiKey, model, payload, { onPartialText, signal } = {}) => {
    const url = `${API_BASE}/models/${model}:streamGenerateContent?alt=sse`;
    const response = await fetchGemini(url, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(payload),
        signal,
    });
    throwIfBad(response);
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let fullText = '';

    const flushEvent = (chunk) => {
        const lines = chunk.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
                const obj = JSON.parse(jsonStr);
                const part = obj.candidates?.[0]?.content?.parts?.[0]?.text;
                if (part) {
                    fullText += part;
                    if (onPartialText) {
                        const narrative = extractJsonStringField(fullText, 'narrative');
                        if (narrative != null) onPartialText(narrative);
                    }
                }
            } catch { /* partial SSE frame */ }
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split(/\r?\n\r?\n/);
        sseBuffer = events.pop() || '';
        for (const ev of events) flushEvent(ev);
    }
    if (sseBuffer.trim()) flushEvent(sseBuffer);

    return fullText;
};

/**
 * Generate one structured narrative turn.
 * deps: { apiKey, modelPrefs, setStatus }
 * opts: { schema, stream, onPartialText, signal }
 */
export const callGemini = async (deps, prompt, systemInstruction = '', opts = {}) => {
    const { apiKey, modelPrefs, setStatus, availableTextModels } = deps;
    const { schema, stream, onPartialText, signal } = opts;
    const attempts = [];
    let data = null;

    const modelsToTry = collectTextModels(modelPrefs, availableTextModels);

    for (const model of modelsToTry) {
        const start = performance.now();
        try {
            setStatus && setStatus(`Narrative: ${model}...`);
            const payload = buildTextPayload(prompt, systemInstruction, schema);

            if (stream) {
                const fullText = await streamGenerate(apiKey, model, payload, { onPartialText, signal });
                data = parseModelJson(fullText);
            } else {
                const url = `${API_BASE}/models/${model}:generateContent`;
                const response = await fetchGemini(url, {
                    method: 'POST',
                    headers: authHeaders(apiKey),
                    body: JSON.stringify(payload),
                    signal,
                });
                throwIfBad(response);
                const result = await response.json();
                data = parseModelJson(result.candidates[0].content.parts[0].text);
            }
            attempts.push({ model, status: 'success', duration: (performance.now() - start) / 1000 });
            break;
        } catch (e) {
            if (isAbortError(e)) throw e;
            if (e instanceof GeminiHttpError && (e.status === 401 || e.status === 403)) {
                throw new Error('API key rejected (401/403)');
            }
            attempts.push({ model, status: 'failed', duration: (performance.now() - start) / 1000, error: e.message });
            console.warn(`Model ${model} failed. Trying next...`, e.message);
        }
    }

    if (!data) throw new Error('All text models failed');
    return { data, stats: attempts };
};

// Lightweight free-text generation (used for compaction + title + style card).
export const callGeminiText = async (deps, prompt, systemInstruction = '', opts = {}) => {
    const { apiKey, modelPrefs, availableTextModels } = deps;
    const { signal } = opts;
    const modelsToTry = collectTextModels(modelPrefs, availableTextModels);
    for (const model of modelsToTry) {
        try {
            const url = `${API_BASE}/models/${model}:generateContent`;
            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
            };
            const response = await fetchGemini(url, {
                method: 'POST',
                headers: authHeaders(apiKey),
                body: JSON.stringify(payload),
                signal,
            });
            throwIfBad(response);
            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return text.trim();
        } catch (e) {
            if (isAbortError(e)) throw e;
            if (e instanceof GeminiHttpError && (e.status === 401 || e.status === 403)) {
                throw new Error('API key rejected (401/403)');
            }
            console.warn(`Text model ${model} failed`, e.message);
        }
    }
    throw new Error('Text generation failed');
};

/**
 * Generate a scene image.
 * deps: { apiKey, modelPrefs, config, mediaStatus, setMediaStatus, setStatus }
 */
export const generateImage = async (deps, imagePrompt, opts = {}) => {
    const { apiKey, modelPrefs, config, mediaStatus, setMediaStatus, setStatus, availableImageModels } = deps;
    const { signal } = opts;
    if (mediaStatus.images === 'disabled') return { image: null, stats: [{ model: 'disabled', status: 'skipped', duration: 0 }] };

    const styleKey = config.style === 'custom' ? config.styleCustom : config.style;
    const styleText = STYLE_PROMPTS[styleKey] || styleKey;
    const fullPrompt = `Style: ${styleText}. ${imagePrompt}`;
    const attempts = [];

    const tryPollinations = async () => {
        const start = performance.now();
        const encodedPrompt = encodeURIComponent(fullPrompt);
        const pollUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true`;
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = () => reject(new Error('Pollinations fetch failed'));
            img.src = pollUrl;
        });
        attempts.push({ model: 'pollinations.ai', status: 'success', duration: (performance.now() - start) / 1000 });
        return pollUrl;
    };

    if (mediaStatus.images === 'backup') {
        try {
            return { image: await tryPollinations(), stats: attempts };
        } catch (e) {
            attempts.push({ model: 'pollinations.ai', status: 'failed', duration: 0, error: e.message });
            return { image: null, stats: attempts };
        }
    }

    const tryImageModel = async (modelId) => {
        const start = performance.now();
        const isImagen = modelId.includes('imagen');
        setStatus && setStatus(`Visuals: ${modelId}...`);
        try {
            if (isImagen) {
                const url = `${API_BASE}/models/${modelId}:predict`;
                const payload = { instances: [{ prompt: fullPrompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } };
                const response = await fetchGemini(url, {
                    method: 'POST',
                    headers: authHeaders(apiKey),
                    body: JSON.stringify(payload),
                    signal,
                }, { retries: 2 });
                if (response.status === 429 || response.status === 403) {
                    setMediaStatus && setMediaStatus((prev) => ({ ...prev, images: 'backup' }));
                    throw new GeminiHttpError(response.status, 'Quota/Permission Limit');
                }
                throwIfBad(response);
                const data = await response.json();
                if (data.predictions?.[0]?.bytesBase64Encoded) {
                    attempts.push({ model: modelId, status: 'success', duration: (performance.now() - start) / 1000 });
                    return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
                }
                throw new Error('No image data in response');
            }
            const url = `${API_BASE}/models/${modelId}:generateContent`;
            const payload = { contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { responseModalities: ['IMAGE'] } };
            const response = await fetchGemini(url, {
                method: 'POST',
                headers: authHeaders(apiKey),
                body: JSON.stringify(payload),
                signal,
            }, { retries: 2 });
            if (response.status === 429 || response.status === 403) {
                setMediaStatus && setMediaStatus((prev) => ({ ...prev, images: 'backup' }));
                throw new GeminiHttpError(response.status, 'Quota/Permission Limit');
            }
            throwIfBad(response);
            const data = await response.json();
            const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
            if (part) {
                attempts.push({ model: modelId, status: 'success', duration: (performance.now() - start) / 1000 });
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
            throw new Error('No image data in response');
        } catch (e) {
            if (isAbortError(e)) throw e;
            attempts.push({ model: modelId, status: 'failed', duration: (performance.now() - start) / 1000, error: e.message });
            console.warn(`Image model ${modelId} failed:`, e);
            return null;
        }
    };

    const imageModelsToTry = collectImageModels(modelPrefs, availableImageModels);

    for (const modelId of imageModelsToTry) {
        const result = await tryImageModel(modelId);
        if (result) return { image: result, stats: attempts };
    }

    try {
        return { image: await tryPollinations(), stats: attempts };
    } catch (e3) {
        attempts.push({ model: 'pollinations.ai', status: 'failed', duration: 0, error: e3.message });
    }
    return { image: null, stats: attempts };
};

/**
 * Generate narrated speech.
 * deps: { apiKey, modelPrefs, prefs, mediaStatus, setMediaStatus, setStatus }
 */
export const generateSpeech = async (deps, text, voiceOverride = null, opts = {}) => {
    const { apiKey, modelPrefs, prefs, mediaStatus, setMediaStatus, setStatus } = deps;
    const { signal } = opts;
    if (mediaStatus.audio === 'disabled' && !voiceOverride) return { audio: 'browser_tts', stats: [{ model: 'browser_tts', status: 'fallback', duration: 0 }] };
    if (mediaStatus.audio === 'backup') return { audio: 'browser_tts', stats: [{ model: 'browser_tts', status: 'success', duration: 0 }] };

    const attempts = [];
    const currentVoice = voiceOverride || prefs.voice;
    const modelToUse = modelPrefs.audioModel || 'gemini-2.5-flash-preview-tts';
    const start = performance.now();

    try {
        setStatus && setStatus(`Audio: ${modelToUse}...`);
        const url = `${API_BASE}/models/${modelToUse}:generateContent`;
        const payload = {
            contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoice } } } },
        };
        const response = await fetchGemini(url, {
            method: 'POST',
            headers: authHeaders(apiKey),
            body: JSON.stringify(payload),
            signal,
        }, { retries: 2 });
        if (!response.ok) {
            if (response.status === 429 || response.status === 403) {
                if (!voiceOverride) setMediaStatus && setMediaStatus((prev) => ({ ...prev, audio: 'backup' }));
            }
            throw new GeminiHttpError(response.status, `Status ${response.status}`);
        }
        const data = await response.json();
        const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioData) {
            attempts.push({ model: modelToUse, status: 'success', duration: (performance.now() - start) / 1000 });
            return { audio: pcmToWav(audioData), stats: attempts };
        }
        throw new Error('No audio data');
    } catch (e) {
        if (isAbortError(e)) throw e;
        attempts.push({ model: modelToUse, status: 'failed', duration: (performance.now() - start) / 1000, error: e.message });
        attempts.push({ model: 'browser_tts', status: 'success', duration: 0 });
        return { audio: 'browser_tts', stats: attempts };
    }
};

const MODEL_EXCLUDE_PATTERNS = ['embedding', 'aqa', 'veo', 'chirp', 'code-gecko', 'bison', 'gecko'];

export const fetchAvailableModels = async (apiKey) => {
    let allModels = [];
    let pageToken = '';
    do {
        const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
        const res = await fetchGemini(`${API_BASE}/models?pageSize=1000${tokenParam}`, {
            headers: authHeaders(apiKey, false),
        });
        throwIfBad(res);
        const data = await res.json();
        if (data.models) allModels = allModels.concat(data.models);
        pageToken = data.nextPageToken || '';
    } while (pageToken);

    const text = [];
    const image = [];
    const audio = [];

    for (const model of allModels) {
        const name = (model.name || '').replace('models/', '');
        const display = model.displayName || name;
        const methods = model.supportedGenerationMethods || [];
        if (MODEL_EXCLUDE_PATTERNS.some((p) => name.includes(p))) continue;

        const canGenerate = methods.includes('generateContent');
        const canPredict = methods.includes('predict');
        const isImagen = name.includes('imagen') && (canPredict || canGenerate);
        const isGeminiImage = name.includes('gemini') && /image/i.test(name) && canGenerate;
        const isTts = name.includes('gemini') && name.includes('tts') && canGenerate;
        const isText = name.includes('gemini') && canGenerate && !isTts && !isGeminiImage;

        if (isImagen || isGeminiImage) image.push({ id: name, displayName: display });
        if (isTts) audio.push({ id: name, displayName: display });
        if (isText) text.push({ id: name, displayName: display });
    }
    return { text, image, audio };
};

export const validateApiKey = async (key) => {
    const cleanKey = key.trim();
    try {
        const getResponse = await fetchGemini(`${API_BASE}/models?pageSize=1`, {
            headers: authHeaders(cleanKey, false),
        }, { retries: 1 });
        if (getResponse.ok) return { ok: true };
        if (getResponse.status === 401 || getResponse.status === 403) return { ok: false, detail: 'invalid_key' };
        if (getResponse.status === 429) return { ok: false, detail: 'rate_limit' };

        const postResponse = await fetchGemini(`${API_BASE}/models/gemini-2.0-flash:generateContent`, {
            method: 'POST',
            headers: authHeaders(cleanKey),
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello' }] }], generationConfig: { maxOutputTokens: 1 } }),
        }, { retries: 1 });
        if (postResponse.ok) return { ok: true };
        if (postResponse.status === 401 || postResponse.status === 403) return { ok: false, detail: 'invalid_key' };
        if (postResponse.status === 404) return { ok: false, detail: 'model' };
        if (postResponse.status === 429) return { ok: false, detail: 'rate_limit' };
        return { ok: false, detail: 'unknown', status: postResponse.status };
    } catch (e) {
        if (e instanceof GeminiHttpError) {
            if (e.status === 401 || e.status === 403) return { ok: false, detail: 'invalid_key' };
            if (e.status === 429) return { ok: false, detail: 'rate_limit' };
            return { ok: false, detail: 'unknown', status: e.status };
        }
        console.error('Validation error:', e);
        return { ok: false, detail: 'network' };
    }
};
