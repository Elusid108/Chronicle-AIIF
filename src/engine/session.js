import { EMPTY_SCENE, EMPTY_SUMMARY } from '../constants.js';
import { callGemini, callGeminiText, extractJsonStringField, generateImage, generateSpeech, isAbortError } from '../api/gemini.js';
import { ACTIVE_SAVE_ID, getCodexImage, pruneTurnImages, putCodexImage, putTurnImage } from '../utils/idb.js';
import { blobToInlineData, snapshotImage } from '../utils/images.js';
import { normalizeEntry, normalizeSummary, summaryToText } from '../utils/storage.js';
import {
    appendBeat, applyCompaction, diffNewCodexEntries, mergeCodex, mergeScene, pickCodexImageRefs,
    scrubImagePrompt, splitBeatsForCompaction, visualForEntry,
} from './memory.js';
import { buildActionPrompt, buildSystemPrompt, buildTurnSchema, endingInstruction, LORE_BACKFILL_SCHEMA, styleText } from './prompt.js';

export { EMPTY_SCENE, EMPTY_SUMMARY };

export const abortActiveTurn = (abortRef) => {
    if (abortRef?.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
        abortRef.current = null;
    }
};

export const startTurnSignal = (abortRef) => {
    abortActiveTurn(abortRef);
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
};

export const abortAssetSignal = (mapRef, jobKey) => {
    if (!mapRef?.current || jobKey == null) return;
    const controller = mapRef.current.get(jobKey);
    if (!controller) return;
    try { controller.abort(); } catch { /* ignore */ }
    mapRef.current.delete(jobKey);
};

export const abortAllAssetSignals = (mapRef) => {
    if (!mapRef?.current) return;
    for (const controller of mapRef.current.values()) {
        try { controller.abort(); } catch { /* ignore */ }
    }
    mapRef.current.clear();
};

export const completeAssetJob = (mapRef, jobKey) => {
    if (!mapRef?.current || jobKey == null) return;
    mapRef.current.delete(jobKey);
};

export const hasAssetJobs = (mapRef, prefix) => {
    if (!mapRef?.current) return false;
    return [...mapRef.current.keys()].some((key) => String(key).startsWith(prefix));
};

export const startAssetSignal = (mapRef, jobKey) => {
    abortAssetSignal(mapRef, jobKey);
    const controller = new AbortController();
    if (!mapRef) return controller.signal;
    if (!mapRef.current) mapRef.current = new Map();
    mapRef.current.set(jobKey, controller);
    return controller.signal;
};

export const lastAiIndex = (hist) => {
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i]?.type === 'ai') return i;
    return -1;
};

export const countAiTurns = (hist) => (Array.isArray(hist) ? hist.filter((t) => t?.type === 'ai').length : 0);

export const applyStateUpdates = (stats, updates) => {
    const next = { ...(stats || {}) };
    if (!Array.isArray(updates)) return next;
    updates.forEach((u) => { if (u && u.key) next[u.key] = u.value; });
    return next;
};

export const rebuildBase = (remaining, priorSummary = EMPTY_SUMMARY) => {
    let cx = { characters: {}, places: {}, items: {} };
    const beats = [];
    const st = {};
    let scene = { ...EMPTY_SCENE };
    (remaining || []).forEach((t, idx) => {
        if (t.type !== 'ai') return;
        cx = mergeCodex(cx, t.codex_updates, idx);
        if (t.summary_update) beats.push(String(t.summary_update).trim());
        if (Array.isArray(t.state_updates)) Object.assign(st, applyStateUpdates(st, t.state_updates));
        if (t.scene) scene = mergeScene(scene, t.scene);
    });
    const aiCount = countAiTurns(remaining);
    const prior = normalizeSummary(priorSummary);
    const keepLong = aiCount >= (prior.foldedThrough || 0) && (prior.foldedThrough || 0) > 0;
    const foldedThrough = keepLong ? prior.foldedThrough : 0;
    return {
        history: remaining,
        codex: cx,
        summary: {
            beats: keepLong ? beats.slice(foldedThrough) : beats,
            longTerm: keepLong ? prior.longTerm : '',
            foldedThrough,
        },
        stats: st,
        scene,
        styleCard: aiCount === 0 ? '' : undefined,
    };
};

export const foldTurn = (base, turnData, prefs, userAction, textStats, mode = 'choice') => {
    const baseHistory = base.history || [];
    const newTurnIndex = baseHistory.length;
    const newCodex = mergeCodex(base.codex, turnData.codex_updates, newTurnIndex);
    const newSummary = appendBeat(base.summary, turnData.summary_update);
    const newScene = mergeScene(base.scene, turnData.scene);
    let newStats = base.stats || {};
    if (prefs.statsEnabled && Array.isArray(turnData.state_updates) && turnData.state_updates.length) {
        newStats = applyStateUpdates(newStats, turnData.state_updates);
    }
    const newTurn = {
        narrative: turnData.narrative,
        choices: mode === 'text'
            ? []
            : (Array.isArray(turnData.choices) ? turnData.choices.filter(Boolean).slice(0, 4) : []),
        summary_update: turnData.summary_update,
        image_prompt: turnData.image_prompt,
        scene: newScene,
        codex_updates: turnData.codex_updates || [],
        state_updates: turnData.state_updates || [],
        image: null,
        audio: null,
        type: 'ai',
        userActionPreceding: userAction,
        stats: { text: textStats, image: [], audio: [] },
    };
    return { newCodex, newSummary, newScene, newStats, newTurn, newTurnIndex };
};

export const maybeCompact = async (summaryState, { apiKey, modelPrefs, signal, setSummary }) => {
    const split = splitBeatsForCompaction(summaryState);
    if (!split) return;
    try {
        const prompt = `Compress this interactive-fiction log into tight prose that preserves key plot points, characters, locations, and unresolved threads. Under 200 words.\n\nEXISTING SUMMARY:\n${split.longTerm || '(none)'}\n\nOLDER EVENTS TO FOLD IN:\n${split.toFold.join('\n')}`;
        const folded = await callGeminiText({ apiKey, modelPrefs }, prompt, 'You compress story logs. Output only the summary prose, no preamble.', { signal });
        if (!folded) return;
        setSummary((prev) => applyCompaction(prev, split, folded) || prev);
    } catch (e) {
        if (isAbortError(e)) return;
    }
};

export const extractStyleCard = async ({ apiKey, modelPrefs, narrative, signal }) => {
    const prompt = `In 40-80 words, describe this narrator's voice: grammatical person, tense, diction, sentence rhythm, recurring motifs. No plot spoilers. Output only the style notes.\n\nNARRATIVE:\n${narrative}`;
    return callGeminiText({ apiKey, modelPrefs }, prompt, 'You extract prose style. Output only the notes.', { signal });
};

export const runConsistencyCheck = async ({ apiKey, modelPrefs, scene, codex, narrative, signal }) => {
    const pinned = { characters: {}, places: {}, items: {} };
    for (const cat of ['characters', 'places', 'items']) {
        for (const [key, val] of Object.entries(codex?.[cat] || {})) {
            if (val && (val.pinned || val.source === 'player')) pinned[cat][key] = val;
        }
    }
    const prompt = `Given this scene state and pinned/player codex, list contradictions in the draft narrative. Reply with NONE if consistent, otherwise a short bullet list.\n\nSCENE:\n${JSON.stringify(scene || EMPTY_SCENE)}\n\nCODEX:\n${JSON.stringify(pinned)}\n\nNARRATIVE:\n${narrative}`;
    return callGeminiText({ apiKey, modelPrefs }, prompt, 'You are a continuity editor. Be terse.', { signal });
};

const patchTurnAt = (setHistory, index, patcher) => {
    setHistory((prev) => {
        const updated = [...prev];
        if (updated[index] && updated[index].type === 'ai') updated[index] = patcher(updated[index]);
        return updated;
    });
};

export const persistTurnImageBlob = async (slotId, turnIndex, blob, keepLastN) => {
    if (!blob || !keepLastN) return;
    await putTurnImage(ACTIVE_SAVE_ID, turnIndex, blob);
    await pruneTurnImages(ACTIVE_SAVE_ID, keepLastN);
    if (slotId && slotId !== ACTIVE_SAVE_ID) {
        await putTurnImage(slotId, turnIndex, blob);
        await pruneTurnImages(slotId, keepLastN);
    }
};

const persistCodexBlob = async (slotId, category, key, blob) => {
    if (!blob) return;
    await putCodexImage(ACTIVE_SAVE_ID, category, key, blob);
    if (slotId && slotId !== ACTIVE_SAVE_ID) await putCodexImage(slotId, category, key, blob);
};

export const resolveImageReferences = async (codex, scene, narrative, slotId) => {
    const picks = pickCodexImageRefs(codex, scene, narrative);
    const out = [];
    for (const pick of picks) {
        try {
            const blob = (slotId && await getCodexImage(slotId, pick.category, pick.key))
                || await getCodexImage(ACTIVE_SAVE_ID, pick.category, pick.key);
            if (!blob) continue;
            const inline = await blobToInlineData(blob);
            if (inline) out.push({ label: pick.label, mime: inline.mime, data: inline.data });
        } catch { /* ignore */ }
    }
    return out;
};

const portraitPromptFor = (category, key, data, config) => {
    const visual = visualForEntry(key, data);
    const style = styleText(config || {});
    if (category === 'characters') {
        return `${style}. Character reference portrait, bust, face clearly visible, plain backdrop. Subject: ${visual}.`;
    }
    if (category === 'places') {
        return `${style}. Location reference establishing shot. Place: ${visual}.`;
    }
    return `${style}. Object reference still, centered, plain backdrop. Item: ${visual}.`;
};

export const generateEntryPortrait = async (io, { category, key, data, signal }) => {
    const { imageDeps, getSnapshot, setCodex, setSelectedCodexEntry } = io;
    const snap = getSnapshot();
    if (snap.mediaStatus?.images === 'disabled') return;
    const liveData = data || snap.codex?.[category]?.[key];
    if (!liveData) return;
    const result = await generateImage(imageDeps(), portraitPromptFor(category, key, liveData, snap.config), { signal });
    if (signal?.aborted || !result.image) return;
    const snapshotted = await snapshotImage(result.image);
    if (signal?.aborted || !snapshotted.url) return;
    const slotId = snap.currentSlotId || ACTIVE_SAVE_ID;
    if (snapshotted.blob) {
        try { await persistCodexBlob(slotId, category, key, snapshotted.blob); } catch { /* ignore */ }
    }
    setCodex((prev) => {
        if (!prev[category]?.[key]) return prev;
        const current = normalizeEntry(prev[category][key]);
        const nextEntry = { ...current, hasPortrait: true, portraitUrl: snapshotted.url };
        const next = { ...prev, [category]: { ...prev[category], [key]: nextEntry } };
        if (setSelectedCodexEntry) {
            setSelectedCodexEntry((sel) => (
                sel && sel.category === category && sel.title === key ? { ...sel, data: nextEntry } : sel
            ));
        }
        return next;
    });
};

export const generateMissingPortraits = async (io, entries, signal, codexHint) => {
    for (const row of entries || []) {
        if (signal?.aborted) return;
        const live = io.getSnapshot();
        const data = codexHint?.[row.cat]?.[row.key] || live.codex?.[row.cat]?.[row.key];
        if (!data || data.portraitUrl) continue;
        const slotId = live.currentSlotId || ACTIVE_SAVE_ID;
        try {
            const blob = await getCodexImage(slotId, row.cat, row.key) || await getCodexImage(ACTIVE_SAVE_ID, row.cat, row.key);
            if (blob) {
                const url = URL.createObjectURL(blob);
                io.setCodex((prev) => {
                    if (!prev[row.cat]?.[row.key]) return prev;
                    const nextEntry = { ...normalizeEntry(prev[row.cat][row.key]), hasPortrait: true, portraitUrl: url };
                    if (io.setSelectedCodexEntry) {
                        io.setSelectedCodexEntry((sel) => (
                            sel && sel.category === row.cat && sel.title === row.key ? { ...sel, data: nextEntry } : sel
                        ));
                    }
                    return { ...prev, [row.cat]: { ...prev[row.cat], [row.key]: nextEntry } };
                });
                continue;
            }
        } catch { /* generate */ }
        try {
            await generateEntryPortrait(io, { category: row.cat, key: row.key, data, signal });
        } catch (e) {
            if (isAbortError(e)) return;
        }
    }
};

const prepareSceneImageRefs = async (io, codex, scene, narrative, slotId, signal) => {
    const wanted = pickCodexImageRefs(codex, scene, narrative, 10, { allowMissing: true });
    if (wanted.length && io) {
        await generateMissingPortraits(io, wanted.map((p) => ({ cat: p.category, key: p.key })), signal, codex);
    }
    const liveCodex = io?.getSnapshot?.()?.codex || codex;
    return resolveImageReferences(liveCodex, scene, narrative, slotId);
};

const backfillCodexFromNarrative = async (deps, { narrative, codex, signal }) => {
    const keys = [];
    for (const cat of ['characters', 'places', 'items']) {
        for (const key of Object.keys(codex?.[cat] || {})) keys.push(`${cat}: ${key}`);
    }
    const prompt = `Extract lore that appears in this narrative but is missing from the known list. Include significant unnamed objects the player found, picked up, or clearly saw (a plasma cutter, a locked journal, a keycard). Return codex_updates only for NEW or newly detailed entities. Do not repeat known keys.\n\nKNOWN:\n${keys.join('\n') || '(none)'}\n\nNARRATIVE:\n${narrative}`;
    const { data } = await callGemini({ ...deps, setStatus: undefined }, prompt, 'You extract story lore as JSON. Be thorough about items and people that appear this turn.', {
        schema: LORE_BACKFILL_SCHEMA,
        stream: false,
        signal,
    });
    return Array.isArray(data?.codex_updates) ? data.codex_updates : [];
};

export const attachSceneImage = async ({
    io, imageDeps, prompt, codex, scene, narrative, slotId, keepLastN, turnIndex, setHistory, signal, showToast, setGeneratingAssets, assetAbortMap,
}) => {
    const finish = () => {
        completeAssetJob(assetAbortMap, `scene:${turnIndex}`);
        if (!hasAssetJobs(assetAbortMap, 'scene:')) {
            setGeneratingAssets && setGeneratingAssets((prev) => ({ ...prev, image: false }));
        }
    };
    try {
        const deps = typeof imageDeps === 'function' ? imageDeps() : imageDeps;
        const scrubbed = scrubImagePrompt(prompt, codex);
        const references = await prepareSceneImageRefs(io, codex, scene, narrative, slotId, signal);
        const imageResult = await generateImage(deps, scrubbed, { signal, references });
        if (signal?.aborted) {
            return;
        }
        let url = imageResult.image;
        let blob = null;
        if (url) {
            const snapshotted = await snapshotImage(url);
            if (signal?.aborted) {
                return;
            }
            url = snapshotted.url || url;
            blob = snapshotted.blob;
        }
        patchTurnAt(setHistory, turnIndex, (turn) => ({
            ...turn,
            image: url,
            stats: { ...turn.stats, image: imageResult.stats },
        }));
        if (blob && keepLastN > 0) {
            try { await persistTurnImageBlob(slotId, turnIndex, blob, keepLastN); } catch { /* ignore quota */ }
        }
        if (!url && showToast) showToast('error', 'Could not generate the scene image.');
    } finally {
        finish();
    }
};

/**
 * Run one narrative turn. `io` supplies React setters and live getters.
 */
export const processTurn = async (io, promptType, inputVal, base) => {
    const {
        abortRef, assetAbortMap, getSnapshot, stopAudio, showToast,
        setView, setLoading, setIsStreaming, setStreamingText, setStatus, setToast,
        setCodex, setSummary, setStats, setScene, setStyleCard, setHistory, setCurrentSlideIndex,
        setGeneratingAssets, setTurnsRemaining, setIsFinished, setIsEnding, setExportDetails, setUserInput,
        textDeps, imageDeps, speechDeps,
    } = io;

    const snap = getSnapshot();
    const baseHistory = base?.history ?? snap.history;
    const baseCodex = base?.codex ?? snap.codex;
    const baseSummary = base?.summary ?? snap.summary;
    const baseStats = base?.stats ?? snap.stats;
    const baseScene = base?.scene ?? snap.scene;
    const { config, initialContext, prefs, isEnding, turnsRemaining, apiKey, modelPrefs, styleCard } = snap;

    const signal = startTurnSignal(abortRef);
    const myController = abortRef.current;
    stopAudio();
    setToast && setToast(null);

    const streaming = prefs.streaming !== false;
    setLoading(!streaming);
    if (streaming) { setIsStreaming(true); setStreamingText(''); }
    setStatus('Initializing core systems...');
    if (promptType === 'initial') setView('game');

    let systemPrompt = buildSystemPrompt({
        config,
        initialContext,
        summary: baseSummary,
        codex: baseCodex,
        history: baseHistory,
        statsEnabled: prefs.statsEnabled,
        stats: baseStats,
        scene: baseScene,
        styleCard,
        pacing: prefs.pacing,
    });
    if (isEnding && promptType !== 'initial') systemPrompt += endingInstruction(turnsRemaining, config.mode);

    const modelPrompt = promptType === 'initial' ? inputVal : buildActionPrompt(inputVal);
    const userAction = promptType === 'initial' ? null : inputVal;
    const turnIndex = baseHistory.length;
    const wantImage = snap.mediaStatus?.images !== 'disabled';
    let imageStarted = false;
    let historyReady = false;
    let pendingImage = null;

    const applyPendingImage = () => {
        if (!pendingImage || !historyReady) return;
        const result = pendingImage;
        pendingImage = null;
        patchTurnAt(setHistory, turnIndex, (turn) => ({
            ...turn,
            image: result.url,
            stats: { ...turn.stats, image: result.stats },
        }));
        if (result.blob && result.keepLastN > 0) {
            persistTurnImageBlob(result.slotId, turnIndex, result.blob, result.keepLastN).catch(() => {});
        }
        if (!result.url) showToast('error', 'Could not generate the scene image.');
    };

    const startSceneImage = (prompt, codexForRefs, sceneForRefs, narrative) => {
        if (imageStarted || !wantImage || !prompt) return;
        imageStarted = true;
        const live = getSnapshot();
        const slotId = live.currentSlotId || ACTIVE_SAVE_ID;
        const keepLastN = live.prefs?.keepLastNImages || 0;
        const imageSignal = startAssetSignal(assetAbortMap, `scene:${turnIndex}`);
        setGeneratingAssets((prev) => ({ ...prev, image: true }));
        const finishImage = () => {
            completeAssetJob(assetAbortMap, `scene:${turnIndex}`);
            if (!hasAssetJobs(assetAbortMap, 'scene:')) {
                setGeneratingAssets((prev) => ({ ...prev, image: false }));
            }
        };
        (async () => {
            try {
                const scrubbed = scrubImagePrompt(prompt, codexForRefs);
                const references = await prepareSceneImageRefs(io, codexForRefs, sceneForRefs, narrative, slotId, imageSignal);
                if (imageSignal.aborted) return;
                const imageResult = await generateImage(imageDeps(), scrubbed, { signal: imageSignal, references });
                if (imageSignal.aborted) return;
                let url = imageResult.image;
                let blob = null;
                if (url) {
                    const snapshotted = await snapshotImage(url);
                    if (imageSignal.aborted) return;
                    url = snapshotted.url || url;
                    blob = snapshotted.blob;
                }
                pendingImage = { url, blob, stats: imageResult.stats, slotId, keepLastN };
                applyPendingImage();
            } catch (e) {
                if (isAbortError(e)) return;
                showToast('error', `Image failed: ${e.message || 'unknown error'}`);
            } finally {
                finishImage();
            }
        })();
    };

    try {
        const { data: turnData, stats: textStats } = await callGemini(textDeps(), modelPrompt, systemPrompt, {
            schema: buildTurnSchema(config.mode),
            stream: streaming,
            onPartialText: streaming ? (t) => setStreamingText(t) : undefined,
            onPartialBuffer: streaming ? (buf) => {
                const prompt = extractJsonStringField(buf, 'image_prompt', { completeOnly: true });
                if (prompt) startSceneImage(prompt, baseCodex, baseScene, extractJsonStringField(buf, 'narrative') || '');
            } : undefined,
            signal,
        });
        if (signal.aborted) return;

        const folded = foldTurn(
            { history: baseHistory, codex: baseCodex, summary: baseSummary, stats: baseStats, scene: baseScene },
            turnData,
            prefs,
            userAction,
            textStats,
            config.mode,
        );

        setCodex(folded.newCodex);
        setSummary(folded.newSummary);
        setStats(folded.newStats);
        setScene(folded.newScene);
        setHistory([...baseHistory, folded.newTurn]);
        if (promptType === 'initial') {
            setCurrentSlideIndex(0);
            setView('game');
            if (setIsEnding) setIsEnding(false);
            setTurnsRemaining(null);
            setIsFinished(false);
        } else {
            setCurrentSlideIndex(folded.newTurnIndex);
        }

        setIsStreaming(false); setStreamingText(''); setLoading(false);
        historyReady = true;
        applyPendingImage();

        const live = getSnapshot();
        const fetchImage = live.mediaStatus?.images !== 'disabled';
        const fetchAudio = live.mediaStatus?.audio !== 'disabled' && !!live.prefs?.autoPlay;
        if (!imageStarted && fetchImage) {
            startSceneImage(turnData.image_prompt, baseCodex, folded.newScene, folded.newTurn.narrative);
        }
        if (!fetchImage) setGeneratingAssets((prev) => ({ ...prev, image: false }));
        setGeneratingAssets((prev) => ({ ...prev, audio: fetchAudio }));
        setStatus('Generating assets...');

        if (fetchAudio && turnData.narrative) {
            generateSpeech(speechDeps(), turnData.narrative, null, { signal }).then((audioResult) => {
                if (signal.aborted) return;
                patchTurnAt(setHistory, folded.newTurnIndex, (turn) => ({
                    ...turn,
                    audio: audioResult.audio,
                    stats: { ...turn.stats, audio: audioResult.stats },
                }));
                setGeneratingAssets((prev) => ({ ...prev, audio: false }));
            }).catch((e) => {
                setGeneratingAssets((prev) => ({ ...prev, audio: false }));
                if (isAbortError(e)) return;
            });
        }

        if (!styleCard && folded.newTurn.narrative) {
            extractStyleCard({ apiKey, modelPrefs, narrative: folded.newTurn.narrative, signal })
                .then((card) => { if (card && !signal.aborted) setStyleCard(card); })
                .catch(() => { /* ignore */ });
        }

        if (prefs.consistencyCheck) {
            runConsistencyCheck({
                apiKey, modelPrefs, scene: folded.newScene, codex: folded.newCodex,
                narrative: folded.newTurn.narrative, signal,
            }).then((report) => {
                if (signal.aborted || !report) return;
                const trimmed = report.trim();
                if (!trimmed || /^none\b/i.test(trimmed)) return;
                showToast('info', `Continuity: ${trimmed.slice(0, 180)}`);
            }).catch(() => { /* ignore */ });
        }

        const loreSignal = startAssetSignal(assetAbortMap, `lore:${folded.newTurnIndex}`);
        backfillCodexFromNarrative(textDeps(), {
            narrative: folded.newTurn.narrative,
            codex: folded.newCodex,
            signal: loreSignal,
        }).then((extra) => {
            if (loreSignal.aborted || !extra.length) return;
            const prev = getSnapshot().codex;
            const merged = mergeCodex(prev, extra, folded.newTurnIndex);
            const newcomers = diffNewCodexEntries(prev, merged);
            setCodex(merged);
            patchTurnAt(setHistory, folded.newTurnIndex, (turn) => ({
                ...turn,
                codex_updates: [...(turn.codex_updates || []), ...extra],
            }));
            const portraitSignal = startAssetSignal(assetAbortMap, `portraits:${folded.newTurnIndex}:late`);
            generateMissingPortraits(io, newcomers, portraitSignal, merged);
        }).catch((e) => {
            if (isAbortError(e)) return;
        });

        const portraitSignal = startAssetSignal(assetAbortMap, `portraits:${folded.newTurnIndex}`);
        generateMissingPortraits(io, diffNewCodexEntries(baseCodex, folded.newCodex), portraitSignal, folded.newCodex);

        if (isEnding && promptType !== 'initial') {
            const nextTurns = turnsRemaining - 1;
            setTurnsRemaining(nextTurns);
            if (nextTurns <= 0) {
                setIsFinished(true);
                setTurnsRemaining(0);
                try {
                    const title = await callGeminiText(textDeps(), `Provide a short, evocative book title (3-6 words) for this story. Respond with ONLY the title, no quotes.\n\nStory summary: ${summaryToText(folded.newSummary)}`, '', { signal });
                    if (title && !signal.aborted) setExportDetails((prev) => ({ ...prev, title: title.replace(/^["']+|["']+$/g, '').trim() }));
                } catch { /* ignore */ }
            }
        }

        maybeCompact(folded.newSummary, {
            apiKey,
            modelPrefs,
            signal,
            setSummary,
        });
    } catch (error) {
        if (isAbortError(error)) {
            if (abortRef.current && abortRef.current !== myController) return;
            setLoading(false); setIsStreaming(false); setStreamingText('');
            setStatus('');
            return;
        }
        console.error(error);
        showToast('error', `Error: ${error.message}`);
        setLoading(false); setIsStreaming(false); setStreamingText('');
        setGeneratingAssets({ image: false, audio: false });
    } finally {
        if (!signal.aborted) { setUserInput(''); setStatus(''); }
    }
};
