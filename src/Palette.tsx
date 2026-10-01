import React from 'react'

interface PaletteProps {
  color: string
  onColorChange: (color: string) => void
  opacity: number
  onOpacityChange: (opacity: number) => void
  brushSize: number
  onBrushSizeChange: (size: number) => void
}

const PRESET_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc',
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db',
  '#9b59b6', '#e91e63', '#795548', '#607d8b', '#ff9800', '#ffc107',
  '#8bc34a', '#00bcd4', '#673ab7', '#f44336', '#009688', '#2196f3',
]

const Palette: React.FC<PaletteProps> = ({
  color,
  onColorChange,
  opacity,
  onOpacityChange,
  brushSize,
  onBrushSizeChange,
}) => {
  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <h3 style={styles.title}>调色板</h3>
        <div style={styles.colorGrid}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              style={{
                ...styles.colorBtn,
                backgroundColor: c,
                ...(color === c ? styles.colorBtnActive : {}),
              }}
              title={c}
            />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <span style={styles.label}>当前颜色</span>
          <div
            style={{
              ...styles.currentColor,
              backgroundColor: color,
              opacity: opacity,
            }}
          />
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <span style={styles.label}>透明度</span>
          <span style={styles.value}>{Math.round(opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={opacity * 100}
          onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          style={styles.slider}
        />
        <div style={styles.sliderTicks}>
          {Array.from({ length: 17 }, (_, i) => (
            <span key={i} style={styles.tick} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.title}>画笔大小</h3>
        <div style={styles.brushGrid}>
          {[1, 2, 3, 4, 5].map((size) => (
            <button
              key={size}
              onClick={() => onBrushSizeChange(size)}
              style={{
                ...styles.brushBtn,
                ...(brushSize === size ? styles.brushBtnActive : {}),
              }}
              title={`${size}x${size}`}
            >
              <div
                style={{
                  width: 6 + size * 3,
                  height: 6 + size * 3,
                  borderRadius: 2,
                  backgroundColor: brushSize === size ? '#fff' : color,
                }}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 240,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#5a4a3a',
    margin: 0,
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 6,
  },
  colorBtn: {
    width: 30,
    height: 30,
    border: '0.5px solid rgba(0,0,0,0.1)',
    borderRadius: 4,
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.15s ease',
  },
  colorBtnActive: {
    border: '2px solid #5a4a3a',
    boxShadow: '0 0 8px #ffffff88, 0 0 0 1px rgba(0,0,0,0.1)',
    transform: 'scale(1.1)',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    color: '#5a4a3a',
    fontWeight: 500,
  },
  value: {
    fontSize: 13,
    color: '#5a4a3a',
    fontWeight: 600,
  },
  currentColor: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '2px solid #d4c9b0',
  },
  slider: {
    width: '100%',
    height: 4,
    appearance: 'none',
    background: 'linear-gradient(to right, #d4c9b0, #5a4a3a)',
    borderRadius: 2,
    outline: 'none',
    cursor: 'pointer',
  },
  sliderTicks: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  tick: {
    width: 1,
    height: 6,
    backgroundColor: '#d4c9b0',
  },
  brushGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 8,
  },
  brushBtn: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #d4c9b0',
    borderRadius: 8,
    backgroundColor: '#faf7f2',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  brushBtnActive: {
    backgroundColor: '#5a4a3a',
    borderColor: '#5a4a3a',
    transform: 'scale(0.95)',
  },
}

export default Palette
