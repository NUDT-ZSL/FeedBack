import { useState, useEffect } from 'react';
import { orderApi, inventoryApi } from '../api/orderApi';
import { useFanStore } from '../store/useFanStore';
import { Order, OrderStatus, FanRib, COLORS } from '../types';

const statusMap: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: '待制作', color: COLORS.gray },
  in_progress: { label: '制作中', color: COLORS.azurite },
  completed: { label: '已完成', color: COLORS.malachite },
  shipped: { label: '已发货', color: COLORS.goldDark },
};

const fanSurfaceTypes = [
  { value: 'round', label: '圆形团扇' },
  { value: 'fan', label: '折扇' },
];

const fanRibMaterials = [
  { value: 'bamboo', label: '湘妃竹' },
  { value: 'sandalwood', label: '檀香木' },
  { value: 'ebony', label: '乌木' },
  { value: 'jade', label: '玉骨' },
];

export default function OrderManager() {
  const {
    orders, fanRibs, selectedOrderForDetail, setOrders, setFanRibs,
    updateOrderStatus, setCurrentOrderId, setSelectedOrderForDetail, showNotification,
  } = useFanStore();

  const [loading, setLoading] = useState(true);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showLowStock, setShowLowStock] = useState(false);
  const [selectedRibForRestock, setSelectedRibForRestock] = useState<FanRib | null>(null);
  const [newOrder, setNewOrder] = useState({ customerName: '', fanSurfaceType: 'round', fanRibMaterial: 'bamboo' });
  const [thumbnailModal, setThumbnailModal] = useState<string | null>(null);
  const [highlightedRow, setHighlightedRow] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [ordersData, ribsData] = await Promise.all([
          orderApi.getOrders(1, 100), inventoryApi.getFanRibs(),
        ]);
        setOrders(ordersData);
        setFanRibs(ribsData);
      } catch { showNotification('加载数据失败', 'error'); }
      finally { setTimeout(() => setLoading(false), 1200); }
    };
    loadData();
  }, [setOrders, setFanRibs, showNotification]);

  const handleStatusChange = async (order: Order, newStatus: OrderStatus) => {
    try {
      await orderApi.updateOrderStatus(order.id, newStatus);
      updateOrderStatus(order.id, newStatus);
      showNotification(`订单#${order.orderNo}状态已更新`, 'success');
      if (newStatus === 'in_progress') {
        setCurrentOrderId(order.id);
        setTimeout(() => showNotification(`开始制作订单#${order.orderNo}，即将跳转到画扇页面`, 'info'), 300);
      }
    } catch { showNotification('状态更新失败', 'error'); }
  };

  const handleCreateOrder = async () => {
    if (!newOrder.customerName.trim()) {
      showNotification('请输入客户姓名', 'error');
      return;
    }
    const selectedRib = fanRibs.find((r) => r.material === newOrder.fanRibMaterial && r.inStock);
    if (!selectedRib || selectedRib.quantity < 12) {
      setSelectedRibForRestock(selectedRib || null);
      setShowLowStock(true);
      return;
    }
    try {
      const order = await orderApi.createOrder({
        customerName: newOrder.customerName,
        fanSurfaceId: `surface-${Date.now()}`,
        fanRibIds: Array(12).fill(selectedRib.id),
        status: 'pending',
        thumbnail: `https://picsum.photos/seed/${Date.now()}/100/100`,
      });
      setOrders([order, ...orders]);
      showNotification('订单创建成功', 'success');
      setShowNewOrder(false);
      setNewOrder({ customerName: '', fanSurfaceType: 'round', fanRibMaterial: 'bamboo' });
    } catch { showNotification('创建订单失败', 'error'); }
  };

  const handleRestock = async () => {
    if (!selectedRibForRestock) return;
    try {
      await inventoryApi.restockFanRib(selectedRibForRestock.id, 24);
      setFanRibs(await inventoryApi.getFanRibs());
      showNotification('库存补足成功', 'success');
      setShowLowStock(false);
      setSelectedRibForRestock(null);
    } catch { showNotification('补足库存失败', 'error'); }
  };

  const getRibMaterialLabel = (ribIds: string[]) => {
    const rib = fanRibs.find((r) => r.id === ribIds[0]);
    const material = fanRibMaterials.find((m) => m.value === rib?.material);
    return material?.label || rib?.material || '未知';
  };

  const StatusBadge = ({ status }: { status: OrderStatus }) => (
    <span className="px-2 py-1 rounded-full text-white text-xs" style={{ backgroundColor: statusMap[status].color }}>
      {statusMap[status].label}
    </span>
  );

  const ThumbnailImg = ({ src }: { src: string }) => (
    <img
      src={src} alt="扇面" className="w-12 h-12 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
      onClick={(e) => { e.stopPropagation(); setThumbnailModal(src); }}
    />
  );

  const ActionButtons = ({ order }: { order: Order }) => (
    <div className="space-x-2" onClick={(e) => e.stopPropagation()}>
      {order.status === 'pending' && (
        <button onClick={() => handleStatusChange(order, 'in_progress')}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">开始制作</button>
      )}
      {order.status === 'in_progress' && (
        <button onClick={() => handleStatusChange(order, 'completed')}
          className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700">完成制作</button>
      )}
      {order.status === 'completed' && (
        <>
          <button onClick={() => handleStatusChange(order, 'shipped')}
            className="px-3 py-1 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700">发货</button>
          <button onClick={() => setSelectedOrderForDetail(order)}
            className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">查看详情</button>
        </>
      )}
    </div>
  );

  const Skeleton = () => (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="animate-pulse bg-amber-100 rounded-lg h-16" />
      ))}
    </div>
  );

  const TableView = () => (
    <div className="hidden md:block overflow-x-auto rounded-lg shadow-lg">
      <table className="w-full">
        <thead>
          <tr style={{ backgroundColor: COLORS.wood }}>
            {['订单号', '客户姓名', '扇面图案', '扇骨材质', '状态', '提交时间', '操作'].map((header) => (
              <th key={header} className="px-4 py-3 text-left font-medium" style={{ color: COLORS.cream }}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-amber-200 cursor-pointer transition-colors duration-200"
              style={{ backgroundColor: highlightedRow === order.id ? COLORS.goldDark : undefined }}
              onMouseEnter={(e) => { if (highlightedRow !== order.id) e.currentTarget.style.backgroundColor = COLORS.gold; }}
              onMouseLeave={(e) => { if (highlightedRow !== order.id) e.currentTarget.style.backgroundColor = ''; }}
              onClick={() => setHighlightedRow(highlightedRow === order.id ? null : order.id)}
            >
              <td className="px-4 py-3 font-mono text-sm">{order.orderNo}</td>
              <td className="px-4 py-3">{order.customerName}</td>
              <td className="px-4 py-3"><ThumbnailImg src={order.thumbnail} /></td>
              <td className="px-4 py-3">{getRibMaterialLabel(order.fanRibIds)}</td>
              <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
              <td className="px-4 py-3 text-sm text-gray-600">{new Date(order.submittedAt).toLocaleString('zh-CN')}</td>
              <td className="px-4 py-3"><ActionButtons order={order} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const CardView = () => (
    <div className="md:hidden space-y-4">
      {orders.map((order) => (
        <div key={order.id} className="bg-white rounded-lg shadow-md p-4 border-l-4 transition-all duration-200"
          style={{ borderLeftColor: statusMap[order.status].color, backgroundColor: highlightedRow === order.id ? COLORS.gold : undefined }}
          onClick={() => setHighlightedRow(highlightedRow === order.id ? null : order.id)}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-sm font-bold">{order.orderNo}</span>
            <StatusBadge status={order.status} />
          </div>
          <div className="flex items-center gap-3 mb-2">
            <img src={order.thumbnail} alt="扇面" className="w-14 h-14 rounded object-cover"
              onClick={() => setThumbnailModal(order.thumbnail)} />
            <div>
              <p className="font-medium">{order.customerName}</p>
              <p className="text-sm text-gray-500">{getRibMaterialLabel(order.fanRibIds)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">{new Date(order.submittedAt).toLocaleString('zh-CN')}</p>
          <ActionButtons order={order} />
        </div>
      ))}
    </div>
  );

  const Modal = ({ show, children, onClose }: { show: boolean; children: React.ReactNode; onClose?: () => void }) =>
    !show ? null : (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
