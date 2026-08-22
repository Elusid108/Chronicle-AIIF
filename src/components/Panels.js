import { html } from '../html.js';
import { BookOpen, FileText, X, Clock, Image as ImageIcon, Activity, Server, Mic, CheckCircle, CornerDownRight, Book, User as UserIcon, MapPin, Box, Bookmark, Save } from 'lucide-react';
import { summaryToText } from '../utils/storage.js';
import { Button, Input } from './ui.js';

const CODEX_GROUPS = [
    { title: 'People', bg: 'bg-blue-900/30', text: 'text-blue-400', key: 'characters' },
    { title: 'Locations', bg: 'bg-emerald-900/30', text: 'text-emerald-400', key: 'places' },
    { title: 'Artifacts', bg: 'bg-amber-900/30', text: 'text-amber-400', key: 'items' },
];

function TurnStats({ stats }) {
    const cats = [
        { label: 'Narrative', icon: html`<${Server} size=${10} />`, data: stats.text },
        { label: 'Visuals', icon: html`<${ImageIcon} size=${10} />`, data: stats.image },
        { label: 'Voice', icon: html`<${Mic} size=${10} />`, data: stats.audio },
    ].filter((c) => c.data && c.data.length > 0);
    if (!cats.length) return null;
    return html`
        <div className="space-y-2">
            ${cats.map((category, j) => html`
                <div key=${j} className="text-[9px]">
                    <div className="flex items-center gap-1 text-gray-500 mb-1 font-bold">${category.icon} ${category.label}</div>
                    ${category.data.map((attempt, k) => html`
                        <div key=${k} className="flex justify-between items-center pl-3 py-0.5 border-l border-gray-800 ml-1">
                            <span className=${attempt.status === 'success' ? 'truncate max-w-[120px] text-gray-300' : 'truncate max-w-[120px] text-red-400 line-through'}>${attempt.model}</span>
                            <div className="flex items-center gap-2">
                                <span className="text-gray-600 font-mono">${(attempt.duration || 0).toFixed(2)}s</span>
                                ${attempt.status === 'success' ? html`<${CheckCircle} size=${8} className="text-emerald-500" />` : html`<${X} size=${8} className="text-red-500" />`}
                            </div>
                        </div>
                    `)}
                </div>
            `)}
        </div>
    `;
}

export function SidePanel({ app }) {
    const { activePanel, codex, summary, currentTurnData, history, setSelectedCodexEntry, scene } = app;
    if (activePanel !== 'summary' && activePanel !== 'codex') return null;

    return html`
        <div className="absolute top-12 bottom-0 right-0 w-full md:w-80 bg-gray-950 border-l border-gray-800 shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-gray-900">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300 flex items-center gap-2">
                    ${activePanel === 'codex' ? html`<${BookOpen} size=${14} /> Codex` : html`<${FileText} size=${14} /> Summary`}
                </h3>
                <button onClick=${() => app.togglePanel(null)} className="text-gray-500 hover:text-white"><${X} size=${16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                ${activePanel === 'codex' ? html`
                    <div className="space-y-6">
                        ${scene && (scene.location || scene.goal) && html`
                            <div className="bg-blue-900/10 rounded border border-blue-900/30 p-3">
                                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Current scene</h4>
                                <div className="text-[10px] text-gray-400">${scene.location || 'Unknown location'}${scene.time_of_day ? ` · ${scene.time_of_day}` : ''}</div>
                                ${scene.goal && html`<div className="text-[10px] text-gray-500 mt-1">${scene.goal}</div>`}
                            </div>
                        `}
                        ${CODEX_GROUPS.map((group) => {
                            const entries = codex[group.key] || {};
                            const list = Object.entries(entries);
                            return html`
                                <div key=${group.key}>
                                    <h4 className=${`text-[10px] font-bold uppercase mb-2 flex items-center gap-2 ${group.text}`}>${group.title} <span className=${`${group.bg} px-1.5 py-0.5 rounded text-[9px]`}>${list.length}</span></h4>
                                    <div className="space-y-1.5">
                                        ${list.length === 0 && html`<p className="text-[10px] text-gray-600 italic">No records yet.</p>`}
                                        ${list.map(([name, data]) => html`
                                            <div key=${name} onClick=${() => setSelectedCodexEntry({ title: name, data, category: group.key })} className="bg-gray-900/50 p-2 rounded border border-gray-800/50 hover:border-blue-900/50 hover:bg-gray-900 transition-all cursor-pointer group">
                                                <div className="text-xs font-bold text-gray-300 group-hover:text-blue-300 transition-colors flex justify-between items-center">
                                                    <span className="truncate">${name}</span>
                                                    <span className="flex items-center gap-1 shrink-0">
                                                        ${data && data.pinned && html`<${Bookmark} size=${10} className="text-blue-400" />`}
                                                        ${data && data.source === 'player' && html`<span className="text-[8px] text-amber-400 uppercase">you</span>`}
                                                        <${CornerDownRight} size=${10} className="opacity-0 group-hover:opacity-100 text-blue-500" />
                                                    </span>
                                                </div>
                                                <div className="text-[10px] text-gray-500 mt-0.5 leading-snug line-clamp-2">${typeof data === 'string' ? data : data.description}</div>
                                            </div>
                                        `)}
                                    </div>
                                </div>
                            `;
                        })}
                    </div>
                ` : html`
                    <div className="space-y-4">
                        <div className="bg-gray-900/50 rounded border border-gray-800 p-3">
                            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2"><${Clock} size=${12} /> Running Log</h4>
                            <div className="text-[10px] text-gray-400 leading-relaxed font-mono whitespace-pre-wrap">${summaryToText(summary)}</div>
                        </div>
                        ${currentTurnData && currentTurnData.image_prompt && html`
                            <div className="bg-blue-900/10 rounded border border-blue-900/30 p-3">
                                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-2 flex items-center gap-2"><${ImageIcon} size=${12} /> Visual Directive</h4>
                                <div className="text-[10px] text-blue-300 leading-snug font-serif italic">"${currentTurnData.image_prompt}"</div>
                            </div>
                        `}
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-6 mb-2 border-t border-gray-800 pt-4 flex items-center gap-2"><${Activity} size=${12} /> Performance Logs</h4>
                        <div className="space-y-3">
                            ${history.length === 0 && html`<p className="text-[10px] text-gray-600 italic">No logs available.</p>`}
                            ${history.slice().reverse().map((turn, i) => html`
                                <div key=${i} className="bg-gray-900/50 p-2 rounded border border-gray-800/50">
                                    <div className="flex justify-between items-center mb-2"><span className="text-[10px] text-blue-400 font-bold uppercase">Turn ${history.length - i}</span></div>
                                    ${turn.stats && html`<${TurnStats} stats=${turn.stats} />`}
                                </div>
                            `)}
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;
}

export function CodexEntryModal({ app }) {
    const { selectedCodexEntry, setSelectedCodexEntry, setCurrentSlideIndex, togglePanel, saveCodexEdits, toggleCodexPin, mergeSelectedInto, codex } = app;
    if (!selectedCodexEntry) return null;
    const { category, title, data } = selectedCodexEntry;
    const entry = data && typeof data === 'object' ? data : { description: String(data || ''), citations: [], aliases: [], status: '', location: '', pinned: false, source: 'model' };
    const citations = entry.citations || [];
    const others = Object.keys(codex[category] || {}).filter((k) => k !== title);

    const onField = (field) => (e) => {
        const value = e.target.value;
        saveCodexEdits(category, title, { [field]: value });
    };

    return html`
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[60] p-6 backdrop-blur-sm" onClick=${() => setSelectedCodexEntry(null)}>
            <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar" onClick=${(e) => e.stopPropagation()}>
                <button onClick=${() => setSelectedCodexEntry(null)} className="absolute top-4 right-4 text-gray-500 hover:text-white"><${X} size=${20} /></button>
                <div className="flex items-center gap-3 mb-4 text-blue-400">
                    ${category === 'characters' && html`<${UserIcon} size=${24} />`}
                    ${category === 'places' && html`<${MapPin} size=${24} />`}
                    ${category === 'items' && html`<${Box} size=${24} />`}
                    <h3 className="text-xl font-bold text-white font-display uppercase tracking-wider">${title}</h3>
                </div>
                <div className="space-y-3 mb-4">
                    <div>
                        <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Description</label>
                        <textarea value=${entry.description || ''} onChange=${onField('description')} className="w-full bg-black/50 border border-gray-700 rounded p-2 text-sm text-gray-300 h-24 resize-none focus:outline-none focus:border-blue-500 font-serif" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Status</label>
                            <${Input} value=${entry.status || ''} onChange=${onField('status')} placeholder="alive, dead..." className="bg-black/50" />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Location</label>
                            <${Input} value=${entry.location || ''} onChange=${onField('location')} placeholder="where they are" className="bg-black/50" />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Aliases (comma-separated)</label>
                        <${Input} value=${(entry.aliases || []).join(', ')} onChange=${onField('aliases')} placeholder="Captain, the stranger" className="bg-black/50" />
                    </div>
                    <div className="flex gap-2">
                        <${Button} variant="secondary" onClick=${() => toggleCodexPin(category, title)} className="flex-1 text-xs">
                            <${Bookmark} size=${12} /> ${entry.pinned ? 'Unpin' : 'Pin in prompt'}
                        <//>
                        <span className="text-[9px] text-gray-600 self-center">${entry.source === 'player' ? 'Player-authored' : 'Model'}</span>
                    </div>
                    ${others.length > 0 && html`
                        <div>
                            <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Merge into</label>
                            <select onChange=${(e) => { if (e.target.value) mergeSelectedInto(e.target.value); }} className="w-full bg-black border border-gray-700 rounded p-2 text-xs text-gray-300">
                                <option value="">Keep separate...</option>
                                ${others.map((k) => html`<option key=${k} value=${k}>${k}</option>`)}
                            </select>
                        </div>
                    `}
                </div>
                ${citations.length > 0 && html`
                    <div className="bg-black/50 rounded p-3 border border-gray-800">
                        <h4 className="text-[10px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-2"><${Book} size=${10} /> Referenced on Pages</h4>
                        <div className="flex flex-wrap gap-2">
                            ${citations.map((pageNum) => html`<button key=${pageNum} onClick=${() => { setCurrentSlideIndex(pageNum - 1); setSelectedCodexEntry(null); togglePanel(null); }} className="text-xs bg-blue-900/30 hover:bg-blue-800 text-blue-300 px-2 py-1 rounded transition-colors border border-blue-900/50">Page ${pageNum}</button>`)}
                        </div>
                    </div>
                `}
                <p className="text-[9px] text-gray-600 mt-3 flex items-center gap-1"><${Save} size=${10} /> Edits are marked canonical and always injected into the GM prompt.</p>
            </div>
        </div>
    `;
}
