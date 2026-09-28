import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RoleType = 'vocal' | 'guitar' | 'bass' | 'drums';
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;
export type TabType = 'songs' | 'rehearsals' | 'dashboard';

export interface Song {
  id: string;
  name: string;
  key: string;
  bpm: number;
  difficulty: DifficultyLevel;
  pdfUrl: string;
  completed: boolean;
  completedAt?: string;
}

export interface Assignment {
  role: RoleType;
  memberId: string;
  memberName: string;
}

export interface RehearsalPlan {
  id: string;
  songId: string;
  date: string;
  duration: number;
  assignments: Assignment[];
}

export interface RehearsalRecord {
  id: string;
  songId: string;
  date: string;
  actualDuration: number;
  completed: boolean;
}

export interface Member {
  id: string;
  name: string;
  defaultRole: string;
}

interface TimerState {
  isRunning: boolean;
  currentSongId: string | null;
  currentSongIndex: number;
  elapsed: number;
  remaining: number;
}

interface AppState {
  activeTab: TabType;
  songs: Song[];
  rehearsalPlans: RehearsalPlan[];
  rehearsalRecords: RehearsalRecord[];
  members: Member[];
  timer: TimerState;
  showCreateForm: boolean;
  editingPlanId: string | null;

  setActiveTab: (tab: TabType) => void;
  addSong: (song: Omit<Song, 'id' | 'completed'>) => void;
  deleteSong: (id: string) => void;
  toggleSongComplete: (id: string) => void;
  addRehearsalPlan: (plan: Omit<RehearsalPlan, 'id'>) => void;
  updateRehearsalPlan: (id: string, plan: Partial<RehearsalPlan>) => void;
  deleteRehearsalPlan: (id: string) => void;
  addRehearsalRecord: (record: Omit<RehearsalRecord, 'id'>) => void;
  updateAssignment: (planId: string, role: RoleType, memberId: string, memberName: string) => void;
  startTimer: (songId: string) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  tickTimer: () => void;
  nextSong: () => void;
  stopTimer: () => void;
  setShowCreateForm: (show: boolean) => void;
  setEditingPlanId: (id: string | null) => void;
  addMember: (name: string, defaultRole: string) => void;
  removeMember: (id: string) => void;
  getStats: () => {
    weeklyDuration: number;
    completedCount: number;
    memberParticipation: Record<string, number>;
    songCompletion: Record<string, number>;
  };
}

const generateId = () => Math.random().toString(36).substring(2, 11);

const defaultMembers: Member[] = [
  { id: 'm1', name: '小明', defaultRole: 'vocal' },
  { id: 'm2', name: '小红', defaultRole: 'guitar' },
  { id: 'm3', name: '小刚', defaultRole: 'bass' },
  { id: 'm4', name: '小芳', defaultRole: 'drums' },
];

const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(now.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: 'songs',
      songs: [],
      rehearsalPlans: [],
      rehearsalRecords: [],
      members: defaultMembers,
      timer: {
        isRunning: false,
        currentSongId: null,
        currentSongIndex: 0,
        elapsed: 0,
        remaining: 0,
      },
      showCreateForm: false,
      editingPlanId: null,

      setActiveTab: (tab) => set({ activeTab: tab }),

      addSong: (song) =>
        set((state) => ({
          songs: [
            ...state.songs,
            { ...song, id: generateId(), completed: false },
          ],
        })),

      deleteSong: (id) =>
        set((state) => ({
          songs: state.songs.filter((s) => s.id !== id),
          rehearsalPlans: state.rehearsalPlans.filter((p) => p.songId !== id),
          rehearsalRecords: state.rehearsalRecords.filter((r) => r.songId !== id),
        })),

      toggleSongComplete: (id) =>
        set((state) => ({
          songs: state.songs.map((s) =>
            s.id === id
              ? {
                  ...s,
                  completed: !s.completed,
                  completedAt: !s.completed ? new Date().toISOString() : undefined,
                }
              : s
          ),
        })),

      addRehearsalPlan: (plan) =>
        set((state) => ({
          rehearsalPlans: [
            ...state.rehearsalPlans,
            { ...plan, id: generateId() },
          ],
        })),

      updateRehearsalPlan: (id, updates) =>
        set((state) => ({
          rehearsalPlans: state.rehearsalPlans.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      deleteRehearsalPlan: (id) =>
        set((state) => ({
          rehearsalPlans: state.rehearsalPlans.filter((p) => p.id !== id),
        })),

      addRehearsalRecord: (record) =>
        set((state) => ({
          rehearsalRecords: [
            ...state.rehearsalRecords,
            { ...record, id: generateId() },
          ],
        })),

      updateAssignment: (planId, role, memberId, memberName) =>
        set((state) => ({
          rehearsalPlans: state.rehearsalPlans.map((p) => {
            if (p.id !== planId) return p;
            const existing = p.assignments.find((a) => a.role === role);
            const newAssignment: Assignment = { role, memberId, memberName };
            return {
              ...p,
              assignments: existing
                ? p.assignments.map((a) => (a.role === role ? newAssignment : a))
                : [...p.assignments, newAssignment],
            };
          }),
        })),

      startTimer: (songId) => {
        const state = get();
        const song = state.songs.find((s) => s.id === songId);
        const plan = state.rehearsalPlans.find((p) => p.songId === songId);
        const duration = plan ? plan.duration * 60 : 180;
        set({
          timer: {
            isRunning: true,
            currentSongId: songId,
            currentSongIndex: state.songs.findIndex((s) => s.id === songId),
            elapsed: 0,
            remaining: duration,
          },
        });
      },

      pauseTimer: () =>
        set((state) => ({
          timer: { ...state.timer, isRunning: false },
        })),

      resumeTimer: () =>
        set((state) => ({
          timer: { ...state.timer, isRunning: true },
        })),

      tickTimer: () => {
        const state = get();
        const { timer } = state;
        if (!timer.isRunning || !timer.currentSongId) return;

        const newRemaining = timer.remaining - 1;
        const newElapsed = timer.elapsed + 1;

        if (newRemaining <= 0) {
          const songId = timer.currentSongId;
          set((s) => ({
            songs: s.songs.map((song) =>
              song.id === songId
                ? { ...song, completed: true, completedAt: new Date().toISOString() }
                : song
            ),
            timer: { ...s.timer, isRunning: false, remaining: 0, elapsed: newElapsed },
          }));

          const plan = state.rehearsalPlans.find((p) => p.songId === songId);
          get().addRehearsalRecord({
            songId,
            date: new Date().toISOString().split('T')[0],
            actualDuration: Math.ceil(newElapsed / 60),
            completed: true,
          });
        } else {
          set({
            timer: {
              ...timer,
              remaining: newRemaining,
              elapsed: newElapsed,
            },
          });
        }
      },

      nextSong: () => {
        const state = get();
        const nextIndex = state.timer.currentSongIndex + 1;
        if (nextIndex < state.songs.length) {
          const nextSong = state.songs[nextIndex];
          const plan = state.rehearsalPlans.find((p) => p.songId === nextSong.id);
          const duration = plan ? plan.duration * 60 : 180;
          set({
            timer: {
              isRunning: true,
              currentSongId: nextSong.id,
              currentSongIndex: nextIndex,
              elapsed: 0,
              remaining: duration,
            },
          });
        } else {
          set({
            timer: {
              isRunning: false,
              currentSongId: null,
              currentSongIndex: 0,
              elapsed: 0,
              remaining: 0,
            },
          });
        }
      },

      stopTimer: () =>
        set({
          timer: {
            isRunning: false,
            currentSongId: null,
            currentSongIndex: 0,
            elapsed: 0,
            remaining: 0,
          },
        }),

      setShowCreateForm: (show) => set({ showCreateForm: show }),
      setEditingPlanId: (id) => set({ editingPlanId: id }),

      addMember: (name, defaultRole) =>
        set((state) => ({
          members: [...state.members, { id: generateId(), name, defaultRole }],
        })),

      removeMember: (id) =>
        set((state) => ({
          members: state.members.filter((m) => m.id !== id),
        })),

      getStats: () => {
        const state = get();
        const weekStart = getWeekStart();

        const weekRecords = state.rehearsalRecords.filter(
          (r) => new Date(r.date) >= weekStart
        );

        const weeklyDuration = weekRecords.reduce(
          (sum, r) => sum + r.actualDuration,
          0
        );

        const completedCount = state.songs.filter((s) => s.completed).length;

        const memberParticipation: Record<string, number> = {};
        state.members.forEach((m) => {
          memberParticipation[m.id] = 0;
        });
        state.rehearsalPlans.forEach((plan) => {
          plan.assignments.forEach((a) => {
            if (weekRecords.some((r) => r.songId === plan.songId)) {
              memberParticipation[a.memberId] =
                (memberParticipation[a.memberId] || 0) + 1;
            }
          });
        });

        const songCompletion: Record<string, number> = {};
        state.songs.forEach((song) => {
          const totalPlans = state.rehearsalPlans.filter(
            (p) => p.songId === song.id
          ).length;
          const completedPlans = state.rehearsalRecords.filter(
            (r) => r.songId === song.id && r.completed
          ).length;
          songCompletion[song.id] = totalPlans > 0
            ? Math.round((completedPlans / totalPlans) * 100)
            : 0;
        });

        return { weeklyDuration, completedCount, memberParticipation, songCompletion };
      },
    }),
    {
      name: 'band-rehearsal-storage',
      partialize: (state) => ({
        songs: state.songs,
        rehearsalPlans: state.rehearsalPlans,
        rehearsalRecords: state.rehearsalRecords,
        members: state.members,
      }),
    }
  )
);
