import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

interface Ingredient {
  name: string;
  checked: boolean;
}

interface Step {
  id: number;
  content: string;
  expanded: boolean;
}

interface Comment {
  id: string;
  nickname: string;
  content: string;
  createdAt: Date;
}

interface Recipe {
  id: string;
  title: string;
  author: string;
  authorAvatar: string;
  thumbnail: string;
  image: string;
  description: string;
  category: string;
  tags: string[];
  likes: number;
  liked: boolean;
  ingredients: Ingredient[];
  steps: Step[];
  comments: Comment[];
  createdAt: Date;
}

const categories = ['中餐', '西餐', '日料', '韩餐', '甜点', '饮品', '素食'];

const recipeTitles = [
  '红烧肉', '意大利肉酱面', '日式拉面', '韩式石锅拌饭', '法式焦糖布丁',
  '麻婆豆腐', '香煎三文鱼', '寿司拼盘', '部队火锅', '提拉米苏',
  '宫保鸡丁', '奶油蘑菇意面', '天妇罗', '烤五花肉', '抹茶蛋糕',
  '糖醋排骨', '牛排配黑椒汁', '日式咖喱饭', '泡菜汤', '芒果班戟'
];

const authors = ['美食达人小王', '厨师小李', '烘焙爱好者', '家庭煮夫', '素食主义者', '日料师傅', '甜品师小美'];

const avatarColors = ['#E67E22', '#F39C12', '#E74C3C', '#3498DB', '#2ECC71', '#9B59B6', '#1ABC9C'];

const descriptions = [
  '经典家常美味，入口即化，肥而不腻，是节日必备的硬菜。',
  '浓郁的番茄肉酱配上劲道的面条，每一口都是满足。',
  '正宗日式风味，浓郁的豚骨汤底配上手工拉面，温暖你的胃。',
  '色香味俱全的韩式经典，石锅滋滋作响，锅巴香脆可口。',
  '丝滑细腻的焦糖布丁，焦糖的香脆与布丁的嫩滑完美结合。',
  '麻辣鲜香，豆腐嫩滑，是下饭神器。',
  '外酥里嫩，营养丰富，健康美味两不误。',
  '新鲜的刺身配上醋饭，一口一个，回味无穷。',
  '芝士满满的部队火锅，年糕拉面火腿应有尽有。',
  '意式经典甜品，咖啡与马斯卡彭的完美邂逅。',
  '酸甜微辣，鸡肉嫩滑，坚果香脆，经典川菜。',
  '浓郁的蘑菇香气，奶油酱汁醇厚，搭配意面绝佳。',
  '金黄酥脆的外皮，鲜嫩多汁的内里，配上特制蘸料。',
  '韩式烤肉经典，配上生菜泡菜，一口一个超满足。',
  '清新的抹茶风味，绵密的蛋糕体，是下午茶的完美选择。',
  '外酥里嫩，酸甜可口，老少皆宜的经典菜式。',
  '完美的熟度，浓郁的黑椒汁，在家也能享受西餐厅的美味。',
  '浓郁的咖喱香气，配上软糯的米饭，简单又美味。',
  '酸辣开胃的泡菜汤，配上一碗白米饭，绝了。',
  '香甜的芒果配上奶油，薄软的班戟皮，一口爆浆。'
];

const ingredientsList = [
  ['五花肉 500g', '冰糖 30g', '生抽 2勺', '老抽 1勺', '料酒 1勺', '姜片 5片', '八角 2个'],
  ['意大利面 200g', '牛肉馅 300g', '番茄 3个', '洋葱 1个', '大蒜 3瓣', '番茄酱 2勺'],
  ['猪大骨 500g', '拉面 2份', '溏心蛋 2个', '叉烧肉 100g', '海苔 2片', '葱花 适量'],
  ['米饭 2碗', '牛肉片 150g', '菠菜 100g', '豆芽 100g', '胡萝卜丝 50g', '鸡蛋 1个', '韩式辣酱 2勺'],
  ['鸡蛋 4个', '牛奶 500ml', '白糖 80g', '焦糖 适量'],
  ['嫩豆腐 400g', '牛肉末 100g', '郫县豆瓣酱 2勺', '花椒粉 适量', '葱花 适量'],
  ['三文鱼 300g', '柠檬 1个', '黑胡椒 适量', '海盐 适量', '橄榄油 1勺'],
  ['寿司米 300g', '三文鱼 150g', '金枪鱼 100g', '虾 6只', '黄瓜 1根', '牛油果 1个'],
  ['年糕 200g', '方便面 1包', '午餐肉 200g', '芝士片 2片', '泡菜 100g', '洋葱 半个'],
  ['马斯卡彭芝士 250g', '手指饼干 200g', '浓缩咖啡 200ml', '蛋黄 3个', '白糖 50g', '可可粉 适量'],
  ['鸡胸肉 300g', '花生米 50g', '干辣椒 10个', '花椒 1勺', '葱姜蒜 适量'],
  ['意大利面 200g', '白蘑菇 200g', '淡奶油 200ml', '洋葱 半个', '蒜末 2勺', '帕玛森芝士 30g'],
  ['虾 10只', '茄子 1个', '南瓜 200g', '天妇罗粉 100g', '冰水 150ml'],
  ['五花肉 500g', '生菜 1颗', '泡菜 100g', '大蒜 5瓣', '韩式烤肉酱 3勺'],
  ['低筋面粉 100g', '抹茶粉 10g', '鸡蛋 3个', '牛奶 100ml', '淡奶油 200ml', '白糖 60g'],
  ['排骨 500g', '白糖 50g', '米醋 3勺', '生抽 2勺', '料酒 1勺', '番茄酱 2勺'],
  ['牛排 2块', '黑胡椒 适量', '海盐 适量', '黄油 20g', '大蒜 3瓣', '迷迭香 2枝'],
  ['鸡腿肉 2个', '土豆 2个', '胡萝卜 1根', '洋葱 半个', '咖喱块 1盒', '米饭 2碗'],
  ['泡菜 200g', '豆腐 300g', '五花肉 100g', '洋葱 半个', '大蒜 3瓣', '辣椒粉 1勺'],
  ['低筋面粉 80g', '鸡蛋 2个', '牛奶 200ml', '芒果 2个', '淡奶油 200ml', '白糖 40g']
];

const stepsList = [
  ['五花肉切块，冷水下锅焯水去血沫，捞出沥干。', '锅中放少许油，加入冰糖小火炒出糖色。', '放入五花肉翻炒上色，加入生抽、老抽、料酒调味。', '加入姜片、八角和适量热水，大火烧开后转小火炖1小时。', '最后大火收汁即可出锅。'],
  ['番茄切丁，洋葱和大蒜切末备用。', '锅中放油，炒香洋葱和蒜末，加入牛肉末炒散。', '加入番茄丁和番茄酱，小火熬煮20分钟成肉酱。', '同时另起锅煮意大利面至八分熟。', '将面条加入肉酱中翻炒均匀，撒上芝士粉即可。'],
  ['猪大骨焯水后，加水大火烧开转小火炖煮4小时成浓汤。', '拉面煮至八分熟，捞出放入碗中。', '叉烧肉切片，溏心蛋对半切。', '碗中倒入热汤，摆上叉烧、溏心蛋、海苔和葱花。'],
  ['各种蔬菜分别焯水煮熟备用。', '石锅刷一层香油，放入米饭。', '依次摆上牛肉片和各种蔬菜，中间打入一个鸡蛋。', '小火加热至米饭底部形成锅巴。', '加入韩式辣酱，拌匀即可食用。'],
  ['蛋黄加糖打发至颜色变浅。', '牛奶加热至微沸，慢慢倒入蛋黄糊中搅拌均匀。', '倒回锅中小火加热至浓稠，过滤后倒入模具。', '冷藏4小时以上，食用前撒上白糖炙烤出焦糖。'],
  ['豆腐切小块，用盐水浸泡备用。', '锅中放油，炒香牛肉末，加入豆瓣酱炒出红油。', '加入适量水烧开，放入豆腐块。', '小火炖煮5分钟，勾芡撒上花椒粉和葱花。'],
  ['三文鱼用厨房纸吸干水分，两面撒上海盐和黑胡椒。', '平底锅加热，放少许橄榄油，放入三文鱼。', '每面煎2-3分钟至金黄。', '挤上柠檬汁，放上装饰即可。'],
  ['寿司米洗净后加水蒸熟，加寿司醋拌匀放凉。', '各种刺身切片，黄瓜、牛油果切条。', '取适量米饭捏成椭圆形，上面放上刺身。', '或者用海苔卷起做成卷寿司。'],
  ['洋葱切片，锅中炒香后加入泡菜翻炒。', '加入适量水烧开，放入年糕、午餐肉。', '煮至年糕变软，加入方便面和调料包。', '最后放上芝士片，煮至融化即可。'],
  ['蛋黄加糖打发至颜色变浅，加入马斯卡彭芝士拌匀。', '淡奶油打发至湿性发泡，与芝士糊混合。', '手指饼干快速蘸取咖啡液，铺在容器底部。', '抹上一层芝士糊，重复铺层，冷藏4小时。', '食用前筛上可可粉。'],
  ['鸡胸肉切丁，用料酒、盐腌制10分钟。', '花生米炸至金黄酥脆备用。', '锅中放油，爆香干辣椒和花椒。', '放入鸡丁翻炒至变色，加入调味汁。', '最后加入花生米翻炒均匀即可。'],
  ['蘑菇切片，洋葱切末，大蒜切末。', '锅中炒香洋葱和蒜末，加入蘑菇片炒软。', '倒入淡奶油，小火熬煮至浓稠。', '同时煮意面至八分熟。', '将面条加入酱汁中，撒上帕玛森芝士。'],
  ['天妇罗粉加冰水调成面糊，静置10分钟。', '虾去壳留尾，茄子、南瓜切片。', '食材裹上面糊，放入180度油中炸至金黄。', '捞出沥油，配上蘸料即可。'],
  ['五花肉切成薄片，用烤肉酱腌制30分钟。', '平底锅加热，放入五花肉片煎至金黄。', '生菜洗净，大蒜切片。', '用生菜包肉片、泡菜、蒜片一起食用。'],
  ['低筋面粉和抹茶粉混合过筛。', '蛋黄加糖打散，加入牛奶和植物油，筛入粉类拌匀。', '蛋白打发至硬性发泡，与蛋黄糊混合。', '倒入模具，150度烤50分钟。', '冷却后夹层抹上抹茶奶油。'],
  ['排骨焯水后沥干备用。', '锅中放油炒糖色，放入排骨翻炒上色。', '加入生抽、料酒、番茄酱调味。', '加入米醋和适量水，小火炖煮30分钟。', '大火收汁即可。'],
  ['牛排提前从冰箱取出回温，用厨房纸吸干水分。', '两面撒上海盐和黑胡椒腌制。', '平底锅烧热，放入牛排，每面煎2-3分钟。', '加入黄油、大蒜、迷迭香，淋在牛排上。', '静置5分钟后切片。'],
  ['鸡腿肉切块，土豆、胡萝卜切块，洋葱切片。', '锅中炒香洋葱，加入鸡肉炒至变色。', '加入土豆和胡萝卜翻炒。', '加水烧开后转小火煮15分钟。', '加入咖喱块煮至融化，浇在米饭上。'],
  ['五花肉切片，锅中炒香后加入泡菜翻炒。', '加入适量水烧开，放入豆腐块。', '加入辣椒粉、生抽调味。', '小火炖煮10分钟，撒上葱花即可。'],
  ['低筋面粉过筛，鸡蛋加糖打散，加入牛奶拌匀。', '筛入面粉搅拌至无颗粒，静置20分钟。', '平底锅小火，倒入一勺面糊摊成薄饼。', '奶油打发，芒果切块。', '班戟皮包入奶油和芒果，对折成型。']
];

const tags = [
  ['家常菜', '下饭', '传统'], ['西餐', '意面', '经典'], ['日料', '拉面', '暖心'],
  ['韩餐', '石锅', '下饭'], ['甜点', '布丁', '法式'], ['川菜', '麻辣', '下饭'],
  ['海鲜', '健康', '低脂'], ['日料', '寿司', '冷食'], ['韩餐', '火锅', '芝士'],
  ['甜点', '意式', '咖啡'], ['川菜', '经典', '下酒'], ['西餐', '奶油', '意面'],
  ['日料', '炸物', '酥脆'], ['韩餐', '烤肉', '聚会'], ['甜点', '抹茶', '下午茶'],
  ['家常菜', '酸甜', '经典'], ['西餐', '牛排', '高档'], ['日料', '咖喱', '家常'],
  ['韩餐', '汤品', '开胃'], ['甜点', '芒果', '夏日']
];

const mockRecipes: Recipe[] = recipeTitles.map((title, index) => ({
  id: uuidv4(),
  title,
  author: authors[index % authors.length],
  authorAvatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(authors[index % authors.length])}&backgroundColor=${avatarColors[index % avatarColors.length].slice(1)}`,
  thumbnail: `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(`美味的${title}，美食摄影，高清，专业摆盘`)}&image_size=square_hd`,
  image: `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(`美味的${title}，美食摄影，高清，专业灯光，特写`)}&image_size=landscape_16_9`,
  description: descriptions[index],
  category: categories[index % categories.length],
  tags: tags[index],
  likes: Math.floor(Math.random() * 500) + 50,
  liked: false,
  ingredients: ingredientsList[index].map(name => ({ name, checked: false })),
  steps: stepsList[index].map((content, i) => ({ id: i + 1, content, expanded: false })),
  comments: [
    { id: uuidv4(), nickname: '美食爱好者', content: '做出来太好吃了！家人都很喜欢~', createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) },
    { id: uuidv4(), nickname: '新手厨师', content: '步骤很详细，第一次做就成功了！', createdAt: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000) },
  ],
  createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
}));

let recipes: Recipe[] = [...mockRecipes];

app.get('/api/recipes', (_req, res) => {
  res.json(recipes);
});

app.get('/api/recipes/:id', (req, res) => {
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: '菜谱不存在' });
  }
  res.json(recipe);
});

app.post('/api/recipes', (req, res) => {
  const { title, author, description, category, tags, ingredients, steps, image, thumbnail } = req.body;
  
  if (!title || !author || !description || !category || !ingredients || !steps) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  const newRecipe: Recipe = {
    id: uuidv4(),
    title,
    author,
    authorAvatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(author)}&backgroundColor=${avatarColors[Math.floor(Math.random() * avatarColors.length)].slice(1)}`,
    thumbnail: thumbnail || `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(`美味的${title}，美食摄影，高清`)}&image_size=square_hd`,
    image: image || `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(`美味的${title}，美食摄影，高清，特写`)}&image_size=landscape_16_9`,
    description,
    category,
    tags: tags || [],
    likes: 0,
    liked: false,
    ingredients: ingredients.map((name: string) => ({ name, checked: false })),
    steps: steps.map((content: string, i: number) => ({ id: i + 1, content, expanded: false })),
    comments: [],
    createdAt: new Date(),
  };

  recipes.unshift(newRecipe);
  res.status(201).json(newRecipe);
});

app.put('/api/recipes/:id/like', (req, res) => {
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: '菜谱不存在' });
  }

  const { liked } = req.body;
  if (liked) {
    recipe.likes += 1;
  } else {
    recipe.likes = Math.max(0, recipe.likes - 1);
  }
  recipe.liked = liked;

  res.json({ likes: recipe.likes, liked: recipe.liked });
});

app.post('/api/recipes/:id/comments', (req, res) => {
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: '菜谱不存在' });
  }

  const { nickname, content } = req.body;
  if (!nickname || !content) {
    return res.status(400).json({ error: '请填写昵称和评论内容' });
  }

  const newComment: Comment = {
    id: uuidv4(),
    nickname,
    content,
    createdAt: new Date(),
  };

  recipe.comments.push(newComment);
  res.status(201).json(newComment);
});

app.put('/api/recipes/:id/ingredients', (req, res) => {
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: '菜谱不存在' });
  }

  const { ingredientIndex, checked } = req.body;
  if (ingredientIndex === undefined || ingredientIndex < 0 || ingredientIndex >= recipe.ingredients.length) {
    return res.status(400).json({ error: '无效的食材索引' });
  }

  recipe.ingredients[ingredientIndex].checked = checked;
  res.json({ success: true });
});

app.put('/api/recipes/:id/steps', (req, res) => {
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: '菜谱不存在' });
  }

  const { stepIndex, expanded } = req.body;
  if (stepIndex === undefined || stepIndex < 0 || stepIndex >= recipe.steps.length) {
    return res.status(400).json({ error: '无效的步骤索引' });
  }

  recipe.steps[stepIndex].expanded = expanded;
  res.json({ success: true });
});

app.get('/api/categories', (_req, res) => {
  res.json(categories);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Loaded ${recipes.length} mock recipes`);
});
