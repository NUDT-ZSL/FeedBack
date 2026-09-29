import { create } from 'zustand';
import type { Order, InventoryItem, ToastMessage, OrderStatus } from '@/utils/types';
import {
  getOrders as apiGetOrders,
  getOrderById as apiGetOrderById,
  createOrder as apiCreateOrder,
  updateOrderStatus as apiUpdateOrderStatus,
  completeStage as apiCompleteStage,
  getInventory as apiGetInventory,
  getLowStockItems as apiGetLowStock,
  type NewOrderInput,
} from '@/services/dataService';
import { STAGE_ORDER } from '@/utils/constants';
import type { OrderStage } from '@/utils/types';

interface AppState {
  orders: Order[];
  ordersTotal: number;
  inventory: InventoryItem[];
  lowStock: InventoryItem[];
  statusFilter: OrderStatus | 'all';
  toasts: ToastMessage[];
  sidebarOpen: boolean;
  activeMenu: 'dashboard' | 'inventory' | 'purchases' | 'track';
  loading: boolean;
  currentPage: number;
  fetchOrders: (filter?: OrderStatus | 'all', page?: number, pageSize?: number) => Promise<void>;
  fetchInventory: () => Promise<void>;
  fetchLowStock: () => Promise<void>;
  createOrder: (input: NewOrderInput) => Promise<Order>;
  changeOrderStatus: (id: string, status: OrderStatus) => Promise<Order | null>;
  completeStageAction: (
    orderId: string,
    stage: OrderStage,
    durationMinutes: number,
    note?: string,
  ) => Promise<Order | null>;
  setStatusFilter: (f: OrderStatus | 'all') => void;
  setActiveMenu: (m: AppState['activeMenu']) => void;
  toggleSidebar: () => void;
  showToast: (text: string, type?: ToastMessage['type']) => void;
  removeToast: (id: string) => void;
  getOrderById: (id: string) => Order | undefined;
  calculateProgressPercent: (order: Order) => number;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

uid.name = 'uid';

export const useAppStore = create<AppState>((set, get) => ({
  orders: [],
  ordersTotal: 0,
  inventory: [],
  lowStock: [],
  statusFilter: 'all',
  toasts: [],
  sidebarOpen: false,
  activeMenu: 'dashboard',
  loading: false,
  currentPage: 1,

  fetchOrders: async (filter, page = 1, pageSize = 50) => {
    set({ loading: true });
    try {
      const statusFilter = filter ?? get().statusFilter;
      const res = await apiGetOrders(page, pageSize, statusFilter);
      set({
        orders: res.data,
        ordersTotal: res.total,
        statusFilter,
        currentPage: page,
        loading: false,
      });
    } finally {
      set({ loading: false });
    }
  },

  fetchInventory: async () => {
    const inv = await apiGetInventory();
    set({ inventory: inv });
  },

  fetchLowStock: async () => {
    const low = await apiGetLowStock();
    set({ lowStock: low });
  },

  createOrder: async (input) => {
    const order = await apiCreateOrder(input);
    const { orders } = get();
    set({ orders: [order, ...orders] });
    return order;
  },

  changeOrderStatus: async (id, status) => {
    const updated = await apiUpdateOrderStatus(id, status);
    if (updated) {
      const { orders } = get();
      set({
        orders: orders.map((o) => (o.id === id ? updated! : o)),
      });
    }
    return updated;
  },

  completeStageAction: async (orderId, stage, durationMinutes, note) => {
    const updated = await apiCompleteStage(orderId, stage, durationMinutes, note);
    if (updated) {
      const { orders } = get();
      set({
        orders: orders.map((o) => (o.id === orderId ? updated! : o)),
      });
    }
    return updated;
  },

  setStatusFilter: (f) => set({ statusFilter: f }),
  setActiveMenu: (m) => set({ activeMenu: m }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  showToast: (text, type = 'success') => {
    const msg: ToastMessage = {
      id: uid(),
      text,
      type,
      createdAt: Date.now(),
    };
    set((s) => ({ toasts: [...s.toasts, msg] }));
    setTimeout(() => {
      get().removeToast(msg.id);
    }, 2400);
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  getOrderById: (id) => get().orders.find((o) => o.id === id),

  calculateProgressPercent: (order) => {
    if (!order.stages.length) return 0;
    const total = STAGE_ORDER.length;
    let done = 0;
    order.stages.forEach((s) => {
      if (s.status === 'completed') done++;
      else if (s.status === 'current') done += 0.3;
    });
    return Math.round((done / total) * 100);
  },
}));
