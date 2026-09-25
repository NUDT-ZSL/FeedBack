import type { CanvasElement } from '../types';
import type { ClientMessage, Op, ServerMessage } from './protocol';
import { BoardState } from './merge';

/** Minimal socket shape shared by browser WebSocket and the `ws` package. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event?: unknown) => void) | null;
}

export interface SyncClientOptions {
  url: string;
  userId: string;
  createSocket?: (url: string) => WebSocketLike;
  reconnectDelayMs?: number;
  /** Called whenever the visible element set may have changed. */
  onChange?: (elements: CanvasElement[]) => void;
  /** Test/observability hook for every inbound server message. */
  onMessage?: (message: ServerMessage) => void;
}

const OPEN = 1;

/**
 * Client side of the versioned incremental sync protocol.
 *
 * - Local edits are applied optimistically and kept in a pending queue
 *   until the server acks them.
 * - On (re)connect the client sends `hello` with its last server version
 *   and receives either a catch-up op batch or a full snapshot; pending
 *   local ops are then rebased onto the fresh state and resent, so edits
 *   made while offline are never dropped.
 * - Duplicate / already-acked ops are ignored via version and opId
 *   checks; a version gap triggers a resync instead of silently
 *   diverging.
 */
export class SyncClient {
  readonly userId: string;
  private readonly options: SyncClientOptions;
  private state = new BoardState();
  private socket: WebSocketLike | null = null;
  private lamport = 0;
  private opCounter = 0;
  private lastVersion = -1;
  private syncedOnce = false;
  private pending = new Map<string, Op>();
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SyncClientOptions) {
    this.options = options;
    this.userId = options.userId;
  }

  get version(): number {
    return this.lastVersion;
  }

  get synced(): boolean {
    return this.syncedOnce;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  getElements(): CanvasElement[] {
    return this.state.getElements();
  }

  connect(): void {
    this.manualClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const factory =
      this.options.createSocket ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const socket = factory(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      const hello: ClientMessage = {
        type: 'hello',
        userId: this.userId,
        lastVersion: this.syncedOnce ? this.lastVersion : null,
      };
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.handleMessage(message);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.manualClose) this.scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    };
  }

  /** Disconnect without auto-reconnect (simulates going offline). */
  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  close(): void {
    this.disconnect();
  }
  addElement(element: CanvasElement): void {
    this.localOp({ kind: 'add', element });
  }

  updateElement(elementId: string, updates: Partial<CanvasElement>): void {
    this.localOp({ kind: 'update', elementId, updates });
  }

  deleteElement(elementId: string): void {
    this.localOp({ kind: 'delete', elementId });
  }

  private localOp(
    partial:
      | { kind: 'add'; element: CanvasElement }
      | { kind: 'update'; elementId: string; updates: Partial<CanvasElement> }
      | { kind: 'delete'; elementId: string },
  ): void {
    this.lamport++;
    this.opCounter++;
    const op = {
      ...partial,
      opId: `${this.userId}:${this.opCounter}:${Date.now()}`,
      userId: this.userId,
      lamport: this.lamport,
      baseVersion: Math.max(this.lastVersion, 0),
    } as Op;
    this.state.applyOp(op);
    this.pending.set(op.opId, op);
    this.sendOp(op);
    this.emitChange();
  }

  private sendOp(op: Op): void {
    if (this.socket && this.socket.readyState === OPEN) {
      const message: ClientMessage = { type: 'op', op };
      this.socket.send(JSON.stringify(message));
    }
  }

  private scheduleReconnect(): void {
    const delay = this.options.reconnectDelayMs ?? 500;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleMessage(message: ServerMessage): void {
    this.options.onMessage?.(message);
    switch (message.type) {
      case 'sync': {
        // Full snapshot: rebuild, then rebase our unacked local ops.
        this.state.loadSnapshot(message.elements);
        this.lastVersion = message.version;
        this.syncedOnce = true;
        this.rebasePending();
        this.resendPending();
        this.emitChange();
        break;
      }
      case 'synced': {
        this.lastVersion = message.version;
        this.syncedOnce = true;
        this.resendPending();
        break;
      }
      case 'catchup': {
        for (const entry of message.ops) this.applyRemote(entry.version, entry.op);
        this.lastVersion = message.version;
        this.syncedOnce = true;
        this.resendPending();
        this.emitChange();
        break;
      }
      case 'op': {
        this.applyRemote(message.version, message.op);
        break;
      }
      case 'ack': {
        this.pending.delete(message.opId);
        if (message.version > this.lastVersion) this.lastVersion = message.version;
        break;
      }
      case 'reject': {
        // Our base version was invalid (e.g. ahead of the server):
        // resync, then the resync handler resends pending ops.
        this.requestResync();
        break;
      }
      default:
        break; // presence messages: join/leave/users
    }
  }

  private applyRemote(version: number, op: Op): void {
    if (version <= this.lastVersion) return; // duplicate / rolled-back
    if (version > this.lastVersion + 1 && this.syncedOnce) {
      // Gap in the version stream: do not apply on a hole, resync first.
      this.requestResync();
      return;
    }
    if (this.pending.has(op.opId)) {
      // Our own op echoed back through another path: treat as ack.
      this.pending.delete(op.opId);
    }
    this.lamport = Math.max(this.lamport, op.lamport);
    const changed = this.state.applyOp(op);
    this.lastVersion = version;
    if (changed) this.emitChange();
  }

  private requestResync(): void {
    if (this.socket && this.socket.readyState === OPEN) {
      const hello: ClientMessage = {
        type: 'hello',
        userId: this.userId,
        lastVersion: this.syncedOnce ? this.lastVersion : null,
      };
      this.socket.send(JSON.stringify(hello));
    }
  }

  /** Re-apply unacked local ops on top of a fresh server snapshot. */
  private rebasePending(): void {
    for (const op of this.pending.values()) this.state.applyOp(op);
  }

  /** (Re)send all unacked ops with an up-to-date base version. */
  private resendPending(): void {
    for (const op of this.pending.values()) {
      op.baseVersion = Math.max(this.lastVersion, 0);
      this.sendOp(op);
    }
  }

  private emitChange(): void {
    this.options.onChange?.(this.state.getElements());
  }
}
