import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyCodexOverrides, carriedItems, mergeCodex, mergeScene, nearbyItems, scrubImagePrompt,
    selectRelevantCodex, splitBeatsForCompaction, unknownProperNouns, visualForEntry, updateCodexEntry,
    pruneCodexOverrides, mentionedIn,
} from '../src/engine/memory.js';

const codex = () => mergeCodex({}, [
    { category: 'character', key: 'Kael Voss', entry: 'Kael Voss is a scarred mercenary.', aliases: ['Kael'], visual: 'a scar-faced soldier in grey armor' },
    { category: 'character', key: 'Mira', entry: 'Mira, a nervous courier' },
    { category: 'place', key: 'Sector 4', entry: 'a neon slum', visual: 'neon-lit slum towers' },
    { category: 'item', key: 'keycard', entry: 'a blue keycard', possession: 'carried' },
    { category: 'item', key: 'door', entry: 'a reinforced door' },
], 0);

test('scrubImagePrompt replaces short character names and aliases, keeps common item words', () => {
    const out = scrubImagePrompt('Kael and Mira cross Sector 4 holding the keycard by the door; kael_voss frowns; Kaelix is a city', codex());
    assert.ok(!/\bKael\b/.test(out), out);
    assert.ok(!/\bMira\b/.test(out), out);
    assert.ok(!/Sector 4/.test(out), out);
    assert.ok(/keycard/.test(out) && /door/.test(out), out);
    assert.ok(/Kaelix/.test(out), 'partial matches untouched');
    assert.ok(/a scar-faced soldier in grey armor/.test(out));
});

test('visualForEntry never reintroduces the name', () => {
    assert.equal(visualForEntry('Mira', { description: 'Mira, a nervous courier' }, 'characters'), 'a nervous courier');
    assert.equal(visualForEntry('Mira', {}, 'characters'), 'a figure');
    assert.equal(visualForEntry('Old Mill', {}, 'places'), 'a place');
});

test('mentionedIn matches underscore keys against spaced prose', () => {
    assert.ok(mentionedIn('Kael Voss walks in', 'kael_voss'));
    assert.ok(!mentionedIn('Kaelix walks in', 'Kael'));
});

test('compaction triggers only past the window + slack and folds the oldest beats', () => {
    const beats = (n) => Array.from({ length: n }, (_, i) => `beat ${i}`);
    assert.equal(splitBeatsForCompaction({ beats: beats(20), longTerm: '', foldedThrough: 0 }), null);
    const split = splitBeatsForCompaction({ beats: beats(21), longTerm: '', foldedThrough: 0 });
    assert.equal(split.toFold.length, 7);
    assert.equal(split.keep.length, 14);
});

test('status/location can be cleared with "none"', () => {
    let cx = mergeCodex({}, [{ category: 'item', key: 'lamp', entry: 'a lamp', status: 'lit', location: 'the hall' }], 0);
    assert.equal(cx.items.lamp.status, 'lit');
    cx = mergeCodex(cx, [{ category: 'item', key: 'lamp', entry: 'a lamp', status: 'none' }], 1);
    assert.equal(cx.items.lamp.status, '');
    assert.equal(cx.items.lamp.location, 'the hall');
});

test('mergeScene replaces arrays when present (even empty) and keeps them when absent', () => {
    const base = { location: 'Hall', present_characters: ['Mira'], open_threads: ['find key'] };
    assert.deepEqual(mergeScene(base, { present_characters: [] }).present_characters, []);
    assert.deepEqual(mergeScene(base, {}).present_characters, ['Mira']);
    assert.deepEqual(mergeScene(base, { open_threads: ['x'] }).open_threads, ['x']);
});

test('possession: explicit value replaces and resets holder; carried items are always relevant', () => {
    let cx = mergeCodex({}, [{ category: 'item', key: 'sword', entry: 'a sword', possession: 'nearby', holder: 'Mira' }], 0);
    assert.equal(cx.items.sword.holder, 'Mira');
    cx = mergeCodex(cx, [{ category: 'item', key: 'sword', entry: 'taken', possession: 'carried' }], 1);
    assert.equal(cx.items.sword.possession, 'carried');
    assert.equal(cx.items.sword.holder, '');
    cx = mergeCodex(cx, [{ category: 'item', key: 'sword', entry: 'detail', status: 'notched' }], 2);
    assert.equal(cx.items.sword.possession, 'carried', 'no possession field keeps the old value');
    assert.deepEqual(carriedItems(cx).map((r) => r.key), ['sword']);

    const junk = {};
    for (let i = 0; i < 40; i++) junk[`junk${i}`] = { description: 'junk', citations: [100 + i] };
    const sel = selectRelevantCodex({ ...cx, items: { ...junk, ...cx.items } }, '', { location: 'x' }, 24);
    assert.ok(sel.codex.items.sword, 'carried item forced into context');
    assert.equal(sel.codex.items.sword.possession, 'carried');
});

test('nearbyItems includes items marked nearby or held by someone present', () => {
    const cx = mergeCodex({}, [
        { category: 'item', key: 'amulet', entry: 'an amulet', possession: 'unknown', holder: 'Mira' },
        { category: 'item', key: 'crate', entry: 'a crate', possession: 'nearby' },
        { category: 'item', key: 'coin', entry: 'a coin', possession: 'lost', holder: 'Mira' },
    ], 0);
    assert.deepEqual(nearbyItems(cx, { present_characters: ['Mira'] }).map((r) => r.key).sort(), ['amulet', 'crate']);
    assert.deepEqual(nearbyItems(cx, { present_characters: [] }).map((r) => r.key), ['crate']);
});

test('pinned entries are always selected and appear in compact form', () => {
    let cx = codex();
    cx = updateCodexEntry(cx, 'items', 'door', { pinned: true });
    const sel = selectRelevantCodex(cx, 'nothing relevant', { location: 'elsewhere' }, 1);
    assert.ok(sel.codex.items.door);
    assert.equal(sel.codex.items.door.pinned, true);
});

test('codex overrides replay at their turn, skip missing entries, and prune on rewind', () => {
    const overrides = { ops: [
        { type: 'patch', atTurn: 1, category: 'items', key: 'keycard', patch: { possession: 'lost' } },
        { type: 'merge', atTurn: 2, category: 'characters', from: 'Kael Voss', into: 'Mira' },
        { type: 'patch', atTurn: 2, category: 'items', key: 'ghost', patch: { pinned: true } },
    ] };
    const cx1 = applyCodexOverrides(codex(), overrides, 1);
    assert.equal(cx1.items.keycard.possession, 'lost');
    assert.ok(cx1.characters['Kael Voss'], 'turn-2 op not applied at turn 1');
    const cx2 = applyCodexOverrides(cx1, overrides, 2);
    assert.ok(!cx2.characters['Kael Voss']);
    assert.ok(cx2.characters.Mira.aliases.includes('Kael Voss'));
    assert.equal(pruneCodexOverrides(overrides, 1).ops.length, 1);
});

test('unknownProperNouns finds capitalized names the codex does not know', () => {
    const found = unknownProperNouns('You see Kael. Then Captain Reyes steps out of the Iron Spire. "Run," says Mira. The door creaks.', codex(), { location: 'Sector 4' });
    assert.deepEqual(found, ['Reyes', 'Iron Spire']);
    assert.deepEqual(unknownProperNouns('Kael nods at Mira.', codex()), []);
});
