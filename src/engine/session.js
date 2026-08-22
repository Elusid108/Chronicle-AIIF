import { EMPTY_SCENE, EMPTY_SUMMARY } from '../constants.js';
import { callGemini, callGeminiText, generateImage, generateSpeech, isAbortError } from '../api/gemini.js';
import { ACTIVE_SAVE_ID, pruneTurnImages, putTurnImage } from '../utils/idb.js';
import { snapshotImage } from '../utils/images.js';
import { normalizeSummary, summaryToText } from '../utils/storage.js';
import {
    appendBeat, applyCompaction, mergeCodex, mergeScene, scrubImagePrompt, splitBeatsForCompaction,
} from './memory.js';
import { buildActionPrompt, buildSystemPrompt, endingInstruction, TURN_SCHEMA } from './prompt.js';

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

export const foldTurn = (base, turnData, prefs, userAction, textStats) => {
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
        choices: Array.isArray(turnData.choices) ? turnData.choices.filter(Boolean).slice(0, 4) : [],
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

const patchTurnByNarrative = (setHistory, narrative, patcher) => {
    setHistory((prev) => {
        const updated = [...prev];
        const index = updated.length - 1;
        if (updated[index] && updated[index].narrative === narrative) {
            updated[index] = patcher(updated[index]);
        }
        return updated;
    });
};

/**
 * Run one narrative turn. `io` supplies React setters and live getters.
 */
export const processTurn = async (io, promptType, inputVal, base) => {
    const {
        abortRef, getSnapshot, stopAudio, showToast,
        setView, setLoading, setIsStreaming, setStreamingText, setStatus, setToast,
        setCodex, setSummary, setStats, setScene, setStyleCard, setHistory, setCurrentSlideIndex,
        setGeneratingAssets, setTurnsRemaining, setIsFinished, setExportDetails, setUserInput,
        textDeps, imageDeps, speechDeps,
    } = io;

    const snap = getSnapshot();
    const baseHistory = base?.history ?? snap.history;
    const baseCodex = base?.codex ?? snap.codex;
    const baseSummary = base?.summary ?? snap.summary;
    const baseStats = base?.stats ?? snap.stats;
    const baseScene = base?.scene ?? snap.scene;
    const { config, initialContext, prefs, isEnding, turnsRemaining, mediaStatus, apiKey, modelPrefs, styleCard } = snap;

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
    });
    if (isEnding) systemPrompt += endingInstruction(turnsRemaining, config.mode);

    const modelPrompt = promptType === 'initial' ? inputVal : buildActionPrompt(inputVal);
    const userAction = promptType === 'initial' ? null : inputVal;

    try {
        const { data: turnData, stats: textStats } = await callGemini(textDeps(), modelPrompt, systemPrompt, {
            schema: TURN_SCHEMA,
            stream: streaming,
            onPartialText: streaming ? (t) => setStreamingText(t) : undefined,
            signal,
        });
        if (signal.aborted) return;

        const folded = foldTurn(
            { history: baseHistory, codex: baseCodex, summary: baseSummary, stats: baseStats, scene: baseScene },
            turnData,
            prefs,
            userAction,
            textStats,
        );

        setCodex(folded.newCodex);
        setSummary(folded.newSummary);
        setStats(folded.newStats);
        setScene(folded.newScene);
        setHistory([...baseHistory, folded.newTurn]);
        if (promptType === 'initial') { setCurrentSlideIndex(0); setView('game'); }
        else setCurrentSlideIndex(folded.newTurnIndex);

        setIsStreaming(false); setStreamingText(''); setLoading(false);

        const fetchImage = mediaStatus.images !== 'disabled';
        const fetchAudio = mediaStatus.audio !== 'disabled' && prefs.autoPlay;
        setGeneratingAssets({ image: fetchImage, audio: fetchAudio });
        setStatus('Generating assets...');

        if (fetchImage) {
            const scrubbed = scrubImagePrompt(turnData.image_prompt, folded.newCodex);
            generateImage(imageDeps(), scrubbed, { signal }).then(async (imageResult) => {
                if (signal.aborted) return;
                let url = imageResult.image;
                let blob = null;
                if (url) {
                    const snapshotted = await snapshotImage(url);
                    if (signal.aborted) return;
                    url = snapshotted.url || url;
                    blob = snapshotted.blob;
                }
                patchTurnByNarrative(setHistory, folded.newTurn.narrative, (turn) => ({
                    ...turn,
                    image: url,
                    stats: { ...turn.stats, image: imageResult.stats },
                }));
                if (blob && (prefs.keepLastNImages || 0) > 0) {
                    try {
                        await putTurnImage(ACTIVE_SAVE_ID, folded.newTurnIndex, blob);
                        await pruneTurnImages(ACTIVE_SAVE_ID, prefs.keepLastNImages);
                    } catch { /* ignore quota */ }
                }
                setGeneratingAssets((prev) => ({ ...prev, image: false }));
            }).catch((e) => {
                if (isAbortError(e)) return;
                setGeneratingAssets((prev) => ({ ...prev, image: false }));
            });
        }

        if (fetchAudio && turnData.narrative) {
            generateSpeech(speechDeps(), turnData.narrative, null, { signal }).then((audioResult) => {
                if (signal.aborted) return;
                patchTurnByNarrative(setHistory, folded.newTurn.narrative, (turn) => ({
                    ...turn,
                    audio: audioResult.audio,
                    stats: { ...turn.stats, audio: audioResult.stats },
                }));
                setGeneratingAssets((prev) => ({ ...prev, audio: false }));
            }).catch((e) => {
                if (isAbortError(e)) return;
                setGeneratingAssets((prev) => ({ ...prev, audio: false }));
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

        if (isEnding) {
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
            setGeneratingAssets({ image: false, audio: false });
            setStatus('');
            return;
        }
        console.error(error);
        showToast('error', `Error: ${error.message}`);
        setLoading(false); setIsStreaming(false); setStreamingText('');
        setGeneratingAssets({ image: false, audio: false });
        if (promptType === 'initial' && baseHistory.length === 0) setView('setup');
    } finally {
        if (!signal.aborted) { setUserInput(''); setStatus(''); }
    }
};
