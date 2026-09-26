interface ZoomSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export default function ZoomSlider({ value, onChange }: ZoomSliderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        backgroundColor: '#161B22',
        borderTop: '1px solid #30363D',
      }}
    >
      <span
        style={{
          color: '#8B949E',
          fontSize: '12px',
          width: '40px',
        }}
      >
        0.5x
      </span>
      <input
        type="range"
        min="0.5"
        max="2"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          flex: 1,
          height: '4px',
          WebkitAppearance: 'none',
          appearance: 'none',
          backgroundColor: '#30363D',
          borderRadius: '2px',
          outline: 'none',
          cursor: 'pointer',
        }}
      />
      <span
        style={{
          color: '#8B949E',
          fontSize: '12px',
          width: '40px',
          textAlign: 'right',
        }}
      >
        2x
      </span>
      <span
        style={{
          color: '#FFFFFF',
          fontSize: '13px',
          fontWeight: 500,
          minWidth: '42px',
          textAlign: 'center',
          backgroundColor: '#30363D',
          padding: '4px 8px',
          borderRadius: '4px',
        }}
      >
        {value.toFixed(1)}x
      </span>
    </div>
  );
}
