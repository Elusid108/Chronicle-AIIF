import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldTurn, initialEndingRemaining, rebuildBase, abortAllAssetSignals } from '../src/engine/session.js';

const aiTurn = (i, extra = {}) => ({
    type: 'ai', narrative: `Page ${i + 1} text`, summary_update: `beat ${i}`, scene: { location: `L${i}`, present_characters: [], open_threads: [] },
    codex_updates: [{ category: 'item', key: `item${i}`, entry: `item ${i}`, possession: 'carried' }], state_updates: [], userActionPreceding: i ? `act ${i}` : null, ...extra,
});

test('ending length N yields exactly N ending turns', () => {
    let remaining = initialEndingRemaining(5);
    let turns = 1;
    while (remaining > 0) { remaining = Math.max(0, remaining - 1); turns += 1; }
    assert.equal(turns, 5);
    assert.equal(initialEndingRemaining(1), 0);
});

test('foldTurn stamps ending state on the turn and rebuildBase derives it back', () => {
    const base = { history: [aiTurn(0)], codex: { characters: {}, places: {}, items: {} }, summary: { beats: ['b0'], longTerm: '', foldedThrough: 0 }, stats: {}, scene: {} };
    const data = { narrative: 'x', choices: ['a'], summary_update: 'b1', image_prompt: '', codex_updates: [], scene: {} };
    const { newTurn } = foldTurn(base, data, {}, 'go', [], 'choice', { isEnding: true, endingRemaining: 2 });
    assert.equal(newTurn.isEnding, true);
    assert.equal(newTurn.endingRemaining, 2);
    const rebuilt = rebuildBase([aiTurn(0), newTurn]);
    assert.equal(rebuilt.isEnding, true);
    assert.equal(rebuilt.turnsRemaining, 2);
    assert.equal(rebuilt.isFinished, false);
    const finale = foldTurn(base, data, {}, 'go', [], 'choice', { isEnding: true, endingRemaining: 0, finale: true }).newTurn;
    assert.equal(rebuildBase([aiTurn(0), finale]).isFinished, true);
    assert.equal(rebuildBase([aiTurn(0)]).isEnding, false);
});

test('rebuildBase replays codex overrides at the right turn and keeps longTerm by beat count', () => {
    const history = [aiTurn(0), aiTurn(1), aiTurn(2)];
    const overrides = { ops: [{ type: 'patch', atTurn: 2, category: 'items', key: 'item0', patch: { possession: 'lost' } }] };
    const b = rebuildBase(history, { beats: ['beat 2'], longTerm: 'long', foldedThrough: 2 }, overrides);
    assert.equal(b.codex.items.item0.possession, 'lost');
    assert.equal(b.codex.items.item1.possession, 'carried');
    assert.equal(b.summary.longTerm, 'long');
    assert.deepEqual(b.summary.beats, ['beat 2']);
    const short = rebuildBase(history.slice(0, 1), { beats: [], longTerm: 'long', foldedThrough: 2 }, overrides);
    assert.equal(short.summary.longTerm, '', 'rewound into the folded prefix drops longTerm');
    assert.equal(short.codex.items.item0.possession, 'carried', 'override at turn 2 not applied with one turn');
});

test('abortAllAssetSignals can spare background jobs', () => {
    const map = { current: new Map([['bg:page:3', new AbortController()], ['portrait:x', new AbortController()]]) };
    abortAllAssetSignals(map, { exceptPrefix: 'bg:' });
    assert.ok(map.current.has('bg:page:3'));
    assert.ok(!map.current.has('portrait:x'));
    abortAllAssetSignals(map);
    assert.equal(map.current.size, 0);
});
