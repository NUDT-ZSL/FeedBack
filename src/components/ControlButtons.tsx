import React, { useState } from 'react';
import { useStar } from '../context/StarContext';
import { formatDate } from '../utils';
import { saveAs } from 'file-saver';

const ControlButtons: React.FC = () => {
  const { selectedStar, currentHour, ra, dec, addRecord, setShowToast } = useStar();
  const [recordAnimating, setRecordAnimating] = useState(false);

  const handleRecord = () => {
    if (!selectedStar) {
      setShowToast('请先选择一颗星体');
      setTimeout(() => setShowToast(null), 3000);
      return;
    }
    setRecordAnimating(true);
    addRecord(selectedStar, currentHour, ra, dec);
    setTimeout(() => setRecordAnimating(false), 100);
  };

  const handlePaint = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      setShowToast('无法获取画布');
      setTimeout(() => setShowToast(null), 3000);
      return;
    }

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(canvas, 0, 0);

    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 1;

    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let i = 0; i < 8; i++) {
      const y = (i / 8) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'white';
    ctx.font = '14px "Noto Serif SC", serif';
    ctx.textBaseline = 'top';

    const shichen = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * canvas.width + 10;
      ctx.fillText(shichen[i] + '时', x, 10);
    }

    const decLabels = ['+90°', '+60°', '+30°', '0°', '-30°', '-60°', '-90°'];
    for (let i = 0; i < 7; i++) {
      const y = (i / 6) * canvas.height + 10;
      ctx.fillText(decLabels[i], 10, y);
    }

    const now = new Date();
    ctx.font = '12px "Noto Serif SC", serif';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(
      `观测时间: ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${currentHour.toFixed(0)}时`,
      canvas.width - 20,
      canvas.height - 30
    );
    ctx.fillText(
      `赤经: ${ra.toFixed(1)}° 赤纬: ${dec.toFixed(1)}°`,
      canvas.width - 20,
      canvas.height - 15
    );

    overlayCanvas.toBlob((blob) => {
      if (blob) {
        const filename = `星象图_${formatDate(now)}.png`;
        saveAs(blob, filename);
      }
    }, 'image/png');
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: '40px',
        bottom: '40px',
        display: 'flex',
        gap: '16px',
        zIndex: 50,
      }}
    >
      <button
        onClick={handleRecord}
        style={{
          position: 'relative',
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          border: 'none',
          background: '#2d4a3e',
          color: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          fontFamily: "'Noto Serif SC', serif",
          transition: 'all 0.3s ease',
          boxShadow: '0 4px 15px rgba(45, 74, 62, 0.4)',
          overflow: 'hidden',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(58, 92, 76, 0.6)';
          e.currentTarget.style.background = '#3a5c4c';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 15px rgba(45, 74, 62, 0.4)';
          e.currentTarget.style.background = '#2d4a3e';
        }}
        title="记录当前星体"
      >
        记
        {recordAnimating && (
          <div
            className="ink-splash"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(255, 255, 255, 0.5)',
            }}
          />
        )}
      </button>

      <button
        onClick={handlePaint}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          border: 'none',
          background: '#8b0000',
          color: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          fontFamily: "'Noto Serif SC', serif",
          transition: 'all 0.3s ease',
          boxShadow: '0 4px 15px rgba(139, 0, 0, 0.4)',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(165, 42, 42, 0.6)';
          e.currentTarget.style.background = '#a52a2a';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 15px rgba(139, 0, 0, 0.4)';
          e.currentTarget.style.background = '#8b0000';
        }}
        title="生成星象图谱"
      >
        绘
      </button>
    </div>
  );
};

export default ControlButtons;
