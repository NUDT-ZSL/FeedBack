import React, { useMemo, useCallback } from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { FlavorProfile, FLAVOR_DIMENSIONS } from '../types';

interface FlavorRadarProps {
  data: FlavorProfile;
  onDimensionClick: (dimension: keyof FlavorProfile) => void;
}

const FlavorRadar: React.FC<FlavorRadarProps> = React.memo(({ data, onDimensionClick }) => {
  const chartData = useMemo(() => {
    return FLAVOR_DIMENSIONS.map((dim) => ({
      dimension: dim.label,
      key: dim.key,
      value: data[dim.key],
      fullMark: 10,
    }));
  }, [data]);

  const handleClick = useCallback((data: { payload?: { key: keyof FlavorProfile } }) => {
    if (data?.payload?.key) {
      onDimensionClick(data.payload.key);
    }
  }, [onDimensionClick]);

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
          <PolarGrid stroke="#D2B48C" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: '#6F4E37', fontSize: '14px', fontWeight: 500 }}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 10]}
            tick={{ fill: '#8D6E63', fontSize: '12px' }}
            axisLine={{ stroke: '#D2B48C' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#FFF8F0',
              border: '1px solid #D2B48C',
              borderRadius: '8px',
              color: '#6F4E37',
            }}
            formatter={(value: number) => [`${value}/10`, '评分']}
          />
          {FLAVOR_DIMENSIONS.map((dim) => (
            <Radar
              key={dim.key}
              name={dim.label}
              dataKey="value"
              stroke={dim.color}
              fill={dim.color}
              fillOpacity={0.25}
              strokeWidth={2}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
});

FlavorRadar.displayName = 'FlavorRadar';

export default FlavorRadar;
