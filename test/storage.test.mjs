import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSavePayload, migrateSave, normalizeEntry, normalizeOverrides, SAVE_VERSION } from '../src/utils/storage.js';
import { escapeHtml, safeImageSrc } from '../src/utils/text.js';

test('normalizeEntry validates possession and holder', () => {
    assert.equal(normalizeEntry({ possession: 'carried', holder: ' Mira ' }).possession, 'carried');
    assert.equal(normalizeEntry({ possession: 'CARRIED' }).possession, 'carried', 'possession is case-normalized');
    assert.equal(normalizeEntry({ possession: 'bogus' }).possession, '');
    assert.equal(normalizeEntry({ holder: 'Mira' }).holder, 'Mira');
    assert.equal(normalizeEntry('legacy string').possession, '');
});

test('v3 saves migrate with empty overrides; round-trip keeps possession', () => {
    const v3 = { version: 3, history: [{ type: 'ai', narrative: 'x', image: 'blob:zzz' }], codex: { items: { key: { description: 'd', possession: 'stored' } } } };
    const migrated = migrateSave(v3);
    assert.deepEqual(migrated.codexOverrides, { ops: [] });
    assert.equal(migrated.history[0].image, null);
    const payload = buildSavePayload({ ...migrated, codexOverrides: { ops: [{ type: 'patch', atTurn: 1, category: 'items', key: 'key', patch: { pinned: true } }, { type: 'bad' }] } });
    assert.equal(payload.version, SAVE_VERSION);
    assert.equal(payload.codex.items.key.possession, 'stored');
    assert.equal(payload.codexOverrides.ops.length, 1);
    assert.equal(normalizeOverrides(null).ops.length, 0);
});

test('escapeHtml neutralizes markup and safeImageSrc rejects javascript: urls', () => {
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(safeImageSrc('javascript:alert(1)'), '');
    assert.equal(safeImageSrc('blob:https://x/y'), 'blob:https://x/y');
});
