import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Loader2, Save } from 'lucide-react';
import DirectoryTree, { TreeNode } from '../components/DirectoryTree';
import MarkdownEditor from '../components/MarkdownEditor';
import { withErrorBoundary } from '../components/withErrorBoundary';
import {
  getDocument,
  updateDocument,
  getDirectories,
  getDocuments,
  createDirectory,
  updateDirectory,
  deleteDirectory,
  createDocument,
} from '../services/api';

interface UserData {
  id: string;
  username: string;
  createdAt?: string;
}

interface DocumentData {
  id: string;
  title: string;
  directoryId: string | null;
  content: string;
  version: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface OnlineUser {
  id: string;
  name: string;
  color: string;
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

const Editor: React.FC = () => {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [titleInput, setTitleInput] = useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [savingTitle, setSavingTitle] = useState<boolean>(false);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  const userRef = useRef<UserData | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        userRef.current = JSON.parse(userStr) as UserData;
      } catch {
        userRef.current = null;
      }
    }
    tokenRef.current = localStorage.getItem('token');
  }, []);

  useEffect(() => {
    if (docId) {
      setSelectedId(docId);
    }
  }, [docId]);

  const buildTreeData = (
    directories: Array<{ id: string; name: string; parentId: string | null }>,
    docs: Array<{ id: string; title: string; directoryId: string | null }>,
  ): TreeNode[] => {
    const dirMap = new Map<string, TreeNode>();
    const rootDirs: TreeNode[] = [];

    for (const dir of directories) {
      dirMap.set(dir.id, {
        id: dir.id,
        name: dir.name,
        type: 'folder',
        parentId: dir.parentId,
        children: [],
      });
    }

    for (const dir of directories) {
      const node = dirMap.get(dir.id)!;
      if (dir.parentId && dirMap.has(dir.parentId)) {
        dirMap.get(dir.parentId)!.children!.push(node);
      } else {
        rootDirs.push(node);
      }
    }

    for (const doc of docs) {
      const fileNode: TreeNode = {
        id: doc.id,
        name: doc.title,
        type: 'file',
        parentId: doc.directoryId,
      };
      if (doc.directoryId && dirMap.has(doc.directoryId)) {
        dirMap.get(doc.directoryId)!.children!.push(fileNode);
      } else {
        rootDirs.push(fileNode);
      }
    }

    return rootDirs;
  };

  const loadData = async () => {
    if (!docId) return;

    setLoading(true);
    try {
      const [doc, dirs, docs] = await Promise.all([
        getDocument(docId),
        getDirectories(),
        getDocuments(),
      ]);

      setDocument(doc as DocumentData);
      setTitleInput(doc.title);
      setTreeData(buildTreeData(dirs, docs));
    } catch (err) {
      console.error('加载文档失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [docId]);

  const handleTitleBlur = async () => {
    if (!document || !titleInput.trim() || titleInput === document.title) {
      setTitleInput(document?.title ?? '');
      setIsEditingTitle(false);
      return;
    }

    setSavingTitle(true);
    try {
      const updated = await updateDocument(document.id, { title: titleInput.trim() });
      setDocument(updated as DocumentData);
      setTreeData((prev) => updateTreeNodeName(prev, document.id, titleInput.trim()));
    } catch (err) {
      console.error('保存标题失败:', err);
      setTitleInput(document.title);
    } finally {
      setSavingTitle(false);
      setIsEditingTitle(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Escape') {
      setTitleInput(document?.title ?? '');
      setIsEditingTitle(false);
    }
  };

  const updateTreeNodeName = (
    nodes: TreeNode[],
    targetId: string,
    newName: string,
  ): TreeNode[] => {
    return nodes.map((node) => {
      if (node.id === targetId) {
        return { ...node, name: newName };
      }
      if (node.children) {
        return { ...node, children: updateTreeNodeName(node.children, targetId, newName) };
      }
      return node;
    });
  };

  const handleTreeSelect = async (node: TreeNode) => {
    if (node.type === 'file' && node.id !== docId) {
      navigate(`/editor/${node.id}`);
    }
  };

  const handleTreeAdd = async (parentId: string | null, type: 'folder' | 'file') => {
    try {
      if (type === 'folder') {
        const newDir = await createDirectory('新建文件夹', parentId);
        const [dirs, docs] = await Promise.all([getDirectories(), getDocuments()]);
        setTreeData(buildTreeData(dirs, docs));
        setSelectedId(newDir.id);
      } else {
        const newDoc = await createDocument({
          title: '未命名文档',
          directoryId: parentId,
          content: '',
        });
        const [dirs, docs] = await Promise.all([getDirectories(), getDocuments()]);
        setTreeData(buildTreeData(dirs, docs));
        navigate(`/editor/${newDoc.id}`);
      }
    } catch (err) {
      console.error('创建失败:', err);
    }
  };

  const handleTreeDelete = async (id: string) => {
    try {
      const node = findNodeInTree(treeData, id);
      if (!node) return;

      if (node.type === 'folder') {
        await deleteDirectory(id);
      } else {
        return;
      }
      const [dirs, docs] = await Promise.all([getDirectories(), getDocuments()]);
      setTreeData(buildTreeData(dirs, docs));
      if (selectedId === id) {
        setSelectedId(null);
      }
    } catch (err) {
      console.error('删除失败:', err);
    }
  };

  const handleTreeRename = async (id: string, newName: string) => {
    try {
      const node = findNodeInTree(treeData, id);
      if (!node) return;

      if (node.type === 'folder') {
        await updateDirectory(id, { name: newName });
      } else {
        await updateDocument(id, { title: newName });
        if (id === docId) {
          setTitleInput(newName);
          setDocument((prev) => (prev ? { ...prev, title: newName } : null));
        }
      }
      const [dirs, docs] = await Promise.all([getDirectories(), getDocuments()]);
      setTreeData(buildTreeData(dirs, docs));
    } catch (err) {
      console.error('重命名失败:', err);
    }
  };

  const findNodeInTree = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNodeInTree(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const userColor = (id: string): string => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return USER_COLORS[hash % USER_COLORS.length];
  };

  const currentUser = userRef.current;
  const token = tokenRef.current;
  const wsUrl = token ? `ws://localhost:3001/ws?token=${encodeURIComponent(token)}` : 'ws://localhost:3001/ws';

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: '#0ea5e9' }} />
        <p style={styles.loadingText}>加载中...</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!document || !currentUser) {
    return (
      <div style={styles.loadingContainer}>
        <p style={styles.loadingText}>文档不存在或未登录</p>
        <button onClick={() => navigate('/workspace')} style={styles.backButton}>
          返回工作区
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <button
            onClick={() => navigate('/workspace')}
            style={styles.iconButton}
            title="返回工作区"
          >
            <ArrowLeft size={20} />
          </button>

          <div style={styles.titleWrapper}>
            {isEditingTitle ? (
              <div style={styles.titleEditWrapper}>
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  style={styles.titleInput}
                />
                {savingTitle && <Save size={14} style={{ color: '#10b981' }} />}
              </div>
            ) : (
              <h1
                onClick={() => setIsEditingTitle(true)}
                style={styles.documentTitle}
                title="点击编辑标题"
              >
                {document.title}
              </h1>
            )}
          </div>
        </div>

        <div style={styles.topBarRight}>
          {onlineUsers.length > 0 && (
            <div style={styles.onlineUsersBadge} title="在线协作者">
              <Users size={14} style={{ color: '#10b981' }} />
              <div style={styles.userAvatars}>
                {onlineUsers.map((user) => (
                  <div
                    key={user.id}
                    style={{
                      ...styles.userAvatar,
                      background: user.color,
                    }}
                    title={user.name}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
              <span style={styles.onlineCount}>{onlineUsers.length}</span>
            </div>
          )}
        </div>
      </div>

      <div style={styles.mainLayout}>
        <div style={styles.sidebar}>
          <DirectoryTree
            data={treeData}
            onSelect={handleTreeSelect}
            onAdd={handleTreeAdd}
            onDelete={handleTreeDelete}
            onRename={handleTreeRename}
            selectedId={selectedId}
          />
        </div>

        <div style={styles.editorArea}>
          <MarkdownEditor
            documentId={document.id}
            userId={currentUser.id}
            userName={currentUser.username}
            wsUrl={wsUrl}
          />
        </div>
      </div>
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
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#f1f5f9',
    gap: '16px',
  },
  loadingText: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
  },
  backButton: {
    padding: '8px 20px',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #0ea5e9, #10b981)',
    color: 'white',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    background: 'white',
    borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    zIndex: 10,
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flex: 1,
    minWidth: 0,
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  iconButton: {
    width: '36px',
    height: '36px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    background: 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#4b5563',
    transition: 'all 0.2s',
    flexShrink: 0,
  },
  titleWrapper: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    flex: 1,
  },
  documentTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: '#1e293b',
    cursor: 'text',
    padding: '6px 10px',
    borderRadius: '6px',
    transition: 'background 0.2s',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleEditWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
  },
  titleInput: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#1e293b',
    padding: '6px 10px',
    border: '2px solid #0ea5e9',
    borderRadius: '6px',
    outline: 'none',
    background: '#f0f9ff',
    width: '100%',
    minWidth: '200px',
    fontFamily: 'inherit',
  },
  onlineUsersBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '20px',
  },
  userAvatars: {
    display: 'flex',
    alignItems: 'center',
  },
  userAvatar: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '11px',
    fontWeight: 700,
    border: '2px solid white',
    marginLeft: '-6px',
  },
  onlineCount: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#166534',
  },
  mainLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '280px',
    flexShrink: 0,
    background: 'white',
    borderRight: '1px solid #e5e7eb',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  editorArea: {
    flex: 1,
    overflow: 'hidden',
  },
};

export default withErrorBoundary(Editor);
