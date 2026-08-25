import { GENRE_PROMPTS, STYLE_PROMPTS, EMPTY_SCENE } from '../constants.js';
import { normalizeSummary } from '../utils/storage.js';
import { selectRelevantCodex, recentNarratives } from './memory.js';

const CODEX_UPDATE_ITEM = {
    type: 'object',
    properties: {
        category: { type: 'string', enum: ['character', 'place', 'item'] },
        key: { type: 'string' },
        entry: { type: 'string' },
        visual: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        status: { type: 'string' },
        location: { type: 'string' },
    },
    required: ['category', 'key', 'entry'],
};

// Structured-output schema. narrative is ordered first so it streams earliest.
export const TURN_SCHEMA = {
    type: 'object',
    properties: {
        narrative: { type: 'string' },
        image_prompt: { type: 'string' },
        codex_updates: { type: 'array', items: CODEX_UPDATE_ITEM, maxItems: 20 },
        choices: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        summary_update: { type: 'string' },
        scene: {
            type: 'object',
            properties: {
                location: { type: 'string' },
                time_of_day: { type: 'string' },
                present_characters: { type: 'array', items: { type: 'string' }, maxItems: 12 },
                goal: { type: 'string' },
                open_threads: { type: 'array', items: { type: 'string' }, maxItems: 6 },
            },
        },
        state_updates: {
            type: 'array',
            items: {
                type: 'object',
                properties: { key: { type: 'string' }, value: { type: 'string' } },
                required: ['key', 'value'],
            },
            maxItems: 12,
        },
    },
    required: ['narrative', 'choices', 'summary_update', 'image_prompt', 'codex_updates', 'scene'],
    propertyOrdering: ['narrative', 'image_prompt', 'codex_updates', 'choices', 'summary_update', 'scene', 'state_updates'],
};

export const LORE_BACKFILL_SCHEMA = {
    type: 'object',
    properties: {
        codex_updates: { type: 'array', items: CODEX_UPDATE_ITEM, maxItems: 16 },
    },
    required: ['codex_updates'],
};

export const buildTurnSchema = (mode = 'choice') => {
    if (mode !== 'text') return TURN_SCHEMA;
    return {
        ...TURN_SCHEMA,
        required: TURN_SCHEMA.required.filter((key) => key !== 'choices'),
    };
};

const resolveText = (value, custom, map) => {
    const key = value === 'custom' ? custom : value;
    return map[key] || key;
};

export const genreText = (config) => resolveText(config.setting, config.settingCustom, GENRE_PROMPTS);
export const styleText = (config) => resolveText(config.style, config.styleCustom, STYLE_PROMPTS);

const choiceTask = (mode) => {
    if (mode === 'text') {
        return `2. CHOICES: Do not invent suggested actions. Omit choices or return an empty array. The player types freely.`;
    }
    return `2. CHOICES: Provide exactly 4 distinct, full-phrase choices in the choices array every turn (unless this is a final conclusion turn, then return an empty array).`;
};

const pacingTask = (pacing) => {
    if (pacing === 'direct') {
        return `PACING: Direct. Write 2–4 short second-person sentences. Name the salient objects, exits, and people in plain language. No atmosphere, metaphor, or purple prose. Example: "You wake up in a dark room. There is a locked door, a bed, a chair, and a crate. What do you do?"`;
    }
    return `PACING: Standard. Literary second-person prose with atmosphere and sensory detail, at the usual length.`;
};

export const buildSystemPrompt = ({
    config, initialContext, summary, codex, history, statsEnabled, stats, scene, styleCard, pacing,
}) => {
    const genre = genreText(config);
    const style = styleText(config);
    const norm = normalizeSummary(summary);
    const currentScene = scene && typeof scene === 'object' ? scene : EMPTY_SCENE;

    const lastAction = (() => {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]?.userActionPreceding) return history[i].userActionPreceding;
        }
        return '';
    })();
    const recentBeatsText = norm.beats.slice(-14).join('\n') || '(none yet)';
    const recentText = `${recentBeatsText}\n${lastAction}\n${currentScene.location || ''}\n${(currentScene.present_characters || []).join(' ')}`;
    const { codex: relevantCodex, omitted } = selectRelevantCodex(codex, recentText, currentScene, 24);
    const proseCount = styleCard ? 1 : 2;
    const recent = recentNarratives(history, proseCount);

    const sections = [
        `ROLE: AI Game Master & Loremaster.`,
        `GENRE: ${genre}`,
        `VISUAL STYLE: ${style}. Describe scenes so the image generator can match this aesthetic.`,
        `PLAYER REQUEST: ${initialContext || '(None)'}. The story MUST honor this premise and tone.`,
    ];

    sections.push(pacingTask(pacing));

    if (styleCard) {
        const cardNote = pacing === 'direct'
            ? 'VOICE / STYLE CARD (keep person/tense; prefer Direct brevity over this card\'s length):\n'
            : 'VOICE / STYLE CARD:\n';
        sections.push(`${cardNote}${styleCard}`);
    }

    sections.push(`CURRENT SCENE (authoritative; keep this consistent unless the action changes it):\n${JSON.stringify(currentScene)}`);

    if (norm.longTerm) sections.push(`STORY SO FAR (compressed history):\n${norm.longTerm}`);
    sections.push(`RECENT EVENTS (running log):\n${recentBeatsText}`);

    if (recent.length) {
        const proseLead = pacing === 'direct'
            ? 'PREVIOUS PROSE (keep person and tense; do not match its length if it was longer; do not repeat it):\n'
            : 'PREVIOUS PROSE (continue this exact voice, tone, and tense; do not repeat it):\n';
        sections.push(
            proseLead +
            recent.map((n, i) => `[${i === recent.length - 1 ? 'most recent' : 'earlier'}]\n${n}`).join('\n---\n')
        );
    }

    sections.push(
        `RELEVANT CODEX${omitted ? ` (showing most relevant; ${omitted} more on record)` : ''}:\n` +
        JSON.stringify(relevantCodex)
    );

    if (statsEnabled && stats && Object.keys(stats).length) {
        sections.push(`PLAYER STATE (current values, update via state_updates when they change):\n${JSON.stringify(stats)}`);
    }

    const extra = [
        `6. SCENE: Fill scene with short literal values only: location (place name), time_of_day (e.g. "Midnight, rainy"), present_characters, a one-line goal, and up to 6 open_threads. Never self-correct, never write "let's clean up", never dump clocks/metrics/indexes, never repeat a phrase.`,
        `7. CODEX FIELDS: For each update you may set visual (one-line appearance for the painter), aliases, status, and location. Use category "character", "place", or "item".`,
    ];
    if (statsEnabled) extra.push(`8. STATE: When the player's tracked stats change (health, resources, etc.), reflect it in state_updates as key/value pairs.`);

    sections.push(
`TASK:
1. NARRATIVE: Write the next segment in SECOND PERSON ("You..."). The player IS the protagonist. Follow PACING. Maintain continuity with PREVIOUS PROSE. The narrative must NOT include the numbered choice list. The narrative ends with a setup question (e.g. "What do you do?").
${choiceTask(config.mode)}
3. LORE SCANNING (CRITICAL): Add codex_updates THIS TURN for every named character, location, and significant item in your narrative — including unnamed-but-distinct objects the player finds or uses (a plasma cutter, a locked journal, a keycard). If an entity is new, add it with a short visual; if a known entity gains detail, update it. Do not skip items sitting in bags, rooms, or inventory.
4. SUMMARY: summary_update is a concise one-to-two sentence log of what happened THIS turn only.
5. VISUALS: image_prompt describes the scene for the image generator in the chosen visual style. Do NOT use proper names (the painter does not know who "Kael" is); use visual descriptions ("a scar-faced soldier").
${extra.join('\n')}`
    );

    return sections.join('\n\n');
};

export const endingInstruction = (turnsRemaining, mode = 'choice') => {
    if (turnsRemaining > 1) {
        const choiceLine = mode === 'text'
            ? 'Do not provide suggested choices; return an empty choices array.'
            : 'Still provide 4 choices.';
        return `\n\nCRITICAL: ENDING SEQUENCE. ${turnsRemaining} beats remain, including this one. ${choiceLine} Steer toward a satisfying conclusion. Keep the JSON complete; do not truncate fields.`;
    }
    return `\n\nCRITICAL: FINAL TURN. Deliver a satisfying conclusion. Return an empty choices array. Do NOT end with a setup question. Keep the JSON complete; do not truncate fields.`;
};

export const buildInitialPrompt = (config, initialContext) =>
    `Start the story. Genre: ${genreText(config)}. Visual style: ${styleText(config)}. Player's premise: ${initialContext || 'Open-ended'}. Begin the narrative.`;

export const buildActionPrompt = (input, extras = {}) => {
    let msg = `User action: "${input}". Continue.`;
    if (extras.roll) msg += ` [Dice: ${extras.roll}]`;
    return msg;
};
