import { useEffect } from 'react';
import { html } from '../html.js';
import { Activity, AlertTriangle, X } from 'lucide-react';

export function Button({ children, onClick, variant = 'primary', className = '', disabled = false, title = '' }) {
    const baseStyle = 'px-3 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm';
    const variants = {
        primary: 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20',
        secondary: 'bg-black/50 hover:bg-black/80 text-white border border-white/10 backdrop-blur-sm',
        outline: 'border border-gray-600 hover:border-gray-400 text-gray-400 hover:text-white',
        ghost: 'text-gray-400 hover:text-white hover:bg-gray-800/50',
        danger: 'bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800',
    };
    return html`
        <button type="button" onClick=${onClick} disabled=${disabled} className=${`${baseStyle} ${variants[variant]} ${className}`} title=${title}>
            ${children}
        </button>
    `;
}

export function Input({ value, onChange, placeholder, type = 'text', className = '', onKeyDown, disabled }) {
    return html`
        <input
            type=${type}
            value=${value}
            onChange=${onChange}
            placeholder=${placeholder}
            onKeyDown=${onKeyDown}
            disabled=${disabled}
            className=${`w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all disabled:opacity-50 ${className}`}
        />
    `;
}

export function Toggle({ on, onClick }) {
    return html`
        <button type="button" onClick=${onClick} className=${`w-8 h-4 rounded-full relative transition-colors shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-700'}`}>
            <div className=${`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
        </button>
    `;
}

export function ImageLightbox({ src, alt = '', onClose }) {
    useEffect(() => {
        if (!src) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [src, onClose]);
    if (!src) return null;
    return html`
        <div
            className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-3 md:p-6 cursor-zoom-out"
            onClick=${onClose}
            role="dialog"
            aria-modal="true"
        >
            <img src=${src} alt=${alt} className="max-w-full max-h-full object-contain" />
        </div>
    `;
}

export function Toast({ toast, onDismiss }) {
    if (!toast) return null;
    const isError = toast.type === 'error';
    return html`
        <div className="fixed left-1/2 -translate-x-1/2 z-[70] w-[min(28rem,calc(100%-1.5rem))]" style=${{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className=${`px-4 py-2.5 rounded-lg shadow-2xl border text-sm flex items-start gap-2 ${isError ? 'bg-red-950 border-red-800 text-red-200' : 'bg-gray-900 border-gray-700 text-gray-200'}`}>
                ${isError ? html`<${AlertTriangle} size=${14} className="mt-0.5 shrink-0" />` : html`<${Activity} size=${14} className="mt-0.5 shrink-0" />`}
                <span className="flex-1 min-w-0 break-words">${toast.message}</span>
                <button type="button" onClick=${onDismiss} className="text-gray-500 hover:text-white shrink-0 p-0.5" title="Dismiss"><${X} size=${14} /></button>
            </div>
        </div>
    `;
}
