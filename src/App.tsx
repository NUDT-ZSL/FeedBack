import React, { useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import ArtGallery from './ArtGallery';
import ArtDetail from './ArtDetail';
import OrderManagement from './OrderManagement';
import OrderDetail from './OrderDetail';
import { useCart } from './CartContext';

const Navbar: React.FC = () => {
  const { cartCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { to: '/', label: '艺术品展示' },
    { to: '/orders', label: '订单管理' },
  ];

  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link to="/" className="logo">
          匠心独运
        </Link>

        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`nav-link ${location.pathname === link.to ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="cart-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </div>
        </div>
      </div>
    </nav>
  );
};

const App: React.FC = () => {
  return (
    <div className="app">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<ArtGallery />} />
          <Route path="/artwork/:id" element={<ArtDetail />} />
          <Route path="/orders" element={<OrderManagement />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </main>
      <footer className="footer">
        <p>© 2024 匠心独运 - 手工艺品限量发售平台</p>
      </footer>
    </div>
  );
};

export default App;
