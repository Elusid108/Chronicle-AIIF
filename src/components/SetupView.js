import { useRef, useState } from 'react';
import { html } from '../html.js';
import {
    Settings, Cpu, BookOpen, Activity, Upload, Trash2, Library,
    Pencil, Check, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Button, Input, Toggle, Toast } from './ui.js';
import { SettingsPanel } from './SettingsPanel.js';
import { GENRE_OPTIONS, STYLE_OPTIONS, CHRONICLE_VERSION } from '../constants.js';

const optionClass = (active) =>
    `p-2 rounded-lg text-xs text-left transition-all border shrink-0 ${active
        ? 'bg-blue-900/20 border-blue-500 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`;

function formatPlayedAt(ts) {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
        return '';
    }
}

function StoryRow({ slot, isCurrent, isFirst, isLast, onOpen, onRename, onDelete, onMove, disabled }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(slot.name);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const commitRename = () => {
        const trimmed = name.trim();
        setEditing(false);
        if (trimmed && trimmed !== slot.name) onRename(slot.id, trimmed);
        else setName(slot.name);
    };

    return html`
        <div className=${`bg-gray-950 border rounded-lg p-3 ${isCurrent ? 'border-blue-700/60' : 'border-gray-800'}`}>
            <div className="flex items-start gap-2">
                <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                    <button type="button" disabled=${isFirst || disabled} onClick=${() => onMove(slot.id, -1)} className="text-gray-600 hover:text-white disabled:opacity-20 p-0.5" title="Move up"><${ChevronUp} size=${14} /></button>
                    <button type="button" disabled=${isLast || disabled} onClick=${() => onMove(slot.id, 1)} className="text-gray-600 hover:text-white disabled:opacity-20 p-0.5" title="Move down"><${ChevronDown} size=${14} /></button>
                </div>
                <div className="flex-1 min-w-0">
                    ${editing ? html`
                        <div className="flex gap-2 mb-1">
                            <${Input} value=${name} onChange=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && commitRename()} className="py-1 text-xs" />
                            <button type="button" onClick=${commitRename} className="text-blue-400 p-1"><${Check} size=${14} /></button>
                            <button type="button" onClick=${() => { setEditing(false); setName(slot.name); }} className="text-gray-500 p-1"><${X} size=${14} /></button>
                        </div>
                    ` : html`
                        <button type="button" onClick=${() => onOpen(slot.id)} disabled=${disabled} className="text-left w-full min-w-0">
                            <div className="text-sm text-gray-200 truncate font-medium">${slot.name}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                                ${slot.pages || 0} ${slot.pages === 1 ? 'page' : 'pages'}
                                ${slot.setting ? ` · ${slot.setting}` : ''}
                                ${slot.savedAt ? ` · ${formatPlayedAt(slot.savedAt)}` : ''}
                            </div>
                        </button>
                    `}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick=${() => { setEditing(true); setName(slot.name); }} disabled=${disabled} className="text-gray-600 hover:text-white p-1.5" title="Rename"><${Pencil} size=${14} /></button>
                    ${confirmDelete
                        ? html`<button type="button" onClick=${() => onDelete(slot.id)} className="text-red-400 text-[10px] uppercase font-bold px-1">Delete?</button>`
                        : html`<button type="button" onClick=${() => setConfirmDelete(true)} disabled=${disabled} className="text-gray-600 hover:text-red-400 p-1.5" title="Delete"><${Trash2} size=${14} /></button>`}
                </div>
            </div>
        </div>
    `;
}

export function SetupView({ app }) {
    const {
        config, setConfig, prefs, setPrefs, initialContext, setInitialContext, status, loading, toast, dismissToast,
        startGame, resumeLatestStory, activePanel, togglePanel,
        slots, currentSlotId, loadSlotById, deleteSlotById, renameSlotById, moveSlotById, importStory,
    } = app;
    const fileRef = useRef(null);
    const latest = (slots || []).reduce((best, s) => (!best || (s.savedAt || 0) > (best.savedAt || 0) ? s : best), null);
    const canContinue = latest && (latest.pages || 0) > 0;

    return html`
        <div className="min-h-dvh w-full bg-black flex flex-col items-center p-4 sm:p-6 text-gray-200 font-sans relative overflow-y-auto" style=${{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="absolute top-4 right-4 z-50" style=${{ top: 'max(1rem, env(safe-area-inset-top))', right: 'max(1rem, env(safe-area-inset-right))' }}>
                <button onClick=${() => togglePanel('settings')} className="p-2 bg-gray-900 rounded-lg text-gray-400 hover:text-white border border-gray-800 hover:border-blue-500/50 transition-all"><${Settings} size=${20} /></button>
            </div>
            <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-8 shadow-2xl relative z-10 my-auto">
                <div className="flex items-center gap-3 mb-6 pr-12">
                    <div className="p-3 bg-blue-600 rounded-lg"><${Cpu} className="text-white" /></div>
                    <div>
                        <h1 className="text-3xl font-display font-bold text-white uppercase">Chronicle</h1>
                        <p className="text-gray-500 text-sm uppercase tracking-widest font-sans">Iterative Fiction Engine <span className="text-gray-600 normal-case tracking-normal">v${CHRONICLE_VERSION}</span></p>
                    </div>
                </div>

                ${slots.length > 0 && html`
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-2"><${Library} size=${12} /> Stories</label>
                            <button onClick=${() => fileRef.current && fileRef.current.click()} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><${Upload} size=${12} /> Import .json</button>
                        </div>
                        <div className="space-y-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-0.5">
                            ${slots.map((s, i) => html`
                                <${StoryRow}
                                    key=${s.id}
                                    slot=${s}
                                    isCurrent=${s.id === currentSlotId}
                                    isFirst=${i === 0}
                                    isLast=${i === slots.length - 1}
                                    onOpen=${loadSlotById}
                                    onRename=${renameSlotById}
                                    onDelete=${deleteSlotById}
                                    onMove=${moveSlotById}
                                    disabled=${loading}
                                />
                            `)}
                        </div>
                    </div>
                `}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
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
                    <div className="col-span-1 sm:col-span-2 space-y-2">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2 block">Input</label>
                        <div className="flex gap-1">
                            ${['choice', 'text'].map((m) => html`<button key=${m} type="button" onClick=${() => setConfig({ ...config, mode: m })} className=${`flex-1 p-2 text-[11px] border rounded uppercase ${config.mode === m ? 'bg-blue-900 border-blue-500 text-white' : 'border-gray-700 text-gray-500'}`}>${m}</button>`)}
                        </div>
                        <p className="text-[10px] text-gray-600 mt-1">${config.mode === 'text' ? 'Type freely. No suggested actions.' : 'Pick from four generated actions.'}</p>
                    </div>
                    <div>
                        <label className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2 block">Pacing</label>
                        <div className="flex gap-1">
                            ${['standard', 'direct'].map((p) => html`<button key=${p} type="button" onClick=${() => setPrefs({ ...prefs, pacing: p })} className=${`flex-1 p-2 text-[11px] border rounded uppercase ${(prefs.pacing || 'standard') === p ? 'bg-blue-900 border-blue-500 text-white' : 'border-gray-700 text-gray-500'}`}>${p}</button>`)}
                        </div>
                        <p className="text-[10px] text-gray-600 mt-1">${prefs.pacing === 'direct' ? 'Short, concrete beats.' : 'Literary, atmospheric prose.'}</p>
                    </div>
                    <div className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 sm:col-span-2">
                        <div>
                            <div className="text-xs text-gray-300">Auto-Play</div>
                            <div className="text-[10px] text-gray-600">Narrate each page automatically</div>
                        </div>
                        <${Toggle} on=${!!prefs.autoPlay} onClick=${() => setPrefs({ ...prefs, autoPlay: !prefs.autoPlay })} />
                    </div>
                </div>
                ${status && html`<div className="mb-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded flex items-center gap-2 text-xs text-blue-300 font-mono"><${Activity} size=${14} className="animate-pulse" /> ${status}</div>`}
                ${canContinue && html`<${Button} onClick=${resumeLatestStory} variant="secondary" className="w-full py-3 text-base mt-2 flex items-center justify-center gap-2" disabled=${loading}><${BookOpen} size=${18} /> Continue ${latest.name} (${latest.pages} ${latest.pages === 1 ? 'page' : 'pages'})<//>`}
                <${Button} onClick=${startGame} className="w-full py-4 text-lg mt-4" disabled=${loading}>${loading ? 'Initializing...' : 'New Simulation'}<//>

                ${slots.length === 0 && html`
                    <div className="mt-6 pt-4 border-t border-gray-800">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest flex items-center gap-2"><${Library} size=${12} /> Stories</label>
                            <button onClick=${() => fileRef.current && fileRef.current.click()} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><${Upload} size=${12} /> Import .json</button>
                        </div>
                        <p className="text-[10px] text-gray-600 italic">No saved stories yet. Starting a simulation keeps it here so you can pick it up later.</p>
                    </div>
                `}
                <input ref=${fileRef} type="file" accept="application/json,.json" className="hidden" onChange=${(e) => { const f = e.target.files?.[0]; if (f) importStory(f); e.target.value = ''; }} />
            </div>
            ${activePanel === 'settings' && html`<${SettingsPanel} app=${app} />`}
            <${Toast} toast=${toast} onDismiss=${dismissToast} />
        </div>
    `;
}
