export interface TeamMember {
  id: string;
  name: string;
  timezone: string;
  avatarColor: string;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  startMinutes: number;
  durationMinutes: number;
  memberIds: string[];
}

export interface TimezoneOption {
  value: string;
  label: string;
  offset: number;
}

export interface ScheduleState {
  members: TeamMember[];
  events: ScheduleEvent[];
  currentTimezone: string;
  zoomLevel: number;
  addMember: (member: Omit<TeamMember, 'id' | 'avatarColor'>) => void;
  removeMember: (id: string) => void;
  addEvent: (event: Omit<ScheduleEvent, 'id'>) => void;
  removeEvent: (id: string) => void;
  updateEventTime: (id: string, startMinutes: number) => void;
  setTimezone: (timezone: string) => void;
  setZoom: (zoom: number) => void;
}
