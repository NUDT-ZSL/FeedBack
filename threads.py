"""Thread store: import, manual adjust, incremental recompute, undo.

Invariant: every note id belongs to exactly one thread. All derived
fields of a thread (theme/links/stats) come from `derive_thread`, a pure
function of the thread's note set -- so an incremental recompute of only
the affected threads is guaranteed to match a full recompute.
"""
import copy
import itertools

import engine


def derive_thread(note_ids, notes_by_id, vectors):
    """Pure function: note set -> derived thread data."""
    ids = sorted(note_ids)
    notes = [notes_by_id[i] for i in ids]
    links = []
    for a, b in itertools.combinations(ids, 2):
        s = engine.cosine(vectors[a], vectors[b])
        if s >= engine.LINK_THRESHOLD:
            links.append({'a': a, 'b': b, 'strength': round(s, 4)})
    links.sort(key=lambda l: (-l['strength'], l['a'], l['b']))
    times = sorted(n.get('time', '') for n in notes if n.get('time'))
    avg = (sum(l['strength'] for l in links) / len(links)) if links else 0.0
    agg = {}
    for i in ids:
        for tok, w in vectors[i].items():
            agg[tok] = agg.get(tok, 0.0) + w
    theme = [t for t, _ in sorted(agg.items(), key=lambda kv: (-kv[1], kv[0]))[:5]]
    return {
        'note_ids': ids,
        'theme': theme,
        'links': links,
        'stats': {
            'note_count': len(ids),
            'latest_time': times[-1] if times else None,
            'avg_link_strength': round(avg, 4),
            'link_count': len(links),
        },
    }


class ThreadStore:
    def __init__(self):
        self.notes = {}
        self.threads = {}
        self._next_tid = 1
        self._history = []

    def _vectors(self):
        return engine.build_vectors(list(self.notes.values()))

    def _snapshot(self):
        self._history.append({
            'notes': copy.deepcopy(self.notes),
            'threads': copy.deepcopy(self.threads),
            'next_tid': self._next_tid,
        })

    def _recompute(self, tids):
        vectors = self._vectors()
        for tid in tids:
            if tid in self.threads:
                self.threads[tid] = derive_thread(
                    self.threads[tid]['note_ids'], self.notes, vectors)
                self.threads[tid]['id'] = tid

    def _new_thread(self, note_ids):
        tid = 'T%d' % self._next_tid
        self._next_tid += 1
        self.threads[tid] = {'id': tid, 'note_ids': sorted(note_ids),
                             'theme': [], 'links': [], 'stats': {}}
        return tid

    def _note_thread(self, note_id):
        for tid, th in self.threads.items():
            if note_id in th['note_ids']:
                return tid
        return None

    # ---------- operations ----------
    def import_notes(self, notes):
        """Import notes, auto-cluster into threads. Returns affected tids."""
        self._snapshot()
        for n in notes:
            if not n.get('id'):
                raise ValueError('note missing id')
            if n['id'] in self.notes:
                raise ValueError('duplicate note id: %s' % n['id'])
            self.notes[n['id']] = {
                'id': n['id'],
                'text': n.get('text', ''),
                'source': n.get('source', ''),
                'time': n.get('time', ''),
            }
        vectors = self._vectors()
        self.threads = {}
        self._next_tid = 1
        for group in engine.cluster_note_ids(list(self.notes), vectors):
            self._new_thread(group)
        affected = sorted(self.threads)
        self._recompute(affected)
        return affected

    def move_note(self, note_id, target_tid):
        """Move a note into another thread. Only source+target recompute."""
        if note_id not in self.notes:
            raise ValueError('unknown note: %s' % note_id)
        if target_tid not in self.threads:
            raise ValueError('unknown thread: %s' % target_tid)
        src = self._note_thread(note_id)
        if src == target_tid:
            return []
        self._snapshot()
        self.threads[src]['note_ids'].remove(note_id)
        self.threads[target_tid]['note_ids'].append(note_id)
        self.threads[target_tid]['note_ids'].sort()
        affected = [target_tid]
        if not self.threads[src]['note_ids']:
            del self.threads[src]
        else:
            affected.append(src)
        self._recompute(affected)
        return sorted(affected)

    def merge_threads(self, tid_a, tid_b):
        """Merge two threads. Blocks on duplicate note ownership."""
        if tid_a not in self.threads or tid_b not in self.threads:
            raise ValueError('unknown thread id')
        if tid_a == tid_b:
            raise ValueError('cannot merge a thread with itself')
        set_a = set(self.threads[tid_a]['note_ids'])
        set_b = set(self.threads[tid_b]['note_ids'])
        dup = set_a & set_b
        if dup:
            raise ValueError(
                'merge blocked: duplicate note ownership %s' % sorted(dup))
        self._snapshot()
        keep, drop = (tid_a, tid_b) if tid_a < tid_b else (tid_b, tid_a)
        self.threads[keep]['note_ids'] = sorted(set_a | set_b)
        del self.threads[drop]
        self._recompute([keep])
        return [keep]

    def undo(self):
        """Revert the most recent adjustment. Returns affected tids."""
        if not self._history:
            return None
        snap = self._history.pop()
        before = set(self.threads)
        self.notes = snap['notes']
        self.threads = snap['threads']
        self._next_tid = snap['next_tid']
        after = set(self.threads)
        return sorted(before | after)

    # ---------- consistency ----------
    def verify_consistency(self):
        """Full recompute from scratch; must match current state exactly."""
        vectors = self._vectors()
        problems = []
        seen = {}
        for tid, th in sorted(self.threads.items()):
            for nid in th['note_ids']:
                if nid in seen:
                    problems.append('note %s in both %s and %s'
                                    % (nid, seen[nid], tid))
                seen[nid] = tid
                if nid not in self.notes:
                    problems.append('thread %s references unknown note %s'
                                    % (tid, nid))
        for nid in self.notes:
            if nid not in seen:
                problems.append('note %s not assigned to any thread' % nid)
        for tid, th in sorted(self.threads.items()):
            fresh = derive_thread(th['note_ids'], self.notes, vectors)
            for key in ('theme', 'links', 'stats'):
                if fresh[key] != th.get(key):
                    problems.append('thread %s stale field: %s' % (tid, key))
        return problems

    def to_dict(self):
        return {
            'notes': self.notes,
            'threads': {tid: th for tid, th in sorted(self.threads.items())},
            'can_undo': bool(self._history),
        }

    def split_note(self, note_id):
        """Split a note out of its thread into a new singleton thread."""
        if note_id not in self.notes:
            raise ValueError('unknown note: %s' % note_id)
        src = self._note_thread(note_id)
        self._snapshot()
        self.threads[src]['note_ids'].remove(note_id)
        new_tid = self._new_thread([note_id])
        affected = [new_tid]
        if not self.threads[src]['note_ids']:
            del self.threads[src]
        else:
            affected.append(src)
        self._recompute(affected)
        return sorted(affected)
