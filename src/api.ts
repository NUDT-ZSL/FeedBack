import axios from 'axios';
import { Artwork, Order, OrderStatus, ApiResponse } from './types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 5000,
});

export const artworkApi = {
  getArtworks: (): Promise<ApiResponse<Artwork[]>> =>
    api.get('/artworks').then((res) => res.data),

  getArtworkById: (id: string): Promise<ApiResponse<Artwork>> =>
    api.get(`/artworks/${id}`).then((res) => res.data),
};

export const orderApi = {
  getOrders: (): Promise<ApiResponse<Order[]>> =>
    api.get('/orders').then((res) => res.data),

  getOrderById: (id: string): Promise<ApiResponse<Order>> =>
    api.get(`/orders/${id}`).then((res) => res.data),

  createOrder: (data: {
    artworkId: string;
    quantity: number;
    buyerName: string;
    buyerPhone: string;
    buyerAddress: string;
  }): Promise<ApiResponse<Order>> =>
    api.post('/orders', data).then((res) => res.data),

  updateOrderStatus: (id: string, status: OrderStatus): Promise<ApiResponse<Order>> =>
    api.put(`/orders/${id}/status`, { status }).then((res) => res.data),
};
