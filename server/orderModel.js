const { v4: uuidv4 } = require('uuid');

let orders = [
  {
    id: 'o1',
    orderNumber: 'ORD202406010001',
    artworkId: '1',
    artworkTitle: '青瓷莲花盏',
    artworkPrice: 588,
    quantity: 1,
    totalPrice: 588,
    buyerName: '王先生',
    buyerPhone: '138****1234',
    buyerAddress: '北京市朝阳区xxx街道123号',
    status: 'completed',
    trackingNumber: 'SF1234567890123',
    createdAt: '2024-06-01T10:30:00',
    updatedAt: '2024-06-03T14:20:00',
  },
  {
    id: 'o2',
    orderNumber: 'ORD202406150002',
    artworkId: '2',
    artworkTitle: '手绘山水折扇',
    artworkPrice: 328,
    quantity: 2,
    totalPrice: 656,
    buyerName: '李女士',
    buyerPhone: '139****5678',
    buyerAddress: '上海市浦东新区xxx路456号',
    status: 'shipped',
    trackingNumber: 'SF9876543210987',
    createdAt: '2024-06-15T15:45:00',
    updatedAt: '2024-06-16T09:10:00',
  },
  {
    id: 'o3',
    orderNumber: 'ORD202406200003',
    artworkId: '5',
    artworkTitle: '刺绣牡丹挂画',
    artworkPrice: 888,
    quantity: 1,
    totalPrice: 888,
    buyerName: '张先生',
    buyerPhone: '137****9012',
    buyerAddress: '广州市天河区xxx大道789号',
    status: 'paid',
    createdAt: '2024-06-20T11:20:00',
    updatedAt: '2024-06-20T11:25:00',
  },
  {
    id: 'o4',
    orderNumber: 'ORD202406210004',
    artworkId: '6',
    artworkTitle: '木雕貔貅摆件',
    artworkPrice: 666,
    quantity: 1,
    totalPrice: 666,
    buyerName: '陈女士',
    buyerPhone: '136****3456',
    buyerAddress: '深圳市南山区xxx科技园A栋',
    status: 'pending',
    createdAt: '2024-06-21T09:00:00',
    updatedAt: '2024-06-21T09:00:00',
  },
];

const generateTrackingNumber = () => {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  return `SF${digits}`;
};

const generateOrderNumber = () => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `ORD${dateStr}${random}`;
};

const getOrders = () => {
  return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

const getOrderById = (id) => orders.find((o) => o.id === id);

const createOrder = (orderData) => {
  const now = new Date().toISOString();
  const newOrder = {
    id: uuidv4(),
    orderNumber: generateOrderNumber(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...orderData,
  };
  orders.push(newOrder);
  return newOrder;
};

const updateOrderStatus = (id, status) => {
  const order = orders.find((o) => o.id === id);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  if (status === 'shipped' && !order.trackingNumber) {
    order.trackingNumber = generateTrackingNumber();
  }
  return order;
};

module.exports = { getOrders, getOrderById, createOrder, updateOrderStatus };
