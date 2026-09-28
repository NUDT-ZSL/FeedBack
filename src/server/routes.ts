import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Book, Annotation, ShareLink } from '../client/types';

const router = express.Router();

const books: Book[] = [
  {
    id: 'book-1',
    title: '追风筝的人',
    author: '卡勒德·胡赛尼',
    coverUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=200&h=300&fit=crop',
    chapters: [
      {
        id: 'ch-1-1',
        title: '第一章',
        content: '我成为今天的我，是在1975年某个阴云密布的寒冷冬日，那年我十二岁。我清楚地记得当时自己趴在一堵坍塌的泥墙后面，窥视着那条小巷，旁边是结冰的小溪。许多年过去了，人们说陈年旧事可以被埋葬，然而我终于明白这是错的，因为往事会自行爬上来。回首前尘，我意识到在过去二十六年里，自己始终在窥视着那荒芜的小径。',
      },
      {
        id: 'ch-1-2',
        title: '第二章',
        content: '我和哈桑在喀布尔的山丘上长大，我们一起爬树、一起吃石榴、一起看夕阳。哈桑是我的仆人，也是我最好的朋友。但我们之间有着难以逾越的鸿沟：我是普什图人，他是哈扎拉人；我是逊尼派，他是什叶派。这些身份标签像无形的墙，隔开了我们的友谊。',
      },
      {
        id: 'ch-1-3',
        title: '第三章',
        content: '爸爸是个高大威猛的男人，他不仅建造了喀布尔最漂亮的房子，还建立了孤儿院、资助过不计其数的穷人。在我眼中，爸爸是完美的化身，但他似乎对我总是不满意。我喜欢读书和写作，而他希望我成为一个勇敢、强壮的男子汉。',
      },
    ],
  },
  {
    id: 'book-2',
    title: '小王子',
    author: '安托万·德·圣-埃克苏佩里',
    coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&h=300&fit=crop',
    chapters: [
      {
        id: 'ch-2-1',
        title: '第一章',
        content: '当我还只有六岁的时候，在一本描写原始森林名叫《真实的故事》的书中，看见了一幅精彩的插画，画的是一条蟒蛇正在吞食一头猛兽。我花了很大功夫画出了我的第一号作品，但是大人们对我说，画这种画没什么意思，劝我把兴趣放到地理、历史、算术、语法上去。就这样，在六岁那年，我放弃了当画家这一美好的职业。',
      },
      {
        id: 'ch-2-2',
        title: '第二章',
        content: '我就这样孤独地生活着，没有一个能真正谈得来的人。一直到六年前，我的飞机在撒哈拉沙漠上发生了故障。第一天晚上，我就睡在远离人间一千里之外的沙漠上。第二天天亮时，一个奇怪的小声音叫醒了我，他说："请你给我画一只羊，好吗？"',
      },
      {
        id: 'ch-2-3',
        title: '第三章',
        content: '小王子来自一颗只有房子那么大的小行星——B612号。他告诉我，在他的星球上，每天早上洗漱完毕后，还得仔细地给星球做清洁。他得规定自己按时去拔掉猴面包树苗，因为如果任由它们生长，就会把整个星球撑破。',
      },
    ],
  },
  {
    id: 'book-3',
    title: '活着',
    author: '余华',
    coverUrl: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=200&h=300&fit=crop',
    chapters: [
      {
        id: 'ch-3-1',
        title: '第一章',
        content: '我比现在年轻十岁的时候，获得了一个游手好闲的职业，去乡间收集民间歌谣。那一年的整个夏天，我如同一只乱飞的麻雀，游荡在知了和阳光充斥的村舍田野。我喜欢喝农民那种粗糙的茶水，也喜欢和光着脊背的汉子一同在河里洗澡。',
      },
      {
        id: 'ch-3-2',
        title: '第二章',
        content: '我遇到的那个叫福贵的老人，他正在田里赶着一头老牛耕地。老牛慢悠悠地走着，福贵也不急，就那样跟在后面。他穿着一身洗得发白的蓝布衣服，额头上布满了皱纹，每一道皱纹里都藏着故事。',
      },
      {
        id: 'ch-3-3',
        title: '第三章',
        content: '福贵说，他年轻的时候是个不折不扣的败家子，吃喝嫖赌样样都沾。他爹是当地有名的地主，家里有一百多亩地。福贵整天在城里的妓院里鬼混，还染上了赌博的恶习，最后把家里的田产都输光了。',
      },
    ],
  },
  {
    id: 'book-4',
    title: '三体',
    author: '刘慈欣',
    coverUrl: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=200&h=300&fit=crop',
    chapters: [
      {
        id: 'ch-4-1',
        title: '第一章',
        content: '汪淼第一次看到倒计时是在拍胶卷的时候。那天晚上，他作为摄影爱好者，在自家阳台上试新买的胶卷，结果洗出来的每一张照片上都有一行奇怪的倒计时数字，精确到秒。他以为是胶卷有问题，换了好几个牌子，结果都是一样。',
      },
      {
        id: 'ch-4-2',
        title: '第二章',
        content: '汪淼去找了一位物理学家朋友，朋友告诉他，这不可能是胶卷的问题，也不是相机的问题，因为同样的相机和胶卷，别人拍出来就是正常的。难道，这些数字是直接打在他的视网膜上的？这个念头让汪淼感到一阵寒意。',
      },
      {
        id: 'ch-4-3',
        title: '第三章',
        content: '在科学边界组织的聚会上，汪淼遇到了很多科学家。他们中的很多人都在最近经历了奇怪的事情，有些甚至自杀了。杨冬，那位著名的女物理学家，就是在几天前留下"物理学从来就没有存在过"的遗言后自杀的。',
      },
    ],
  },
];

const annotations: Annotation[] = [];
const shares: ShareLink[] = [];

router.get('/books', (_req, res) => {
  res.json(books);
});

router.get('/books/:id', (req, res) => {
  const book = books.find(b => b.id === req.params.id);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }
  res.json(book);
});

router.get('/annotations', (req, res) => {
  const bookId = req.query.bookId as string;
  if (!bookId) {
    return res.status(400).json({ error: 'bookId is required' });
  }
  const bookAnnotations = annotations.filter(a => a.bookId === bookId);
  res.json(bookAnnotations);
});

router.post('/annotations', (req, res) => {
  const { bookId, chapterId, startOffset, endOffset, selectedText, color, note } = req.body;
  
  if (!bookId || !chapterId || startOffset === undefined || endOffset === undefined || !selectedText) {
    return res.status(400).json({ error: 'bookId, chapterId, startOffset, endOffset, and selectedText are required' });
  }
  
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number') {
    return res.status(400).json({ error: 'startOffset and endOffset must be numbers' });
  }
  
  const annotation: Annotation = {
    id: uuidv4(),
    bookId,
    chapterId,
    startOffset,
    endOffset,
    selectedText,
    color: color || 'yellow',
    note,
    createdAt: Date.now(),
  };
  annotations.push(annotation);
  res.status(201).json(annotation);
});

router.post('/shares', (req, res) => {
  const { bookId, targetEmail } = req.body;
  if (!bookId || !targetEmail) {
    return res.status(400).json({ error: 'bookId and targetEmail are required' });
  }
  const bookAnnotations = annotations.filter(a => a.bookId === bookId);
  const share: ShareLink = {
    id: uuidv4(),
    bookId,
    annotations: [...bookAnnotations],
    targetEmail,
    createdAt: Date.now(),
  };
  shares.push(share);
  res.status(201).json(share);
});

router.get('/shares/:id', (req, res) => {
  const share = shares.find(s => s.id === req.params.id);
  if (!share) {
    return res.status(404).json({ error: 'Share not found' });
  }
  res.json(share);
});

export default router;
