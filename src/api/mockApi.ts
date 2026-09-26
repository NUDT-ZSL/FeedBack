import type { TeamMember, ScheduleEvent } from '../types';

export async function fetchInitialMembers(): Promise<TeamMember[]> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return [
    {
      id: 'm1',
      name: '张伟',
      timezone: 'UTC+8',
      avatarColor: 'hsl(240, 60%, 50%)',
    },
    {
      id: 'm2',
      name: 'John Smith',
      timezone: 'UTC-8',
      avatarColor: 'hsl(200, 60%, 50%)',
    },
    {
      id: 'm3',
      name: 'Emma Wilson',
      timezone: 'UTC+0',
      avatarColor: 'hsl(280, 60%, 50%)',
    },
  ];
}

export async function fetchInitialEvents(): Promise<ScheduleEvent[]> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return [
    {
      id: 'e1',
      title: '每日站会',
      startMinutes: 9 * 60,
      durationMinutes: 30,
      memberIds: ['m1', 'm2', 'm3'],
    },
    {
      id: 'e2',
      title: '产品评审',
      startMinutes: 14 * 60,
      durationMinutes: 60,
      memberIds: ['m1', 'm3'],
    },
  ];
}
