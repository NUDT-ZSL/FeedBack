export const THEME_ORDER = ['恐怖', '悬疑', '科幻', '古风', '搞笑'];

export function matchesFilter(record, filter) {
  if (filter.themes.length > 0 && !filter.themes.includes(record.theme)) {
    return false;
  }

  if (filter.escapeStatus === 'success' && !record.escaped) {
    return false;
  }

  if (filter.escapeStatus === 'failed' && record.escaped) {
    return false;
  }

  if (filter.searchText) {
    const keyword = filter.searchText.toLowerCase();
    return (
      record.name.toLowerCase().includes(keyword) ||
      record.storeName.toLowerCase().includes(keyword)
    );
  }

  return true;
}

export function getFilteredRecords(records, filter) {
  return records.filter((record) => matchesFilter(record, filter));
}

export function getStats(records) {
  const totalRecords = records.length;
  const escapedRecords = records.filter((record) => record.escaped);
  const successRate = totalRecords > 0
    ? (escapedRecords.length / totalRecords) * 100
    : 0;

  const totalTime = escapedRecords.reduce(
    (sum, record) => sum + (record.actualTime ?? 0),
    0,
  );
  const averageEscapeTime = escapedRecords.length > 0
    ? totalTime / escapedRecords.length
    : 0;

  const themeCounts = {};
  THEME_ORDER.forEach((theme) => {
    themeCounts[theme] = 0;
  });

  records.forEach((record) => {
    themeCounts[record.theme] += 1;
  });

  let mostPlayedTheme = null;
  let maxThemeCount = 0;
  THEME_ORDER.forEach((theme) => {
    if (themeCounts[theme] > maxThemeCount) {
      maxThemeCount = themeCounts[theme];
      mostPlayedTheme = theme;
    }
  });

  return {
    totalRecords,
    averageEscapeTime,
    successRate,
    mostPlayedTheme,
    themeCounts,
    maxThemeCount,
  };
}

export function getRecordGroups(records) {
  const groupsByTheme = new Map();

  records.forEach((record) => {
    const group = groupsByTheme.get(record.theme);
    if (group) {
      group.records.push(record);
    } else {
      groupsByTheme.set(record.theme, {
        theme: record.theme,
        records: [record],
      });
    }
  });

  return THEME_ORDER
    .map((theme) => groupsByTheme.get(theme))
    .filter(Boolean)
    .map((group) => ({
      ...group,
      records: group.records
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    }));
}

export function getRecordView(records, filter) {
  const filteredRecords = getFilteredRecords(records, filter);

  return {
    records: filteredRecords,
    stats: getStats(filteredRecords),
    groups: getRecordGroups(filteredRecords),
  };
}
