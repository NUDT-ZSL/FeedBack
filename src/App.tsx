import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState } from 'react';
import Home from './pages/Home';
import Trust from './pages/Trust';
import Calendar from './pages/Calendar';
import './App.scss';

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { to: '/', label: '🌿 植物墙' },
    { to: '/trust', label: '🤝 托管中心' },
    { to: '/calendar', label: '📅 养护日历' },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="logo">
          <span className="logo-icon">🌱</span>
          <span className="logo-text">绿植之家</span>
        </div>
        <button
          className={`hamburger ${menuOpen ? 'active' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="菜单"
        >
          <span />
          <span />
          <span />
        </button>
        <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
          <div className="nav-user">
            <span className="avatar">🧑</span>
            <span>植物主人</span>
          </div>
        </div>
      </div>
      {menuOpen && <div className="menu-overlay" onClick={() => setMenuOpen(false)} />}
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <NavBar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/trust" element={<Trust />} />
            <Route path="/calendar" element={<Calendar />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
