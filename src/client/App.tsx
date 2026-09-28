import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';

const getInitialUser = () => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (token && storedUser) {
      try {
        return JSON.parse(storedUser);
      } catch (e) {
        console.error('解析用户信息失败');
      }
    }
  }
  return null;
};

const App: React.FC = () => {
  const [user, setUser] = useState<any>(getInitialUser);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [navbarOpen, setNavbarOpen] = useState(false);
  const [notification, setNotification] = useState<string>('');

  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('token');
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${token}`;
      
      const websocket = new WebSocket(wsUrl);
      
      websocket.onopen = () => {
        console.log('WebSocket连接已建立');
      };
      
      websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'approval' && user.role === 'volunteer') {
          const statusText = message.data.status === 'approved' ? '已通过' : '已拒绝';
          showNotification(`您的报名申请${statusText}`);
        }
      };
      
      websocket.onclose = () => {
        console.log('WebSocket连接已关闭');
      };
      
      setWs(websocket);
      
      return () => {
        websocket.close();
      };
    }
  }, [user?.id]);

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const handleLogin = useCallback((userData: any, token: string) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', token);
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (ws) {
      ws.close();
      setWs(null);
    }
  }, [ws]);

  const toggleNavbar = () => {
    setNavbarOpen(!navbarOpen);
  };

  const handleNotification = useCallback((message: string) => {
    showNotification(message);
  }, []);

  const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    if (!user) {
      return <Navigate to="/login" />;
    }
    return <>{children}</>;
  };

  const AdminRoute = ({ children }: { children: React.ReactNode }) => {
    if (!user || user.role !== 'admin') {
      return <Navigate to="/" />;
    }
    return <>{children}</>;
  };

  return (
    <Router>
      <div className="app-container">
        <Navbar 
          user={user} 
          onLogout={handleLogout}
          isOpen={navbarOpen}
          onToggle={toggleNavbar}
        />
        <main className={`main-content ${navbarOpen ? '' : 'full'}`}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/:id" element={<ProjectDetail user={user} ws={ws} onNotification={handleNotification} />} />
            <Route path="/login" element={<Login onLogin={handleLogin} />} />
            <Route path="/register" element={<Register onLogin={handleLogin} />} />
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <Dashboard user={user} />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin" 
              element={
                <AdminRoute>
                  <Admin user={user} ws={ws} onNotification={handleNotification} />
                </AdminRoute>
              } 
            />
          </Routes>
        </main>
        
        {notification && (
          <div className="notification">
            {notification}
          </div>
        )}
      </div>
    </Router>
  );
};

export default App;
