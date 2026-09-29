import { ClothingItem, OutfitRecord, StyleTag, ClothingCategory } from '../types';

export function getStartOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isDateInThisWeek(dateStr: string): boolean {
  const date = new Date(dateStr);
  const startOfWeek = getStartOfWeek();
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return date >= startOfWeek && date <= endOfWeek;
}

export function isDateInLast30Days(dateStr: string): boolean {
  const date = new Date(dateStr);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return date >= thirtyDaysAgo;
}

export function getItemsWornThisWeek(records: OutfitRecord[]): Set<string> {
  const wornItems = new Set<string>();
  records
    .filter(r => isDateInThisWeek(r.date))
    .forEach(record => {
      if (record.topId) wornItems.add(record.topId);
      if (record.bottomId) wornItems.add(record.bottomId);
      if (record.outerwearId) wornItems.add(record.outerwearId);
      if (record.shoesId) wornItems.add(record.shoesId);
      record.accessoryIds.forEach(id => wornItems.add(id));
    });
  return wornItems;
}

export function getStyleFrequency(
  records: OutfitRecord[],
  items: ClothingItem[]
): { tag: StyleTag; count: number }[] {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const tagCount = new Map<StyleTag, number>();

  records
    .filter(r => isDateInLast30Days(r.date))
    .forEach(record => {
      const recordItemIds = [
        record.topId,
        record.bottomId,
        record.outerwearId,
        record.shoesId,
        ...record.accessoryIds,
      ].filter(Boolean) as string[];

      recordItemIds.forEach(itemId => {
        const item = itemMap.get(itemId);
        if (item) {
          item.styleTags.forEach(tag => {
            tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
          });
        }
      });
    });

  return Array.from(tagCount.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function getCategoryUsage(
  records: OutfitRecord[],
  items: ClothingItem[]
): { category: ClothingCategory; count: number }[] {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const categoryCount = new Map<ClothingCategory, number>();

  records
    .filter(r => isDateInLast30Days(r.date))
    .forEach(record => {
      const recordItemIds = [
        record.topId,
        record.bottomId,
        record.outerwearId,
        record.shoesId,
        ...record.accessoryIds,
      ].filter(Boolean) as string[];

      recordItemIds.forEach(itemId => {
        const item = itemMap.get(itemId);
        if (item) {
          categoryCount.set(item.category, (categoryCount.get(item.category) || 0) + 1);
        }
      });
    });

  return Array.from(categoryCount.entries()).map(([category, count]) => ({
    category,
    count,
  }));
}

export function getTopOutfitCombinations(
  records: OutfitRecord[],
  items: ClothingItem[],
  topN: number = 3
): { items: ClothingItem[]; count: number }[] {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const combinationCount = new Map<string, number>();
  const combinationItems = new Map<string, ClothingItem[]>();

  records.forEach(record => {
    const itemIds = [
      record.topId,
      record.bottomId,
      record.outerwearId,
      record.shoesId,
    ].filter(Boolean).sort() as string[];
    
    if (itemIds.length >= 2) {
      const key = itemIds.join('|');
      combinationCount.set(key, (combinationCount.get(key) || 0) + 1);
      
      if (!combinationItems.has(key)) {
        const comboItems = itemIds
          .map(id => itemMap.get(id))
          .filter((item): item is ClothingItem => item !== undefined);
        combinationItems.set(key, comboItems);
      }
    }
  });

  return Array.from(combinationCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => ({
      items: combinationItems.get(key) || [],
      count,
    }));
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return '今天';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  } else {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
}
