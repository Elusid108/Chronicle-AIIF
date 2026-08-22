import { useState, useEffect, useRef } from 'react';
import { html } from './html.js';
import { DEFAULT_CONFIG, DEFAULT_CODEX, EMPTY_SCENE } from './constants.js';
import {
    STORAGE_KEYS, loadJSON, saveJSON, countPages,
    initStorage, readActiveSave, writeActiveSave, clearActiveSave, attachStoredImages,
    listSlots, saveToSlot, deleteSlot, loadSlot, exportStoryFile, importStoryFile,
    normalizeSummary,
} from './utils/storage.js';
import { fetchAvailableModels, generateImage, generateSpeech } from './api/gemini.js';
import { buildInitialPrompt, buildSystemPrompt } from './engine/prompt.js';
import { mergeCodexKeys, pinCodexEntry, scrubImagePrompt, updateCodexEntry } from './engine/memory.js';
import {
    EMPTY_SUMMARY, abortActiveTurn, lastAiIndex, processTurn, rebuildBase,
} from './engine/session.js';
import { revokeHistoryImages, snapshotImage } from './utils/images.js';
import { ACTIVE_SAVE_ID, copyImages, pruneTurnImages, putTurnImage } from './utils/idb.js';
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
};

export function App() {
    const [apiKey, setApiKey] = useState('');
    const [view, setView] = useState('setup');
    const [status, setStatus] = useState('');

    const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
    const [prefs, setPrefs] = useState({ ...DEFAULT_PREFS });
    const [mediaStatus, setMediaStatus] = useState({ images: 'active', audio: 'active' });

    const [availableModels, setAvailableModels] = useState({ text: [], image: [], audio: [] });
    const [modelPrefs, setModelPrefs] = useState({ textModel: '', imageModel: '', audioModel: '' });
    const [modelListLoading, setModelListLoading] = useState(false);

    const [favorites, setFavorites] = useState(() => loadJSON(STORAGE_KEYS.favVoices, []));

    const [initialContext, setInitialContext] = useState('');
    const [hasSavedGame, setHasSavedGame] = useState(false);
    const [savedPageCount, setSavedPageCount] = useState(0);
    const [activePanel, setActivePanel] = useState(null);
    const [slots, setSlots] = useState([]);

    const [showExportModal, setShowExportModal] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [showNewConfirm, setShowNewConfirm] = useState(false);
    const [exportDetails, setExportDetails] = useState({ title: 'The Unnamed Chronicle', author: 'Anonymous' });

    const [history, setHistory] = useState([]);
    const [codex, setCodex] = useState({ ...DEFAULT_CODEX });
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
    const playingTurnRef = useRef(null);
    const toastTimer = useRef(null);
    const abortRef = useRef(null);
    const snapshotRef = useRef({});

    const touchStart = useRef(null);
    const touchEnd = useRef(null);
    const minSwipeDistance = 50;
    const textScrollRef = useRef(null);

    snapshotRef.current = {
        history, codex, summary, stats, scene, styleCard, config, initialContext,
        prefs, isEnding, turnsRemaining, mediaStatus, apiKey, modelPrefs,
    };

    const showToast = (type, message) => {
        setToast({ type, message });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
    };

    useEffect(() => {
        const storedKey = localStorage.getItem(STORAGE_KEYS.apiKey);
        if (storedKey) setApiKey(storedKey);
        setPrefs((prev) => ({ ...prev, ...loadJSON(STORAGE_KEYS.prefs, {}) }));
        setModelPrefs((prev) => ({ ...prev, ...loadJSON(STORAGE_KEYS.modelPrefs, {}) }));
        (async () => {
            await initStorage();
            const save = await readActiveSave();
            if (save) {
                setHasSavedGame(true);
                setSavedPageCount(countPages(save.history));
            }
            setSlots(await listSlots());
        })();
    }, []);

    useEffect(() => { saveJSON(STORAGE_KEYS.prefs, prefs); }, [prefs]);
    useEffect(() => { saveJSON(STORAGE_KEYS.modelPrefs, modelPrefs); }, [modelPrefs]);
    useEffect(() => { saveJSON(STORAGE_KEYS.favVoices, favorites); }, [favorites]);

    useEffect(() => {
        if (apiKey && availableModels.text.length === 0) fetchModels();
    }, [apiKey]);

    useEffect(() => {
        if (history.length === 0) return;
        let cancelled = false;
        (async () => {
            await initStorage();
            if (cancelled) return;
            writeActiveSave({
                history, codex, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining,
                isFinished, exportDetails, config, initialContext, stats,
            });
        })();
        return () => { cancelled = true; };
    }, [history, codex, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining, isFinished, exportDetails, config, initialContext, stats]);

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
        const currentTurn = history[currentSlideIndex];
        if (view === 'game' && prefs.autoPlay && mediaStatus.audio !== 'disabled' && currentSlideIndex === history.length - 1 && currentTurn?.type === 'ai' && currentTurn.audio && !isPlaying && playingTurnRef.current !== currentTurn) {
            handleSpeak(currentTurn);
        }
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
        apiKey, modelPrefs, config, mediaStatus, setMediaStatus, setStatus,
        availableImageModels: (availableModels.image || []).map((m) => m.id),
    });
    const speechDeps = () => ({ apiKey, modelPrefs, prefs, mediaStatus, setMediaStatus, setStatus });

    const regenImageForIndex = (idx, turn) => {
        const scrubbed = scrubImagePrompt(turn.image_prompt, snapshotRef.current.codex);
        generateImage(imageDeps(), scrubbed).then(async (imageResult) => {
            if (!imageResult.image) return;
            const snapshotted = await snapshotImage(imageResult.image);
            const url = snapshotted.url || imageResult.image;
            setHistory((prev) => {
                const updated = [...prev];
                if (updated[idx] && updated[idx].narrative === turn.narrative) updated[idx] = { ...updated[idx], image: url };
                return updated;
            });
            if (snapshotted.blob && (snapshotRef.current.prefs.keepLastNImages || 0) > 0) {
                try {
                    await putTurnImage(ACTIVE_SAVE_ID, idx, snapshotted.blob);
                    await pruneTurnImages(ACTIVE_SAVE_ID, snapshotRef.current.prefs.keepLastNImages);
                } catch { /* ignore */ }
            }
        });
    };

    const stopAudio = () => {
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setIsPlaying(false); setPreviewPlaying(false); playingTurnRef.current = null;
    };

    const handleSpeak = async (turn) => {
        if (!turn) return;
        if (isPlaying && playingTurnRef.current === turn) { stopAudio(); return; }
        stopAudio();
        playingTurnRef.current = turn;
        setIsPlaying(true);

        let audioContent = turn.audio;
        if (!audioContent) {
            const result = await generateSpeech(speechDeps(), turn.narrative || '');
            audioContent = result.audio;
            if (audioContent) setHistory((prev) => prev.map((t) => (t === turn ? { ...t, audio: audioContent, stats: { ...t.stats, audio: result.stats } } : t)));
        }

        if (audioContent === 'browser_tts') {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance('... ' + (turn.narrative || ''));
                utterance.rate = 1.0; utterance.pitch = 1.0;
                utterance.onend = () => { setIsPlaying(false); playingTurnRef.current = null; };
                setTimeout(() => window.speechSynthesis.speak(utterance), 250);
            } else { setIsPlaying(false); playingTurnRef.current = null; }
        } else if (audioContent) {
            const audio = new Audio(URL.createObjectURL(audioContent));
            audioRef.current = audio;
            audio.play();
            audio.onended = () => { setIsPlaying(false); playingTurnRef.current = null; };
        } else { setIsPlaying(false); playingTurnRef.current = null; }
    };

    const previewVoice = async (voiceName) => {
        stopAudio(); setPreviewPlaying(true);
        const result = await generateSpeech(speechDeps(), 'I would love to be your narrator.', voiceName);
        if (result.audio && result.audio !== 'browser_tts') {
            const audio = new Audio(URL.createObjectURL(result.audio));
            audioRef.current = audio;
            audio.play();
            audio.onended = () => setPreviewPlaying(false);
        } else { setPreviewPlaying(false); }
    };

    const toggleFavorite = (v, e) => { e.stopPropagation(); setFavorites((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v])); };

    const turnIo = () => ({
        abortRef,
        getSnapshot: () => snapshotRef.current,
        stopAudio,
        showToast,
        setView, setLoading, setIsStreaming, setStreamingText, setStatus, setToast,
        setCodex, setSummary, setStats, setScene, setStyleCard, setHistory, setCurrentSlideIndex,
        setGeneratingAssets, setTurnsRemaining, setIsFinished, setExportDetails, setUserInput,
        textDeps, imageDeps, speechDeps,
    });

    const runTurn = (promptType, inputVal, base) => processTurn(turnIo(), promptType, inputVal, base);

    const startGame = async () => {
        abortActiveTurn(abortRef);
        revokeHistoryImages(history);
        await initStorage();
        await clearActiveSave();
        setHasSavedGame(false);
        setSavedPageCount(0);
        setHistory([]);
        setCodex({ ...DEFAULT_CODEX });
        setSummary({ ...EMPTY_SUMMARY });
        setScene({ ...EMPTY_SCENE });
        setStyleCard('');
        setStats({});
        setCurrentSlideIndex(0);
        setIsEnding(false); setTurnsRemaining(null); setIsFinished(false);
        runTurn('initial', buildInitialPrompt(config, initialContext), {
            history: [], codex: { ...DEFAULT_CODEX }, summary: { ...EMPTY_SUMMARY }, stats: {}, scene: { ...EMPTY_SCENE },
        });
    };

    const handleTurn = (input) => { if (input && input.trim()) runTurn('continue', input); };

    const applyBase = (b) => {
        revokeHistoryImages(history.slice(b.history.length));
        setHistory(b.history);
        setCodex(b.codex);
        setSummary(b.summary);
        setStats(b.stats);
        setScene(b.scene || { ...EMPTY_SCENE });
        if (b.styleCard !== undefined) setStyleCard(b.styleCard);
        setCurrentSlideIndex(Math.max(0, b.history.length - 1));
        setIsFinished(false); setIsEnding(false); setTurnsRemaining(null);
    };

    const rewindTurn = () => {
        const idx = lastAiIndex(history);
        if (idx <= 0) return;
        abortActiveTurn(abortRef);
        stopAudio();
        applyBase(rebuildBase(history.slice(0, idx), summary));
        showToast('info', 'Rewound one turn');
    };

    const regenerateTurn = () => {
        const idx = lastAiIndex(history);
        if (idx < 0) return;
        const lastTurn = history[idx];
        abortActiveTurn(abortRef);
        stopAudio();
        const remaining = history.slice(0, idx);
        const base = rebuildBase(remaining, summary);
        applyBase(base);
        if (lastTurn.userActionPreceding == null) {
            setStyleCard('');
            runTurn('initial', buildInitialPrompt(config, initialContext), {
                history: [], codex: { ...DEFAULT_CODEX }, summary: { ...EMPTY_SUMMARY }, stats: {}, scene: { ...EMPTY_SCENE },
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
        stopAudio();
        const base = rebuildBase(history.slice(0, idx), summary);
        applyBase(base);
        setEditingAction(null);
        runTurn('continue', text, base);
    };

    const initiateEnding = () => setShowEndConfirm(true);
    const confirmEndingSequence = () => {
        const remaining = Math.max(1, Number(prefs.endingLength) || 5);
        // #region agent log
        fetch('http://127.0.0.1:7332/ingest/448c3e2d-77b0-4a98-ab42-11af332cc836',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7f2b38'},body:JSON.stringify({sessionId:'7f2b38',location:'src/App.js:confirmEndingSequence',message:'confirm-ending',data:{endingLength:remaining,histLen:history.length,autoStart:true},hypothesisId:'C',timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
        // #endregion
        snapshotRef.current = { ...snapshotRef.current, isEnding: true, turnsRemaining: remaining };
        setShowEndConfirm(false);
        setIsEnding(true);
        setTurnsRemaining(remaining);
        runTurn('continue', 'The tale now turns toward its ending. Begin the finale.');
    };
    const resumeStory = () => {
        setIsEnding(false); setIsFinished(false); setTurnsRemaining(null);
        const lastTurn = history[history.length - 1];
        if (lastTurn && lastTurn.type !== 'chapter_marker') {
            setHistory((prev) => [...prev, { type: 'chapter_marker', title: 'New Chapter' }]);
            setCurrentSlideIndex((prev) => prev + 1);
        }
    };

    const resetGame = async () => {
        abortActiveTurn(abortRef);
        revokeHistoryImages(history);
        await initStorage();
        await clearActiveSave();
        setHasSavedGame(false); setSavedPageCount(0);
        setHistory([]); setCodex({ ...DEFAULT_CODEX }); setCurrentSlideIndex(0);
        setSummary({ ...EMPTY_SUMMARY }); setScene({ ...EMPTY_SCENE }); setStyleCard(''); setStats({}); setUserInput('');
        setIsEnding(false); setTurnsRemaining(null); setIsFinished(false);
        setLoading(false); setIsStreaming(false); setStreamingText('');
        setGeneratingAssets({ image: false, audio: false }); setStatus('');
        setInitialContext(''); setExportDetails({ title: 'The Unnamed Chronicle', author: 'Anonymous' });
        setMediaStatus({ images: 'active', audio: 'active' });
        stopAudio(); setActivePanel(null); setEditingAction(null);
    };

    const goHome = () => {
        stopAudio();
        setSavedPageCount(countPages(history));
        if (history.length > 0) setHasSavedGame(true);
        setView('setup');
        setActivePanel(null);
    };
    const confirmAbandon = () => { setShowExitConfirm(false); resetGame(); setView('setup'); };

    const clearApiKey = () => {
        showToast('info', 'API key cleared');
        localStorage.removeItem(STORAGE_KEYS.apiKey);
        setApiKey('');
        togglePanel(null);
    };

    const saveCodexEdits = (category, key, patch) => {
        setCodex((prev) => {
            const next = updateCodexEntry(prev, category, key, patch);
            const data = next[category]?.[key];
            setSelectedCodexEntry((sel) => (sel && sel.category === category && sel.title === key ? { ...sel, data } : sel));
            return next;
        });
    };

    const toggleCodexPin = (category, key) => {
        setCodex((prev) => {
            const current = prev[category]?.[key];
            const next = pinCodexEntry(prev, category, key, !(current && current.pinned));
            const data = next[category]?.[key];
            setSelectedCodexEntry((sel) => (sel && sel.category === category && sel.title === key ? { ...sel, data } : sel));
            return next;
        });
    };

    const mergeSelectedInto = (intoKey) => {
        const sel = selectedCodexEntry;
        if (!sel || !intoKey || intoKey === sel.title) return;
        setCodex((prev) => {
            const next = mergeCodexKeys(prev, sel.category, sel.title, intoKey);
            setSelectedCodexEntry(null);
            return next;
        });
    };

    const hydrate = async (s, imageSaveId = ACTIVE_SAVE_ID) => {
        revokeHistoryImages(history);
        const withImages = await attachStoredImages(s, imageSaveId);
        setHistory(withImages.history);
        setCodex(withImages.codex);
        setSummary(normalizeSummary(withImages.summary));
        setScene(withImages.scene || { ...EMPTY_SCENE });
        setStyleCard(withImages.styleCard || '');
        setStats(withImages.stats || {});
        setCurrentSlideIndex(withImages.currentSlideIndex);
        setIsEnding(withImages.isEnding); setTurnsRemaining(withImages.turnsRemaining); setIsFinished(withImages.isFinished);
        setExportDetails(withImages.exportDetails);
        setConfig({ ...DEFAULT_CONFIG, ...withImages.config });
        setInitialContext(withImages.initialContext);
        setView('game'); setActivePanel(null);
        if (imageSaveId && imageSaveId !== ACTIVE_SAVE_ID) {
            try { await copyImages(imageSaveId, ACTIVE_SAVE_ID, snapshotRef.current.prefs.keepLastNImages || 0); } catch { /* ignore */ }
        }
        withImages.history.forEach((turn, idx) => {
            if (turn.type === 'ai' && turn.image_prompt && !turn.image) regenImageForIndex(idx, turn);
        });
    };

    const resumeSavedGame = async () => {
        await initStorage();
        const s = await readActiveSave();
        if (!s) { showToast('error', 'No saved story found'); return; }
        await hydrate(s, ACTIVE_SAVE_ID);
    };

    const refreshSlots = async () => setSlots(await listSlots());
    const saveSnapshot = async () => {
        await initStorage();
        const name = `${exportDetails.title} (${countPages(history)}p)`;
        await saveToSlot(name, {
            history, codex, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining,
            isFinished, exportDetails, config, initialContext, stats,
        }, prefs.keepLastNImages || 0);
        await refreshSlots();
        showToast('info', 'Saved to Library');
    };
    const loadSlotById = async (id) => {
        const s = await loadSlot(id);
        if (!s) { showToast('error', 'Could not load save'); return; }
        await hydrate(s, id);
    };
    const deleteSlotById = async (id) => { await deleteSlot(id); await refreshSlots(); };
    const exportStory = () => {
        exportStoryFile({
            history, codex, summary, scene, styleCard, currentSlideIndex, isEnding, turnsRemaining,
            isFinished, exportDetails, config, initialContext, stats,
        });
        showToast('info', 'Story exported');
    };
    const importStory = async (file) => {
        try {
            const s = await importStoryFile(file);
            await hydrate(s, null);
            showToast('info', 'Story imported');
        } catch (e) {
            showToast('error', `Import failed: ${e.message}`);
        }
    };

    const exportBook = () => {
        const bookWindow = window.open('', '_blank');
        const showToc = history.filter((t) => t.type === 'ai').length > 5;
        let pageCount = 0;
        const tocHtml = history.map((turn, i) => {
            if (turn.type === 'ai') { pageCount++; return `<a href="#ch${i}" class="chapter-link">Page ${pageCount}</a>`; }
            return '';
        }).join('');
        const contentHtml = history.map((turn, i) => {
            if (turn.type === 'chapter_marker') return `<div class="chapter-marker"><h2>${turn.title}</h2><hr/></div>`;
            if (turn.type === 'ai') return `<div id="ch${i}" class="story-turn">${turn.image ? `<img src="${turn.image}" class="turn-img" />` : ''}<div class="turn-text">${(turn.narrative || '').replace(/\n/g, '<br/>')}</div></div>`;
            return '';
        }).join('');
        const doc = `<html><head><title>${exportDetails.title}</title><style>@media print { @page { margin: 2cm; size: A4; } body { font-family: 'Georgia', serif; } } body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1a1a1a; line-height: 1.6; } h1, h2 { text-align: center; } .turn-img { width: 100%; max-height: 400px; object-fit: contain; margin: 2em 0; display: block; border-radius: 4px; } .turn-text { margin-bottom: 2em; text-align: justify; } .chapter-marker { margin: 4em 0; text-align: center; page-break-before: always; } .toc { margin-top: 4em; page-break-after: always; } .chapter-link { display: block; padding: 0.5em 0; border-bottom: 1px dotted #ccc; text-decoration: none; color: black; } .story-turn { page-break-inside: avoid; margin-bottom: 2em; }</style></head><body><h1 style="margin-top:40vh">${exportDetails.title}</h1><h2>by ${exportDetails.author}</h2>${showToc ? `<div class="toc"><h1>Table of Contents</h1>${tocHtml}</div>` : '<div style="margin-bottom: 4em;"></div>'}${contentHtml}<scr` + `ipt>window.onload=()=>{setTimeout(()=>window.print(),1000);}</scr` + `ipt></body></html>`;
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

    const contextChars = buildSystemPrompt({
        config, initialContext, summary, codex, history, statsEnabled: prefs.statsEnabled, stats, scene, styleCard,
    }).length;

    if (!apiKey) return html`<${ApiKeyModal} onSave=${handleKeySave} />`;

    const app = {
        config, setConfig, prefs, setPrefs, mediaStatus,
        availableModels, modelPrefs, setModelPrefs, modelListLoading, fetchModels,
        favorites, toggleFavorite, previewVoice, previewPlaying,
        initialContext, setInitialContext, status, loading,
        hasSavedGame, savedPageCount, activePanel, togglePanel, clearApiKey,
        slots, loadSlotById, deleteSlotById, importStory, saveSnapshot,
        showNewConfirm, setShowNewConfirm, startGame, resumeSavedGame,
        history, codex, summary, scene, stats, currentSlideIndex, currentTurnData, isLatestSlide,
        displayImage, isBlurring, generatingAssets, isPlaying, handleSpeak,
        userInput, setUserInput, handleTurn,
        isEnding, isFinished, turnsRemaining, initiateEnding, resumeStory, confirmEndingSequence,
        exportBook, exportStory, exportDetails, setExportDetails,
        showExportModal, setShowExportModal, showExitConfirm, setShowExitConfirm, showEndConfirm, setShowEndConfirm, confirmAbandon,
        selectedCodexEntry, setSelectedCodexEntry, setCurrentSlideIndex,
        saveCodexEdits, toggleCodexPin, mergeSelectedInto,
        isStreaming, streamingText, editingAction, setEditingActionText, beginEditAction, cancelEditAction, submitEditAction,
        rewindTurn, regenerateTurn, goHome, toast, contextChars,
        textScrollRef, onTouchStart, onTouchMove, onTouchEnd, prevSlide, nextSlide,
    };

    if (view === 'setup') return html`<${SetupView} app=${app} />`;
    return html`<${GameView} app=${app} />`;
}
