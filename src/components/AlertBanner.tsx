import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useStore from '../store';

const AlertBanner = () => {
  const { alertMessage, dismissAlert } = useStore();

  useEffect(() => {
    if (alertMessage) {
      const timer = setTimeout(() => {
        dismissAlert();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [alertMessage, dismissAlert]);

  return (
    <AnimatePresence>
      {alertMessage && (
        <motion.div
          className="alert-banner"
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div className="alert-content">
            <span className="alert-icon">🚨</span>
            <span className="alert-text">{alertMessage}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AlertBanner;
