import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ProjectCard from '../components/ProjectCard';

const Home: React.FC = () => {
  const [featuredProjects, setFeaturedProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch('/api/projects?page=1&limit=4');
        const data = await response.json();
        setFeaturedProjects(data.projects);
      } catch (error) {
        console.error('加载项目失败:', error);
      }
      setLoading(false);
    };
    fetchProjects();
  }, []);

  return (
    <div className="page-container">
      <div style={{
        background: 'linear-gradient(135deg, #2E86AB 0%, #A23B72 100%)',
        borderRadius: '20px',
        padding: '60px 40px',
        color: 'white',
        marginBottom: '40px',
        textAlign: 'center'
      }}>
        <h1 style={{ fontSize: '36px', marginBottom: '16px' }}>志愿服务管理平台</h1>
        <p style={{ fontSize: '18px', opacity: 0.9, marginBottom: '24px' }}>
          参与志愿服务，共建美好社区
        </p>
        <Link 
          to="/projects" 
          style={{
            display: 'inline-block',
            padding: '12px 32px',
            background: 'white',
            color: '#2E86AB',
            borderRadius: '30px',
            textDecoration: 'none',
            fontWeight: '600',
            transition: 'transform 0.3s ease',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
          }}
        >
          浏览全部项目
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '40px' }}>
        <div style={{
          background: 'white',
          padding: '24px',
          borderRadius: '16px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🌿</div>
          <h3 style={{ marginBottom: '8px', color: '#333' }}>环保行动</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>参与环保志愿活动，守护绿色家园</p>
        </div>
        <div style={{
          background: 'white',
          padding: '24px',
          borderRadius: '16px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>📚</div>
          <h3 style={{ marginBottom: '8px', color: '#333' }}>教育支持</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>用知识照亮他人成长之路</p>
        </div>
        <div style={{
          background: 'white',
          padding: '24px',
          borderRadius: '16px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>❤️</div>
          <h3 style={{ marginBottom: '8px', color: '#333' }}>助老服务</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>用爱心温暖每一位老人</p>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>热门项目</h2>
          <Link to="/projects" style={{ color: '#2E86AB', textDecoration: 'none' }}>
            查看全部 →
          </Link>
        </div>
        {loading ? (
          <div className="loading-more">加载中...</div>
        ) : (
          <div className="projects-grid">
            {featuredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
