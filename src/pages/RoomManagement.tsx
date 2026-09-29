import { useState, memo } from 'react';
import type { Room, RoomStatus } from '../types';

interface RoomManagementProps {
  rooms: Room[];
  onStatusChange: (roomId: string, status: RoomStatus) => void;
}

const statusOptions: RoomStatus[] = ['空闲', '已预订', '打扫中'];

const RoomCard = memo(function RoomCard({
  room,
  onStatusChange
}: {
  room: Room;
  onStatusChange: (status: RoomStatus) => void;
}) {
  const [showStatusSelector, setShowStatusSelector] = useState(false);

  const getTypeClass = (type: string) => {
    switch (type) {
      case '大床': return 'bed';
      case '双床': return 'twin';
      case '套房': return 'suite';
      default: return '';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case '空闲': return 'available';
      case '已预订': return 'booked';
      case '打扫中': return 'cleaning';
      default: return '';
    }
  };

  const handleCardClick = () => {
    setShowStatusSelector(!showStatusSelector);
  };

  const handleStatusClick = (e: React.MouseEvent, status: RoomStatus) => {
    e.stopPropagation();
    onStatusChange(status);
    setShowStatusSelector(false);
  };

  return (
    <div
      className={`room-card ${getTypeClass(room.type)}`}
      onClick={handleCardClick}
    >
      <span className={`room-status-tag ${getStatusClass(room.status)}`}>
        {room.status}
      </span>
      <h3 className="room-name">{room.name}</h3>
      <span className="room-type">{room.type}</span>
      <div className="room-price">
        ¥{room.basePrice}
        <span>/晚</span>
      </div>
      <div className="room-info">
        👥 最多入住 {room.maxGuests} 人
      </div>
      <p className="room-description">{room.description}</p>
      
      {showStatusSelector && (
        <div className="status-selector">
          {statusOptions.map(status => (
            <button
              key={status}
              className={`status-btn ${room.status === status ? 'active' : ''}`}
              onClick={(e) => handleStatusClick(e, status)}
            >
              {status}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function RoomManagement({ rooms, onStatusChange }: RoomManagementProps) {
  return (
    <div>
      <h1 className="page-title">房源管理</h1>
      <div className="room-grid">
        {rooms.map(room => (
          <RoomCard
            key={room.id}
            room={room}
            onStatusChange={(status) => onStatusChange(room.id, status)}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(RoomManagement);
