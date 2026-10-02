import axios from 'axios';
import { Order, FanRib, OrderStatus } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

export const orderApi = {
  async getOrders(page = 1, pageSize = 100) {
    const response = await api.get('/orders', {
      params: { page, pageSize },
    });
    return response.data;
  },

  async getOrder(id: string): Promise<Order> {
    const response = await api.get(`/orders/${id}`);
    return response.data;
  },

  async createOrder(order: Partial<Order>): Promise<Order> {
    const response = await api.post('/orders', order);
    return response.data;
  },

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    const response = await api.put(`/orders/${id}`, { status });
    return response.data;
  },

  async updateOrder(id: string, data: Partial<Order>): Promise<Order> {
    const response = await api.put(`/orders/${id}`, data);
    return response.data;
  },

  async deleteOrder(id: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/orders/${id}`);
    return response.data;
  },
};

export const inventoryApi = {
  async getFanRibs(): Promise<FanRib[]> {
    const response = await api.get('/inventory/ribs');
    return response.data;
  },

  async updateFanRib(id: string, data: Partial<FanRib>): Promise<FanRib> {
    const response = await api.put(`/inventory/ribs/${id}`, data);
    return response.data;
  },

  async useFanRib(id: string): Promise<FanRib> {
    const response = await api.post(`/inventory/ribs/${id}/use`);
    return response.data;
  },

  async restockFanRib(id: string, quantity: number): Promise<FanRib> {
    const response = await api.post(`/inventory/ribs/${id}/restock`, { quantity });
    return response.data;
  },
};
