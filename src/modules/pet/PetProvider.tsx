import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from 'react';
import { PetProfile, PetAction, PetStatus, PetAnimationState, STATUS_KEYS } from './types';
import { generateInitialPet, applyDecay } from '../../mockService';

interface PetState {
  pet: PetProfile | null;
  animation: PetAnimationState;
  isRegistering: boolean;
}

interface PetContextValue {
  state: PetState;
  dispatch: React.Dispatch<PetAction>;
  registerPet: (type: PetProfile['type'], name: string, ownerName: string) => void;
}

const PetContext = createContext<PetContextValue | null>(null);

function petReducer(state: PetState, action: PetAction): PetState {
  if (!state.pet && action.type !== 'SET_PET') return state;

  switch (action.type) {
    case 'SET_PET':
      return { ...state, pet: action.pet, isRegistering: false };

    case 'FEED': {
      if (!state.pet || state.pet.isDead) return state;
      const status: PetStatus = {
        ...state.pet.status,
        hunger: Math.min(100, state.pet.status.hunger + 25),
        energy: Math.min(100, state.pet.status.energy + 5),
      };
      const isCollapsed = STATUS_KEYS.some(k => status[k] <= 0);
      return {
        ...state,
        pet: { ...state.pet, status, isCollapsed, collapseAt: isCollapsed ? state.pet.collapseAt : null },
        animation: 'jump',
      };
    }

    case 'PLAY': {
      if (!state.pet || state.pet.isDead) return state;
      const status: PetStatus = {
        ...state.pet.status,
        happiness: Math.min(100, state.pet.status.happiness + 25),
        energy: Math.max(0, state.pet.status.energy - 10),
      };
      const isCollapsed = STATUS_KEYS.some(k => status[k] <= 0);
      return {
        ...state,
        pet: { ...state.pet, status, isCollapsed, collapseAt: isCollapsed ? state.pet.collapseAt : null },
        animation: 'spin',
      };
    }

    case 'CLEAN': {
      if (!state.pet || state.pet.isDead) return state;
      const status: PetStatus = {
        ...state.pet.status,
        cleanliness: Math.min(100, state.pet.status.cleanliness + 25),
        happiness: Math.min(100, state.pet.status.happiness + 5),
      };
      const isCollapsed = STATUS_KEYS.some(k => status[k] <= 0);
      return {
        ...state,
        pet: { ...state.pet, status, isCollapsed, collapseAt: isCollapsed ? state.pet.collapseAt : null },
        animation: 'jump',
      };
    }

    case 'DECAY': {
      if (!state.pet || state.pet.isDead) return state;
      const newStatus = applyDecay(state.pet.status, action.elapsed);
      const isCollapsed = STATUS_KEYS.some(k => newStatus[k] <= 0);
      const collapseAt = isCollapsed && !state.pet.isCollapsed ? Date.now() : state.pet.collapseAt;
      return {
        ...state,
        pet: { ...state.pet, status: newStatus, isCollapsed, collapseAt },
        animation: isCollapsed ? 'collapsed' : state.animation === 'collapsed' ? 'idle' : state.animation,
      };
    }

    case 'COLLAPSE': {
      if (!state.pet) return state;
      return {
        ...state,
        pet: { ...state.pet, isCollapsed: true, collapseAt: Date.now() },
        animation: 'collapsed',
      };
    }

    case 'REVIVE': {
      if (!state.pet) return state;
      return {
        ...state,
        pet: {
          ...state.pet,
          isCollapsed: false,
          collapseAt: null,
          status: {
            hunger: Math.max(30, state.pet.status.hunger),
            happiness: Math.max(30, state.pet.status.happiness),
            cleanliness: Math.max(30, state.pet.status.cleanliness),
            energy: Math.max(30, state.pet.status.energy),
          },
        },
        animation: 'jump',
      };
    }

    case 'DIE': {
      if (!state.pet) return state;
      return {
        ...state,
        pet: { ...state.pet, isDead: true },
        animation: 'dying',
      };
    }

    case 'SET_ANIMATION': {
      return { ...state, animation: action.animation };
    }

    default:
      return state;
  }
}

export function PetProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(petReducer, {
    pet: null,
    animation: 'idle',
    isRegistering: true,
  });

  const decayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const collapseCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.pet && !state.pet.isDead) {
      if (decayIntervalRef.current) clearInterval(decayIntervalRef.current);
      decayIntervalRef.current = setInterval(() => {
        const elapsedMinutes = (Date.now() - state.pet!.createdAt) / 60000;
        dispatch({ type: 'DECAY', elapsed: elapsedMinutes });
      }, 5000);
    }
    return () => {
      if (decayIntervalRef.current) clearInterval(decayIntervalRef.current);
    };
  }, [state.pet?.id, state.pet?.isDead]);

  useEffect(() => {
    if (state.pet?.isCollapsed && !state.pet.isDead && state.pet.collapseAt) {
      if (collapseCheckRef.current) clearInterval(collapseCheckRef.current);
      collapseCheckRef.current = setInterval(() => {
        if (state.pet?.collapseAt && Date.now() - state.pet.collapseAt > 30000) {
          dispatch({ type: 'DIE' });
        }
      }, 5000);
    }
    return () => {
      if (collapseCheckRef.current) clearInterval(collapseCheckRef.current);
    };
  }, [state.pet?.isCollapsed, state.pet?.collapseAt, state.pet?.isDead]);

  useEffect(() => {
    if (state.animation === 'jump' || state.animation === 'spin') {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
      animTimeoutRef.current = setTimeout(() => {
        dispatch({ type: 'SET_ANIMATION', animation: state.pet?.isCollapsed ? 'collapsed' : 'idle' });
      }, 300);
    }
    if (state.animation === 'dying') {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
      animTimeoutRef.current = setTimeout(() => {
        dispatch({ type: 'SET_ANIMATION', animation: 'dead' });
      }, 1500);
    }
    return () => {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    };
  }, [state.animation, state.pet?.isCollapsed]);

  const registerPet = useCallback((type: PetProfile['type'], name: string, ownerName: string) => {
    const pet = generateInitialPet(type, name, ownerName);
    dispatch({ type: 'SET_PET', pet });
  }, []);

  return (
    <PetContext.Provider value={{ state, dispatch, registerPet }}>
      {children}
    </PetContext.Provider>
  );
}

export function usePet() {
  const ctx = useContext(PetContext);
  if (!ctx) throw new Error('usePet must be used within PetProvider');
  return ctx;
}

export { PetContext };
