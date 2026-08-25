const OMIT_KEYS = new Set([
    'apikey', 'api_key', 'inlinedata', 'inline_data', 'audio', 'blob', 'buffer', 'bytesbase64encoded',
]);

let enabled = false;
let currentTurn = null;
const records = [];

const redact = (s) => String(s).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]');

const looksBase64 = (s) => s.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 120));

const sanitize = (value, depth = 0) => {
    if (depth > 14) return '[max-depth]';
    if (value == null) return value;
    if (typeof value === 'string') {
        if (value.startsWith('data:') || value.startsWith('blob:')) {
            return `[omitted ${value.startsWith('blob:') ? 'blob-url' : 'data-url'} ${value.length} chars]`;
        }
        if (looksBase64(value)) return `[omitted base64 ${value.length} chars]`;
        return redact(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Error) return { name: value.name, message: redact(value.message || '') };
    if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            const lk = key.toLowerCase().replace(/-/g, '_');
            if (OMIT_KEYS.has(lk) || lk === 'image') {
                const hint = typeof val === 'string' ? `${val.length} chars` : typeof val;
                out[key] = `[omitted ${key} ${hint}]`;
                continue;
            }
            if (lk === 'data' && typeof val === 'string' && looksBase64(val)) {
                out[key] = `[omitted base64 ${val.length} chars]`;
                continue;
            }
            out[key] = sanitize(val, depth + 1);
        }
        return out;
    }
    return String(value);
};

const push = (name, payload) => {
    if (!enabled) return;
    records.push({
        t: new Date().toISOString(),
        turn: currentTurn,
        name,
        payload: payload === undefined ? undefined : sanitize(payload),
    });
};

export const setVerboseEnabled = (on) => {
    enabled = Boolean(on);
};

export const isVerboseEnabled = () => enabled;

export const beginVerboseTurn = (turnIndex, meta = {}) => {
    if (!enabled) return;
    currentTurn = turnIndex;
    push('turn.start', { turnIndex, ...meta });
};

export const verboseEvent = (name, payload) => {
    push(name, payload);
};

export const verboseLogText = () => {
    const lines = [
        '=== Chronicle verbose log ===',
        `Exported: ${new Date().toISOString()}`,
        `Recording: ${enabled ? 'on' : 'off'}`,
        `Events: ${records.length}`,
        '',
    ];
    if (!records.length) {
        lines.push('No events captured. Enable Verbose logging in Settings, play some turns, then download again.');
        lines.push('Refreshing the page clears this in-memory log.');
        return lines.join('\n');
    }
    let lastTurn = undefined;
    for (const row of records) {
        if (row.turn !== lastTurn) {
            lastTurn = row.turn;
            lines.push('');
            lines.push(row.turn == null ? '----- (no turn) -----' : `----- TURN ${row.turn} -----`);
        }
        lines.push(`[${row.t}] ${row.name}`);
        if (row.payload !== undefined) {
            const body = typeof row.payload === 'string'
                ? row.payload
                : JSON.stringify(row.payload, null, 2);
            lines.push(body);
        }
        lines.push('');
    }
    return lines.join('\n');
};

export const downloadVerboseLog = () => {
    const text = verboseLogText();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronicle-verbose-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
