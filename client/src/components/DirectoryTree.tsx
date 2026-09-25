import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Plus, Trash2, Edit3, Search, X, Check } from 'lucide-react';

export interface TreeNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  children?: TreeNode[];
  parentId?: string | null;
}

interface DirectoryTreeProps {
  data: TreeNode[];
  onSelect?: (node: TreeNode) => void;
  onAdd?: (parentId: string | null, type: 'folder' | 'file') => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  selectedId?: string | null;
}

const DirectoryTree: React.FC<DirectoryTreeProps> = ({
  data,
  onSelect,
  onAdd,
  onDelete,
  onRename,
  selectedId,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filterTree = (nodes: TreeNode[], query: string): TreeNode[] => {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      if (node.type === 'folder' && node.children) {
        const filteredChildren = filterTree(node.children, query);
        if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query.toLowerCase())) {
          result.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children });
          setExpandedIds((prev) => new Set(prev).add(node.id));
        }
      } else if (node.name.toLowerCase().includes(query.toLowerCase())) {
        result.push(node);
      }
    }
    return result;
  };

  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    return filterTree(data, searchQuery.trim());
  }, [data, searchQuery]);

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const startEdit = (node: TreeNode) => {
    setEditingId(node.id);
    setEditValue(node.name);
    setContextMenu(null);
  };

  const confirmEdit = () => {
    if (editingId && editValue.trim()) {
      onRename?.(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') confirmEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedId === node.id;
    const isEditing = editingId === node.id;
    const hasChildren = node.type === 'folder' && node.children && node.children.length > 0;

    return (
      <div key={node.id}>
        <div
          className={`tree-node ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
          onContextMenu={(e) => handleContextMenu(e, node.id)}
          onClick={() => {
            if (node.type === 'folder') {
              toggleExpand(node.id);
            }
            onSelect?.(node);
          }}
        >
          <div className="node-content">
            <div className="node-icon-wrapper">
              {node.type === 'folder' ? (
                <span className={`chevron-icon ${hasChildren ? '' : 'invisible'}`}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
              ) : (
                <span className="chevron-icon invisible">
                  <ChevronRight size={16} />
                </span>
              )}
              <span className="type-icon">
                {node.type === 'folder' ? (
                  isExpanded ? <FolderOpen size={18} className="folder-icon" /> : <Folder size={18} className="folder-icon" />
                ) : (
                  <FileText size={18} className="file-icon" />
                )}
              </span>
            </div>

            {isEditing ? (
              <div className="edit-input-wrapper">
                <input
                  type="text"
                  className="edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button className="edit-btn confirm" onClick={(e) => { e.stopPropagation(); confirmEdit(); }}>
                  <Check size={14} />
                </button>
                <button className="edit-btn cancel" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <span className="node-name">{node.name}</span>
            )}
          </div>
        </div>

        {node.type === 'folder' && isExpanded && node.children && (
          <div className="children-wrapper">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="directory-tree">
      <div className="tree-header">
        <div className="search-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="header-actions">
          <button className="action-btn" title="新建文件夹" onClick={() => onAdd?.(null, 'folder')}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="tree-body">
        {filteredData.length > 0 ? (
          filteredData.map((node) => renderNode(node))
        ) : (
          <div className="empty-state">暂无文件</div>
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-item" onClick={() => {
            const node = findNode(data, contextMenu.id);
            if (node) startEdit(node);
          }}>
            <Edit3 size={14} /> 重命名
          </button>
          <button className="context-item" onClick={() => onAdd?.(contextMenu.id, 'folder')}>
            <Plus size={14} /> 新建文件夹
          </button>
          <button className="context-item" onClick={() => onAdd?.(contextMenu.id, 'file')}>
            <Plus size={14} /> 新建文件
          </button>
          <button className="context-item danger" onClick={() => {
            onDelete?.(contextMenu.id);
            setContextMenu(null);
          }}>
            <Trash2 size={14} /> 删除
          </button>
        </div>
      )}
    </div>
  );
};

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export default DirectoryTree;
