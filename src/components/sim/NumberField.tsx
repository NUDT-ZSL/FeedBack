interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function NumberField({ label, value, min, max, step = 1, onChange }: NumberFieldProps) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-stone-700">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="number"
        className="w-20 rounded border border-stone-300 bg-white/80 px-1.5 py-0.5 text-right text-xs focus:border-emerald-600 focus:outline-none"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}
