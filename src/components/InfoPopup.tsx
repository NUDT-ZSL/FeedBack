import React, { useEffect, useState } from 'react';

interface InfoPopupProps {
  visible: boolean;
  x: number;
  y: number;
  data: {
    lat: number;
    lon: number;
    temperature: number;
    pressure: number;
    humidity: number;
  } | null;
}

export const InfoPopup: React.FC<InfoPopupProps> = ({ visible, x, y, data }) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const offsetX = 15;
    const offsetY = -10;
    const popupWidth = 200;
    const popupHeight = 120;

    let newX = x + offsetX;
    let newY = y + offsetY;

    if (newX + popupWidth > window.innerWidth) {
      newX = x - popupWidth - offsetX;
    }
    if (newY + popupHeight > window.innerHeight) {
      newY = y - popupHeight - offsetY;
    }
    if (newY < 0) {
      newY = 10;
    }

    setPosition({ x: newX, y: newY });
  }, [x, y]);

  if (!data) return null;

  return (
    <div
      className={`info-popup ${visible ? 'visible' : ''}`}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="popup-title">气象数据</div>
      <div className="popup-row">
        <span className="popup-label">纬度</span>
        <span className="popup-value">{data.lat.toFixed(2)}°</span>
      </div>
      <div className="popup-row">
        <span className="popup-label">经度</span>
        <span className="popup-value">{data.lon.toFixed(2)}°</span>
      </div>
      <div className="popup-row">
        <span className="popup-label">温度</span>
        <span className="popup-value">{data.temperature.toFixed(1)}°C</span>
      </div>
      <div className="popup-row">
        <span className="popup-label">气压</span>
        <span className="popup-value">{data.pressure.toFixed(1)} hPa</span>
      </div>
      <div className="popup-row">
        <span className="popup-label">湿度</span>
        <span className="popup-value">{data.humidity.toFixed(1)}%</span>
      </div>
    </div>
  );
};
