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
} from './utils/helpers';

type AppStore = AppState & AppActions;

const deepCloneComponents = (components: DougongComponent[]): DougongComponent[] => {
  return JSON.parse(JSON.stringify(components));
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
              animationPhase: 'snapping',
            }
          : c
      ),
    }));

    get().playSound('snap', 0.4, 0.8);
    get().calculateProgress();

    setTimeout(() => {
      set((state) => ({
        components: state.components.map((c) =>
          c.id === id ? { ...c, animationPhase: 'idle' } : c
        ),
      }));

      const { components, triggerFullAssembly } = get();
      const allSnapped = components
        .filter((c) => c.assemblyOrder <= 12)
        .every((c) => c.isSnapped);
      if (allSnapped) {
        triggerFullAssembly();
      }
    }, 500);
  },

  errorSnap: (id: string) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, animationPhase: 'error' } : c
      ),
    }));

    get().playSound('error', 0.5, 0.4);

    setTimeout(() => {
      set((state) => ({
        components: state.components.map((c) =>
          c.id === id
            ? {
                ...c,
                position: { ...c.correctPosition },
                rotation: { ...c.correctRotation },
                animationPhase: 'idle',
              }
            : c
        ),
      }));
    }, 800);
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

    let t = 0;
    const duration = 1000;
    const interval = 16;
    const animate = () => {
      t += interval;
      const progress = Math.min(t / duration, 1);
      const eased = easeOutQuart(progress);
      get().updateBackgroundTransition(eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        get().completeModeTransition();
        get().updateBackgroundTransition(0);
      }
    };
    requestAnimationFrame(animate);
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
    setTimeout(() => {
      set({ showFullAssembly: true });
    }, 500);
  },

  resetComponents: () => {
    set({
      components: deepCloneComponents(INITIAL_COMPONENTS),
      selectedComponentId: null,
      hoveredComponentId: null,
      draggingComponentId: null,
      progress: 100,
      mode: AssemblyMode.Assemble,
      isModeTransitioning: false,
      showFullAssembly: false,
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
        animationPhase: 'disassembling',
      })),
      progress: 0,
    }));

    sortedComponents.forEach((component, index) => {
      const delay = index * 80;
      const duration = 500;
      const startPos = { ...component.correctPosition };
      const targetPos = generateDisassemblePosition(component.correctPosition, index, total);
      const randomRot = generateRandomRotation();

      setTimeout(() => {
        let t = 0;
        const interval = 16;
        const animate = () => {
          t += interval;
          const progress = Math.min(t / duration, 1);
          const eased = easeOutQuart(progress);

          const newX = startPos.x + (targetPos.x - startPos.x) * eased;
          const newY = startPos.y + (targetPos.y - startPos.y) * eased;
          const newZ = startPos.z + (targetPos.z - startPos.z) * eased;

          const vibrateAmount = Math.sin(progress * Math.PI) * 0.5;
          const vibrateX = (Math.random() - 0.5) * vibrateAmount;
          const vibrateY = (Math.random() - 0.5) * vibrateAmount;
          const vibrateZ = (Math.random() - 0.5) * vibrateAmount;

          get().moveComponent(component.id, {
            x: newX + vibrateX,
            y: newY + vibrateY,
            z: newZ + vibrateZ,
          });

          get().rotateComponent(component.id, {
            x: randomRot.x * eased,
            y: randomRot.y * eased,
            z: randomRot.z * eased,
          });

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            set((state) => ({
              components: state.components.map((c) =>
                c.id === component.id ? { ...c, animationPhase: 'idle' } : c
              ),
            }));
          }
        };
        get().playSound('friction', 0.3, 1.2);
        requestAnimationFrame(animate);
      }, delay);
    });
  },

  flyInAll: () => {
    const { components } = get();
    const sortedComponents = [...components].sort((a, b) => a.assemblyOrder - b.assemblyOrder);

    set((state) => ({
      components: state.components.map((c) => ({
        ...c,
        isSnapped: false,
        isAssembled: false,
        animationPhase: 'flyingIn',
      })),
    }));

    sortedComponents.forEach((component, index) => {
      const delay = index * 100;
      const duration = 1000;
      const startPos = generateFlyInPosition(component.correctPosition);
      const targetPos = { ...component.correctPosition };

      set((state) => ({
        components: state.components.map((c) =>
          c.id === component.id ? { ...c, position: { ...startPos } } : c
        ),
      }));

      setTimeout(() => {
        let t = 0;
        const interval = 16;
        const animate = () => {
          t += interval;
          const progress = Math.min(t / duration, 1);
          const eased = easeOutQuart(progress);

          get().moveComponent(component.id, {
            x: startPos.x + (targetPos.x - startPos.x) * eased,
            y: startPos.y + (targetPos.y - startPos.y) * eased,
            z: startPos.z + (targetPos.z - startPos.z) * eased,
          });

          get().rotateComponent(component.id, {
            x: component.correctRotation.x * eased,
            y: component.correctRotation.y * eased,
            z: component.correctRotation.z * eased,
          });

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            set((state) => ({
              components: state.components.map((c) =>
                c.id === component.id
                  ? { ...c, position: { ...targetPos }, rotation: { ...c.correctRotation }, animationPhase: 'idle' }
                  : c
              ),
            }));
          }
        };
        requestAnimationFrame(animate);
      }, delay);
    });
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
}));
