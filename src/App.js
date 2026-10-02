import { useState, useEffect, useMemo, useRef } from 'react';
import { html } from './html.js';
import { DEFAULT_CONFIG, DEFAULT_CODEX, EMPTY_SCENE } from './constants.js';
import {
    STORAGE_KEYS, loadJSON, saveJSON,
    initStorage, attachStoredImages,
    attachCodexPortraits, revokeCodexPortraits,
    listSlots, deleteSlot, loadSlot, exportStoryFile, importStoryFile,
    normalizeSummary, createStorySlot, writeStorySlot, renameSlot, reorderSlots,
    setCurrentSlotId, migrateLegacyActive, buildSavePayload,
} from './utils/storage.js';
import { fetchAvailableModels, generateSpeech } from './api/gemini.js';
import { buildInitialPrompt, buildSystemPrompt } from './engine/prompt.js';
import {
    appendCodexOverride, mergeCodexKeys, overlayCodexRuntime, pruneCodexOverrides, updateCodexEntry,
} from './engine/memory.js';
import {
    EMPTY_SUMMARY, abortActiveTurn, abortAllAssetSignals, abortAssetSignal, attachSceneImage,
    generateEntryPortrait, lastAiIndex, processTurn, rebuildBase, sceneJobKey,
    startAssetSignal,
} from './engine/session.js';
import { ensureRecallIndex, getRecallState, indexTurn, retrieveRecall } from './engine/recall.js';
import { revokeHistoryImages, revokeIfBlobUrl } from './utils/images.js';
import { copyCodexImageKey, deleteCodexImage, deleteRecallFrom, deleteTurnImagesFrom, getCodexImage, pruneTurnImages } from './utils/idb.js';
import { escapeHtml, safeImageSrc } from './utils/text.js';
import { downloadVerboseLog, setVerboseEnabled } from './utils/verboseLog.js';
import { ApiKeyModal } from './components/ApiKeyModal.js';
import { SetupView } from './components/SetupView.js';
import { GameView } from './components/GameView.js';

const DEFAULT_PREFS = {
    narrativeSize: 'text-lg',
    uiSize: 'text-sm',
    voice: 'Alnilam',
    autoPlay: true,
    endingLength: 5,
    streaming: true,
    statsEnabled: false,
    consistencyCheck: false,
    keepLastNImages: 4,
    pacing: 'standard',
    verboseLogging: false,
    loreBackfill: true,
    storyRecall: true,
};

const EMPTY_OVERRIDES = { ops: [] };
const AUTOSAVE_DEBOUNCE_MS = 500;

export function App() {
    const [apiKey, setApiKey] = useState('');
    const [view, setView] = useState('setup');
    const [status, setStatus] = useState('');

    const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
    const [setupConfig, setSetupConfig] = useState({ ...DEFAULT_CONFIG });
    const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_PREFS, ...loadJSON(STORAGE_KEYS.prefs, {}) }));
    const [mediaStatus, setMediaStatus] = useState({ images: 'active', audio: 'active' });

    const [availableModels, setAvailableModels] = useState({ text: [], image: [], audio: [] });
    const [modelPrefs, setModelPrefs] = useState(() => ({ textModel: '', imageModel: '', audioModel: '', ...loadJSON(STORAGE_KEYS.modelPrefs, {}) }));
    const [modelListLoading, setModelListLoading] = useState(false);

    const [favorites, setFavorites] = useState(() => loadJSON(STORAGE_KEYS.favVoices, []));

    const [initialContext, setInitialContext] = useState('');
    const [activePanel, setActivePanel] = useState(null);
    const [slots, setSlots] = useState([]);
    const [currentSlotId, setCurrentSlotIdState] = useState(null);

    const [showExportModal, setShowExportModal] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [exportDetails, setExportDetails] = useState({ title: 'The Unnamed Chronicle', author: 'Anonymous' });

    const [history, setHistory] = useState([]);
    const [codex, setCodex] = useState({ ...DEFAULT_CODEX });
    const [codexOverrides, setCodexOverrides] = useState(EMPTY_OVERRIDES);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [summary, setSummary] = useState({ ...EMPTY_SUMMARY });
    const [scene, setScene] = useState({ ...EMPTY_SCENE });
    const [styleCard, setStyleCard] = useState('');
    const [stats, setStats] = useState({});
    const [userInput, setUserInput] = useState('');
    const [selectedCodexEntry, setSelectedCodexEntry] = useState(null);

    const [isEnding, setIsEnding] = useState(false);
    const [turnsRemaining, setTurnsRemaining] = useState(null);
    const [isFinished, setIsFinished] = useState(false);

    const [loading, setLoading] = useState(false);
    const [generatingAssets, setGeneratingAssets] = useState({ image: false, audio: false });

    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [editingAction, setEditingAction] = useState(null);
    const [toast, setToast] = useState(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const audioRef = useRef(null);
    const audioUrlRef = useRef(null);
    const playingIndexRef = useRef(-1);
    const autoPlayedIndexRef = useRef(-1);
    const speakSeq = useRef(0);
    const toastTimer = useRef(null);
    const abortRef = useRef(null);
    const assetAbortMap = useRef(new Map());
    const snapshotRef = useRef({});
    const saveQueue = useRef({ timer: null, pending: null, chain: Promise.resolve(), lastJson: '' });
    const bootReady = useRef(null);
    const startingRef = useRef(false);

    const touchStart = useRef(null);
    const touchEnd = useRef(null);
    const minSwipeDistance = 50;
    const textScrollRef = useRef(null);

    snapshotRef.current = {
        history, codex, codexOverrides, summary, stats, scene, styleCard, config, initialContext,
        prefs, isEnding, turnsRemaining, isFinished, mediaStatus, apiKey, modelPrefs,
        currentSlotId,
    };

    const showToast = (type, message) => {
        setToast({ type, message });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 10000 : 5000);
    };
    const dismissToast = () => {
        clearTimeout(toastTimer.current);
        setToast(null);
    };

    useEffect(() => {
        const applyViewportHeight = () => {
            const h = window.visualViewport?.height || window.innerHeight;
            document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
        };
        applyViewportHeight();
        const vv = window.visualViewport;
        vv?.addEventListener('resize', applyViewportHeight);
        vv?.addEventListener('scroll', applyViewportHeight);
        window.addEventListener('resize', applyViewportHeight);
        return () => {
            vv?.removeEventListener('resize', applyViewportHeight);
            vv?.removeEventListener('scroll', applyViewportHeight);
            window.removeEventListener('resize', applyViewportHeight);
        };
    }, []);

    useEffect(() => {
        const storedKey = localStorage.getItem(STORAGE_KEYS.apiKey);
        if (storedKey) setApiKey(storedKey);
        bootReady.current = (async () => {
            try {
                await initStorage();
                const id = await migrateLegacyActive();
                setCurrentSlotIdState(id);
                setSlots(await listSlots());
            } catch (e) {
                console.warn('Chronicle: storage boot failed', e);
            }
        })();
    }, []);

    useEffect(() => { saveJSON(STORAGE_KEYS.prefs, prefs); }, [prefs]);
    useEffect(() => {
        // Lowering "Keep last N images" trims the current story's stored pages right away.
        if (!currentSlotId) return;
        pruneTurnImages(currentSlotId, prefs.keepLastNImages || 0).catch(() => {});
    }, [prefs.keepLastNImages]);
    useEffect(() => { setVerboseEnabled(!!prefs.verboseLogging); }, [prefs.verboseLogging]);
    useEffect(() => { saveJSON(STORAGE_KEYS.modelPrefs, modelPrefs); }, [modelPrefs]);
    useEffect(() => { saveJSON(STORAGE_KEYS.favVoices, favorites); }, [favorites]);

    useEffect(() => {
        if (apiKey && availableModels.text.length === 0) fetchModels();
    }, [apiKey]);

    // Autosave: debounced, serialized, deduplicated by payload. Media patches
    // (portraits, audio, images) produce identical payloads and are skipped.
    const flushSave = () => {
        const q = saveQueue.current;
        clearTimeout(q.timer);
        q.timer = null;
        const job = q.pending;
        q.pending = null;
        if (!job) return q.chain;
        q.chain = q.chain.then(async () => {
            try {
                await initStorage();
                const payloadJson = JSON.stringify(buildSavePayload(job.state));
                if (payloadJson === q.lastJson && job.slotId === q.lastSlotId) return;
                await writeStorySlot(job.slotId, job.state);
                q.lastJson = payloadJson;
                q.lastSlotId = job.slotId;
                setSlots(await listSlots());
            } catch (e) {
                console.warn('Chronicle: autosave failed', e);
                if (e?.name === 'QuotaExceededError') {
                    showToast('error', 'Storage is full. Lower "Keep last N images" in Settings or delete a story.');
                } else {
                    showToast('error', `Could not save the story: ${e?.message || e}`);
                }
            }
        });
        return q.chain;
    };

    useEffect(() => {
        if (view !== 'game' || history.length === 0 || !currentSlotId) return undefined;
        const q = saveQueue.current;
        q.pending = {
            slotId: currentSlotId,
            state: {
                history, codex, codexOverrides, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining,
                isFinished, exportDetails, config, initialContext, stats,
            },
        };
        clearTimeout(q.timer);
        q.timer = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
        return undefined;
    }, [view, history, codex, codexOverrides, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining, isFinished, exportDetails, config, initialContext, stats, currentSlotId]);

    useEffect(() => {
        const onHide = () => { flushSave(); };
        window.addEventListener('pagehide', onHide);
        return () => window.removeEventListener('pagehide', onHide);
    }, []);

    useEffect(() => {
        let animationFrame;
        const animateScroll = () => {
            if (isPlaying && audioRef.current && textScrollRef.current) {
                const { currentTime, duration } = audioRef.current;
                if (duration > 0) {
                    const scrollHeight = textScrollRef.current.scrollHeight - textScrollRef.current.clientHeight;
                    if (scrollHeight > 0) textScrollRef.current.scrollTop = scrollHeight * (currentTime / duration);
                }
                animationFrame = requestAnimationFrame(animateScroll);
            }
        };
        if (isPlaying) animationFrame = requestAnimationFrame(animateScroll);
        else cancelAnimationFrame(animationFrame);
        return () => cancelAnimationFrame(animationFrame);
    }, [isPlaying]);

    useEffect(() => { if (history.length > 0) setCurrentSlideIndex(history.length - 1); }, [history.length]);
    useEffect(() => { if (textScrollRef.current) textScrollRef.current.scrollTop = 0; }, [currentSlideIndex, history]);
    useEffect(() => {
        if (!selectedCodexEntry) return;
        ensureCodexPortrait(selectedCodexEntry.category, selectedCodexEntry.title);
    }, [selectedCodexEntry?.category, selectedCodexEntry?.title]);

    // Auto-play narrates each new page once. Tracking by index (not object
    // identity) means later patches to the turn (image, lore) never restart it.
    useEffect(() => {
        const currentTurn = history[currentSlideIndex];
        if (view !== 'game' || !prefs.autoPlay || mediaStatus.audio === 'disabled') return;
        if (currentSlideIndex !== history.length - 1 || currentTurn?.type !== 'ai' || !currentTurn.audio) return;
        if (autoPlayedIndexRef.current === currentSlideIndex || isPlaying) return;
        autoPlayedIndexRef.current = currentSlideIndex;
        handleSpeak(currentTurn, currentSlideIndex);
    }, [view, currentSlideIndex, history, prefs.autoPlay, mediaStatus.audio]);

    useEffect(() => {
        if (activePanel === 'settings') {
            const timer = setTimeout(() => {
                const el = document.getElementById(`voice-${prefs.voice}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [activePanel, prefs.voice]);

    const handleKeySave = (key) => {
        const cleanKey = key.trim();
        localStorage.setItem(STORAGE_KEYS.apiKey, cleanKey);
        setApiKey(cleanKey);
    };

    const togglePanel = (panelName) => setActivePanel((current) => (current === panelName ? null : panelName));

    const fetchModels = async () => {
        if (!apiKey) return;
        setModelListLoading(true);
        try {
            setAvailableModels(await fetchAvailableModels(apiKey));
        } catch (e) {
            console.error('Failed to fetch models:', e);
        } finally {
            setModelListLoading(false);
        }
    };

    const textDeps = () => ({
        apiKey,
        modelPrefs,
        setStatus,
        availableTextModels: (availableModels.text || []).map((m) => m.id),
    });
    const imageDeps = () => ({
        apiKey, modelPrefs,
        config: snapshotRef.current.config || config,
        mediaStatus: snapshotRef.current.mediaStatus || mediaStatus,
        setMediaStatus, setStatus,
        notify: showToast,
        availableImageModels: (availableModels.image || []).map((m) => m.id),
    });
    const speechDeps = () => ({ apiKey, modelPrefs, prefs, mediaStatus, setMediaStatus, setStatus });

    const regenImageForIndex = (idx, turn) => {
        if (!turn?.image_prompt) return;
        const live = snapshotRef.current;
        setGeneratingAssets((prev) => ({ ...prev, image: true }));
        const imageSignal = startAssetSignal(assetAbortMap, sceneJobKey(idx));
        attachSceneImage({
            io: turnIo(),
            imageDeps,
            prompt: turn.image_prompt,
            codex: live.codex,
            scene: turn.scene || live.scene,
            narrative: turn.narrative,
            slotId: live.currentSlotId || null,
            keepLastN: live.prefs?.keepLastNImages || 0,
            turnIndex: idx,
            setHistory,
            signal: imageSignal,
            showToast,
            setGeneratingAssets,
            assetAbortMap,
        }).catch(() => { /* attachSceneImage clears the flag in its finally */ });
    };

    const retryTurnImage = () => {
        const idx = currentSlideIndex;
        const turn = history[idx];
        if (!turn || turn.type !== 'ai' || !turn.image_prompt) return;
        regenImageForIndex(idx, turn);
    };

    const ensureCodexPortrait = async (category, key) => {
        const entry = snapshotRef.current.codex?.[category]?.[key];
        if (!entry) return;
        if (entry.portraitUrl) return;
        const slotId = snapshotRef.current.currentSlotId;
        try {
            const blob = slotId ? await getCodexImage(slotId, category, key) : null;
            if (blob) {
                const current = snapshotRef.current.codex?.[category]?.[key];
                if (!current) return;
                if (current.portraitUrl) return; // another path hydrated it meanwhile
                const url = URL.createObjectURL(blob);
                const nextEntry = { ...current, hasPortrait: true, portraitUrl: url };
                setCodex((prev) => {
                    if (!prev[category]?.[key]) return prev;
                    if (prev[category][key].portraitUrl) { revokeIfBlobUrl(url); return prev; }
                    return { ...prev, [category]: { ...prev[category], [key]: nextEntry } };
                });
                setSelectedCodexEntry((sel) => (
                    sel && sel.category === category && sel.title === key ? { ...sel, data: nextEntry } : sel
                ));
                return;
            }
        } catch { /* generate */ }
        const signal = startAssetSignal(assetAbortMap, `bg:portrait:${category}:${key}`);
        generateEntryPortrait(turnIo(), { category, key, data: entry, signal }).catch(() => {});
    };

    const releaseAudio = () => {
        if (audioRef.current) {
            try { audioRef.current.pause(); } catch { /* ignore */ }
            audioRef.current.onended = null;
            audioRef.current.onerror = null;
            audioRef.current = null;
        }
        if (audioUrlRef.current) { revokeIfBlobUrl(audioUrlRef.current); audioUrlRef.current = null; }
    };

    const stopAudio = () => {
        speakSeq.current += 1;
        releaseAudio();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setIsPlaying(false); setPreviewPlaying(false); playingIndexRef.current = -1;
    };

    const playBlob = (blob, onDone) => {
        releaseAudio();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        const finish = () => {
            if (audioRef.current === audio) releaseAudio();
            onDone();
        };
        audio.onended = finish;
        audio.onerror = finish;
        const played = audio.play();
        if (played && typeof played.catch === 'function') {
            played.catch((e) => {
                if (e?.name !== 'AbortError') console.warn('Chronicle: audio play failed', e);
                finish();
            });
        }
    };

    const handleSpeak = async (turn, index = currentSlideIndex) => {
        if (!turn) return;
        if (isPlaying && playingIndexRef.current === index) { stopAudio(); return; }
        stopAudio();
        const seq = ++speakSeq.current;
        playingIndexRef.current = index;
        setIsPlaying(true);
        const done = () => {
            if (speakSeq.current !== seq) return;
            setIsPlaying(false);
            playingIndexRef.current = -1;
        };

        let audioContent = turn.audio;
        if (!audioContent) {
            let result;
            try {
                result = await generateSpeech(speechDeps(), turn.narrative || '');
            } catch (e) {
                console.warn('Chronicle: speech failed', e);
                done();
                return;
            }
            if (speakSeq.current !== seq) return; // Stop pressed or another page started meanwhile
            audioContent = result.audio;
            if (audioContent) {
                setHistory((prev) => prev.map((t, i) => (i === index && t.type === 'ai' ? { ...t, audio: audioContent, stats: { ...t.stats, audio: result.stats } } : t)));
            }
        }

        if (audioContent === 'browser_tts') {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance('... ' + (turn.narrative || ''));
                utterance.rate = 1.0; utterance.pitch = 1.0;
                utterance.onend = done;
                utterance.onerror = done;
                setTimeout(() => { if (speakSeq.current === seq) window.speechSynthesis.speak(utterance); }, 250);
            } else done();
        } else if (audioContent) {
            playBlob(audioContent, done);
        } else done();
    };

    const previewVoice = async (voiceName) => {
        stopAudio();
        const seq = speakSeq.current;
        setPreviewPlaying(true);
        let result;
        try {
            result = await generateSpeech(speechDeps(), 'I would love to be your narrator.', voiceName);
        } catch { result = null; }
        if (speakSeq.current !== seq) return;
        if (result?.audio && result.audio !== 'browser_tts') {
            playBlob(result.audio, () => { if (speakSeq.current === seq) setPreviewPlaying(false); });
        } else { setPreviewPlaying(false); }
    };

    const toggleFavorite = (v, e) => { e.stopPropagation(); setFavorites((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v])); };

    const turnIo = () => ({
        abortRef,
        assetAbortMap,
        getSnapshot: () => snapshotRef.current,
        stopAudio,
        showToast,
        setView, setLoading, setIsStreaming, setStreamingText, setStatus, setToast,
        setCodex, setSummary, setStats, setScene, setStyleCard, setHistory, setCurrentSlideIndex,
        setGeneratingAssets, setTurnsRemaining, setIsFinished, setIsEnding, setExportDetails, setUserInput,
        setSelectedCodexEntry,
        textDeps, imageDeps, speechDeps,
        retrieveRecall: recallForTurn,
        indexRecall: indexTurnForRecall,
    });

    // Per-story recall hooks used by processTurn.
    const recallForTurn = async ({ query, history: baseHistory, scene: baseScene, signal }) => {
        const live = snapshotRef.current;
        if (!live.currentSlotId || live.prefs?.storyRecall === false) return null;
        if ((baseHistory || []).filter((t) => t.type === 'ai').length < 4) return null;
        const fullQuery = [query, baseScene?.location, baseScene?.goal].filter(Boolean).join('\n');
        return retrieveRecall({ slotId: live.currentSlotId, history: baseHistory, query: fullQuery, deps: textDeps(), signal });
    };
    const indexTurnForRecall = ({ turnIndex, turn, signal }) => {
        const live = snapshotRef.current;
        if (!live.currentSlotId || live.prefs?.storyRecall === false) return Promise.resolve();
        return indexTurn({ slotId: live.currentSlotId, turnIndex, turn, deps: textDeps(), signal });
    };

    const runTurn = (promptType, inputVal, base) => processTurn(turnIo(), promptType, inputVal, base);

    const emptyStoryState = () => ({
        history: [],
        codex: { ...DEFAULT_CODEX },
        codexOverrides: EMPTY_OVERRIDES,
        summary: { ...EMPTY_SUMMARY },
        stats: {},
        scene: { ...EMPTY_SCENE },
        styleCard: '',
        currentSlideIndex: 0,
        isEnding: false,
        turnsRemaining: null,
        isFinished: false,
        exportDetails: { title: 'The Unnamed Chronicle', author: 'Anonymous' },
        config: { ...setupConfig },
        initialContext,
    });

    // Reset per-story UI state before switching stories.
    const resetStoryUi = () => {
        stopAudio();
        setSelectedCodexEntry(null);
        setEditingAction(null);
        setUserInput('');
        setActivePanel(null);
        autoPlayedIndexRef.current = -1;
    };

    const startGame = async () => {
        if (startingRef.current) return;
        startingRef.current = true;
        setLoading(true);
        try {
            abortActiveTurn(abortRef);
            abortAllAssetSignals(assetAbortMap);
            await flushSave();
            await bootReady.current;
            revokeHistoryImages(history);
            revokeCodexPortraits(codex);
            await initStorage();
            const storyConfig = { ...setupConfig };
            const fresh = { ...emptyStoryState(), config: storyConfig };
            const entry = await createStorySlot(fresh);
            const resetSnap = {
                ...snapshotRef.current,
                ...fresh,
                currentSlotId: entry.id,
            };
            snapshotRef.current = resetSnap;
            resetStoryUi();
            setConfig(storyConfig);
            setCurrentSlotIdState(entry.id);
            setSlots(await listSlots());
            setHistory([]);
            setCodex({ ...DEFAULT_CODEX });
            setCodexOverrides(EMPTY_OVERRIDES);
            setSummary({ ...EMPTY_SUMMARY });
            setScene({ ...EMPTY_SCENE });
            setStyleCard('');
            setStats({});
            setCurrentSlideIndex(0);
            setIsEnding(false); setTurnsRemaining(null); setIsFinished(false);
            setExportDetails({ title: 'The Unnamed Chronicle', author: 'Anonymous' });
            setView('game');
            setIsStreaming(true);
            setStreamingText('');
            setLoading(false);
            runTurn('initial', buildInitialPrompt(storyConfig, initialContext), {
                history: [],
                codex: { ...DEFAULT_CODEX },
                summary: { ...EMPTY_SUMMARY },
                stats: {},
                scene: { ...EMPTY_SCENE },
                styleCard: '',
            });
        } catch (e) {
            setLoading(false);
            showToast('error', `Could not start the story: ${e?.message || e}`);
        } finally {
            startingRef.current = false;
        }
    };

    const retryOpening = () => {
        if (history.length > 0) return;
        setIsStreaming(true);
        setStreamingText('');
        setLoading(false);
        setToast(null);
        runTurn('initial', buildInitialPrompt(config, initialContext), {
            history: [],
            codex: snapshotRef.current.codex || { ...DEFAULT_CODEX },
            summary: snapshotRef.current.summary || { ...EMPTY_SUMMARY },
            stats: {},
            scene: snapshotRef.current.scene || { ...EMPTY_SCENE },
            styleCard: '',
        });
    };

    const handleTurn = (input) => {
        if (isFinished || turnsRemaining === 0) return;
        if (input && input.trim()) runTurn('continue', input);
    };

    const applyBase = (b) => {
        abortAllAssetSignals(assetAbortMap);
        revokeHistoryImages(history.slice(b.history.length));
        const prunedOverrides = pruneCodexOverrides(snapshotRef.current.codexOverrides, b.history.filter((t) => t.type === 'ai').length);
        const nextCodex = overlayCodexRuntime(b.codex, snapshotRef.current.codex);
        const nextScene = b.scene || { ...EMPTY_SCENE };
        const isEndingNext = Boolean(b.isEnding);
        const remainingNext = isEndingNext ? (b.turnsRemaining ?? null) : null;
        const finishedNext = Boolean(b.isFinished);
        setHistory(b.history);
        setCodex(nextCodex);
        setCodexOverrides(prunedOverrides);
        setSummary(b.summary);
        setStats(b.stats);
        setScene(nextScene);
        if (b.styleCard !== undefined) setStyleCard(b.styleCard);
        setCurrentSlideIndex(Math.max(0, b.history.length - 1));
        setIsFinished(finishedNext); setIsEnding(isEndingNext); setTurnsRemaining(remainingNext);
        setEditingAction(null);
        autoPlayedIndexRef.current = -1;
        snapshotRef.current = {
            ...snapshotRef.current,
            history: b.history,
            codex: nextCodex,
            codexOverrides: prunedOverrides,
            summary: b.summary,
            stats: b.stats,
            scene: nextScene,
            styleCard: b.styleCard !== undefined ? b.styleCard : snapshotRef.current.styleCard,
            currentSlideIndex: Math.max(0, b.history.length - 1),
            isFinished: finishedNext,
            isEnding: isEndingNext,
            turnsRemaining: remainingNext,
        };
        const slotId = snapshotRef.current.currentSlotId;
        if (slotId) {
            deleteTurnImagesFrom(slotId, b.history.length).catch(() => {});
            deleteRecallFrom(slotId, b.history.length).catch(() => {});
        }
    };

    const rewindTurn = () => {
        const idx = lastAiIndex(history);
        if (idx <= 0) return;
        abortActiveTurn(abortRef);
        stopAudio();
        applyBase(rebuildBase(history.slice(0, idx), summary, codexOverrides));
        showToast('info', 'Rewound one turn');
    };

    const regenerateTurn = () => {
        const idx = lastAiIndex(history);
        if (idx < 0) return;
        const lastTurn = history[idx];
        abortActiveTurn(abortRef);
        abortAssetSignal(assetAbortMap, sceneJobKey(idx));
        stopAudio();
        const remaining = history.slice(0, idx);
        const base = rebuildBase(remaining, summary, codexOverrides);
        applyBase(base);
        if (lastTurn.userActionPreceding == null) {
            setStyleCard('');
            runTurn('initial', buildInitialPrompt(config, initialContext), {
                history: [],
                codex: { ...DEFAULT_CODEX },
                summary: { ...EMPTY_SUMMARY },
                stats: {},
                scene: { ...EMPTY_SCENE },
                styleCard: '',
            });
        } else {
            runTurn('continue', lastTurn.userActionPreceding, base);
        }
    };

    const beginEditAction = () => {
        const idx = lastAiIndex(history);
        if (idx < 0) return;
        const lastTurn = history[idx];
        if (lastTurn.userActionPreceding == null) { showToast('info', 'The opening turn cannot be edited; use Regenerate.'); return; }
        setEditingAction(lastTurn.userActionPreceding);
    };
    const setEditingActionText = (t) => setEditingAction(t);
    const cancelEditAction = () => setEditingAction(null);
    const submitEditAction = () => {
        const text = (editingAction || '').trim();
        if (!text) return;
        const idx = lastAiIndex(history);
        if (idx < 0) return;
        abortActiveTurn(abortRef);
        abortAssetSignal(assetAbortMap, sceneJobKey(idx));
        stopAudio();
        const base = rebuildBase(history.slice(0, idx), summary, codexOverrides);
        applyBase(base);
        setEditingAction(null);
        runTurn('continue', text, base);
    };

    const initiateEnding = () => {
        if (isFinished || typeof turnsRemaining === 'number') return;
        if (isEnding) {
            snapshotRef.current = { ...snapshotRef.current, isEnding: false, turnsRemaining: null };
            setIsEnding(false);
            setTurnsRemaining(null);
            return;
        }
        snapshotRef.current = { ...snapshotRef.current, isEnding: true, turnsRemaining: null };
        setIsEnding(true);
        setTurnsRemaining(null);
    };
    const resumeStory = () => {
        snapshotRef.current = { ...snapshotRef.current, isEnding: false, isFinished: false, turnsRemaining: null };
        setIsEnding(false); setIsFinished(false); setTurnsRemaining(null);
        const lastTurn = history[history.length - 1];
        if (lastTurn && lastTurn.type !== 'chapter_marker') {
            setHistory((prev) => [...prev, { type: 'chapter_marker', title: 'New Chapter' }]);
            setCurrentSlideIndex((prev) => prev + 1);
        }
    };

    const resetGame = async () => {
        abortActiveTurn(abortRef);
        abortAllAssetSignals(assetAbortMap);
        revokeHistoryImages(history);
        revokeCodexPortraits(codex);
        await initStorage();
        setHistory([]); setCodex({ ...DEFAULT_CODEX }); setCodexOverrides(EMPTY_OVERRIDES); setCurrentSlideIndex(0);
        setSummary({ ...EMPTY_SUMMARY }); setScene({ ...EMPTY_SCENE }); setStyleCard(''); setStats({}); setUserInput('');
        setIsEnding(false); setTurnsRemaining(null); setIsFinished(false);
        setLoading(false); setIsStreaming(false); setStreamingText('');
        setGeneratingAssets({ image: false, audio: false }); setStatus('');
        setInitialContext(''); setExportDetails({ title: 'The Unnamed Chronicle', author: 'Anonymous' });
        setMediaStatus({ images: 'active', audio: 'active' });
        stopAudio(); setActivePanel(null); setEditingAction(null);
    };

    const goHome = async () => {
        abortActiveTurn(abortRef);
        abortAllAssetSignals(assetAbortMap);
        setIsStreaming(false);
        setStreamingText('');
        setLoading(false);
        resetStoryUi();
        setView('setup');
        await flushSave();
        setSlots(await listSlots());
    };
    const confirmAbandon = () => { setShowExitConfirm(false); resetGame(); setView('setup'); };

    const clearApiKey = () => {
        showToast('info', 'API key cleared');
        localStorage.removeItem(STORAGE_KEYS.apiKey);
        setApiKey('');
        togglePanel(null);
    };

    // Player edits are applied live AND recorded so rewind/regenerate replay them.
    const saveCodexEdits = (category, key, patch) => {
        const live = snapshotRef.current;
        if (!live.codex?.[category]?.[key]) return;
        const next = updateCodexEntry(live.codex, category, key, patch);
        const data = next[category]?.[key];
        const atTurn = (live.history || []).filter((t) => t.type === 'ai').length;
        const overrides = appendCodexOverride(live.codexOverrides, { type: 'patch', atTurn, category, key, patch });
        snapshotRef.current = { ...live, codex: next, codexOverrides: overrides };
        setCodex(next);
        setCodexOverrides(overrides);
        setSelectedCodexEntry((sel) => (sel && sel.category === category && sel.title === key ? { ...sel, data } : sel));
    };

    const regenerateCodexPortrait = async (category, key) => {
        const entry = snapshotRef.current.codex?.[category]?.[key];
        if (!entry) return;
        const slotId = snapshotRef.current.currentSlotId;
        revokeIfBlobUrl(entry.portraitUrl);
        try {
            if (slotId) await deleteCodexImage(slotId, category, key);
        } catch { /* generate anyway */ }
        const nextEntry = { ...entry, hasPortrait: false, portraitUrl: '' };
        setCodex((prev) => {
            if (!prev[category]?.[key]) return prev;
            return { ...prev, [category]: { ...prev[category], [key]: { ...prev[category][key], hasPortrait: false, portraitUrl: '' } } };
        });
        setSelectedCodexEntry((sel) => (
            sel && sel.category === category && sel.title === key ? { ...sel, data: nextEntry } : sel
        ));
        const signal = startAssetSignal(assetAbortMap, `bg:portrait:${category}:${key}`);
        generateEntryPortrait(turnIo(), {
            category,
            key,
            data: { ...entry, hasPortrait: false, portraitUrl: '' },
            signal,
        }).catch(() => {});
    };

    const mergeSelectedInto = (intoKey) => {
        const sel = selectedCodexEntry;
        if (!sel || !intoKey || intoKey === sel.title) return;
        const live = snapshotRef.current;
        const next = mergeCodexKeys(live.codex, sel.category, sel.title, intoKey);
        const atTurn = (live.history || []).filter((t) => t.type === 'ai').length;
        const overrides = appendCodexOverride(live.codexOverrides, { type: 'merge', atTurn, category: sel.category, from: sel.title, into: intoKey });
        snapshotRef.current = { ...live, codex: next, codexOverrides: overrides };
        setCodex(next);
        setCodexOverrides(overrides);
        setSelectedCodexEntry(null);
        const slotId = live.currentSlotId;
        if (slotId) copyCodexImageKey(slotId, sel.category, sel.title, intoKey).catch(() => {});
    };

    const hydrate = async (s, slotId) => {
        if (!slotId) throw new Error('hydrate requires a story slot id');
        abortActiveTurn(abortRef);
        abortAllAssetSignals(assetAbortMap);
        await flushSave();
        setIsStreaming(false);
        setStreamingText('');
        setLoading(false);
        resetStoryUi();
        revokeHistoryImages(snapshotRef.current.history);
        revokeCodexPortraits(snapshotRef.current.codex);
        const withImages = await attachStoredImages(s, slotId);
        const withPortraits = await attachCodexPortraits(withImages.codex, slotId);
        await setCurrentSlotId(slotId);
        setCurrentSlotIdState(slotId);
        setHistory(withImages.history);
        setCodex(withPortraits);
        setCodexOverrides(withImages.codexOverrides || EMPTY_OVERRIDES);
        setSummary(normalizeSummary(withImages.summary));
        setScene(withImages.scene || { ...EMPTY_SCENE });
        setStyleCard(withImages.styleCard || '');
        setStats(withImages.stats || {});
        setCurrentSlideIndex(withImages.currentSlideIndex);
        setIsEnding(withImages.isEnding); setTurnsRemaining(withImages.turnsRemaining); setIsFinished(withImages.isFinished);
        setExportDetails(withImages.exportDetails);
        const loadedConfig = { ...DEFAULT_CONFIG, ...withImages.config };
        const loadedSummary = normalizeSummary(withImages.summary);
        const loadedScene = withImages.scene || { ...EMPTY_SCENE };
        const loadedSlotId = slotId;
        snapshotRef.current = {
            ...snapshotRef.current,
            history: withImages.history,
            codex: withPortraits,
            codexOverrides: withImages.codexOverrides || EMPTY_OVERRIDES,
            summary: loadedSummary,
            scene: loadedScene,
            styleCard: withImages.styleCard || '',
            stats: withImages.stats || {},
            currentSlideIndex: withImages.currentSlideIndex,
            isEnding: withImages.isEnding,
            turnsRemaining: withImages.turnsRemaining,
            isFinished: withImages.isFinished,
            config: loadedConfig,
            initialContext: withImages.initialContext,
            currentSlotId: loadedSlotId,
        };
        setConfig(loadedConfig);
        setInitialContext(withImages.initialContext);
        setView('game'); setActivePanel(null);
        // Missing page images are NOT regenerated on load (each is a paid image
        // call); the "Retry image" button on a page regenerates it on demand.
        if (snapshotRef.current.prefs?.storyRecall !== false) {
            const signal = startAssetSignal(assetAbortMap, 'bg:recall-index');
            ensureRecallIndex({ slotId, history: withImages.history, deps: textDeps(), signal })
                .catch((e) => { if (e?.name !== 'AbortError') console.warn('Chronicle: recall index failed', e); });
        }
    };

    const resumeLatestStory = async () => {
        await initStorage();
        const list = await listSlots();
        const latest = list.reduce((best, s) => (!best || (s.savedAt || 0) > (best.savedAt || 0) ? s : best), null);
        if (latest) {
            await loadSlotById(latest.id);
            return;
        }
        showToast('error', 'No saved story found');
    };

    const refreshSlots = async () => setSlots(await listSlots());
    const loadSlotById = async (id) => {
        if (startingRef.current) return;
        startingRef.current = true;
        setLoading(true);
        try {
            await bootReady.current;
            const s = await loadSlot(id);
            if (!s) { showToast('error', 'Could not load save'); return; }
            await hydrate(s, id);
        } catch (e) {
            showToast('error', `Could not load the story: ${e?.message || e}`);
        } finally {
            setLoading(false);
            startingRef.current = false;
        }
    };
    const deleteSlotById = async (id) => {
        if (currentSlotId === id) {
            // Drop any queued autosave for the story being deleted so it cannot be resurrected.
            const q = saveQueue.current;
            clearTimeout(q.timer); q.timer = null; q.pending = null;
            await q.chain;
            setCurrentSlotIdState(null);
            snapshotRef.current = { ...snapshotRef.current, currentSlotId: null };
        }
        const next = await deleteSlot(id);
        setSlots(next);
    };
    const renameSlotById = async (id, name) => {
        setSlots(await renameSlot(id, name));
    };
    const moveSlotById = async (id, direction) => {
        setSlots(await reorderSlots(id, direction));
    };
    const exportStory = () => {
        exportStoryFile({
            history, codex, codexOverrides, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining,
            isFinished, exportDetails, config, initialContext, stats,
        });
        showToast('info', 'Story exported');
    };
    const importStory = async (file) => {
        try {
            const s = await importStoryFile(file);
            await flushSave();
            const entry = await createStorySlot(s);
            await hydrate(s, entry.id);
            setSlots(await listSlots());
            showToast('info', 'Story imported');
        } catch (e) {
            showToast('error', `Import failed: ${e.message}`);
        }
    };

    // Everything written into the book window is escaped: the window shares
    // this app's origin, so unescaped model output could read localStorage.
    const exportBook = () => {
        const bookWindow = window.open('', '_blank');
        if (!bookWindow) { showToast('error', 'The browser blocked the book window. Allow pop-ups for this site and try again.'); return; }
        const showToc = history.filter((t) => t.type === 'ai').length > 5;
        let pageCount = 0;
        const tocHtml = history.map((turn, i) => {
            if (turn.type === 'ai') { pageCount++; return `<a href="#ch${i}" class="chapter-link">Page ${pageCount}</a>`; }
            return '';
        }).join('');
        const contentHtml = history.map((turn, i) => {
            if (turn.type === 'chapter_marker') return `<div class="chapter-marker"><h2>${escapeHtml(turn.title)}</h2><hr/></div>`;
            if (turn.type === 'ai') {
                const src = safeImageSrc(turn.image);
                const text = escapeHtml(turn.narrative || '').replace(/\n/g, '<br/>');
                return `<div id="ch${i}" class="story-turn">${src ? `<img src="${src}" class="turn-img" />` : ''}<div class="turn-text">${text}</div></div>`;
            }
            return '';
        }).join('');
        const title = escapeHtml(exportDetails.title);
        const author = escapeHtml(exportDetails.author);
        const doc = `<html><head><title>${title}</title><style>@media print { @page { margin: 2cm; size: A4; } body { font-family: 'Georgia', serif; } } body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1a1a1a; line-height: 1.6; } h1, h2 { text-align: center; } .turn-img { width: 100%; max-height: 400px; object-fit: contain; margin: 2em 0; display: block; border-radius: 4px; } .turn-text { margin-bottom: 2em; text-align: justify; } .chapter-marker { margin: 4em 0; text-align: center; page-break-before: always; } .toc { margin-top: 4em; page-break-after: always; } .chapter-link { display: block; padding: 0.5em 0; border-bottom: 1px dotted #ccc; text-decoration: none; color: black; } .story-turn { page-break-inside: avoid; margin-bottom: 2em; }</style></head><body><h1 style="margin-top:40vh">${title}</h1><h2>by ${author}</h2>${showToc ? `<div class="toc"><h1>Table of Contents</h1>${tocHtml}</div>` : '<div style="margin-bottom: 4em;"></div>'}${contentHtml}<scr` + `ipt>window.onload=()=>{setTimeout(()=>window.print(),1000);}</scr` + `ipt></body></html>`;
        bookWindow.document.write(doc);
        bookWindow.document.close();
    };

    const nextSlide = () => { if (currentSlideIndex < history.length - 1) setCurrentSlideIndex((c) => c + 1); };
    const prevSlide = () => { if (currentSlideIndex > 0) setCurrentSlideIndex((c) => c - 1); };
    const onTouchStart = (e) => { touchEnd.current = null; touchStart.current = e.targetTouches[0].clientX; };
    const onTouchMove = (e) => { touchEnd.current = e.targetTouches[0].clientX; };
    const onTouchEnd = () => {
        if (touchStart.current && touchEnd.current) {
            if (touchStart.current - touchEnd.current > minSwipeDistance) nextSlide();
            else if (touchStart.current - touchEnd.current < -minSwipeDistance) prevSlide();
        }
    };

    const currentTurnData = history[currentSlideIndex];
    let displayImage = currentTurnData?.image;
    let isBlurring = false;
    const isWaitingForImage = currentTurnData?.type === 'ai' && !currentTurnData.image && generatingAssets.image;
    if (isWaitingForImage) {
        for (let i = currentSlideIndex - 1; i >= 0; i--) {
            if (history[i]?.image) { displayImage = history[i].image; isBlurring = true; break; }
        }
    }
    const isLatestSlide = currentSlideIndex === history.length - 1;

    // Only computed while Settings is open: building the prompt scans the whole codex.
    const contextChars = useMemo(() => {
        if (activePanel !== 'settings') return 0;
        try {
            return buildSystemPrompt({
                config, initialContext, summary, codex, history, statsEnabled: prefs.statsEnabled, stats, scene, styleCard,
                pacing: prefs.pacing,
            }).length;
        } catch { return 0; }
    }, [activePanel, config, initialContext, summary, codex, history, prefs.statsEnabled, stats, scene, styleCard, prefs.pacing]);

    if (!apiKey) return html`<${ApiKeyModal} onSave=${handleKeySave} />`;

    const app = {
        view, config, setConfig, setupConfig, setSetupConfig, prefs, setPrefs, mediaStatus,
        availableModels, modelPrefs, setModelPrefs, modelListLoading, fetchModels,
        favorites, toggleFavorite, previewVoice, previewPlaying,
        initialContext, setInitialContext, status, loading,
        activePanel, togglePanel, clearApiKey,
        slots, currentSlotId, loadSlotById, deleteSlotById, renameSlotById, moveSlotById, importStory,
        startGame, resumeLatestStory,
        history, codex, summary, scene, stats, currentSlideIndex, currentTurnData, isLatestSlide,
        displayImage, isBlurring, generatingAssets, isPlaying, handleSpeak,
        userInput, setUserInput, handleTurn,
        isEnding, isFinished, turnsRemaining, initiateEnding, resumeStory,
        exportBook, exportStory, exportDetails, setExportDetails,
        showExportModal, setShowExportModal, showExitConfirm, setShowExitConfirm, confirmAbandon,
        selectedCodexEntry, setSelectedCodexEntry, setCurrentSlideIndex,
        saveCodexEdits, mergeSelectedInto, regenerateCodexPortrait,
        isStreaming, streamingText, editingAction, setEditingActionText, beginEditAction, cancelEditAction, submitEditAction,
        rewindTurn, regenerateTurn, goHome, toast, dismissToast, contextChars,
        recallStatus: getRecallState(),
        retryTurnImage, retryOpening, ensureCodexPortrait, downloadVerboseLog,
        textScrollRef, onTouchStart, onTouchMove, onTouchEnd, prevSlide, nextSlide,
    };

    if (view === 'setup') return html`<${SetupView} app=${app} />`;
    return html`<${GameView} app=${app} />`;
}
