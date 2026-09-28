import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import MapView, { MapViewRef } from './components/MapView';
import Sidebar from './components/Sidebar';
import ModalForm from './components/ModalForm';
import {
  SurveyPoint,
  TagType,
  openDB,
  addPoint,
  getAllPoints,
  clearPoints,
  exportToGeoJSON,
  downloadFile
} from './utils';

interface SurveyContextType {
  points: SurveyPoint[];
  setPoints: React.Dispatch<React.SetStateAction<SurveyPoint[]>>;
  addNewPoint: (point: Omit<SurveyPoint, 'id' | 'createdAt'>) => Promise<void>;
  clearAllPoints: () => Promise<void>;
  exportPoints: () => void;
}

const SurveyContext = createContext<SurveyContextType | null>(null);

export const useSurvey = () => {
  const context = useContext(SurveyContext);
  if (!context) {
    throw new Error('useSurvey must be used within SurveyProvider');
  }
  return context;
};

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  warning?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  warning,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-container confirm-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <i
              className="fas fa-exclamation-triangle"
              style={{ marginRight: '8px', color: '#c0392b' }}
            ></i>
            {title}
          </h2>
          <button className="modal-close" onClick={onCancel}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
          {warning && (
            <div className="confirm-warning">
              <i className="fas fa-exclamation-circle" style={{ marginRight: '6px' }}></i>
              {warning}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            <i className="fas fa-trash"></i>
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);

  const mapRef = useRef<MapViewRef>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const initApp = async () => {
      try {
        await openDB();
        const savedPoints = await getAllPoints();
        setPoints(savedPoints);
      } catch (error) {
        console.error('初始化数据库失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initApp();

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = Number(position.coords.latitude.toFixed(6));
          const lng = Number(position.coords.longitude.toFixed(6));
          setCurrentPosition({ lat, lng });
          setLocationError(null);
        },
        (error) => {
          console.warn('定位失败:', error.message);
          setCurrentPosition({ lat: 39.9042, lng: 116.4074 });
          switch (error.code) {
            case error.PERMISSION_DENIED:
              setLocationError('定位权限被拒绝，将使用默认位置');
              break;
            case error.POSITION_UNAVAILABLE:
              setLocationError('无法获取位置信息，将使用默认位置');
              break;
            case error.TIMEOUT:
              setLocationError('定位超时，将使用默认位置');
              break;
            default:
              setLocationError('定位失败，将使用默认位置');
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000
        }
      );
    } else {
      setCurrentPosition({ lat: 39.9042, lng: 116.4074 });
      setLocationError('浏览器不支持地理定位');
    }
  }, []);

  const addNewPoint = useCallback(
    async (data: {
      name: string;
      description: string;
      tag: TagType;
      imageUrl?: string;
    }) => {
      if (!pendingCoords) return;

      try {
        const newPoint = await addPoint({
          name: data.name,
          description: data.description,
          tag: data.tag,
          imageUrl: data.imageUrl,
          lat: pendingCoords.lat,
          lng: pendingCoords.lng
        });

        setPoints((prev) => [newPoint, ...prev]);

        setTimeout(() => {
          const point = points.find((p) => p.id === newPoint.id) || newPoint;
          if (mapRef.current) {
            mapRef.current.focusOnPoint(point);
          }
          setSelectedPointId(newPoint.id);
        }, 100);
      } catch (error) {
        console.error('添加采样点失败:', error);
        alert('保存失败，请重试');
      } finally {
        setIsModalOpen(false);
        setPendingCoords(null);
      }
    },
    [pendingCoords, points]
  );

  const clearAllPoints = useCallback(async () => {
    try {
      await clearPoints();
      setPoints([]);
      setSelectedPointId(null);
    } catch (error) {
      console.error('清空数据失败:', error);
      alert('清空失败，请重试');
    } finally {
      setIsConfirmOpen(false);
    }
  }, []);

  const exportPoints = useCallback(() => {
    if (points.length === 0) {
      alert('没有可导出的数据');
      return;
    }

    try {
      const geoJSON = exportToGeoJSON(points);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadFile(geoJSON, `field-survey-${timestamp}.geojson`, 'application/geo+json');
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请重试');
    }
  }, [points]);

  const handleAddMarkerClick = useCallback((lat: number, lng: number) => {
    setPendingCoords({ lat, lng });
    setIsModalOpen(true);
  }, []);

  const handleSelectPoint = useCallback(
    (id: string) => {
      setSelectedPointId(id);
      const point = points.find((p) => p.id === id);
      if (point && mapRef.current) {
        mapRef.current.focusOnPoint(point);
      }
    },
    [points]
  );

  const contextValue: SurveyContextType = {
    points,
    setPoints,
    addNewPoint,
    clearAllPoints,
    exportPoints
  };

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          width: '100vw',
          background: '#F5F5DC'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <i
            className="fas fa-spinner fa-spin"
            style={{ fontSize: '48px', color: '#6B8E23', marginBottom: '16px' }}
          ></i>
          <p style={{ color: '#556B2F', fontSize: '16px' }}>正在加载...</p>
        </div>
      </div>
    );
  }

  return (
    <SurveyContext.Provider value={contextValue}>
      <div className="app-container">
        <div className="toolbar">
          <div className="toolbar-left">
            <i className="fas fa-map-marked-alt toolbar-logo"></i>
            <span className="toolbar-title">田野调查工具</span>
            {locationError && (
              <span
                style={{
                  fontSize: '12px',
                  background: 'rgba(255,255,255,0.15)',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  marginLeft: '8px'
                }}
                title={locationError}
              >
                <i className="fas fa-info-circle" style={{ marginRight: '4px' }}></i>
                {locationError.length > 20 ? locationError.slice(0, 20) + '...' : locationError}
              </span>
            )}
          </div>
          <div className="toolbar-right">
            <button
              className="btn btn-ghost"
              onClick={exportPoints}
              disabled={points.length === 0}
              title="导出为GeoJSON文件"
              style={{ opacity: points.length === 0 ? 0.5 : 1 }}
            >
              <i className="fas fa-file-export"></i>
              <span>导出</span>
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setIsConfirmOpen(true)}
              disabled={points.length === 0}
              title="清空所有采样点"
              style={{ opacity: points.length === 0 ? 0.5 : 1 }}
            >
              <i className="fas fa-trash-alt"></i>
              <span>清空</span>
            </button>
          </div>
        </div>

        <div className="main-content">
          <MapView
            ref={mapRef}
            points={points}
            currentPosition={currentPosition}
            onAddMarkerClick={handleAddMarkerClick}
            highlightPointId={selectedPointId}
          />
          <Sidebar
            points={points}
            selectedPointId={selectedPointId}
            onSelectPoint={handleSelectPoint}
          />
        </div>

        {pendingCoords && (
          <ModalForm
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setPendingCoords(null);
            }}
            onSubmit={addNewPoint}
            lat={pendingCoords.lat}
            lng={pendingCoords.lng}
          />
        )}

        <ConfirmModal
          isOpen={isConfirmOpen}
          title="确认清空数据"
          message={`您确定要删除所有 ${points.length} 个采样点吗？`}
          warning="此操作不可恢复，所有已保存的数据将被永久删除！"
          onConfirm={clearAllPoints}
          onCancel={() => setIsConfirmOpen(false)}
        />
      </div>
    </SurveyContext.Provider>
  );
};

export default App;
