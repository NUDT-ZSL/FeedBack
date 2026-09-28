import { Link, useLocation } from 'react-router-dom';
import { Music, Calendar, UserCheck, Clock, Star } from 'lucide-react';
import './Navbar.css';

interface NavbarProps {
  isAdmin: boolean;
}

export default function Navbar({ isAdmin }: NavbarProps) {
  const location = useLocation();

  const navItems = [
    { path: '/', label: '演出日程', icon: Calendar },
    { path: '/apply', label: '乐队报名', icon: Music },
  ];

  const adminItems = [
    { path: '/admin', label: '审核面板', icon: UserCheck },
    { path: '/schedule', label: '排期管理', icon: Clock },
  ];

  const allItems = isAdmin ? [...navItems, ...adminItems] : navItems;

  return (
    <nav className="navbar">
      <div className="navbar-content">
        <Link to="/" className="navbar-logo">
          <Star className="logo-icon" />
          <span className="logo-text">星空音乐节</span>
        </Link>

        <div className="navbar-links">
          {allItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
