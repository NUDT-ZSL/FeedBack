import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { Pet, Diary, Comment } from '../types';
import api from '../utils/api';

interface AppState {
  pets: Pet[];
  petsLoading: boolean;
  diaries: Diary[];
  diariesLoading: boolean;
  communityDiaries: Diary[];
  communityLoading: boolean;
  error: string | null;
  hasMoreDiaries: boolean;
  currentPage: number;
}

type Action =
  | { type: 'SET_PETS'; payload: Pet[] }
  | { type: 'ADD_PET'; payload: Pet }
  | { type: 'UPDATE_PET_STATUS'; payload: { id: string; status: Pet['status'] } }
  | { type: 'SET_PETS_LOADING'; payload: boolean }
  | { type: 'SET_DIARIES'; payload: { data: Diary[]; hasMore: boolean; page: number; append?: boolean } }
  | { type: 'ADD_DIARY'; payload: Diary }
  | { type: 'UPDATE_DIARY_LIKE'; payload: { id: string; likes: number; liked: boolean } }
  | { type: 'ADD_DIARY_COMMENT'; payload: { diaryId: string; comment: Comment } }
  | { type: 'SET_DIARIES_LOADING'; payload: boolean }
  | { type: 'SET_COMMUNITY_DIARIES'; payload: Diary[] }
  | { type: 'SET_COMMUNITY_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'ROLLBACK_PET'; payload: Pet }
  | { type: 'ROLLBACK_DIARY'; payload: Diary };

const initialState: AppState = {
  pets: [],
  petsLoading: false,
  diaries: [],
  diariesLoading: false,
  communityDiaries: [],
  communityLoading: false,
  error: null,
  hasMoreDiaries: true,
  currentPage: 0
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PETS':
      return { ...state, pets: action.payload };
    case 'ADD_PET':
      return { ...state, pets: [action.payload, ...state.pets] };
    case 'UPDATE_PET_STATUS':
      return {
        ...state,
        pets: state.pets.map(p =>
          p.id === action.payload.id ? { ...p, status: action.payload.status } : p
        )
      };
    case 'SET_PETS_LOADING':
      return { ...state, petsLoading: action.payload };
    case 'SET_DIARIES':
      if (action.payload.append) {
        return {
          ...state,
          diaries: [...state.diaries, ...action.payload.data],
          hasMoreDiaries: action.payload.hasMore,
          currentPage: action.payload.page
        };
      }
      return {
        ...state,
        diaries: action.payload.data,
        hasMoreDiaries: action.payload.hasMore,
        currentPage: action.payload.page
      };
    case 'ADD_DIARY':
      return {
        ...state,
        diaries: [action.payload, ...state.diaries],
        communityDiaries: [action.payload, ...state.communityDiaries]
      };
    case 'UPDATE_DIARY_LIKE':
      const updateLike = (diaries: Diary[]) =>
        diaries.map(d =>
          d.id === action.payload.id
            ? { ...d, likes: action.payload.likes, liked: action.payload.liked }
            : d
        );
      return {
        ...state,
        diaries: updateLike(state.diaries),
        communityDiaries: updateLike(state.communityDiaries)
      };
    case 'ADD_DIARY_COMMENT':
      const addComment = (diaries: Diary[]) =>
        diaries.map(d =>
          d.id === action.payload.diaryId
            ? { ...d, comments: [...d.comments, action.payload.comment] }
            : d
        );
      return {
        ...state,
        diaries: addComment(state.diaries),
        communityDiaries: addComment(state.communityDiaries)
      };
    case 'SET_DIARIES_LOADING':
      return { ...state, diariesLoading: action.payload };
    case 'SET_COMMUNITY_DIARIES':
      return { ...state, communityDiaries: action.payload };
    case 'SET_COMMUNITY_LOADING':
      return { ...state, communityLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'ROLLBACK_PET':
      return {
        ...state,
        pets: state.pets.filter(p => p.id !== action.payload.id)
      };
    case 'ROLLBACK_DIARY':
      return {
        ...state,
        diaries: state.diaries.filter(d => d.id !== action.payload.id),
        communityDiaries: state.communityDiaries.filter(d => d.id !== action.payload.id)
      };
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  fetchPets: () => Promise<void>;
  addPet: (formData: FormData) => Promise<Pet | null>;
  updatePetStatus: (id: string, status: Pet['status']) => Promise<void>;
  fetchDiaries: (page?: number, append?: boolean) => Promise<void>;
  addDiary: (formData: FormData) => Promise<Diary | null>;
  fetchCommunityDiaries: (filters?: { breed?: string; mood?: string }) => Promise<void>;
  likeDiary: (id: string) => Promise<void>;
  addComment: (diaryId: string, username: string, content: string) => Promise<Comment | null>;
  fetchPetDiaries: (petId: string, limit?: number) => Promise<Diary[]>;
  fetchPetById: (id: string) => Promise<Pet | null>;
  clearError: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const showError = useCallback((message: string) => {
    dispatch({ type: 'SET_ERROR', payload: message });
    setTimeout(() => dispatch({ type: 'SET_ERROR', payload: null }), 3000);
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', payload: null });
  }, []);

  const fetchPets = useCallback(async () => {
    dispatch({ type: 'SET_PETS_LOADING', payload: true });
    try {
      const response = await api.get('/pets');
      dispatch({ type: 'SET_PETS', payload: response.data.data });
    } catch (err) {
      showError('加载宠物列表失败');
    } finally {
      dispatch({ type: 'SET_PETS_LOADING', payload: false });
    }
  }, [showError]);

  const addPet = useCallback(async (formData: FormData) => {
    const tempId = 'temp-pet-' + Date.now();
    const tempPet: Pet = {
      id: tempId,
      name: formData.get('name') as string,
      species: formData.get('species') as Pet['species'],
      breed: formData.get('breed') as string,
      age: parseInt(formData.get('age') as string),
      gender: formData.get('gender') as 'male' | 'female',
      avatar: '',
      status: 'home',
      createdAt: new Date().toISOString()
    };

    dispatch({ type: 'ADD_PET', payload: tempPet });

    try {
      const response = await api.post('/pets', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const newPet = response.data.data;
      dispatch({ type: 'ROLLBACK_PET', payload: tempPet });
      dispatch({ type: 'ADD_PET', payload: newPet });
      return newPet;
    } catch (err) {
      dispatch({ type: 'ROLLBACK_PET', payload: tempPet });
      showError('添加宠物失败，请重试');
      return null;
    }
  }, [showError]);

  const updatePetStatus = useCallback(async (id: string, status: Pet['status']) => {
    const pet = state.pets.find(p => p.id === id);
    if (!pet) return;

    const previousStatus = pet.status;
    dispatch({ type: 'UPDATE_PET_STATUS', payload: { id, status } });

    try {
      await api.patch(`/pets/${id}/status`, { status });
    } catch (err) {
      dispatch({ type: 'UPDATE_PET_STATUS', payload: { id, status: previousStatus } });
      showError('更新状态失败，请重试');
    }
  }, [state.pets, showError]);

  const fetchDiaries = useCallback(async (page: number = 1, append: boolean = false) => {
    if (state.diariesLoading && append) return;
    
    dispatch({ type: 'SET_DIARIES_LOADING', payload: true });
    try {
      const response = await api.get('/diaries', { params: { page, limit: 5 } });
      dispatch({
        type: 'SET_DIARIES',
        payload: {
          data: response.data.data,
          hasMore: response.data.hasMore,
          page,
          append
        }
      });
    } catch (err) {
      showError('加载日记列表失败');
    } finally {
      dispatch({ type: 'SET_DIARIES_LOADING', payload: false });
    }
  }, [state.diariesLoading, showError]);

  const addDiary = useCallback(async (formData: FormData) => {
    const tempId = 'temp-diary-' + Date.now();
    const tempDiary: Diary = {
      id: tempId,
      petId: formData.get('petId') as string,
      petName: formData.get('petName') as string,
      images: [],
      content: formData.get('content') as string,
      mood: formData.get('mood') as Diary['mood'],
      likes: 0,
      liked: false,
      comments: [],
      createdAt: new Date().toISOString()
    };

    dispatch({ type: 'ADD_DIARY', payload: tempDiary });

    try {
      const response = await api.post('/diaries', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const newDiary = response.data.data;
      dispatch({ type: 'ROLLBACK_DIARY', payload: tempDiary });
      dispatch({ type: 'ADD_DIARY', payload: newDiary });
      return newDiary;
    } catch (err) {
      dispatch({ type: 'ROLLBACK_DIARY', payload: tempDiary });
      showError('发布日记失败，请重试');
      return null;
    }
  }, [showError]);

  const fetchCommunityDiaries = useCallback(async (filters?: { breed?: string; mood?: string }) => {
    dispatch({ type: 'SET_COMMUNITY_LOADING', payload: true });
    try {
      const params = new URLSearchParams();
      if (filters?.breed) params.append('breed', filters.breed);
      if (filters?.mood) params.append('mood', filters.mood);
      
      const response = await api.get(`/community/diaries?${params.toString()}`);
      dispatch({ type: 'SET_COMMUNITY_DIARIES', payload: response.data.data });
    } catch (err) {
      showError('加载社区日记失败');
    } finally {
      dispatch({ type: 'SET_COMMUNITY_LOADING', payload: false });
    }
  }, [showError]);

  const likeDiary = useCallback(async (id: string) => {
    const diary = [...state.diaries, ...state.communityDiaries].find(d => d.id === id);
    if (!diary) return;

    const previousState = { likes: diary.likes, liked: diary.liked };
    const newLiked = !diary.liked;
    const newLikes = diary.likes + (newLiked ? 1 : -1);

    dispatch({ type: 'UPDATE_DIARY_LIKE', payload: { id, likes: newLikes, liked: newLiked } });

    try {
      const response = await api.post(`/diaries/${id}/like`);
      dispatch({
        type: 'UPDATE_DIARY_LIKE',
        payload: { id, likes: response.data.data.likes, liked: response.data.data.liked }
      });
    } catch (err) {
      dispatch({
        type: 'UPDATE_DIARY_LIKE',
        payload: { id, likes: previousState.likes, liked: previousState.liked }
      });
      showError('点赞失败，请重试');
    }
  }, [state.diaries, state.communityDiaries, showError]);

  const addComment = useCallback(async (diaryId: string, username: string, content: string) => {
    const tempComment: Comment = {
      id: 'temp-comment-' + Date.now(),
      username,
      content,
      createdAt: new Date().toISOString()
    };

    dispatch({ type: 'ADD_DIARY_COMMENT', payload: { diaryId, comment: tempComment } });

    try {
      const response = await api.post(`/diaries/${diaryId}/comment`, { username, content });
      return response.data.data;
    } catch (err) {
      showError('评论失败，请重试');
      return null;
    }
  }, [showError]);

  const fetchPetDiaries = useCallback(async (petId: string, limit: number = 3) => {
    try {
      const response = await api.get(`/pets/${petId}/diaries`, { params: { limit } });
      return response.data.data;
    } catch (err) {
      showError('加载宠物日记失败');
      return [];
    }
  }, [showError]);

  const fetchPetById = useCallback(async (id: string) => {
    try {
      const response = await api.get(`/pets/${id}`);
      return response.data.data;
    } catch (err) {
      showError('加载宠物信息失败');
      return null;
    }
  }, [showError]);

  return (
    <AppContext.Provider
      value={{
        state,
        fetchPets,
        addPet,
        updatePetStatus,
        fetchDiaries,
        addDiary,
        fetchCommunityDiaries,
        likeDiary,
        addComment,
        fetchPetDiaries,
        fetchPetById,
        clearError
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
