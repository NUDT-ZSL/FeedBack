"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryEngine = exports.DIFFICULTY_CONFIGS = void 0;
exports.mulberry32 = mulberry32;
exports.shuffleWithRng = shuffleWithRng;
exports.generateCards = generateCards;
exports.DIFFICULTY_CONFIGS = {
    easy: { rows: 3, cols: 3, pairs: 4 },
    medium: { rows: 4, cols: 4, pairs: 8 },
    hard: { rows: 6, cols: 5, pairs: 15 },
};
const EMOJI_POOL = [
    '🚀', '🌟', '🌙', '🌈', '🔥', '🍀', '🎵', '⚡',
    '💎', '🎮', '🌸', '🦋', '🍕', '🎨', '🐱', '🎯',
    '🍦', '🌺', '🦄', '🎭', '🍰', '🌊', '🎪', '🐼',
    '🍩', '🎈', '🦊', '🎠', '🍭', '🌴',
];
/** Deterministic PRNG so a game can be replayed from its seed. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffleWithRng(array, rng) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function generateCards(pairsCount, rng) {
    const selectedEmojis = shuffleWithRng(EMOJI_POOL, rng).slice(0, pairsCount);
    const cardPairs = [];
    let id = 0;
    for (const emoji of selectedEmojis) {
        cardPairs.push({ id: id++, symbol: emoji, isFlipped: false, isMatched: false }, { id: id++, symbol: emoji, isFlipped: false, isMatched: false });
    }
    return shuffleWithRng(cardPairs, rng);
}
function cloneCards(cards) {
    return cards.map((c) => ({ ...c }));
}
/**
 * Pure, DOM-free memory-match engine.
 *
 * Every flip / match / unflip is recorded as an ordered action in an
 * append-only, branched history log. Each log entry stores the full
 * snapshot taken after its action, so any historical state can be
 * restored exactly (board, stats and timer). Undoing and then acting
 * appends a new branch after the rewind point; the original record is
 * never overwritten.
 */
class MemoryEngine {
    constructor(config, seed) {
        this.lastTickNow = 0;
        this.log = [];
        this.cursor = 0;
        this.config = config;
        this.seed = seed;
        this.state = {
            cards: generateCards(config.pairs, mulberry32(seed)),
            matchedPairs: 0,
            moves: 0,
            started: false,
            timerRunning: false,
            elapsedMs: 0,
            settled: false,
            finalElapsedMs: null,
            finalMoves: null,
        };
        this.log = [
            { id: 0, parentId: -1, action: null, snapshot: this.takeSnapshot(), children: [] },
        ];
        this.cursor = 0;
    }
    get history() {
        return this.log;
    }
    get cursorId() {
        return this.cursor;
    }
    snapshot() {
        return this.takeSnapshot();
    }
    takeSnapshot() {
        return { ...this.state, cards: cloneCards(this.state.cards) };
    }
    restore(snapshot, now) {
        this.state = { ...snapshot, cards: cloneCards(snapshot.cards) };
        this.lastTickNow = now;
    }
    record(action) {
        const entry = {
            id: this.log.length,
            parentId: this.cursor,
            action,
            snapshot: this.takeSnapshot(),
            children: [],
        };
        this.log[this.cursor].children.push(entry.id);
        this.log.push(entry);
        this.cursor = entry.id;
    }
    /** Advance the logical timer; returns the current elapsed time. */
    tick(now) {
        if (this.state.timerRunning) {
            this.state.elapsedMs += now - this.lastTickNow;
        }
        this.lastTickNow = now;
        return this.state.elapsedMs;
    }
    openUnmatched() {
        return this.state.cards.filter((c) => c.isFlipped && !c.isMatched);
    }
    flip(cardId, now) {
        const s = this.state;
        if (s.settled)
            return { kind: 'ignored' };
        const card = s.cards.find((c) => c.id === cardId);
        if (!card || card.isFlipped || card.isMatched)
            return { kind: 'ignored' };
        const open = this.openUnmatched();
        // Invariant: never more than two unmatched cards face up.
        if (open.length >= 2)
            return { kind: 'ignored' };
        this.tick(now);
        if (!s.started) {
            s.started = true;
            s.timerRunning = true;
            this.lastTickNow = now;
        }
        s.moves++;
        card.isFlipped = true;
        this.record({ type: 'flip', cardIds: [cardId] });
        if (open.length === 0) {
            return { kind: 'flipped', cardId };
        }
        const first = open[0];
        if (first.symbol !== card.symbol) {
            return { kind: 'mismatch', cardIds: [first.id, card.id] };
        }
        first.isMatched = true;
        card.isMatched = true;
        s.matchedPairs++;
        const won = s.matchedPairs === this.config.pairs;
        if (won) {
            this.tick(now);
            s.timerRunning = false;
            s.settled = true;
            s.finalElapsedMs = s.elapsedMs;
            s.finalMoves = s.moves;
        }
        this.record({ type: 'match', cardIds: [first.id, card.id] });
        return { kind: 'matched', cardIds: [first.id, card.id], won };
    }
    /** Flip the two currently open mismatched cards back down. */
    resolveMismatch(now) {
        const s = this.state;
        if (s.settled)
            return [];
        const open = this.openUnmatched();
        if (open.length !== 2)
            return [];
        this.tick(now);
        for (const card of open)
            card.isFlipped = false;
        this.record({ type: 'unflip', cardIds: [open[0].id, open[1].id] });
        return [open[0].id, open[1].id];
    }
    canUndo() {
        return !this.state.settled && this.cursor !== 0;
    }
    canRedo() {
        return !this.state.settled && this.log[this.cursor].children.length > 0;
    }
    undo(now) {
        if (!this.canUndo())
            return false;
        this.cursor = this.log[this.cursor].parentId;
        this.restore(this.log[this.cursor].snapshot, now);
        return true;
    }
    redo(now) {
        if (!this.canRedo())
            return false;
        const children = this.log[this.cursor].children;
        // Follow the most recently created branch.
        this.cursor = children[children.length - 1];
        this.restore(this.log[this.cursor].snapshot, now);
        return true;
    }
}
exports.MemoryEngine = MemoryEngine;
