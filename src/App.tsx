import { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Catalog from './components/Catalog';
import Customizer from './components/Customizer';
import OrderTracker, { generateMockOrder } from './components/OrderTracker';
import { products as allProducts, getProductById } from './data/products';
import { Order } from './types';
import './styles/global.css';

type PageRoute = 'home' | 'customize' | 'track';

function Navbar({
  currentPage,
  selectedCount,
  onNavigate
}: {
  currentPage: PageRoute;
  selectedCount: number;
  onNavigate: (p: PageRoute) => void;
}) {
  return (
    <nav className="navbar">
      <div className="nav-inner">
        <div className="nav-brand" onClick={() => onNavigate('home')}>
          <span className="brand-icon">🍫</span>
          <div className="brand-text">
            <span className="brand-name">CocoArt</span>
            <span className="brand-slogan">精品巧克力工坊</span>
          </div>
        </div>
        <div className="nav-links">
          <button
            className={`nav-link ${currentPage === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate('home')}
          >
            🏠 产品目录
          </button>
          <button
            className={`nav-link ${currentPage === 'customize' ? 'active' : ''}`}
            onClick={() => onNavigate('customize')}
          >
            🎁 定制礼盒
            {selectedCount > 0 && <span className="nav-badge">{selectedCount}</span>}
          </button>
          <button
            className={`nav-link ${currentPage === 'track' ? 'active' : ''}`}
            onClick={() => onNavigate('track')}
          >
            📦 订单追踪
          </button>
        </div>
      </div>
    </nav>
  );
}

function HomePage({
  selectedIds,
  onAddProduct,
  onGoCustomize
}: {
  selectedIds: Set<string>;
  onAddProduct: (id: string) => void;
  onGoCustomize: () => void;
}) {
  const handleSelect = useCallback(
    (id: string) => {
      if (selectedIds.has(id)) {
        onGoCustomize();
        return;
      }
      if (selectedIds.size >= 6) {
        onAddProduct(id);
        return;
      }
      onAddProduct(id);
    },
    [selectedIds, onAddProduct, onGoCustomize]
  );

  return (
    <>
      <Catalog onSelectProduct={handleSelect} selectedProductIds={selectedIds} />
      {selectedIds.size > 0 && (
        <div className="floating-customize-bar">
          <div className="bar-content">
            <span className="bar-count">已选 {selectedIds.size}/6 款</span>
            <button className="bar-btn" onClick={onGoCustomize}>
              前往定制礼盒 →
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CustomizePage({
  selectedIds,
  quantities,
  onUpdateQuantities,
  onRemoveProduct,
  onConfirm,
  onBack
}: {
  selectedIds: Set<string>;
  quantities: Record<string, number>;
  onUpdateQuantities: (id: string, q: number) => void;
  onRemoveProduct: (id: string) => void;
  onConfirm: (card: string) => void;
  onBack: () => void;
}) {
  const selectedProducts = allProducts.filter(p => selectedIds.has(p.id));

  return (
    <Customizer
      selectedProducts={selectedProducts}
      quantities={quantities}
      onUpdateQuantity={onUpdateQuantities}
      onRemoveProduct={onRemoveProduct}
      onConfirm={onConfirm}
      onBack={onBack}
    />
  );
}

function TrackPageWrapper({
  onBack,
  explicitOrderId
}: {
  onBack: () => void;
  explicitOrderId?: string;
}) {
  const params = useParams();
  const orderId = explicitOrderId || params.orderId;

  return <OrderTracker orderId={orderId} onBack={onBack} />;
}

function AppRoutes({
  selectedIds,
  setSelectedIds,
  quantities,
  setQuantities,
  latestOrderId,
  setLatestOrderId
}: {
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  quantities: Record<string, number>;
  setQuantities: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  latestOrderId: string | null;
  setLatestOrderId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const currentPage: PageRoute = location.pathname.startsWith('/customize')
    ? 'customize'
    : location.pathname.startsWith('/track')
    ? 'track'
    : 'home';

  const handleAddProduct = useCallback(
    (id: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          return next;
        }
        if (next.size >= 6) {
          import('react-hot-toast').then(({ toast }) => {
            toast.error('礼盒最多选择 6 款巧克力', { icon: '🎁' });
          });
          return prev;
        }
        next.add(id);
        return next;
      });
      setQuantities(prev => ({ ...prev, [id]: prev[id] || 1 }));
    },
    [setSelectedIds, setQuantities]
  );

  const handleRemoveProduct = useCallback(
    (id: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setQuantities(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setSelectedIds, setQuantities]
  );

  const handleConfirmOrder = useCallback(
    (greetingCard: string) => {
      const items = Array.from(selectedIds).map(id => ({
        productId: id,
        quantity: quantities[id] || 1
      }));
      const totalPieces = items.reduce((s, i) => s + i.quantity, 0);
      let price = 0;
      items.forEach(it => {
        const p = getProductById(it.productId);
        if (p) price += p.price * it.quantity;
      });

      const mockOrder: Order = generateMockOrder({
        items,
        greetingCard,
        totalPieces,
        estimatedPrice: Math.round(price * 100) / 100
      });

      try {
        sessionStorage.setItem(
          'pending_order',
          JSON.stringify({
            ...mockOrder,
            createdAt: mockOrder.createdAt.toISOString(),
            estimatedCompletionTime: mockOrder.estimatedCompletionTime.toISOString(),
            box: {
              ...mockOrder.box,
              createdAt: mockOrder.box.createdAt.toISOString()
            }
          })
        );
      } catch {
        // ignore storage errors
      }

      setLatestOrderId(mockOrder.id);
      setSelectedIds(new Set());
      setQuantities({});

      import('react-hot-toast').then(({ toast }) => {
        toast.success('订单创建成功！正在跳转追踪页面...', {
          icon: '🎉',
          duration: 2500,
          style: {
            background: '#FFF8E1',
            color: '#3E2723',
            border: '1px solid #D4A017',
            borderRadius: '12px',
            fontFamily: "'Noto Serif SC', serif"
          }
        });
      });

      setTimeout(() => {
        navigate(`/track/${mockOrder.id}`);
      }, 400);
    },
    [selectedIds, quantities, setSelectedIds, setQuantities, setLatestOrderId, navigate]
  );

  return (
    <div className="app-shell">
      <Navbar
        currentPage={currentPage}
        selectedCount={selectedIds.size}
        onNavigate={(p: PageRoute) => {
          if (p === 'home') navigate('/');
          else if (p === 'customize') navigate('/customize');
          else navigate('/track');
        }}
      />
      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                selectedIds={selectedIds}
                onAddProduct={handleAddProduct}
                onGoCustomize={() => navigate('/customize')}
              />
            }
          />
          <Route
            path="/customize"
            element={
              <CustomizePage
                selectedIds={selectedIds}
                quantities={quantities}
                onUpdateQuantities={(id, q) =>
                  setQuantities(prev => ({ ...prev, [id]: q }))
                }
                onRemoveProduct={handleRemoveProduct}
                onConfirm={handleConfirmOrder}
                onBack={() => navigate('/')}
              />
            }
          />
          <Route
            path="/track"
            element={<TrackPageWrapper onBack={() => navigate('/')} />}
          />
          <Route
            path="/track/:orderId"
            element={
              <TrackPageWrapper
                onBack={() => navigate('/')}
                explicitOrderId={latestOrderId || undefined}
              />
            }
          />
          <Route path="*" element={
            <div className="not-found fade-in">
              <div className="nf-icon">🍂</div>
              <h2>页面不存在</h2>
              <Link to="/" className="nf-link">← 返回首页</Link>
            </div>
          } />
        </Routes>
      </main>
      <footer className="app-footer">
        <div className="footer-inner">
          <span>© 2026 CocoArt · 精品巧克力工坊</span>
          <span className="footer-tags">用心制作 · 每一块都是艺术品</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [latestOrderId, setLatestOrderId] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('cocoart_selected');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data.ids)) {
          setSelectedIds(new Set(data.ids));
        }
        if (data.quantities && typeof data.quantities === 'object') {
          setQuantities(data.quantities);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        'cocoart_selected',
        JSON.stringify({
          ids: Array.from(selectedIds),
          quantities
        })
      );
    } catch {
      // ignore
    }
  }, [selectedIds, quantities]);

  return (
    <BrowserRouter>
      <AppRoutes
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        quantities={quantities}
        setQuantities={setQuantities}
        latestOrderId={latestOrderId}
        setLatestOrderId={setLatestOrderId}
      />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2000,
          style: {
            fontFamily: "'Noto Serif SC', serif",
            fontWeight: 600
          }
        }}
      />
    </BrowserRouter>
  );
}
