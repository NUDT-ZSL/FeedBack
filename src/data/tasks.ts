import type { Task, Feedback } from '../types';

const STORAGE_KEY = 'volunteer_tasks_state';

const mockTasks: Task[] = [
  {
    id: 't1',
    title: '社区垃圾分类宣传活动',
    category: 'environmental',
    location: '阳光社区活动中心',
    requiredCount: 5,
    claimedCount: 2,
    description: '向社区居民普及垃圾分类知识，发放宣传手册，指导正确分类方法。活动时间为周六上午9点至11点。',
    createdAt: Date.now() - 86400000 * 2,
    isClaimed: false
  },
  {
    id: 't2',
    title: '独居老人定期探访',
    category: 'elderly',
    location: '幸福小区3号楼',
    requiredCount: 2,
    claimedCount: 0,
    description: '每周三下午探访小区内的独居老人，陪他们聊天、读报，帮助解决生活中的小问题。',
    createdAt: Date.now() - 86400000 * 1,
    isClaimed: false
  },
  {
    id: 't3',
    title: '留守儿童课业辅导',
    category: 'education',
    location: '希望小学',
    requiredCount: 4,
    claimedCount: 1,
    description: '每周六下午为留守儿童提供数学、英语等课业辅导，帮助他们跟上学习进度。',
    createdAt: Date.now() - 86400000 * 3,
    isClaimed: false
  },
  {
    id: 't4',
    title: '公园环境清洁行动',
    category: 'environmental',
    location: '城市中央公园',
    requiredCount: 8,
    claimedCount: 3,
    description: '清理公园内的垃圾杂物，维护公共环境整洁。活动时间为周日上午8点至10点。',
    createdAt: Date.now() - 86400000 * 0.5,
    isClaimed: false
  },
  {
    id: 't5',
    title: '敬老院文艺表演',
    category: 'elderly',
    location: '夕阳红敬老院',
    requiredCount: 6,
    claimedCount: 4,
    description: '为敬老院的老人们准备一场小型文艺演出，包括唱歌、跳舞、小品等节目。',
    createdAt: Date.now() - 86400000 * 4,
    isClaimed: false
  },
  {
    id: 't6',
    title: '图书馆阅读推广志愿',
    category: 'education',
    location: '市图书馆儿童区',
    requiredCount: 3,
    claimedCount: 2,
    description: '协助图书馆开展儿童阅读推广活动，为小朋友讲故事、推荐好书。',
    createdAt: Date.now() - 86400000 * 1.5,
    isClaimed: false
  },
  {
    id: 't7',
    title: '社区绿化种植活动',
    category: 'environmental',
    location: '和谐社区绿化带',
    requiredCount: 10,
    claimedCount: 5,
    description: '参与社区公共区域的绿化种植工作，栽种花草树木，美化居住环境。',
    createdAt: Date.now() - 86400000 * 0.2,
    isClaimed: false
  },
  {
    id: 't8',
    title: '老年人智能手机教学',
    category: 'elderly',
    location: '福寿社区活动室',
    requiredCount: 3,
    claimedCount: 1,
    description: '帮助社区老年人学习使用智能手机，包括微信视频、健康码、打车等实用功能。',
    createdAt: Date.now() - 86400000 * 2.5,
    isClaimed: false
  },
  {
    id: 't9',
    title: '贫困学生结对帮扶',
    category: 'education',
    location: '远程/线下灵活安排',
    requiredCount: 5,
    claimedCount: 0,
    description: '与家庭困难的学生建立长期结对帮扶关系，提供学业辅导和心理关怀。',
    createdAt: Date.now() - 86400000 * 5,
    isClaimed: false
  }
];

function loadFromStorage(): Task[] | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as Task[];
    }
  } catch (e) {
    console.error('Failed to load tasks from storage:', e);
  }
  return null;
}

function saveToStorage(tasks: Task[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error('Failed to save tasks to storage:', e);
  }
}

function mergeWithStored(baseTasks: Task[]): Task[] {
  const stored = loadFromStorage();
  if (!stored) return baseTasks;

  const storedMap = new Map(stored.map(t => [t.id, t]));
  return baseTasks.map(base => {
    const storedTask = storedMap.get(base.id);
    if (storedTask) {
      return {
        ...base,
        isClaimed: storedTask.isClaimed,
        claimedCount: storedTask.claimedCount,
        feedback: storedTask.feedback
      };
    }
    return base;
  });
}

export function getInitialTasks(): Task[] {
  const merged = mergeWithStored(mockTasks);
  return [...merged].sort((a, b) => b.createdAt - a.createdAt);
}

export function claimTask(tasks: Task[], taskId: string): Task[] {
  const updated = tasks.map(task => {
    if (task.id === taskId && !task.isClaimed) {
      return {
        ...task,
        isClaimed: true,
        claimedCount: Math.min(task.claimedCount + 1, task.requiredCount)
      };
    }
    return task;
  });
  saveToStorage(updated);
  return updated;
}

export function submitFeedback(tasks: Task[], taskId: string, feedback: Omit<Feedback, 'id' | 'taskId' | 'submittedAt'>): Task[] {
  const updated = tasks.map(task => {
    if (task.id === taskId) {
      const newFeedback: Feedback = {
        id: `fb_${Date.now()}`,
        taskId,
        description: feedback.description,
        imageUrl: feedback.imageUrl,
        submittedAt: Date.now()
      };
      return {
        ...task,
        feedback: newFeedback
      };
    }
    return task;
  });
  saveToStorage(updated);
  return updated;
}
