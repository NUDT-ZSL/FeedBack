import React from 'react';
import { useStar } from '../context/StarContext';
import { cartesianToSpherical } from '../utils';

const StarInfoPanel: React.FC = () => {
  const { selectedStar } = useStar();

  if (!selectedStar) return null;

  const { ra, dec } = cartesianToSpherical(...selectedStar.position);

  return (
    <div
      style={{
        position: 'fixed',
        right: '280px',
        bottom: '20px',
        minWidth: '300px',
        background: 'linear-gradient(135deg, rgba(13, 2, 33, 0.95) 0%, rgba(26, 26, 78, 0.95) 100%)',
        border: '1px solid rgba(255, 215, 0, 0.4)',
        borderRadius: '12px',
        padding: '16px 20px',
        color: 'white',
        boxShadow: '0 0 30px rgba(255, 215, 0, 0.2), inset 0 0 20px rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(10px)',
        zIndex: 50,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '12px',
      }}>
        <div style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: selectedStar.color,
          boxShadow: `0 0 15px ${selectedStar.color}`,
        }} />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Noto Serif SC', serif" }}>
            {selectedStar.name}
          </div>
          <div style={{ fontSize: '12px', color: '#aaa', fontFamily: 'serif' }}>
            {selectedStar.latinName}
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '6px 16px',
        fontSize: '13px',
      }}>
        <div style={{ color: '#ffd700' }}>赤经:</div>
        <div style={{ fontFamily: 'monospace' }}>{ra.toFixed(2)}°</div>
        <div style={{ color: '#ffd700' }}>赤纬:</div>
        <div style={{ fontFamily: 'monospace' }}>{dec.toFixed(2)}°</div>
        <div style={{ color: '#ffd700' }}>视星等:</div>
        <div style={{ fontFamily: 'monospace' }}>{selectedStar.magnitude.toFixed(1)}</div>
        <div style={{ color: '#ffd700' }}>类型:</div>
        <div>
          {selectedStar.type === 'star' && '恒星'}
          {selectedStar.type === 'planet' && '行星'}
          {selectedStar.type === 'moon' && '卫星'}
        </div>
      </div>

      <div style={{
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(255, 215, 0, 0.2)',
        fontSize: '12px',
        color: '#ccc',
        lineHeight: 1.6,
      }}>
        {selectedStar.description}
      </div>
    </div>
  );
};

export default StarInfoPanel;
