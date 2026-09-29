import React, { useState, useCallback } from 'react';
import { BrewRecord, FlavorProfile, PourMethod, FLAVOR_DIMENSIONS } from '../types';

interface BrewFormProps {
  beanId: string;
  onSubmit: (record: BrewRecord) => void;
  onCancel: () => void;
}

const BrewForm: React.FC<BrewFormProps> = ({ beanId, onSubmit, onCancel }) => {
  const [coffeeAmount, setCoffeeAmount] = useState(20);
  const [waterTemp, setWaterTemp] = useState(92);
  const [grindSize, setGrindSize] = useState(5);
  const [pourMethod, setPourMethod] = useState<PourMethod>('三段式');
  const [totalTime, setTotalTime] = useState(150);
  const [flavor, setFlavor] = useState<FlavorProfile>({
    acidity: 6,
    sweetness: 6,
    bitterness: 5,
    body: 6,
    aftertaste: 6,
    cleanliness: 6,
  });

  const handleFlavorChange = useCallback((key: keyof FlavorProfile, value: number) => {
    setFlavor((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const record: BrewRecord = {
      id: Math.random().toString(36).substring(2, 11),
      beanId,
      coffeeAmount,
      waterTemp,
      grindSize,
      pourMethod,
      totalTime,
      flavor: { ...flavor },
      createdAt: Date.now(),
    };
    onSubmit(record);
  };

  const sliderTrackStyle = (value: number, min: number, max: number): React.CSSProperties => {
    const percentage = ((value - min) / (max - min)) * 100;
    return {
      background: `linear-gradient(to right, #FF5252 0%, #FFEB3B 50%, #4CAF50 100%)`,
      WebkitAppearance: 'none',
      appearance: 'none',
      height: '8px',
      borderRadius: '4px',
      outline: 'none',
      position: 'relative',
    };
  };

  const SliderInput: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    unit: string;
    onChange: (value: number) => void;
  }> = ({ label, value, min, max, unit, onChange }) => (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <label style={{ fontSize: '14px', color: '#6F4E37', fontWeight: 500 }}>{label}</label>
        <span style={{ fontSize: '14px', color: '#6F4E37', fontWeight: 600 }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          ...sliderTrackStyle(value, min, max),
          width: '100%',
          margin: 0,
        }}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{
      backgroundColor: '#FFF8F0',
      padding: '24px',
      borderRadius: '12px',
      border: '1px solid #D2B48C',
      maxWidth: '600px',
      margin: '0 auto',
    }}>
      <h2 style={{ marginTop: 0, color: '#6F4E37', fontSize: '20px' }}>添加冲煮记录</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <SliderInput
          label="粉量"
          value={coffeeAmount}
          min={15}
          max={30}
          unit="g"
          onChange={setCoffeeAmount}
        />
        <SliderInput
          label="水温"
          value={waterTemp}
          min={85}
          max={96}
          unit="℃"
          onChange={setWaterTemp}
        />
        <SliderInput
          label="研磨度"
          value={grindSize}
          min={1}
          max={10}
          unit="刻度"
          onChange={setGrindSize}
        />
        <SliderInput
          label="总时长"
          value={totalTime}
          min={60}
          max={300}
          unit="秒"
          onChange={setTotalTime}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '14px', color: '#6F4E37', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
          注水方式
        </label>
        <select
          value={pourMethod}
          onChange={(e) => setPourMethod(e.target.value as PourMethod)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #D2B48C',
            backgroundColor: 'white',
            fontSize: '14px',
            color: '#6F4E37',
            cursor: 'pointer',
          }}
        >
          <option value="一刀流">一刀流</option>
          <option value="三段式">三段式</option>
          <option value="搅拌法">搅拌法</option>
          <option value="冰冲">冰冲</option>
        </select>
      </div>

      <h3 style={{ color: '#6F4E37', fontSize: '16px', marginTop: '24px', marginBottom: '16px' }}>
        风味评分
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {FLAVOR_DIMENSIONS.map((dim) => (
          <div key={dim.key} style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '13px', color: dim.color, fontWeight: 500 }}>
                {dim.label}
              </label>
              <span style={{ fontSize: '13px', color: dim.color, fontWeight: 600 }}>
                {flavor[dim.key]}/10
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={flavor[dim.key]}
              onChange={(e) => handleFlavorChange(dim.key, Number(e.target.value))}
              style={{
                ...sliderTrackStyle(flavor[dim.key], 1, 10),
                width: '100%',
                margin: 0,
                accentColor: dim.color,
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
        <button
          type="submit"
          style={{
            flex: 1,
            padding: '12px 24px',
            backgroundColor: '#6F4E37',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          保存记录
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '12px 24px',
            backgroundColor: 'transparent',
            color: '#6F4E37',
            border: '1px solid #D2B48C',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          取消
        </button>
      </div>
    </form>
  );
};

export default BrewForm;
