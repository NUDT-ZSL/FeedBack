import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Info } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Pet, Diary, SPECIES_LABELS, MOOD_LABELS, MOOD_COLORS } from '../types';

function PetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fetchPetById, fetchPetDiaries, state } = useApp();
  
  const [pet, setPet] = useState<Pet | null>(null);
  const [recentDiaries, setRecentDiaries] = useState<Diary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadData(id);
    }
  }, [id]);

  const loadData = async (petId: string) => {
    setLoading(true);
    const [petData, diariesData] = await Promise.all([
      fetchPetById(petId),
      fetchPetDiaries(petId, 3)
    ]);
    setPet(petData);
    setRecentDiaries(diariesData);
    setLoading(false);
  };

  const allImages = recentDiaries.flatMap(d => d.images).slice(0, 9);

  if (loading) {
    return <div style={styles.loading}>加载中...</div>;
  }

  if (!pet) {
    return <div style={styles.loading}>宠物不存在</div>;
  }

  return (
    <div style={styles.container}>
      <button style={styles.backButton} className="button-hover" onClick={() => navigate(-1)}>
        <ArrowLeft size={20} style={{ marginRight: 8 }} />
        返回
      </button>

      <div style={styles.header}>
        <div style={styles.avatarSection}>
          <img src={pet.avatar} alt={pet.name} style={styles.avatar} />
          <div style={styles.infoSection}>
            <h1 style={styles.name}>{pet.name}</h1>
            <div style={styles.tags}>
              <span style={styles.speciesTag}>{SPECIES_LABELS[pet.species]}</span>
              <span style={{
                ...styles.statusTag,
                backgroundColor: pet.status === 'fostering' ? '#E67E2220' : '#2ECC7120',
                color: pet.status === 'fostering' ? '#E67E22' : '#2ECC71'
              }}>
                {pet.status === 'fostering' ? '托管中' : '在家'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>
          <Info size={20} style={{ marginRight: 8 }} />
          基本信息
        </h2>
        <div style={styles.infoGrid}>
          <div style={styles.infoCard}>
            <span style={styles.infoLabel}>品种</span>
            <span style={styles.infoValue}>{pet.breed}</span>
          </div>
          <div style={styles.infoCard}>
            <span style={styles.infoLabel}>年龄</span>
            <span style={styles.infoValue}>{pet.age} 岁</span>
          </div>
          <div style={styles.infoCard}>
            <span style={styles.infoLabel}>性别</span>
            <span style={styles.infoValue}>{pet.gender === 'male' ? '男孩 ♂' : '女孩 ♀'}</span>
          </div>
          <div style={styles.infoCard}>
            <span style={styles.infoLabel}>加入时间</span>
            <span style={styles.infoValue}>
              {new Date(pet.createdAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>
          <Calendar size={20} style={{ marginRight: 8 }} />
          最近日记
        </h2>
        
        {recentDiaries.length > 0 ? (
          <>
            <div style={styles.thumbnailWall}>
              {allImages.map((img, idx) => (
                <div
                  key={idx}
                  style={styles.thumbnail}
                  onClick={() => setSelectedImage(img)}
                  className="animate-fade-in"
                >
                  <img 
                    src={img} 
                    alt="" 
                    style={styles.thumbnailImg}
                    loading="lazy"
                  />
                </div>
              ))}
              {allImages.length === 0 && (
                <p style={styles.noImages}>暂无照片</p>
              )}
            </div>

            <div style={styles.diaryList}>
              {recentDiaries.map((diary, idx) => (
                <div 
                  key={diary.id} 
                  style={styles.diaryCard}
                  className="animate-slide-up card-hover"
                >
                  <div style={styles.diaryHeader}>
                    <span 
                      style={{
                        ...styles.moodBadge,
                        backgroundColor: MOOD_COLORS[diary.mood] + '20',
                        color: MOOD_COLORS[diary.mood]
                      }}
                    >
                      {MOOD_LABELS[diary.mood]}
                    </span>
                    <span style={styles.diaryDate}>
                      {new Date(diary.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <p style={styles.diaryContent}>{diary.content}</p>
                  {diary.images.length > 0 && (
                    <div style={styles.diaryImages}>
                      {diary.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt=""
                          style={styles.diaryImage}
                          onClick={() => setSelectedImage(img)}
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={styles.empty}>
            <p>还没有日记记录</p>
          </div>
        )}
      </div>

      {selectedImage && (
        <div 
          style={styles.imageModal}
          className="animate-fade-in"
          onClick={() => setSelectedImage(null)}
        >
          <div 
            style={styles.imageContainer}
            className="animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <img 
              src={selectedImage} 
              alt="" 
              style={styles.fullImage}
            />
            <button 
              style={styles.closeImage}
              onClick={() => setSelectedImage(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: 800,
    margin: '0 auto'
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6B4226',
    fontSize: 15,
    cursor: 'pointer',
    marginBottom: 20,
    borderRadius: 8,
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  loading: {
    textAlign: 'center',
    padding: '60px 0',
    color: '#8D8D8D'
  },
  header: {
    backgroundColor: '#FFFCF7',
    borderRadius: 20,
    padding: 32,
    marginBottom: 24,
    boxShadow: '0 2px 12px rgba(107, 66, 38, 0.08)'
  },
  avatarSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 24
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '4px solid white',
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
  },
  infoSection: {
    flex: 1
  },
  name: {
    fontSize: 32,
    fontWeight: 600,
    color: '#3D2914',
    margin: '0 0 12px 0'
  },
  tags: {
    display: 'flex',
    gap: 12
  },
  speciesTag: {
    padding: '6px 16px',
    backgroundColor: '#6B4226',
    color: 'white',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 500
  },
  statusTag: {
    padding: '6px 16px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 500
  },
  section: {
    marginBottom: 32
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 20,
    fontWeight: 600,
    color: '#3D2914',
    margin: '0 0 20px 0'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 16
  },
  infoCard: {
    backgroundColor: '#FFFCF7',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(107, 66, 38, 0.06)'
  },
  infoLabel: {
    display: 'block',
    fontSize: 13,
    color: '#8D8D8D',
    marginBottom: 6
  },
  infoValue: {
    fontSize: 18,
    fontWeight: 500,
    color: '#3D2914'
  },
  thumbnailWall: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 80px)',
    gap: 12,
    marginBottom: 24
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  noImages: {
    color: '#8D8D8D',
    fontSize: 14,
    gridColumn: '1 / -1',
    textAlign: 'center',
    padding: 20
  },
  diaryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16
  },
  diaryCard: {
    backgroundColor: '#FFFCF7',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(107, 66, 38, 0.06)',
    opacity: 0
  },
  diaryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  moodBadge: {
    padding: '4px 12px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 500
  },
  diaryDate: {
    fontSize: 12,
    color: '#8D8D8D'
  },
  diaryContent: {
    fontSize: 15,
    color: '#3D2914',
    lineHeight: 1.6,
    margin: '0 0 12px 0'
  },
  diaryImages: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  diaryImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
    objectFit: 'cover',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  empty: {
    textAlign: 'center',
    padding: 40,
    color: '#8D8D8D',
    backgroundColor: '#FFFCF7',
    borderRadius: 16
  },
  imageModal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20
  },
  imageContainer: {
    position: 'relative',
    maxWidth: '90vw',
    maxHeight: '90vh',
    opacity: 0
  },
  fullImage: {
    maxWidth: '100%',
    maxHeight: '85vh',
    borderRadius: 12,
    objectFit: 'contain'
  },
  closeImage: {
    position: 'absolute',
    top: -40,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: 'white',
    fontSize: 24,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};

export default PetDetail;
