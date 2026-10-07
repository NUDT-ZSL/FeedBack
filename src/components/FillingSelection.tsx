import React, { useState, useEffect } from 'react';
import { Filling } from '../types';

interface FillingSelectionProps {
  selectedFillings: Filling[];
  onSelectFillings: (fillings: Filling[]) => void;
  onNext: () => void;
  onBack: () => void;
}

const FillingSelection: React.FC<FillingSelectionProps> = ({
  selectedFillings,
  onSelectFillings,
  onNext,
  onBack,
}) => {
  const [fillings, setFillings] = useState<Filling[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [animatingId, setAnimatingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchFillings = async () => {
      try {
        const response = await fetch('/api/fillings');
        const data = await response.json();
        setFillings(data);
      } catch (error) {
        console.error('Failed to fetch fillings:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchFillings();
  }, []);

  const handleFillingClick = (filling: Filling) => {
    const isSelected = selectedFillings.some(f => f.id === filling.id);
    
    if (isSelected) {
      onSelectFillings(selectedFillings.filter(f => f.id !== filling.id));
    } else if (selectedFillings.length < 3) {
      setAnimatingId(filling.id);
      setTimeout(() => setAnimatingId(null), 500);
      onSelectFillings([...selectedFillings, filling]);
    }
  };

  const isDisabled = (filling: Filling) => {
    return selectedFillings.length >= 3 && !selectedFillings.some(f => f.id === filling.id);
  };

  const isSelected = (filling: Filling) => {
    return selectedFillings.some(f => f.id === filling.id);
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>加载中...</div>
      </div>
    );
  }

  return (
    <div style={styles.container} className="page-transition">
      <h2 style={styles.title}>选择馅料</h2>
      <p style={styles.subtitle}>最多可选择3种馅料组合</p>
      
      <div style={styles.grid} className="filling-grid">
        {fillings.map((filling) => (
          <div
            key={filling.id}
            style={{
              ...styles.card,
              ...(hoveredId === filling.id ? styles.cardHover : {}),
              ...(isSelected(filling) ? styles.cardSelected : {}),
              ...(isDisabled(filling) ? styles.cardDisabled : {}),
            }}
            onClick={() => !isDisabled(filling) && handleFillingClick(filling)}
            onMouseEnter={() => setHoveredId(filling.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {isSelected(filling) && (
              <div style={{
                ...styles.checkmark,
                ...(animatingId === filling.id ? styles.checkmarkAnim : {}),
              }}>
                ✓
              </div>
            )}
            <img
              src={filling.image}
              alt={filling.name}
              style={styles.image}
            />
            <div style={styles.cardContent}>
              <h3 style={styles.cardTitle}>{filling.name}</h3>
              <p style={styles.cardDesc}>{filling.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.selectedBar}>
        <span style={styles.selectedLabel}>已选馅料：</span>
        {selectedFillings.length === 0 ? (
          <span style={styles.selectedEmpty}>请选择馅料</span>
        ) : (
          selectedFillings.map((f, i) => (
            <span key={f.id} style={styles.selectedTag}>
              {f.name}{i < selectedFillings.length - 1 ? '、' : ''}
            </span>
          ))
        )}
      </div>

      <div style={styles.buttonBar}>
        <button className="btn-ancient" onClick={onBack} style={styles.backBtn}>
          返回
        </button>
        <button
          className="btn-ancient"
          onClick={onNext}
          disabled={selectedFillings.length === 0}
          style={styles.nextBtn}
        >
          下一步
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#f5e6d0',
  },
  loading: {
    fontSize: '24px',
    color: '#c0392b',
    marginTop: '100px',
  },
  title: {
    fontSize: '36px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '30px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    maxWidth: '700px',
    width: '100%',
    marginBottom: '30px',
  },
  '@media (max-width: 768px)': {
    grid: {
      gridTemplateColumns: 'repeat(2, 1fr)',
    },
  },
  card: {
    position: 'relative',
    backgroundColor: '#fff9f0',
    borderRadius: '12px',
    padding: '16px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    border: '2px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  cardHover: {
    transform: 'scale(1.2)',
    zIndex: 10,
    boxShadow: '0 8px 25px rgba(0,0,0,0.2)',
    borderColor: '#d4ac0d',
  },
  cardSelected: {
    borderColor: '#27ae60',
    backgroundColor: '#e8f5e9',
  },
  cardDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    filter: 'grayscale(80%)',
  },
  checkmark: {
    position: 'absolute',
    top: '10px',
    left: '10px',
    width: '28px',
    height: '28px',
    backgroundColor: '#27ae60',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 'bold',
  },
  checkmarkAnim: {
    animation: 'checkmarkPop 0.5s ease',
  },
  image: {
    width: '60px',
    height: '60px',
    borderRadius: '8px',
    objectFit: 'cover',
    marginBottom: '12px',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: '18px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '4px',
  },
  cardDesc: {
    fontSize: '12px',
    color: '#888',
    lineHeight: '1.4',
  },
  selectedBar: {
    backgroundColor: '#fff9f0',
    padding: '16px 24px',
    borderRadius: '12px',
    marginBottom: '20px',
    border: '1px solid #d4ac0d',
    maxWidth: '700px',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  selectedLabel: {
    fontSize: '16px',
    color: '#c0392b',
    fontWeight: 'bold',
  },
  selectedEmpty: {
    fontSize: '16px',
    color: '#999',
  },
  selectedTag: {
    fontSize: '16px',
    color: '#333',
  },
  buttonBar: {
    display: 'flex',
    gap: '20px',
    maxWidth: '700px',
    width: '100%',
    justifyContent: 'space-between',
  },
  backBtn: {
    minWidth: '120px',
  },
  nextBtn: {
    minWidth: '120px',
  },
};

export default FillingSelection;
