import { create } from 'zustand';
import type { SkillNode, PathStage, SkillResource, PlanResponse, StageStatus } from '../types';
import { generatePlan as generatePlanApi } from '../utils/api';

interface SkillStoreState {
  skills: SkillNode[];
  selectedSkill: SkillNode | null;
  searchQuery: string;
  highlightedSkillId: string | null;
  favorites: string[];
  learningPath: PathStage[];
  targetJobId: string | null;
  isLoading: boolean;
  isPathGenerating: boolean;
  error: string | null;
  jobTitle: string;
  totalEstimatedHours: number;
  missingSkills: string[];
  draggingNodeId: string | null;
  selectedResourceId: string | null;
}

interface SkillStoreActions {
  setSkills: (skills: SkillNode[]) => void;
  updateProficiency: (skillId: string, proficiency: number) => void;
  toggleFavorite: (resourceId: string) => void;
  updateStageStatus: (stageId: string, status: StageStatus) => void;
  setSearchQuery: (query: string) => void;
  setHighlightedSkill: (skillId: string | null) => void;
  setTargetJob: (jobId: string | null) => void;
  generateLearningPath: (targetJobId: string) => Promise<void>;
  setSelectedSkill: (skill: SkillNode | null) => void;
  setDraggingNode: (nodeId: string | null) => void;
  setSelectedResourceId: (id: string | null) => void;
  resetStore: () => void;
  fetchSkills: () => Promise<void>;
}

const initialState: SkillStoreState = {
  skills: [],
  selectedSkill: null,
  searchQuery: '',
  highlightedSkillId: null,
  favorites: [],
  learningPath: [],
  targetJobId: null,
  isLoading: false,
  isPathGenerating: false,
  error: null,
  jobTitle: '',
  totalEstimatedHours: 0,
  missingSkills: [],
  draggingNodeId: null,
  selectedResourceId: null,
};

export const useSkillStore = create<SkillStoreState & SkillStoreActions>((set, get) => ({
  ...initialState,

  setSkills: (skills) => set({ skills }),

  updateProficiency: (skillId, proficiency) => {
    const clamped = Math.max(0, Math.min(100, proficiency));
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === skillId ? { ...s, proficiency: clamped } : s
      ),
      selectedSkill:
        state.selectedSkill?.id === skillId
          ? { ...state.selectedSkill, proficiency: clamped }
          : state.selectedSkill,
    }));
    const target = get().targetJobId;
    if (target) {
      void get().generateLearningPath(target);
    }
  },

  toggleFavorite: (resourceId) =>
    set((state) => ({
      favorites: state.favorites.includes(resourceId)
        ? state.favorites.filter((id) => id !== resourceId)
        : [...state.favorites, resourceId],
    })),

  updateStageStatus: (stageId, status) =>
    set((state) => ({
      learningPath: state.learningPath.map((s) =>
        s.id === stageId ? { ...s, status } : s
      ),
    })),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setHighlightedSkill: (skillId) => set({ highlightedSkillId: skillId }),

  setTargetJob: (jobId) => set({ targetJobId: jobId }),

  generateLearningPath: async (targetJobId) => {
    set({ isPathGenerating: true, error: null });
    try {
      const { skills } = get();
      const currentProficiencies = skills.map((s) => ({
        skillId: s.id,
        proficiency: s.proficiency,
      }));
      const response: PlanResponse = await generatePlanApi({
        targetJobId,
        currentProficiencies,
      });
      set({
        learningPath: response.stages,
        jobTitle: response.jobTitle,
        totalEstimatedHours: response.totalEstimatedHours,
        missingSkills: response.missingSkills,
        targetJobId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate path';
      set({ error: msg });
    } finally {
      set({ isPathGenerating: false });
    }
  },

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),

  setDraggingNode: (nodeId) => set({ draggingNodeId: nodeId }),

  setSelectedResourceId: (id) => set({ selectedResourceId: id }),

  resetStore: () => set(initialState),

  fetchSkills: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      set({ skills: data.skills || [] });
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      set({ isLoading: false });
    }
  },
}));

export default useSkillStore;
