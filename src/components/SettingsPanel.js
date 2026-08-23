import { html } from '../html.js';
import { Settings, X, CheckCircle, Trash2, WifiOff, RefreshCw, Volume2, Play, Star } from 'lucide-react';
import { voicesList, getVoiceMeta, CHRONICLE_VERSION } from '../constants.js';
import { Toggle } from './ui.js';

export function SettingsPanel({ app }) {
    const {
        prefs, setPrefs, config, setConfig, mediaStatus, availableModels, modelPrefs, setModelPrefs,
        fetchModels, modelListLoading, clearApiKey, togglePanel, previewVoice, previewPlaying,
        favorites, toggleFavorite, contextChars,
    } = app;

    const sortedVoices = [...voicesList].sort((a, b) => {
        const aFav = favorites.includes(a);
        const bFav = favorites.includes(b);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return a.localeCompare(b);
    });

    const modelCount = availableModels.text.length || availableModels.image.length || availableModels.audio.length;

    return html`
        <div className="fixed inset-0 md:absolute md:inset-auto md:top-14 md:right-4 md:w-80 bg-gray-900 border-gray-800 md:border md:rounded-xl shadow-2xl z-50 p-4 overflow-y-auto md:max-h-[80vh] custom-scrollbar" style=${{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold uppercase text-gray-500 flex items-center gap-2"><${Settings} size=${12} /> Preferences</h3>
                <button onClick=${() => togglePanel(null)}><${X} size=${14} className="text-gray-500 hover:text-white" /></button>
            </div>
            <div className="space-y-6">
                <div>
                    <label className="text-[10px] text-blue-400 font-bold block mb-2 font-sans">API ACCESS</label>
                    <div className="flex items-center justify-between bg-black border border-gray-800 rounded p-2 mb-2">
                        <span className="text-gray-500 text-xs flex items-center gap-2"><${CheckCircle} size=${12} className="text-green-500" /> Main Key Stored</span>
                        <button onClick=${clearApiKey} className="text-red-400 text-xs hover:text-red-300 hover:underline flex items-center gap-1"><${Trash2} size=${10} /> Clear</button>
                    </div>
                </div>

                ${(mediaStatus.images !== 'active' || mediaStatus.audio !== 'active') && html`
                    <div className="bg-yellow-900/20 border border-yellow-500/30 rounded p-2 text-[10px] text-yellow-200 flex flex-col gap-1">
                        <span className="font-bold flex items-center gap-1"><${WifiOff} size=${10} /> System Status</span>
                        ${mediaStatus.images === 'backup' && html`<span>• Image Backup (Pollinations) Active</span>`}
                        ${mediaStatus.audio === 'backup' && html`<span>• Audio Backup (Browser TTS) Active</span>`}
                        ${mediaStatus.images === 'disabled' && html`<span className="text-red-400">• Images Disabled</span>`}
                        ${mediaStatus.audio === 'disabled' && html`<span className="text-red-400">• Audio Disabled</span>`}
                    </div>
                `}

                <div>
                    <label className="text-[10px] text-blue-400 font-bold block mb-2 font-sans">AI MODELS</label>
                    <div className="flex items-center justify-between bg-black border border-gray-800 rounded p-2 mb-3">
                        <span className="text-gray-500 text-[10px]">
                            ${modelCount ? `${availableModels.text.length} text, ${availableModels.image.length} image, ${availableModels.audio.length} audio` : 'No models loaded'}
                        </span>
                        <button onClick=${fetchModels} disabled=${modelListLoading} className="text-blue-400 text-[10px] hover:text-blue-300 flex items-center gap-1 disabled:opacity-50">
                            <${RefreshCw} size=${10} className=${modelListLoading ? 'animate-spin' : ''} /> ${modelListLoading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-gray-400 uppercase block mb-1">Text Generation</label>
                            <select value=${modelPrefs.textModel} onChange=${(e) => setModelPrefs((p) => ({ ...p, textModel: e.target.value }))} className="w-full bg-black border border-gray-700 rounded p-2 text-xs text-gray-300 focus:border-blue-500 outline-none">
                                <option value="">Auto (recommended)</option>
                                ${availableModels.text.map((m) => html`<option key=${m.id} value=${m.id}>${m.displayName}</option>`)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[9px] text-gray-400 uppercase block mb-1">Image Generation</label>
                            <select value=${modelPrefs.imageModel} onChange=${(e) => setModelPrefs((p) => ({ ...p, imageModel: e.target.value }))} className="w-full bg-black border border-gray-700 rounded p-2 text-xs text-gray-300 focus:border-blue-500 outline-none">
                                <option value="">Auto (recommended)</option>
                                ${availableModels.image.map((m) => html`<option key=${m.id} value=${m.id}>${m.displayName}</option>`)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[9px] text-gray-400 uppercase block mb-1">Audio / TTS</label>
                            <select value=${modelPrefs.audioModel} onChange=${(e) => setModelPrefs((p) => ({ ...p, audioModel: e.target.value }))} className="w-full bg-black border border-gray-700 rounded p-2 text-xs text-gray-300 focus:border-blue-500 outline-none">
                                <option value="">Auto (recommended)</option>
                                ${availableModels.audio.map((m) => html`<option key=${m.id} value=${m.id}>${m.displayName}</option>`)}
                            </select>
                        </div>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-blue-400 font-bold block mb-2 font-sans">MODE</label>
                    <div className="flex gap-1">
                        ${['choice', 'text'].map((m) => html`<button key=${m} onClick=${() => setConfig({ ...config, mode: m })} className=${`flex-1 p-2 text-[10px] border rounded uppercase ${config.mode === m ? 'bg-blue-900 border-blue-500 text-white' : 'border-gray-700 text-gray-500'}`}>${m}</button>`)}
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-blue-400 font-bold block mb-2 font-sans">STORY ENGINE</label>
                    <div className="space-y-2">
                        <div>
                            <div className="text-xs text-gray-300 mb-1">Pacing</div>
                            <div className="flex gap-1">
                                ${['standard', 'direct'].map((p) => html`<button key=${p} type="button" onClick=${() => setPrefs({ ...prefs, pacing: p })} className=${`flex-1 p-2 text-[10px] border rounded uppercase ${(prefs.pacing || 'standard') === p ? 'bg-blue-900 border-blue-500 text-white' : 'border-gray-700 text-gray-500'}`}>${p}</button>`)}
                            </div>
                            <div className="text-[9px] text-gray-600 mt-1">${prefs.pacing === 'direct' ? 'Short, concrete beats. Applies on the next turn.' : 'Literary, atmospheric prose. Applies on the next turn.'}</div>
                        </div>
                        <div className="flex justify-between items-center">
                            <div>
                                <div className="text-xs text-gray-300">Stream narrative</div>
                                <div className="text-[9px] text-gray-600">Reveal text as it is written</div>
                            </div>
                            <${Toggle} on=${prefs.streaming !== false} onClick=${() => setPrefs({ ...prefs, streaming: prefs.streaming === false })} />
                        </div>
                        <div className="flex justify-between items-center">
                            <div>
                                <div className="text-xs text-gray-300">Track stats</div>
                                <div className="text-[9px] text-gray-600">Let the GM maintain a stat HUD</div>
                            </div>
                            <${Toggle} on=${!!prefs.statsEnabled} onClick=${() => setPrefs({ ...prefs, statsEnabled: !prefs.statsEnabled })} />
                        </div>
                        <div className="flex justify-between items-center">
                            <div>
                                <div className="text-xs text-gray-300">Continuity check</div>
                                <div className="text-[9px] text-gray-600">Warn on contradictions (extra API call)</div>
                            </div>
                            <${Toggle} on=${!!prefs.consistencyCheck} onClick=${() => setPrefs({ ...prefs, consistencyCheck: !prefs.consistencyCheck })} />
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <div>
                                    <div className="text-xs text-gray-300">Keep last N images</div>
                                    <div className="text-[9px] text-gray-600">0 = regenerate on resume</div>
                                </div>
                                <span className="text-[10px] text-gray-500 font-mono">${prefs.keepLastNImages ?? 4}</span>
                            </div>
                            <input type="range" min="0" max="12" value=${prefs.keepLastNImages ?? 4} onChange=${(e) => setPrefs({ ...prefs, keepLastNImages: Number(e.target.value) })} className="w-full" />
                        </div>
                        <div className="bg-black border border-gray-800 rounded p-2">
                            <div className="text-[9px] text-gray-500 uppercase tracking-widest">Context size</div>
                            <div className="text-xs text-gray-300 font-mono">${(contextChars || 0).toLocaleString()} chars</div>
                        </div>
                    </div>
                </div>

                ${mediaStatus.audio !== 'backup' && mediaStatus.audio !== 'disabled' ? html`
                    <div>
                        <label className="text-[10px] text-blue-400 font-bold block mb-2 font-sans">NARRATOR</label>
                        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto custom-scrollbar border border-gray-800 rounded p-1">
                            ${sortedVoices.map((v) => {
                                const meta = getVoiceMeta(v);
                                const isFav = favorites.includes(v);
                                return html`
                                    <div key=${v} id=${`voice-${v}`} onClick=${() => setPrefs({ ...prefs, voice: v })} className=${`flex items-center justify-between p-2 rounded cursor-pointer border transition-all ${prefs.voice === v ? 'bg-blue-900/30 border-blue-500' : 'hover:bg-gray-800 border-transparent'}`}>
                                        <div className="flex items-center gap-3">
                                            <button onClick=${(e) => { e.stopPropagation(); previewVoice(v); }} disabled=${previewPlaying} className="text-gray-500 hover:text-white flex-shrink-0">
                                                ${previewPlaying && prefs.voice === v ? html`<${Volume2} size=${16} className="animate-pulse text-blue-400" />` : html`<${Play} size=${16} />`}
                                            </button>
                                            <div>
                                                <div className="text-xs font-bold text-gray-300 flex items-center gap-2">${v}${isFav && html`<${Star} size=${10} className="fill-yellow-500 text-yellow-500" />`}</div>
                                                <div className="text-[9px] text-gray-500 uppercase tracking-wider">${meta.style}</div>
                                            </div>
                                        </div>
                                        <button onClick=${(e) => toggleFavorite(v, e)} className="p-1 hover:bg-gray-700 rounded-full transition-colors"><${Star} size=${14} className=${isFav ? 'fill-yellow-500 text-yellow-500' : 'text-gray-600 hover:text-gray-400'} /></button>
                                    </div>
                                `;
                            })}
                        </div>
                    </div>
                ` : html`
                    <div>
                        <label className="text-[10px] text-blue-400 font-bold block mb-2 font-sans">NARRATOR</label>
                        <div className="p-3 bg-gray-900 border border-gray-800 rounded text-xs text-gray-500 italic">System Backup Engine Active. Voice selection unavailable.</div>
                    </div>
                `}

                <div className="flex justify-between items-center">
                    <div>
                        <label className="text-[10px] text-blue-400 font-bold font-sans uppercase">Auto-Play</label>
                        <div className="text-[9px] text-gray-600">Narrate each page automatically</div>
                    </div>
                    <${Toggle} on=${prefs.autoPlay} onClick=${() => setPrefs({ ...prefs, autoPlay: !prefs.autoPlay })} />
                </div>

                <div className="pt-4 border-t border-gray-800 text-[10px] text-gray-600">Chronicle v${CHRONICLE_VERSION}</div>
            </div>
        </div>
    `;
}
