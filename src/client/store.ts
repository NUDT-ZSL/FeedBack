import { create } from 'zustand'

interface User {
  id: string
  username: string
  password?: string
  avatar?: string
  createdAt: string
}

interface Pet {
  id: string
  ownerId: string
  name: string
  breed: string
  age: string
  personality: string
  photo: string
  availableForBorrow: boolean
  availableForAdoption: boolean
  createdAt: string
}

interface Item {
  id: string
  ownerId: string
  name: string
  image: string
  condition: string
  location: string
  availableForBorrow: boolean
  createdAt: string
}

interface Application {
  id: string
  type: 'borrow' | 'adopt'
  targetType: 'pet' | 'item'
  targetId: string
  targetName: string
  applicantId: string
  applicantName: string
  ownerId: string
  reason: string
  contact: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

interface Notification {
  id: string
  userId: string
  type: 'application_received' | 'application_approved' | 'application_rejected'
  applicationId: string
  message: string
  read: boolean
  createdAt: string
}

interface Comment {
  id: string
  targetType: 'pet' | 'item'
  targetId: string
  userId: string
  username: string
  content: string
  parentId: string | null
  likes: string[]
  createdAt: string
}

interface AppState {
  currentUser: User | null
  users: User[]
  pets: Pet[]
  items: Item[]
  notifications: Notification[]
  comments: Comment[]
  applications: Application[]
  login: (username: string, password: string) => Promise<User>
  register: (username: string, password: string) => Promise<User>
  logout: () => void
  fetchUsers: () => Promise<void>
  fetchPets: () => Promise<void>
  fetchItems: () => Promise<void>
  fetchNotifications: () => Promise<void>
  fetchComments: (targetType: string, targetId: string) => Promise<void>
  fetchApplications: () => Promise<void>
  submitApplication: (app: Omit<Application, 'id' | 'createdAt' | 'status'>) => Promise<Application>
  handleApplication: (appId: string, status: 'approved' | 'rejected') => Promise<void>
  addComment: (comment: Omit<Comment, 'id' | 'createdAt' | 'likes'>) => Promise<void>
  toggleLike: (commentId: string) => Promise<void>
  markNotificationRead: (notificationId: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
}

export type { User, Pet, Item, Application, Notification, Comment }

export const useStore = create<AppState>((set, get) => ({
  currentUser: null,
  users: [],
  pets: [],
  items: [],
  notifications: [],
  comments: [],
  applications: [],

  login: async (username: string, password: string) => {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '登录失败')
    }
    const data = await res.json()
    const user = data.user as User
    set({ currentUser: user })
    return user
  },

  register: async (username: string, password: string) => {
    const res = await fetch('/api/users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '注册失败')
    }
    const data = await res.json()
    const user = data.user as User
    set({ currentUser: user })
    return user
  },

  logout: () => {
    set({ currentUser: null, notifications: [], pets: [], items: [], comments: [], applications: [], users: [] })
  },

  fetchUsers: async () => {
    const res = await fetch('/api/users')
    const data = await res.json()
    set({ users: Array.isArray(data) ? data : [] })
  },

  fetchPets: async () => {
    const res = await fetch('/api/pets')
    const data = await res.json()
    set({ pets: Array.isArray(data) ? data : [] })
  },

  fetchItems: async () => {
    const res = await fetch('/api/items')
    const data = await res.json()
    set({ items: Array.isArray(data) ? data : [] })
  },

  fetchNotifications: async () => {
    const { currentUser } = get()
    if (!currentUser) return
    const res = await fetch(`/api/notifications?userId=${currentUser.id}`)
    const data = await res.json()
    set({ notifications: Array.isArray(data) ? data : [] })
  },

  fetchComments: async (targetType: string, targetId: string) => {
    const res = await fetch(`/api/comments?targetType=${targetType}&targetId=${targetId}`)
    const data = await res.json()
    set({ comments: Array.isArray(data) ? data : [] })
  },

  fetchApplications: async () => {
    const { currentUser } = get()
    if (!currentUser) return
    const res = await fetch(`/api/applications?applicantId=${currentUser.id}`)
    const data = await res.json()
    set({ applications: Array.isArray(data) ? data : [] })
  },

  submitApplication: async (app) => {
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(app),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '申请失败')
    }
    const application = await res.json()
    set((state) => ({ applications: [...state.applications, application] }))
    return application
  },

  handleApplication: async (appId, status) => {
    const res = await fetch(`/api/applications/${appId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '操作失败')
    }
    const updated = await res.json()
    set((state) => ({
      applications: state.applications.map((a) =>
        a.id === appId ? updated : a
      ),
    }))
    await get().fetchNotifications()
  },

  addComment: async (comment) => {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comment),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '评论失败')
    }
    const newComment = await res.json()
    set((state) => ({ comments: [...state.comments, newComment] }))
  },

  toggleLike: async (commentId) => {
    const { currentUser } = get()
    if (!currentUser) return
    const res = await fetch(`/api/comments/${commentId}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id }),
    })
    if (!res.ok) return
    const updated = await res.json()
    set((state) => ({
      comments: state.comments.map((c) =>
        c.id === commentId ? updated : c
      ),
    }))
  },

  markNotificationRead: async (notificationId) => {
    const res = await fetch(`/api/notifications/${notificationId}/read`, {
      method: 'PUT',
    })
    if (!res.ok) return
    const updated = await res.json()
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === notificationId ? updated : n
      ),
    }))
  },

  markAllNotificationsRead: async () => {
    const { notifications } = get()
    const unread = notifications.filter((n) => !n.read)
    for (const n of unread) {
      await get().markNotificationRead(n.id)
    }
  },
}))
