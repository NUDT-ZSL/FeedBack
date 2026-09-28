import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import { PetCardData, SocialState, SocialAction } from './types';
import { generateMockPets, petToCardData } from '../../mockService';

const PAGE_SIZE = 12;

const initialState: SocialState = {
  petCards: [],
  currentPage: 1,
  totalPages: 1,
  selectedPetId: null,
};

function socialReducer(state: SocialState, action: SocialAction): SocialState {
  switch (action.type) {
    case 'SET_CARDS': {
      const totalPages = Math.max(1, Math.ceil(action.cards.length / PAGE_SIZE));
      return { ...state, petCards: action.cards, totalPages };
    }
    case 'LIKE_PET': {
      const petCards = state.petCards.map(card =>
        card.id === action.petId ? { ...card, likes: card.likes + 1 } : card
      );
      return { ...state, petCards };
    }
    case 'SET_PAGE':
      return { ...state, currentPage: action.page };
    case 'SELECT_PET':
      return { ...state, selectedPetId: action.petId };
    default:
      return state;
  }
}

interface SocialContextValue {
  state: SocialState;
  dispatch: React.Dispatch<SocialAction>;
  getCurrentPageCards: () => PetCardData[];
  likePet: (petId: string) => void;
}

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(socialReducer, initialState);

  useEffect(() => {
    const pets = generateMockPets(36);
    const cards = pets.map(petToCardData);
    dispatch({ type: 'SET_CARDS', cards });
  }, []);

  const getCurrentPageCards = useCallback(() => {
    const start = (state.currentPage - 1) * PAGE_SIZE;
    return state.petCards.slice(start, start + PAGE_SIZE);
  }, [state.petCards, state.currentPage]);

  const likePet = useCallback((petId: string) => {
    dispatch({ type: 'LIKE_PET', petId });
  }, []);

  return (
    <SocialContext.Provider value={{ state, dispatch, getCurrentPageCards, likePet }}>
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial must be used within SocialProvider');
  return ctx;
}
