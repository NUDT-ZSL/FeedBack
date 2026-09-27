import bcrypt from 'bcryptjs'
import store from './store.js'
import type { User, Recipe, Ingredient, Step } from '../types/index.js'

const AVATAR_URLS = {
  chef: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=200&h=200&fit=crop&crop=face',
  foodie: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
  baker: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face',
}

const COVER_URLS = [
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1574484284002-952d92456975?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1571115764595-644a1f56a55c?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=800&h=600&fit=crop',
  'https://images.unsplash.com/photo-1562967914-608f82629710?w=800&h=600&fit=crop',
]

interface MockRecipe {
  title: string
  coverImage: string
  ingredients: Omit<Ingredient, 'id'>[]
  steps: Omit<Step, 'id'>[]
  cookTime: number
  difficulty: 1 | 2 | 3 | 4 | 5
  tags: string[]
}

const sichuanRecipes: MockRecipe[] = [
  {
    title: '麻婆豆腐',
    coverImage: COVER_URLS[0],
    ingredients: [
      { name: '嫩豆腐', quantity: 400, unit: '克' },
      { name: '牛肉末', quantity: 100, unit: '克' },
      { name: '郫县豆瓣酱', quantity: 2, unit: '勺' },
      { name: '花椒粉', quantity: 1, unit: '茶匙' },
      { name: '蒜末', quantity: 3, unit: '瓣' },
      { name: '生抽', quantity: 1, unit: '勺' },
      { name: '淀粉', quantity: 1, unit: '勺' },
    ],
    steps: [
      { order: 1, description: '豆腐切成2厘米见方的小块，放入加盐的开水中焯烫2分钟捞出备用。' },
      { order: 2, description: '热锅倒油，放入牛肉末炒至变色，加入豆瓣酱炒出红油。' },
      { order: 3, description: '加入蒜末、姜末爆香，加入适量清水烧开。' },
      { order: 4, description: '放入豆腐块，轻轻推动，加入生抽调味。' },
      { order: 5, description: '水淀粉勾芡，撒上花椒粉和葱花即可出锅。' },
    ],
    cookTime: 25,
    difficulty: 3,
    tags: ['川菜', '家常菜', '下饭'],
  },
  {
    title: '水煮鱼',
    coverImage: COVER_URLS[1],
    ingredients: [
      { name: '草鱼', quantity: 1000, unit: '克' },
      { name: '豆芽', quantity: 200, unit: '克' },
      { name: '干辣椒', quantity: 50, unit: '克' },
      { name: '花椒', quantity: 20, unit: '克' },
      { name: '郫县豆瓣酱', quantity: 3, unit: '勺' },
      { name: '料酒', quantity: 2, unit: '勺' },
      { name: '淀粉', quantity: 2, unit: '勺' },
    ],
    steps: [
      { order: 1, description: '草鱼去骨切片，用盐、料酒、淀粉腌制20分钟。' },
      { order: 2, description: '豆芽焯水铺在盆底。' },
      { order: 3, description: '热锅倒油，炒香豆瓣酱，加入清水烧开。' },
      { order: 4, description: '鱼片逐一下入锅中，煮至变色即可捞出。' },
      { order: 5, description: '干辣椒和花椒放在鱼片上，淋上热油即可。' },
    ],
    cookTime: 45,
    difficulty: 4,
    tags: ['川菜', '海鲜', '辣'],
  },
  {
    title: '宫保鸡丁',
    coverImage: COVER_URLS[2],
    ingredients: [
      { name: '鸡胸肉', quantity: 300, unit: '克' },
      { name: '花生米', quantity: 50, unit: '克' },
      { name: '干辣椒', quantity: 10, unit: '个' },
      { name: '花椒', quantity: 1, unit: '茶匙' },
      { name: '黄瓜', quantity: 1, unit: '根' },
      { name: '生抽', quantity: 2, unit: '勺' },
      { name: '醋', quantity: 1, unit: '勺' },
      { name: '白糖', quantity: 1, unit: '勺' },
    ],
    steps: [
      { order: 1, description: '鸡胸肉切丁，用盐、料酒、淀粉腌制15分钟。' },
      { order: 2, description: '调碗汁：生抽、醋、白糖、淀粉、清水混合。' },
      { order: 3, description: '热锅倒油，将花生米炸至金黄捞出。' },
      { order: 4, description: '锅中留底油，爆香干辣椒和花椒，放入鸡丁滑炒。' },
      { order: 5, description: '加入黄瓜丁翻炒，倒入碗汁，最后加入花生米翻炒均匀。' },
    ],
    cookTime: 30,
    difficulty: 3,
    tags: ['川菜', '家常菜', '快手菜'],
  },
]

const homeRecipes: MockRecipe[] = [
  {
    title: '西红柿炒鸡蛋',
    coverImage: COVER_URLS[5],
    ingredients: [
      { name: '西红柿', quantity: 3, unit: '个' },
      { name: '鸡蛋', quantity: 4, unit: '个' },
      { name: '葱花', quantity: 2, unit: '根' },
      { name: '盐', quantity: 1, unit: '茶匙' },
      { name: '白糖', quantity: 1, unit: '茶匙' },
    ],
    steps: [
      { order: 1, description: '西红柿切块，鸡蛋打散备用。' },
      { order: 2, description: '热锅倒油，将鸡蛋炒熟盛出。' },
      { order: 3, description: '锅中留底油，放入西红柿翻炒出汁。' },
      { order: 4, description: '加入盐和白糖调味，倒入炒好的鸡蛋。' },
      { order: 5, description: '翻炒均匀，撒上葱花即可。' },
    ],
    cookTime: 15,
    difficulty: 1,
    tags: ['家常菜', '快手菜', '入门'],
  },
  {
    title: '红烧肉',
    coverImage: COVER_URLS[6],
    ingredients: [
      { name: '五花肉', quantity: 600, unit: '克' },
      { name: '冰糖', quantity: 30, unit: '克' },
      { name: '生抽', quantity: 3, unit: '勺' },
      { name: '老抽', quantity: 1, unit: '勺' },
      { name: '料酒', quantity: 2, unit: '勺' },
      { name: '八角', quantity: 2, unit: '个' },
      { name: '桂皮', quantity: 1, unit: '小块' },
    ],
    steps: [
      { order: 1, description: '五花肉切成3厘米见方的块，冷水下锅焯水。' },
      { order: 2, description: '锅中放少许油，小火炒糖色至琥珀色。' },
      { order: 3, description: '放入肉块翻炒上色，加入料酒、生抽、老抽。' },
      { order: 4, description: '加入八角、桂皮、姜片，加入没过肉块的热水。' },
      { order: 5, description: '大火烧开后转小火炖1小时，大火收汁即可。' },
    ],
    cookTime: 90,
    difficulty: 3,
    tags: ['家常菜', '宴客菜', '经典'],
  },
  {
    title: '酸辣土豆丝',
    coverImage: COVER_URLS[7],
    ingredients: [
      { name: '土豆', quantity: 2, unit: '个' },
      { name: '干辣椒', quantity: 5, unit: '个' },
      { name: '花椒', quantity: 1, unit: '茶匙' },
      { name: '醋', quantity: 2, unit: '勺' },
      { name: '盐', quantity: 1, unit: '茶匙' },
      { name: '葱花', quantity: 2, unit: '根' },
    ],
    steps: [
      { order: 1, description: '土豆去皮切丝，用清水冲洗几遍去除淀粉。' },
      { order: 2, description: '热锅倒油，爆香干辣椒和花椒。' },
      { order: 3, description: '放入土豆丝大火快炒。' },
      { order: 4, description: '加入醋和盐调味，炒至断生。' },
      { order: 5, description: '撒上葱花即可出锅。' },
    ],
    cookTime: 20,
    difficulty: 2,
    tags: ['家常菜', '素菜', '快手菜'],
  },
]

const dessertRecipes: MockRecipe[] = [
  {
    title: '芒果班戟',
    coverImage: COVER_URLS[10],
    ingredients: [
      { name: '芒果', quantity: 2, unit: '个' },
      { name: '淡奶油', quantity: 200, unit: '毫升' },
      { name: '低筋面粉', quantity: 80, unit: '克' },
      { name: '鸡蛋', quantity: 2, unit: '个' },
      { name: '牛奶', quantity: 150, unit: '毫升' },
      { name: '白糖', quantity: 50, unit: '克' },
    ],
    steps: [
      { order: 1, description: '鸡蛋打散，加入牛奶、融化的黄油、糖混合均匀。' },
      { order: 2, description: '筛入低筋面粉，搅拌至无颗粒。' },
      { order: 3, description: '平底锅小火，倒入面糊摊成薄饼，每张煎至两面微黄。' },
      { order: 4, description: '淡奶油加糖打发至硬性发泡。' },
      { order: 5, description: '芒果切块，饼皮中间放奶油和芒果，包成四方形即可。' },
    ],
    cookTime: 60,
    difficulty: 3,
    tags: ['甜点', '港式', '下午茶'],
  },
  {
    title: '提拉米苏',
    coverImage: COVER_URLS[11],
    ingredients: [
      { name: '马斯卡彭奶酪', quantity: 250, unit: '克' },
      { name: '手指饼干', quantity: 200, unit: '克' },
      { name: '浓缩咖啡', quantity: 200, unit: '毫升' },
      { name: '淡奶油', quantity: 150, unit: '毫升' },
      { name: '蛋黄', quantity: 3, unit: '个' },
      { name: '白糖', quantity: 60, unit: '克' },
      { name: '可可粉', quantity: 10, unit: '克' },
    ],
    steps: [
      { order: 1, description: '蛋黄加糖隔温水打发至颜色变浅。' },
      { order: 2, description: '加入马斯卡彭奶酪拌匀。' },
      { order: 3, description: '淡奶油打发至6分发，与奶酪糊混合。' },
      { order: 4, description: '手指饼干快速蘸取咖啡，铺一层，抹一层奶酪糊。' },
      { order: 5, description: '重复铺层，冷藏4小时，食用前筛上可可粉。' },
    ],
    cookTime: 120,
    difficulty: 4,
    tags: ['甜点', '意式', '经典'],
  },
  {
    title: '蔓越莓饼干',
    coverImage: COVER_URLS[12],
    ingredients: [
      { name: '低筋面粉', quantity: 150, unit: '克' },
      { name: '黄油', quantity: 100, unit: '克' },
      { name: '蔓越莓干', quantity: 50, unit: '克' },
      { name: '白糖', quantity: 60, unit: '克' },
      { name: '鸡蛋', quantity: 1, unit: '个' },
    ],
    steps: [
      { order: 1, description: '黄油软化后加糖打发至蓬松。' },
      { order: 2, description: '分次加入蛋液，每次打匀后再加。' },
      { order: 3, description: '筛入低筋面粉，加入切碎的蔓越莓干。' },
      { order: 4, description: '揉成面团，整形成长方体，冷藏1小时。' },
      { order: 5, description: '切成0.5厘米厚的片，165度烤20分钟即可。' },
    ],
    cookTime: 90,
    difficulty: 2,
    tags: ['甜点', '烘焙', '饼干'],
  },
]

export async function initMockData(): Promise<void> {
  store.clearAll()

  const hashedPassword = await bcrypt.hash('123456', 10)

  const chefUser = store.addUser({
    username: '厨师小王',
    password: hashedPassword,
    avatar: AVATAR_URLS.chef,
    bio: '专业川菜厨师，10年烹饪经验，分享正宗川味美食',
  })

  const foodieUser = store.addUser({
    username: '美食达人',
    password: hashedPassword,
    avatar: AVATAR_URLS.foodie,
    bio: '热爱美食的吃货，在家也能做出饭店味道',
  })

  const bakerUser = store.addUser({
    username: '烘焙爱好者',
    password: hashedPassword,
    avatar: AVATAR_URLS.baker,
    bio: '专注甜点烘焙，用烤箱创造幸福滋味',
  })

  const users: User[] = [chefUser, foodieUser, bakerUser]

  store.followUser(foodieUser.id, chefUser.id)
  store.followUser(bakerUser.id, chefUser.id)
  store.followUser(chefUser.id, foodieUser.id)
  store.followUser(bakerUser.id, foodieUser.id)

  const createdRecipes: Recipe[] = []

  for (let i = 0; i < sichuanRecipes.length; i++) {
    const recipe = sichuanRecipes[i]
    const created = store.addRecipe({
      ...recipe,
      authorId: chefUser.id,
      authorName: chefUser.username,
      authorAvatar: chefUser.avatar,
    })
    createdRecipes.push(created)
  }

  for (let i = 0; i < homeRecipes.length; i++) {
    const recipe = homeRecipes[i]
    const created = store.addRecipe({
      ...recipe,
      authorId: foodieUser.id,
      authorName: foodieUser.username,
      authorAvatar: foodieUser.avatar,
    })
    createdRecipes.push(created)
  }

  for (let i = 0; i < dessertRecipes.length; i++) {
    const recipe = dessertRecipes[i]
    const created = store.addRecipe({
      ...recipe,
      authorId: bakerUser.id,
      authorName: bakerUser.username,
      authorAvatar: bakerUser.avatar,
    })
    createdRecipes.push(created)
  }

  createdRecipes.forEach((recipe, index) => {
    users.forEach(user => {
      if (user.id !== recipe.authorId && Math.random() > 0.3) {
        store.likeRecipe(recipe.id, user.id)
      }
    })

    users.forEach(user => {
      if (user.id !== recipe.authorId && Math.random() > 0.5) {
        store.favoriteRecipe(recipe.id, user.id)
      }
    })

    const commentUsers = users.filter(u => u.id !== recipe.authorId)
    if (commentUsers.length > 0 && index % 2 === 0) {
      const commenter = commentUsers[index % commentUsers.length]
      const comments = [
        '味道太棒了！按照步骤做出来很成功。',
        '收藏了，周末试试做给家人吃。',
        '步骤很详细，新手也能学会，感谢分享！',
        '这个菜谱太实用了，已经做过好几次了。',
        '色香味俱全，家人都很喜欢！',
      ]
      store.addComment(recipe.id, commenter.id, comments[index % comments.length])
    }
  })

  console.log('Mock data initialized successfully!')
  console.log(`Users: ${users.length}, Recipes: ${createdRecipes.length}`)
}
