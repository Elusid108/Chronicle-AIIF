import { useState } from 'react';
import { html } from '../html.js';
import { Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { Button, Input } from './ui.js';
import { validateApiKey } from '../api/gemini.js';

const ERROR_MESSAGES = {
    network: "Network error. Check your connection or try again. If behind a firewall, use 'Save without validating' below.",
    invalid_key: 'Invalid API key. Check your key at Google AI Studio.',
    rate_limit: 'Rate limited. Wait a moment and try again.',
    model: "Model unavailable. Try again or use 'Save without validating'.",
    unknown: "API error. Try again or use 'Save without validating'.",
};

export function ApiKeyModal({ onSave }) {
    const [key, setKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [status, setStatus] = useState('idle');
    const [errorDetail, setErrorDetail] = useState(null);
    const [errorStatus, setErrorStatus] = useState(null);

    const handleValidate = async () => {
        if (!key) return;
        setStatus('validating');
        setErrorDetail(null);
        setErrorStatus(null);
        const result = await validateApiKey(key);
        if (result.ok) {
            onSave(key.trim());
            return;
        }
        setStatus('error');
        setErrorDetail(result.detail);
        if (result.status != null) setErrorStatus(result.status);
    };

    const getErrorMessage = () => {
        if (!errorDetail) return 'Invalid API Key or Network Error';
        if (errorDetail === 'unknown' && errorStatus != null) return `API error (HTTP ${errorStatus}).`;
        return ERROR_MESSAGES[errorDetail] || ERROR_MESSAGES.unknown;
    };

    const handleSaveWithoutValidation = () => {
        if (key.trim()) onSave(key.trim());
    };

    return html`
        <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-6 relative">
            <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-purple-600"></div>
                <div className="p-4 bg-blue-900/20 rounded-full inline-block mb-4 border border-blue-500/30">
                    <${Lock} className="text-blue-400 w-8 h-8" />
                </div>
                <h1 className="text-2xl font-display font-bold text-white mb-2">Access Required</h1>
                <p className="text-gray-400 text-sm mb-6">
                    To run Chronicle on GitHub Pages, please enter your Google Gemini API Key.
                </p>

                <div className="space-y-4">
                    <div className="text-left">
                        <label className="text-xs font-bold text-gray-500 uppercase">API Key</label>
                        <div className="relative">
                            <${Input}
                                type=${showKey ? 'text' : 'password'}
                                value=${key}
                                onChange=${(e) => {
                                    setKey(e.target.value);
                                    if (status === 'error') { setStatus('idle'); setErrorDetail(null); setErrorStatus(null); }
                                }}
                                placeholder="AIzaSy..."
                                className=${`mt-1 pr-10 ${status === 'error' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                                onKeyDown=${(e) => e.key === 'Enter' && handleValidate()}
                            />
                            <button onClick=${() => setShowKey(!showKey)} className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-300">
                                ${showKey ? html`<${EyeOff} size=${16} />` : html`<${Eye} size=${16} />`}
                            </button>
                        </div>
                        ${status === 'error' && html`
                            <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                                <${AlertTriangle} size=${12} /> ${getErrorMessage()}
                            </p>
                        `}
                    </div>
                    <${Button} onClick=${handleValidate} disabled=${!key || status === 'validating'} className="w-full py-3">
                        ${status === 'validating' ? 'Verifying...' : 'Enter Simulation'}
                    <//>
                    <button onClick=${handleSaveWithoutValidation} disabled=${!key.trim()} className="w-full mt-3 text-xs text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        I'm sure my key works - save anyway
                    </button>
                    <p className="text-[10px] text-gray-600 mt-4">
                        Your key is saved locally in your browser and is never sent to any server other than Google's API.
                    </p>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-xs text-blue-500 hover:text-blue-400 underline block">Get a Gemini API Key</a>
                </div>
            </div>
        </div>
    `;
}
