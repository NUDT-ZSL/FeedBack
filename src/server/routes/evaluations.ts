import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Evaluation, StatsResponse } from '../types.js';

const router = Router();

const evaluations: Evaluation[] = [
  {
    id: uuidv4(),
    courseName: '前端开发基础',
    teacher: '张明教授',
    rating: 4,
    comment: '课程内容系统全面，从HTML基础到React框架都有涉及，实验环节设计合理，建议增加更多实战项目。',
    status: 'approved',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: uuidv4(),
    courseName: '进阶算法设计',
    teacher: '李华副教授',
    rating: 3,
    comment: '算法讲解深入，动态规划部分很有启发，但作业难度偏高且缺少提示，课堂节奏偏快容易跟不上。',
    status: 'approved',
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: uuidv4(),
    courseName: '自然语言处理简介',
    teacher: '王芳讲师',
    rating: 4,
    comment: '从基础语言模型到Transformer架构讲解清晰，实验用真实数据集很有代入感，推荐对NLP感兴趣的同学选修。',
    status: 'approved',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: uuidv4(),
    courseName: '前端开发基础',
    teacher: '张明教授',
    rating: 2,
    comment: '课程进度安排不够合理，前半段过于基础后半段又太赶，CSS布局部分讲得太快需要更多练习时间消化。',
    status: 'pending',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: uuidv4(),
    courseName: '进阶算法设计',
    teacher: '李华副教授',
    rating: 3,
    comment: '图论和贪心算法讲解非常精彩，但课后作业与课堂内容关联度不够紧密，希望增加中期答疑环节。',
    status: 'pending',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

router.post('/', (req: Request, res: Response) => {
  const { courseName, teacher, rating, comment } = req.body;

  if (!courseName || !teacher || !rating || !comment) {
    res.status(400).json({ error: '所有字段均为必填' });
    return;
  }

  if (rating < 1 || rating > 5) {
    res.status(400).json({ error: '评分必须在1-5之间' });
    return;
  }

  const chineseChars = comment.match(/[\u4e00-\u9fff]/g);
  if (!chineseChars || chineseChars.length < 10) {
    res.status(400).json({ error: '评论文本不少于10个汉字' });
    return;
  }

  const newEval: Evaluation = {
    id: uuidv4(),
    courseName,
    teacher,
    rating,
    comment,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  evaluations.push(newEval);
  res.status(201).json(newEval);
});

router.get('/', (_req: Request, res: Response) => {
  const sorted = [...evaluations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(sorted);
});

router.patch('/:id/approve', (req: Request, res: Response) => {
  const evaluation = evaluations.find((e) => e.id === req.params.id);
  if (!evaluation) {
    res.status(404).json({ error: '评价不存在' });
    return;
  }

  evaluation.status = 'approved';
  res.json(evaluation);
});

router.patch('/:id/reject', (req: Request, res: Response) => {
  const index = evaluations.findIndex((e) => e.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: '评价不存在' });
    return;
  }

  evaluations.splice(index, 1);
  res.json({ success: true });
});

router.get('/stats', (_req: Request, res: Response) => {
  const approved = evaluations.filter((e) => e.status === 'approved');

  if (approved.length === 0) {
    const emptyStats: StatsResponse = {
      totalEvaluations: 0,
      averageScore: 0,
      topCourse: null,
      ratingDistribution: [1, 2, 3, 4, 5].map((r) => ({
        rating: r,
        count: 0,
        percentage: 0,
      })),
      courseAverages: [],
      recentApproved: [],
    };
    res.json(emptyStats);
    return;
  }

  const totalRating = approved.reduce((sum, e) => sum + e.rating, 0);
  const averageScore = Math.round((totalRating / approved.length) * 10) / 10;

  const courseMap = new Map<string, { total: number; count: number }>();
  for (const e of approved) {
    const existing = courseMap.get(e.courseName) || { total: 0, count: 0 };
    existing.total += e.rating;
    existing.count += 1;
    courseMap.set(e.courseName, existing);
  }

  const courseAverages = Array.from(courseMap.entries())
    .map(([courseName, data]) => ({
      courseName,
      averageScore: Math.round((data.total / data.count) * 10) / 10,
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  let topCourse: { name: string; score: number } | null = null;
  if (courseAverages.length > 0) {
    topCourse = {
      name: courseAverages[0].courseName,
      score: courseAverages[0].averageScore,
    };
  }

  const ratingCounts = [1, 2, 3, 4, 5].map((r) => {
    const count = approved.filter((e) => e.rating === r).length;
    return {
      rating: r,
      count,
      percentage: Math.round((count / approved.length) * 1000) / 10,
    };
  });

  const recentApproved = [...approved]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5);

  const stats: StatsResponse = {
    totalEvaluations: approved.length,
    averageScore,
    topCourse,
    ratingDistribution: ratingCounts,
    courseAverages: courseAverages.slice(0, 3),
    recentApproved,
  };

  res.json(stats);
});

export default router;
