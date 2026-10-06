import { create } from 'zustand';
import type { AppState, AppActions, DougongComponent, Transform, Rotation, SoundQueueItem } from './types';
import { AssemblyMode } from './types';
import { INITIAL_COMPONENTS, SCENE_CONSTANTS } from './utils/constants';
import {
  generateDisassemblePosition,
  generateFlyInPosition,
  generateRandomRotation,
  isNearTarget,
  easeOutQuart,
  createId,
} from './utils/helpers';
import { AnimationEngine } from './animation/engine';

type AppStore = AppState & AppActions;

const BACKGROUND_TRANSITION_KEY = '__backgroundTransition__';
const FULL_ASSEMBLY_KEY = '__fullAssembly__';

const deepCloneComponents = (components: DougongComponent[]): DougongComponent[] => {
  return JSON.parse(JSON.stringify(components));
};

const animationEngine = new AnimationEngine();

let rafHandle: number | null = null;
let lastFrameTs: number | null = null;

const runAnimationLoop = () => {
  if (typeof requestAnimationFrame === 'undefined') return;
  if (rafHandle !== null) return;
  lastFrameTs = null;
  const frame = (ts: number) => {
    const dt =
      lastFrameTs === null
        ? 16
        : Math.min(Math.max(ts - lastFrameTs, 0), 100);
    lastFrameTs = ts;
    useAppStore.getState().tickAnimations(dt);
    if (animationEngine.size > 0) {
      rafHandle = requestAnimationFrame(frame);
    } else {
      rafHandle = null;
    }
  };
  rafHandle = requestAnimationFrame(frame);
};

export const useAppStore = create<AppStore>((set, get) => ({
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
    set({ draggingComponentId: id });
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
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id
          ? {
              ...c,
              position: { ...c.correctPosition },
              rotation: { ...c.correctRotation },
              isSnapped: true,
              isAssembled: true,
              isAnimating: true,
              animationPhase: 'snapping',
            }
          : c
      ),
    }));

    get().playSound('snap', 0.4, 0.8);
    get().calculateProgress();

    animationEngine.schedule({
      key: id,
      duration: 500,
      onComplete: () => {
        set((state) => ({
          components: state.components.map((c) =>
            c.id === id
              ? { ...c, isAnimating: false, animationPhase: 'idle' }
              : c
          ),
        }));

        const { components, triggerFullAssembly } = get();
        const allSnapped = components
          .filter((c) => c.assemblyOrder <= 12)
          .every((c) => c.isSnapped);
        if (allSnapped) {
          triggerFullAssembly();
        }
      },
    });
    runAnimationLoop();
  },

  errorSnap: (id: string) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id
          ? { ...c, isAnimating: true, animationPhase: 'error' }
          : c
      ),
    }));

    get().playSound('error', 0.5, 0.4);

    animationEngine.schedule({
      key: id,
      duration: 800,
      onComplete: () => {
        set((state) => ({
          components: state.components.map((c) =>
            c.id === id
              ? {
                  ...c,
                  position: { ...c.correctPosition },
                  rotation: { ...c.correctRotation },
                  isSnapped: true,
                  isAssembled: true,
                  isAnimating: false,
                  animationPhase: 'idle',
                }
              : c
          ),
        }));
        get().calculateProgress();
      },
    });
    runAnimationLoop();
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

    animationEngine.schedule({
      key: BACKGROUND_TRANSITION_KEY,
      duration: 1000,
      ease: easeOutQuart,
      onUpdate: (eased) => {
        get().updateBackgroundTransition(eased);
      },
      onComplete: () => {
        get().completeModeTransition();
        get().updateBackgroundTransition(0);
      },
    });
    runAnimationLoop();
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
    animationEngine.schedule({
      key: FULL_ASSEMBLY_KEY,
      duration: 500,
      onComplete: () => {
        set({ showFullAssembly: true });
      },
    });
    runAnimationLoop();
  },

  resetComponents: () => {
    animationEngine.cancelAll();
    animationEngine.reseed();
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

    set((state) => ({
      components: state.components.map((c) => ({
        ...c,
        isSnapped: false,
        isAssembled: false,
        isAnimating: true,
        animationPhase: 'disassembling',
      })),
      progress: 0,
    }));

    sortedComponents.forEach((component, index) => {
      const delay = index * 80;
      const duration = SCENE_CONSTANTS.disassembleDuration;
      const current = get().components.find((c) => c.id === component.id);
      const startPos = current ? { ...current.position } : { ...component.correctPosition };
      const startRot = current ? { ...current.rotation } : { ...component.correctRotation };
      const targetPos = generateDisassemblePosition(
        component.correctPosition,
        index,
        total,
        animationEngine.nextRandom
      );
      const targetRot = generateRandomRotation(animationEngine.nextRandom);

      animationEngine.schedule({
        key: component.id,
        delay,
        duration,
        ease: easeOutQuart,
        onStart: () => {
          get().playSound('friction', 0.3, 1.2);
        },
        onUpdate: (eased, progress, random) => {
          const vibrateAmount = Math.sin(progress * Math.PI) * 0.5;
          const vibrateX = (random() - 0.5) * vibrateAmount;
          const vibrateY = (random() - 0.5) * vibrateAmount;
          const vibrateZ = (random() - 0.5) * vibrateAmount;

          get().moveComponent(component.id, {
            x: startPos.x + (targetPos.x - startPos.x) * eased + vibrateX,
            y: startPos.y + (targetPos.y - startPos.y) * eased + vibrateY,
            z: startPos.z + (targetPos.z - startPos.z) * eased + vibrateZ,
          });

          get().rotateComponent(component.id, {
            x: startRot.x + (targetRot.x - startRot.x) * eased,
            y: startRot.y + (targetRot.y - startRot.y) * eased,
            z: startRot.z + (targetRot.z - startRot.z) * eased,
          });
        },
        onComplete: () => {
          set((state) => ({
            components: state.components.map((c) =>
              c.id === component.id
                ? {
                    ...c,
                    position: { ...targetPos },
                    rotation: { ...targetRot },
                    isAnimating: false,
                    animationPhase: 'idle',
                  }
                : c
            ),
          }));
        },
      });
    });
    runAnimationLoop();
  },

  flyInAll: () => {
    const { components } = get();
    const sortedComponents = [...components].sort((a, b) => a.assemblyOrder - b.assemblyOrder);

    set((state) => ({
      components: state.components.map((c) => ({
        ...c,
        isSnapped: false,
        isAssembled: false,
        isAnimating: true,
        animationPhase: 'flyingIn',
      })),
    }));

    sortedComponents.forEach((component, index) => {
      const delay = index * 100;
      const duration = SCENE_CONSTANTS.flyInDuration;
      const startPos = generateFlyInPosition(
        component.correctPosition,
        animationEngine.nextRandom
      );
      const current = get().components.find((c) => c.id === component.id);
      const startRot = current ? { ...current.rotation } : { x: 0, y: 0, z: 0 };
      const targetPos = { ...component.correctPosition };
      const targetRot = { ...component.correctRotation };

      set((state) => ({
        components: state.components.map((c) =>
          c.id === component.id ? { ...c, position: { ...startPos } } : c
        ),
      }));

      animationEngine.schedule({
        key: component.id,
        delay,
        duration,
        ease: easeOutQuart,
        onUpdate: (eased) => {
          get().moveComponent(component.id, {
            x: startPos.x + (targetPos.x - startPos.x) * eased,
            y: startPos.y + (targetPos.y - startPos.y) * eased,
            z: startPos.z + (targetPos.z - startPos.z) * eased,
          });

          get().rotateComponent(component.id, {
            x: startRot.x + (targetRot.x - startRot.x) * eased,
            y: startRot.y + (targetRot.y - startRot.y) * eased,
            z: startRot.z + (targetRot.z - startRot.z) * eased,
          });
        },
        onComplete: () => {
          set((state) => ({
            components: state.components.map((c) =>
              c.id === component.id
                ? {
                    ...c,
                    position: { ...targetPos },
                    rotation: { ...targetRot },
                    isSnapped: true,
                    isAssembled: true,
                    isAnimating: false,
                    animationPhase: 'idle',
                  }
                : c
            ),
          }));
          get().calculateProgress();
        },
      });
    });
    runAnimationLoop();
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

  tickAnimations: (dtMs: number) => {
    animationEngine.tick(dtMs);
  },

  getActiveAnimationCount: () => animationEngine.size,
}));
