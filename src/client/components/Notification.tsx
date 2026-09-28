import { useEffect, useState, useCallback } from 'react';
import { X, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import './Notification.css';

const iconMap = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle
};

const AUTO_DISMISS_MS = 5000;
const FADE_OUT_MS = 400;

interface NotificationItemProps {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  onDismiss: (id: string) => void;
}

function NotificationItem({ id, type, message, onDismiss }: NotificationItemProps) {
  const [fading, setFading] = useState(false);

  const dismiss = useCallback(() => {
    setFading(true);
    setTimeout(() => onDismiss(id), FADE_OUT_MS);
  }, [id, onDismiss]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dismiss]);

  const Icon = iconMap[type];

  return (
    <div className={`notification-item ${type} ${fading ? 'fade-out' : 'slide-in-right'}`}>
      <Icon className="notification-icon" size={20} />
      <span className="notification-message">{message}</span>
      <button className="notification-close" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}

export default function Notification() {
  const { notifications, removeNotification } = useStore();

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          id={notification.id}
          type={notification.type}
          message={notification.message}
          onDismiss={removeNotification}
        />
      ))}
    </div>
  );
}
