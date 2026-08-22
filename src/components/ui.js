import { html } from '../html.js';

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
