import { create } from 'zustand';
import type { AppState, AppActions, DougongComponent, Transform, Rotation, SoundQueueItem } from './types';
import { AssemblyMode } from './types';
import { INITIAL_COMPONENTS } from './utils/constants';
import {
  generateDisassemblePosition,
  generateFlyInPosition,
  generateRandomRotation,
  isNearTarget,
  easeOutQuart,
  createId,
  randomRange,
} from './utils/helpers';
import { AnimationEngine } from './animation/engine';
import type { VibrationSpec } from './animation/engine';

type AppStore = AppState & AppActions;

// Single engine driving every component/background animation. All actions
// schedule tracks here instead of spawning their own rAF/setTimeout loops,
// so a component is always driven by exactly one animation target and any
// new target preempts the old one.
export const animationEngine = new AnimationEngine();

// Injectable time source: the browser uses performance.now(), the offline
// verifier swaps in a manual clock and advances it in fixed steps.
let timeSource: () => number = () =>
  typeof performance !== 'undefined' ? performance.now() : 0;

export const setAnimationTimeSource = (source: () => number): void => {
  timeSource = source;
};

let rafId: number | null = null;

const deepCloneComponents = (components: DougongComponent[]): DougongComponent[] => {
  return JSON.parse(JSON.stringify(components));
};

const makeVibration = (amplitude: number): VibrationSpec => ({
  amplitude,
  freqX: randomRange(18, 30),
  phaseX: randomRange(0, Math.PI * 2),
  freqY: randomRange(18, 30),
  phaseY: randomRange(0, Math.PI * 2),
  freqZ: randomRange(18, 30),
  phaseZ: randomRange(0, Math.PI * 2),
});

export const useAppStore = create<AppStore>((set, get) => {
  const ensureAnimationDriver = () => {
    if (typeof requestAnimationFrame !== 'function') return;
    if (rafId !== null) return;
    if (!animationEngine.hasWork()) return;
    rafId = requestAnimationFrame((timestamp) => {
      rafId = null;
      get().advanceAnimations(timestamp);
      ensureAnimationDriver();
    });
  };

  return {
    components: deepCloneComponents(INITIAL_COMPONENTS),
    selectedComponentId: null,
    hoveredComponentId: null,
    draggingComponentId: null,
    progress: 100,
    mode: AssemblyMode.Assemble,
    isModeTransitioning: false,
    soundQueue: [],
    showFullAssembly: false,
    backgroundTransition: 0,

    selectComponent: (id: string | null) => {
      set({ selectedComponentId: id });
    },

    hoverComponent: (id: string | null) => {
      set({ hoveredComponentId: id });
    },

    setDragging: (id: string | null) => {
      if (id) {
        // Manual drag takes over: the component's animation track yields.
        animationEngine.cancelTrack(id);
        set((state) => ({
          draggingComponentId: id,
          components: state.components.map((c) =>
            c.id === id && c.animationPhase !== 'idle' ? { ...c, animationPhase: 'idle' } : c
          ),
        }));
      } else {
        set({ draggingComponentId: null });
      }
    },

    moveComponent: (id: string, position: Partial<Transform>) => {
      set((state) => ({
        components: state.components.map((c) =>
          c.id === id ? { ...c, position: { ...c.position, ...position } } : c
        ),
      }));

      const component = get().components.find((c) => c.id === id);
      if (component && isNearTarget(component)) {
        get().playSound('drag', 0.2, 1.0);
      }
    },

    rotateComponent: (id: string, rotation: Partial<Rotation>) => {
      set((state) => ({
        components: state.components.map((c) =>
          c.id === id ? { ...c, rotation: { ...c.rotation, ...rotation } } : c
        ),
      }));
    },

    snapToTarget: (id: string) => {
      const component = get().components.find((c) => c.id === id);
      if (!component) return;

      animationEngine.startTrack({
        componentId: id,
        kind: 'snap',
        startAt: timeSource(),
        duration: 500,
        from: { position: { ...component.position }, rotation: { ...component.rotation } },
        to: { position: { ...component.correctPosition }, rotation: { ...component.correctRotation } },
        easing: easeOutQuart,
        vibration: null,
      });

      set((state) => ({
        components: state.components.map((c) =>
          c.id === id
            ? { ...c, isSnapped: true, isAssembled: true, animationPhase: 'snapping' }
            : c
        ),
      }));

      get().playSound('snap', 0.4, 0.8);
      get().calculateProgress();
      ensureAnimationDriver();
    },

    errorSnap: (id: string) => {
      const component = get().components.find((c) => c.id === id);
      if (!component) return;

      animationEngine.startTrack({
        componentId: id,
        kind: 'error',
        startAt: timeSource(),
        duration: 800,
        from: { position: { ...component.position }, rotation: { ...component.rotation } },
        to: { position: { ...component.correctPosition }, rotation: { ...component.correctRotation } },
        easing: easeOutQuart,
        vibration: null,
      });

      set((state) => ({
        components: state.components.map((c) =>
          c.id === id ? { ...c, animationPhase: 'error' } : c
        ),
      }));

      get().playSound('error', 0.5, 0.4);
      ensureAnimationDriver();
    },

    toggleMode: () => {
      set((state) => {
        const newMode = state.mode === AssemblyMode.Assemble ? AssemblyMode.Disassemble : AssemblyMode.Assemble;
        return {
          mode: newMode,
          isModeTransitioning: true,
          showFullAssembly: false,
        };
      });

      const { mode } = get();

      if (mode === AssemblyMode.Disassemble) {
        get().disassembleAll();
      } else {
        get().flyInAll();
      }

      animationEngine.startBackground(timeSource(), 1000, 0, 1, easeOutQuart);
      ensureAnimationDriver();
    },

    completeModeTransition: () => {
      set({ isModeTransitioning: false });
    },

    playSound: (type: SoundQueueItem['type'], volume = 0.3, pitch = 1.0) => {
      const soundItem: SoundQueueItem = {
        id: createId(),
        type,
        volume,
        pitch,
      };
      set((state) => ({
        soundQueue: [...state.soundQueue, soundItem],
      }));
    },

    calculateProgress: () => {
      set((state) => {
        const mainComponents = state.components.filter((c) => c.assemblyOrder <= 12);
        const snappedCount = mainComponents.filter((c) => c.isSnapped).length;
        const progress = Math.round((snappedCount / mainComponents.length) * 100);
        return { progress };
      });
    },

    triggerFullAssembly: () => {
      animationEngine.schedule(timeSource() + 500, () => {
        set({ showFullAssembly: true });
      });
      ensureAnimationDriver();
    },

    resetComponents: () => {
      animationEngine.cancelAll();
      set({
        components: deepCloneComponents(INITIAL_COMPONENTS),
        selectedComponentId: null,
        hoveredComponentId: null,
        draggingComponentId: null,
        progress: 100,
        mode: AssemblyMode.Assemble,
        isModeTransitioning: false,
        showFullAssembly: false,
        backgroundTransition: 0,
      });
    },

    disassembleAll: () => {
      const { components } = get();
      const sortedComponents = [...components].sort((a, b) => b.assemblyOrder - a.assemblyOrder);
      const total = sortedComponents.length;
      const now = timeSource();

      animationEngine.cancelScheduled();

      set((state) => ({
        components: state.components.map((c) => ({
          ...c,
          isSnapped: false,
          isAssembled: false,
          animationPhase: 'disassembling',
        })),
        progress: 0,
      }));

      sortedComponents.forEach((component, index) => {
        const delay = index * 80;
        const targetPos = generateDisassemblePosition(component.correctPosition, index, total);
        const randomRot = generateRandomRotation();
        const current = get().components.find((c) => c.id === component.id);
        if (!current) return;

        animationEngine.startTrack({
          componentId: component.id,
          kind: 'disassemble',
          startAt: now + delay,
          duration: 500,
          from: { position: { ...current.position }, rotation: { ...current.rotation } },
          to: { position: targetPos, rotation: randomRot },
          easing: easeOutQuart,
          vibration: makeVibration(0.5),
        });
        animationEngine.schedule(now + delay, () => {
          get().playSound('friction', 0.3, 1.2);
        });
      });

      ensureAnimationDriver();
    },

    flyInAll: () => {
      const { components } = get();
      const sortedComponents = [...components].sort((a, b) => a.assemblyOrder - b.assemblyOrder);
      const now = timeSource();

      animationEngine.cancelScheduled();

      set((state) => ({
        components: state.components.map((c) => ({
          ...c,
          isSnapped: false,
          isAssembled: false,
          animationPhase: 'flyingIn',
        })),
        progress: 0,
      }));

      sortedComponents.forEach((component, index) => {
        const delay = index * 100;
        const startPos = generateFlyInPosition(component.correctPosition);
        const targetPos = { ...component.correctPosition };
        const current = get().components.find((c) => c.id === component.id);
        if (!current) return;

        set((state) => ({
          components: state.components.map((c) =>
            c.id === component.id ? { ...c, position: { ...startPos } } : c
          ),
        }));

        animationEngine.startTrack({
          componentId: component.id,
          kind: 'flyin',
          startAt: now + delay,
          duration: 1000,
          from: { position: { ...startPos }, rotation: { ...current.rotation } },
          to: { position: targetPos, rotation: { ...component.correctRotation } },
          easing: easeOutQuart,
          vibration: null,
        });
      });

      ensureAnimationDriver();
    },

    advanceAnimations: (now: number) => {
      const result = animationEngine.tick(now);

      if (result.poseUpdates.length > 0 || result.completions.length > 0) {
        set((state) => ({
          components: state.components.map((c) => {
            const completion = result.completions.find((x) => x.componentId === c.id);
            if (completion) {
              return {
                ...c,
                position: { ...completion.pose.position },
                rotation: { ...completion.pose.rotation },
                animationPhase: 'idle' as const,
              };
            }
            const update = result.poseUpdates.find((x) => x.componentId === c.id);
            if (update) {
              return {
                ...c,
                position: { ...update.pose.position },
                rotation: { ...update.pose.rotation },
              };
            }
            return c;
          }),
        }));
      }

      if (result.background !== null) {
        set({ backgroundTransition: result.background });
      }
      if (result.backgroundCompleted) {
        get().completeModeTransition();
        set({ backgroundTransition: 0 });
      }

      if (result.completions.some((c) => c.kind === 'snap')) {
        const { components, triggerFullAssembly } = get();
        const allSnapped = components
          .filter((c) => c.assemblyOrder <= 12)
          .every((c) => c.isSnapped);
        if (allSnapped) {
          triggerFullAssembly();
        }
      }
    },

    setComponentAnimation: (id: string, phase: DougongComponent['animationPhase']) => {
      set((state) => ({
        components: state.components.map((c) =>
          c.id === id ? { ...c, animationPhase: phase } : c
        ),
      }));
    },

    updateBackgroundTransition: (value: number) => {
      set({ backgroundTransition: value });
    },
  };
});
