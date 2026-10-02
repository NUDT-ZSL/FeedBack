import { motion } from 'framer-motion';
import { useStore, useSelectedColor } from '@/store/useStore';
import { COLORS } from '@/types';

const COLORS_LIST = [
  { name: '石青', value: COLORS.STONE_BLUE },
  { name: '石绿', value: COLORS.STONE_GREEN },
  { name: '朱砂', value: COLORS.CINNABAR },
  { name: '藤黄', value: COLORS.GAMBOGE },
] as const;

export function ColorPalette() {
  const selectedColor = useSelectedColor();
  const setSelectedColor = useStore((state) => state.setSelectedColor);

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-3 md:gap-2.5 z-10">
      {COLORS_LIST.map((color) => (
        <motion.button
          key={color.value}
          className="relative rounded-full transition-all duration-200 ease-out"
          style={{
            width: '30px',
            height: '30px',
            backgroundColor: color.value,
            boxShadow: selectedColor === color.value 
              ? `0 0 20px ${color.value}, 0 0 40px ${color.value}40`
              : '0 2px 8px rgba(0,0,0,0.3)',
            border: selectedColor === color.value ? '2px solid white' : '2px solid transparent',
          }}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setSelectedColor(color.value)}
          title={color.name}
        >
          {selectedColor === color.value && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow: `0 0 30px ${color.value}`,
              }}
              animate={{
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          )}
        </motion.button>
      ))}
    </div>
  );
}
