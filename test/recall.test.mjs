import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bm25Scores, buildRecallDoc, cosine, formatRecallSection, lastAiIndices, rankRecall, tokenize } from '../src/engine/recall.js';

const mk = (i, text, vector = null) => ({ turnIndex: i, pageNumber: i + 1, text: `Page ${i + 1}. ${text}`, tokens: tokenize(text), vector });

test('tokenize lowercases, drops stopwords and short words, trims plurals', () => {
    assert.deepEqual(tokenize("The deputies' rusty keys are in the saloon"), ['deputie', 'rusty', 'key', 'saloon']);
});

test('BM25 ranks the lexical match first and hybrid prefers vector agreement', () => {
    const docs = [mk(0, 'a rusty iron key beneath the gallows'), mk(1, 'Mira warns you about the sheriff'), mk(2, 'the saloon is quiet')];
    const scores = bm25Scores(tokenize('use the iron key'), docs);
    assert.ok(scores[0] > scores[1] && scores[0] > scores[2]);
    const lexical = rankRecall({ queryTokens: tokenize('use the iron key'), docs, k: 3 });
    assert.deepEqual(lexical.map((h) => h.pageNumber), [1], 'docs with no overlap are dropped in lexical mode');

    const v = (x, y) => Float32Array.from([x, y]);
    const vdocs = [mk(0, 'a rusty iron key', v(1, 0)), mk(1, 'the sheriff and his men', v(0, 1)), mk(2, 'a quiet saloon', v(0.7, 0.7))];
    const hybrid = rankRecall({ queryTokens: tokenize('lawmen'), queryVector: v(0, 1), docs: vdocs, k: 2 });
    assert.equal(hybrid[0].pageNumber, 2, 'vector-similar doc wins without lexical overlap');
    assert.ok(cosine(v(1, 0), v(1, 0)) > 0.99);
});

test('exclusion and k are honored, section respects budget and page order', () => {
    const docs = [mk(0, 'key key key'), mk(1, 'key'), mk(2, 'key key')];
    const hits = rankRecall({ queryTokens: ['key'], docs, k: 2, exclude: new Set([0]) });
    assert.deepEqual(hits.map((h) => h.turnIndex), [2, 1]);
    const text = formatRecallSection(hits, 60);
    assert.ok(text.startsWith('- Page 2:'));
    assert.ok(text.length <= 70);
    const long = formatRecallSection([{ pageNumber: 9, text: `Page 9. ${'x'.repeat(500)}` }], 1200);
    assert.ok(long.length < 300);
});

test('buildRecallDoc and lastAiIndices', () => {
    assert.equal(buildRecallDoc({ userActionPreceding: 'go north', summary_update: 'You went north.', narrative: 'Wind.' }, 7), 'Page 7. Action: go north. Beat: You went north. Narrative excerpt: Wind.');
    assert.deepEqual(lastAiIndices([{ type: 'ai' }, { type: 'chapter_marker' }, { type: 'ai' }, { type: 'ai' }], 2), [3, 2]);
});
