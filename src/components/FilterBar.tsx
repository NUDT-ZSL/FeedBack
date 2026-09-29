import { ThemeType, EscapeStatus, FilterState } from '../types';

interface FilterBarProps {
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
}

const themeList: ThemeType[] = ['恐怖', '悬疑', '科幻', '古风', '搞笑'];

const themeColors: Record<ThemeType, string> = {
  恐怖: '#DC143C',
  悬疑: '#8A2BE2',
  科幻: '#4169E1',
  古风: '#556B2F',
  搞笑: '#FFD700',
};

export default function FilterBar({ filter, onFilterChange }: FilterBarProps) {
  const toggleTheme = (theme: ThemeType) => {
    const newThemes = filter.themes.includes(theme)
      ? filter.themes.filter((t) => t !== theme)
      : [...filter.themes, theme];
    onFilterChange({ ...filter, themes: newThemes });
  };

  const setEscapeStatus = (status: EscapeStatus) => {
    onFilterChange({ ...filter, escapeStatus: status });
  };

  const setSearchText = (text: string) => {
    onFilterChange({ ...filter, searchText: text });
  };

  return (
    <div
      style={{
        backgroundColor: '#16213E',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        boxShadow: '0 4px 15px rgba(233,69,96,0.15)',
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <label
          style={{
            display: 'block',
            color: 'rgba(224,224,224,0.7)',
            fontSize: '13px',
            marginBottom: '10px',
            fontWeight: 500,
          }}
        >
          主题类型
        </label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {themeList.map((theme) => {
            const isSelected = filter.themes.includes(theme);
            return (
              <button
                key={theme}
                onClick={() => toggleTheme(theme)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                  backgroundColor: isSelected ? themeColors[theme] : 'rgba(255,255,255,0.1)',
                  color: isSelected ? '#fff' : '#E0E0E0',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }
                }}
              >
                {theme}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              color: 'rgba(224,224,224,0.7)',
              fontSize: '13px',
              marginBottom: '10px',
              fontWeight: 500,
            }}
          >
            逃脱状态
          </label>
          <select
            value={filter.escapeStatus}
            onChange={(e) => setEscapeStatus(e.target.value as EscapeStatus)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.05)',
              color: '#E0E0E0',
              fontSize: '14px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="all">全部</option>
            <option value="success">成功逃脱</option>
            <option value="failed">未逃脱</option>
          </select>
        </div>

        <div style={{ flex: 2 }}>
          <label
            style={{
              display: 'block',
              color: 'rgba(224,224,224,0.7)',
              fontSize: '13px',
              marginBottom: '10px',
              fontWeight: 500,
            }}
          >
            搜索
          </label>
          <input
            type="text"
            value={filter.searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索密室名称或门店..."
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.05)',
              color: '#E0E0E0',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
    </div>
  );
}
