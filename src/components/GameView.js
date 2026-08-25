import { useState } from 'react';
import { html } from '../html.js';
import {
    Home, Flag, RefreshCw, Printer, Settings, BookOpen, FileText, ChevronLeft, ChevronRight,
    Palette, Sparkles, Volume2, VolumeX, Bookmark, CornerDownRight, Send, Undo2, Pencil, X, Book, Download, AlertTriangle, Heart, MoreVertical,
} from 'lucide-react';
import { Button, Input, Toast } from './ui.js';
import { SettingsPanel } from './SettingsPanel.js';
import { SidePanel, CodexEntryModal } from './Panels.js';

function StatHud({ stats }) {
    const keys = Object.keys(stats || {});
    if (!keys.length) return null;
    return html`
        <div className="flex flex-wrap gap-2 justify-center mb-4">
            ${keys.map((k) => html`
                <div key=${k} className="flex items-center gap-1.5 bg-gray-900/80 border border-gray-700 rounded-full px-3 py-1 text-[11px]">
                    <${Heart} size=${10} className="text-blue-400" />
                    <span className="text-gray-500 uppercase tracking-wide">${k}</span>
                    <span className="text-gray-200 font-bold">${String(stats[k])}</span>
                </div>
            `)}
        </div>
    `;
}

export function GameView({ app }) {
    const {
        config, prefs, history, currentSlideIndex, currentTurnData, isLatestSlide,
        displayImage, isBlurring, generatingAssets, mediaStatus, isPlaying, loading, status,
        isEnding, isFinished, turnsRemaining, userInput, setUserInput, activePanel, stats,
        isStreaming, streamingText, editingAction, selectedCodexEntry,
        showExportModal, showExitConfirm, showEndConfirm, exportDetails, setExportDetails, toast, dismissToast,
        textScrollRef, onTouchStart, onTouchMove, onTouchEnd,
        prevSlide, nextSlide, setCurrentSlideIndex, goHome, togglePanel, handleSpeak, handleTurn,
        initiateEnding, resumeStory, exportBook, exportStory, rewindTurn, regenerateTurn,
        beginEditAction, cancelEditAction, submitEditAction, setEditingActionText,
        setShowExportModal, setShowExitConfirm, setShowEndConfirm, confirmEndingSequence,
        retryTurnImage, retryOpening,
    } = app;

    const [moreOpen, setMoreOpen] = useState(false);
    const settingLabel = config.setting === 'custom' ? config.settingCustom : config.setting;
    const canRewind = !isStreaming && !loading && history.filter(t => t.type === 'ai').length > 1;
    const openPanel = (name) => {
        setMoreOpen(false);
        togglePanel(name);
    };
    const openEnd = () => {
        setMoreOpen(false);
        initiateEnding();
    };

    return html`
        <div className="w-full flex flex-col md:flex-row bg-black text-gray-200 font-sans overflow-hidden" style=${{ height: 'var(--app-height, 100svh)' }} onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd}>
            <style>${`
                .font-serif { font-family: 'Merriweather', serif; }
                .font-display { font-family: 'Cinzel', serif; }
                .nebula-loader { background: linear-gradient(-45deg, #0f172a, #1e1b4b, #312e81, #0f172a); background-size: 400% 400%; animation: nebula 10s ease infinite; }
                @keyframes nebula { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
                .nebula-pulse { animation: pulse 2s infinite; }
                @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
                .blur-loading { filter: blur(12px) brightness(0.6); transition: filter 1s ease; }
            `}</style>

            <div className="flex-1 flex flex-col min-h-0 relative z-10 bg-black min-w-0">
                <div className="h-12 border-b border-gray-800 bg-gray-950 flex items-center justify-between px-3 md:px-4 shrink-0 z-20 relative">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <button onClick=${goHome} className="text-gray-500 hover:text-white p-2" title="Home"><${Home} size=${18} /></button>
                        ${canRewind && html`<button onClick=${rewindTurn} className="text-gray-500 hover:text-white p-2" title="Rewind one turn"><${Undo2} size=${16} /></button>`}
                        <div className="text-gray-500 text-[10px] md:text-xs font-bold tracking-widest uppercase truncate max-w-[72px] md:max-w-none">${settingLabel}</div>
                    </div>
                    <div className="text-[10px] md:text-xs text-gray-500 uppercase tracking-widest font-bold font-sans shrink-0 px-1 tabular-nums">
                        <span className="md:hidden">${currentSlideIndex + 1}/${history.length || 1}</span>
                        <span className="hidden md:inline">Page ${currentSlideIndex + 1} of ${history.length || 1}</span>
                    </div>
                    <div className="flex gap-1 items-center">
                        ${isEnding && !isFinished && html`<div className="text-[10px] md:text-xs text-red-500 font-bold tracking-widest animate-pulse mr-1">END: ${turnsRemaining}</div>`}
                        ${isFinished && html`
                            <button onClick=${resumeStory} className="hidden md:flex text-xs bg-blue-900/30 text-blue-400 border border-blue-900/50 px-3 py-1 rounded hover:bg-blue-900/50 items-center gap-2"><${RefreshCw} size=${12} /> Resume</button>
                            <button onClick=${() => setShowExportModal(true)} className="hidden md:flex text-xs bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 px-3 py-1 rounded hover:bg-emerald-900/50 items-center gap-2"><${Printer} size=${12} /> Book</button>
                        `}
                        ${!isEnding && !isFinished && history.length > 0 && html`<button onClick=${initiateEnding} className="hidden md:flex text-xs bg-red-900/30 text-red-400 border border-red-900/50 px-3 py-1 rounded hover:bg-red-900/50 items-center gap-2"><${Flag} size=${12} /> End</button>`}
                        <button onClick=${() => togglePanel('settings')} className=${`hidden md:block p-1.5 rounded hover:bg-gray-800 ${activePanel === 'settings' ? 'text-blue-400' : 'text-gray-500'}`} title="Settings"><${Settings} size=${16} /></button>
                        <button onClick=${() => togglePanel('codex')} className=${`hidden md:block p-1.5 rounded hover:bg-gray-800 ${activePanel === 'codex' ? 'text-blue-400' : 'text-gray-500'}`} title="Codex"><${BookOpen} size=${16} /></button>
                        <button onClick=${() => togglePanel('summary')} className=${`hidden md:block p-1.5 rounded hover:bg-gray-800 ${activePanel === 'summary' ? 'text-blue-400' : 'text-gray-500'}`} title="Summary"><${FileText} size=${16} /></button>
                        <div className="relative md:hidden">
                            <button onClick=${() => setMoreOpen((o) => !o)} className=${`p-2 rounded hover:bg-gray-800 ${moreOpen || activePanel ? 'text-blue-400' : 'text-gray-500'}`} title="More"><${MoreVertical} size=${18} /></button>
                            ${moreOpen && html`
                                <div className="fixed inset-0 z-40" onClick=${() => setMoreOpen(false)}></div>
                                <div className="absolute right-0 top-full mt-1 w-48 bg-gray-900 border border-gray-800 rounded-lg shadow-2xl z-50 py-1">
                                    <button onClick=${() => openPanel('settings')} className="w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"><${Settings} size=${14} /> Settings</button>
                                    <button onClick=${() => openPanel('codex')} className="w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"><${BookOpen} size=${14} /> Codex</button>
                                    <button onClick=${() => openPanel('summary')} className="w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"><${FileText} size=${14} /> Log</button>
                                    ${isFinished && html`
                                        <button onClick=${() => { setMoreOpen(false); resumeStory(); }} className="w-full text-left px-3 py-2.5 text-sm text-blue-300 hover:bg-gray-800 flex items-center gap-2"><${RefreshCw} size=${14} /> Resume</button>
                                        <button onClick=${() => { setMoreOpen(false); setShowExportModal(true); }} className="w-full text-left px-3 py-2.5 text-sm text-emerald-300 hover:bg-gray-800 flex items-center gap-2"><${Printer} size=${14} /> Book</button>
                                    `}
                                    ${!isEnding && !isFinished && history.length > 0 && html`<button onClick=${openEnd} className="w-full text-left px-3 py-2.5 text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2"><${Flag} size=${14} /> End story</button>`}
                                </div>
                            `}
                        </div>
                    </div>
                </div>

                <div className="bg-black border-b border-gray-900 relative min-h-0 overflow-hidden group" style=${{ flex: '0 1 auto', height: 'min(32vh, calc(var(--app-height, 100svh) * 0.32))', maxHeight: 'calc(var(--app-height, 100svh) * 0.32)' }}>
                    ${(isStreaming || (currentTurnData && currentTurnData.type === 'ai')) ? (
                        (!isStreaming && displayImage) ? html`
                            <div className="w-full h-full relative">
                                <img src=${displayImage} alt="Scene" className=${`w-full h-full object-contain mx-auto bg-black ${isBlurring ? 'blur-loading' : 'animate-in fade-in'}`} />
                                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_50%,rgba(0,0,0,0.4)_100%)]"></div>
                                ${isBlurring && html`
                                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                                        <${Palette} size=${32} className="text-blue-300 animate-bounce mb-2" />
                                        <span className="text-xs text-blue-200 font-display uppercase tracking-widest text-shadow-lg">Painting...</span>
                                    </div>
                                `}
                            </div>
                        ` : html`
                            <div className="w-full h-full flex flex-col items-center justify-center text-blue-200 gap-4 nebula-loader relative">
                                <${Sparkles} size=${48} className="nebula-pulse opacity-80" />
                                <span className="text-xs uppercase tracking-[0.3em] font-bold opacity-80 text-shadow-lg">
                                    ${mediaStatus.images === 'disabled' ? 'VISUALS OFFLINE' : (isStreaming ? 'Writing the Scene...' : (generatingAssets.image ? 'Manifesting Reality...' : 'No scene image'))}
                                </span>
                                ${!isStreaming && !generatingAssets.image && mediaStatus.images !== 'disabled' && currentTurnData?.image_prompt && html`
                                    <button onClick=${retryTurnImage} className="z-10 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold bg-black/50 border border-blue-500/40 text-blue-200 rounded hover:bg-black/70 flex items-center gap-2">
                                        <${RefreshCw} size=${12} /> Retry image
                                    </button>
                                `}
                            </div>
                        `
                    ) : html`<div className="w-full h-full flex items-center justify-center text-gray-800"><span className="animate-pulse">Waiting...</span></div>`}

                    <div className="absolute bottom-4 left-4 z-20"><${Button} variant="secondary" onClick=${prevSlide} disabled=${currentSlideIndex === 0 || isStreaming} className="w-10 h-10 rounded-full !p-0 shadow-xl"><${ChevronLeft} size=${20} /><//></div>
                    <div className="absolute bottom-4 right-4 z-20"><${Button} variant="secondary" onClick=${nextSlide} disabled=${currentSlideIndex === history.length - 1 || isStreaming} className="w-10 h-10 rounded-full !p-0 shadow-xl"><${ChevronRight} size=${20} /><//></div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 relative">
                    ${isStreaming ? html`
                        <div className="flex-1 overflow-y-auto bg-black px-6 pt-6 pb-6 md:p-8 custom-scrollbar">
                            <div className="max-w-3xl mx-auto flex flex-col items-center text-center">
                                ${prefs.statsEnabled && html`<${StatHud} stats=${stats} />`}
                                <div className="prose prose-invert w-full">
                                    ${(streamingText || '').split('\n').filter(Boolean).map((line, i) => html`<p key=${i} className=${`mb-4 leading-relaxed text-gray-300 font-serif ${prefs.narrativeSize || 'text-lg'}`}>${line}</p>`)}
                                    <span className="inline-block w-2 h-5 bg-blue-400 animate-pulse align-middle"></span>
                                </div>
                            </div>
                        </div>
                    ` : (currentTurnData && currentTurnData.type === 'ai') ? html`
                        <div className="absolute top-2 right-3 md:top-4 md:right-6 z-30 flex gap-1.5 md:gap-2">
                            ${isLatestSlide && !isFinished && !loading && html`
                                <button onClick=${regenerateTurn} className="p-2 md:p-3 rounded-full shadow-lg bg-black/60 text-gray-400 border border-gray-700 hover:text-white hover:bg-black/80 backdrop-blur-md" title="Regenerate this turn"><${RefreshCw} size=${16} /></button>
                                <button onClick=${beginEditAction} className="p-2 md:p-3 rounded-full shadow-lg bg-black/60 text-gray-400 border border-gray-700 hover:text-white hover:bg-black/80 backdrop-blur-md" title="Edit your last action"><${Pencil} size=${16} /></button>
                            `}
                            <button onClick=${() => handleSpeak(currentTurnData)} className=${`p-2 md:p-3 rounded-full shadow-lg transition-all duration-300 backdrop-blur-md border ${isPlaying ? 'bg-blue-600/90 text-white border-blue-400 scale-110' : 'bg-black/60 text-gray-400 border-gray-700 hover:text-white hover:bg-black/80'} ${(generatingAssets.audio && !currentTurnData.audio) || mediaStatus.audio === 'disabled' ? 'opacity-50 cursor-not-allowed' : ''}`} disabled=${(generatingAssets.audio && !currentTurnData.audio) || mediaStatus.audio === 'disabled'}>
                                ${isPlaying ? html`<${VolumeX} size=${18} />` : html`<${Volume2} size=${18} />`}
                            </button>
                        </div>
                        <div ref=${textScrollRef} className="flex-1 overflow-y-auto bg-black px-6 pt-14 pb-6 md:p-8 custom-scrollbar">
                            <div className="max-w-3xl mx-auto flex flex-col items-center text-center">
                                ${prefs.statsEnabled && isLatestSlide && html`<${StatHud} stats=${stats} />`}
                                <div className="prose prose-invert prose-p:text-gray-300 prose-p:font-serif prose-p:leading-loose w-full">
                                    ${(currentTurnData.narrative || '').split('\n').map((line, i) => html`<p key=${i} className=${`mb-4 leading-relaxed text-gray-300 font-serif ${prefs.narrativeSize || 'text-lg'}`}>${line}</p>`)}
                                </div>
                            </div>
                        </div>
                    ` : (currentTurnData && currentTurnData.type === 'chapter_marker') ? html`
                        <div className="flex-1 flex flex-col items-center justify-center bg-black p-8">
                            <div className="text-center animate-in fade-in zoom-in duration-700">
                                <div className="inline-block p-4 rounded-full border border-blue-900/30 bg-blue-900/10 mb-4"><${Bookmark} size=${32} className="text-blue-500" /></div>
                                <h2 className="text-3xl font-display font-bold text-white mb-2 tracking-widest">${currentTurnData.title}</h2>
                                <p className="text-gray-500 font-serif italic">The journey continues...</p>
                            </div>
                        </div>
                    ` : (history.length === 0 && !loading) ? html`
                        <div className="flex-1 flex flex-col items-center justify-center bg-black p-8 gap-3">
                            <p className="text-gray-500 text-sm">The opening page did not arrive.</p>
                            ${retryOpening && html`
                                <button onClick=${retryOpening} className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold bg-black/50 border border-blue-500/40 text-blue-200 rounded hover:bg-black/70 flex items-center gap-2">
                                    <${RefreshCw} size=${12} /> Retry opening
                                </button>
                            `}
                        </div>
                    ` : null}
                </div>

                <div className="shrink-0 bg-black border-t border-gray-900 p-3 md:p-6 z-20 relative" style=${{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                    <div className="max-w-3xl mx-auto w-full">
                        ${editingAction != null ? html`
                            <div className="animate-in fade-in slide-in-from-bottom-2">
                                <label className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-2 block">Edit your action & regenerate</label>
                                <div className="flex gap-2">
                                    <${Input} value=${editingAction} onChange=${(e) => setEditingActionText(e.target.value)} placeholder="Revise what you do..." onKeyDown=${(e) => e.key === 'Enter' && editingAction.trim() && submitEditAction()} />
                                    <${Button} onClick=${submitEditAction} disabled=${!editingAction.trim()} className="shrink-0"><${RefreshCw} size=${14} /><//>
                                    <${Button} variant="secondary" onClick=${cancelEditAction} className="shrink-0"><${X} size=${14} /><//>
                                </div>
                            </div>
                        ` : (isLatestSlide && !loading && !isStreaming && !isFinished && currentTurnData?.type === 'ai') ? html`
                            <div className="animate-in fade-in slide-in-from-bottom-2">
                                ${config.mode !== 'text' && currentTurnData?.choices?.length > 0 ? html`
                                    <div className="grid grid-cols-2 gap-2">${currentTurnData.choices.slice(0, 4).map((choice, i) => html`<button key=${i} onClick=${() => handleTurn(choice)} className="p-2 text-left bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-blue-500/50 rounded-lg text-gray-300 transition-all min-h-[2.75rem] flex items-start font-sans text-xs md:text-sm whitespace-normal break-words"><span className="font-bold text-blue-500 mr-1.5 shrink-0">${i + 1}.</span> <span className="min-w-0">${choice}</span></button>`)}</div>
                                ` : null}
                                ${(config.mode === 'text' || !currentTurnData?.choices?.length) && html`
                                    <div className="flex gap-2">
                                        <${Input} value=${userInput} onChange=${(e) => setUserInput(e.target.value)} placeholder="What do you do next?" onKeyDown=${(e) => e.key === 'Enter' && userInput && handleTurn(userInput)} disabled=${loading} />
                                        <${Button} onClick=${() => handleTurn(userInput)} disabled=${!userInput || loading} className="shrink-0"><${Send} size=${14} /><//>
                                    </div>
                                `}
                            </div>
                        ` : null}

                        ${isLatestSlide && !loading && !isStreaming && !isFinished && currentTurnData?.type === 'chapter_marker' && html`
                            <div className="flex justify-center animate-in fade-in slide-in-from-bottom-2">
                                <${Button} onClick=${() => handleTurn('Continue the journey.')} className="px-8 py-3 text-lg">Begin Next Chapter<//>
                            </div>
                        `}

                        ${(loading || isStreaming) && html`<div className="text-center text-xs text-blue-400 font-mono animate-pulse">${isStreaming ? 'Writing...' : status}</div>`}
                        ${!loading && !isStreaming && (generatingAssets.image || generatingAssets.audio) && html`
                            <div className="text-center text-xs text-blue-400/50 italic animate-pulse font-mono">
                                ${generatingAssets.image && generatingAssets.audio ? 'Generating Image & Audio...' : generatingAssets.image ? 'Generating Image...' : 'Synthesizing Audio...'}
                            </div>
                        `}
                        ${history.length > 0 && !isLatestSlide && !isStreaming && html`
                            <div className="flex justify-center"><button onClick=${() => setCurrentSlideIndex(history.length - 1)} className="text-xs bg-gray-900 hover:bg-gray-800 text-blue-400 border border-blue-900/50 px-4 py-2 rounded-full flex items-center gap-2 transition-all shadow-lg hover:shadow-blue-900/20"><${CornerDownRight} size=${14} /> Jump to Present</button></div>
                        `}
                        ${isFinished && !isStreaming && html`<div className="text-center text-sm text-blue-400 font-bold uppercase tracking-widest font-sans">Simulation Complete</div>`}
                    </div>
                </div>

                ${activePanel === 'settings' && html`<${SettingsPanel} app=${app} />`}
                <${SidePanel} app=${app} />
                <${CodexEntryModal} app=${app} />

                ${showExportModal && html`
                    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
                        <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-2xl">
                            <div className="flex justify-between items-center mb-6"><h3 className="text-lg font-bold text-white flex items-center gap-2"><${Book} size=${20} /> Finalize Chronicle</h3><button onClick=${() => setShowExportModal(false)}><${X} size=${20} className="text-gray-500 hover:text-white" /></button></div>
                            <div className="space-y-4 mb-6">
                                <div><label className="text-xs uppercase text-blue-400 font-bold block mb-2 font-sans">Book Title</label><${Input} value=${exportDetails.title} onChange=${(e) => setExportDetails({ ...exportDetails, title: e.target.value })} className="bg-black/50" /></div>
                                <div><label className="text-xs uppercase text-blue-400 font-bold block mb-2 font-sans">Author Name</label><${Input} value=${exportDetails.author} onChange=${(e) => setExportDetails({ ...exportDetails, author: e.target.value })} className="bg-black/50" /></div>
                            </div>
                            <${Button} onClick=${() => { setShowExportModal(false); exportBook(); }} className="w-full py-3 text-base"><${Download} size=${18} /> Generate PDF Document<//>
                            <button onClick=${() => { setShowExportModal(false); exportStory(); }} className="w-full mt-3 text-xs text-gray-500 hover:text-blue-400 transition-colors flex items-center justify-center gap-1"><${Download} size=${12} /> Export story data (.json)</button>
                        </div>
                    </div>
                `}
                ${showExitConfirm && html`
                    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
                        <div className="w-full max-w-sm bg-gray-900 border border-red-900/50 rounded-xl p-6 text-center">
                            <${AlertTriangle} size=${32} className="text-red-500 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-white mb-2">Abandon Simulation?</h3>
                            <p className="text-gray-400 text-sm mb-6">Your current narrative path will be lost.</p>
                            <div className="flex gap-3 justify-center">
                                <${Button} onClick=${() => setShowExitConfirm(false)} variant="secondary">Cancel<//>
                                <${Button} onClick=${() => app.confirmAbandon()} variant="danger">Abandon Path<//>
                            </div>
                        </div>
                    </div>
                `}
                ${showEndConfirm && html`
                    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
                        <div className="w-full max-w-sm bg-gray-900 border border-blue-900/50 rounded-xl p-6 text-center shadow-2xl">
                            <${Flag} size=${32} className="text-blue-500 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-white mb-2">Initiate Finale?</h3>
                            <p className="text-gray-400 text-sm mb-6">The story will conclude in <span className="font-bold text-white">${prefs.endingLength} turns</span>. Make them count.</p>
                            <div className="flex gap-3 justify-center">
                                <${Button} onClick=${() => setShowEndConfirm(false)} variant="secondary">Cancel<//>
                                <${Button} onClick=${confirmEndingSequence} className="bg-blue-600 hover:bg-blue-500">Begin Ending<//>
                            </div>
                        </div>
                    </div>
                `}
                <${Toast} toast=${toast} onDismiss=${dismissToast} />
            </div>
        </div>
    `;
}
