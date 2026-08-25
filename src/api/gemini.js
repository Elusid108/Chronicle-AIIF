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

const throwIfBad = async (response) => {
    if (response.ok) return;
    let detail = `Status ${response.status}`;
    try {
        const body = await response.json();
        const msg = body?.error?.message || body?.error?.status;
        if (msg) detail = `${detail}: ${String(msg).slice(0, 280)}`;
    } catch { /* ignore */ }
    throw new GeminiHttpError(response.status, detail);
};

const SCHEMA_STRIP_KEYS = new Set(['maxLength', 'minLength', 'minimum', 'maximum', 'pattern']);

export const sanitizeApiSchema = (node) => {
    if (Array.isArray(node)) return node.map(sanitizeApiSchema);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
        if (SCHEMA_STRIP_KEYS.has(key)) continue;
        out[key] = sanitizeApiSchema(value);
    }
    return out;
};

export const extractCandidateText = (payload) => {
    if (!payload) return '';
    const chunks = [];
    const takePart = (part) => {
        if (!part || typeof part !== 'object') return;
        if (part.thought === true) return;
        if (typeof part.text === 'string' && part.text) chunks.push(part.text);
    };
    const takeCandidate = (candidate) => {
        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) parts.forEach(takePart);
    };
    if (Array.isArray(payload.candidates)) payload.candidates.forEach(takeCandidate);
    else takeCandidate(payload);
    return chunks.join('');
};

// Tolerantly pull a string field's value out of a (possibly incomplete) JSON
// buffer. Used to reveal the narrative while the model is still streaming.
export const extractJsonStringField = (buffer, field, opts = {}) => {
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
    return opts.completeOnly ? null : out;
};

export const hasRunawayRepetition = (text) => {
    const s = String(text || '');
    if (s.length < 900) return false;
    const cleanHits = s.match(/\bLet's (?:clean|keep)\b/gi);
    if (cleanHits && cleanHits.length >= 3) return true;
    const tail = s.slice(-600);
    if (tail.length < 80) return false;
    const needle = tail.slice(0, 40);
    if (needle.trim().length < 20) return false;
    return s.split(needle).length - 1 >= 6;
};

const parseModelJson = (text) => {
    const raw = String(text || '');
    try {
        return JSON.parse(raw);
    } catch { /* try salvage */ }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* repair */ }
    }
    if (start === -1) throw new SyntaxError('Invalid model JSON');
    const repaired = repairTruncatedJson(raw.slice(start));
    return JSON.parse(repaired);
};

const repairTruncatedJson = (s) => {
    let inStr = false;
    let esc = false;
    const stack = [];
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') stack.push('}');
        else if (ch === '[') stack.push(']');
        else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
    }
    let out = s;
    if (inStr) out += '"';
    while (stack.length) out += stack.pop();
    return out;
};

const buildTextPayload = (prompt, systemInstruction, schema) => {
    const generationConfig = { temperature: 0.85, maxOutputTokens: 8192, responseMimeType: 'application/json' };
    if (schema) generationConfig.responseSchema = sanitizeApiSchema(schema);
    return {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig,
    };
};

const streamGenerate = async (apiKey, model, payload, { onPartialText, onPartialBuffer, signal } = {}) => {
    const url = `${API_BASE}/models/${model}:streamGenerateContent?alt=sse`;
    const response = await fetchGemini(url, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(payload),
        signal,
    });
    await throwIfBad(response);
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let fullText = '';
    let runaway = false;

    const flushEvent = (chunk) => {
        const lines = chunk.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
                const obj = JSON.parse(jsonStr);
                const part = extractCandidateText(obj);
                if (part) {
                    fullText += part;
                    if (onPartialText) {
                        const narrative = extractJsonStringField(fullText, 'narrative');
                        if (narrative != null) onPartialText(narrative);
                    }
                    if (onPartialBuffer) onPartialBuffer(fullText);
                    if (hasRunawayRepetition(fullText)) runaway = true;
                }
            } catch { /* partial SSE frame */ }
        }
    };

    while (true) {
        if (runaway) {
            try { await reader.cancel(); } catch { /* ignore */ }
            break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split(/\r?\n\r?\n/);
        sseBuffer = events.pop() || '';
        for (const ev of events) flushEvent(ev);
    }
    if (!runaway && sseBuffer.trim()) flushEvent(sseBuffer);
    return fullText;
};

const salvageTurnData = (fullText, parsed) => {
    const narrative = (parsed && parsed.narrative)
        || extractJsonStringField(fullText, 'narrative', { completeOnly: true })
        || extractJsonStringField(fullText, 'narrative');
    if (!narrative) return null;
    const imagePrompt = (parsed && parsed.image_prompt)
        || extractJsonStringField(fullText, 'image_prompt', { completeOnly: true })
        || '';
    return {
        narrative,
        image_prompt: imagePrompt,
        choices: Array.isArray(parsed?.choices) ? parsed.choices : [],
        summary_update: parsed?.summary_update || extractJsonStringField(fullText, 'summary_update', { completeOnly: true }) || '',
        scene: parsed?.scene && typeof parsed.scene === 'object' ? parsed.scene : {},
        codex_updates: Array.isArray(parsed?.codex_updates) ? parsed.codex_updates : [],
        state_updates: Array.isArray(parsed?.state_updates) ? parsed.state_updates : [],
    };
};

/**
 * Generate one structured narrative turn.
 * deps: { apiKey, modelPrefs, setStatus }
 * opts: { schema, stream, onPartialText, onPartialBuffer, signal }
 */
const generateContentOnce = async (apiKey, model, payload, signal) => {
    const url = `${API_BASE}/models/${model}:generateContent`;
    const response = await fetchGemini(url, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(payload),
        signal,
    });
    await throwIfBad(response);
    const result = await response.json();
    const text = extractCandidateText(result);
    if (!text) throw new Error('Empty model response');
    return text;
};

export const callGemini = async (deps, prompt, systemInstruction = '', opts = {}) => {
    const { apiKey, modelPrefs, setStatus, availableTextModels } = deps;
    const { schema, stream, onPartialText, onPartialBuffer, signal } = opts;
    const requiresNarrative = !schema || Boolean(schema.properties?.narrative);
    const attempts = [];
    let data = null;
    let activeSchema = schema || null;
    let schemaDropped = false;

    const modelsToTry = collectTextModels(modelPrefs, availableTextModels);

    for (let mi = 0; mi < modelsToTry.length; mi++) {
        const model = modelsToTry[mi];
        const start = performance.now();
        let fullText = '';
        try {
            setStatus && setStatus(requiresNarrative ? `Narrative: ${model}...` : `Lore: ${model}...`);
            const payload = buildTextPayload(prompt, systemInstruction, activeSchema);

            if (stream) {
                fullText = await streamGenerate(apiKey, model, payload, { onPartialText, onPartialBuffer, signal });
                if (!String(fullText || '').trim()) {
                    fullText = await generateContentOnce(apiKey, model, payload, signal);
                }
                let parsed = null;
                try { parsed = parseModelJson(fullText); } catch { parsed = null; }
                data = requiresNarrative
                    ? ((parsed && parsed.narrative) ? parsed : salvageTurnData(fullText, parsed))
                    : parsed;
            } else {
                fullText = await generateContentOnce(apiKey, model, payload, signal);
                data = parseModelJson(fullText);
            }
            if (requiresNarrative ? !data?.narrative : !data) throw new Error('Invalid model JSON');
            attempts.push({ model, status: 'success', duration: (performance.now() - start) / 1000 });
            break;
        } catch (e) {
            if (isAbortError(e)) throw e;
            if (e instanceof GeminiHttpError && (e.status === 401 || e.status === 403)) {
                throw new Error('API key rejected (401/403)');
            }
            if (requiresNarrative) {
                const salvaged = salvageTurnData(fullText, null);
                if (salvaged?.narrative) {
                    data = salvaged;
                    attempts.push({ model, status: 'success', duration: (performance.now() - start) / 1000 });
                    break;
                }
            }
            if (e instanceof GeminiHttpError && e.status === 400 && activeSchema && !schemaDropped) {
                schemaDropped = true;
                activeSchema = null;
                mi -= 1;
                console.warn(`Model ${model} rejected the schema. Retrying without responseSchema...`, e.message);
                continue;
            }
            data = null;
            attempts.push({ model, status: 'failed', duration: (performance.now() - start) / 1000, error: e.message });
            const canFailover = !(e instanceof GeminiHttpError && (e.status === 401 || e.status === 403));
            if (!canFailover) throw e;
            if (requiresNarrative && onPartialText) onPartialText('');
            console.warn(`Model ${model} failed. Trying next...`, e.message);
        }
    }

    if (!data) {
        const last = [...attempts].reverse().find((row) => row.error);
        throw new Error(last?.error ? `All text models failed (${last.error})` : 'All text models failed');
    }
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
            await throwIfBad(response);
            const result = await response.json();
            const text = extractCandidateText(result);
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
    const { signal, references } = opts;
    if (mediaStatus.images === 'disabled') return { image: null, stats: [{ model: 'disabled', status: 'skipped', duration: 0 }] };

    const styleKey = config.style === 'custom' ? config.styleCustom : config.style;
    const styleText = STYLE_PROMPTS[styleKey] || styleKey;
    const refNotes = (references || [])
        .map((ref, i) => `${i + 1}. ${ref.label || 'Reference image'}`)
        .join(' ');
    const textOnlyPrompt = `Style: ${styleText}. ${imagePrompt}`;
    const fullPrompt = refNotes
        ? `Style: ${styleText}. Use the attached reference images to keep the same faces, clothing, objects, and places. ${refNotes} ${imagePrompt}`
        : textOnlyPrompt;
    const attempts = [];
    const refParts = (references || []).flatMap((ref) => ([
        { text: ref.label || 'Reference image' },
        { inlineData: { mimeType: ref.mime || 'image/webp', data: ref.data } },
    ]));

    const tryPollinations = async () => {
        const start = performance.now();
        const encodedPrompt = encodeURIComponent(textOnlyPrompt);
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
                const payload = { instances: [{ prompt: textOnlyPrompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } };
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
                await throwIfBad(response);
                const data = await response.json();
                if (data.predictions?.[0]?.bytesBase64Encoded) {
                    attempts.push({ model: modelId, status: 'success', duration: (performance.now() - start) / 1000 });
                    return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
                }
                throw new Error('No image data in response');
            }
            const url = `${API_BASE}/models/${modelId}:generateContent`;
            const payload = {
                contents: [{ parts: [...refParts, { text: fullPrompt }] }],
                generationConfig: { responseModalities: ['IMAGE'] },
            };
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
            await throwIfBad(response);
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

    let imageModelsToTry = collectImageModels(modelPrefs, availableImageModels);
    if (refParts.length) {
        const withRefs = imageModelsToTry.filter((id) => !id.includes('imagen'));
        const imagenOnly = imageModelsToTry.filter((id) => id.includes('imagen'));
        imageModelsToTry = withRefs.length ? [...withRefs, ...imagenOnly] : imageModelsToTry;
    }

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
        await throwIfBad(res);
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
