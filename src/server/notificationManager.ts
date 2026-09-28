import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { Notification, User, Plant, LeaderboardEntry } from './types';

export class NotificationManager {
  private notifications: Map<string, Notification[]> = new Map();
  private wsConnections: Map<string, WebSocket[]> = new Map();
  private subscriptionMap: Map<string, Set<string>> = new Map();
  private lastPlantsUpdate: Map<string, number> = new Map();
  private lastLeaderboardUpdate: number = 0;
  private users: Map<string, User> = new Map();

  setUsers(users: Map<string, User>): void {
    this.users = users;
  }

  addConnection(userId: string, ws: WebSocket): void {
    const connections = this.wsConnections.get(userId) || [];
    if (!connections.includes(ws)) {
      connections.push(ws);
      this.wsConnections.set(userId, connections);
    }
  }

  removeConnection(userId: string, ws: WebSocket): void {
    const connections = this.wsConnections.get(userId) || [];
    const filtered = connections.filter((conn) => conn !== ws);
    if (filtered.length === 0) {
      this.wsConnections.delete(userId);
    } else {
      this.wsConnections.set(userId, filtered);
    }
  }

  subscribe(userId: string, targetUserId: string): void {
    const subscriptions = this.subscriptionMap.get(userId) || new Set();
    subscriptions.add(targetUserId);
    this.subscriptionMap.set(userId, subscriptions);
  }

  unsubscribe(userId: string, targetUserId: string): void {
    const subscriptions = this.subscriptionMap.get(userId);
    if (subscriptions) {
      subscriptions.delete(targetUserId);
      if (subscriptions.size === 0) {
        this.subscriptionMap.delete(userId);
      }
    }
  }

  sendNotification(userId: string, notification: Notification): void {
    this.addNotification(userId, notification);
    const connections = this.wsConnections.get(userId) || [];
    const message = JSON.stringify({
      type: 'notification',
      payload: notification,
    });
    connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  addNotification(userId: string, notification: Notification): void {
    const userNotifications = this.notifications.get(userId) || [];
    userNotifications.unshift(notification);
    this.notifications.set(userId, userNotifications.slice(0, 100));
  }

  broadcastPlantsUpdate(targetUserId: string, plants: Plant[]): void {
    const now = Date.now();
    const lastUpdate = this.lastPlantsUpdate.get(targetUserId) || 0;
    if (now - lastUpdate < 2000) {
      return;
    }
    this.lastPlantsUpdate.set(targetUserId, now);

    const message = JSON.stringify({
      type: 'plants_update',
      targetUserId,
      payload: plants,
    });

    for (const [userId, subscriptions] of this.subscriptionMap.entries()) {
      if (subscriptions.has(targetUserId)) {
        const connections = this.wsConnections.get(userId) || [];
        connections.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }
    }

    const ownerConnections = this.wsConnections.get(targetUserId) || [];
    ownerConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  broadcastLeaderboard(leaderboard: LeaderboardEntry[]): void {
    const now = Date.now();
    if (now - this.lastLeaderboardUpdate < 30000) {
      return;
    }
    this.lastLeaderboardUpdate = now;

    const message = JSON.stringify({
      type: 'leaderboard',
      payload: leaderboard,
    });

    for (const connections of this.wsConnections.values()) {
      connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  getNotifications(userId: string): Notification[] {
    return this.notifications.get(userId) || [];
  }

  createNotification(
    userId: string,
    type: Notification['type'],
    message: string,
    fromUserId: string,
    plantId?: string
  ): Notification {
    const fromUser = this.users.get(fromUserId);
    return {
      id: uuidv4(),
      userId,
      type,
      message,
      timestamp: Date.now(),
      fromUserId,
      fromUsername: fromUser?.username || '用户',
      plantId,
    };
  }
}
