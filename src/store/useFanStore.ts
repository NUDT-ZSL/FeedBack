import { create } from 'zustand';
import {
  FanSurface,
  FanRib,
  Order,
  BrushStroke,
  OverlayPattern,
  BrushType,
  FanSurfaceShape,
  FanSurfaceStatus,
  OrderStatus,
  Point,
} from '../types';

interface FanState {
  currentFanSurface: FanSurface | null;
  fanRibs: FanRib[];
  assembledRibs: { ribId: string; positionIndex: number }[];
  orders: Order[];
  currentOrderId: string | null;
  isDrawing: boolean;
  currentBrush: BrushType;
  currentColor: string;
  brushSize: number;
  is定型: boolean;
  show定型Animation: boolean;
  assemblyComplete: boolean;
  fan展开Angle: number;
  show合扇Animation: boolean;
  notification: { show: boolean; message: string; type: 'success' | 'error' | 'info' } | null;
  selectedOrderForDetail: Order | null;
  currentOverlay: OverlayPattern | null;
  overlayOpacity: number;

  setCurrentFanSurface: (surface: FanSurface | null) => void;
  createFanSurface: (shape: FanSurfaceShape) => void;
  addStroke: (stroke: BrushStroke) => void;
  updateLastStroke: (point: Point) => void;
  setIsDrawing: (drawing: boolean) => void;
  setCurrentBrush: (brush: BrushType) => void;
  setCurrentColor: (color: string) => void;
  setBrushSize: (size: number) => void;
  addOverlay: (overlay: OverlayPattern) => void;
  updateOverlay: (id: string, updates: Partial<OverlayPattern>) => void;
  removeOverlay: (id: string) => void;
  setOverlayOpacity: (opacity: number) => void;
  setCurrentOverlay: (overlay: OverlayPattern | null) => void;
  定型FanSurface: () => void;
  complete定型Animation: () => void;

  setFanRibs: (ribs: FanRib[]) => void;
  addAssembledRib: (ribId: string, positionIndex: number) => void;
  removeAssembledRib: (ribId: string) => void;
  clearAssembly: () => void;
  setAssemblyComplete: (complete: boolean) => void;
  setFan展开Angle: (angle: number) => void;
  trigger合扇Animation: () => void;
  complete合扇Animation: () => void;

  setOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  updateOrder: (orderId: string, updates: Partial<Order>) => void;
  setCurrentOrderId: (id: string | null) => void;
  setSelectedOrderForDetail: (order: Order | null) => void;

  showNotification: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideNotification: () => void;
  resetAll: () => void;
}

const createInitialFanSurface = (shape: FanSurfaceShape): FanSurface => ({
  id: `surface-${Date.now()}`,
  shape,
  patternData: '',
  strokes: [],
  overlays: [],
  status: 'draft',
  createdAt: new Date(),
});

export const useFanStore = create<FanState>((set, get) => ({
  currentFanSurface: null,
  fanRibs: [],
  assembledRibs: [],
  orders: [],
  currentOrderId: null,
  isDrawing: false,
  currentBrush: 'fine',
  currentColor: '#1a1a1a',
  brushSize: 3,
  is定型: false,
  show定型Animation: false,
  assemblyComplete: false,
  fan展开Angle: 140,
  show合扇Animation: false,
  notification: null,
  selectedOrderForDetail: null,
  currentOverlay: null,
  overlayOpacity: 50,

  setCurrentFanSurface: (surface) => set({ currentFanSurface: surface }),
  
  createFanSurface: (shape) => {
    const surface = createInitialFanSurface(shape);
    set({ currentFanSurface: surface, is定型: false, assemblyComplete: false });
  },

  addStroke: (stroke) => {
    const { currentFanSurface } = get();
    if (!currentFanSurface) return;
    set({
      currentFanSurface: {
        ...currentFanSurface,
        strokes: [...currentFanSurface.strokes, stroke],
      },
    });
  },

  updateLastStroke: (point) => {
    const { currentFanSurface } = get();
    if (!currentFanSurface || currentFanSurface.strokes.length === 0) return;
    const strokes = [...currentFanSurface.strokes];
    const lastStroke = strokes[strokes.length - 1];
    strokes[strokes.length - 1] = {
      ...lastStroke,
      points: [...lastStroke.points, point],
    };
    set({
      currentFanSurface: {
        ...currentFanSurface,
        strokes,
      },
    });
  },

  setIsDrawing: (drawing) => set({ isDrawing: drawing }),
  setCurrentBrush: (brush) => set({ currentBrush: brush }),
  setCurrentColor: (color) => set({ currentColor: color }),
  setBrushSize: (size) => set({ brushSize: size }),

  addOverlay: (overlay) => {
    const { currentFanSurface } = get();
    if (!currentFanSurface) return;
    set({
      currentFanSurface: {
        ...currentFanSurface,
        overlays: [...currentFanSurface.overlays, overlay],
      },
      currentOverlay: overlay,
    });
  },

  updateOverlay: (id, updates) => {
    const { currentFanSurface } = get();
    if (!currentFanSurface) return;
    set({
      currentFanSurface: {
        ...currentFanSurface,
        overlays: currentFanSurface.overlays.map((o) =>
          o.id === id ? { ...o, ...updates } : o
        ),
      },
      currentOverlay:
        get().currentOverlay?.id === id
          ? { ...get().currentOverlay!, ...updates }
          : get().currentOverlay,
    });
  },

  removeOverlay: (id) => {
    const { currentFanSurface, currentOverlay } = get();
    if (!currentFanSurface) return;
    set({
      currentFanSurface: {
        ...currentFanSurface,
        overlays: currentFanSurface.overlays.filter((o) => o.id !== id),
      },
      currentOverlay: currentOverlay?.id === id ? null : currentOverlay,
    });
  },

  setOverlayOpacity: (opacity) => set({ overlayOpacity: opacity }),
  setCurrentOverlay: (overlay) => set({ currentOverlay: overlay }),

  定型FanSurface: () => {
    const { currentFanSurface } = get();
    if (!currentFanSurface) return;
    set({
      show定型Animation: true,
      currentFanSurface: {
        ...currentFanSurface,
        status: 'completed',
      },
    });
  },

  complete定型Animation: () => {
    set({
      show定型Animation: false,
      is定型: true,
    });
  },

  setFanRibs: (ribs) => set({ fanRibs: ribs }),

  addAssembledRib: (ribId, positionIndex) => {
    const { assembledRibs, fanRibs } = get();
    if (assembledRibs.some((r) => r.ribId === ribId || r.positionIndex === positionIndex)) {
      return;
    }
    const newAssembled = [...assembledRibs, { ribId, positionIndex }];
    const newRibs = fanRibs.map((r) =>
      r.id === ribId ? { ...r, used: true } : r
    );
    set({
      assembledRibs: newAssembled,
      fanRibs: newRibs,
      assemblyComplete: newAssembled.length === 12,
    });
  },

  removeAssembledRib: (ribId) => {
    const { assembledRibs, fanRibs } = get();
    set({
      assembledRibs: assembledRibs.filter((r) => r.ribId !== ribId),
      fanRibs: fanRibs.map((r) =>
        r.id === ribId ? { ...r, used: false } : r
      ),
      assemblyComplete: false,
    });
  },

  clearAssembly: () => {
    const { fanRibs } = get();
    set({
      assembledRibs: [],
      fanRibs: fanRibs.map((r) => ({ ...r, used: false })),
      assemblyComplete: false,
    });
  },

  setAssemblyComplete: (complete) => set({ assemblyComplete: complete }),
  setFan展开Angle: (angle) => set({ fan展开Angle: angle }),

  trigger合扇Animation: () => set({ show合扇Animation: true }),
  
  complete合扇Animation: () => {
    const { currentFanSurface } = get();
    set({
      show合扇Animation: false,
      currentFanSurface: currentFanSurface
        ? { ...currentFanSurface, status: 'assembled' as FanSurfaceStatus }
        : null,
    });
  },

  setOrders: (orders) => set({ orders }),
  addOrder: (order) => set((state) => ({ orders: [order, ...state.orders] })),

  updateOrderStatus: (orderId, status) => {
    set((state) => ({
      orders: state.orders.map((o) =>
        o.id === orderId ? { ...o, status, updatedAt: new Date() } : o
      ),
    }));
  },

  updateOrder: (orderId, updates) => {
    set((state) => ({
      orders: state.orders.map((o) =>
        o.id === orderId ? { ...o, ...updates, updatedAt: new Date() } : o
      ),
    }));
  },

  setCurrentOrderId: (id) => set({ currentOrderId: id }),
  setSelectedOrderForDetail: (order) => set({ selectedOrderForDetail: order }),

  showNotification: (message, type = 'info') => {
    set({ notification: { show: true, message, type } });
    setTimeout(() => {
      get().hideNotification();
    }, 3000);
  },

  hideNotification: () => set({ notification: null }),

  resetAll: () => {
    set({
      currentFanSurface: null,
      assembledRibs: [],
      currentOrderId: null,
      isDrawing: false,
      is定型: false,
      show定型Animation: false,
      assemblyComplete: false,
      show合扇Animation: false,
      currentOverlay: null,
    });
  },
}));
