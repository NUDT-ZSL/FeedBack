import { PetType } from '../pet/types';

export interface PetCardData {
  id: string;
  name: string;
  type: PetType;
  ownerName: string;
  healthScore: number;
  likes: number;
}

export interface SocialState {
  petCards: PetCardData[];
  currentPage: number;
  totalPages: number;
  selectedPetId: string | null;
}

export type SocialAction =
  | { type: 'SET_CARDS'; cards: PetCardData[] }
  | { type: 'LIKE_PET'; petId: string }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SELECT_PET'; petId: string | null };
