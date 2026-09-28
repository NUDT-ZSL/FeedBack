export interface Artwork {
  id: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  limitedEdition: number;
  thumbnail: string;
  image: string;
  createdAt: string;
  artistName: string;
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed';

export interface Order {
  id: string;
  orderNumber: string;
  artworkId: string;
  artworkTitle: string;
  artworkPrice: number;
  quantity: number;
  totalPrice: number;
  buyerName: string;
  buyerPhone: string;
  buyerAddress: string;
  status: OrderStatus;
  trackingNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}

export interface CartItem {
  artworkId: string;
  artworkTitle: string;
  artworkPrice: number;
  quantity: number;
  thumbnail: string;
}
