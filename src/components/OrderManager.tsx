import { useState, useEffect } from 'react';
import { orderApi, inventoryApi, getApiErrorMessage } from '../api/orderApi';
import { useFanStore } from '../store/useFanStore';
import { Order, OrderStatus, FanRib, COLORS } from '../types';

const statusMap: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: '待制作', color: COLORS.gray },
  in_progress: { label: '制作中', color: COLORS.azurite },
  completed: { label: '已完成', color: COLORS.malachite },
  shipped: { label: '已发货', color: COLORS.goldDark },
  cancelled: { label: '已作废', color: COLORS.ochre },
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
    applyOrderTransition, setCurrentOrderId, setSelectedOrderForDetail, showNotification,
  } = useFanStore();

  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState<Record<string, boolean>>({});
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
    if (transitioning[order.id]) return;
    setTransitioning((prev) => ({ ...prev, [order.id]: true }));
    try {
      const { fanRibs: latestRibs, ...updatedOrder } = await orderApi.transitionOrderStatus(order.id, newStatus);
      applyOrderTransition(updatedOrder, latestRibs);
      showNotification(`订单#${order.orderNo}状态已更新`, 'success');
      if (newStatus === 'in_progress') {
        setCurrentOrderId(order.id);
        setTimeout(() => showNotification(`开始制作订单#${order.orderNo}，即将跳转到画扇页面`, 'info'), 300);
      }
    } catch (err) {
      showNotification(getApiErrorMessage(err, '状态更新失败'), 'error');
      try { setFanRibs(await inventoryApi.getFanRibs()); } catch { /* 忽略重新同步失败 */ }
    } finally {
      setTransitioning((prev) => ({ ...prev, [order.id]: false }));
    }
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
      const { fanRibs: latestRibs } = await inventoryApi.restockFanRib(selectedRibForRestock.id, 24);
      setFanRibs(latestRibs);
      showNotification('库存补足成功', 'success');
      setShowLowStock(false);
      setSelectedRibForRestock(null);
    } catch (err) { showNotification(getApiErrorMessage(err, '补足库存失败'), 'error'); }
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
        <>
          <button onClick={() => handleStatusChange(order, 'in_progress')} disabled={transitioning[order.id]}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">开始制作</button>
          <button onClick={() => handleStatusChange(order, 'cancelled')} disabled={transitioning[order.id]}
            className="px-3 py-1 bg-red-700 text-white rounded text-sm hover:bg-red-800 disabled:opacity-50">作废</button>
        </>
      )}
      {order.status === 'in_progress' && (
        <>
          <button onClick={() => handleStatusChange(order, 'completed')} disabled={transitioning[order.id]}
            className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">完成制作</button>
          <button onClick={() => handleStatusChange(order, 'pending')} disabled={transitioning[order.id]}
            className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 disabled:opacity-50">回退</button>
          <button onClick={() => handleStatusChange(order, 'cancelled')} disabled={transitioning[order.id]}
            className="px-3 py-1 bg-red-700 text-white rounded text-sm hover:bg-red-800 disabled:opacity-50">作废</button>
        </>
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold" style={{ color: COLORS.wood }}>订单管理</h2>
        <button
          onClick={() => setShowNewOrder(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium shadow hover:opacity-90 transition-opacity"
          style={{ backgroundColor: COLORS.wood, color: COLORS.cream }}
        >
          新建订单
        </button>
      </div>

      {loading ? (
        <Skeleton />
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-500">暂无订单，点击右上角「新建订单」开始</div>
      ) : (
        <>
          <TableView />
          <CardView />
        </>
      )}

      <Modal show={showNewOrder} onClose={() => setShowNewOrder(false)}>
        <h3 className="text-lg font-bold mb-4" style={{ color: COLORS.wood }}>新建订单</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">客户姓名</label>
            <input
              type="text"
              value={newOrder.customerName}
              onChange={(e) => setNewOrder({ ...newOrder, customerName: e.target.value })}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="请输入客户姓名"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">扇面类型</label>
            <select
              value={newOrder.fanSurfaceType}
              onChange={(e) => setNewOrder({ ...newOrder, fanSurfaceType: e.target.value })}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {fanSurfaceTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">扇骨材质</label>
            <select
              value={newOrder.fanRibMaterial}
              onChange={(e) => setNewOrder({ ...newOrder, fanRibMaterial: e.target.value })}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {fanRibMaterials.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowNewOrder(false)}
              className="px-4 py-2 rounded-lg text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
            >
              取消
            </button>
            <button
              onClick={handleCreateOrder}
              className="px-4 py-2 rounded-lg text-sm text-white hover:opacity-90"
              style={{ backgroundColor: COLORS.wood }}
            >
              创建订单
            </button>
          </div>
        </div>
      </Modal>

      <Modal show={showLowStock} onClose={() => { setShowLowStock(false); setSelectedRibForRestock(null); }}>
        <h3 className="text-lg font-bold mb-4" style={{ color: COLORS.cinnabar }}>库存不足</h3>
        {selectedRibForRestock ? (
          <p className="text-sm text-gray-700 mb-6">
            扇骨 #{selectedRibForRestock.number}（{getRibMaterialLabel([selectedRibForRestock.id])}）
            当前库存 {selectedRibForRestock.quantity} 件，制作一把绢扇需要 12 件，请先补足库存。
          </p>
        ) : (
          <p className="text-sm text-gray-700 mb-6">该材质暂无可用扇骨，请选择其他材质或稍后再试。</p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => { setShowLowStock(false); setSelectedRibForRestock(null); }}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            取消
          </button>
          {selectedRibForRestock && (
            <button
              onClick={handleRestock}
              className="px-4 py-2 rounded-lg text-sm text-white hover:opacity-90"
              style={{ backgroundColor: COLORS.malachite }}
            >
              补足库存（+24）
            </button>
          )}
        </div>
      </Modal>

      <Modal show={!!selectedOrderForDetail} onClose={() => setSelectedOrderForDetail(null)}>
        {selectedOrderForDetail && (
          <div>
            <h3 className="text-lg font-bold mb-4" style={{ color: COLORS.wood }}>订单详情</h3>
            <div className="flex items-center gap-4 mb-4">
              <img src={selectedOrderForDetail.thumbnail} alt="扇面" className="w-20 h-20 rounded object-cover" />
              <div>
                <p className="font-mono text-sm">{selectedOrderForDetail.orderNo}</p>
                <p className="font-medium">{selectedOrderForDetail.customerName}</p>
                <StatusBadge status={selectedOrderForDetail.status} />
              </div>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              <p>扇骨材质：{getRibMaterialLabel(selectedOrderForDetail.fanRibIds)}</p>
              <p>占用扇骨：{selectedOrderForDetail.fanRibIds.length} 件</p>
              <p>提交时间：{new Date(selectedOrderForDetail.submittedAt).toLocaleString('zh-CN')}</p>
              <p>更新时间：{new Date(selectedOrderForDetail.updatedAt).toLocaleString('zh-CN')}</p>
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setSelectedOrderForDetail(null)}
                className="px-4 py-2 rounded-lg text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal show={!!thumbnailModal} onClose={() => setThumbnailModal(null)}>
        {thumbnailModal && (
          <img src={thumbnailModal} alt="扇面大图" className="w-full rounded-lg" onClick={() => setThumbnailModal(null)} />
        )}
      </Modal>
    </div>
  );
}
