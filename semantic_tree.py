"""Core semantic-tree model for the offline accessibility reading-order tool.

Pure standard library. Holds elements, validates adjustments, computes the
reading (announcement) order, and keeps a snapshot history of schemes.
"""

# Roles that are never announced themselves; their children are still read.
SKIPPED_ROLES = {"presentation", "none"}

# Interactive / content roles that MUST have an accessible name.
NAME_REQUIRED_ROLES = {
    "button", "link", "checkbox", "radio", "textbox", "combobox",
    "tab", "menuitem", "switch", "slider", "spinbutton", "searchbox",
    "img", "option", "treeitem",
}

# Landmark-ish roles announced even without an accessible name.
ALWAYS_ANNOUNCED_ROLES = {
    "banner", "navigation", "main", "contentinfo", "complementary",
    "search", "form", "region", "heading", "table", "list", "dialog",
    "alert", "status",
}


class ConflictError(Exception):
    """Raised when an adjustment would put the tree into an illegal state."""

    def __init__(self, element_id, relation, reason):
        super().__init__(reason)
        self.element_id = element_id
        self.relation = relation
        self.reason = reason

    def to_dict(self):
        return {
            "element_id": self.element_id,
            "relation": self.relation,
            "reason": self.reason,
        }


class Element:
    def __init__(self, element_id, role, name, parent_id=None):
        self.id = element_id
        self.role = (role or "generic").strip() or "generic"
        self.name = (name or "").strip()
        self.parent_id = parent_id
        self.children = []  # ordered child ids

    def to_dict(self):
        return {
            "id": self.id,
            "role": self.role,
            "name": self.name,
            "parent_id": self.parent_id,
            "children": list(self.children),
        }


class SemanticTree:
    def __init__(self):
        self.elements = {}   # id -> Element
        self.root_order = []  # ordered ids of parentless elements
        self._seq = 0

    # ---------- construction ----------

    def _new_id(self):
        self._seq += 1
        while f"el{self._seq}" in self.elements:
            self._seq += 1
        return f"el{self._seq}"

    def add_element(self, role, name, parent_id=None, element_id=None,
                    index=None):
        element_id = (element_id or "").strip() or self._new_id()
        if element_id in self.elements:
            raise ConflictError(element_id, "id",
                                f"元素 id '{element_id}' 已存在")
        if parent_id is not None and parent_id not in self.elements:
            raise ConflictError(
                element_id, "parent",
                f"父元素 '{parent_id}' 不存在，"
                f"'{element_id}' 会成为孤立节点")
        el = Element(element_id, role, name, parent_id)
        self._check_name_rule(el)
        self.elements[element_id] = el
        siblings = self._siblings(parent_id)
        if index is None or index < 0 or index > len(siblings):
            siblings.append(element_id)
        else:
            siblings.insert(index, element_id)
        return el

    # ---------- validation helpers ----------

    def _siblings(self, parent_id):
        if parent_id is None:
            return self.root_order
        return self.elements[parent_id].children

    def _check_name_rule(self, el):
        if el.role in NAME_REQUIRED_ROLES and not el.name:
            raise ConflictError(
                el.id, "name",
                f"角色 '{el.role}' 必须有可读名称，"
                f"元素 '{el.id}' 的名称为空")

    def _is_descendant(self, ancestor_id, maybe_descendant_id):
        """True if maybe_descendant_id is inside ancestor_id's subtree."""
        stack = [ancestor_id]
        seen = set()
        while stack:
            cur = stack.pop()
            if cur == maybe_descendant_id:
                return True
            if cur in seen:
                continue
            seen.add(cur)
            node = self.elements.get(cur)
            if node:
                stack.extend(node.children)
        return False

    def _check_integrity(self):
        """Whole-tree check: orphans and name rule. Returns error dicts."""
        errors = []
        for el in self.elements.values():
            if el.parent_id is not None and el.parent_id not in self.elements:
                errors.append(ConflictError(
                    el.id, "parent",
                    f"元素 '{el.id}' 的父元素 '{el.parent_id}' 不存在，"
                    f"形成孤立节点").to_dict())
            if el.role in NAME_REQUIRED_ROLES and not el.name:
                errors.append(ConflictError(
                    el.id, "name",
                    f"角色 '{el.role}' 必须有可读名称，"
                    f"元素 '{el.id}' 的名称为空").to_dict())
        return errors

    # ---------- adjustments (validated, atomic) ----------

    def reparent(self, element_id, new_parent_id, index=None):
        el = self._require(element_id)
        if new_parent_id == element_id:
            raise ConflictError(element_id, "parent",
                                f"元素 '{element_id}' 不能作为自己的父元素")
        if new_parent_id is not None:
            if new_parent_id not in self.elements:
                raise ConflictError(
                    element_id, "parent",
                    f"目标父元素 '{new_parent_id}' 不存在，"
                    f"'{element_id}' 会成为孤立节点")
            if self._is_descendant(element_id, new_parent_id):
                raise ConflictError(
                    element_id, "parent",
                    f"'{new_parent_id}' 是 '{element_id}' 的后代，"
                    f"移动会形成循环归属")
        old = self._siblings(el.parent_id)
        old.remove(element_id)
        el.parent_id = new_parent_id
        siblings = self._siblings(new_parent_id)
        if index is None or index < 0 or index > len(siblings):
            siblings.append(element_id)
        else:
            siblings.insert(index, element_id)

    def reorder(self, element_id, new_index):
        el = self._require(element_id)
        siblings = self._siblings(el.parent_id)
        siblings.remove(element_id)
        new_index = max(0, min(new_index, len(siblings)))
        siblings.insert(new_index, element_id)

    def set_role(self, element_id, role):
        el = self._require(element_id)
        role = (role or "generic").strip() or "generic"
        trial = Element(el.id, role, el.name, el.parent_id)
        self._check_name_rule(trial)
        el.role = role

    def set_name(self, element_id, name):
        el = self._require(element_id)
        name = (name or "").strip()
        trial = Element(el.id, el.role, name, el.parent_id)
        self._check_name_rule(trial)
        el.name = name

    def remove_element(self, element_id, promote_children=True):
        el = self._require(element_id)
        siblings = self._siblings(el.parent_id)
        siblings.remove(element_id)
        if promote_children:
            idx = len(siblings)
            for child_id in el.children:
                child = self.elements[child_id]
                child.parent_id = el.parent_id
                siblings.insert(idx, child_id)
                idx += 1
        else:
            for child_id in list(el.children):
                self.remove_element(child_id, promote_children=False)
        del self.elements[element_id]

    def _require(self, element_id):
        el = self.elements.get(element_id)
        if el is None:
            raise ConflictError(element_id, "id",
                                f"元素 '{element_id}' 不存在")
        return el

    # ---------- reading order ----------

    def reading_order(self):
        """Pre-order traversal. Returns (announced, skipped) lists of dicts."""
        announced, skipped = [], []

        def visit(element_id):
            el = self.elements[element_id]
            if el.role in SKIPPED_ROLES:
                skipped.append({**el.to_dict(),
                                "skip_reason":
                                f"角色 '{el.role}' 不参与朗读"})
            elif el.name or el.role in ALWAYS_ANNOUNCED_ROLES:
                announced.append(el.to_dict())
            else:
                skipped.append({**el.to_dict(),
                                "skip_reason":
                                "无可读名称且非地标角色，被跳过"})
            for child_id in el.children:
                visit(child_id)

        for root_id in self.root_order:
            visit(root_id)
        return announced, skipped

    # ---------- serialization ----------

    def to_dict(self):
        announced, skipped = self.reading_order()
        return {
            "elements": {k: v.to_dict() for k, v in self.elements.items()},
            "root_order": list(self.root_order),
            "reading_order": announced,
            "skipped": skipped,
            "integrity_errors": self._check_integrity(),
        }

    def snapshot(self):
        """Deep, JSON-safe copy of the structural state."""
        return {
            "elements": [self.elements[k].to_dict() for k in
                         self._flat_ids()],
            "root_order": list(self.root_order),
            "seq": self._seq,
        }

    def _flat_ids(self):
        ids = []

        def walk(eid):
            ids.append(eid)
            for c in self.elements[eid].children:
                walk(c)
        for rid in self.root_order:
            walk(rid)
        return ids

    @classmethod
    def from_snapshot(cls, snap):
        tree = cls()
        tree._seq = snap.get("seq", 0)
        for el_data in snap.get("elements", []):
            el = Element(el_data["id"], el_data.get("role", "generic"),
                         el_data.get("name", ""), el_data.get("parent_id"))
            el.children = list(el_data.get("children", []))
            tree.elements[el.id] = el
        tree.root_order = list(snap.get("root_order", []))
        return tree
