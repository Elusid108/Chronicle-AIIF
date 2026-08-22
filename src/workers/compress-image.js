// Module worker: snapshot a remote or data-URL image to a compact WebP/JPEG blob.
self.onmessage = async (event) => {
    const { id, src, buffer, mime, maxWidth = 1280, quality = 0.82 } = event.data || {};
    try {
        let blob;
        if (buffer) {
            blob = new Blob([buffer], { type: mime || 'image/png' });
        } else if (src) {
            const res = await fetch(src);
            if (!res.ok) throw new Error(`fetch ${res.status}`);
            blob = await res.blob();
        } else {
            throw new Error('No image source');
        }

        const bitmap = await createImageBitmap(blob);
        let w = bitmap.width;
        let h = bitmap.height;
        if (w > maxWidth) {
            h = Math.round(h * (maxWidth / w));
            w = maxWidth;
        }
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();

        let out;
        try {
            out = await canvas.convertToBlob({ type: 'image/webp', quality });
        } catch {
            out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        }
        self.postMessage({ id, ok: true, blob: out });
    } catch (e) {
        self.postMessage({ id, ok: false, error: e.message || String(e) });
    }
};
