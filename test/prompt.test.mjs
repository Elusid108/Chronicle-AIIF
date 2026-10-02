import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, inventorySections, TURN_SCHEMA } from '../src/engine/prompt.js';
import { sanitizeApiSchema } from '../src/api/gemini.js';
import { mergeCodex } from '../src/engine/memory.js';

const config = { setting: 'noir', style: 'comic', mode: 'choice' };
const codex = mergeCodex({}, [
    { category: 'item', key: 'blue keycard', entry: 'a keycard', possession: 'carried', status: 'scratched' },
    { category: 'item', key: 'rusty sword', entry: 'a sword', possession: 'nearby', holder: 'Mira' },
    { category: 'character', key: 'Mira', entry: 'a courier' },
], 0);

test('prompt carries inventory sections and all unfolded beats', () => {
    const beats = Array.from({ length: 18 }, (_, i) => `beat ${i}`);
    const p = buildSystemPrompt({
        config, initialContext: '', summary: { beats, longTerm: 'long ago', foldedThrough: 3 }, codex, history: [],
        scene: { location: 'Dock 9', present_characters: ['Mira'], open_threads: [] }, styleCard: '', pacing: 'standard',
        currentAction: 'swipe the keycard', recallText: '- Page 2: something old',
    });
    assert.match(p, /INVENTORY \(carried[\s\S]*blue keycard — scratched/);
    assert.match(p, /NEARBY[\s\S]*rusty sword \(held by Mira\)/);
    assert.match(p, /RECALLED EARLIER EVENTS[\s\S]*Page 2/);
    assert.ok(p.includes('beat 0') && p.includes('beat 17'), 'all unfolded beats shown');
    assert.match(p, /8\. INVENTORY/);
});

test('an item mentioned only in the current action is selected into the codex context', () => {
    const junk = {};
    for (let i = 0; i < 40; i++) junk[`junk${i}`] = { description: 'junk', citations: [100 + i] };
    const cx = { characters: {}, places: {}, items: { ...junk, lantern: { description: 'an oil lantern', citations: [1] } } };
    const p = buildSystemPrompt({ config, initialContext: '', summary: { beats: [], longTerm: '', foldedThrough: 0 }, codex: cx, history: [], scene: {}, styleCard: '', pacing: 'standard', currentAction: 'light the lantern' });
    assert.ok(p.includes('"lantern"'));
});

test('inventory sections cap length and say (nothing) when empty', () => {
    const [inv, near] = inventorySections({ characters: {}, places: {}, items: {} }, {});
    assert.match(inv, /\(nothing\)/);
    assert.match(near, /\(nothing\)/);
    const many = {};
    for (let i = 0; i < 60; i++) many[`item number ${i} with a long name`] = { description: 'x', possession: 'carried', status: 'a status string that is long' };
    const [big] = inventorySections({ characters: {}, places: {}, items: many }, {});
    assert.ok(big.length < 1100, `too long: ${big.length}`);
});

test('schema keeps propertyOrdering by default and strips it on request', () => {
    const full = sanitizeApiSchema(TURN_SCHEMA);
    assert.ok(Array.isArray(full.propertyOrdering));
    assert.equal(full.propertyOrdering[0], 'narrative');
    assert.equal(sanitizeApiSchema(TURN_SCHEMA, { stripOrdering: true }).propertyOrdering, undefined);
    assert.equal(full.properties.codex_updates.maxItems, 20, 'non-stripped keys survive');
    assert.ok(TURN_SCHEMA.properties.scene.required.includes('present_characters'));
    assert.deepEqual(TURN_SCHEMA.properties.codex_updates.items.properties.possession.enum, ['carried', 'nearby', 'stored', 'lost', 'unknown']);
});
