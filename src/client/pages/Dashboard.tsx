import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DashboardProps {
  user: any;
}

const Dashboard: React.FC<DashboardProps> = ({ user }) => {
  const [profile, setProfile] = useState<any>(null);
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        
        const [profileRes, rankingRes] = await Promise.all([
          fetch('/api/users/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch('/api/users/ranking')
        ]);
        
        const profileData = await profileRes.json();
        const rankingData = await rankingRes.json();
        
        setProfile(profileData);
        setRanking(rankingData);
      } catch (error) {
        console.error('获取数据失败:', error);
      }
      setLoading(false);
    };
    
    fetchData();
  }, []);

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待审核';
      case 'approved': return '已通过';
      case 'rejected': return '已拒绝';
      default: return status;
    }
  };

  if (loading) {
    return <div className="loading-more">加载中...</div>;
  }

  const rawMonthlyHours = profile?.user?.monthlyHours || [];
  
  const monthlyHours = rawMonthlyHours.map((item: any) => ({
    ...item,
    monthLabel: item.month ? item.month.slice(5) + '月' : ''
  }));
  
  const isSenior = (profile?.user?.totalHours || 0) >= 50;

  return (
    <div className="page-container">
      <h1 className="page-title">个人中心</h1>
      
      <div className="dashboard-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            borderRadius: '50%', 
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            fontWeight: '600',
            position: 'relative'
          }}>
            {profile?.user?.nickname?.charAt(0) || 'U'}
            {isSenior && (
              <span style={{
                position: 'absolute',
                top: '-5px',
                right: '-5px',
                fontSize: '28px',
                animation: 'bounceIn 0.5s ease'
              }}>
                ⭐
              </span>
            )}
          </div>
          <div>
            <h2 style={{ marginBottom: '8px' }}>
              {profile?.user?.nickname}
              {isSenior && <span className="senior-badge" style={{ marginLeft: '8px' }}>资深志愿者</span>}
            </h2>
            <p style={{ color: '#666' }}>@{profile?.user?.username}</p>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card primary">
          <div className="stat-value">{profile?.user?.totalHours || 0}</div>
          <div className="stat-label">累计服务时长（小时）</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{profile?.registeredProjects?.length || 0}</div>
          <div className="stat-label">已参与项目</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{profile?.registrations?.filter((r: any) => r.status === 'pending').length || 0}</div>
          <div className="stat-label">待审核</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>近6个月服务时长趋势</h3>
        <div className="chart-container">
          {monthlyHours.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyHours}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="monthLabel" stroke="#999" fontSize={12} />
                <YAxis stroke="#999" fontSize={12} unit="h" />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '8px', 
                    border: 'none', 
                    boxShadow: '0 4px 15px rgba(0,0,0,0.1)' 
                  }}
                  formatter={(value: number) => [`${value} 小时`, '服务时长']}
                  labelFormatter={(label: string) => `${label}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="hours" 
                  stroke="#2E86AB" 
                  strokeWidth={3}
                  dot={{ fill: '#A23B72', strokeWidth: 2, r: 5 }}
                  activeDot={{ r: 8 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">暂无数据</div>
          )}
        </div>
      </div>

      <div className="dashboard-section">
        <h3>我的报名记录</h3>
        {profile?.registrations?.length > 0 ? (
          <div className="registration-list">
            {profile.registrations.map((reg: any) => {
              const project = profile.registeredProjects?.find((p: any) => p.id === reg.id) || {};
              return (
                <div key={reg.id} className="registration-item">
                  <div className="registration-info">
                    <h4>{project.projectName || '项目'}</h4>
                    <p>
                      {project.serviceDate || ''} · {project.type || ''}
                    </p>
                    {reg.serviceHours > 0 && (
                      <p style={{ color: '#27ae60' }}>服务时长：{reg.serviceHours} 小时</p>
                    )}
                  </div>
                  <span className={`status-badge status-${reg.status}`}>
                    {getStatusText(reg.status)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">暂无报名记录</div>
        )}
      </div>

      <div className="dashboard-section">
        <h3>志愿者服务时长排行榜</h3>
        {ranking.length > 0 ? (
          <div className="ranking-list">
            {ranking.map((item, index) => (
              <div key={item.id} className="ranking-item">
                <div className="ranking-number">{index + 1}</div>
                <div className="ranking-avatar">
                  {item.nickname?.charAt(0) || 'V'}
                  {item.isSenior && (
                    <span style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-3px',
                      fontSize: '16px',
                      animation: 'bounceIn 0.5s ease'
                    }}>
                      ⭐
                    </span>
                  )}
                </div>
                <div className="ranking-info">
                  <div className="ranking-name">
                    {item.nickname}
                    {item.isSenior && <span className="senior-badge">资深</span>}
                  </div>
                  <div className="ranking-hours">累计 {item.totalHours} 小时</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无排行数据</div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
