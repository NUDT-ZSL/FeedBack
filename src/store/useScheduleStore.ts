import { create } from 'zustand';
import type { ScheduleState, TeamMember, ScheduleEvent } from '../types';
import { getMemberColor } from '../utils/color';
import { fetchInitialMembers, fetchInitialEvents } from '../api/mockApi';

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  members: [],
  events: [],
  currentTimezone: 'UTC+8',
  zoomLevel: 1,

  addMember: (memberData) => {
    const { members } = get();
    const newMember: TeamMember = {
      ...memberData,
      id: generateId(),
      avatarColor: getMemberColor(members.length),
    };
    set({ members: [...members, newMember] });
  },

  removeMember: (id) => {
    const { members, events } = get();
    set({
      members: members.filter((m) => m.id !== id),
      events: events.map((e) => ({
        ...e,
        memberIds: e.memberIds.filter((mid) => mid !== id),
      })).filter((e) => e.memberIds.length > 0),
    });
  },

  addEvent: (eventData) => {
    const { events } = get();
    const newEvent: ScheduleEvent = {
      ...eventData,
      id: generateId(),
    };
    set({ events: [...events, newEvent] });
  },

  removeEvent: (id) => {
    const { events } = get();
    set({ events: events.filter((e) => e.id !== id) });
  },

  updateEventTime: (id, startMinutes) => {
    const { events } = get();
    set({
      events: events.map((e) =>
        e.id === id ? { ...e, startMinutes: Math.max(0, Math.min(1440 - e.durationMinutes, startMinutes)) } : e
      ),
    });
  },

  setTimezone: (timezone) => {
    set({ currentTimezone: timezone });
  },

  setZoom: (zoom) => {
    set({ zoomLevel: Math.max(0.5, Math.min(2, zoom)) });
  },
}));

export async function initializeStore(): Promise<void> {
  const [members, events] = await Promise.all([
    fetchInitialMembers(),
    fetchInitialEvents(),
  ]);
  useScheduleStore.setState({ members, events });
}
