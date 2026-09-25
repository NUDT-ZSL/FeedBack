import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import {
  TextOperation,
  VersionVector,
  ChangeMessage,
  ChangeAckMessage,
  CursorMessage,
  JoinMessage,
  LeaveMessage,
  UserListMessage,
  SyncMessage,
  ErrorMessage,
  WSMessage,
  generateOpId,
  compareVersions,
  transformOperation,
  applyOperation,
  operationFromDiff,
} from '../../../shared/protocol';

interface RemoteUser {
  id: string;
  name: string;
  color: string;
  cursor: { line: number; column: number } | null;
  selection: { start: number; end: number } | null;
}

interface Version {
  id: string;
  timestamp: number;
  content: string;
  message: string;
}

interface PendingOperation {
  operation: TextOperation;
  message: ChangeMessage;
  retryCount: number;
  sentAt: number;
  timeoutId: number;
}

interface MarkdownEditorProps {
  documentId: string;
  userId: string;
  userName: string;
  wsUrl?: string;
}

const USER_COLORS = [
  'rgba(239, 68, 68, 0.7)',
  'rgba(59, 130, 246, 0.7)',
  'rgba(34, 197, 94, 0.7)',
  'rgba(168, 85, 247, 0.7)',
  'rgba(249, 115, 22, 0.7)',
  'rgba(236, 72, 153, 0.7)',
  'rgba(14, 165, 233, 0.7)',
  'rgba(234, 179, 8, 0.7)',
];

const DB_NAME = 'markdown-editor-db';
const STORE_NAME = 'documents';
const VERSION_STORE = 'versions';
const MAX_VERSIONS = 10;
const AUTO_SAVE_INTERVAL = 5000;
const ACK_TIMEOUT = 5000;
const MAX_RETRIES = 3;
const SAVE_TIMEOUT = 10000;

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  documentId,
  userId,
  userName,
  wsUrl = 'ws://localhost:8080',
}) => {
  const [content, setContent] = useState<string>('');
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [versions, setVersions] = useState<Version[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState<boolean>(false);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const dbRef = useRef<IDBDatabase | null>(null);

  const contentRef = useRef<string>('');
  const versionRef = useRef<number>(0);
  const vectorRef = useRef<VersionVector>({});
  const pendingOpsRef = useRef<PendingOperation[]>([]);
  const appliedOpIdsRef = useRef<Set<string>>(new Set());

  const saveQueueRef = useRef<Array<() => Promise<void>>>([]);
  const isSavingRef = useRef<boolean>(false);
  const saveTimeoutRef = useRef<number | null>(null);

  const userColor = useMemo(() => {
    const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return USER_COLORS[hash % USER_COLORS.length];
  }, [userId]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const initDB = useCallback((): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        dbRef.current = request.result;
        resolve(request.result);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'documentId' });
        }
        if (!db.objectStoreNames.contains(VERSION_STORE)) {
          const store = db.createObjectStore(VERSION_STORE, { keyPath: 'id', autoIncrement: false });
          store.createIndex('documentId', 'documentId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }, []);

  const loadFromDB = useCallback(async () => {
    try {
      const db = dbRef.current || (await initDB());
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(documentId);
      return new Promise<string | null>((resolve) => {
        request.onsuccess = () => {
          const data = request.result;
          resolve(data?.content || null);
        };
        request.onerror = () => resolve(null);
      });
    } catch (error) {
      console.error('Failed to load from DB:', error);
      return null;
    }
  }, [documentId, initDB]);

  const saveToDB = useCallback(async (newContent: string) => {
    try {
      const db = dbRef.current || (await initDB());
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put({ documentId, content: newContent, timestamp: Date.now() });
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save to DB:', error);
      throw error;
    }
  }, [documentId, initDB]);

  const loadVersions = useCallback(async () => {
    try {
      const db = dbRef.current || (await initDB());
      const transaction = db.transaction(VERSION_STORE, 'readonly');
      const store = transaction.objectStore(VERSION_STORE);
      const index = store.index('documentId');
      const request = index.getAll(IDBKeyRange.only(documentId));
      return new Promise<Version[]>((resolve) => {
        request.onsuccess = () => {
          const all = request.result as Version[];
          const sorted = all.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_VERSIONS);
          resolve(sorted);
        };
        request.onerror = () => resolve([]);
      });
    } catch (error) {
      console.error('Failed to load versions:', error);
      return [];
    }
  }, [documentId, initDB]);

  const saveVersion = useCallback(async (newContent: string, message?: string) => {
    try {
      const db = dbRef.current || (await initDB());
      const version: Version = {
        id: `${documentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        content: newContent,
        message: message || `保存于 ${new Date().toLocaleTimeString()}`,
      };
      const transaction = db.transaction(VERSION_STORE, 'readwrite');
      const store = transaction.objectStore(VERSION_STORE);
      store.put({ ...version, documentId });

      const allVersions = await loadVersions();
      if (allVersions.length >= MAX_VERSIONS) {
        const toDelete = allVersions.slice(MAX_VERSIONS - 1);
        const deleteTransaction = db.transaction(VERSION_STORE, 'readwrite');
        const deleteStore = deleteTransaction.objectStore(VERSION_STORE);
        toDelete.forEach((v) => deleteStore.delete(v.id));
      }
      setVersions(await loadVersions());
    } catch (error) {
      console.error('Failed to save version:', error);
      throw error;
    }
  }, [documentId, initDB, loadVersions]);

  const rollbackToVersion = useCallback((version: Version) => {
    setContent(version.content);
    contentRef.current = version.content;
    setSelectedVersion(null);
    setCompareMode(false);
    setShowVersionHistory(false);
  }, []);

  const sendMessage = useCallback((message: WSMessage) => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, []);

  const resendOperation = useCallback((pendingOp: PendingOperation) => {
    try {
      if (pendingOp.retryCount >= MAX_RETRIES) {
        console.warn('Max retries reached for operation:', pendingOp.operation.id);
        pendingOpsRef.current = pendingOpsRef.current.filter(p => p.operation.id !== pendingOp.operation.id);
        return;
      }

      pendingOp.retryCount++;
      pendingOp.sentAt = Date.now();
      sendMessage(pendingOp.message);

      pendingOp.timeoutId = window.setTimeout(() => {
        const op = pendingOpsRef.current.find(p => p.operation.id === pendingOp.operation.id);
        if (op) {
          resendOperation(op);
        }
      }, ACK_TIMEOUT);
    } catch (error) {
      console.error('Failed to resend operation:', error);
    }
  }, [sendMessage]);

  const sendChangeMessage = useCallback((operation: TextOperation) => {
    try {
      const message: ChangeMessage = {
        type: 'change',
        documentId,
        operation,
        currentVersion: versionRef.current,
        vector: { ...vectorRef.current },
      };

      const timeoutId = window.setTimeout(() => {
        const op = pendingOpsRef.current.find(p => p.operation.id === operation.id);
        if (op) {
          resendOperation(op);
        }
      }, ACK_TIMEOUT);

      const pendingOp: PendingOperation = {
        operation,
        message,
        retryCount: 0,
        sentAt: Date.now(),
        timeoutId,
      };

      pendingOpsRef.current.push(pendingOp);
      sendMessage(message);
    } catch (error) {
      console.error('Failed to send change message:', error);
    }
  }, [documentId, sendMessage, resendOperation]);

  const handleIncomingChange = useCallback((message: ChangeMessage) => {
    try {
      const { operation } = message;

      if (appliedOpIdsRef.current.has(operation.id)) {
        return;
      }

      if (operation.baseVersion > versionRef.current) {
        console.warn('Operation baseVersion ahead of local version, waiting for sync');
        return;
      }

      let transformed = operation;
      for (const pendingOp of pendingOpsRef.current) {
        const result = transformOperation(transformed, pendingOp.operation);
        if (result === null) {
          return;
        }
        transformed = result;
      }

      const newContent = applyOperation(contentRef.current, transformed);
      contentRef.current = newContent;
      setContent(newContent);

      appliedOpIdsRef.current.add(operation.id);

      if (appliedOpIdsRef.current.size > 1000) {
        const oldestIds = Array.from(appliedOpIdsRef.current).slice(0, 500);
        oldestIds.forEach(id => appliedOpIdsRef.current.delete(id));
      }
    } catch (error) {
      console.error('Failed to handle incoming change:', error);
    }
  }, []);

  const handleChangeAck = useCallback((message: ChangeAckMessage) => {
    try {
      const pendingIndex = pendingOpsRef.current.findIndex(
        p => p.operation.id === message.operationId
      );

      if (pendingIndex !== -1) {
        const pendingOp = pendingOpsRef.current[pendingIndex];
        window.clearTimeout(pendingOp.timeoutId);
        pendingOpsRef.current.splice(pendingIndex, 1);
      }

      if (message.applied) {
        versionRef.current = message.newVersion;
        vectorRef.current[userId] = message.newVersion;
      }
    } catch (error) {
      console.error('Failed to handle change ack:', error);
    }
  }, [userId]);

  const handleSync = useCallback((message: SyncMessage) => {
    try {
      contentRef.current = message.content;
      setContent(message.content);
      versionRef.current = message.version;
      vectorRef.current = { ...message.vector };

      pendingOpsRef.current.forEach(op => window.clearTimeout(op.timeoutId));
      pendingOpsRef.current = [];

      console.log(`Synced content, version: ${message.version}, reason: ${message.reason}`);
    } catch (error) {
      console.error('Failed to handle sync:', error);
    }
  }, []);

  const handleCursor = useCallback((message: CursorMessage) => {
    try {
      if (message.userId === userId) return;

      setRemoteUsers((prev) => {
        const existing = prev.find((u) => u.id === message.userId);
        if (existing) {
          return prev.map((u) =>
            u.id === message.userId ? { ...u, cursor: message.cursor, selection: message.selection } : u
          );
        }
        return [
          ...prev,
          {
            id: message.userId,
            name: message.userName || '用户',
            color: message.color || USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
            cursor: message.cursor,
            selection: message.selection,
          },
        ];
      });
    } catch (error) {
      console.error('Failed to handle cursor:', error);
    }
  }, [userId]);

  const handleUserList = useCallback((message: UserListMessage) => {
    try {
      setRemoteUsers(
        message.users
          .filter((u) => u.userId !== userId)
          .map((u) => ({
            id: u.userId,
            name: u.userName || '用户',
            color: u.color || USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
            cursor: u.cursor || null,
            selection: null,
          }))
      );
    } catch (error) {
      console.error('Failed to handle user list:', error);
    }
  }, [userId]);

  const handleUserLeave = useCallback((message: LeaveMessage) => {
    try {
      setRemoteUsers((prev) => prev.filter((u) => u.id !== message.userId));
    } catch (error) {
      console.error('Failed to handle user leave:', error);
    }
  }, []);

  const handleError = useCallback((message: ErrorMessage) => {
    console.error(`Server error [${message.code}]: ${message.message}`);
    if (message.operationId) {
      const pendingIndex = pendingOpsRef.current.findIndex(
        p => p.operation.id === message.operationId
      );
      if (pendingIndex !== -1) {
        const pendingOp = pendingOpsRef.current[pendingIndex];
        window.clearTimeout(pendingOp.timeoutId);
        pendingOpsRef.current.splice(pendingIndex, 1);
      }
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket(
        `${wsUrl}?documentId=${documentId}&userId=${userId}&userName=${encodeURIComponent(userName)}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        try {
          setIsConnected(true);
          const joinMessage: JoinMessage = {
            type: 'join',
            documentId,
            userId,
            userName,
            color: userColor,
            currentVersion: versionRef.current,
          };
          sendMessage(joinMessage);
        } catch (error) {
          console.error('Failed to send join message:', error);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'change':
              handleIncomingChange(data as ChangeMessage);
              break;
            case 'change-ack':
              handleChangeAck(data as ChangeAckMessage);
              break;
            case 'cursor':
              handleCursor(data as CursorMessage);
              break;
            case 'user-list':
              handleUserList(data as UserListMessage);
              break;
            case 'user-leave':
              handleUserLeave(data as LeaveMessage);
              break;
            case 'sync':
              handleSync(data as SyncMessage);
              break;
            case 'error':
              handleError(data as ErrorMessage);
              break;
          }
        } catch (error) {
          console.error('Failed to parse incoming message:', error);
        }
      };

      ws.onclose = () => {
        try {
          setIsConnected(false);
          setTimeout(connectWebSocket, 3000);
        } catch (error) {
          console.error('Reconnect error:', error);
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setIsConnected(false);
    }
  }, [wsUrl, documentId, userId, userName, userColor, sendMessage, handleIncomingChange, handleChangeAck, handleCursor, handleUserList, handleUserLeave, handleSync, handleError]);

  const syncCursor = useCallback(() => {
    try {
      const textarea = editorRef.current;
      if (!textarea || wsRef.current?.readyState !== WebSocket.OPEN) return;
      const { selectionStart, selectionEnd, value } = textarea;
      const textBefore = value.substring(0, selectionStart);
      const lines = textBefore.split('\n');
      const cursor = {
        line: lines.length - 1,
        column: lines[lines.length - 1].length,
      };
      const selection = selectionStart !== selectionEnd ? { start: selectionStart, end: selectionEnd } : null;

      const message: CursorMessage = {
        type: 'cursor',
        documentId,
        userId,
        userName,
        color: userColor,
        cursor,
        selection,
        timestamp: Date.now(),
      };
      sendMessage(message);
    } catch (error) {
      console.error('Failed to sync cursor:', error);
    }
  }, [documentId, userId, userName, userColor, sendMessage]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const newContent = e.target.value;
      const oldContent = contentRef.current;

      const operation = operationFromDiff(
        oldContent,
        newContent,
        userId,
        versionRef.current
      );

      if (operation) {
        sendChangeMessage(operation);
      }

      contentRef.current = newContent;
      setContent(newContent);
    } catch (error) {
      console.error('Failed to handle content change:', error);
    }
  }, [userId, sendChangeMessage]);

  const insertMarkdown = useCallback((prefix: string, suffix: string = '', placeholder: string = '') => {
    try {
      const textarea = editorRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd, value } = textarea;
      const selectedText = value.substring(selectionStart, selectionEnd) || placeholder;
      const newText = value.substring(0, selectionStart) + prefix + selectedText + suffix + value.substring(selectionEnd);

      const operation = operationFromDiff(
        contentRef.current,
        newText,
        userId,
        versionRef.current
      );

      if (operation) {
        sendChangeMessage(operation);
      }

      contentRef.current = newText;
      setContent(newText);

      setTimeout(() => {
        textarea.focus();
        const newCursor = selectionStart + prefix.length + selectedText.length;
        textarea.setSelectionRange(newCursor, newCursor);
        syncCursor();
      }, 0);
    } catch (error) {
      console.error('Failed to insert markdown:', error);
    }
  }, [userId, sendChangeMessage, syncCursor]);

  const insertLinePrefix = useCallback((prefix: string) => {
    try {
      const textarea = editorRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd, value } = textarea;
      const startLine = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const endLine = value.indexOf('\n', selectionEnd);
      const actualEnd = endLine === -1 ? value.length : endLine;
      const lines = value.substring(startLine, actualEnd).split('\n');
      const modifiedLines = lines.map((line) => prefix + line);
      const newText = value.substring(0, startLine) + modifiedLines.join('\n') + value.substring(actualEnd);

      const operation = operationFromDiff(
        contentRef.current,
        newText,
        userId,
        versionRef.current
      );

      if (operation) {
        sendChangeMessage(operation);
      }

      contentRef.current = newText;
      setContent(newText);

      setTimeout(() => {
        textarea.focus();
        syncCursor();
      }, 0);
    } catch (error) {
      console.error('Failed to insert line prefix:', error);
    }
  }, [userId, sendChangeMessage, syncCursor]);

  const processSaveQueue = useCallback(async () => {
    if (isSavingRef.current) return;
    if (saveQueueRef.current.length === 0) return;

    isSavingRef.current = true;

    saveTimeoutRef.current = window.setTimeout(() => {
      console.warn('Save operation timed out');
      isSavingRef.current = false;
    }, SAVE_TIMEOUT);

    try {
      while (saveQueueRef.current.length > 0) {
        const saveTask = saveQueueRef.current.shift();
        if (saveTask) {
          try {
            await saveTask();
          } catch (error) {
            console.error('Save task failed:', error);
          }
        }
      }
    } finally {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      isSavingRef.current = false;
    }
  }, []);

  const queueSave = useCallback((saveFn: () => Promise<void>) => {
    saveQueueRef.current.push(saveFn);
    processSaveQueue();
  }, [processSaveQueue]);

  const toolbarActions = useMemo(() => [
    { label: 'B', title: '加粗', action: () => insertMarkdown('**', '**', '粗体文字'), style: { fontWeight: 'bold' } },
    { label: 'I', title: '斜体', action: () => insertMarkdown('*', '*', '斜体文字'), style: { fontStyle: 'italic' } },
    { label: 'H1', title: '一级标题', action: () => insertLinePrefix('# ') },
    { label: 'H2', title: '二级标题', action: () => insertLinePrefix('## ') },
    { label: 'H3', title: '三级标题', action: () => insertLinePrefix('### ') },
    { label: '• 列表', title: '无序列表', action: () => insertLinePrefix('- ') },
    { label: '1. 列表', title: '有序列表', action: () => insertLinePrefix('1. ') },
    { label: '🔗 链接', title: '插入链接', action: () => insertMarkdown('[', '](https://)', '链接文字') },
    { label: '</> 代码', title: '代码块', action: () => insertMarkdown('\n```\n', '\n```\n', '代码') },
    { label: '🖼️ 图片', title: '插入图片', action: () => insertMarkdown('![', '](https://)', '图片描述') },
  ], [insertMarkdown, insertLinePrefix]);

  const getLineHeight = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return 24;
    const computed = window.getComputedStyle(textarea);
    return parseInt(computed.lineHeight) || 24;
  }, []);

  const getRemoteCursorPositions = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return [];
    const lineHeight = getLineHeight();
    const paddingLeft = 16;
    const paddingTop = 16;
    const charWidth = 8.4;
    return remoteUsers
      .filter((u) => u.cursor)
      .map((user) => {
        const cursor = user.cursor!;
        return {
          user,
          top: paddingTop + cursor.line * lineHeight,
          left: paddingLeft + cursor.column * charWidth,
        };
      });
  }, [remoteUsers, getLineHeight]);

  const computeDiff = useCallback((oldText: string, newText: string): { old: string[]; new: string[] } => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    return { old: oldLines, new: newLines };
  }, []);

  const renderedContent = useMemo(() => {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }, [content]);

  const remoteCursorPositions = useMemo(() => getRemoteCursorPositions(), [getRemoteCursorPositions]);

  useEffect(() => {
    const init = async () => {
      try {
        await initDB();
        const saved = await loadFromDB();
        if (saved) {
          contentRef.current = saved;
          setContent(saved);
        } else {
          const defaultContent = `# 欢迎使用 Markdown 编辑器

## 功能特性

- **实时协作**：多人同时编辑，毫秒级同步
- **版本历史**：自动保存最近10个版本
- **分屏预览**：左侧编辑，右侧实时预览

### 代码示例

\`\`\`typescript
function hello() {
  console.log('Hello, World!');
}
\`\`\`

> 💡 提示：开始输入即可体验！
`;
          contentRef.current = defaultContent;
          setContent(defaultContent);
        }
        setVersions(await loadVersions());
        connectWebSocket();
      } catch (error) {
        console.error('Initialization failed:', error);
      }
    };
    init();

    return () => {
      wsRef.current?.close();
      if (autoSaveTimerRef.current) window.clearInterval(autoSaveTimerRef.current);
      pendingOpsRef.current.forEach(op => window.clearTimeout(op.timeoutId));
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [initDB, loadFromDB, loadVersions, connectWebSocket]);

  useEffect(() => {
    autoSaveTimerRef.current = window.setInterval(() => {
      if (contentRef.current) {
        queueSave(() => saveToDB(contentRef.current));
      }
    }, AUTO_SAVE_INTERVAL);

    return () => {
      if (autoSaveTimerRef.current) window.clearInterval(autoSaveTimerRef.current);
    };
  }, [saveToDB, queueSave]);

  useEffect(() => {
    return () => {
      if (contentRef.current) {
        saveToDB(contentRef.current).catch(error => {
          console.error('Final save failed:', error);
        });
      }
    };
  }, [saveToDB]);

  const handleSaveVersion = useCallback(async () => {
    try {
      await saveVersion(contentRef.current);
    } catch (error) {
      console.error('Failed to save version:', error);
    }
  }, [saveVersion]);

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.3); opacity: 1; }
        }
        .remote-cursor-line {
          animation: cursor-blink 1s infinite;
        }
        .remote-user-dot {
          animation: pulse-dot 2s ease-in-out infinite;
        }
        .markdown-preview h1 { font-size: 2em; font-weight: bold; margin: 0.67em 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
        .markdown-preview h2 { font-size: 1.5em; font-weight: bold; margin: 0.83em 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
        .markdown-preview h3 { font-size: 1.25em; font-weight: bold; margin: 1em 0; }
        .markdown-preview p { margin: 1em 0; line-height: 1.7; }
        .markdown-preview ul, .markdown-preview ol { padding-left: 2em; margin: 1em 0; }
        .markdown-preview li { margin: 0.3em 0; }
        .markdown-preview code { background: #f3f4f6; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; }
        .markdown-preview pre { background: #1f2937; color: #f9fafb; padding: 1em; border-radius: 8px; overflow-x: auto; }
        .markdown-preview pre code { background: transparent; padding: 0; color: inherit; }
        .markdown-preview blockquote { border-left: 4px solid #10b981; padding-left: 1em; margin: 1em 0; color: #6b7280; background: #f0fdf4; padding: 0.5em 1em; border-radius: 0 8px 8px 0; }
        .markdown-preview a { color: #0ea5e9; text-decoration: underline; }
        .markdown-preview img { max-width: 100%; border-radius: 8px; }
        .markdown-preview table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        .markdown-preview th, .markdown-preview td { border: 1px solid #e5e7eb; padding: 0.5em 1em; }
        .markdown-preview th { background: #f9fafb; font-weight: bold; }
        @media (max-width: 768px) {
          .preview-panel { display: none !important; }
          .editor-panel { width: 100% !important; }
          .mobile-toggle { display: flex !important; }
        }
      `}</style>

      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>📝 Markdown 编辑器</h2>
          <div style={styles.connectionStatus}>
            <span style={{ ...styles.statusDot, background: isConnected ? '#10b981' : '#ef4444' }} />
            <span style={styles.statusText}>{isConnected ? '已连接' : '离线模式'}</span>
            {lastSaved && (
              <span style={styles.lastSaved}>
                💾 {lastSaved.toLocaleTimeString()} 自动保存
              </span>
            )}
          </div>
        </div>

        <div style={styles.headerRight}>
          {remoteUsers.length > 0 && (
            <div style={styles.remoteUsers}>
              {remoteUsers.map((user) => (
                <div key={user.id} style={styles.remoteUserBadge} title={user.name}>
                  <span className="remote-user-dot" style={{ ...styles.userDot, background: user.color }} />
                  <span style={styles.userName}>{user.name}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowVersionHistory(!showVersionHistory)}
            style={styles.headerButton}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            📚 版本历史
          </button>
          <button
            onClick={handleSaveVersion}
            style={styles.primaryButton}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            ⭐ 保存版本
          </button>
          <button
            className="mobile-toggle"
            onClick={() => setShowPreview(!showPreview)}
            style={{ ...styles.headerButton, display: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {showPreview ? '✏️ 编辑' : '👁️ 预览'}
          </button>
        </div>
      </div>

      <div style={styles.toolbar}>
        {toolbarActions.map((action, index) => (
          <button
            key={index}
            onClick={action.action}
            title={action.title}
            style={{ ...styles.toolbarButton, ...action.style }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div style={styles.mainContent}>
        <div className="editor-panel" style={{ ...styles.editorPanel, width: showPreview ? '50%' : '100%' }}>
          <div style={styles.editorWrapper}>
            <textarea
              ref={editorRef}
              value={content}
              onChange={handleContentChange}
              onSelect={syncCursor}
              onKeyUp={syncCursor}
              onClick={syncCursor}
              style={styles.textarea}
              placeholder="在这里输入 Markdown 内容..."
              spellCheck={false}
            />
            {remoteCursorPositions.map(({ user, top, left }) => (
              <div
                key={user.id}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: `${left}px`,
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                <div
                  className="remote-cursor-line"
                  style={{
                    position: 'absolute',
                    width: '2px',
                    height: '20px',
                    background: user.color,
                    left: 0,
                    top: 0,
                    borderRadius: '1px',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '-18px',
                    left: '0',
                    background: user.color,
                    color: 'white',
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}
                >
                  {user.name}
                </div>
                <div
                  className="remote-user-dot"
                  style={{
                    position: 'absolute',
                    width: '8px',
                    height: '8px',
                    background: user.color,
                    borderRadius: '50%',
                    left: '-3px',
                    top: '16px',
                    boxShadow: `0 0 6px ${user.color}`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {showPreview && (
          <div className="preview-panel" style={styles.previewPanel}>
            <div style={styles.previewHeader}>
              <span style={styles.previewTitle}>👁️ 实时预览</span>
            </div>
            <div
              className="markdown-preview"
              style={styles.previewContent}
              dangerouslySetInnerHTML={{ __html: renderedContent }}
            />
          </div>
        )}
      </div>

      {showVersionHistory && (
        <div style={styles.versionModal} onClick={() => setShowVersionHistory(false)}>
          <div style={styles.versionModalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>📚 版本历史</h3>
              <button style={styles.closeButton} onClick={() => setShowVersionHistory(false)}>
                ✕
              </button>
            </div>

            <div style={styles.versionListHeader}>
              <button
                style={{ ...styles.tabButton, background: !compareMode ? 'linear-gradient(135deg, #0ea5e9, #10b981)' : '#e5e7eb', color: !compareMode ? 'white' : '#374151' }}
                onClick={() => setCompareMode(false)}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                版本列表
              </button>
              {selectedVersion && (
                <button
                  style={{ ...styles.tabButton, background: compareMode ? 'linear-gradient(135deg, #0ea5e9, #10b981)' : '#e5e7eb', color: compareMode ? 'white' : '#374151' }}
                  onClick={() => setCompareMode(true)}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  对比当前
                </button>
              )}
            </div>

            {compareMode && selectedVersion ? (
              <div style={styles.compareContainer}>
                <div style={styles.comparePanel}>
                  <div style={styles.compareLabel}>📜 {selectedVersion.message}</div>
                  <pre style={styles.compareContentOld}>
                    {computeDiff(selectedVersion.content, content).old.join('\n')}
                  </pre>
                </div>
                <div style={styles.comparePanel}>
                  <div style={styles.compareLabel}>✨ 当前版本</div>
                  <pre style={styles.compareContentNew}>
                    {computeDiff(selectedVersion.content, content).new.join('\n')}
                  </pre>
                </div>
              </div>
            ) : (
              <div style={styles.versionList}>
                {versions.length === 0 ? (
                  <div style={styles.emptyState}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
                    <p style={styles.emptyText}>暂无保存的版本</p>
                    <p style={styles.emptySubtext}>点击"保存版本"按钮创建第一个版本</p>
                  </div>
                ) : (
                  versions.map((version) => (
                    <div
                      key={version.id}
                      style={{
                        ...styles.versionItem,
                        borderColor: selectedVersion?.id === version.id ? '#0ea5e9' : '#e5e7eb',
                        background: selectedVersion?.id === version.id ? '#f0f9ff' : 'white',
                      }}
                      onClick={() => setSelectedVersion(selectedVersion?.id === version.id ? null : version)}
                    >
                      <div style={styles.versionInfo}>
                        <div style={styles.versionMessage}>{version.message}</div>
                        <div style={styles.versionDate}>
                          📅 {new Date(version.timestamp).toLocaleString()}
                        </div>
                      </div>
                      {selectedVersion?.id === version.id && (
                        <button
                          style={styles.rollbackButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            rollbackToVersion(version);
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                        >
                          ↩️ 回滚到此版本
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100%',
    background: '#f1f5f9',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    background: 'white',
    borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    flexWrap: 'wrap',
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    color: '#1e293b',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  statusText: {
    color: '#6b7280',
    fontWeight: 500,
  },
  lastSaved: {
    color: '#9ca3af',
    marginLeft: '8px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  remoteUsers: {
    display: 'flex',
    gap: '8px',
    marginRight: '8px',
  },
  remoteUserBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    background: '#f8fafc',
    borderRadius: '20px',
    border: '1px solid #e5e7eb',
  },
  userDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  userName: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#4b5563',
  },
  headerButton: {
    padding: '8px 16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    transition: 'all 0.2s ease',
  },
  primaryButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #0ea5e9, #10b981)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: 'white',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)',
  },
  toolbar: {
    display: 'flex',
    gap: '4px',
    padding: '12px 24px',
    background: 'white',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap',
  },
  toolbarButton: {
    padding: '6px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#4b5563',
    transition: 'all 0.2s ease',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    padding: '16px',
    gap: '16px',
  },
  editorPanel: {
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.3s ease',
  },
  editorWrapper: {
    position: 'relative',
    flex: 1,
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
    overflow: 'hidden',
  },
  textarea: {
    width: '100%',
    height: '100%',
    padding: '16px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
    fontSize: '14px',
    lineHeight: '1.6',
    color: '#1e293b',
    background: 'transparent',
    boxSizing: 'border-box',
  },
  previewPanel: {
    width: '50%',
    display: 'flex',
    flexDirection: 'column',
    background: '#f8f9fa',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
    overflow: 'hidden',
    transition: 'width 0.3s ease',
  },
  previewHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    background: 'white',
  },
  previewTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4b5563',
  },
  previewContent: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto',
    color: '#1e293b',
  },
  versionModal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  versionModalContent: {
    background: 'white',
    borderRadius: '16px',
    width: '90%',
    maxWidth: '900px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e5e7eb',
  },
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: '#1e293b',
  },
  closeButton: {
    width: '32px',
    height: '32px',
    border: 'none',
    background: '#f3f4f6',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    color: '#6b7280',
    transition: 'all 0.2s',
  },
  versionListHeader: {
    display: 'flex',
    gap: '8px',
    padding: '16px 24px',
    borderBottom: '1px solid #e5e7eb',
  },
  tabButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    transition: 'all 0.2s',
  },
  versionList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    textAlign: 'center',
  },
  emptyText: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: '#374151',
  },
  emptySubtext: {
    margin: '8px 0 0 0',
    fontSize: '14px',
    color: '#9ca3af',
  },
  versionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    marginBottom: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  versionInfo: {
    flex: 1,
  },
  versionMessage: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: '4px',
  },
  versionDate: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  rollbackButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #0ea5e9, #10b981)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    color: 'white',
    transition: 'all 0.2s',
    boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)',
    whiteSpace: 'nowrap',
  },
  compareContainer: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    borderTop: '1px solid #e5e7eb',
  },
  comparePanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  compareLabel: {
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#4b5563',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  compareContentOld: {
    flex: 1,
    margin: 0,
    padding: '16px',
    overflow: 'auto',
    fontSize: '12px',
    lineHeight: '1.6',
    fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
    background: '#fef2f2',
    color: '#991b1b',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  compareContentNew: {
    flex: 1,
    margin: 0,
    padding: '16px',
    overflow: 'auto',
    fontSize: '12px',
    lineHeight: '1.6',
    fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
    background: '#f0fdf4',
    color: '#166534',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

export default MarkdownEditor;
