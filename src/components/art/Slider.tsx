interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export default function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-mono text-gray-500 dark:text-gray-400">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-indigo-500"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
