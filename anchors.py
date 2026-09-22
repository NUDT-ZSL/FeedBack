"""Comment anchor remapping engine.

Maps comment anchor intervals through a sequence of document edits
(insert / delete / replace) and tracks each comment's status:

  resolved  - anchor intact (or explicitly kept by the user)
  pending   - anchor partially modified, overlapping text remains
  invalid   - anchored text fully deleted
"""

from dataclasses import dataclass, field

RESOLVED = "resolved"
PENDING = "pending"
INVALID = "invalid"


@dataclass
class Edit:
    """A single edit operation.

    kind: "insert" (pos, text) | "delete" (pos, length) | "replace" (pos, length, text)
    """
    kind: str
    pos: int
    length: int = 0
    text: str = ""

    def normalized(self):
        """Return (del_start, del_end, inserted_text)."""
        if self.kind == "insert":
            return self.pos, self.pos, self.text
        if self.kind == "delete":
            return self.pos, self.pos + self.length, ""
        if self.kind == "replace":
            return self.pos, self.pos + self.length, self.text
        raise ValueError(f"unknown edit kind: {self.kind}")


def apply_edit(text, edit):
    """Apply one edit to a document string, returning the new string."""
    d_start, d_end, ins = edit.normalized()
    if not (0 <= d_start <= d_end <= len(text)):
        raise ValueError(f"edit range [{d_start}, {d_end}) out of bounds for len={len(text)}")
    return text[:d_start] + ins + text[d_end:]


def apply_edits(text, edits):
    for edit in edits:
        text = apply_edit(text, edit)
    return text


def map_positions(positions, edit):
    """Map a collection of character positions through one edit.

    Positions inside the edit's deleted range are dropped; positions after
    it shift by the net length change. Returns a sorted list.
    """
    d_start, d_end, ins = edit.normalized()
    delta = len(ins) - (d_end - d_start)
    out = []
    for p in positions:
        if p < d_start:
            out.append(p)
        elif p >= d_end:
            out.append(p + delta)
    return out


def map_interval(start, end, edit):
    """Map anchor interval [start, end) through one edit.

    Returns (new_start, new_end, touched, destroyed):
      touched   - the edit's deleted range overlaps the anchor
      destroyed - the anchored text was fully deleted
    """
    d_start, d_end, _ = edit.normalized()
    touched = max(0, min(end, d_end) - max(start, d_start)) > 0
    surviving = map_positions(range(start, end), edit)
    if not surviving:
        return None, None, True, True
    return surviving[0], surviving[-1] + 1, touched, False


@dataclass
class Comment:
    id: int
    content: str
    status: str = RESOLVED
    original_text: str = ""
    positions: list = field(default_factory=list)

    @property
    def start(self):
        return self.positions[0] if self.positions else 0

    @property
    def end(self):
        return self.positions[-1] + 1 if self.positions else 0

    def to_dict(self, document):
        anchored = document[self.start:self.end] if self.status != INVALID else ""
        return {
            "id": self.id,
            "start": self.start,
            "end": self.end,
            "content": self.content,
            "status": self.status,
            "original_text": self.original_text,
            "anchored_text": anchored,
        }


class DocumentTracker:
    """Holds the initial document, comments, and the applied edit sequence."""

    def __init__(self, document, comments):
        self.initial_document = document
        self.document = document
        self.edits = []
        self.comments = []
        for c in comments:
            s, e = c["start"], c["end"]
            if not (0 <= s < e <= len(document)):
                raise ValueError(f"comment {c.get('id')} anchor out of bounds")
            self.comments.append(Comment(
                id=c["id"],
                content=c.get("content", ""),
                status=RESOLVED,
                original_text=document[s:e],
                positions=list(range(s, e)),
            ))

    def add_edit(self, edit):
        self.document = apply_edit(self.document, edit)
        self.edits.append(edit)
        for c in self.comments:
            if c.status == INVALID:
                continue
            d_start, d_end, _ = edit.normalized()
            touched = max(0, min(c.end, d_end) - max(c.start, d_start)) > 0
            c.positions = map_positions(c.positions, edit)
            if not c.positions:
                c.status = INVALID
            elif touched:
                c.status = PENDING
        return self.state()

    def keep_comment(self, comment_id):
        c = self._find(comment_id)
        if c.status != PENDING:
            raise ValueError("only pending comments can be kept")
        c.status = RESOLVED
        return c

    def delete_comment(self, comment_id):
        c = self._find(comment_id)
        self.comments.remove(c)
        return c

    def _find(self, comment_id):
        for c in self.comments:
            if c.id == comment_id:
                return c
        raise KeyError(f"comment {comment_id} not found")

    def state(self):
        return {
            "document": self.document,
            "initial_document": self.initial_document,
            "edit_count": len(self.edits),
            "comments": [c.to_dict(self.document) for c in self.comments],
        }
