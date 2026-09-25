import { Routes, Route, NavLink } from 'react-router-dom';
import EventList from './pages/EventList';
import CreateEvent from './pages/CreateEvent';
import EventDetail from './pages/EventDetail';
import RegistrationSuccess from './pages/RegistrationSuccess';
import CheckInManager from './pages/CheckInManager';

function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <NavLink to="/" className="navbar-brand">
          <span className="navbar-logo">📅</span>
          <span className="navbar-title">Activity Hub</span>
        </NavLink>
        <div className="navbar-links">
          <NavLink to="/" end className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}>
            🏠 活动列表
          </NavLink>
          <NavLink to="/create" className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}>
            ➕ 发布活动
          </NavLink>
          <NavLink to="/checkin" className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}>
            ✅ 签到管理
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<EventList />} />
        <Route path="/create" element={<CreateEvent />} />
        <Route path="/event/:id" element={<EventDetail />} />
        <Route path="/success/:regId" element={<RegistrationSuccess />} />
        <Route path="/checkin" element={<CheckInManager />} />
      </Routes>
    </>
  );
}
