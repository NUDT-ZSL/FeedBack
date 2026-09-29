import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { MdDirectionsBike, MdMergeType } from 'react-icons/md';
import RideList from './components/RideList';
import RouteMerger from './components/RouteMerger';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <nav className="app-nav">
          <div className="app-nav-logo">
            🚴 <span>RideLog</span>
          </div>
          <div className="nav-links">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <MdDirectionsBike size={18} />
              <span>骑行记录</span>
            </NavLink>
            <NavLink
              to="/merger"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <MdMergeType size={18} />
              <span>路线拼接</span>
            </NavLink>
          </div>
        </nav>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<RideList />} />
            <Route path="/merger" element={<RouteMerger />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
