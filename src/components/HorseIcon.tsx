import { motion } from 'framer-motion';

interface HorseIconProps {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const HorseIcon = ({ selected, onClick, disabled }: HorseIconProps) => {
  return (
    <motion.button
      className={`horse-icon ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled ? { y: -4 } : {}}
      animate={!disabled ? { y: [0, -4, 0] } : {}}
      transition={{
        duration: 0.5,
        repeat: !disabled ? Infinity : 0,
        repeatType: 'reverse',
        ease: 'easeInOut',
      }}
      whileTap={{ scale: 0.95 }}
    >
      <span className="horse-emoji">🐎</span>
    </motion.button>
  );
};

export default HorseIcon;
