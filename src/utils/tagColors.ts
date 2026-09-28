const tagColorMap: Record<string, string> = {
  '风光': 'var(--tag-color-1)',
  '城市': 'var(--tag-color-2)',
  '夜景': 'var(--tag-color-3)',
  '人像': 'var(--tag-color-4)',
  '光影': 'var(--tag-color-5)',
  '自然': 'var(--tag-color-6)',
  '街拍': 'var(--tag-color-7)',
  '人文': 'var(--tag-color-8)',
  '建筑': 'var(--tag-color-1)',
  '微距': 'var(--tag-color-2)',
  '海景': 'var(--tag-color-3)',
  '儿童': 'var(--tag-color-4)',
  '时尚': 'var(--tag-color-5)',
  '美食': 'var(--tag-color-6)',
  '情侣': 'var(--tag-color-7)',
  '艺术': 'var(--tag-color-8)',
};

export const getTagColor = (tag: string): string => {
  return tagColorMap[tag] || 'var(--tag-color-1)';
};
