import React from 'react';
import { useAppContext } from '../context/AppContext';

export const Toast: React.FC = () => {
  const { toasts, removeToast } = useAppContext();

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}
    >
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          onClick={() => removeToast(toast.id)}
          style={{
            padding: '12px 20px',
            borderRadius: '8px',
            backgroundColor:
              toast.type === 'success'
                ? '#4CAF50'
                : toast.type === 'error'
                ? '#F44336'
                : '#4A90D9',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
            cursor: 'pointer',
            animation: 'toastIn 0.3s ease forwards',
            animationDelay: `${index * 0.05}s`,
            opacity: 0,
            minWidth: '200px',
            maxWidth: '400px'
          }}
          role="alert"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
};
