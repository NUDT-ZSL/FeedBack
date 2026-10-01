import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  avatar: string;
  roomId: string;
}

interface Room {
  id: string;
  status: string;
  users: User[];
  currentQuestion: unknown;
}

interface Match {
  id: string;
  winner: string;
  loser: string;
  timestamp: number;
}

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

interface Toast {
  show: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface Invite {
  show: boolean;
  inviter: User | null;
  roomId: string;
}

interface StoreState {
  user: User | null;
  currentRoom: Room | null;
  matchResults: Match[];
  messages: Message[];
  chatPartner: User | null;
  toast: Toast;
  invite: Invite;
  setUser: (user: User | null) => void;
  setRoom: (room: Room | null) => void;
  addMessage: (message: Message) => void;
  setMatches: (matches: Match[]) => void;
  showToast: (message: string, type: Toast['type']) => void;
  hideToast: () => void;
  showInvite: (inviter: User, roomId: string) => void;
  hideInvite: () => void;
  setChatPartner: (partner: User | null) => void;
}

export const useStore = create<StoreState>((set) => ({
  user: null,
  currentRoom: null,
  matchResults: [],
  messages: [],
  chatPartner: null,
  toast: {
    show: false,
    message: '',
    type: 'info'
  },
  invite: {
    show: false,
    inviter: null,
    roomId: ''
  },
  setUser: (user) => set({ user }),
  setRoom: (room) => set({ currentRoom: room }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  setMatches: (matches) => set({ matchResults: matches }),
  showToast: (message, type) => set({
    toast: { show: true, message, type }
  }),
  hideToast: () => set({
    toast: { show: false, message: '', type: 'info' }
  }),
  showInvite: (inviter, roomId) => set({
    invite: { show: true, inviter, roomId }
  }),
  hideInvite: () => set({
    invite: { show: false, inviter: null, roomId: '' }
  }),
  setChatPartner: (partner) => set({ chatPartner: partner })
}));
