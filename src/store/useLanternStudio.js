import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useMemo, useReducer, } from 'react';
import { initialStudioState, reduceStudio, getCurrentWork, getSavedWorks, } from './lanternStore';
const StudioContext = createContext(null);
const reducer = (state, action) => reduceStudio(state, action);
export const LanternStudioProvider = ({ children, }) => {
    const [state, dispatchBase] = useReducer(reducer, initialStudioState);
    const dispatch = useCallback((action) => {
        dispatchBase(action);
    }, []);
    const value = useMemo(() => ({
        state,
        current: getCurrentWork(state),
        saved: getSavedWorks(state),
        dispatch,
    }), [state, dispatch]);
    return (_jsx(StudioContext.Provider, { value: value, children: children }));
};
export const useLanternStudio = () => {
    const ctx = useContext(StudioContext);
    if (!ctx) {
        throw new Error('useLanternStudio must be used within LanternStudioProvider');
    }
    return ctx;
};
