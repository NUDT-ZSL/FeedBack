(() => {
  'use strict';

  const ROLES = [
    'application', 'banner', 'button', 'checkbox', 'combobox', 'complementary',
    'contentinfo', 'dialog', 'document', 'form', 'generic', 'grid', 'group',
    'heading', 'img', 'link', 'list', 'listitem', 'listbox', 'main', 'menu',
    'menubar', 'menuitem', 'navigation', 'none', 'option', 'paragraph',
    'presentation', 'radio', 'radiogroup', 'region', 'row', 'search',
    'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab',
    'table', 'tablist', 'tabpanel', 'textbox', 'timer', 'toolbar', 'tooltip',
    'tree', 'treeitem'
  ];

  const ROLE_LABELS = {
    application: '应用程序', banner: '横幅', button: '按钮', checkbox: '复选框',
    combobox: '组合框', complementary: '补充区域', contentinfo: '内容信息',
    dialog: '对话框', document: '文档', form: '表单', generic: '通用容器',
    grid: '网格', group: '分组', heading: '标题', img: '图片', link: '链接',
    list: '列表', listitem: '列表项', listbox: '列表框', main: '主要区域',
    menu: '菜单', menubar: '菜单栏', menuitem: '菜单项', navigation: '导航',
    none: '无语义', option: '选项', paragraph: '段落', presentation: '呈现角色',
    radio: '单选按钮', radiogroup: '单选组', region: '区域', row: '行',
    search: '搜索', searchbox: '搜索框', separator: '分隔符', slider: '滑块',
    spinbutton: '数字调节框', status: '状态', switch: '开关', tab: '选项卡',
    table: '表格', tablist: '选项卡列表', tabpanel: '选项卡面板',
    textbox: '文本框', timer: '计时器', toolbar: '工具栏', tooltip: '工具提示',
    tree: '树', treeitem: '树项目'
  };

  const SKIPPED_ROLES = new Set(['none', 'presentation']);

  function err(code, elementId, relation, message) {
    return { code, elementId: elementId || '', relation: relation || '', message };
  }

  function normalizeElements(input) {
    const rawList = Array.isArray(input) ? input
      : (input && Array.isArray(input.elements) ? input.elements : null);
    if (!rawList) throw new Error('数据必须是元素数组，或包含 elements 数组的对象。');

    return rawList.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`第 ${index + 1} 个元素必须是对象。`);
      }
      const id = String(raw.id ?? '').trim();
      const role = String(raw.role ?? '').trim();
      const name = String(raw.name ?? '').trim();
      const parentValue = raw.parentId === null || raw.parentId === undefined || String(raw.parentId).trim() === ''
        ? null : String(raw.parentId).trim();
      const order = Number(raw.order);
      return {
        id, role, name,
        parentId: parentValue,
        order: Number.isFinite(order) ? order : Number.NaN,
        hidden: Boolean(raw.hidden)
      };
    });
  }

  function compareOrder(a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id, 'zh-Hans-CN', { numeric: true });
  }

  function validateElements(input) {
    let elements;
    try {
      elements = normalizeElements(input);
    } catch (error) {
      return { ok: false, errors: [err('malformed', '', 'elements', error.message)], elements: [] };
    }

    const errors = [];
    const byId = new Map();
    elements.forEach((element) => {
      if (!element.id) {
        errors.push(err('missing-id', '', 'id', '存在缺少 id 的元素，无法建立父子关系。'));
      } else if (byId.has(element.id)) {
        errors.push(err('duplicate-id', element.id, 'id', `元素 id “${element.id}” 重复。`));
      } else {
        byId.set(element.id, element);
      }
      if (!element.role) {
        errors.push(err('missing-role', element.id, 'role', `元素 “${element.id}” 缺少角色。`));
      } else if (!ROLES.includes(element.role)) {
        errors.push(err('unknown-role', element.id, 'role', `元素 “${element.id}” 使用了未知角色 “${element.role}”。`));
      }
      if (!element.name) {
        errors.push(err('missing-name', element.id, 'name', `元素 “${element.id || '未命名元素'}” 缺少可读名称。`));
      }
      if (!Number.isSafeInteger(element.order) || element.order < 0) {
        errors.push(err('invalid-order', element.id, 'order', `元素 “${element.id}” 的顺序必须是不小于 0 的整数。`));
      }
    });

    elements.forEach((element) => {
      if (!element.id) return;
      if (element.parentId === element.id) {
        errors.push(err('cycle', element.id, `${element.id} → ${element.id}`,
          `元素 “${element.id}” 不能把自己设为父级；路径：${element.id} → ${element.id}。`));
        return;
      }
      if (element.parentId && !byId.has(element.parentId)) {
        errors.push(err('missing-parent', element.id, `${element.id} → ${element.parentId}`,
          `元素 “${element.id}” 的父级 “${element.parentId}” 不存在，节点会变为孤立节点。`));
      }
    });

    const siblingOrders = new Map();
    elements.forEach((element) => {
      if (!element.id || !Number.isSafeInteger(element.order) || element.order < 0) return;
      const parentKey = element.parentId || '__ROOT__';
      const orderKey = `${parentKey}#${element.order}`;
      const previous = siblingOrders.get(orderKey);
      if (previous && previous !== element.id) {
        const parentText = element.parentId || '界面根';
        errors.push(err('duplicate-order', element.id, `${parentText} / order ${element.order}`,
          `元素 “${element.id}” 与 “${previous}” 在父级 “${parentText}” 下使用了相同顺序 ${element.order}，阅读顺序存在歧义。`));
      } else {
        siblingOrders.set(orderKey, element.id);
      }
    });

    const visitState = new Map();
    const cycleNodes = new Set();
    elements.forEach((start) => {
      if (!start.id || visitState.has(start.id)) return;
      const stack = [{ node: start, active: false }];
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const current = frame.node;
        if (!frame.active) {
          visitState.set(current.id, 1);
          frame.active = true;
          const parent = current.parentId ? byId.get(current.parentId) : null;
          if (parent) {
            const parentState = visitState.get(parent.id);
            if (parentState === 1) {
              const activePath = stack.map((item) => item.node);
              const startIndex = activePath.findIndex((item) => item.id === parent.id);
              const cyclePath = activePath.slice(startIndex);
              cyclePath.forEach((item) => cycleNodes.add(item.id));
              const pathText = cyclePath.map((item) => item.id).concat(parent.id).join(' → ');
              errors.push(err('cycle', current.id, `${current.id} → ${parent.id}`,
                `父子关系形成循环：${pathText}。冲突关系为 “${current.id}” 的父级指向 “${parent.id}”。`));
            } else if (!parentState) {
              stack.push({ node: parent, active: false });
            }
          }
        } else {
          visitState.set(current.id, 2);
          stack.pop();
        }
      }
    });

    elements.forEach((element) => {
      if (!element.id || cycleNodes.has(element.id) || !element.parentId || !byId.has(element.parentId)) return;
      const seen = new Set();
      let current = element;
      const path = [];
      while (current) {
        path.push(current.id);
        if (cycleNodes.has(current.id)) {
          errors.push(err('orphan', element.id, `${element.id} → ${element.parentId}`,
            `元素 “${element.id}” 无法到达界面根节点，因为其上级链进入循环：${path.join(' → ')}。`));
          return;
        }
        if (seen.has(current.id)) return;
        seen.add(current.id);
        if (!current.parentId) return;
        const parent = byId.get(current.parentId);
        if (!parent) {
          errors.push(err('orphan', element.id, `${element.id} → ${element.parentId}`,
            `元素 “${element.id}” 无法到达界面根节点，因为上级 “${current.id}” 指向了不存在的 “${current.parentId}”。路径：${path.join(' → ')}。`));
          return;
        }
        current = parent;
      }
    });

    return { ok: errors.length === 0, errors, elements };
  }

  function buildChildren(elements) {
    const children = new Map();
    elements.forEach((element) => {
      const key = element.parentId || '__ROOT__';
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(element);
    });
    children.forEach((list) => list.sort(compareOrder));
    return children;
  }

  function createSnapshot(elements, meta = {}) {
    const result = validateElements(elements);
    if (!result.ok) return { ok: false, errors: result.errors, snapshot: null };
    return {
      ok: true,
      errors: [],
      snapshot: {
        id: meta.id || `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: meta.label || '未命名方案',
        createdAt: meta.createdAt || new Date().toISOString(),
        basis: meta.basis || '',
        elements: result.elements
      }
    };
  }

  function getReadingPlan(elements) {
    const children = buildChildren(elements);
    const sequence = [];
    const skipped = [];
    const walk = (parentId, depth, hiddenBy) => {
      (children.get(parentId) || []).forEach((element) => {
        if (element.hidden) {
          skipped.push({ ...element, depth, reason: '元素被标记为隐藏，整棵子树不会朗读' });
          walk(element.id, depth + 1, element.id);
          return;
        }
        if (hiddenBy) {
          skipped.push({ ...element, depth, reason: `祖先 “${hiddenBy}” 已隐藏，该节点位于隐藏子树中` });
          walk(element.id, depth + 1, hiddenBy);
          return;
        }
        if (SKIPPED_ROLES.has(element.role)) {
          skipped.push({ ...element, depth, reason: `角色为 ${element.role}，元素自身不产生语义朗读` });
        } else {
          sequence.push({ ...element, depth, number: sequence.length + 1 });
        }
        walk(element.id, depth + 1, null);
      });
    };
    walk('__ROOT__', 0, null);
    return { sequence, skipped };
  }

  function changeElement(snapshot, patch) {
    const elements = snapshot.elements.map((element) => {
      if (element.id !== patch.id) return { ...element };
      return {
        ...element,
        role: patch.role,
        name: patch.name,
        parentId: patch.parentId,
        order: patch.order,
        hidden: Boolean(patch.hidden)
      };
    });
    const result = createSnapshot(elements, {});
    if (!result.ok && patch.parentId) {
      result.errors = result.errors.map((error) => {
        if (error.code !== 'cycle' || !error.message.includes(patch.id)) return error;
        return {
          ...error,
          elementId: patch.id,
          relation: `${patch.id} → ${patch.parentId}`,
          message: `${error.message} 本次修改的关系“${patch.id} → ${patch.parentId}”是该循环的一部分。`
        };
      });
    }
    return result;
  }

  function addElement(snapshot, patch) {
    return createSnapshot(snapshot.elements.concat({
      id: patch.id, role: patch.role, name: patch.name,
      parentId: patch.parentId, order: patch.order, hidden: Boolean(patch.hidden)
    }), {});
  }

  function moveElement(snapshot, id, direction) {
    const elements = snapshot.elements.map((element) => ({ ...element }));
    const target = elements.find((element) => element.id === id);
    if (!target) {
      return { ok: false, errors: [err('missing-id', id, 'id', `找不到要移动的元素 “${id}”。`)], snapshot: null };
    }
    const siblings = elements
      .filter((element) => (element.parentId || null) === (target.parentId || null))
      .sort(compareOrder);
    const index = siblings.findIndex((element) => element.id === id);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= siblings.length) return { ok: true, errors: [], snapshot: null };
    const reordered = siblings.slice();
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    reordered.forEach((element, position) => { element.order = position + 1; });
    return createSnapshot(elements, {});
  }

  const api = {
    ROLES, ROLE_LABELS, SKIPPED_ROLES, normalizeElements, validateElements,
    buildChildren, createSnapshot, getReadingPlan, changeElement, addElement, moveElement
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.SemanticTree = api;
})();
