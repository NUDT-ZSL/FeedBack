import { useState, useCallback, useEffect } from 'react';
import {
  OKR,
  Task,
  KeyResult,
  calculateKRProgressFromTasks,
  generateId
} from '@/utils/helpers';

const mockOKRs: OKR[] = [
  {
    id: 'okr-1',
    title: '提升用户留存率',
    quarter: '2024 Q3',
    deadline: '2024-09-30',
    keyResults: [
      { id: 'kr-1', title: '次日留存从40%提升到55%', weight: 40, progress: 65 },
      { id: 'kr-2', title: '7日留存从25%提升到35%', weight: 35, progress: 45 },
      { id: 'kr-3', title: '30日留存从15%提升到22%', weight: 25, progress: 30 }
    ],
    tasks: [
      { id: 'task-1', krId: 'kr-1', title: '优化新用户引导流程', estimatedHours: 16, deadline: '2024-07-15', completed: true, assignee: '张三', order: 0 },
      { id: 'task-2', krId: 'kr-1', title: '增加每日签到奖励', estimatedHours: 24, deadline: '2024-07-30', completed: false, assignee: '李四', order: 1 },
      { id: 'task-3', krId: 'kr-2', title: '优化推送通知策略', estimatedHours: 20, deadline: '2024-08-10', completed: false, assignee: '王五', order: 2 },
      { id: 'task-4', krId: 'kr-2', title: '增加周常活动', estimatedHours: 32, deadline: '2024-08-25', completed: false, order: 3 },
      { id: 'task-5', krId: 'kr-3', title: '搭建用户成长体系', estimatedHours: 40, deadline: '2024-09-10', completed: false, order: 4 }
    ]
  },
  {
    id: 'okr-2',
    title: '提升产品性能',
    quarter: '2024 Q3',
    deadline: '2024-09-30',
    keyResults: [
      { id: 'kr-4', title: '页面加载时间减少50%', weight: 50, progress: 55 },
      { id: 'kr-5', title: '崩溃率降低到0.1%以下', weight: 50, progress: 70 }
    ],
    tasks: [
      { id: 'task-6', krId: 'kr-4', title: '图片懒加载优化', estimatedHours: 12, deadline: '2024-07-20', completed: true, assignee: '赵六', order: 0 },
      { id: 'task-7', krId: 'kr-4', title: '代码分割和按需加载', estimatedHours: 28, deadline: '2024-08-15', completed: false, assignee: '钱七', order: 1 },
      { id: 'task-8', krId: 'kr-5', title: '异常监控系统搭建', estimatedHours: 20, deadline: '2024-07-30', completed: true, assignee: '孙八', order: 2 },
      { id: 'task-9', krId: 'kr-5', title: '内存泄漏排查修复', estimatedHours: 24, deadline: '2024-08-20', completed: false, order: 3 }
    ]
  },
  {
    id: 'okr-3',
    title: '拓展新市场',
    quarter: '2024 Q3',
    deadline: '2024-09-30',
    keyResults: [
      { id: 'kr-6', title: '新增10万海外用户', weight: 60, progress: 25 },
      { id: 'kr-7', title: '完成3个海外渠道合作', weight: 40, progress: 40 }
    ],
    tasks: [
      { id: 'task-10', krId: 'kr-6', title: '多语言版本开发', estimatedHours: 48, deadline: '2024-08-30', completed: false, assignee: '周九', order: 0 },
      { id: 'task-11', krId: 'kr-6', title: '海外应用商店上架', estimatedHours: 16, deadline: '2024-09-10', completed: false, order: 1 },
      { id: 'task-12', krId: 'kr-7', title: '渠道合作伙伴洽谈', estimatedHours: 24, deadline: '2024-08-15', completed: true, assignee: '吴十', order: 2 },
      { id: 'task-13', krId: 'kr-7', title: '合作协议签署', estimatedHours: 8, deadline: '2024-09-20', completed: false, order: 3 }
    ]
  }
];

function delay<T>(data: T, ms: number = 150): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(data), ms));
}

export function useOKRData() {
  const [okrs, setOKRs] = useState<OKR[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const data = await delay(mockOKRs, 100);
      setOKRs(data);
      setLoading(false);
    };
    fetchData();
  }, []);

  const getOKRById = useCallback((id: string) => {
    return okrs.find(okr => okr.id === id);
  }, [okrs]);

  const addOKR = useCallback(async (title: string, quarter: string, deadline: string, keyResults: Omit<KeyResult, 'id'>[]) => {
    const newOKR: OKR = {
      id: generateId(),
      title,
      quarter,
      deadline,
      keyResults: keyResults.map(kr => ({ ...kr, id: generateId() })),
      tasks: []
    };
    const result = await delay(newOKR, 120);
    setOKRs(prev => [...prev, result]);
    return result;
  }, []);

  const updateTaskStatus = useCallback(async (okrId: string, taskId: string, completed: boolean) => {
    await delay(null, 100);
    setOKRs(prev => prev.map(okr => {
      if (okr.id !== okrId) return okr;
      const updatedTasks = okr.tasks.map(task =>
        task.id === taskId ? { ...task, completed } : task
      );
      const updatedKRs = okr.keyResults.map(kr => ({
        ...kr,
        progress: calculateKRProgressFromTasks(kr.id, updatedTasks)
      }));
      return { ...okr, tasks: updatedTasks, keyResults: updatedKRs };
    }));
  }, []);

  const reorderTasks = useCallback((okrId: string, taskId: string, newOrder: number) => {
    setOKRs(prev => prev.map(okr => {
      if (okr.id !== okrId) return okr;
      const tasks = [...okr.tasks];
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) return okr;
      const [movedTask] = tasks.splice(taskIndex, 1);
      tasks.splice(newOrder, 0, movedTask);
      const reorderedTasks = tasks.map((t, i) => ({ ...t, order: i }));
      return { ...okr, tasks: reorderedTasks };
    }));
  }, []);

  const addTask = useCallback(async (okrId: string, task: Omit<Task, 'id' | 'order' | 'completed'>) => {
    await delay(null, 100);
    setOKRs(prev => prev.map(okr => {
      if (okr.id !== okrId) return okr;
      const newTask: Task = {
        ...task,
        id: generateId(),
        order: okr.tasks.length,
        completed: false
      };
      const updatedTasks = [...okr.tasks, newTask];
      const updatedKRs = okr.keyResults.map(kr => ({
        ...kr,
        progress: calculateKRProgressFromTasks(kr.id, updatedTasks)
      }));
      return { ...okr, tasks: updatedTasks, keyResults: updatedKRs };
    }));
  }, []);

  const assignTask = useCallback((okrId: string, taskId: string, assignee: string) => {
    setOKRs(prev => prev.map(okr => {
      if (okr.id !== okrId) return okr;
      const updatedTasks = okr.tasks.map(task =>
        task.id === taskId ? { ...task, assignee } : task
      );
      return { ...okr, tasks: updatedTasks };
    }));
  }, []);

  const updateKRProgress = useCallback((okrId: string, krId: string, progress: number) => {
    setOKRs(prev => prev.map(okr => {
      if (okr.id !== okrId) return okr;
      const updatedKRs = okr.keyResults.map(kr =>
        kr.id === krId ? { ...kr, progress: Math.max(0, Math.min(100, progress)) } : kr
      );
      return { ...okr, keyResults: updatedKRs };
    }));
  }, []);

  const getRadarData = useCallback(() => {
    if (okrs.length === 0) return [];
    const totalProgress = okrs.reduce((sum, okr) => {
      const krProgress = okr.keyResults.reduce((s, kr) => s + kr.progress * kr.weight, 0);
      const totalWeight = okr.keyResults.reduce((s, kr) => s + kr.weight, 0);
      return sum + (totalWeight > 0 ? krProgress / totalWeight : 0);
    }, 0);
    const avgProgress = totalProgress / okrs.length;

    const completedTasks = okrs.reduce((sum, okr) =>
      sum + okr.tasks.filter(t => t.completed).length, 0
    );
    const totalTasks = okrs.reduce((sum, okr) => sum + okr.tasks.length, 0);
    const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const assignedTasks = okrs.reduce((sum, okr) =>
      sum + okr.tasks.filter(t => t.assignee).length, 0
    );
    const collaborationScore = totalTasks > 0 ? (assignedTasks / totalTasks) * 100 : 60;

    const totalEstimatedHours = okrs.reduce((sum, okr) =>
      sum + okr.tasks.reduce((s, t) => s + t.estimatedHours, 0), 0
    );
    const completedHours = okrs.reduce((sum, okr) =>
      sum + okr.tasks.filter(t => t.completed).reduce((s, t) => s + t.estimatedHours, 0), 0
    );
    const efficiencyScore = totalEstimatedHours > 0 ? (completedHours / totalEstimatedHours) * 100 : 50;

    const krCount = okrs.reduce((sum, okr) => sum + okr.keyResults.length, 0);
    const innovationScore = Math.min(100, 40 + krCount * 5);

    return [
      { name: '进度', value: Math.round(avgProgress), fullMark: 100 },
      { name: '质量', value: Math.round(taskCompletionRate), fullMark: 100 },
      { name: '协作', value: Math.round(collaborationScore), fullMark: 100 },
      { name: '效率', value: Math.round(efficiencyScore), fullMark: 100 },
      { name: '创新', value: Math.round(innovationScore), fullMark: 100 }
    ];
  }, [okrs]);

  return {
    okrs,
    loading,
    getOKRById,
    addOKR,
    updateTaskStatus,
    reorderTasks,
    addTask,
    assignTask,
    updateKRProgress,
    getRadarData
  };
}
