import { Work, Comment, Category } from '../types';

const generateId = () => Math.random().toString(36).substring(2, 9);

const generateAvatarColor = () => {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 60%)`;
};

const placeholderImages = {
  ceramic: [
    'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1610701596037-354999918420?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400&h=300&fit=crop',
  ],
  woodwork: [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1611145434336-2324aa4077cd?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop',
  ],
  weaving: [
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1606722590583-6951b5ea92ad?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=300&fit=crop',
  ],
  leather: [
    'https://images.unsplash.com/photo-1627123424574-724758594e93?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1544441893-675973e31985?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1627123424574-724758594e93?w=400&h=300&fit=crop',
  ],
  paper: [
    'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1519791883288-dc8bd696e667?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=400&h=300&fit=crop',
    'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
  ],
};

const workNames: Record<Category, string[]> = {
  ceramic: ['手工青瓷茶杯', '粗陶花瓶', '紫砂茶壶', '陶瓷餐盘套装'],
  woodwork: ['黑胡桃木茶盘', '原木书架', '木质首饰盒', '实木餐桌'],
  weaving: ['手工编织挂毯', '棉麻围巾', '竹编收纳篮', '毛线抱枕'],
  leather: ['复古皮革钱包', '手工皮带', '皮革笔记本封面', '牛皮手提包'],
  paper: ['纸雕灯笼', '手工贺卡套装', '纸艺花卉', '折纸装饰'],
};

const stepDescriptions = [
  '准备好所需的原材料和工具，确保工作区域干净整洁。',
  '对原材料进行初步加工处理，去除多余部分，整理成需要的形状。',
  '精细打磨和修整，确保表面光滑，边缘处理圆润。',
  '进行主体制作，按照设计图纸逐步完成核心结构。',
  '添加装饰细节，雕刻或绘制图案花纹，增加作品艺术性。',
  '进行干燥或固化处理，等待材料完全稳定。',
  '表面处理，上釉、打蜡或涂漆，保护作品并提升质感。',
  '最终检查和调整，确保每个细节都达到预期效果。',
];

const categories: Category[] = ['ceramic', 'woodwork', 'weaving', 'leather', 'paper'];

const generateSteps = (category: Category, count: number) => {
  const images = placeholderImages[category];
  return Array.from({ length: count }, (_, i) => ({
    id: generateId(),
    order: i + 1,
    image: images[i % images.length],
    description: stepDescriptions[i % stepDescriptions.length],
    duration: Math.floor(Math.random() * 60) + 15,
  }));
};

const commentAuthors = ['小明', '手作爱好者', '匠人小王', '陶艺迷', '木木', '编织达人', '皮客', '纸韵', '青青', '老匠'];

const commentContents = [
  '太厉害了，每一步都很用心！',
  '原来这个作品需要这么多步骤，涨知识了',
  '手艺人真的不容易，为你点赞',
  '细节处理得太棒了，很有质感',
  '想学习这个，请问有教程吗？',
  '颜色搭配很漂亮，很有艺术感',
  '这个工艺很复杂吧？成品太美了',
  '已收藏，慢慢学习',
  '从原料到成品，每一步都是艺术',
  '期待更多作品分享！',
];

const generateComments = (workId: string, count: number): Comment[] => {
  return Array.from({ length: count }, () => ({
    id: generateId(),
    workId,
    author: commentAuthors[Math.floor(Math.random() * commentAuthors.length)],
    avatarColor: generateAvatarColor(),
    rating: Math.floor(Math.random() * 3) + 3,
    content: commentContents[Math.floor(Math.random() * commentContents.length)],
    createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
  }));
};

const generateWorks = (): Work[] => {
  const works: Work[] = [];

  for (let i = 0; i < 10; i++) {
    const category = categories[i % categories.length];
    const nameList = workNames[category];
    const name = nameList[i % nameList.length] + (i >= nameList.length ? ` ${Math.floor(i / nameList.length) + 1}` : '');
    const stepCount = Math.floor(Math.random() * 3) + 4;
    const commentCount = Math.floor(Math.random() * 4) + 1;
    const coverImages = placeholderImages[category];

    works.push({
      id: `work-${i + 1}`,
      name,
      category,
      coverImage: coverImages[i % coverImages.length],
      steps: generateSteps(category, stepCount),
      createdAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
      favorites: Math.floor(Math.random() * 200) + 10,
      comments: generateComments(`work-${i + 1}`, commentCount),
    });
  }

  return works;
};

export const mockWorks = generateWorks();
export const mockComments = mockWorks.flatMap(w => w.comments);
