// Escape text for safe insertion into HTML markup (book export).
export const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Only allow blob:, data:image and http(s) URLs in generated markup.
export const safeImageSrc = (url) => {
    const s = String(url || '');
    if (/^(blob:|data:image\/|https?:\/\/)/i.test(s)) return escapeHtml(s);
    return '';
};
