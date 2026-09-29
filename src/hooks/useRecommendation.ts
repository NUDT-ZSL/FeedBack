import { useMemo } from 'react';
import { ClothingItem, OutfitRecord, OutfitRecommendation } from '../types';
import { generateId } from './useLocalStorage';
import { getItemsWornThisWeek } from '../utils/styleUtils';

export function useRecommendation(
  items: ClothingItem[],
  records: OutfitRecord[]
): OutfitRecommendation | null {
  return useMemo(() => {
    if (items.length === 0) return null;

    const tops = items.filter(item => item.category === 'top');
    const bottoms = items.filter(item => item.category === 'bottom');
    const outerwears = items.filter(item => item.category === 'outerwear');
    const shoes = items.filter(item => item.category === 'shoes');

    if (tops.length === 0 || bottoms.length === 0) return null;

    const wornThisWeek = getItemsWornThisWeek(records);

    const unwornTops = tops.filter(t => !wornThisWeek.has(t.id));
    const unwornBottoms = bottoms.filter(b => !wornThisWeek.has(b.id));
    const unwornOuterwears = outerwears.filter(o => !wornThisWeek.has(o.id));
    const unwornShoes = shoes.filter(s => !wornThisWeek.has(s.id));

    const hasUnwornCombination =
      (unwornTops.length > 0 || unwornBottoms.length > 0) ||
      unwornOuterwears.length > 0 ||
      unwornShoes.length > 0;

    let selectedTop: ClothingItem;
    let selectedBottom: ClothingItem;
    let selectedOuterwear: ClothingItem | undefined;
    let selectedShoes: ClothingItem | undefined;
    let reason: string;

    if (hasUnwornCombination) {
      selectedTop = unwornTops.length > 0 ? unwornTops[0] : tops[0];
      selectedBottom = unwornBottoms.length > 0 ? unwornBottoms[0] : bottoms[0];
      selectedOuterwear = unwornOuterwears.length > 0 ? unwornOuterwears[0] : undefined;
      selectedShoes = unwornShoes.length > 0 ? unwornShoes[0] : undefined;
      reason = '本周还没穿过的搭配，给衣柜来点新鲜感';
    } else {
      const ratedRecords = records.filter(r => r.rating > 0);
      if (ratedRecords.length > 0) {
        const avgRatings = new Map<string, number>();
        const ratingCounts = new Map<string, number>();

        ratedRecords.forEach(record => {
          const itemIds = [record.topId, record.bottomId, record.outerwearId, record.shoesId]
            .filter(Boolean) as string[];
          itemIds.forEach(id => {
            avgRatings.set(id, (avgRatings.get(id) || 0) + record.rating);
            ratingCounts.set(id, (ratingCounts.get(id) || 0) + 1);
          });
        });

        const getAvgRating = (id: string) => {
          const total = avgRatings.get(id) || 0;
          const count = ratingCounts.get(id) || 1;
          return total / count;
        };

        const sortedTops = [...tops].sort((a, b) => getAvgRating(b.id) - getAvgRating(a.id));
        const sortedBottoms = [...bottoms].sort((a, b) => getAvgRating(b.id) - getAvgRating(a.id));
        const sortedShoes = shoes.length > 0
          ? [...shoes].sort((a, b) => getAvgRating(b.id) - getAvgRating(a.id))
          : [];

        selectedTop = sortedTops[0];
        selectedBottom = sortedBottoms[0];
        selectedShoes = sortedShoes[0];
        reason = '历史评分最高的经典组合，不会出错的选择';
      } else {
        selectedTop = tops[0];
        selectedBottom = bottoms[0];
        selectedShoes = shoes[0];
        reason = '为你挑选的基础搭配，开始记录你的穿搭吧';
      }
    }

    const recommendationItems: ClothingItem[] = [selectedTop, selectedBottom];
    if (selectedOuterwear) recommendationItems.push(selectedOuterwear);
    if (selectedShoes) recommendationItems.push(selectedShoes);

    return {
      id: generateId(),
      items: recommendationItems,
      reason,
      score: 0,
    };
  }, [items, records]);
}
