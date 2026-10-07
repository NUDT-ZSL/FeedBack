import { createLanternWork, } from '../types';
export const defaultIdGenerator = {
    workId: () => `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    randomId: () => Math.random().toString(36).slice(2, 8).toUpperCase(),
    now: () => Date.now(),
};
export const initialStudioState = {
    works: {},
    order: [],
    currentId: null,
};
const touch = (work, now) => ({
    ...work,
    updatedAt: now,
});
export function getCurrentWork(state) {
    return state.currentId ? state.works[state.currentId] ?? null : null;
}
export function getSavedWorks(state) {
    return state.order
        .map((id) => state.works[id])
        .filter((w) => Boolean(w) && w.savedAt !== null);
}
export function reduceStudio(state, action, ids = defaultIdGenerator) {
    switch (action.type) {
        case 'newWork': {
            const id = ids.workId();
            const work = createLanternWork(id, ids.randomId(), ids.now());
            return {
                works: { ...state.works, [id]: work },
                order: [...state.order, id],
                currentId: id,
            };
        }
        case 'switchWork': {
            if (!state.works[action.id])
                return state;
            if (state.currentId === action.id)
                return state;
            return { ...state, currentId: action.id };
        }
        case 'setSkeleton': {
            const current = getCurrentWork(state);
            if (!current)
                return state;
            const next = touch({ ...current, skeleton: action.skeletonId }, ids.now());
            return { ...state, works: { ...state.works, [current.id]: next } };
        }
        case 'setSilk': {
            const current = getCurrentWork(state);
            if (!current || !current.skeleton)
                return state;
            const next = touch({ ...current, silkColor: action.silkId }, ids.now());
            return { ...state, works: { ...state.works, [current.id]: next } };
        }
        case 'commitStroke': {
            const targetId = action.workId ?? state.currentId;
            if (!targetId)
                return state;
            const work = state.works[targetId];
            if (!work || !work.skeleton || !work.silkColor)
                return state;
            const next = touch({ ...work, strokes: [...work.strokes, action.stroke] }, ids.now());
            return { ...state, works: { ...state.works, [targetId]: next } };
        }
        case 'commitLine': {
            const targetId = action.workId ?? state.currentId;
            if (!targetId)
                return state;
            const work = state.works[targetId];
            if (!work || !work.skeleton || !work.silkColor)
                return state;
            const next = touch({ ...work, lines: [...work.lines, action.line] }, ids.now());
            return { ...state, works: { ...state.works, [targetId]: next } };
        }
        case 'setLit': {
            const current = getCurrentWork(state);
            if (!current || !current.skeleton || !current.silkColor)
                return state;
            if (current.isLit === action.isLit)
                return state;
            const next = touch({ ...current, isLit: action.isLit }, ids.now());
            return { ...state, works: { ...state.works, [current.id]: next } };
        }
        case 'saveCurrent': {
            const current = getCurrentWork(state);
            if (!current || !current.isLit || !current.skeleton || !current.silkColor) {
                return state;
            }
            const next = { ...touch({ ...current }, ids.now()), savedAt: ids.now() };
            return {
                ...state,
                works: { ...state.works, [current.id]: next },
            };
        }
        case 'removeWork': {
            if (!state.works[action.id])
                return state;
            const works = { ...state.works };
            delete works[action.id];
            const order = state.order.filter((id) => id !== action.id);
            const currentId = state.currentId === action.id
                ? order[order.length - 1] ?? null
                : state.currentId;
            return { works, order, currentId };
        }
        case 'clearCurrent': {
            const current = getCurrentWork(state);
            if (!current)
                return state;
            const wasSaved = current.savedAt !== null;
            const works = { ...state.works };
            if (wasSaved) {
                delete works[current.id];
                const order = state.order.filter((id) => id !== current.id);
                const currentId = order[order.length - 1] ?? null;
                return { works, order, currentId };
            }
            const reset = touch(createLanternWork(current.id, current.randomId, current.createdAt), ids.now());
            works[current.id] = reset;
            return { ...state, works };
        }
        case 'reset':
            return initialStudioState;
        default:
            return state;
    }
}
export function invariantReport(state) {
    const violations = [];
    const workIds = new Set(Object.keys(state.works));
    for (const id of state.order) {
        if (!workIds.has(id)) {
            violations.push(`order 中存在已删除作品的悬空引用: ${id}`);
        }
    }
    if (state.order.length !== workIds.size) {
        violations.push(`order(${state.order.length}) 与 works(${workIds.size}) 数量不一致，可能存在重复条目`);
    }
    if (state.currentId !== null && !workIds.has(state.currentId)) {
        violations.push(`currentId 指向已删除作品: ${state.currentId}`);
    }
    for (const [id, work] of Object.entries(state.works)) {
        if (work.id !== id) {
            violations.push(`作品 key(${id}) 与 work.id(${work.id}) 不一致`);
        }
    }
    return violations;
}
