import React from 'react';
import { useStar } from '../context/StarContext';

const Toast: React.FC = () => {
  const { showToast } = useStar();

  if (!showToast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(0, 0, 0, 0.9)',
        color: '#ffd700',
        padding: '16px 32px',
        borderRadius: '8px',
        fontSize: '16px',
        fontFamily: "'Noto Serif SC', serif",
        boxShadow: '0 0 30px rgba(255, 215, 0, 0.3)',
        border: '1px solid rgba(255, 215, 0, 0.5)',
        zIndex: 200,
        animation: 'fadeIn 0.3s ease',
      }}
    >
      {showToast}
    </div>
  );
};

export default Toast;
