import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, Bell, Menu, LogOut, User, X } from 'lucide-react';
import { useAuth } from '../store/AppContext';
import { cn } from '@/lib/utils';
import SearchBar from './SearchBar';

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hasNotification] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isLoginPage = location.pathname === '/login';

  useEffect(() => {
    if (!isAuthenticated && !isLoginPage) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoginPage, navigate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    setIsDropdownOpen(false);
    navigate('/login');
  };

  const navLinks = [
    { name: '个人厨房', href: '/kitchen', showWhenLoggedIn: true },
    { name: '动态', href: '/feed', showWhenLoggedIn: true },
    { name: '发布菜谱', href: '/create-recipe', showWhenLoggedIn: true },
  ];

  const visibleLinks = navLinks.filter(
    (link) => !link.showWhenLoggedIn || isAuthenticated
  );

  if (isLoginPage) {
    return null;
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div className="bg-cream-100/80 backdrop-blur-md border-b border-brown-200/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <Link to="/" className="flex items-center gap-2 group">
                <ChefHat className="w-8 h-8 text-brown-500 group-hover:text-forest-500 transition-colors duration-300" />
                <span className="text-xl font-bold text-brown-500 font-display">
                  美味厨房
                </span>
              </Link>
            </div>

            <div className="hidden md:flex items-center gap-1">
              {visibleLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.href}
                  className={cn(
                    'px-4 py-2 rounded-lg text-brown-600 hover:text-brown-700',
                    'hover:bg-cream-200/50',
                    'transition-all duration-300 ease-out',
                    'relative after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2',
                    'after:w-0 after:h-0.5 after:bg-forest-500',
                    'after:transition-all after:duration-300',
                    'hover:after:w-3/4'
                  )}
                >
                  {link.name}
                </Link>
              ))}
            </div>

            <div className="hidden md:block">
              <SearchBar />
            </div>

            <div className="hidden md:flex items-center gap-4">
              {isAuthenticated && (
                <button className="relative p-2 rounded-full hover:bg-cream-200/50 transition-colors duration-300">
                  <Bell className="w-5 h-5 text-brown-500 hover:text-brown-700 transition-colors duration-300" />
                  {hasNotification && (
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-accent-red rounded-full animate-pulse-dot" />
                  )}
                </button>
              )}

              {isAuthenticated && user && (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="flex items-center gap-2 p-1 rounded-full hover:bg-cream-200/50 transition-colors duration-300"
                  >
                    <img
                      src={user.avatar}
                      alt={user.username}
                      className="w-9 h-9 rounded-full object-cover border-2 border-brown-200 hover:border-forest-500 transition-colors duration-300"
                    />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-card-hover border border-brown-100 overflow-hidden animate-fade-in-up origin-top-right">
                      <Link
                        to="/profile"
                        onClick={() => setIsDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 text-brown-600 hover:bg-cream-100 hover:text-brown-700 transition-colors duration-200"
                      >
                        <User className="w-5 h-5" />
                        <span>个人主页</span>
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-4 py-3 text-left text-brown-600 hover:bg-cream-100 hover:text-accent-red transition-colors duration-200"
                      >
                        <LogOut className="w-5 h-5" />
                        <span>退出登录</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!isAuthenticated && (
                <Link
                  to="/login"
                  className="px-4 py-2 rounded-lg bg-brown-500 text-white hover:bg-brown-600 transition-colors duration-300"
                >
                  登录
                </Link>
              )}
            </div>

            <button
              className="md:hidden p-2 rounded-lg hover:bg-cream-200/50 transition-colors duration-300"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? (
                <X className="w-6 h-6 text-brown-500" />
              ) : (
                <Menu className="w-6 h-6 text-brown-500" />
              )}
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="md:hidden bg-cream-100/95 backdrop-blur-md border-b border-brown-200/30 animate-fade-in-up">
            <div className="px-4 py-4 space-y-2">
              <div className="pb-4">
                <SearchBar />
              </div>

              {visibleLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={cn(
                    'block px-4 py-3 rounded-lg text-brown-600 hover:text-brown-700',
                    'hover:bg-cream-200/50',
                    'transition-all duration-300'
                  )}
                >
                  {link.name}
                </Link>
              ))}

              {isAuthenticated && (
                <div className="pt-4 border-t border-brown-200/30">
                  <Link
                    to="/profile"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-brown-600 hover:bg-cream-200/50 transition-colors duration-300"
                  >
                    <User className="w-5 h-5" />
                    <span>个人主页</span>
                  </Link>
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left text-brown-600 hover:bg-cream-200/50 hover:text-accent-red transition-colors duration-300"
                  >
                    <LogOut className="w-5 h-5" />
                    <span>退出登录</span>
                  </button>
                </div>
              )}

              {!isAuthenticated && (
                <div className="pt-4 border-t border-brown-200/30">
                  <Link
                    to="/login"
                    onClick={() => setIsMenuOpen(false)}
                    className="block w-full px-4 py-3 rounded-lg bg-brown-500 text-white text-center hover:bg-brown-600 transition-colors duration-300"
                  >
                    登录
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
