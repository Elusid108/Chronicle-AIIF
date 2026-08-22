import { useRef } from 'react';
import { html } from '../html.js';
import { Settings, Cpu, BookOpen, AlertTriangle, Activity, Upload, Trash2, Library } from 'lucide-react';
import { Button, Input } from './ui.js';
import { SettingsPanel } from './SettingsPanel.js';
import { GENRE_OPTIONS, STYLE_OPTIONS, CHRONICLE_VERSION } from '../constants.js';

const optionClass = (active) =>
    `p-2 rounded-lg text-xs text-left transition-all border shrink-0 ${active
        ? 'bg-blue-900/20 border-blue-500 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`;

export function SetupView({ app }) {
    const {
        config, setConfig, initialContext, setInitialContext, status, loading, toast,
        hasSavedGame, savedPageCount, resumeSavedGame, startGame, activePanel, togglePanel,
        showNewConfirm, setShowNewConfirm, slots, loadSlotById, deleteSlotById, importStory,
    } = app;
    const fileRef = useRef(null);

    return html`
        <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-6 text-gray-200 font-sans relative">
            <div className="absolute top-6 right-6 z-50">
                <button onClick=${() => togglePanel('settings')} className="p-2 bg-gray-900 rounded-lg text-gray-400 hover:text-white border border-gray-800 hover:border-blue-500/50 transition-all"><${Settings} size=${20} /></button>
            </div>
            <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl relative z-10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="p-3 bg-blue-600 rounded-lg"><${Cpu} className="text-white" /></div>
                    <div>
                        <h1 className="text-3xl font-display font-bold text-white uppercase">Chronicle</h1>
                        <p className="text-gray-500 text-sm uppercase tracking-widest font-sans">Iterative Fiction Engine <span className="text-gray-600 normal-case tracking-normal">v${CHRONICLE_VERSION}</span></p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-6 mb-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs uppercase tracking-wider text-gray-500 font-bold">Genre</label>
                        <div className="max-h-[200px] overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-1">
                            ${GENRE_OPTIONS.map((opt) => html`
                                <button key=${opt.value} onClick=${() => setConfig({ ...config, setting: opt.value })} className=${optionClass(config.setting === opt.value)}><div className="font-semibold">${opt.label}</div></button>
                            `)}
                            <button onClick=${() => setConfig({ ...config, setting: 'custom' })} className=${optionClass(config.setting === 'custom')}><div className="font-semibold">Custom...</div></button>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs uppercase tracking-wider text-gray-500 font-bold">Visual Style</label>
                        <div className="max-h-[200px] overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-1">
                            ${STYLE_OPTIONS.map((opt) => html`
                                <button key=${opt.value} onClick=${() => setConfig({ ...config, style: opt.value })} className=${optionClass(config.style === opt.value)}><div className="font-semibold">${opt.label}</div></button>
                            `)}
                            <button onClick=${() => setConfig({ ...config, style: 'custom' })} className=${optionClass(config.style === 'custom')}><div className="font-semibold">Custom...</div></button>
                        </div>
                    </div>
                    <div className="col-span-2 space-y-2">
                        ${config.setting === 'custom' && html`
                            <div>
                                <label className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2 block">Custom Genre</label>
                                <${Input} value=${config.settingCustom} onChange=${(e) => setConfig({ ...config, settingCustom: e.target.value })} placeholder="Describe custom genre..." className="bg-blue-900/10 border-blue-500/50" />
                            </div>
                        `}
                        ${config.style === 'custom' && html`
                            <div>
                                <label className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2 block">Custom Visual Style</label>
                                <${Input} value=${config.styleCustom} onChange=${(e) => setConfig({ ...config, styleCustom: e.target.value })} placeholder="Describe custom visual style..." className="bg-blue-900/10 border-blue-500/50" />
                            </div>
                        `}
                    </div>
                </div>
                <div className="mb-6">
                    <label className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2 block font-sans">Initial Context (Optional)</label>
                    <textarea value=${initialContext} onChange=${(e) => setInitialContext(e.target.value)} placeholder="Waking up in a derelict cryopod..." className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:border-blue-500 resize-none h-24 font-serif"></textarea>
                </div>
                ${status && html`<div className="mb-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded flex items-center gap-2 text-xs text-blue-300 font-mono"><${Activity} size=${14} className="animate-pulse" /> ${status}</div>`}
                ${hasSavedGame && html`<${Button} onClick=${resumeSavedGame} variant="secondary" className="w-full py-3 text-base mt-4 flex items-center justify-center gap-2" disabled=${loading}><${BookOpen} size=${18} /> Resume your story (${savedPageCount} ${savedPageCount === 1 ? 'page' : 'pages'})<//>`}
                <${Button} onClick=${() => hasSavedGame ? setShowNewConfirm(true) : startGame()} className="w-full py-4 text-lg mt-6" disabled=${loading}>${loading ? 'Initializing...' : (hasSavedGame ? 'New Simulation' : 'Begin Simulation')}<//>

                <div className="mt-6 pt-4 border-t border-gray-800">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-2"><${Library} size=${12} /> Library</label>
                        <button onClick=${() => fileRef.current && fileRef.current.click()} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><${Upload} size=${12} /> Import .json</button>
                        <input ref=${fileRef} type="file" accept="application/json,.json" className="hidden" onChange=${(e) => { const f = e.target.files?.[0]; if (f) importStory(f); e.target.value = ''; }} />
                    </div>
                    ${slots.length === 0
                        ? html`<p className="text-[10px] text-gray-600 italic">No saved stories yet. Use the bookmark icon in-game to save a snapshot.</p>`
                        : html`<div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">${slots.map((s) => html`
                            <div key=${s.id} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded p-2">
                                <button onClick=${() => loadSlotById(s.id)} className="text-left flex-1 min-w-0">
                                    <div className="text-xs text-gray-300 truncate">${s.name}</div>
                                    <div className="text-[9px] text-gray-600">${s.title} · ${s.pages} ${s.pages === 1 ? 'page' : 'pages'} · ${new Date(s.savedAt).toLocaleDateString()}</div>
                                </button>
                                <button onClick=${() => deleteSlotById(s.id)} className="text-gray-600 hover:text-red-400 p-1"><${Trash2} size=${12} /></button>
                            </div>
                        `)}</div>`}
                </div>
            </div>
            ${activePanel === 'settings' && html`<${SettingsPanel} app=${app} />`}
            ${showNewConfirm && html`
                <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
                    <div className="w-full max-w-sm bg-gray-900 border border-red-900/50 rounded-xl p-6 text-center">
                        <${AlertTriangle} size=${32} className="text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-white mb-2">Start New Simulation?</h3>
                        <p className="text-gray-400 text-sm mb-6">Your current story will be lost unless you saved it to the Library.</p>
                        <div className="flex gap-3 justify-center">
                            <${Button} onClick=${() => setShowNewConfirm(false)} variant="secondary">Cancel<//>
                            <${Button} onClick=${() => { setShowNewConfirm(false); startGame(); }} variant="danger">Start New<//>
                        </div>
                    </div>
                </div>
            `}
            ${toast && html`
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[70] animate-in fade-in slide-in-from-bottom-2">
                    <div className=${`px-4 py-2 rounded-lg shadow-2xl border text-sm flex items-center gap-2 ${toast.type === 'error' ? 'bg-red-950 border-red-800 text-red-200' : 'bg-gray-900 border-gray-700 text-gray-200'}`}>
                        ${toast.type === 'error' ? html`<${AlertTriangle} size=${14} />` : html`<${Activity} size=${14} />`} ${toast.message}
                    </div>
                </div>
            `}
        </div>
    `;
}
